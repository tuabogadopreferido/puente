/** Offline contract checks. No credential file is read and every fetch is intercepted. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Webhook } from "svix";
import type { DocumentRequest } from "../src/lib/types";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-database-key";
process.env.AGENTMAIL_API_KEY = "offline-mail-key";
process.env.AGENTMAIL_INBOX_ID = "puente@example.test";
process.env.PUENTE_REVIEW_EMAIL = "reviewer@example.test";
process.env.NEXT_PUBLIC_APP_URL = "https://puente.example.test";
process.env.APPROVAL_SIGNING_SECRET = randomBytes(32).toString("hex");
process.env.AGENTMAIL_WEBHOOK_SECRET =
  "whsec_" + randomBytes(32).toString("base64");
const fixture: DocumentRequest = {
  id: "33333333-3333-4333-8333-333333333333",
  bridge_id: "44444444-4444-4444-8444-444444444444",
  owner_company_id: "11111111-1111-4111-8111-111111111111",
  requester_company_id: "22222222-2222-4222-8222-222222222222",
  document_id: "55555555-5555-4555-8555-555555555555",
  purpose_id: null,
  purpose_text: "Extraordinary purpose",
  status: "pending",
  reason: "Financial figures",
  offered_document_ids: [],
  manual_response: null,
  email_thread_id: null,
  email_message_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
type Row = Record<string, unknown>;
let row: Row;
let links: Row[];
let sends: number;
let consumed: number;
let fullReads: number;
let providerMode: "success" | "timeout";
let failLinks: boolean;
let transientRpc: boolean;
let outgoing: Row | undefined;
let receivedFull: Row;
function reset() {
  row = { ...fixture };
  links = [];
  sends = 0;
  consumed = 0;
  fullReads = 0;
  providerMode = "success";
  failLinks = false;
  transientRpc = false;
  outgoing = undefined;
  receivedFull = {};
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
function matches(candidate: Row, url: URL) {
  return [...url.searchParams].every(([key, value]) => {
    if (["select", "order", "limit"].includes(key)) return true;
    if (value === "is.null") return candidate[key] == null;
    if (value.startsWith("eq."))
      return String(candidate[key]) === value.slice(3);
    if (value.startsWith("gt.")) return String(candidate[key]) > value.slice(3);
    throw new Error("Unexpected offline query operator");
  });
}
// This replacement intentionally has no path to the original fetch.
globalThis.fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const headers = req.headers;
  if (url.origin === "https://api.agentmail.to") {
    assert.equal(headers.get("authorization"), "Bearer offline-mail-key");
    assert.equal(req.redirect, "error");
    if (req.method === "POST" && url.pathname.endsWith("/messages/send")) {
      sends++;
      assert.equal(
        headers.get("idempotency-key"),
        `puente-request-${fixture.id}`,
      );
      outgoing = (await req.json()) as Row;
      assert.deepEqual(outgoing.to, ["reviewer@example.test"]);
      assert.equal(outgoing.cc, undefined);
      assert.equal(outgoing.bcc, undefined);
      if (providerMode === "timeout")
        throw new Error("Simulated uncertain delivery");
      return json({
        message_id: "<notification@example.test>",
        thread_id: "thread-fixture",
      });
    }
    assert.equal(req.method, "GET");
    assert(url.pathname.endsWith("/messages/%3Creply%40example.test%3E"));
    fullReads++;
    return json(receivedFull);
  }
  assert.equal(
    url.origin,
    "https://supabase.example.test",
    "Unexpected network destination",
  );
  const table = url.pathname.split("/").at(-1);
  if (table === "consume_approval_link") {
    if (transientRpc)
      return json(
        { code: "08006", message: "Temporary connection failure" },
        503,
      );
    const body = (await req.json()) as Row;
    assert.equal(body.p_action, "manual");
    assert.equal(body.p_create_rule, false);
    const link = links.find(
      (item) => item.token_hash === body.p_token_hash && item.used_at == null,
    );
    if (!link || row.status !== "pending")
      return json({ code: "P0001", message: "Already used" }, 400);
    row.status = "manual";
    row.manual_response = body.p_manual_response;
    consumed++;
    links.forEach((item) => {
      item.used_at = new Date().toISOString();
    });
    return json(row);
  }
  if (table === "approval_links" && req.method === "POST") {
    if (failLinks)
      return json(
        { code: "XX000", message: "Synthetic insertion failure" },
        500,
      );
    links.push(...((await req.json()) as Row[]));
    return new Response(null, { status: 201 });
  }
  const patch =
    req.method === "PATCH" ? ((await req.json()) as Row) : undefined;
  let rows: Row[] = [];
  if (table === "requests") rows = matches(row, url) ? [row] : [];
  else if (table === "approval_links")
    rows = links.filter((item) => matches(item, url));
  else if (table === "documents")
    rows = [{ title: "Balance sheet <sample>", sensitive: true }];
  else if (table === "companies") rows = [{ name: "Fictional & Company" }];
  else throw new Error("Unexpected offline database table");
  if (req.method === "PATCH") {
    rows.forEach((item) => Object.assign(item, patch));
    if (!headers.get("prefer")?.includes("return=representation"))
      return new Response(null, { status: 204 });
  } else assert.equal(req.method, "GET");
  const limited = url.searchParams.has("limit")
    ? rows.slice(0, Number(url.searchParams.get("limit")))
    : rows;
  return json(
    headers.get("accept")?.includes("vnd.pgrst.object")
      ? (limited[0] ?? null)
      : limited,
  );
};
let checks = 0;
function pass(label: string) {
  checks++;
  console.log("PASS " + label);
}
async function main() {
  const { notifyRequest } = await import("../src/lib/email");
  const { verifyApprovalToken } = await import("../src/lib/approval");
  const { POST } = await import("../src/app/api/webhooks/agentmail/route");
  reset();
  const race = await Promise.all([
    notifyRequest(fixture),
    notifyRequest(fixture),
  ]);
  assert.equal(race.filter((result) => result.status === "sent").length, 1);
  assert.equal(sends, 1);
  assert.equal(links.length, 3);
  assert.equal(row.email_message_id, "<notification@example.test>");
  assert.equal(row.email_thread_id, "thread-fixture");
  const body = outgoing!;
  assert(String(body.html).includes("&lt;sample&gt;"));
  const tokens = [
    ...String(body.text).matchAll(
      /https:\/\/puente\.example\.test\/approve\?token=(\S+)/g,
    ),
  ].map((match) => verifyApprovalToken(decodeURIComponent(match[1])));
  assert.deepEqual(tokens.map((token) => token.action).sort(), [
    "approve",
    "deny",
    "manual",
  ]);
  pass(
    "Concurrent notification calls issue one email, one three-link set, and a stable provider idempotency key",
  );
  assert.equal((await notifyRequest(fixture)).status, "already_sent");
  assert.equal(sends, 1);
  pass("A completed notification never sends twice");
  reset();
  providerMode = "timeout";
  assert.equal((await notifyRequest(fixture)).status, "failed");
  assert(String(row.email_message_id).startsWith("agentmail:reserved:"));
  assert.equal((await notifyRequest(fixture)).status, "failed");
  assert.equal(sends, 1);
  pass(
    "Ambiguous network delivery retains its durable reservation and blocks duplicate mail",
  );
  reset();
  failLinks = true;
  assert.equal((await notifyRequest(fixture)).status, "failed");
  assert.equal(row.email_message_id, null);
  assert.equal(sends, 0);
  pass("Failure before the provider call releases the claim without sending");
  reset();
  row.status = "approved";
  assert.equal((await notifyRequest(fixture)).status, "unavailable");
  assert.equal(sends, 0);
  pass("Stale caller state cannot notify an already-resolved request");
  reset();
  delete process.env.PUENTE_REVIEW_EMAIL;
  assert.equal((await notifyRequest(fixture)).status, "unavailable");
  assert.equal(sends, 0);
  process.env.PUENTE_REVIEW_EMAIL = "reviewer@example.test";
  pass("No configured recipient means no mail");

  const baseMessage = {
    inbox_id: "puente@example.test",
    thread_id: "thread-fixture",
    message_id: "<reply@example.test>",
    from: "Reviewer <reviewer@example.test>",
    in_reply_to: "<notification@example.test>",
    labels: ["received"],
    extracted_text: "Manual answer; do not approve the document.",
  };
  function pending() {
    reset();
    row.email_thread_id = "thread-fixture";
    row.email_message_id = "<notification@example.test>";
    links.push({
      request_id: fixture.id,
      action: "manual",
      token_hash: "synthetic-hash",
      used_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });
  }
  async function deliver(
    message: Row = baseMessage,
    eventType = "message.received",
    signed = true,
    old = false,
  ) {
    const raw = JSON.stringify({
      type: "event",
      event_id: "event-fixture",
      event_type: eventType,
      message,
    });
    const date = new Date(Date.now() - (old ? 600_000 : 0));
    const id = "svix-fixture";
    const signature = signed
      ? new Webhook(process.env.AGENTMAIL_WEBHOOK_SECRET!).sign(id, date, raw)
      : "v1,invalid";
    return POST(
      new Request("https://puente.example.test/api/webhooks/agentmail", {
        method: "POST",
        body: raw,
        headers: {
          "svix-id": id,
          "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
          "svix-signature": signature,
        },
      }),
    );
  }
  pending();
  assert.equal(
    (await deliver(baseMessage, "message.received", false)).status,
    401,
  );
  assert.equal(consumed, 0);
  assert.equal(
    (await deliver(baseMessage, "message.received", true, true)).status,
    401,
  );
  assert.equal(consumed, 0);
  pass(
    "Forged signatures and stale Svix timestamps cannot reach approval state",
  );
  for (const change of [
    { inbox_id: "foreign@example.test" },
    { from: "attacker@example.test" },
    { thread_id: "wrong-thread" },
    { in_reply_to: "wrong-message" },
    { labels: ["spam"] },
  ]) {
    pending();
    assert.equal((await deliver({ ...baseMessage, ...change })).status, 204);
    assert.equal(consumed, 0);
  }
  for (const kind of [
    "message.received.spam",
    "message.received.blocked",
    "message.received.unauthenticated",
    "message.sent",
  ]) {
    pending();
    assert.equal((await deliver(baseMessage, kind)).status, 204);
    assert.equal(consumed, 0);
  }
  pass(
    "Inbox, reviewer, reply chain, labels and event type all restrict manual replies",
  );
  pending();
  const results = await Promise.all([deliver(), deliver()]);
  assert(results.every((result) => result.ok));
  assert.equal(consumed, 1);
  assert.equal(row.status, "manual");
  assert.equal(row.manual_response, baseMessage.extracted_text);
  assert.equal((await deliver()).status, 204);
  assert.equal(consumed, 1);
  pass(
    "Concurrent webhook delivery and retries consume the manual response exactly once",
  );
  pending();
  receivedFull = {
    ...baseMessage,
    extracted_text: "Large reply recovered through the scoped API",
  };
  assert.equal(
    (await deliver({ ...baseMessage, extracted_text: undefined })).status,
    200,
  );
  assert.equal(fullReads, 1);
  assert.equal(consumed, 1);
  assert.equal(row.manual_response, receivedFull.extracted_text);
  pass("An omitted body is fetched from the verified inbox and message only");
  pending();
  receivedFull = { ...baseMessage, from: "attacker@example.test" };
  assert.equal(
    (await deliver({ ...baseMessage, extracted_text: undefined })).status,
    204,
  );
  assert.equal(consumed, 0);
  pass("A mismatched fetched message cannot supply reply content");
  pending();
  transientRpc = true;
  assert.equal((await deliver()).status, 503);
  assert.equal(consumed, 0);
  pass(
    "Transient database failures request a provider retry rather than dropping replies",
  );
  console.log(
    JSON.stringify({
      success: true,
      checks,
      real_network_requests: 0,
      real_emails_sent: 0,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
