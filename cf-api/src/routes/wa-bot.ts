import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { createDb, type AppDb } from '../db/client';
import { appSettings, bookings, slots, waConversations } from '../db/schema';

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}

export async function handleWAWebhook(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  if (path === '/api/wa/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === (env.WA_WEBHOOK_VERIFY_TOKEN || 'jayabina')) {
      return new Response(challenge || '', { status: 200 });
    }
    return err('Verification failed', 403);
  }

  if (path === '/api/wa/webhook' && req.method === 'POST') {
    try {
      const body = await req.json() as any;
      if (body.object !== 'whatsapp_business_account') return ok({ received: false });

      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field !== 'messages') continue;
          const messages = change.value?.messages || [];
          const contacts = change.value?.contacts || [];
          const metadata = change.value?.metadata || {};

          for (const msg of messages) {
            if (msg.type === 'text') {
              await handleTextMessage(db, env, msg.from, msg.text.body);
            } else if (msg.type === 'button') {
              await handleButtonReply(db, env, msg.from, msg.button.text || msg.button.payload, msg.context?.id);
            } else if (msg.type === 'interactive') {
              const interactive = msg.interactive;
              if (interactive?.button_reply) {
                await handleButtonReply(db, env, msg.from, interactive.button_reply.id || interactive.button_reply.title, msg.context?.id);
              } else if (interactive?.list_reply) {
                await handleButtonReply(db, env, msg.from, interactive.list_reply.id, msg.context?.id);
              }
            }
          }
        }
      }
      return ok({ received: true });
    } catch (e: any) {
      console.error('WA webhook error:', e);
      return err(e.msg || 'Error', 500);
    }
  }

  return err('Not found', 404);
}

async function handleTextMessage(db: AppDb, env: Env, from: string, text: string) {
  const lower = text.toLowerCase().trim();

  if (lower === 'menu' || lower === 'help' || lower === 'bantuan') {
    await sendWAMessage(env, from, 'Selamat datang ke JAYABINA! Pilih servis:\n\n1. Cuci Tangki Air\n2. Tukar Atap\n3. Cat Rumah\n\nTaip nombor untuk mula.');
    return;
  }

  if (lower === '1' || lower.includes('cuci') || lower.includes('tangki')) {
    await startConversation(db, from, 'cuci_tangki');
    await sendWAMessage(env, from, 'Anda pilih: Cuci Tangki Air (RM300). Pilih kawasan anda:');
    await sendAreaButtons(env, db, from);
    return;
  }

  if (lower === '2' || lower.includes('atap') || lower.includes('bumbung') || lower.includes('roof')) {
    await startConversation(db, from, 'tukar_atap');
    await sendWAMessage(env, from, 'Anda pilih: Servis Tukar Atap. Sila taip nama penuh anda:');
    return;
  }

  if (lower === '3' || lower.includes('cat')) {
    await startConversation(db, from, 'cat_rumah');
    await sendWAMessage(env, from, 'Anda pilih: Servis Cat Rumah. Sila taip nama penuh anda:');
    return;
  }

  const conv = await db.select().from(waConversations)
    .where(and(eq(waConversations.waPhone, from), eq(waConversations.status, 'active'))).get();

  if (!conv) {
    await sendWAMessage(env, from, 'Taip *menu* untuk mula tempahan.');
    return;
  }

  const ctx = safeParse(conv.context);
  const state = conv.state;

  if (state === 'awaiting_name') {
    ctx.name = text;
    await advanceConversation(db, conv.id, 'awaiting_phone', ctx);
    await sendWAMessage(env, from, `Terima kasih ${text}. Sila beri nombor telefon anda:`);
  } else if (state === 'awaiting_phone') {
    ctx.phone = text.replace(/\D/g, '');
    await advanceConversation(db, conv.id, 'awaiting_address', ctx);
    await sendWAMessage(env, from, 'Sila beri alamat penuh anda:');
  } else if (state === 'awaiting_address') {
    ctx.address = text;
    await advanceConversation(db, conv.id, 'awaiting_email', ctx);
    await sendWAMessage(env, from, 'Sila beri email anda (taip *skip* jika tiada):');
  } else if (state === 'awaiting_email') {
    ctx.email = text === 'skip' ? '' : text;
    await sendBookingSummary(db, env, from, conv.id, ctx);
  } else {
    await sendWAMessage(env, from, 'Taip *menu* untuk lihat pilihan.');
  }
}

