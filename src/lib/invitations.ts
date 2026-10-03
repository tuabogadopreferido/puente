import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { bearer } from "@/lib/auth";
import { ApiError, assertDb } from "@/lib/http";

export const invitationInput = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  company_name: z.string().trim().min(1).max(200),
  purpose_id: z.uuid(),
  offered_document_ids: z.array(z.uuid()).min(1).max(100),
});
const claimsSchema = z.object({
  id: z.uuid(),
  exp: z.number().int(),
  nonce: z.string().min(32),
});
const namespace = "puente.company-invitation.v1:";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function mac(raw: string) {
  const key = process.env.APP_SIGNING_SECRET;
  if (!key || key.length < 32)
    throw new ApiError(503, "Invitation signing is not configured");
  return createHmac("sha256", key)
    .update(namespace + raw)
    .digest();
}
export function signInvitation(id: string, expiresAt: number) {
  const raw = Buffer.from(
    JSON.stringify(
      claimsSchema.parse({
        id,
        exp: expiresAt,
        nonce: randomBytes(32).toString("base64url"),
      }),
    ),
  ).toString("base64url");
  return `${raw}.${mac(raw).toString("base64url")}`;
}
export function verifyInvitationToken(token: string) {
  if (!token || token.length > 2000)
    throw new ApiError(401, "Invalid invitation link");
  const [raw, sig, extra] = token.split(".");
  if (!raw || !sig || extra) throw new ApiError(401, "Invalid invitation link");
  const expected = mac(raw),
    supplied = Buffer.from(sig, "base64url");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new ApiError(401, "Invalid invitation signature");
  let claims;
  try {
    claims = claimsSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new ApiError(401, "Invalid invitation link");
  }
  if (claims.exp <= Date.now())
    throw new ApiError(410, "This invitation has expired");
  return claims;
}
function origin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new ApiError(503, "A secure invitation URL is required");
  return url.origin;
}
function htmlEscape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
async function sendInvitation(
  email: string,
  inviterName: string,
  companyName: string,
  purposeName: string,
  url: string,
) {
  const reviewer = process.env.PUENTE_REVIEW_EMAIL?.trim().toLowerCase();
  if (email !== reviewer)
    return {
      status: "not_sent",
      message:
        "Demo mail is restricted to the configured reviewer. You can copy and share this invitation link with its intended recipient.",
    };
  if (!process.env.AGENTMAIL_API_KEY || !process.env.AGENTMAIL_INBOX_ID)
    return {
      status: "not_sent",
      message:
        "AgentMail is not configured. The signed invitation link is ready to share with its intended recipient.",
    };
  try {
    const response = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(process.env.AGENTMAIL_INBOX_ID)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: email,
          subject: `${inviterName} invited ${companyName} to Puente`,
          text: `${inviterName} invited ${companyName} to establish a bilateral document bridge for: ${purposeName}.\n\nReview invitation: ${url}\n\nThis link expires in 24 hours. You will sign in with the invited email address and confirm that mailbox before accepting. Acceptance creates a bridge, but does not release any documents; all requests remain subject to purpose, rules and owner approval.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:28px;color:#183b30"><p>PUENTE · COMPANY INVITATION</p><h1 style="font-size:27px">${htmlEscape(inviterName)} invited your company.</h1><p>${htmlEscape(companyName)} will connect for: ${htmlEscape(purposeName)}.</p><p><a href="${url}" style="display:inline-block;background:#14583f;color:white;padding:15px 20px;border-radius:8px;text-decoration:none">Review invitation</a></p><p>You will sign in with the invited email and confirm that mailbox before accepting. The link expires in 24 hours. Document requests will remain subject to owner permissions.</p></div>`,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok
      ? {
          status: "sent",
          message: "Invitation sent to the configured demo reviewer.",
        }
      : {
          status: "not_sent",
          message:
            "AgentMail did not accept the invitation email. The signed link is still ready to share.",
        };
  } catch {
    return {
      status: "not_sent",
      message:
        "Invitation email is unavailable. The signed link is ready to share.",
    };
  }
}
export async function createInvitation(
  owner: { userId: string; companyId: string },
  value: unknown,
) {
  const input = invitationInput.parse(value);
  const offers = [...new Set(input.offered_document_ids)];
  const db = admin();
  const [company, purpose, documents] = await Promise.all([
    db.from("companies").select("name").eq("id", owner.companyId).single(),
    db
      .from("purposes")
      .select("name")
      .eq("id", input.purpose_id)
      .eq("company_id", owner.companyId)
      .maybeSingle(),
    db
      .from("documents")
      .select("id")
      .eq("company_id", owner.companyId)
      .in("id", offers),
  ]);
  for (const result of [company, purpose, documents]) assertDb(result.error);
  if (!company.data || !purpose.data)
    throw new ApiError(
      400,
      "Choose a purpose from your company's approved list",
    );
  if (documents.data?.length !== offers.length)
    throw new ApiError(403, "You can offer only your own company's documents");
  const id = randomUUID(),
    exp = Date.now() + 24 * 60 * 60 * 1000;
  const token = signInvitation(id, exp);
  const inviteUrl = `${origin()}/invite?token=${encodeURIComponent(token)}`;
  const { error } = await db
    .from("invitations")
    .insert({
      id,
      token_hash: hash(token),
      inviter_company_id: owner.companyId,
      created_by_user_id: owner.userId,
      invited_email: input.email,
      company_name: input.company_name,
      purpose_id: input.purpose_id,
      offered_document_ids: offers,
      expires_at: new Date(exp).toISOString(),
    });
  assertDb(error);
  const email = await sendInvitation(
    input.email,
    company.data.name,
    input.company_name,
    purpose.data.name,
    inviteUrl,
  );
  return {
    invitation_id: id,
    status: "pending",
    invite_url: inviteUrl,
    expires_at: new Date(exp).toISOString(),
    email,
  };
}
async function invitationRow(token: string) {
  const claims = verifyInvitationToken(token);
  const { data, error } = await admin()
    .from("invitations")
    .select("*")
    .eq("id", claims.id)
    .eq("token_hash", hash(token))
    .maybeSingle();
  assertDb(error);
  if (
    !data ||
    data.status === "cancelled" ||
    Date.parse(data.expires_at) <= Date.now()
  )
    throw new ApiError(410, "Invitation unavailable or expired");
  return data;
}
/** Intentionally excludes emails, document IDs, text, hashes, storage paths and download links. */
export async function inspectInvitation(token: string) {
  const row = await invitationRow(token);
  const [company, purpose] = await Promise.all([
    admin()
      .from("companies")
      .select("name")
      .eq("id", row.inviter_company_id)
      .single(),
    admin()
      .from("purposes")
      .select("name")
      .eq("id", row.purpose_id)
      .eq("company_id", row.inviter_company_id)
      .single(),
  ]);
  assertDb(company.error);
  assertDb(purpose.error);
  return {
    inviter_name: company.data?.name,
    company_name: row.company_name,
    purpose_name: purpose.data?.name,
    offered_document_count: row.offered_document_ids.length,
    status: row.status,
    expires_at: row.expires_at,
  };
}
export async function acceptInvitation(request: Request, token: string) {
  const row = await invitationRow(token);
  const { data, error } = await admin().auth.getUser(bearer(request));
  if (error || !data.user)
    throw new ApiError(
      401,
      "Sign in with the invited email address",
      "unauthorized",
    );
  if (!data.user.email_confirmed_at)
    throw new ApiError(
      403,
      "Confirm your email address before accepting this invitation",
      "email_unconfirmed",
    );
  if (data.user.email?.trim().toLowerCase() !== row.invited_email)
    throw new ApiError(
      403,
      "This invitation is for a different email address",
      "email_mismatch",
    );
  const { data: accepted, error: acceptanceError } = await admin().rpc(
    "accept_company_invitation",
    { p_token_hash: hash(token), p_user_id: data.user.id },
  );
  if (acceptanceError)
    throw new ApiError(
      409,
      "This invitation could not be accepted. It may have expired, been used, or lost its original company permissions.",
    );
  return accepted;
}
