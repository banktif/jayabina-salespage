import type { AppDb } from '../db/client';
import { sql } from 'drizzle-orm';

export async function checkRateLimit(
  db: AppDb,
  identifier: string,
  endpoint: string,
  maxPerHour: number = 10
): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();

  const row = await db.get<{ id: string; count: number }>(sql`
    SELECT id, count FROM rate_limits
    WHERE identifier = ${identifier} AND endpoint = ${endpoint} AND window_start = ${windowStart}
  `);

  if (!row) {
    await db.run(sql`
      INSERT INTO rate_limits (id, identifier, endpoint, count, window_start, created_at)
      VALUES (${crypto.randomUUID()}, ${identifier}, ${endpoint}, 1, ${windowStart}, datetime('now'))
    `);
    return { allowed: true, remaining: maxPerHour - 1 };
  }

  if (row.count >= maxPerHour) {
    return { allowed: false, remaining: 0 };
  }

  await db.run(sql`
    UPDATE rate_limits SET count = count + 1 WHERE id = ${row.id}
  `);

  return { allowed: true, remaining: maxPerHour - row.count - 1 };
}

export async function cleanupRateLimits(db: AppDb): Promise<number> {
  const r = await db.run(sql`
    DELETE FROM rate_limits WHERE window_start < datetime('now', '-2 hours')
  `);
  return r?.meta?.changes || 0;
}
