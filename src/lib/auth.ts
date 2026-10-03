import { createHash } from 'node:crypto';
import { admin } from './supabase-admin';
import { ApiError, assertDb } from './http';
import type { Bridge } from './types';
export function sha256(value: string | Buffer | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
export function bearer(request: Request) { const h = request.headers.get('authorization'); if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'A bearer token is required', 'unauthorized'); return h.slice(7).trim(); }
export async function requireOwner(request: Request) {
  const { data, error } = await admin().auth.getUser(bearer(request));
  if (error || !data.user) throw new ApiError(401, 'Please sign in again', 'unauthorized');
  const { data: member, error: memberError } = await admin().from('company_members').select('company_id').eq('user_id', data.user.id).single();
  if (memberError || !member) throw new ApiError(403, 'No company membership', 'forbidden');
  return { userId: data.user.id, companyId: member.company_id as string };
}
export interface AgentContext { tokenHash: string; actorCompanyId: string; targetCompanyId: string; bridge: Bridge; expiresAt: string }
export async function requireAgentToken(token: string): Promise<AgentContext> {
  if (!token || token.length > 256) throw new ApiError(401, 'Invalid agent token', 'unauthorized');
  const tokenHash = sha256(token);
  return agentFromHash(tokenHash);
}
export async function agentFromHash(tokenHash: string): Promise<AgentContext> {
  const { data: row, error } = await admin().from('agent_tokens').select('*').eq('token_hash', tokenHash).maybeSingle(); assertDb(error);
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw new ApiError(401, 'Agent token is expired or invalid', 'unauthorized');
  const { data: bridge, error: be } = await admin().from('bridges').select('*').eq('id', row.bridge_id).single(); assertDb(be);
  if (!bridge || bridge.status !== 'active' || Date.parse(bridge.expires_at) <= Date.now()) throw new ApiError(403, 'This bridge has been revoked or expired', 'bridge_revoked');
  if (![bridge.company_a_id, bridge.company_b_id].includes(row.actor_company_id)) throw new ApiError(403, 'Token outside bridge scope', 'forbidden');
  return { tokenHash, actorCompanyId: row.actor_company_id, targetCompanyId: bridge.company_a_id === row.actor_company_id ? bridge.company_b_id : bridge.company_a_id, bridge, expiresAt: row.expires_at };
}
export function requireAgent(request: Request) { return requireAgentToken(bearer(request)); }
