import { randomBytes, randomUUID } from "node:crypto";
import { admin } from "./supabase-admin";
import { agentFromHash, sha256, type AgentContext } from "./auth";
import { ApiError, assertDb } from "./http";
import { decideAccess } from "./rules";
import { signReceipt, signDownload } from "./crypto";
import type { PuenteDocument, Purpose, DocumentRequest } from "./types";
import { notifyRequest } from "./email";

const metadataFields =
  "id,company_id,title,document_type,expires_at,sensitive,sha256,classification_source,created_at";
export async function logEvent(
  companyId: string,
  actorId: string,
  bridgeId: string,
  action: string,
  documentId: string | null = null,
  detail: Record<string, unknown> = {},
) {
  const { error } = await admin()
    .from("access_events")
    .insert({
      company_id: companyId,
      actor_company_id: actorId,
      bridge_id: bridgeId,
      document_id: documentId,
      action,
      detail,
    });
  assertDb(error);
}
export async function exchangeCode(code: string) {
  const token = "pt_" + randomBytes(32).toString("base64url");
  const { data, error } = await admin().rpc("redeem_access_code", {
    p_code_hash: sha256(code.trim()),
    p_token_hash: sha256(token),
  });
  if (error || !data)
    throw new ApiError(
      401,
      "The code is invalid, already used, expired, or its bridge is revoked.",
      "invalid_code",
    );
  const ctx = await agentFromHash(sha256(token));
  await logEvent(
    ctx.targetCompanyId,
    ctx.actorCompanyId,
    ctx.bridge.id,
    "token_issued",
    null,
    { expires_at: data.expires_at },
  );
  return {
    token,
    token_type: "Bearer",
    expires_at: data.expires_at,
    bridge_id: data.bridge_id,
    actor_company_id: data.actor_company_id,
  };
}
export async function listDocuments(ctx: AgentContext) {
  await agentFromHash(ctx.tokenHash);
  const results = await Promise.all([
    admin()
      .from("documents")
      .select(metadataFields)
      .eq("company_id", ctx.targetCompanyId)
      .order("created_at"),
    admin().from("purposes").select("*").eq("company_id", ctx.targetCompanyId),
    admin()
      .from("documents")
      .select(metadataFields)
      .eq("company_id", ctx.actorCompanyId)
      .order("created_at"),
  ]);
  results.forEach((r) => assertDb(r.error));
  return {
    documents: results[0].data,
    purposes: results[1].data,
    offered_documents: results[2].data,
    bridge: ctx.bridge,
    actor_company_id: ctx.actorCompanyId,
  };
}
async function targetDocument(
  ctx: AgentContext,
  id: string,
): Promise<PuenteDocument> {
  const { data, error } = await admin()
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("company_id", ctx.targetCompanyId)
    .maybeSingle();
  assertDb(error);
  if (!data)
    throw new ApiError(
      404,
      "Document not found within this bridge",
      "not_found",
    );
  if (
    data.expires_at &&
    data.expires_at < new Date().toISOString().slice(0, 10)
  ) {
    const { data: current, error: ce } = await admin()
      .from("documents")
      .select("*")
      .eq("company_id", ctx.targetCompanyId)
      .eq("document_type", data.document_type)
      .or(
        `expires_at.is.null,expires_at.gte.${new Date().toISOString().slice(0, 10)}`,
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertDb(ce);
    if (current) return current;
  }
  return data;
}
export interface RequestInput {
  document_id: string;
  purpose_id?: string;
  purpose?: string;
  offered_document_ids?: string[];
}
export async function requestDocument(ctx: AgentContext, input: RequestInput) {
  await agentFromHash(ctx.tokenHash);
  const doc = await targetDocument(ctx, input.document_id);
  let purpose: Purpose | null = null;
  if (input.purpose_id) {
    const { data, error } = await admin()
      .from("purposes")
      .select("*")
      .eq("company_id", ctx.targetCompanyId)
      .eq("id", input.purpose_id)
      .maybeSingle();
    assertDb(error);
    purpose = data;
  } else if (input.purpose) {
    const { data, error } = await admin()
      .from("purposes")
      .select("*")
      .eq("company_id", ctx.targetCompanyId)
      .eq("name", input.purpose)
      .maybeSingle();
    assertDb(error);
    purpose = data;
  }
  if (!purpose && !input.purpose?.trim() && !input.purpose_id)
    throw new ApiError(400, "Declare the purpose for this document request");
  const offered = input.offered_document_ids ?? [];
  if (offered.length) {
    const { data: ownDocs, error: oe } = await admin()
      .from("documents")
      .select("id")
      .eq("company_id", ctx.actorCompanyId)
      .in("id", offered);
    assertDb(oe);
    const owned = new Set((ownDocs ?? []).map((d) => d.id));
    if (!offered.every((id) => owned.has(id)))
      throw new ApiError(
        403,
        "You can offer only documents from your own company",
      );
  }
  const { data: rules, error: re } = await admin()
    .from("rules")
    .select("*")
    .eq("company_id", doc.company_id);
  assertDb(re);
  const decision = decideAccess(doc, purpose, rules ?? [], ctx.actorCompanyId);
  const purposeText =
    purpose?.name ?? input.purpose?.trim() ?? "Unknown declared purpose";
  const { data: request, error } = await admin()
    .from("requests")
    .insert({
      bridge_id: ctx.bridge.id,
      requester_company_id: ctx.actorCompanyId,
      owner_company_id: doc.company_id,
      document_id: doc.id,
      purpose_id: purpose?.id ?? null,
      purpose_text: purposeText,
      status: decision.allowed ? "approved" : "pending",
      reason: decision.reason,
      offered_document_ids: offered,
    })
    .select("*")
    .single();
  assertDb(error);
  await logEvent(
    doc.company_id,
    ctx.actorCompanyId,
    ctx.bridge.id,
    decision.allowed ? "rule_approved" : "approval_requested",
    doc.id,
    {
      request_id: request.id,
      purpose: purposeText,
      reason: decision.reason,
      offered_document_count: offered.length,
    },
  );
  if (decision.allowed) return deliverDocument(ctx, request, doc);
  let email: unknown;
  try {
    email = await notifyRequest(request);
  } catch {
    email = {
      sent: false,
      reason:
        "Email delivery unavailable. The request is available in the owner dashboard.",
    };
  }
  return {
    status: "pending",
    request_id: request.id,
    reason: decision.reason,
    offered_document_ids: offered,
    email,
    poll_url: `/api/requests/${request.id}`,
  };
}
export async function pollRequest(ctx: AgentContext, requestId: string) {
  await agentFromHash(ctx.tokenHash);
  const { data: row, error } = await admin()
    .from("requests")
    .select("*")
    .eq("id", requestId)
    .eq("bridge_id", ctx.bridge.id)
    .eq("requester_company_id", ctx.actorCompanyId)
    .eq("owner_company_id", ctx.targetCompanyId)
    .maybeSingle();
  assertDb(error);
  if (!row) throw new ApiError(404, "Request not found", "not_found");
  if (row.status === "approved") {
    const { data: doc, error: de } = await admin()
      .from("documents")
      .select("*")
      .eq("id", row.document_id)
      .eq("company_id", ctx.targetCompanyId)
      .single();
    assertDb(de);
    return deliverDocument(ctx, row, doc);
  }
  return {
    status: row.status,
    request_id: row.id,
    reason: row.reason,
    manual_response: row.manual_response,
  };
}
async function deliverDocument(
  ctx: AgentContext,
  request: DocumentRequest,
  doc: PuenteDocument,
) {
  await agentFromHash(ctx.tokenHash);
  if (
    request.status !== "approved" ||
    request.owner_company_id !== ctx.targetCompanyId ||
    request.requester_company_id !== ctx.actorCompanyId ||
    doc.company_id !== ctx.targetCompanyId
  )
    throw new ApiError(403, "Delivery is not authorized");
  const id = randomUUID();
  const payload = {
    receipt_id: id,
    document_id: doc.id,
    document_title: doc.title,
    sha256: doc.sha256,
    owner_company_id: doc.company_id,
    receiver_company_id: ctx.actorCompanyId,
    bridge_id: ctx.bridge.id,
    request_id: request.id,
    purpose: request.purpose_text,
    delivered_at: new Date().toISOString(),
    original_pdf: true,
  };
  const signed = signReceipt(payload);
  const { error } = await admin()
    .from("receipts")
    .insert({
      id,
      company_id: doc.company_id,
      receiver_company_id: ctx.actorCompanyId,
      payload,
      signature: signed.signature,
      public_key: signed.public_key,
    });
  assertDb(error);
  const exp = Math.min(
    Date.now() + 60_000,
    Date.parse(ctx.expiresAt),
    Date.parse(ctx.bridge.expires_at),
  );
  const downloadToken = signDownload({
    receipt_id: id,
    token_hash: ctx.tokenHash,
    exp,
  });
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  await logEvent(
    doc.company_id,
    ctx.actorCompanyId,
    ctx.bridge.id,
    "document_delivered",
    doc.id,
    { receipt_id: id, purpose: request.purpose_text, sha256: doc.sha256 },
  );
  return {
    status: "delivered",
    request_id: request.id,
    document_id: doc.id,
    title: doc.title,
    original_pdf: true,
    sha256: doc.sha256,
    download_url: `${base}/api/download?ticket=${encodeURIComponent(downloadToken)}`,
    download_expires_at: new Date(exp).toISOString(),
    extracted_text: doc.extracted_text,
    receipt: { payload, ...signed },
    offered_document_ids: request.offered_document_ids,
  };
}
export async function dashboard(companyId: string) {
  const db = admin();
  const companyResult = await db
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  assertDb(companyResult.error);
  const bridgeResult = await db
    .from("bridges")
    .select("*")
    .or(`company_a_id.eq.${companyId},company_b_id.eq.${companyId}`)
    .order("created_at", { ascending: false });
  assertDb(bridgeResult.error);
  const counterpartIds = [
    ...new Set(
      (bridgeResult.data ?? [])
        .flatMap((b) => [b.company_a_id, b.company_b_id])
        .filter((id) => id !== companyId),
    ),
  ];
  const queries = await Promise.all([
    db
      .from("documents")
      .select(metadataFields)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    db.from("purposes").select("*").eq("company_id", companyId),
    db.from("rules").select("*").eq("company_id", companyId),
    db
      .from("requests")
      .select("*")
      .or(
        `owner_company_id.eq.${companyId},requester_company_id.eq.${companyId}`,
      )
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("access_events")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("companies").select("id,name,tax_id").in("id", counterpartIds),
  ]);
  queries.forEach((q) => assertDb(q.error));
  return {
    company: companyResult.data,
    companies: queries[5].data,
    documents: queries[0].data,
    purposes: queries[1].data,
    rules: queries[2].data,
    bridges: bridgeResult.data,
    requests: queries[3].data,
    events: queries[4].data,
  };
}
export async function ownedBridge(
  companyId: string,
  bridgeId: string,
  active = true,
) {
  const { data, error } = await admin()
    .from("bridges")
    .select("*")
    .eq("id", bridgeId)
    .or(`company_a_id.eq.${companyId},company_b_id.eq.${companyId}`)
    .maybeSingle();
  assertDb(error);
  if (!data) throw new ApiError(404, "Bridge not found");
  if (
    active &&
    (data.status !== "active" || Date.parse(data.expires_at) <= Date.now())
  )
    throw new ApiError(409, "Bridge is revoked or expired");
  return data;
}
export async function createBridge(
  companyId: string,
  counterpartyId: string,
  hours: number,
) {
  if (companyId === counterpartyId)
    throw new ApiError(400, "Choose another company");
  const { data: company, error: ce } = await admin()
    .from("companies")
    .select("id")
    .eq("id", counterpartyId)
    .maybeSingle();
  assertDb(ce);
  if (!company) throw new ApiError(404, "Counterparty not found");
  const { data, error } = await admin()
    .from("bridges")
    .insert({
      company_a_id: companyId,
      company_b_id: counterpartyId,
      expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
    })
    .select("*")
    .single();
  assertDb(error);
  await logEvent(companyId, companyId, data.id, "bridge_created", null, {
    counterparty_id: counterpartyId,
  });
  return data;
}
export async function issueCode(
  companyId: string,
  bridgeId: string,
  actorCompanyId?: string,
) {
  const bridge = await ownedBridge(companyId, bridgeId);
  const actor =
    actorCompanyId ??
    (bridge.company_a_id === companyId
      ? bridge.company_b_id
      : bridge.company_a_id);
  if (![bridge.company_a_id, bridge.company_b_id].includes(actor))
    throw new ApiError(403, "Actor is outside this bridge");
  const code = "pb_" + randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Math.min(Date.now() + 15 * 60_000, Date.parse(bridge.expires_at)),
  ).toISOString();
  const { error } = await admin()
    .from("access_codes")
    .insert({
      code_hash: sha256(code),
      bridge_id: bridgeId,
      actor_company_id: actor,
      expires_at: expiresAt,
    });
  assertDb(error);
  return {
    code,
    expires_at: expiresAt,
    actor_company_id: actor,
    bridge_id: bridgeId,
  };
}
export async function revokeBridge(companyId: string, bridgeId: string) {
  await ownedBridge(companyId, bridgeId, false);
  const { error } = await admin()
    .from("bridges")
    .update({ status: "revoked" })
    .eq("id", bridgeId);
  assertDb(error);
  await logEvent(companyId, companyId, bridgeId, "bridge_revoked");
  return { status: "revoked", bridge_id: bridgeId };
}
