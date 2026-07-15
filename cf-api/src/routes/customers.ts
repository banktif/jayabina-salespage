import type { Env } from '../types';
import { err, ok, uuid, nowISO, normPhone } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';

export async function handleCustomers(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/customers
  if (path === '/api/customers' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);

      const search = url.searchParams.get('search') || '';
      const status = url.searchParams.get('status') || '';
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const offset = (page - 1) * limit;
      const requestedOrder = url.searchParams.get('order') || 'last_booking_date';
      const safeOrder = ['last_booking_date', 'total_bookings', 'total_spent', 'name', 'created_at'];
      const order = safeOrder.includes(requestedOrder) ? requestedOrder : 'last_booking_date';
      const direction = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';

      let q = 'SELECT *, COUNT(*) OVER() as total_count FROM customers';
      const conds: string[] = [];
      const params: any[] = [];

      if (search) {
        conds.push('(name LIKE ? OR phone LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }
      if (status) { conds.push('status = ?'); params.push(status); }

      if (conds.length) q += ' WHERE ' + conds.join(' AND ');
      q += ` ORDER BY ${order} ${direction} NULLS LAST, created_at DESC`;
      q += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const result = await env.DB.prepare(q).bind(...params).all();
      const total = (result.results[0] as any)?.total_count || 0;
      return ok({ data: result.results, total, page, limit });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET /api/customers/:id
  const getMatch = path.match(/^\/api\/customers\/([a-f0-9-]+)$/);
  if (getMatch && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(getMatch[1]).first();
      return customer ? ok(customer) : err('Not found', 404);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // PATCH /api/customers/:id
  if (getMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const body = await req.json() as any;
      const customerId = getMatch[1];

      const sets: string[] = ['updated_at = ?'];
      const params: any[] = [nowISO()];

      if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
      if (body.email !== undefined) { sets.push('email = ?'); params.push(body.email); }
      if (body.address !== undefined) { sets.push('address = ?'); params.push(body.address); }
      if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
      if (body.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(body.tags)); }
      if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }

      params.push(customerId);
      await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
      const updated = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // DELETE /api/customers/:id
  if (getMatch && req.method === 'DELETE') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(getMatch[1]).run();
      return ok({ deleted: true });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}
