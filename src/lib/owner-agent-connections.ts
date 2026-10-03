import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { ApiError } from "@/lib/http";

type OwnerIdentity = { userId: string; companyId: string };
export type OwnerConnectionIdentity = OwnerIdentity & { connectionId: string };
const metadataFields = "id,label,created_at,revoked_at";
export const ownerAgentConnectionInput = z
  .object({
    label: z.string().trim().min(1).max(120),
  })
  .strict();

function databaseError(error: unknown) {
  if (error)
    throw new ApiError(
      503,
      "Agent connections are temporarily unavailable.",
      "connection_unavailable",
    );
}
async function requireMembership(owner: OwnerIdentity) {
  const { data, error } = await admin()
    .from("company_members")
    .select("user_id")
    .eq("user_id", owner.userId)
    .eq("company_id", owner.companyId)
    .eq("role", "owner")
    .maybeSingle();
  databaseError(error);
  if (!data)
    throw new ApiError(
      403,
      "Owner membership is no longer active.",
      "forbidden",
    );
}

export async function listOwnerAgentConnections(owner: OwnerIdentity) {
  await requireMembership(owner);
  const { data, error } = await admin()
    .from("owner_agent_connections")
    .select(metadataFields)
    .eq("user_id", owner.userId)
    .eq("company_id", owner.companyId)
    .order("created_at", { ascending: false });
  databaseError(error);
  return { connections: data ?? [] };
}

export async function createOwnerAgentConnection(
  owner: OwnerIdentity,
  value: unknown,
) {
  const { label } = ownerAgentConnectionInput.parse(value);
  await requireMembership(owner);
  const token = "po_" + randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin()
    .from("owner_agent_connections")
    .insert({
      user_id: owner.userId,
      company_id: owner.companyId,
      label,
      token_hash: tokenHash,
    })
    .select(metadataFields)
    .single();
  databaseError(error);
  if (!data)
    throw new ApiError(
      503,
      "The connection could not be confirmed. Refresh before retrying.",
      "connection_unavailable",
    );
  // The raw credential is returned once and is never stored or logged.
  return { connection: data, token };
}

export async function authenticateOwnerAgentConnection(
  token: string,
): Promise<OwnerConnectionIdentity> {
  if (!/^po_[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError(401, "Invalid owner agent credential.", "unauthorized");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin()
    .from("owner_agent_connections")
    .select("id,user_id,company_id,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  databaseError(error);
  if (!data || data.revoked_at)
    throw new ApiError(
      401,
      "Owner agent access is invalid or revoked.",
      "unauthorized",
    );
  const owner = {
    userId: data.user_id as string,
    companyId: data.company_id as string,
  };
  await requireMembership(owner);
  return { ...owner, connectionId: data.id as string };
}

export async function recheckOwnerAgentConnection(
  owner: OwnerIdentity,
  connectionId: string,
) {
  const { data, error } = await admin()
    .from("owner_agent_connections")
    .select("id")
    .eq("id", z.uuid().parse(connectionId))
    .eq("user_id", owner.userId)
    .eq("company_id", owner.companyId)
    .is("revoked_at", null)
    .maybeSingle();
  databaseError(error);
  if (!data)
    throw new ApiError(
      403,
      "Owner agent access has been revoked.",
      "connection_revoked",
    );
}

export async function revokeOwnerAgentConnection(
  owner: OwnerIdentity,
  connectionId: string,
) {
  const id = z.uuid().parse(connectionId);
  await requireMembership(owner);
  const db = admin();
  const scoped = () =>
    db
      .from("owner_agent_connections")
      .select("id,revoked_at")
      .eq("id", id)
      .eq("user_id", owner.userId)
      .eq("company_id", owner.companyId)
      .maybeSingle();
  const current = await scoped();
  databaseError(current.error);
  if (!current.data)
    throw new ApiError(404, "Agent connection not found.", "not_found");
  if (!current.data.revoked_at) {
    const updated = await db
      .from("owner_agent_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", owner.userId)
      .eq("company_id", owner.companyId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    databaseError(updated.error);
    if (!updated.data) {
      const confirmed = await scoped();
      databaseError(confirmed.error);
      if (!confirmed.data?.revoked_at)
        throw new ApiError(
          503,
          "Revocation could not be confirmed. Please retry.",
          "connection_unavailable",
        );
    }
  }
  return { status: "revoked", connection_id: id };
}
