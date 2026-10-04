import { createHash } from "node:crypto";
import { admin } from "./supabase-admin";
import { ApiError, assertDb } from "./http";
import type { Bridge } from "./types";
import { verifiedSessionId } from "./email-otp";
export function sha256(value: string | Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
export function bearer(request: Request) {
  const h = request.headers.get("authorization");
  if (!h?.startsWith("Bearer "))
    throw new ApiError(401, "A bearer token is required", "unauthorized");
  return h.slice(7).trim();
}
export async function requireHumanSession(request: Request) {
  const token = bearer(request);
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "Please sign in again", "unauthorized");
  const sessionId = verifiedSessionId(token);
  const expiresAt = await recheckHumanSession(data.user.id, sessionId);
  return { user: data.user, expiresAt, sessionId };
}
export async function recheckHumanSession(userId: string, sessionId: string) {
  const { data: session, error: sessionError } = await admin()
    .from("human_sessions")
    .select("expires_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  assertDb(sessionError);
  if (!session || Date.parse(session.expires_at) <= Date.now())
    throw new ApiError(
      401,
      "Your 30-day session has ended. Request a new sign-in code.",
      "session_expired",
    );
  return session.expires_at as string;
}
export async function requireOwner(request: Request) {
  const { user, expiresAt, sessionId } = await requireHumanSession(request);
  const { data: member, error: memberError } = await admin()
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .single();
  if (memberError || !member)
    throw new ApiError(403, "No company membership", "forbidden");
  return {
    userId: user.id,
    companyId: member.company_id as string,
    humanExpiresAt: expiresAt,
    humanSessionId: sessionId,
  };
}
export interface AgentContext {
  tokenHash: string;
  actorCompanyId: string;
  targetCompanyId: string;
  bridge: Bridge;
  expiresAt: string;
}
export async function requireAgentToken(token: string): Promise<AgentContext> {
  if (!token || token.length > 256)
    throw new ApiError(401, "Invalid agent token", "unauthorized");
  const tokenHash = sha256(token);
  return agentFromHash(tokenHash);
}
export async function agentFromHash(tokenHash: string): Promise<AgentContext> {
  const { data: row, error } = await admin()
    .from("agent_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  assertDb(error);
  if (!row || Date.parse(row.expires_at) <= Date.now())
    throw new ApiError(
      401,
      "Agent token is expired or invalid",
      "unauthorized",
    );
  const { data: bridge, error: be } = await admin()
    .from("bridges")
    .select("*")
    .eq("id", row.bridge_id)
    .single();
  assertDb(be);
  if (
    !bridge ||
    bridge.status !== "active" ||
    Date.parse(bridge.expires_at) <= Date.now()
  )
    throw new ApiError(
      403,
      "This bridge has been revoked or expired",
      "bridge_revoked",
    );
  if (
    ![bridge.company_a_id, bridge.company_b_id].includes(row.actor_company_id)
  )
    throw new ApiError(403, "Token outside bridge scope", "forbidden");
  return {
    tokenHash,
    actorCompanyId: row.actor_company_id,
    targetCompanyId:
      bridge.company_a_id === row.actor_company_id
        ? bridge.company_b_id
        : bridge.company_a_id,
    bridge,
    expiresAt: row.expires_at,
  };
}
export function requireAgent(request: Request) {
  return requireAgentToken(bearer(request));
}
