import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { requireAdmin, requireAuth } from '../utils/middleware';

const REPO = 'banktif/jayaclean-salespage';
const BRANCH = 'master';
const API_ROOT = `https://api.github.com/repos/${REPO}`;
const MAX_CONTENT_BYTES = 500_000;

export type WebsiteFile = {
  path: string;
  label: string;
  group: 'Content' | 'Business data' | 'Advanced templates';
  mode: 'markdown' | 'yaml' | 'html';
};

export const WEBSITE_FILES: WebsiteFile[] = [
  { path: 'site/content/_index.md', label: 'Homepage SEO', group: 'Content', mode: 'markdown' },
  { path: 'site/content/tentang-kami/index.md', label: 'About us', group: 'Content', mode: 'markdown' },
  { path: 'site/content/hubungi-kami/index.md', label: 'Contact us', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/tukar-atap/index.md', label: 'Roof service metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/cuci-tangki-air/index.md', label: 'Tank cleaning metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/mengecat/index.md', label: 'Painting service metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/dasar-privasi/index.md', label: 'Privacy policy', group: 'Content', mode: 'markdown' },
  { path: 'site/content/terma-perkhidmatan/index.md', label: 'Terms of service', group: 'Content', mode: 'markdown' },
  { path: 'site/data/business.yaml', label: 'Company details', group: 'Business data', mode: 'yaml' },
  { path: 'site/data/services.yaml', label: 'Homepage service cards', group: 'Business data', mode: 'yaml' },
  { path: 'site/layouts/index.html', label: 'Homepage layout', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-roof.html', label: 'Roof sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-tank.html', label: 'Tank sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-paint.html', label: 'Painting sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/header.html', label: 'Website header', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/footer.html', label: 'Website footer', group: 'Advanced templates', mode: 'html' }
];

export function isEditableWebsitePath(path: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  if (WEBSITE_FILES.some(file => file.path === path)) return true;
  return /^site\/content\/blog\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(path);
}

export async function handleWebsite(req: Request, env: Env, path: string): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    requireAdmin(payload);
  } catch (e: any) {
    return err(e.msg || 'Unauthorized', e.status || 401);
  }

  if (path === '/api/website/files' && req.method === 'GET') {
    const files = [...WEBSITE_FILES];
    let warning = '';
    if (env.GH_PAT) {
      try {
        const response = await github(`/contents/site/content/blog?ref=${BRANCH}`, env.GH_PAT);
        const data: any = await response.json();
        if (response.ok && Array.isArray(data)) {
          for (const item of data) {
            if (item.type !== 'file' || item.name === '_index.md' || !/^[a-z0-9][a-z0-9-]{0,79}\.md$/.test(item.name)) continue;
            files.splice(8, 0, {
              path: `site/content/blog/${item.name}`,
              label: item.name.replace(/\.md$/, '').split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
              group: 'Content', mode: 'markdown'
            });
          }
        } else warning = 'Article list could not be loaded';
      } catch {
        warning = 'Article list could not be loaded';
      }
    }
    return ok({
      repo: REPO,
      branch: BRANCH,
      live_url: 'https://www.jayabina.com',
      pages_project: 'jayabina',
      connected: Boolean(env.GH_PAT),
      warning,
      files
    });
  }

  if (path === '/api/website/file' && req.method === 'GET') {
    const filePath = new URL(req.url).searchParams.get('path') || '';
    if (!isEditableWebsitePath(filePath)) return err('This Hugo file is not editable from Admin', 400);
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const response = await github(`/contents/${encodePath(filePath)}?ref=${BRANCH}`, env.GH_PAT);
    const data: any = await response.json();
    if (!response.ok || !data.content || !data.sha) return githubError(data, response.status, 'Unable to load Hugo file');
    return ok({ path: filePath, content: decodeBase64(data.content), sha: data.sha, size: data.size || 0, html_url: data.html_url || '' });
  }

  if (path === '/api/website/file' && req.method === 'PUT') {
    const body = await safeJson(req);
    const filePath = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const sha = typeof body.sha === 'string' ? body.sha : '';
    if (!isEditableWebsitePath(filePath)) return err('This Hugo file is not editable from Admin', 400);
    if (!content.trim()) return err('Content cannot be empty', 400);
    if (new TextEncoder().encode(content).byteLength > MAX_CONTENT_BYTES) return err('Content is too large', 413);
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);

    const payload: Record<string, string> = {
      message: `Update ${filePath.replace(/^site\//, '')} via JAYABINA Admin`,
      content: encodeBase64(content),
      branch: BRANCH
    };
    if (sha) payload.sha = sha;
    const response = await github(`/contents/${encodePath(filePath)}`, env.GH_PAT, { method: 'PUT', body: JSON.stringify(payload) });
    const data: any = await response.json();
    if (!response.ok || !data.commit) return githubError(data, response.status, 'Unable to save Hugo file');
    return ok({
      path: filePath,
      sha: data.content?.sha || '',
      commit_sha: data.commit.sha || '',
      commit_url: data.commit.html_url || '',
      deployment: 'GitHub Actions started automatically'
    });
  }

  if (path === '/api/website/publish' && req.method === 'POST') {
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const response = await github('/actions/workflows/deploy-cloudflare-pages.yml/dispatches', env.GH_PAT, {
      method: 'POST', body: JSON.stringify({ ref: BRANCH })
    });
    if (!response.ok) {
      const data: any = await response.json().catch(() => ({}));
      return githubError(data, response.status, 'Unable to start website deployment');
    }
    return ok({ deployment: 'started', live_url: 'https://www.jayabina.com' });
  }

  return err('Not found', 404);
}

function github(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'JAYABINA-Admin',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {})
    }
  });
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function githubError(data: any, status: number, fallback: string): Response {
  const code = status === 409 || status === 422 ? 409 : status === 404 ? 404 : 502;
  return err(typeof data?.message === 'string' ? data.message : fallback, code);
}