async function handleButtonReply(db: AppDb, env: Env, from: string, buttonId: string, contextMsgId?: string) {
  const conv = await db.select().from(waConversations)
    .where(and(eq(waConversations.waPhone, from), eq(waConversations.status, 'active'))).get();

  if (!conv || conv.state !== 'awaiting_area') return;

  await sendWAMessage(env, from, `Kawasan dipilih. Sila taip nama penuh anda:`);
  const ctx = safeParse(conv.context);
  ctx.zone = buttonId;
  await advanceConversation(db, conv.id, 'awaiting_name', ctx);
}

async function startConversation(db: AppDb, from: string, service: string) {
  await db.update(waConversations).set({ status: 'abandoned', updatedAt: nowISO() })
    .where(and(eq(waConversations.waPhone, from), eq(waConversations.status, 'active')));

  await db.insert(waConversations).values({
    id: uuid(),
    waPhone: from,
    state: 'awaiting_area',
    context: JSON.stringify({ service, created_at: nowISO() }),
    status: 'active',
    createdAt: nowISO(),
    updatedAt: nowISO()
  });
}

async function advanceConversation(db: AppDb, convId: string, state: string, ctx: Record<string, any>) {
  await db.update(waConversations).set({
    state,
    context: JSON.stringify(ctx),
    updatedAt: nowISO()
  }).where(eq(waConversations.id, convId));
}

async function sendBookingSummary(db: AppDb, env: Env, from: string, convId: string, ctx: Record<string, any>) {
  const priceTotal = parseFloat(await getSetting(db, 'price_total') || '300');
  const priceDeposit = parseFloat(await getSetting(db, 'price_deposit') || '150');
  const today = new Date().toISOString().split('T')[0];
  const slotsStr = await getSetting(db, 'booking_time_slots') || await getSetting(db, 'slots') || '9am,11am,2pm,4pm';
  const firstSlot = slotsStr.split(',')[0].trim();

  await sendWAMessage(env, from,
    `Ringkasan tempahan:\n\n` +
    `Servis: ${ctx.service === 'cuci_tangki' ? 'Cuci Tangki Air' : ctx.service}\n` +
    `Nama: ${ctx.name}\n` +
    `Phone: ${ctx.phone}\n` +
    `Alamat: ${ctx.address}\n` +
    `Kawasan: ${ctx.zone || '-'}\n` +
    `Tarikh: ${today}\n` +
    `Deposit: RM${priceDeposit}\n\n` +
    `Taip *ya* untuk sahkan atau *batal*.`
  );

  await advanceConversation(db, convId, 'awaiting_confirm', ctx);
}

async function sendAreaButtons(env: Env, db: AppDb, from: string) {
  try {
    const areaList = await db.all(sql`SELECT id, name FROM zones WHERE is_active = 1 ORDER BY display_order LIMIT 10`);
    const rows = (areaList || []) as any[];

    if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
      let digits = String(from).replace(/\D/g, '');
      if (digits.startsWith('0')) digits = '6' + digits;

      const buttons = rows.slice(0, 3).map((r: any) => ({
        type: 'reply' as const,
        reply: { id: r.id, title: r.name.substring(0, 20) }
      }));

      await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: digits,
          type: 'interactive',
          interactive: { type: 'button', body: { text: 'Pilih kawasan anda:' }, action: { buttons } }
        })
      });
    } else {
      const list = rows.map((r: any) => r.name).join(', ');
      await sendWAMessage(env, from, `Pilih kawasan: ${list}\n\nSila taip nama kawasan anda.`);
    }
  } catch (e) { console.error('sendAreaButtons error:', e); }
}

async function sendWAMessage(env: Env, to: string, text: string): Promise<boolean> {
  try {
    let digits = String(to).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '6' + digits;

    if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
      const r = await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: text } })
      });
      return r.ok;
    }
    return false;
  } catch { return false; }
}

function safeParse(raw: any): Record<string, any> {
  try { return JSON.parse(typeof raw === 'string' ? raw : '{}'); } catch { return {}; }
}
