import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: {
      TEST_MIGRATIONS: migrations,
      JWT_SECRET: 'test-only-jwt-secret-not-for-production',
      BACKUP_SECRET: 'test-only-backup-secret',
      SITE_URL: 'https://example.test',
      BAYARCASH_PAYMENT_CHANNEL: '5'
    } }
  })],
  test: { include: ['tests/**/*.test.ts'] }
});

