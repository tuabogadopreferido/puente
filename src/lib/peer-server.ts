import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { admin } from "./supabase-admin";
import { agentFromHash, sha256, type AgentContext } from "./auth";
import { ApiError, assertDb } from "./http";
import {
  recheckOwnerAgentContext,
  type OwnerAgentContext,
} from "./owner-agent";
import { documentTypes, normalizeSensitivity } from "./document-policy";
import { PEER_MAX_BYTES, type PeerTransfer } from "./peer-types";
import type { PuenteDocument } from "./types";
import { assertRequestSharing } from "./document-sharing";

export const sourceRegistration = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1).max(100),
  })
  .strict();
export const peerDocumentRegistration = z
  .object({
    source_id: z.uuid(),
    source_key: z.uuid(),
    title: z.string().trim().min(1).max(255),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size_bytes: z.number().int().min(1).max(PEER_MAX_BYTES),
    document_type: z.enum(documentTypes).default("other"),
    sensitive: z.boolean().default(true),
    expires_at: z.iso
      .date()
      .refine((v) => v >= "0001-01-01")
      .nullable()
      .default(null),
  })
  .strict();
const sdp = (type: "offer" | "answer") =>
  z
    .object({ type: z.literal(type), sdp: z.string().min(1).max(30000) })
    .strict();
