import { and, asc, count, desc, eq, min, max, sql, sum, type SQL } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO, normPhone } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings, bookings, customers, profiles, slots, taskPhotos, tasks } from '../db/schema';
import { autoAssignTask } from './bookings';

const taskFields = {
  id: tasks.id,
  booking_id: tasks.bookingId,
  assigned_to: tasks.assignedTo,
  status: tasks.status,
  started_at: tasks.startedAt,
  finished_at: tasks.finishedAt,
  completed_at: tasks.completedAt,
  created_at: tasks.createdAt,
  updated_at: tasks.updatedAt
};

const photoFields = {
  id: taskPhotos.id,
  task_id: taskPhotos.taskId,
  type: taskPhotos.type,
  url: taskPhotos.url,
  uploaded_by: taskPhotos.uploadedBy,
  created_at: taskPhotos.createdAt
};

export async function handleTasks(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/tasks
  if (path === '/api/tasks' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const statusFilter = url.searchParams.get('status');
      const assignedTo = url.searchParams.get('assigned_to');
      const bookingId = url.searchParams.get('booking_id');

      const conditions: SQL[] = [];

      if (payload.role === 'staff') {
        conditions.push(eq(tasks.assignedTo, payload.sub));
      }

      if (statusFilter) conditions.push(eq(tasks.status, statusFilter as any));
      if (assignedTo && payload.role === 'admin') conditions.push(eq(tasks.assignedTo, assignedTo));
      if (bookingId && payload.role === 'admin') conditions.push(eq(tasks.bookingId, bookingId));

      const rows = await db.select({
        ...taskFields,
        customer_name: bookings.customerName,
        customer_phone: bookings.customerPhone,
        customer_address: bookings.customerAddress,
        booking_date: bookings.bookingDate,
        booking_time: bookings.bookingTime,
        staff_name: profiles.fullName
      }).from(tasks)
        .leftJoin(bookings, eq(tasks.bookingId, bookings.id))
        .leftJoin(profiles, eq(tasks.assignedTo, profiles.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(bookings.bookingDate), asc(bookings.bookingTime));
      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // PATCH /api/tasks/:id
  const patchMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = patchMatch[1];
      const body = await req.json() as any;
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo,
        status: tasks.status,
        booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);

      // Staff can only update own tasks
      if (payload.role === 'staff' && task.assigned_to !== payload.sub) {
        return err('Access denied', 403);
      }

      const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: now };
      let hasUpdate = false;
      let nextStatus: typeof tasks.$inferInsert.status | null = null;

      if (body.assigned_to !== undefined && payload.role === 'admin') {
        if (body.assigned_to) {
          const assignee = await db.select({ id: profiles.id }).from(profiles)
            .where(and(eq(profiles.id, body.assigned_to), eq(profiles.role, 'staff'), eq(profiles.isActive, 1))).get();
          if (!assignee) return err('Selected staff account is not active', 400);
        } else if (!['unassigned', 'assigned', 'cancelled'].includes(task.status)) {
          return err('A job already in progress cannot be unassigned', 409);
        }
        updates.assignedTo = body.assigned_to;
        hasUpdate = true;
        if (['unassigned', 'assigned', 'cancelled'].includes(task.status)) {
          nextStatus = body.assigned_to ? 'assigned' : 'unassigned';
        }
      }

      if (body.status !== undefined) {
        const allowedStatuses = ['unassigned', 'assigned', 'in_progress', 'awaiting_review', 'completed', 'cancelled'];
        if (!allowedStatuses.includes(body.status)) return err('Invalid task status');
        if (payload.role === 'staff' && !['in_progress', 'awaiting_review'].includes(body.status)) {
          return err('Staff can only start a job or submit it for review', 403);
        }
        if (payload.role === 'staff' && body.status === 'in_progress') {
          if (task.status !== 'assigned') return err('Only an assigned job can be started', 409);
          const before = await db.select({ cnt: count() }).from(taskPhotos)
            .where(and(eq(taskPhotos.taskId, taskId), eq(taskPhotos.type, 'before'))).get();
          if (!before?.cnt) return err('Upload at least one before photo before starting the job', 409);
        }
        if (payload.role === 'staff' && body.status === 'awaiting_review') {
          if (task.status !== 'in_progress') return err('Start the job before submitting it for review', 409);
          const after = await db.select({ cnt: count() }).from(taskPhotos)
            .where(and(eq(taskPhotos.taskId, taskId), eq(taskPhotos.type, 'after'))).get();
          if (!after?.cnt) return err('Upload at least one after photo before finishing the job', 409);
        }
        nextStatus = body.status;
        hasUpdate = true;
        switch (body.status) {
          case 'in_progress':
            updates.startedAt = body.started_at || now;
            // Notify admin
            (async () => {
              const b = await db.select({
                customer_name: bookings.customerName, booking_date: bookings.bookingDate, booking_time: bookings.bookingTime
              }).from(bookings).where(eq(bookings.id, task.booking_id)).get();
              const s = await db.select({ full_name: profiles.fullName }).from(profiles).where(eq(profiles.id, task.assigned_to || '')).get();
              await notifyAdmin(env, db, `🚀 ${s?.full_name || 'Staff'} STARTED job\n${b?.customer_name || 'Customer'} — ${b?.booking_date} ${b?.booking_time}`);
            })();
            break;
          case 'awaiting_review':
            updates.finishedAt = body.finished_at || now;
            // Notify admin
            (async () => {
              const b = await db.select({
                customer_name: bookings.customerName, booking_date: bookings.bookingDate, booking_time: bookings.bookingTime
              }).from(bookings).where(eq(bookings.id, task.booking_id)).get();
              const s = await db.select({ full_name: profiles.fullName }).from(profiles).where(eq(profiles.id, task.assigned_to || '')).get();
              await notifyAdmin(env, db, `📸 ${s?.full_name || 'Staff'} FINISHED job (awaiting review)\n${b?.customer_name || 'Customer'} — ${b?.booking_date} ${b?.booking_time}`);
            })();
            // Auto-complete check
            const autoComplete = await db.select({ value: appSettings.value }).from(appSettings)
              .where(eq(appSettings.key, 'auto_complete_task')).get();
            if (autoComplete?.value === 'true') {
              nextStatus = 'completed';
              updates.completedAt = now;
              await db.update(bookings).set({ status: 'completed', updatedAt: now })
                .where(eq(bookings.id, task.booking_id));
              const autoBooking = await db.select({ customer_id: bookings.customerId }).from(bookings)
                .where(eq(bookings.id, task.booking_id)).get();
              if (autoBooking?.customer_id) await refreshCustomerStats(db, autoBooking.customer_id);
            }
            break;
          case 'completed':
            if (payload.role !== 'admin') return err('Admin only', 403);
            updates.completedAt = now;
            await db.update(bookings).set({ status: 'completed', updatedAt: now })
              .where(eq(bookings.id, task.booking_id));
            const completedBooking = await db.select({ customer_id: bookings.customerId }).from(bookings)
              .where(eq(bookings.id, task.booking_id)).get();
            if (completedBooking?.customer_id) await refreshCustomerStats(db, completedBooking.customer_id);
            // Notify admin
            (async () => {
              const b = await db.select({
                customer_name: bookings.customerName, booking_date: bookings.bookingDate, booking_time: bookings.bookingTime
              }).from(bookings).where(eq(bookings.id, task.booking_id)).get();
              await notifyAdmin(env, db, `✅ Job COMPLETED\n${b?.customer_name || 'Customer'} — ${b?.booking_date} ${b?.booking_time}`);
            })();
            break;
          case 'cancelled':
            if (payload.role !== 'admin') return err('Admin only', 403);
            await db.update(bookings).set({ status: 'cancelled', updatedAt: now })
              .where(eq(bookings.id, task.booking_id));
            await db.update(slots).set({ isBooked: 0 }).where(eq(slots.bookingId, task.booking_id));
            break;
        }
      }

      if (nextStatus !== null) updates.status = nextStatus;

      if (hasUpdate) await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

      const updated = await db.select(taskFields).from(tasks).where(eq(tasks.id, taskId)).get();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/tasks/:id/accept — staff accepts assigned job
  const acceptMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/accept$/);
  if (acceptMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = acceptMatch[1];
      const task = await db.select({
        id: tasks.id, assigned_to: tasks.assignedTo, status: tasks.status,
        booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('This job is not assigned to you', 403);
      if (task.status !== 'assigned') return err('Only assigned jobs can be accepted', 409);

      const booking = await db.select({
        customer_name: bookings.customerName, customer_address: bookings.customerAddress,
        booking_date: bookings.bookingDate, booking_time: bookings.bookingTime
      }).from(bookings).where(eq(bookings.id, task.booking_id)).get();
      const staff = await db.select({ full_name: profiles.fullName, phone: profiles.phone })
        .from(profiles).where(eq(profiles.id, payload.sub)).get();

      await notifyAdmin(env, db,
        `✅ ${staff?.full_name || 'Staff'} ACCEPTED job\n`
        + `${booking?.customer_name || 'Customer'} — ${booking?.booking_date} ${booking?.booking_time}\n`
        + `${booking?.customer_address || ''}`
      );

      return ok({ task_id: taskId, status: 'assigned', accepted: true });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/tasks/:id/reject — staff rejects, auto-reassign
  const rejectMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = rejectMatch[1];
      const task = await db.select({
        id: tasks.id, assigned_to: tasks.assignedTo, status: tasks.status,
        booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('This job is not assigned to you', 403);
      if (task.status !== 'assigned') return err('Only assigned jobs can be rejected', 409);

      const booking = await db.select({
        customer_name: bookings.customerName, customer_address: bookings.customerAddress,
        booking_date: bookings.bookingDate, booking_time: bookings.bookingTime
      }).from(bookings).where(eq(bookings.id, task.booking_id)).get();
      const staff = await db.select({ full_name: profiles.fullName })
        .from(profiles).where(eq(profiles.id, payload.sub)).get();

      await db.update(tasks).set({ assignedTo: null, status: 'unassigned', updatedAt: nowISO() })
        .where(eq(tasks.id, taskId));

      const result = await autoAssignTask(db, taskId, payload.sub);
      let msg = `❌ ${staff?.full_name || 'Staff'} REJECTED job\n`
        + `${booking?.customer_name || 'Customer'} — ${booking?.booking_date} ${booking?.booking_time}\n`
        + `${booking?.customer_address || ''}\n`;

      if (result.assigned && result.staffId) {
        const newStaff = await db.select({ full_name: profiles.fullName, phone: profiles.phone })
          .from(profiles).where(eq(profiles.id, result.staffId)).get();
        msg += `🔄 Reassigned to: ${newStaff?.full_name || result.staffId}`;
        await sendWaToStaff(env, db, result.staffId,
          `🔔 NEW JOB ASSIGNED\n`
          + `${booking?.customer_name || 'Customer'} — ${booking?.booking_date} ${booking?.booking_time}\n`
          + `${booking?.customer_address || ''}\n`
          + `Previous staff rejected. Please check your dashboard.`
        );
      } else {
        msg += `⚠️ No other staff available — job is unassigned.`;
      }

      await notifyAdmin(env, db, msg);
      return ok({ task_id: taskId, reassigned: result.assigned, new_staff_id: result.staffId || null });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

// --- WhatsApp notification helpers ---

async function notifyAdmin(env: Env, db: AppDb, message: string): Promise<void> {
  try {
    const admins = await db.select({ phone: profiles.phone }).from(profiles)
      .where(eq(profiles.role, 'admin'));
    for (const admin of admins) {
      if (admin.phone) await sendWa(env, admin.phone, message);
    }
  } catch {}
}

async function sendWaToStaff(env: Env, db: AppDb, staffId: string, message: string): Promise<void> {
  try {
    const staff = await db.select({ phone: profiles.phone }).from(profiles)
      .where(eq(profiles.id, staffId)).get();
    if (staff?.phone) await sendWa(env, staff.phone, message);
  } catch {}
}

async function sendWa(env: Env, phone: string, message: string): Promise<void> {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '6' + digits;
  if (!digits.startsWith('60')) digits = '60' + digits;

  if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
    await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: message } })
    });
  }
}

