import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { issueApprovalLinks } from "@/lib/approval";
import type { DocumentRequest } from "@/lib/types";

export type NotificationResult = { status: "sent" | "already_sent" | "unavailable" | "failed"; message: string };
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!configured) throw new Error("App URL is missing.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Approval email requires an HTTPS app URL.");
  return url.origin;
}

/** Demo mail can only reach the recipient explicitly configured by the owner. */
export async function notifyRequest(request: DocumentRequest): Promise<NotificationResult> {
  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX_ID;
  const recipient = z.email().safeParse(process.env.PUENTE_REVIEW_EMAIL);
  if (!key || !inbox || !recipient.success) return { status: "unavailable", message: "Email approval needs AgentMail configuration and an authorized demo reviewer. The owner can review this request in the dashboard." };
  if (request.status !== "pending") return { status: "unavailable", message: "This request is no longer pending." };
  const db = admin();
  const { data: current } = await db.from("requests").select("email_message_id").eq("id", request.id).single();
  if (current?.email_message_id) return { status: "already_sent", message: "The reviewer has already been notified." };
  try {
    const origin = appUrl();
    const [document, requester, owner] = await Promise.all([
      db.from("documents").select("title,sensitive").eq("id", request.document_id).eq("company_id", request.owner_company_id).single(),
      db.from("companies").select("name").eq("id", request.requester_company_id).single(),
      db.from("companies").select("name").eq("id", request.owner_company_id).single(),
    ]);
    if (!document.data || !requester.data || !owner.data) throw new Error("Request details unavailable.");
    const tokens = await issueApprovalLinks(request.id);
    const links = Object.fromEntries(Object.entries(tokens).map(([action, token]) => [action, `${origin}/approve?token=${encodeURIComponent(token)}`]));
    const title = document.data.title as string;
    const purpose = request.purpose_text;
    const subject = `Puente: review ${requester.data.name}'s document request`;
    const text = `${requester.data.name} requested ${title} from ${owner.data.name}.\nPurpose: ${purpose}\nReason for review: ${request.reason}\n\nApprove: ${links.approve}\nDo not approve: ${links.deny}\nGive a manual response: ${links.manual}\n\nEach link expires after 24 hours and opens a confirmation page. You can also reply to this email with a manual response. Your reply will be shared with the requesting agent; it does not grant document access.\nRequest: ${request.id}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17372e;padding:28px"><p style="font-size:13px;letter-spacing:2px">PUENTE · OWNER REVIEW</p><h1 style="font-size:27px;line-height:1.2">A document request needs your decision.</h1><p><strong>${escapeHtml(requester.data.name)}</strong> requested <strong>${escapeHtml(title)}</strong> from ${escapeHtml(owner.data.name)}.</p><p><strong>Purpose:</strong> ${escapeHtml(purpose)}</p><p><strong>Review reason:</strong> ${escapeHtml(request.reason)}</p><table role="presentation" style="margin:26px 0"><tr><td style="padding:0 8px 12px 0"><a href="${links.approve}" style="display:inline-block;padding:13px 18px;background:#14583f;color:#fff;text-decoration:none;border-radius:8px">Approve</a></td><td style="padding:0 0 12px"><a href="${links.deny}" style="display:inline-block;padding:13px 18px;background:#f2e8e5;color:#7a2f26;text-decoration:none;border-radius:8px">Do not approve</a></td></tr></table><p><a href="${links.manual}" style="color:#14583f">Give a manual response</a></p><p style="font-size:13px;line-height:1.6;color:#58635c">Each link expires after 24 hours and opens a confirmation page. You can also reply to this email. Your response will be shared with the requesting agent and will not grant document access.</p><p style="font-size:11px;color:#69746e">Request ${escapeHtml(request.id)}</p></div>`;
    const response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipient.data, subject, text, html }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { status: "failed", message: "AgentMail did not accept the notification. Review is still available in the owner dashboard." };
    const result = z.object({ message_id: z.string(), thread_id: z.string() }).parse(await response.json());
    const { error } = await db.from("requests").update({ email_thread_id: result.thread_id, email_message_id: result.message_id }).eq("id", request.id);
    return { status: "sent", message: error ? "Approval email sent. Reply tracking could not be saved; use its review links." : "Approval email sent to the configured reviewer." };
  } catch {
    return { status: "failed", message: "Email approval is unavailable. The request is awaiting review in the owner dashboard." };
  }
}
