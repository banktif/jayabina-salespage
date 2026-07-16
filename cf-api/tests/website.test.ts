import { env, exports as workerExports } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, signJWT } from '../src/utils/helpers';
import { isEditableWebsitePath, WEBSITE_FILES } from '../src/routes/website';

const ADMIN_ID = '20000000-0000-4000-8000-000000000001';
const STAFF_ID = '20000000-0000-4000-8000-000000000002';
let adminToken = '';
let staffToken = '';

beforeAll(async () => {
  adminToken = await signJWT({ sub: ADMIN_ID, role: 'admin', name: 'Website Admin' }, env.JWT_SECRET);
  staffToken = await signJWT({ sub: STAFF_ID, role: 'staff', name: 'Website Staff' }, env.JWT_SECRET);
});

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const password = await hashPassword('TestPassword123!');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ADMIN_ID, 'Website Admin', '60110000011', 'admin', 1, 'website-admin@example.test', '', '', '', password, '2026-01-01T00:00:00.000Z'),
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(STAFF_ID, 'Website Staff', '60110000012', 'staff', 1, 'website-staff@example.test', '', '', '', password, '2026-01-01T00:00:00.000Z')
  ]);
});

async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await workerExports.default.fetch(new Request(`https://api.example.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() as any };
}

describe('Hugo website management', () => {
  it('uses a strict editable-file allowlist', () => {
    expect(WEBSITE_FILES.length).toBeGreaterThan(10);
    expect(isEditableWebsitePath('site/content/_index.md')).toBe(true);
    expect(isEditableWebsitePath('site/content/blog/artikel-baharu.md')).toBe(true);
    expect(isEditableWebsitePath('site/content/blog/Artikel.md')).toBe(false);
    expect(isEditableWebsitePath('../admin/index.html')).toBe(false);
    expect(isEditableWebsitePath('site/hugo.toml')).toBe(false);
  });

  it('requires an active admin account', async () => {
    expect((await call('/api/website/files')).status).toBe(401);
    expect((await call('/api/website/files', staffToken)).status).toBe(403);
    const admin = await call('/api/website/files', adminToken);
    expect(admin.status).toBe(200);
    expect(admin.body.data.repo).toBe('banktif/jayaclean-salespage');
    expect(admin.body.data.files).toHaveLength(WEBSITE_FILES.length);
  });

  it('fails safely when GitHub publishing is not configured', async () => {
    const missing = await call('/api/website/file?path=site%2Fcontent%2F_index.md', adminToken);
    expect(missing.status).toBe(503);
    const traversal = await call('/api/website/file', adminToken, 'PUT', { path: '../theme.css', content: 'x' });
    expect(traversal.status).toBe(400);
  });
});
