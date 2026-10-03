import { Webhook } from "svix";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
export const runtime = "nodejs";
const receivedMessage = z.object({
  inbox_id: z.string(),
  thread_id: z.string(),
  message_id: z.string(),
  from: z.string(),
  labels: z.array(z.string()).optional(),
  in_reply_to: z.string().optional(),
  references: z.array(z.string()).optional(),
  extracted_text: z.string().optional(),
  text: z.string().optional(),
});
const received = z.object({
  event_type: z.literal("message.received"),
  event_id: z.string(),
  message: receivedMessage,
});
function unsafeLabels(labels: string[] | undefined) {
  return (
    labels?.some((label) =>
      ["spam", "blocked", "unauthenticated"].includes(label.toLowerCase()),
    ) ?? false
  );
}
function emailAddress(value: string) {
  return (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
}
export async function POST(request: Request) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  const reviewer = process.env.PUENTE_REVIEW_EMAIL;
  const inbox = process.env.AGENTMAIL_INBOX_ID;
  if (!secret || !reviewer || !inbox)
    return Response.json(
      { error: "Email reply handling is not configured." },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length") || 0) > 1_100_000)
    return new Response(null, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1_100_000)
    return new Response(null, { status: 413 });
  let payload: unknown;
  try {
    new Webhook(secret).verify(raw, {
      "svix-id": request.headers.get("svix-id") || "",
      "svix-timestamp": request.headers.get("svix-timestamp") || "",
      "svix-signature": request.headers.get("svix-signature") || "",
    });
    payload = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: "Invalid webhook signature." },
      { status: 401 },
    );
  }
  const event = received.safeParse(payload);
  if (!event.success) return new Response(null, { status: 204 });
  const message = event.data.message;
  if (
    message.inbox_id !== inbox ||
    unsafeLabels(message.labels) ||
    emailAddress(message.from) !== reviewer.trim().toLowerCase()
  )
    return new Response(null, { status: 204 });
  const db = admin();
  const { data: pending, error } = await db
    .from("requests")
    .select("id,email_message_id,status")
    .eq("email_thread_id", message.thread_id)
    .eq("status", "pending")
    .maybeSingle();
  if (error) return new Response(null, { status: 503 });
  if (
    !pending ||
    !pending.email_message_id ||
    (message.in_reply_to !== pending.email_message_id &&
      !message.references?.includes(pending.email_message_id))
  )
    return new Response(null, { status: 204 });
  // Manual replies are data, never instructions to run tools or implicitly approve access.
  let content = message.extracted_text || message.text;
  if (!content) {
    // AgentMail omits large bodies from its 1 MB webhook; retrieve only this verified message.
    const key = process.env.AGENTMAIL_API_KEY;
    if (!key) return new Response(null, { status: 503 });
    try {
      const response = await fetch(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(message.message_id)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) return new Response(null, { status: 503 });
      const full = receivedMessage.parse(await response.json());
      if (
        full.inbox_id !== inbox ||
        full.thread_id !== message.thread_id ||
        full.message_id !== message.message_id ||
        emailAddress(full.from) !== reviewer.trim().toLowerCase() ||
        unsafeLabels(full.labels) ||
        (full.in_reply_to !== pending.email_message_id &&
          !full.references?.includes(pending.email_message_id))
      )
        return new Response(null, { status: 204 });
      content = full.extracted_text || full.text;
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  const reply = (content || "").trim().slice(0, 5000);
  if (!reply)
    return Response.json(
      { error: "Email body unavailable. Please use the manual response page." },
      { status: 422 },
    );
  const { data: link, error: linkError } = await db
    .from("approval_links")
    .select("token_hash")
    .eq("request_id", pending.id)
    .eq("action", "manual")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (linkError) return new Response(null, { status: 503 });
  if (!link) return new Response(null, { status: 204 });
  const { error: resolutionError } = await db.rpc("consume_approval_link", {
    p_token_hash: link.token_hash,
    p_action: "manual",
    p_create_rule: false,
    p_manual_response: reply,
  });
  // Concurrent retries cannot consume a link twice; the database transaction is authoritative.
  if (resolutionError) {
    // Domain failures (consumed/expired/revoked) are final; transient DB failures should be retried.
    if (!["P0001", "22023"].includes(resolutionError.code))
      return new Response(null, { status: 503 });
    return Response.json({ received: true, applied: false });
  }
  return Response.json({ received: true, applied: true });
}
