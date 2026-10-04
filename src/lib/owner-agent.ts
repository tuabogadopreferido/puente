import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import {
  requireAgentToken,
  requireOwner,
  recheckHumanSession,
  type AgentContext,
} from "@/lib/auth";
import { dashboard } from "@/lib/core";
import { signReceipt } from "@/lib/crypto";
import { ApiError, assertDb } from "@/lib/http";
import type { PuenteDocument } from "@/lib/types";
import { createPeerTransfer, peerDownloadUrl } from "@/lib/peer-server";
import {
  authenticateOwnerAgentConnection,
  recheckOwnerAgentConnection,
  revokeOwnerAgentConnection,
} from "@/lib/owner-agent-connections";

export interface OwnerAgentContext {
  kind: "owner";
  userId: string;
  companyId: string;
  expiresAt: number;
  connectionId?: string;
  humanSessionId?: string;
}
export type McpAuthContext =
  OwnerAgentContext | { kind: "counterparty"; agent: AgentContext };
/** Auth scope is derived exclusively from verified credentials, never a supplied company ID. */
export async function requireOwnerAgentToken(
  token: string,
): Promise<OwnerAgentContext> {
  if (!token || token.length > 8192)
    throw new ApiError(
      401,
      "An owner access token is required",
      "unauthorized",
    );
  if (token.startsWith("pt_"))
    throw new ApiError(
      403,
      "This tool requires an owner token",
      "owner_required",
    );
  if (token.startsWith("po_")) {
    const connection = await authenticateOwnerAgentConnection(token);
    return {
      kind: "owner",
      ...connection,
      expiresAt: Number.POSITIVE_INFINITY,
    };
  }
  const owner = await requireOwner(
    new Request("https://puente.internal/owner", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  let expiresAt = 0;
  try {
    expiresAt =
      z
        .object({ exp: z.number().int() })
        .parse(
          JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
          ),
        ).exp * 1000;
  } catch {
    throw new ApiError(401, "Invalid owner access token", "unauthorized");
  }
  expiresAt = Math.min(expiresAt, Date.parse(owner.humanExpiresAt));
  if (expiresAt <= Date.now())
    throw new ApiError(401, "Owner access token has expired", "unauthorized");
  return {
    kind: "owner",
    ...owner,
    humanSessionId: owner.humanSessionId,
    expiresAt,
  };
}
export async function authenticateMcpToken(
  token: string,
): Promise<McpAuthContext> {
  return token.startsWith("pt_")
    ? { kind: "counterparty", agent: await requireAgentToken(token) }
    : requireOwnerAgentToken(token);
}
async function recheckOwner(
  userId: string,
  companyId: string,
  expiresAt: number,
  connectionId?: string,
) {
  if (expiresAt <= Date.now())
    throw new ApiError(401, "Owner access has expired", "unauthorized");
  const { data, error } = await admin()
    .from("company_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("role", "owner")
    .maybeSingle();
  assertDb(error);
  if (!data)
    throw new ApiError(
      403,
      "Owner membership is no longer active",
      "forbidden",
    );
  if (connectionId)
    await recheckOwnerAgentConnection({ userId, companyId }, connectionId);
}
export async function recheckOwnerAgentContext(ctx: OwnerAgentContext) {
  if (!ctx.connectionId) {
    if (!ctx.humanSessionId)
      throw new ApiError(
        401,
        "A current human session is required",
        "unauthorized",
      );
    await recheckHumanSession(ctx.userId, ctx.humanSessionId);
  }
  await recheckOwner(
    ctx.userId,
    ctx.companyId,
    ctx.expiresAt,
    ctx.connectionId,
  );
}
export async function revokeCurrentOwnerAgentConnection(
  ctx: OwnerAgentContext,
) {
  if (!ctx.connectionId)
    throw new ApiError(
      403,
      "Only a durable owner connection can revoke its own access.",
      "owner_connection_required",
    );
  await recheckOwnerAgentContext(ctx);
  return revokeOwnerAgentConnection(ctx, ctx.connectionId);
}
export async function listOwnerDocuments(ctx: OwnerAgentContext) {
  await recheckOwnerAgentContext(ctx);
  const data = await dashboard(ctx.companyId);
  return {
    access_scope: "owner",
    company: data.company,
    documents: data.documents,
    purposes: data.purposes,
    bridges: data.bridges,
    actor_company_id: ctx.companyId,
  };
}
export async function listOwnerRequests(ctx: OwnerAgentContext) {
  await recheckOwnerAgentContext(ctx);
  const data = await dashboard(ctx.companyId);
  return { access_scope: "owner", requests: data.requests };
}
export async function ownerRequestStatus(
  ctx: OwnerAgentContext,
  requestId: string,
) {
  await recheckOwnerAgentContext(ctx);
  const { data, error } = await admin()
    .from("requests")
    .select("*")
    .eq("id", requestId)
    .or(
      `owner_company_id.eq.${ctx.companyId},requester_company_id.eq.${ctx.companyId}`,
    )
    .maybeSingle();
  assertDb(error);
  if (!data)
    throw new ApiError(404, "Request not found in your company", "not_found");
  return { access_scope: "owner", request: data };
}
async function ownerAudit(
  companyId: string,
  documentId: string,
  receiptId: string,
  userId: string,
  stage: "issued" | "downloaded",
  connectionId?: string,
) {
  const { error } = await admin()
    .from("access_events")
    .insert({
      company_id: companyId,
      actor_company_id: companyId,
      bridge_id: null,
      document_id: documentId,
      action: "owner_peer_transfer_authorized",
      detail: {
        access_scope: "owner",
        receipt_id: receiptId,
        user_id: userId,
        delivery_stage: stage,
        ...(connectionId ? { connection_id: connectionId } : {}),
      },
    });
  assertDb(error);
}
export async function getOwnerDocument(
  ctx: OwnerAgentContext,
  documentId: string,
) {
  await recheckOwnerAgentContext(ctx);
  const { data, error } = await admin()
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  assertDb(error);
  if (!data)
    throw new ApiError(404, "Document not found in your company", "not_found");
  const doc = data as PuenteDocument;
  const receiptId = randomUUID();
  const payload = {
    receipt_id: receiptId,
    scope: "owner",
    document_id: doc.id,
    document_title: doc.title,
    sha256: doc.sha256,
    owner_company_id: ctx.companyId,
    receiver_company_id: ctx.companyId,
    owner_user_id: ctx.userId,
    ...(ctx.connectionId ? { owner_connection_id: ctx.connectionId } : {}),
    bridge_id: null,
    request_id: null,
    purpose: "Internal company document administration",
    authorized_at: new Date().toISOString(),
    original_pdf: true,
    transport: "webrtc",
  };
  const signed = signReceipt(payload);
  const { error: receiptError } = await admin().from("receipts").insert({
    id: receiptId,
    company_id: ctx.companyId,
    receiver_company_id: ctx.companyId,
    payload,
    signature: signed.signature,
    public_key: signed.public_key,
  });
  assertDb(receiptError);
  let transfer;
  try {
    transfer = await createPeerTransfer(doc, receiptId, ctx);
  } catch (error) {
    await admin()
      .from("receipts")
      .delete()
      .eq("id", receiptId)
      .eq("company_id", ctx.companyId);
    throw error;
  }
  await ownerAudit(
    ctx.companyId,
    doc.id,
    receiptId,
    ctx.userId,
    "issued",
    ctx.connectionId,
  );
  await recheckOwnerAgentContext(ctx);
  return {
    status: "delivered",
    access_scope: "owner",
    document_id: doc.id,
    title: doc.title,
    original_pdf: true,
    sha256: doc.sha256,
    transport: "webrtc",
    transfer,
    download_url: peerDownloadUrl(transfer),
    download_expires_at: transfer.expires_at,
    receipt: { payload, ...signed },
  };
}
export async function downloadOwnerOriginal(): Promise<Response> {
  throw new ApiError(
    410,
    "Stored downloads have been retired. Request a new peer transfer from the document source.",
    "peer_transfer_required",
  );
}
