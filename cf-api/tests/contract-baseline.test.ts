import { env, exports as workerExports } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, signJWT } from '../src/utils/helpers';

const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const STAFF_ID = '10000000-0000-4000-8000-000000000002';
const MISSING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TEST_PASSWORD = 'TestPassword123!';
let passwordHash = '';
let adminToken = '';
let staffToken = '';

beforeAll(async () => {
  passwordHash = await hashPassword(TEST_PASSWORD);
  adminToken = await signJWT({ sub: ADMIN_ID, role: 'admin', name: 'Contract Admin' }, env.JWT_SECRET);
  staffToken = await signJWT({ sub: STAFF_ID, role: 'staff', name: 'Contract Staff' }, env.JWT_SECRET);
});

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ADMIN_ID, 'Contract Admin', '60110000001', 'admin', 1, 'admin@example.test', '', '', '', passwordHash, '2026-01-01T00:00:00.000Z'),
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(STAFF_ID, 'Contract Staff', '60110000002', 'staff', 1, 'staff@example.test', '', '', 'Klang', passwordHash, '2026-01-02T00:00:00.000Z')
  ]);
});

type CallOptions = { method?: string; token?: string; body?: unknown };

async function call(path: string, options: CallOptions = {}) {
  const headers = new Headers();
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await workerExports.default.fetch(new Request(`https://api.example.test${path}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
  const raw = await response.text();
  let body: unknown = null;
  if (raw) { try { body = normalize(JSON.parse(raw)); } catch { body = raw; } }
  return {
    status: response.status,
    headers: {
      contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'),
      cors: response.headers.get('access-control-allow-origin'), noSniff: response.headers.get('x-content-type-options'),
      referrerPolicy: response.headers.get('referrer-policy')
    }, body
  };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key === 'token') return [key, '<jwt>'];
      if (key === 'size' && typeof item === 'number') return [key, '<bytes>'];
      return [key, normalize(item)];
    }));
  }
  if (typeof value !== 'string') return value;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(value)) return '<uuid>';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return '<iso-timestamp>';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return '<db-timestamp>';
  if (/^db-backup-.*\.json\.gz$/.test(value)) return '<backup-file>';
  if (value.includes('/api/backup/download?')) return value
    .replace(/db-backup-[^&]+?\.json\.gz/, '<backup-file>')
    .replace(/expires=\d+/, 'expires=<unix>')
    .replace(/sig=[a-f0-9]+/, 'sig=<signature>');
  return value;
}

describe('legacy Worker behavior snapshot', () => {
  it('freezes every route group before Hono and Drizzle routing changes', async () => {
    const baseline = {
      core: {
        options: await call('/api/bookings', { method: 'OPTIONS' }), health: await call('/api/health'), notFound: await call('/api/does-not-exist')
      },
      auth: {
        invalidLogin: await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.test', password: 'wrong' } }),
        validLogin: await call('/api/auth/login', { method: 'POST', body: { email: 'ADMIN@example.test', password: TEST_PASSWORD } }), me: await call('/api/auth/me', { token: adminToken }),
        changeValidation: await call('/api/auth/change-password', { method: 'POST', token: adminToken, body: { current_password: TEST_PASSWORD, new_password: 'short' } }),
        resetValidation: await call('/api/auth/reset-password', { method: 'POST', token: adminToken, body: { user_id: STAFF_ID, new_password: 'short' } })
      },
      settingsSlots: {
        publicSettings: await call('/api/settings/public'), settingsUnauthorized: await call('/api/settings'), settings: await call('/api/settings', { token: adminToken }),
        privateSettings: await call('/api/settings/private', { token: adminToken }), settingsValidation: await call('/api/settings', { method: 'PUT', token: adminToken, body: { rows: 'invalid' } }),
        availableMissingDate: await call('/api/slots/available'), checkMissingDate: await call('/api/slots/check')
      },
      bookingsPayments: {
        bookings: await call('/api/bookings', { token: adminToken }), publicMissing: await call('/api/bookings/public'), createValidation: await call('/api/bookings', { method: 'POST', body: {} }),
        patchMissing: await call(`/api/bookings/${MISSING_ID}`, { method: 'PATCH', token: adminToken, body: { status: 'confirmed' } }), intentValidation: await call('/api/payments/create-intent', { method: 'POST', body: {} }),
        balanceUnauthorized: await call('/api/payments/create-balance-intent', { method: 'POST', body: { booking_id: MISSING_ID } }), callbackValidation: await call('/api/payments/bayarcash-callback', { method: 'POST', body: {} })
      },
      tasksPhotos: {
        tasksUnauthorized: await call('/api/tasks'), tasks: await call('/api/tasks', { token: adminToken }), patchMissing: await call(`/api/tasks/${MISSING_ID}`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } }),
        distribute: await call('/api/tasks/distribute', { method: 'POST', token: adminToken, body: {} }), photosMissingTask: await call('/api/task-photos', { token: adminToken }),
        photoValidation: await call('/api/task-photos', { method: 'POST', token: staffToken, body: {} })
      },
      profilesCustomersWhatsapp: {
        profiles: await call('/api/profiles', { token: adminToken }), profileValidation: await call('/api/profiles', { method: 'POST', token: adminToken, body: {} }),
        profilePatchMissing: await call(`/api/profiles/${MISSING_ID}`, { method: 'PATCH', token: adminToken, body: { full_name: 'Missing' } }), bulkValidation: await call('/api/profiles/bulk', { method: 'POST', token: adminToken, body: {} }),
        customers: await call('/api/customers', { token: adminToken }), customerMissing: await call(`/api/customers/${MISSING_ID}`, { token: adminToken }),
        whatsappValidation: await call('/api/whatsapp/send', { method: 'POST', token: adminToken, body: {} })
      },
      backup: {
        status: await call('/api/backup/status', { token: adminToken }), emptyList: await call('/api/backup/list', { token: adminToken }), r2Test: await call('/api/backup/test_r2', { method: 'POST', token: adminToken, body: {} }),
        driveTest: await call('/api/backup/test_drive', { method: 'POST', token: adminToken, body: {} }), invalidDownload: await call('/api/backup/download?key=db%2Fmissing.gz&expires=0&sig=nope'),
        codeUnavailable: await call('/api/backup/code', { method: 'POST', token: adminToken, body: {} }), publishUnavailable: await call('/api/backup/publish-home', { method: 'POST', token: adminToken, body: { version: 'v4' } }),
        databaseBackup: await call('/api/backup/db', { method: 'POST', token: adminToken, body: { force: true } }), populatedList: await call('/api/backup/list', { token: adminToken })
      }
    };
    expect(baseline).toMatchSnapshot();
  });
});

