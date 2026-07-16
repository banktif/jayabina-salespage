import { eq } from 'drizzle-orm';
import type { JWTPayload, Env } from '../types';
import { verifyJWT, err } from './helpers';
import { createDb } from '../db/client';
import { profiles } from '../db/schema';

export async function requireAuth(req: Request, env: Env): Promise<JWTPayload> {
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    throw { status: 401, msg: 'Missing auth token' };
  }
  try {
    const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
    const profile = await createDb(env).select({
      full_name: profiles.fullName,
      role: profiles.role,
      is_active: profiles.isActive
    }).from(profiles).where(eq(profiles.id, payload.sub)).get();
    if (!profile || !profile.is_active) throw new Error('Account disabled or not found');
    return { ...payload, role: profile.role, name: profile.full_name };
  } catch (e: any) {
    throw { status: 401, msg: e.message || 'Invalid token' };
  }
}

export function requireAdmin(payload: JWTPayload) {
  if (payload.role !== 'admin') {
    throw { status: 403, msg: 'Admin only' };
  }
}

export function requireStaff(payload: JWTPayload) {
  if (payload.role !== 'staff' && payload.role !== 'admin') {
    throw { status: 403, msg: 'Staff only' };
  }
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-backup-key',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      }
    });
  }
  return null;
}

export function detectArea(address: string, areas: string): string | null {
  if (!areas) return null;
  const addrLower = address.toLowerCase();
  const areaList = areas.split(',').map(a => a.trim().toLowerCase());
  for (const area of areaList) {
    if (area && addrLower.includes(area)) return area;
  }
  return null;
}
