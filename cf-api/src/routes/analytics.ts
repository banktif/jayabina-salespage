import { eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { createDb, type AppDb } from '../db/client';
import { appSettings } from '../db/schema';
import { enqueue } from '../queue/events';

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}

// Track booking form abandonment
export async function handleAbandon(req: Request, env: Env): Promise<Response> {
  const db = createDb(env);

  // POST /api/analytics/abandon — track form start (step tracking)
  if (req.method === 'POST') {
    try {
      const body = await req.json() as any;
      const { customer_phone, step, data } = body;

      if (!customer_phone) return err('Missing customer_phone');

      // Store abandonment lead for recovery
      const leadId = uuid();
      const phone = String(customer_phone).replace(/\D/g, '');

      // Check if this phone already has a pending lead
      const existing = await db.get<{ id: string }>(sql`
        SELECT id FROM analytics_events
        WHERE event_type = 'abandon'
          AND json_extract(metadata, '$._phone') = ${phone}
          AND json_extract(metadata, '$._status') = 'pending'
        ORDER BY created_at DESC LIMIT 1
      `);

      if (existing) {
        await db.run(sql`
          UPDATE analytics_events SET
            metadata = json_set(metadata, '$._step', ${String(step)}, '$._data', ${JSON.stringify(data || {})}, '$._updated', ${nowISO()})
          WHERE id = ${existing.id}
        `);
      } else {
        await db.run(sql`
          INSERT INTO analytics_events (id, event_type, metadata, created_at)
          VALUES (${leadId}, 'abandon', ${JSON.stringify({ _phone: phone, _step: step, _data: data || {}, _status: 'pending', _created: nowISO() })}, datetime('now'))
        `);
      }

      return ok({ tracked: true });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

// Send abandoned booking follow-up (called via cron)
export async function sendAbandonFollowups(env: Env, db: AppDb): Promise<number> {
  let sent = 0;
  try {
    const rows = await db.all(sql`
      SELECT id, metadata FROM analytics_events
      WHERE event_type = 'abandon'
        AND json_extract(metadata, '$._status') = 'pending'
        AND created_at < datetime('now', '-30 minutes')
        AND created_at > datetime('now', '-90 minutes')
      LIMIT 20
    `) as any[];

    for (const row of (rows || [])) {
      try {
        const meta = JSON.parse(row.metadata || '{}');
        const phone = meta._phone;

        if (phone && env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
          let digits = String(phone).replace(/\D/g, '');
          if (digits.startsWith('0')) digits = '6' + digits;

          await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp', to: digits, type: 'text',
              text: { body: 'Hai! Nampak anda sedang semak slot cuci tangki di JAYABINA. Nak bantu teruskan tempahan? Taip *menu* atau lawati www.jayabina.com/servis-cuci-tangki-air/' }
            })
          });
        }

        await db.run(sql`
          UPDATE analytics_events SET metadata = json_set(metadata, '$._status', 'followed_up', '$._followed_at', ${nowISO()})
          WHERE id = ${row.id}
        `);
        sent++;
      } catch (e) { console.error('Abandon followup error:', e); }
    }
  } catch (e) { console.error('Abandon batch error:', e); }
  return sent;
}
