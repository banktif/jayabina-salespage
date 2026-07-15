import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { getSetting } from '../utils/middleware';

export async function handleSlots(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/slots/available?date=
  if (path === '/api/slots/available' && req.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date) return err('Missing date parameter');

    const slotsStr = await getSetting(env.DB, 'slots') || '9am,11am,2pm,4pm';
    const maxSlotsPerDay = parseInt(await getSetting(env.DB, 'max_slots_per_day') || '4');
    const slotList = slotsStr.split(',').map(s => s.trim());

    const booked = await env.DB.prepare('SELECT time_slot FROM slots WHERE date = ? AND is_booked = 1')
      .bind(date).all<{time_slot: string}>();
    const bookedSet = new Set((booked.results || []).map(r => r.time_slot));
    const bookedCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM slots WHERE date = ? AND is_booked = 1')
      .bind(date).first<{cnt: number}>();
    const dayAvailable = (bookedCount?.cnt || 0) < maxSlotsPerDay;

    const result = slotList.map(s => ({ time_slot: s, available: dayAvailable && !bookedSet.has(s) }));

    return ok(result);
  }

  // GET /api/slots/check?date=
  if (path === '/api/slots/check' && req.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date) return err('Missing date parameter');

    const maxSlotsPerDay = parseInt(await getSetting(env.DB, 'max_slots_per_day') || '4');
    const bookedCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM slots WHERE date = ? AND is_booked = 1')
      .bind(date).first<{cnt: number}>();
    const available = (bookedCount?.cnt || 0) < maxSlotsPerDay;

    return ok({ available });
  }

  return err('Not found', 404);
}
