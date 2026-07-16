import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  html: await readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  builtHtml: await readFile(new URL('../admin-public/index.html', import.meta.url), 'utf8'),
  theme: await readFile(new URL('../theme.css', import.meta.url), 'utf8'),
  builtTheme: await readFile(new URL('../admin-public/theme.css', import.meta.url), 'utf8'),
  modern: await readFile(new URL('../admin-modern.css', import.meta.url), 'utf8'),
  builtModern: await readFile(new URL('../admin-public/admin-modern.css', import.meta.url), 'utf8')
};

assert.equal(files.builtHtml, files.html, 'admin-public/index.html must match admin/index.html');
assert.equal(files.builtTheme, files.theme, 'built theme.css must match the source');
assert.equal(files.builtModern, files.modern, 'built admin-modern.css must match the source');

for (const token of [
  '--surface-hover:', '--canvas-glow:', '--nav-glass:', '--header-fade:', '--login-card:', '--login-card-border:',
  '--card-bg:', '--card-muted:', '--card-border:', '--card-border-hover:', '--card-shadow:', '--card-shadow-hover:', '--card-radius:'
]) {
  assert.ok(files.theme.includes(token), `missing shared theme token ${token}`);
}

assert.ok(files.theme.includes('html.light{color-scheme:light}'), 'light native controls must use light color-scheme');
assert.ok(files.theme.includes('html.dark{color-scheme:dark}'), 'dark native controls must use dark color-scheme');
assert.ok(files.html.includes('class="login-theme"'), 'login screen must expose a theme toggle');
assert.ok(files.html.includes("theme=h.classList.contains('dark')?'light':'dark'"), 'theme toggle must be a deterministic light/dark switch');
assert.ok(!files.html.includes("?'dark':h.classList.contains('dark')?'system'"), 'legacy three-state toggle must not return');

for (const forbidden of [
  'color:#111827',
  'background:#f8faf9',
  'var(--jb-canvas)',
  'var(--jb-border)',
  'html.dark .admin-app .hdr',
  'html.dark .admin-app .bnav',
  'html.dark .admin-app .d-hdr'
]) {
  assert.ok(!files.modern.includes(forbidden), `hard-coded theme override found: ${forbidden}`);
}

for (const required of [
  'color:var(--text)',
  'border-color:var(--border)',
  'background:var(--surface)',
  'background:var(--nav-glass)!important',
  'background:var(--login-card)'
]) {
  assert.ok(files.modern.includes(required), `missing semantic color usage: ${required}`);
}

for (const cardSelector of [
  '.admin-app .stat', '.admin-app .card', '.admin-app .d-card', '.admin-app .cal-wrap',
  '.admin-app .tk-card', '.admin-app .sGrp', '.admin-app .kpi', '.admin-app .panel',
  '.admin-app .bk-card', '.admin-app .cust-row', '.admin-app .m-sheet'
]) {
  assert.ok(files.modern.includes(cardSelector), `card system must cover ${cardSelector}`);
}

for (const cardRule of [
  'background:var(--card-bg)',
  'border:1px solid var(--card-border)',
  'border-radius:var(--card-radius)',
  'box-shadow:var(--card-shadow)',
  'box-shadow:var(--card-shadow-hover)',
  'background:var(--card-muted)'
]) {
  assert.ok(files.modern.includes(cardRule), `missing unified card rule ${cardRule}`);
}

assert.ok(files.html.includes('?v=20260716-cards1'), 'admin must cache-bust the unified card release');

console.log('Admin theme contract: PASS');
