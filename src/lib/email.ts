import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { issueApprovalLinks } from "@/lib/approval";
import type { DocumentRequest } from "@/lib/types";

export type NotificationResult = {
  status: "sent" | "already_sent" | "unavailable" | "failed";
  message: string;
};
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!configured) throw new Error("App URL is missing.");
  const url = new URL(configured);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("Approval email requires an HTTPS app URL.");
  return url.origin;
}

export interface ApprovalEmailContent {
  requestId: string;
  requesterName: string;
  ownerName: string;
  documentTitle: string;
  purpose: string;
  reason: string;
  links: Record<string, string>;
  replyViaEmail: boolean;
}
/** Shared rendering for AgentMail and the explicit, local-only SMTP demo helper. */
export function renderApprovalEmail(input: ApprovalEmailContent) {
  const {
    requestId,
    requesterName,
    ownerName,
    documentTitle,
    purpose,
    reason,
    links,
    replyViaEmail,
  } = input;
  const responseInstruction = replyViaEmail
    ? "You can also reply to this email with a manual response. Your reply will be shared with the requesting agent; it does not grant document access."
    : "For a manual response, use the signed manual-response button. This demonstration does not process email replies. Your response will be shared with the requesting agent without granting document access.";
  const subject = `Puente: review ${requesterName}'s document request`;
  const text = `${requesterName} requested ${documentTitle} from ${ownerName}.\nPurpose: ${purpose}\nReason for review: ${reason}\n\nApprove: ${links.approve}\nDo not approve: ${links.deny}\nGive a manual response: ${links.manual}\n\nEach link expires after 24 hours and opens a confirmation page. ${responseInstruction}\nRequest: ${requestId}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17372e;padding:28px"><p style="font-size:13px;letter-spacing:2px">PUENTE · OWNER REVIEW</p><h1 style="font-size:27px;line-height:1.2">A document request needs your decision.</h1><p><strong>${escapeHtml(requesterName)}</strong> requested <strong>${escapeHtml(documentTitle)}</strong> from ${escapeHtml(ownerName)}.</p><p><strong>Purpose:</strong> ${escapeHtml(purpose)}</p><p><strong>Review reason:</strong> ${escapeHtml(reason)}</p><table role="presentation" style="margin:26px 0"><tr><td style="padding:0 8px 12px 0"><a href="${escapeHtml(links.approve)}" style="display:inline-block;padding:13px 18px;background:#14583f;color:#fff;text-decoration:none;border-radius:8px">Approve</a></td><td style="padding:0 0 12px"><a href="${escapeHtml(links.deny)}" style="display:inline-block;padding:13px 18px;background:#f2e8e5;color:#7a2f26;text-decoration:none;border-radius:8px">Do not approve</a></td></tr><tr><td colspan="2"><a href="${escapeHtml(links.manual)}" style="display:inline-block;padding:13px 18px;background:#eef3ed;color:#14583f;text-decoration:none;border-radius:8px">Give a manual response</a></td></tr></table><p style="font-size:13px;line-height:1.6;color:#58635c">Each link expires after 24 hours and opens a confirmation page. ${escapeHtml(responseInstruction)}</p><p style="font-size:11px;color:#69746e">Request ${escapeHtml(requestId)}</p></div>`;
  return { subject, text, html };
}

/** Demo mail can only reach the recipient explicitly configured by the owner. */
export async function notifyRequest(
  request: DocumentRequest,
): Promise<NotificationResult> {
  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX_ID;
  const recipient = z.email().safeParse(process.env.PUENTE_REVIEW_EMAIL);
  if (!key || !inbox || !recipient.success)
    return {
      status: "unavailable",
      message:
        "Email approval needs AgentMail configuration and an authorized demo reviewer. The owner can review this request in the dashboard.",
    };
  if (request.status !== "pending")
    return {
      status: "unavailable",
      message: "This request is no longer pending.",
    };
  const db = admin();
  const reservation = `agentmail:reserved:${randomUUID()}`;
  let claimed = false;
  let attemptedSend = false;
  try {
    const { data: current, error: lookupError } = await db
      .from("requests")
      .select("email_message_id,status")
      .eq("id", request.id)
      .single();
    if (lookupError || !current) throw new Error("Request unavailable.");
    if (current.status !== "pending")
      return {
        status: "unavailable",
        message: "This request is no longer pending.",
      };
    if (current.email_message_id)
      return String(current.email_message_id).includes(":reserved:")
        ? {
            status: "failed",
            message:
              "A notification attempt is in progress or awaits delivery reconciliation. Review is available in the owner dashboard.",
          }
        : {
            status: "already_sent",
            message: "The reviewer has already been notified.",
          };
    const origin = appUrl();
    const [document, requester, owner] = await Promise.all([
      db
        .from("documents")
        .select("title,sensitive")
        .eq("id", request.document_id)
        .eq("company_id", request.owner_company_id)
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
    ]);
    if (!document.data || !requester.data || !owner.data)
      throw new Error("Request details unavailable.");
    // One database claim protects concurrent callers and the provider's 24-hour replay window.
    const { data: claimedRequest, error: claimError } = await db
      .from("requests")
      .update({ email_message_id: reservation })
      .eq("id", request.id)
      .eq("status", "pending")
      .is("email_message_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error("Notification could not be reserved.");
    if (!claimedRequest)
      return {
        status: "unavailable",
        message:
          "Another notification attempt or owner decision is already in progress.",
      };
    claimed = true;
    const tokens = await issueApprovalLinks(request.id);
    const links = Object.fromEntries(
      Object.entries(tokens).map(([action, token]) => [
        action,
        `${origin}/approve?token=${encodeURIComponent(token)}`,
      ]),
    );
    const { subject, text, html } = renderApprovalEmail({
      requestId: request.id,
      requesterName: requester.data.name,
      ownerName: owner.data.name,
      documentTitle: document.data.title,
      purpose: request.purpose_text,
      reason: request.reason,
      links,
      replyViaEmail: !!process.env.AGENTMAIL_WEBHOOK_SECRET,
    });
    attemptedSend = true;
    const response = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `puente-request-${request.id}`,
        },
        body: JSON.stringify({ to: [recipient.data], subject, text, html }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      return {
        status: "failed",
        message:
          "AgentMail did not confirm this notification. The attempt is reserved to prevent duplicate mail; review is available in the owner dashboard.",
      };
    const result = z
      .object({ message_id: z.string(), thread_id: z.string() })
      .parse(await response.json());
    const { error } = await db
      .from("requests")
      .update({
        email_thread_id: result.thread_id,
        email_message_id: result.message_id,
      })
      .eq("id", request.id)
      .eq("email_message_id", reservation);
    return {
      status: "sent",
      message: error
        ? "Approval email sent. Reply tracking could not be saved; use its review links."
        : "Approval email sent to the configured reviewer.",
    };
  } catch {
    // A timeout can happen after delivery. Never resend automatically after any network attempt.
    if (claimed && !attemptedSend)
      await db
        .from("requests")
        .update({ email_message_id: null })
        .eq("id", request.id)
        .eq("email_message_id", reservation);
    return {
      status: "failed",
      message:
        "Email approval is unavailable. The request is awaiting review in the owner dashboard.",
    };
  }
}