export const peerSignal = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), offer: sdp("offer") }).strict(),
  z
    .object({
      action: z.literal("complete"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);
export const sourceSignal = z
  .object({ transfer_id: z.uuid(), answer: sdp("answer") })
  .strict();
type Source = {
  id: string;
  company_id: string;
  user_id: string;
  owner_connection_id: string | null;
  human_session_id: string | null;
  online_until: string;
};
type Transfer = {
  id: string;
  secret_hash: string;
  document_id: string;
  source_id: string;
  company_id: string;
  receipt_id: string;
  bridge_token_hash: string | null;
  owner_user_id: string | null;
  owner_connection_id: string | null;
  owner_expires_at: string | null;
  owner_session_id: string | null;
  expected_sha256: string;
  offer: { type: "offer"; sdp: string } | null;
  answer: { type: "answer"; sdp: string } | null;
  status: string;
  expires_at: string;
};
async function sourceForOwner(
  owner: OwnerAgentContext,
  id: string,
): Promise<Source> {
  await recheckOwnerAgentContext(owner);
  const { data, error } = await admin()
    .from("document_sources")
    .select("*")
    .eq("id", id)
    .eq("company_id", owner.companyId)
    .eq("user_id", owner.userId)
    .maybeSingle();
  assertDb(error);
  if (
    !data ||
    (data.owner_connection_id &&
      data.owner_connection_id !== owner.connectionId)
  )
    throw new ApiError(
      404,
      "Source unavailable to this connection",
      "source_unavailable",
    );
  return data as Source;
}
export async function registerPeerSource(
  owner: OwnerAgentContext,
  value: unknown,
) {
  const input = sourceRegistration.parse(value);
  await recheckOwnerAgentContext(owner);
  if (input.id) {
    await sourceForOwner(owner, input.id);
    const { error } = await admin()
      .from("document_sources")
      .update({
        label: input.label,
        online_until: new Date(Date.now() + 45000).toISOString(),
      })
      .eq("id", input.id);
    assertDb(error);
    return { id: input.id };
  }
  const id = randomUUID();
  const { error } = await admin()
    .from("document_sources")
    .insert({
      id,
      company_id: owner.companyId,
      user_id: owner.userId,
      owner_connection_id: owner.connectionId ?? null,
      human_session_id: owner.humanSessionId ?? null,
      label: input.label,
      online_until: new Date(Date.now() + 45000).toISOString(),
    });
  assertDb(error);
  return { id };
}
export async function registerPeerDocument(
  owner: OwnerAgentContext,
  value: unknown,
) {
  const input = peerDocumentRegistration.parse(value);
  await sourceForOwner(owner, input.source_id);
  const { data: prior, error: pe } = await admin()
    .from("documents")
    .select("id,sha256,size_bytes")
    .eq("source_id", input.source_id)
    .eq("source_key", input.source_key)
    .maybeSingle();
  assertDb(pe);
  // A changed file is a new catalog version: previous approvals never authorize new bytes.
  if (
    prior &&
    (prior.sha256 !== input.sha256 || prior.size_bytes !== input.size_bytes)
  )
    throw new ApiError(
      409,
      "File changed. Register it with a new source key before sharing.",
      "source_changed",
    );
  if (prior) return { id: prior.id, title: input.title };
  const { data: existing, error: ee } = await admin()
    .from("documents")
    .select("id,title,size_bytes")
    .eq("company_id", owner.companyId)
    .eq("sha256", input.sha256)
    .limit(1)
    .maybeSingle();
  assertDb(ee);
  if (existing && existing.size_bytes === input.size_bytes) {
    await recheckOwnerAgentContext(owner);
    const { error } = await admin()
      .from("documents")
      .update({ source_id: input.source_id, source_key: input.source_key })
      .eq("id", existing.id)
      .eq("company_id", owner.companyId);
    assertDb(error);
    return { id: existing.id, title: existing.title };
  }
  await recheckOwnerAgentContext(owner);
  const { data, error } = await admin()
    .from("documents")
    .insert({
      ...input,
      company_id: owner.companyId,
      sensitive: normalizeSensitivity(input.document_type, input.sensitive),
      storage_path: null,
      extracted_text: "",
      classification_source: "owner_reviewed",
    })
    .select("id,title")
    .single();
  assertDb(error);
  return data;
}
async function readTransfer(id: string): Promise<Transfer> {
  const { data, error } = await admin()
    .from("peer_transfers")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .maybeSingle();
  assertDb(error);
  if (!data)
    throw new ApiError(404, "Transfer unavailable", "transfer_unavailable");
  return data as Transfer;
}
async function assertActive(t: Transfer) {
  if (Date.parse(t.expires_at) <= Date.now() || t.status === "cancelled")
    throw new ApiError(
      410,
      "Transfer expired or cancelled",
      "transfer_expired",
    );
  if (t.bridge_token_hash) {
    const ctx = await agentFromHash(t.bridge_token_hash);
    if (ctx.targetCompanyId !== t.company_id)
      throw new ApiError(403, "Transfer outside bridge");
    const { data: receipt, error: receiptError } = await admin()
      .from("receipts")
      .select("payload")
      .eq("id", t.receipt_id)
      .eq("company_id", ctx.targetCompanyId)
      .eq("receiver_company_id", ctx.actorCompanyId)
      .maybeSingle();
    assertDb(receiptError);
    if (
      !receipt?.payload?.request_id ||
      receipt.payload.bridge_id !== ctx.bridge.id ||
      receipt.payload.document_id !== t.document_id
    )
      throw new ApiError(403, "Transfer receipt is outside this bridge");
    const { data: request, error: requestError } = await admin()
      .from("requests")
      .select("*")
      .eq("id", receipt.payload.request_id)
      .eq("bridge_id", ctx.bridge.id)
      .eq("document_id", t.document_id)
      .eq("owner_company_id", ctx.targetCompanyId)
      .eq("requester_company_id", ctx.actorCompanyId)
      .maybeSingle();
    assertDb(requestError);
    if (!request || request.status !== "approved")
      throw new ApiError(403, "This document request is no longer approved");
    await assertRequestSharing(request);
  } else {
    await recheckOwnerAgentContext({
      kind: "owner",
      userId: t.owner_user_id!,
      companyId: t.company_id,
      expiresAt: t.owner_expires_at ? Date.parse(t.owner_expires_at) : Infinity,
      humanSessionId: t.owner_session_id ?? undefined,
      ...(t.owner_connection_id ? { connectionId: t.owner_connection_id } : {}),
    });
  }
  const { data: source, error: se } = await admin()
    .from("document_sources")
    .select("*")
    .eq("id", t.source_id)
    .eq("company_id", t.company_id)
    .maybeSingle();
  assertDb(se);
  if (!source) throw new ApiError(410, "Source removed", "source_unavailable");
  // The serving agent's permanent connection and the receiver bridge are independent.
  await recheckOwnerAgentContext({
    kind: "owner",
    userId: source.user_id,
    companyId: source.company_id,
    expiresAt: Infinity,
    humanSessionId: source.human_session_id ?? undefined,
    ...(source.owner_connection_id
      ? { connectionId: source.owner_connection_id }
      : {}),
  });
  const { data: doc, error } = await admin()
    .from("documents")
    .select("*")
    .eq("id", t.document_id)
    .eq("source_id", t.source_id)
    .maybeSingle();
  assertDb(error);
  if (!doc || doc.sha256 !== t.expected_sha256)
    throw new ApiError(409, "Source document changed", "source_changed");
  return { doc: doc as PuenteDocument, source: source as Source };
}
export async function createPeerTransfer(
  doc: PuenteDocument,
  receiptId: string,
  auth: AgentContext | OwnerAgentContext,
): Promise<PeerTransfer> {
  if (!doc.source_id || !doc.source_key || !doc.size_bytes)
    throw new ApiError(
      410,
      "This document has no connected source. Register it from the owner's device.",
      "source_unavailable",
    );
  const id = randomUUID(),
    secret = randomBytes(32).toString("base64url");
  const owner = "kind" in auth;
  const until = Math.min(
    Date.now() + 300000,
    owner
      ? auth.expiresAt
      : Math.min(
          Date.parse(auth.expiresAt),
          Date.parse(auth.bridge.expires_at),
        ),
  );
  const row = {
    bridge_token_hash: owner ? null : (auth as AgentContext).tokenHash,
    owner_user_id: owner ? auth.userId : null,
    owner_connection_id: owner ? (auth.connectionId ?? null) : null,
    owner_session_id: owner ? (auth.humanSessionId ?? null) : null,
    owner_expires_at:
      owner && Number.isFinite(auth.expiresAt)
        ? new Date(auth.expiresAt).toISOString()
        : null,
    id,
    secret_hash: sha256(secret),
    document_id: doc.id,
    source_id: doc.source_id,
    company_id: doc.company_id,
    receipt_id: receiptId,
    expected_sha256: doc.sha256,
    expires_at: new Date(until).toISOString(),
  };
  const { source } = await assertActive({
    ...row,
    offer: null,
    answer: null,
    status: "pending",
  } as Transfer);
  if (Date.parse(source.online_until) <= Date.now())
    throw new ApiError(
      503,
      "The owner source is offline. Keep its browser tab or local connector running.",
      "source_offline",
    );
  const { error } = await admin().from("peer_transfers").insert(row);
  assertDb(error);
  return {
    transfer_id: id,
    transfer_secret: secret,
    sha256: doc.sha256,
    title: doc.title,
    size_bytes: doc.size_bytes,
    expires_at: row.expires_at,
  };
}
export function peerDownloadUrl(t: PeerTransfer) {
  return `${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}/receive#transfer=${t.transfer_id}&secret=${encodeURIComponent(t.transfer_secret)}`;
}
async function recipient(id: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new ApiError(401, "Transfer capability required", "unauthorized");
  const t = await readTransfer(id);
  if (sha256(secret) !== t.secret_hash)
    throw new ApiError(401, "Invalid transfer capability", "unauthorized");
  return { t, ...(await assertActive(t)) };
}
export async function readPeerTransfer(id: string, secret: string) {
  const { t, doc, source } = await recipient(id, secret);
  return {
    transfer_id: t.id,
    transfer_secret: secret,
    sha256: doc.sha256,
    title: doc.title,
    size_bytes: doc.size_bytes,
    expires_at: t.expires_at,
    answer: t.answer,
    status: t.status,
    source_online: Date.parse(source.online_until) > Date.now(),
  };
}
export async function signalPeerTransfer(
  id: string,
  secret: string,
  value: unknown,
) {
  const input = peerSignal.parse(value);
  const { t } = await recipient(id, secret);
  if (input.action === "offer") {
    if (t.status !== "pending")
      throw new ApiError(409, "Transfer already started");
    if (t.offer && t.offer.sdp !== input.offer.sdp)
      throw new ApiError(409, "Transfer offer already set");
    if (!t.offer) {
      const { data, error } = await admin()
        .from("peer_transfers")
        .update({ offer: input.offer })
        .eq("id", id)
        .eq("status", "pending")
        .is("offer", null)
        .select("id")
        .maybeSingle();
      assertDb(error);
      if (!data)
        throw new ApiError(
          409,
          "Another receiver already started this transfer",
        );
    }
  } else if (input.action === "complete") {
    if (input.sha256 !== t.expected_sha256)
      throw new ApiError(409, "Original file integrity check failed");
    if (t.status === "completed") return { ok: true };
    if (t.status !== "connected")
      throw new ApiError(409, "The transfer has not connected");
    const { error } = await admin().rpc("complete_peer_transfer", {
      p_transfer_id: id,
    });
    assertDb(error);
  } else {
    const { error } = await admin()
      .from("peer_transfers")
      .update({ status: "cancelled", offer: null, answer: null })
      .eq("id", id);
    assertDb(error);
  }
  return { ok: true };
}
export async function pollPeerSource(owner: OwnerAgentContext, id: string) {
  await sourceForOwner(owner, id);
  const { error: he } = await admin()
    .from("document_sources")
    .update({ online_until: new Date(Date.now() + 45000).toISOString() })
    .eq("id", id);
  assertDb(he);
  const { data, error } = await admin()
    .from("peer_transfers")
    .select("*")
    .eq("source_id", id)
    .in("status", ["pending", "connected"])
    .gt("expires_at", new Date().toISOString())
    .limit(20);
  assertDb(error);
  const offers = [];
  for (const row of data ?? [])
    try {
      const { doc } = await assertActive(row as Transfer);
      if (row.offer)
        offers.push({
          transfer_id: row.id,
          source_key: doc.source_key,
          sha256: doc.sha256,
          size_bytes: doc.size_bytes,
          offer: row.offer,
        });
    } catch {
      await admin()
        .from("peer_transfers")
        .update({ status: "cancelled", offer: null, answer: null })
        .eq("id", row.id);
    }
  // SDP is network metadata only and is cleared after the short transfer window.
  await admin()
    .from("peer_transfers")
    .update({ offer: null, answer: null, status: "cancelled" })
    .eq("source_id", id)
    .lt("expires_at", new Date().toISOString())
    .neq("status", "completed");
  return { offers };
}
export async function answerPeerSource(
  owner: OwnerAgentContext,
  id: string,
  value: unknown,
) {
  await sourceForOwner(owner, id);
  const input = sourceSignal.parse(value);
  const t = await readTransfer(input.transfer_id);
  if (t.source_id !== id)
    throw new ApiError(404, "Transfer outside this source");
  await assertActive(t);
  if (t.status !== "pending" || !t.offer)
    throw new ApiError(409, "Transfer is not awaiting an answer");
  const { error } = await admin()
    .from("peer_transfers")
    .update({ answer: input.answer, status: "connected" })
    .eq("id", t.id)
    .eq("status", "pending");
  assertDb(error);
  return { ok: true };
}
