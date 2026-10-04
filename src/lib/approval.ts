import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import type { ApprovalAction, DocumentRequest } from "@/lib/types";
import { assertRequestSharing } from "@/lib/document-sharing";
import { ApiError, assertDb } from "@/lib/http";

export const approvalActionSchema = z.enum(["approve", "deny", "manual"]);
const tokenSchema = z.object({
  requestId: z.string().uuid(),
  action: approvalActionSchema,
  expiresAt: z.number().int(),
  nonce: z.string().min(32),
});
export const hashApprovalToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function signingSecret() {
  const secret = process.env.APPROVAL_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Approval signing is not configured.");
  return secret;
}
function signature(payload: string) {
  return createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
}

export function createApprovalToken(
  requestId: string,
  action: ApprovalAction,
  expiresAt = Date.now() + 24 * 60 * 60 * 1000,
) {
  const payload = Buffer.from(
    JSON.stringify(
      tokenSchema.parse({
        requestId,
        action,
        expiresAt,
        nonce: randomBytes(32).toString("base64url"),
      }),
    ),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function verifyApprovalToken(token: string) {
  if (token.length > 2000) throw new Error("Invalid approval link.");
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) throw new Error("Invalid approval link.");
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(supplied);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Error("Invalid approval link.");
  const parsed = tokenSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (parsed.expiresAt <= Date.now())
    throw new Error("This approval link has expired.");
  return parsed;
}
export async function issueApprovalLinks(requestId: string) {
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const actions: ApprovalAction[] = ["approve", "deny", "manual"];
  const tokens = actions.map((action) => ({
    action,
    token: createApprovalToken(requestId, action, expiry),
  }));
  const { error } = await admin()
    .from("approval_links")
    .insert(
      tokens.map(({ action, token }) => ({
        request_id: requestId,
        action,
        token_hash: hashApprovalToken(token),
        expires_at: new Date(expiry).toISOString(),
      })),
    );
  if (error) throw new Error("Approval links could not be created.");
  return Object.fromEntries(
    tokens.map(({ action, token }) => [action, token]),
  ) as Record<ApprovalAction, string>;
}

/** Read-only: mail scanners and page previews must never approve a request. */
export async function inspectApproval(token: string) {
  const claims = verifyApprovalToken(token);
  const db = admin();
  const { data: link, error } = await db
    .from("approval_links")
    .select("request_id,action,expires_at,used_at")
    .eq("token_hash", hashApprovalToken(token))
    .single();
  if (
    error ||
    !link ||
    link.used_at ||
    Date.parse(link.expires_at) <= Date.now() ||
    link.request_id !== claims.requestId ||
    link.action !== claims.action
  )
    throw new Error("This approval link is invalid, expired, or already used.");
  const { data: request } = await db
    .from("requests")
    .select("*")
    .eq("id", claims.requestId)
    .single();
  if (!request || !["pending", "manual"].includes(request.status))
    throw new Error("This request has already been resolved.");
  const [document, requester, owner, bridge] = await Promise.all([
    db
      .from("documents")
      .select("title,document_type,sensitive,expires_at,classification_source")
      .eq("id", request.document_id)
      .single(),
    db
      .from("companies")
      .select("name")
      .eq("id", request.requester_company_id)
      .single(),
    db
      .from("companies")
      .select("name")
      .eq("id", request.owner_company_id)
      .single(),
    db
      .from("bridges")
      .select("status,expires_at")
      .eq("id", request.bridge_id)
      .single(),
  ]);
  if (
    !bridge.data ||
    bridge.data.status !== "active" ||
    Date.parse(bridge.data.expires_at) <= Date.now()
  )
    throw new Error("This bridge has expired or been revoked.");
  return {
    request: request as DocumentRequest,
    action: claims.action,
    document: document.data,
    requester: requester.data?.name || "Counterparty",
    owner: owner.data?.name || "Document owner",
    expiresAt: link.expires_at,
  };
}

export async function resolveRequest({
  requestId,
  ownerCompanyId,
  action,
  createRule = false,
  manualResponse,
}: {
  requestId: string;
  ownerCompanyId: string;
  action: ApprovalAction;
  createRule?: boolean;
  manualResponse?: string;
}) {
  const parsedAction = approvalActionSchema.parse(action);
  if (parsedAction === "manual" && !manualResponse?.trim())
    throw new Error("Enter a response for the requesting agent.");
  if (parsedAction === "approve") {
    const { data: request, error: requestError } = await admin()
      .from("requests")
      .select("*")
      .eq("id", requestId)
      .eq("owner_company_id", ownerCompanyId)
      .maybeSingle();
    assertDb(requestError);
    if (!request) throw new ApiError(404, "Request not found", "not_found");
    await assertRequestSharing(request as DocumentRequest);
  }
  const { data, error } = await admin().rpc("resolve_access_request", {
    p_request_id: z.string().uuid().parse(requestId),
    p_owner_company_id: z.string().uuid().parse(ownerCompanyId),
    p_action: parsedAction,
    p_create_rule: createRule,
    p_manual_response: manualResponse?.trim().slice(0, 5000) || null,
    p_token_hash: null,
  });
  if (error)
    throw new Error(
      "The request could not be resolved. It may be closed, expired, or revoked.",
    );
  return data as DocumentRequest;
}
export async function resolveTokenApproval({
  token,
  createRule = false,
  manualResponse,
}: {
  token: string;
  createRule?: boolean;
  manualResponse?: string;
}) {
  const claims = verifyApprovalToken(token);
  if (claims.action === "manual" && !manualResponse?.trim())
    throw new Error("Enter a response for the requesting agent.");
  if (claims.action === "approve") {
    const inspected = await inspectApproval(token);
    await assertRequestSharing(inspected.request);
  }
  const { data, error } = await admin().rpc("consume_approval_link", {
    p_token_hash: hashApprovalToken(token),
    p_action: claims.action,
    p_create_rule: createRule,
    p_manual_response: manualResponse?.trim().slice(0, 5000) || null,
  });
  if (error)
    throw new Error(
      "This link is expired, already used, or its bridge was revoked.",
    );
  return data as DocumentRequest;
}
