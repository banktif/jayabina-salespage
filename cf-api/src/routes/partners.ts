import { and, eq, like, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings, bookings, partners, slots, tasks } from '../db/schema';
import { checkRateLimit } from '../utils/rate-limiter';
import { distributeTask } from './distribution';

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}

export async function handlePartners(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/partners - list (admin only)
  if (path === '/api/partners' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const rows = await db.select().from(partners).orderBy(sql`${partners.createdAt} DESC`).all();
      return ok(rows.map(r => ({ ...r, api_key: r.apiKey ? r.apiKey.substring(0, 8) + '...' + r.apiKey.slice(-4) : '' })));
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/partners - create (admin only)
  if (path === '/api/partners' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const { name, contact_phone, contact_email, webhook_url, commission_rate, rate_limit } = await req.json() as any;
      if (!name) return err('Missing name');

      const apiKey = `jb_pk_${crypto.randomUUID().replace(/-/g, '')}`;

      await db.insert(partners).values({
        id: uuid(),
        name,
        contactPhone: contact_phone || '',
        contactEmail: contact_email || '',
        apiKey,
        webhookUrl: webhook_url || '',
        commissionRate: commission_rate || 0,
        rateLimitPerHour: rate_limit || 10,
        createdAt: nowISO(),
        updatedAt: nowISO()
      });

      const p = await db.select().from(partners).where(eq(partners.apiKey, apiKey)).get();
      return ok(p);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // PATCH/DELETE /api/partners/:id
  const idMatch = path.match(/^\/api\/partners\/([a-f0-9-]+)$/);
  if (idMatch) {
    const pid = idMatch[1];

    if (req.method === 'PATCH') {
      try {
        const payload = await requireAuth(req, env);
        if (payload.role !== 'admin') return err('Admin only', 403);

        const body = await req.json() as any;
        const updates: Record<string, any> = { updatedAt: nowISO() };

        if (body.name !== undefined) updates.name = body.name;
        if (body.is_active !== undefined) updates.isActive = body.is_active ? 1 : 0;
        if (body.webhook_url !== undefined) updates.webhookUrl = body.webhook_url;
        if (body.commission_rate !== undefined) updates.commissionRate = body.commission_rate;
        if (body.rate_limit_per_hour !== undefined) updates.rateLimitPerHour = body.rate_limit_per_hour;

        await db.update(partners).set(updates).where(eq(partners.id, pid));
        const p = await db.select().from(partners).where(eq(partners.id, pid)).get();
        return ok(p);
      } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
    }

    if (req.method === 'DELETE') {
      try {
        const payload = await requireAuth(req, env);
        if (payload.role !== 'admin') return err('Admin only', 403);
        await db.delete(partners).where(eq(partners.id, pid));
        return ok({ deleted: true });
      } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
    }
  }

  // POST /api/partners/book — partner booking endpoint (API key auth)
  if (path === '/api/partners/book' && req.method === 'POST') {
    try {
      const apiKey = req.headers.get('x-api-key') || '';
      if (!apiKey) return err('Missing x-api-key header', 401);

      const partner = await db.select().from(partners)
        .where(and(eq(partners.apiKey, apiKey), eq(partners.isActive, 1))).get();
      if (!partner) return err('Invalid API key', 401);

      const rl = await checkRateLimit(db, `partner:${partner.id}`, '/api/partners/book', partner.rateLimitPerHour || 10);
      if (!rl.allowed) return err('Rate limit exceeded', 429);

      const body = await req.json() as any;
      const { customer_name, customer_phone, customer_address, booking_date, booking_time, zone_id } = body;

      if (!customer_name || !customer_phone || !customer_address || !booking_date || !booking_time) {
        return err('Missing required fields');
      }

      const priceTotal = parseFloat(await getSetting(db, 'price_total') || '300');
      const priceDeposit = parseFloat(await getSetting(db, 'price_deposit') || '150');

      const bookingId = uuid();
      const taskId = uuid();
      const slotId = uuid();
      const now = nowISO();

      await db.batch([
        db.insert(bookings).values({
          id: bookingId, customerName: customer_name, customerPhone: customer_phone,
          customerAddress: customer_address, bookingDate: booking_date, bookingTime: booking_time,
          amount: priceTotal, depositAmount: priceDeposit,
          notes: `Partner: ${partner.name}`, createdAt: now, updatedAt: now
        }),
        db.insert(tasks).values({ id: taskId, bookingId, status: 'unassigned', createdAt: now, updatedAt: now } as any),
        db.insert(slots).values({ id: slotId, date: booking_date, timeSlot: booking_time, isBooked: 1, bookingId } as any)
      ]);

      await db.update(partners).set({ totalBookings: sql`${partners.totalBookings} + 1` })
        .where(eq(partners.id, partner.id));

      try {
        await distributeTask(db, taskId, zone_id);
      } catch {}

      // Partner webhook
      if (partner.webhookUrl) {
        try {
          await fetch(partner.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'booking.created', booking_id: bookingId, partner: partner.name })
          });
        } catch {}
      }

      return ok({ booking_id: bookingId, status: 'confirmed' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}
