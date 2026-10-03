import { Webhook } from "svix";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
export const runtime = "nodejs";
const received = z.object({
  event_type: z.literal("message.received"),
  event_id: z.string(),
  message: z.object({
    inbox_id: z.string(),
    thread_id: z.string(),
    message_id: z.string(),
    from: z.string(),
    in_reply_to: z.string().optional(),
    references: z.array(z.string()).optional(),
    extracted_text: z.string().optional(),
    text: z.string().optional(),
  }),
});
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
  const reply = (message.extracted_text || message.text || "")
    .trim()
    .slice(0, 5000);
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
  if (resolutionError) return Response.json({ received: true, applied: false });
  return Response.json({ received: true, applied: true });
}