export async function handleTaskPhotos(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/task-photos?task_id=
  if (path === '/api/task-photos' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = url.searchParams.get('task_id');
      if (!taskId) return err('Missing task_id');

      if (payload.role === 'staff') {
        const task = await db.select({ assigned_to: tasks.assignedTo }).from(tasks)
          .where(eq(tasks.id, taskId)).get();
        if (!task || task.assigned_to !== payload.sub) return err('Access denied', 403);
      }

      const photos = await db.select(photoFields).from(taskPhotos)
        .where(eq(taskPhotos.taskId, taskId)).orderBy(asc(taskPhotos.createdAt));
      return ok(photos);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/task-photos
  if (path === '/api/task-photos' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const { task_id, type, url: photoUrl } = await req.json() as any;

      if (!task_id || !type || !photoUrl) return err('Missing task_id, type, or url');
      if (!['before', 'after'].includes(type)) return err('Type must be "before" or "after"');
      try {
        const parsed = new URL(String(photoUrl));
        if (parsed.protocol !== 'https:') return err('Photo URL must use HTTPS');
      } catch { return err('Invalid photo URL'); }

      // Verify staff owns this task (or admin)
      if (payload.role === 'staff') {
        const task = await db.select({ assigned_to: tasks.assignedTo }).from(tasks)
          .where(eq(tasks.id, task_id)).get();
        if (!task || task.assigned_to !== payload.sub) return err('Access denied', 403);
      }

      const photoId = uuid();
      await db.insert(taskPhotos).values({ id: photoId, taskId: task_id, type, url: photoUrl, uploadedBy: payload.sub });

      return ok({ id: photoId, task_id, type, url: photoUrl, uploaded_by: payload.sub });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

async function refreshCustomerStats(db: AppDb, customerId: string): Promise<void> {
  const stats = await db.select({
    total_bookings: count(),
    completed_bookings: sum(sql`CASE WHEN ${bookings.status} = 'completed' THEN 1 ELSE 0 END`),
    total_spent: sum(sql`CASE WHEN ${bookings.status} = 'completed' THEN ${bookings.amount} ELSE 0 END`),
    first_booking_date: min(bookings.bookingDate),
    last_booking_date: max(bookings.bookingDate)
  }).from(bookings).where(eq(bookings.customerId, customerId)).get();

  if (stats) {
    await db.update(customers).set({
      totalBookings: stats.total_bookings,
      completedBookings: Number(stats.completed_bookings || 0),
      totalSpent: Number(stats.total_spent || 0),
      firstBookingDate: stats.first_booking_date,
      lastBookingDate: stats.last_booking_date,
      updatedAt: nowISO()
    }).where(eq(customers.id, customerId));
  }
}
