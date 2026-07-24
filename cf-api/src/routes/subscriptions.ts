import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings, bookings, customers, slots as slotsTable, subscriptions, tasks } from '../db/schema';
import { distributeTask } from './distribution';

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}

export async function handleSubscriptions(req: Request, env: Env, path: string): Promise<Response> {
  const db = createDb(env);

  // GET /api/subscriptions - list
  if (path === '/api/subscriptions' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const customerId = new URL(req.url).searchParams.get('customer_id');
      const conditions = [];
      if (customerId) conditions.push(eq(subscriptions.customerId, customerId));

      const rows = await db.select().from(subscriptions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${subscriptions.nextBookingDate} ASC`).all();
      return ok(rows);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/subscriptions - create
  if (path === '/api/subscriptions' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);

      const { customer_id, service_type, zone_id, interval_days } = await req.json() as any;
      if (!customer_id || !service_type) return err('Missing customer_id or service_type');

      const cust = await db.select({ id: customers.id }).from(customers)
        .where(eq(customers.id, customer_id)).get();
      if (!cust) return err('Customer not found', 404);

      const interval = interval_days || 180;
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + interval);

      const sid = uuid();
      await db.insert(subscriptions).values({
        id: sid,
        customerId: customer_id,
        serviceType: service_type,
        zoneId: zone_id || null,
        intervalDays: interval,
        nextBookingDate: nextDate.toISOString().split('T')[0],
        status: 'active',
        createdAt: nowISO(),
        updatedAt: nowISO()
      });

      const s = await db.select().from(subscriptions).where(eq(subscriptions.id, sid)).get();
      return ok(s);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // PATCH /api/subscriptions/:id
  const idMatch = path.match(/^\/api\/subscriptions\/([a-f0-9-]+)$/);
  if (idMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const body = await req.json() as any;
      const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, idMatch[1])).get();
      if (!sub) return err('Not found', 404);

      const updates: Record<string, any> = { updatedAt: nowISO() };
      if (body.status !== undefined) {
        if (!['active', 'paused', 'cancelled'].includes(body.status)) return err('Invalid status');
        updates.status = body.status;
      }
      if (body.interval_days !== undefined) updates.intervalDays = body.interval_days;
      if (body.next_booking_date !== undefined) updates.nextBookingDate = body.next_booking_date;

      await db.update(subscriptions).set(updates).where(eq(subscriptions.id, idMatch[1]));
      const s = await db.select().from(subscriptions).where(eq(subscriptions.id, idMatch[1])).get();
      return ok(s);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

// Process due subscriptions (called by cron or manually)
export async function processDueSubscriptions(db: AppDb, env?: any): Promise<{ processed: number; bookings: number }> {
  const today = new Date().toISOString().split('T')[0];
  const due = await db.select().from(subscriptions)
    .where(and(
      eq(subscriptions.status, 'active'),
      sql`${subscriptions.nextBookingDate} <= ${today}`
    )).all();

  let processed = 0, booked = 0;

  for (const sub of due) {
    try {
      const cust = await db.select({ phone: customers.phone, name: customers.name, address: customers.address })
        .from(customers).where(eq(customers.id, sub.customerId)).get();
      if (!cust) continue;

      const priceTotal = parseFloat(await getSetting(db, 'price_total') || '300');
      const priceDeposit = parseFloat(await getSetting(db, 'price_deposit') || '150');
      const bookingDate = new Date();
      bookingDate.setDate(bookingDate.getDate() + 2); // book 2 days ahead
      const bd = bookingDate.toISOString().split('T')[0];

      const bookingId = uuid();
      const taskId = uuid();
      const now = nowISO();
      const firstSlot = (await getSetting(db, 'booking_time_slots') || '9am,11am,2pm,4pm').split(',')[0].trim();

      await db.insert(bookings).values({
        id: bookingId, customerName: cust.name, customerPhone: cust.phone,
        customerAddress: cust.address || '', bookingDate: bd, bookingTime: firstSlot,
        amount: priceTotal, depositAmount: priceDeposit, customerId: sub.customerId,
        notes: 'Auto-renewal subscription', createdAt: now, updatedAt: now
      } as any);
      await db.insert(tasks).values({ id: taskId, bookingId, status: 'unassigned', createdAt: now, updatedAt: now } as any);
      await db.insert(slotsTable).values({ id: uuid(), date: bd, timeSlot: firstSlot, isBooked: 1, bookingId } as any);

      try { await distributeTask(db, taskId, sub.zoneId || undefined); } catch {}

      // Advance next booking date
      const next = new Date();
      next.setDate(next.getDate() + (sub.intervalDays || 180));
      await db.update(subscriptions).set({
        nextBookingDate: next.toISOString().split('T')[0],
        lastBookingId: bookingId,
        updatedAt: nowISO()
      }).where(eq(subscriptions.id, sub.id));

      booked++;
    } catch (e) { console.error('Subscription processing error:', e); }
    processed++;
  }

  return { processed, bookings: booked };
}
