/**
 * Opt-in verification of step 55 using synthetic Acme / Globex data and a real AgentMail webhook.
 * Sends one review notification and one explicit manual reply; verifies no PDF is released,
 * then removes correlated temporary rows. Unknown bridge creation requires inspection.
 * Never persists credentials.
 * Prepare/review this source first. Actual execution requires --run.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { admin } from "../src/lib/supabase-admin";
import { verifyApprovalToken } from "../src/lib/approval";

const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const usage =
  "Review-only by default. To run the authorized manual reply demo: node --env-file=.env.local --import tsx scripts/agentmail-reply-verify.ts --run\nRequired env: PUENTE_REVIEW_EMAIL=reviewer@example.com, AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID, AGENTMAIL_WEBHOOK_SECRET, PUENTE_SMTP_HELPER=<absolute canonical helper>, NEXT_PUBLIC_APP_URL=<production HTTPS>, existing Supabase/approval/demo settings.\nAt most one review notification and one manual reply. Gmail credentials remain inside the Python helper. Tokens stay in memory; finally removes database fixtures. Mail remains in both accounts.";
const manualText =
  "Synthetic verification: please contact our finance team. This is a manual response only.";
class UnknownBridgeCreationError extends Error {}
const abort = new AbortController();
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    interrupted = true;
    abort.abort();
  });
const passes: string[] = [];
function pass(label: string) {
  passes.push(label);
  console.log("PASS " + label);
}
// The helper alone loads Gmail secrets. Captured stdout is never echoed.
const smtpReply = String.raw`import importlib.util,json,os,sys
from email.message import EmailMessage
from email.utils import make_msgid
stage="setup"
try:
    settings=json.load(sys.stdin)
    spec=importlib.util.spec_from_file_location("puente_smtp_credentials",sys.argv[1])
    helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper); helper.load_env()
    user=os.environ.get("GMAIL_USER"); password=os.environ.get("GMAIL_APP_PASSWORD")
    if not user or user.lower()!=settings["reviewer"].lower() or not password: raise RuntimeError()
    if settings.get("mode")=="check":
        print(json.dumps({"status":"ready"})); sys.exit(0)
    if settings.get("mode")!="send" or settings["body"]!="Synthetic verification: please contact our finance team. This is a manual response only.": raise RuntimeError()
    parent=settings["parent_message_id"]
    if not parent.startswith("<") or not parent.endswith(">") or "\r" in parent or "\n" in parent: raise RuntimeError()
    reply_id=make_msgid(domain=user.split("@")[-1])
    # The canonical helper has no custom-header parameter. Extend its message factory
    # only inside this short-lived process; never modify the helper or its credential file.
    class ThreadedMessage(EmailMessage):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs)
            self["Message-ID"]=reply_id
            self["In-Reply-To"]=parent
            self["References"]=parent
    helper.EmailMessage=ThreadedMessage
    stage="send"
    helper.send_via_smtp(user=user,password=password,sender=user,sender_name="Puente synthetic review",to=[settings["inbox"]],cc=[],bcc=[],subject="Re: "+settings["subject"],body=settings["body"],html_body=None,reply_to=None,attachments=[])
    print(json.dumps({"status":"sent","message_id":reply_id,"recipients":1}))
except Exception:
    print(json.dumps({"status":"setup_error" if stage=="setup" else "send_failed_or_unknown"})); sys.exit(3)
`;
async function subprocess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input = "",
  timeout = 60_000,
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let finished = false;
    const done = (status: number | null, failed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancel);
      if (failed)
        reject(
          new Error(
            "A local subprocess failed or timed out; private diagnostics were suppressed.",
          ),
        );
      else resolve({ status, stdout });
    };
    const cancel = () => {
      child.kill("SIGTERM");
      done(null, true);
    };
    const timer = setTimeout(cancel, timeout);
    abort.signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 32_000) cancel();
    });
    child.stderr.resume();
    child.on("error", () => done(null, true));
    child.on("close", (status) => done(status));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
    if (abort.signal.aborted) cancel();
  });
}
async function main() {
  if (!process.argv.slice(2).includes("--run")) {
    console.log(usage);
    return;
  }
  if (process.argv.slice(2).some((value) => value !== "--run"))
    throw new Error("Only --run is accepted.");
  if (process.env.VERCEL) throw new Error("This verification is local-only.");
  const recipient = z.email().parse(process.env.PUENTE_REVIEW_EMAIL);
  const inbox = z.email().parse(process.env.AGENTMAIL_INBOX_ID);
  const mailKey = z.string().min(1).parse(process.env.AGENTMAIL_API_KEY);
  z.string().min(16).parse(process.env.AGENTMAIL_WEBHOOK_SECRET);
  if (
    !process.env.PUENTE_SMTP_HELPER ||
    !isAbsolute(process.env.PUENTE_SMTP_HELPER)
  )
    throw new Error("Use the absolute external Gmail helper path.");
  const helper = await realpath(process.env.PUENTE_SMTP_HELPER);
  const pythonEnv = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PATH: process.env.PATH || "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    PYTHONIOENCODING: "utf-8",
  };
  const preflight = await subprocess(
    process.env.PUENTE_PYTHON_PATH || "python3",
    ["-c", smtpReply, helper],
    pythonEnv,
    JSON.stringify({ mode: "check", reviewer: recipient }),
  );
  assert.equal(preflight.status, 0, "SMTP credential preflight failed");
  z.object({ status: z.literal("ready") }).parse(JSON.parse(preflight.stdout));
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
  if (
    base.protocol !== "https:" ||
    ["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error("Configure the production HTTPS origin.");
  const db = admin();
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let ownerToken = "";
  let agentToken = "";
  let bridgeId: string | undefined;
  let bridgeCreationAttempted = false;
  let requestId: string | undefined;
  let emailSent = false;
  let replySent = false;
  let emailSentAtCst: string | null = null;
  let manualAppliedAtCst: string | null = null;
  async function api(
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
  ) {
    const response = await fetch(base.origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45_000)]),
    });
    const data: unknown = await response.json().catch(() => null);
    return { response, data };
  }
  async function success(
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
  ) {
    const result = await api(path, token, method, body);
    if (!result.response.ok)
      throw new Error(
        `Production API verification failed (${result.response.status}) on a fixed test route.`,
      );
    return result.data;
  }
  async function cleanup() {
    if (!bridgeId) {
      if (bridgeCreationAttempted) throw new UnknownBridgeCreationError();
      return;
    }
    // Revoke first, including when an earlier HTTP assertion fails or Ctrl-C is received.
    const revoke = await db
      .from("bridges")
      .update({ status: "revoked" })
      .eq("id", bridgeId);
    if (revoke.error)
      throw new Error(
        "Temporary bridge revocation failed; cleanup needs attention.",
      );
    const requests = await db
      .from("requests")
      .select("id")
      .eq("bridge_id", bridgeId);
    if (requests.error)
      throw new Error("Temporary request lookup failed during cleanup.");
    if (requests.data?.length) {
      const links = await db
        .from("approval_links")
        .delete()
        .in(
          "request_id",
          requests.data.map((row) => row.id),
        );
      if (links.error)
        throw new Error("Temporary approval-link cleanup failed.");
    }
    const receipts = await db
      .from("receipts")
      .delete()
      .eq("payload->>bridge_id", bridgeId);
    if (receipts.error) throw new Error("Temporary receipt cleanup failed.");
    for (const table of [
      "access_events",
      "requests",
      "agent_tokens",
      "access_codes",
    ] as const) {
      const result = await db.from(table).delete().eq("bridge_id", bridgeId);
      if (result.error) throw new Error("Temporary database cleanup failed.");
    }
    const removed = await db.from("bridges").delete().eq("id", bridgeId);
    if (removed.error) throw new Error("Temporary bridge cleanup failed.");
    const remaining = await db.from("bridges").select("id").eq("id", bridgeId);
    assert.equal(
      remaining.data?.length,
      0,
      "Temporary bridge remains after cleanup",
    );
    pass("Temporary bridge revoked and all test rows removed");
  }
  try {
    // This is an invalid, unsigned probe, not a simulated provider event. No request exists yet.
    const webhookReady = await api(
      "/api/webhooks/agentmail",
      undefined,
      "POST",
      {},
    );
    assert.equal(
      webhookReady.response.status,
      401,
      "Deploy the configured webhook secret before this demo",
    );
    pass(
      "Webhook signature verification is configured; SMTP helper credentials match the reviewer",
    );
    const login = await client.auth.signInWithPassword({
      email: "acme@puente.demo",
      password: process.env.PUENTE_DEMO_PASSWORD!,
    });
    if (login.error || !login.data.session)
      throw new Error("Fictional demo account login failed.");
    ownerToken = login.data.session.access_token;
    bridgeCreationAttempted = true;
    const bridge = z.object({ id: z.uuid() }).parse(
      await success("/api/bridges", ownerToken, "POST", {
        counterparty_id: globex,
        expires_in_hours: 1,
      }),
    );
    bridgeId = bridge.id;
    const code = z
      .object({ code: z.string() })
      .parse(
        await success(`/api/bridges/${bridgeId}/code`, ownerToken, "POST", {}),
      );
    const exchange = z.object({ token: z.string() }).parse(
      await success("/api/access/exchange", undefined, "POST", {
        code: code.code,
      }),
    );
    agentToken = exchange.token;
    const catalog = z
      .object({
        documents: z.array(
          z.object({
            id: z.uuid(),
            company_id: z.uuid(),
            document_type: z.string(),
          }),
        ),
        purposes: z.array(z.object({ id: z.uuid(), name: z.string() })),
        offered_documents: z.array(
          z.object({
            id: z.uuid(),
            company_id: z.uuid(),
            sensitive: z.boolean(),
          }),
        ),
      })
      .parse(await success("/api/documents", agentToken));
    assert(catalog.documents.every((document) => document.company_id === acme));
    const financial = catalog.documents.find(
      (document) => document.document_type === "balance_sheet",
    );
    const purpose = catalog.purposes.find(
      (item) => item.name === "Alta como proveedor",
    );
    const offers = catalog.offered_documents
      .filter(
        (document) => document.company_id === globex && !document.sensitive,
      )
      .map((document) => document.id);
    assert(
      financial && purpose && offers.length,
      "Fictional financial demo fixtures missing",
    );
    const requested = z
      .object({
        status: z.literal("pending"),
        request_id: z.uuid(),
        email: z.object({ status: z.string() }).optional(),
      })
      .parse(
        await success("/api/requests", agentToken, "POST", {
          document_id: financial.id,
          purpose_id: purpose.id,
          offered_document_ids: offers,
        }),
      );
    requestId = requested.request_id;
    assert.equal(
      requested.email?.status,
      "sent",
      "The production request did not confirm an AgentMail notification",
    );
    emailSent = true;
    pass(
      "Production API created a financial review and sent one AgentMail notification",
    );
    const tracked = await db
      .from("requests")
      .select("email_message_id,email_thread_id")
      .eq("id", requestId)
      .single();
    assert(
      tracked.data?.email_message_id && tracked.data?.email_thread_id,
      "AgentMail reply tracking was not persisted",
    );
    const mailResponse = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(tracked.data.email_message_id)}`,
      {
        headers: { Authorization: `Bearer ${mailKey}` },
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      },
    );
    assert.equal(
      mailResponse.status,
      200,
      "AgentMail did not return the sent notification",
    );
    const sentMail = z
      .object({
        inbox_id: z.string(),
        message_id: z.string(),
        thread_id: z.string(),
        from: z.string(),
        to: z.array(z.string()),
        text: z.string(),
        subject: z.string(),
        html: z.string().optional(),
        created_at: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(await mailResponse.json());
    if (sentMail.created_at)
      emailSentAtCst =
        new Date(Date.parse(sentMail.created_at) - 6 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 19)
          .replace("T", " ") + " CST (UTC-6)";
    const emailAddress = (value: string) =>
      (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
    assert.equal(sentMail.inbox_id, inbox);
    assert.equal(sentMail.message_id, tracked.data.email_message_id);
    assert.equal(sentMail.thread_id, tracked.data.email_thread_id);
    assert.equal(emailAddress(sentMail.from), inbox.toLowerCase());
    assert.deepEqual(sentMail.to.map(emailAddress), [recipient.toLowerCase()]);
    assert(
      sentMail.text.includes(requestId),
      "Notification request identifier mismatch",
    );
    const located: Record<string, string> = {};
    for (const candidate of sentMail.text.match(/https:\/\/[^\s<>"']+/g) ||
      []) {
      const url = new URL(candidate);
      if (url.origin !== base.origin || url.pathname !== "/approve") continue;
      const claims = verifyApprovalToken(url.searchParams.get("token") || "");
      assert.equal(claims.requestId, requestId);
      located[claims.action] = url.href;
    }
    const message = {
      links: z
        .object({ approve: z.url(), deny: z.url(), manual: z.url() })
        .parse(located),
    };
    pass(
      "AgentMail read API confirms the exact recipient, stored thread and three signed review links",
    );
    const tokens: Record<string, string> = {};
    for (const [action, link] of Object.entries(message.links)) {
      const url = new URL(link);
      assert.equal(url.origin, base.origin);
      assert.equal(url.pathname, "/approve");
      const token = url.searchParams.get("token") || "";
      const claims = verifyApprovalToken(token);
      assert.equal(claims.requestId, requestId);
      assert.equal(claims.action, action);
      tokens[action] = token;
      const page = await fetch(link, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]),
      });
      assert.equal(page.status, 200);
      assert(
        (await page.text()).includes(
          "Opening this page does not change access",
        ),
        "Signed review page did not render",
      );
    }
    const untouched = await db
      .from("requests")
      .select("status")
      .eq("id", requestId)
      .single();
    assert.equal(untouched.data?.status, "pending");
    pass(
      "Three authentic signed links render read-only previews and leave access pending",
    );
    const sentReply = await subprocess(
      process.env.PUENTE_PYTHON_PATH || "python3",
      ["-c", smtpReply, helper],
      pythonEnv,
      JSON.stringify({
        mode: "send",
        reviewer: recipient,
        inbox,
        subject: sentMail.subject,
        parent_message_id: sentMail.message_id,
        body: manualText,
      }),
      45_000,
    );
    assert.equal(
      sentReply.status,
      0,
      "SMTP reply delivery was not confirmed; do not retry automatically",
    );
    const replyResult = z
      .object({
        status: z.literal("sent"),
        message_id: z.string(),
        recipients: z.literal(1),
      })
      .parse(JSON.parse(sentReply.stdout));
    replySent = true;
    pass(
      "One manual reply sent through the external SMTP helper with the original reply headers",
    );
    const deadline = Date.now() + 60_000;
    let manualObserved = false;
    let polls = 0;
    while (Date.now() < deadline) {
      const state = z
        .object({
          status: z.string(),
          manual_response: z.string().nullable().optional(),
        })
        .passthrough()
        .parse(await success(`/api/requests/${requestId}`, agentToken));
      for (const field of [
        "download_url",
        "receipt",
        "sha256",
        "extracted_text",
      ])
        assert(
          !(field in state),
          "Manual response exposed document delivery data",
        );
      if (state.status === "manual") {
        assert.equal(state.manual_response, manualText);
        manualObserved = true;
        manualAppliedAtCst =
          new Date(Date.now() - 6 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 19)
            .replace("T", " ") + " CST (UTC-6)";
        break;
      }
      assert.equal(
        state.status,
        "pending",
        "Unexpected decision while waiting for the manual reply",
      );
      polls++;
      if (polls % 5 === 0)
        console.log(
          "WAIT Provider webhook has not applied the manual reply yet",
        );
      await wait(3000, undefined, { signal: abort.signal });
    }
    assert(
      manualObserved,
      "The real provider webhook did not apply the manual reply within 60 seconds",
    );
    pass(
      "Real AgentMail delivery applied the exact manual response without releasing a PDF",
    );
    const inboundResponse = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(replyResult.message_id)}`,
      {
        headers: { Authorization: `Bearer ${mailKey}` },
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      },
    );
    assert.equal(
      inboundResponse.status,
      200,
      "AgentMail did not retain the received reply",
    );
    const inbound = z
      .object({
        inbox_id: z.string(),
        message_id: z.string(),
        thread_id: z.string(),
        from: z.string(),
        in_reply_to: z.string(),
        references: z.array(z.string()),
        labels: z.array(z.string()),
      })
      .parse(await inboundResponse.json());
    assert.equal(inbound.inbox_id, inbox);
    assert.equal(inbound.message_id, replyResult.message_id);
    assert.equal(inbound.thread_id, sentMail.thread_id);
    assert.equal(emailAddress(inbound.from), recipient.toLowerCase());
    assert.equal(inbound.in_reply_to, sentMail.message_id);
    assert(inbound.references.includes(sentMail.message_id));
    assert(inbound.labels.includes("received"));
    assert(
      !inbound.labels.some((label) =>
        ["spam", "blocked", "unauthenticated"].includes(label),
      ),
    );
    const [stored, allLinks, receipts, approved] = await Promise.all([
      db
        .from("requests")
        .select("status,manual_response")
        .eq("id", requestId)
        .single(),
      db
        .from("approval_links")
        .select("action,used_at")
        .eq("request_id", requestId),
      db.from("receipts").select("id").eq("payload->>bridge_id", bridgeId),
      db
        .from("requests")
        .select("id")
        .eq("bridge_id", bridgeId)
        .eq("status", "approved"),
    ]);
    for (const result of [stored, allLinks, receipts, approved])
      assert.equal(result.error, null);
    assert.equal(stored.data?.status, "manual");
    assert.equal(stored.data?.manual_response, manualText);
    assert.equal(allLinks.data?.length, 3);
    assert(allLinks.data?.every((link) => link.used_at));
    assert.equal(receipts.data?.length, 0);
    assert.equal(approved.data?.length, 0);
    pass(
      "Received reply matches the original thread; all three links are consumed and no financial access or receipt exists",
    );
    for (const action of ["approve", "deny", "manual"]) {
      const repeat = await api("/api/approvals/confirm", undefined, "POST", {
        token: tokens[action],
        manualResponse:
          action === "manual" ? "This replay must be rejected" : undefined,
      });
      assert.equal(
        repeat.response.status,
        400,
        "Approval replay or sibling action was accepted",
      );
    }
    await success(`/api/bridges/${bridgeId}/revoke`, ownerToken, "POST", {});
    assert.equal(
      (await api("/api/documents", agentToken)).response.status,
      403,
    );
    pass(
      "Consumed approval links reject replay; revocation disables the temporary agent token",
    );
  } finally {
    await cleanup();
    ownerToken = "";
    agentToken = "";
  }
  console.log(
    JSON.stringify({
      success: true,
      checks: passes.length,
      real_webhook_reply_verified: true,
      review_emails_sent: emailSent ? 1 : 0,
      manual_replies_sent: replySent ? 1 : 0,
      no_document_delivery: true,
      email_sent_at_cst: emailSentAtCst,
      manual_applied_at_cst: manualAppliedAtCst,
      temporary_data_removed: true,
      credentials_persisted: false,
      interrupted,
    }),
  );
}
main().catch((error: unknown) => {
  if (error instanceof UnknownBridgeCreationError) {
    console.error(
      "Bridge creation was attempted without a confirmed ID. Creation outcome and cleanup are unknown; inspection is required before rerunning. No uncorrelated rows were searched or deleted.",
    );
    process.exitCode = 1;
    return;
  }
  console.error(
    "AgentMail manual-reply verification failed. Private errors and tokens were suppressed. Review the PASS lines to locate the failing stage; finally attempted revocation and cleanup.",
  );
  process.exitCode = 1;
});
