import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import {
  requireAgentToken,
  requireOwner,
  sha256,
  type AgentContext,
} from "@/lib/auth";
import { dashboard } from "@/lib/core";
import { signReceipt } from "@/lib/crypto";
import { ApiError, assertDb } from "@/lib/http";
import type { PuenteDocument } from "@/lib/types";

export interface OwnerAgentContext {
  kind: "owner";
  userId: string;
  companyId: string;
  expiresAt: number;
}
export type McpAuthContext =
  OwnerAgentContext | { kind: "counterparty"; agent: AgentContext };
const ownerTicketSchema = z.object({
  version: z.literal(1),
  scope: z.literal("owner"),
  user_id: z.uuid(),
  company_id: z.uuid(),
  document_id: z.uuid(),
  receipt_id: z.uuid(),
  exp: z.number().int(),
});
type OwnerTicket = z.infer<typeof ownerTicketSchema>;
const namespace = "puente.owner-download.v1:";
function signingKey() {
  const key = process.env.APP_SIGNING_SECRET;
  if (!key || key.length < 32)
    throw new ApiError(503, "Owner download signing is not configured");
  return key;
}
function mac(value: string) {
  return createHmac("sha256", signingKey())
    .update(namespace + value)
    .digest();
}

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
  if (expiresAt <= Date.now())
    throw new ApiError(401, "Owner access token has expired", "unauthorized");
  return { kind: "owner", ...owner, expiresAt };
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
}
export async function listOwnerDocuments(ctx: OwnerAgentContext) {
  await recheckOwner(ctx.userId, ctx.companyId, ctx.expiresAt);
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
  await recheckOwner(ctx.userId, ctx.companyId, ctx.expiresAt);
  const data = await dashboard(ctx.companyId);
  return { access_scope: "owner", requests: data.requests };
}
export async function ownerRequestStatus(
  ctx: OwnerAgentContext,
  requestId: string,
) {
  await recheckOwner(ctx.userId, ctx.companyId, ctx.expiresAt);
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
function createOwnerTicket(payload: OwnerTicket) {
  const raw = Buffer.from(
    JSON.stringify(ownerTicketSchema.parse(payload)),
  ).toString("base64url");
  return `${raw}.${mac(raw).toString("base64url")}`;
}
function readOwnerTicket(value: string) {
  if (!value || value.length > 2000)
    throw new ApiError(401, "Invalid owner download ticket");
  const [raw, signature, extra] = value.split(".");
  if (!raw || !signature || extra)
    throw new ApiError(401, "Invalid owner download ticket");
  const expected = mac(raw),
    actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new ApiError(401, "Invalid owner download signature");
  let payload: OwnerTicket;
  try {
    payload = ownerTicketSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new ApiError(401, "Invalid owner download ticket");
  }
  if (payload.exp <= Date.now())
    throw new ApiError(401, "Owner download ticket expired");
  return payload;
}
async function ownerAudit(
  companyId: string,
  documentId: string,
  receiptId: string,
  userId: string,
  stage: "issued" | "downloaded",
) {
  const { error } = await admin()
    .from("access_events")
    .insert({
      company_id: companyId,
      actor_company_id: companyId,
      bridge_id: null,
      document_id: documentId,
      action: "owner_document_delivered",
      detail: {
        access_scope: "owner",
        receipt_id: receiptId,
        user_id: userId,
        delivery_stage: stage,
      },
    });
  assertDb(error);
}
export async function getOwnerDocument(
  ctx: OwnerAgentContext,
  documentId: string,
) {
  await recheckOwner(ctx.userId, ctx.companyId, ctx.expiresAt);
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
    bridge_id: null,
    request_id: null,
    purpose: "Internal company document administration",
    delivered_at: new Date().toISOString(),
    original_pdf: true,
  };
  const signed = signReceipt(payload);
  const { error: receiptError } = await admin()
    .from("receipts")
    .insert({
      id: receiptId,
      company_id: ctx.companyId,
      receiver_company_id: ctx.companyId,
      payload,
      signature: signed.signature,
      public_key: signed.public_key,
    });
  assertDb(receiptError);
  const exp = Math.min(Date.now() + 60_000, ctx.expiresAt);
  const ticket = createOwnerTicket({
    version: 1,
    scope: "owner",
    user_id: ctx.userId,
    company_id: ctx.companyId,
    document_id: doc.id,
    receipt_id: receiptId,
    exp,
  });
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  await ownerAudit(ctx.companyId, doc.id, receiptId, ctx.userId, "issued");
  return {
    status: "delivered",
    access_scope: "owner",
    document_id: doc.id,
    title: doc.title,
    original_pdf: true,
    sha256: doc.sha256,
    download_url: `${base}/api/owner/documents/${doc.id}/download?ticket=${encodeURIComponent(ticket)}`,
    download_expires_at: new Date(exp).toISOString(),
    extracted_text: doc.extracted_text,
    receipt: { payload, ...signed },
  };
}
export async function downloadOwnerOriginal(
  documentId: string,
  ticket: string,
) {
  const claims = readOwnerTicket(ticket);
  if (claims.document_id !== documentId)
    throw new ApiError(
      403,
      "Download ticket belongs to a different document",
      "forbidden",
    );
  await recheckOwner(claims.user_id, claims.company_id, claims.exp);
  const { data: receipt, error } = await admin()
    .from("receipts")
    .select("payload")
    .eq("id", claims.receipt_id)
    .eq("company_id", claims.company_id)
    .eq("receiver_company_id", claims.company_id)
    .maybeSingle();
  assertDb(error);
  if (
    !receipt ||
    receipt.payload.scope !== "owner" ||
    receipt.payload.owner_user_id !== claims.user_id ||
    receipt.payload.document_id !== documentId ||
    receipt.payload.bridge_id !== null
  )
    throw new ApiError(403, "Receipt is outside owner scope", "forbidden");
  const { data: doc, error: docError } = await admin()
    .from("documents")
    .select("title,storage_path,sha256")
    .eq("id", documentId)
    .eq("company_id", claims.company_id)
    .maybeSingle();
  assertDb(docError);
  if (!doc)
    throw new ApiError(404, "Original document unavailable", "not_found");
  const { data: file, error: fileError } = await admin()
    .storage.from("documents")
    .download(doc.storage_path);
  assertDb(fileError);
  if (!file) throw new ApiError(404, "Original PDF unavailable", "not_found");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    sha256(bytes) !== receipt.payload.sha256 ||
    doc.sha256 !== receipt.payload.sha256
  )
    throw new ApiError(409, "Original file integrity check failed");
  await recheckOwner(claims.user_id, claims.company_id, claims.exp);
  await ownerAudit(
    claims.company_id,
    documentId,
    claims.receipt_id,
    claims.user_id,
    "downloaded",
  );
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80)}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Puente-SHA256": doc.sha256,
      "Referrer-Policy": "no-referrer",
    },
  });
}
