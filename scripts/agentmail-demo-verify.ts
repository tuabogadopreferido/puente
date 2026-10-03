/**
 * Opt-in verification of handoff §8.5 / step 70 using synthetic Acme / Globex data.
 * Production request sends one AgentMail message to the configured reviewer; verifies its approval and PDF,
 * then revokes and removes every temporary database row. Never persists credentials.
 * Prepare/review this source first. Actual execution requires --run.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { admin } from "../src/lib/supabase-admin";
import { verifyApprovalToken } from "../src/lib/approval";

const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const usage =
  "Review-only by default. To run the authorized synthetic email demo: node --env-file=.env.local --import tsx scripts/agentmail-demo-verify.ts --run\nRequired process env: PUENTE_REVIEW_EMAIL=reviewer@example.com, AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID, NEXT_PUBLIC_APP_URL=<production HTTPS>. Optional PUENTE_SMTP_HELPER enables read-only Gmail delivery confirmation; it never sends SMTP. Uses Supabase and approval settings already in .env.local.\nTokens remain only in memory. One real email is sent; database fixtures are removed in finally. The email remains in the reviewer's mailbox.";
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
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Python alone loads Gmail credentials. The only stdout is captured JSON for this process.
// Email content and links are never printed, written to files, or used as instructions.
const imapReader = String.raw`import base64,email,email.policy,html,importlib.util,imaplib,json,os,re,sys,time,urllib.parse
from html.parser import HTMLParser
class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.urls=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=="a":
            self.urls.extend(value for key,value in attrs if key.lower()=="href" and value)
mail=None
stage="setup"
try:
    settings=json.load(sys.stdin)
    spec=importlib.util.spec_from_file_location("puente_smtp_credentials",sys.argv[1])
    helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper); helper.load_env()
    user=os.environ.get("GMAIL_USER"); password=os.environ.get("GMAIL_APP_PASSWORD")
    if not user or user.lower()!=settings["recipient"].lower() or not password: raise RuntimeError()
    stage="connect"
    mail=imaplib.IMAP4_SSL("imap.gmail.com",993,timeout=12)
    stage="authenticate"
    mail.login(user,password)
    stage="folders"
    status,listed=mail.list()
    if status!="OK": raise RuntimeError()
    folders=[]
    for raw in listed or []:
        match=re.match(r'\((.*?)\) "[^"]*" (.+)$',raw.decode(errors="replace"))
        if not match: continue
        flags,name=match.groups()
        kind="all" if "\\All" in flags else "spam" if "\\Junk" in flags else "trash" if "\\Trash" in flags else "inbox" if name.strip('"').upper()=="INBOX" else None
        if kind: folders.append((kind,name))
    if not folders: folders=[("inbox","INBOX")]
    expected=urllib.parse.urlsplit(settings["origin"])
    found={}; found_folder=None; searched=set()
    stage="search"
    for attempt in range(5):
        for kind,name in folders:
            status,_=mail.select(name,readonly=True)
            if status!="OK": continue
            searched.add(kind)
            if settings.get("message_id"):
                status,search=mail.uid("search",None,"HEADER","Message-ID",'"'+settings["message_id"]+'"')
            else:
                status,search=mail.uid("search",None,"BODY",'"'+settings["request_id"]+'"')
            ids=(search[0] or b"").split()[-5:] if status=="OK" and search else []
            for message_id in ids:
                status,items=mail.uid("fetch",message_id,"(BODY.PEEK[])")
                if status!="OK": continue
                raw=next((item[1] for item in items if isinstance(item,tuple)),None)
                if not raw: continue
                message=email.message_from_bytes(raw,policy=email.policy.default)
                destinations=[address.lower() for _,address in email.utils.getaddresses(message.get_all("to",[]))]
                if settings["recipient"].lower() not in destinations: continue
                if settings.get("message_id") and message.get("message-id")!=settings["message_id"]: continue
                parts=[]
                for part in message.walk():
                    if part.get_content_type() in ("text/plain","text/html") and part.get_content_disposition()!="attachment":
                        try: parts.append(part.get_content())
                        except Exception: pass
                content="\n".join(parts)
                if settings["request_id"] not in content: continue
                parser=Links(); parser.feed(content)
                urls=parser.urls+re.findall(r"https://[^\s<>\"']+",content)
                for candidate in urls:
                    parsed=urllib.parse.urlsplit(html.unescape(candidate))
                    if parsed.scheme!=expected.scheme or parsed.netloc!=expected.netloc or parsed.path!="/approve": continue
                    token=urllib.parse.parse_qs(parsed.query).get("token",[""])[0]
                    if not token or len(token)>2000: continue
                    try:
                        encoded=token.split(".")[0]; claims=json.loads(base64.urlsafe_b64decode(encoded+"="*((-len(encoded))%4)))
                        if claims.get("requestId")==settings["request_id"] and claims.get("action") in ("approve","deny","manual"):
                            found[claims["action"]]=urllib.parse.urlunsplit(parsed)
                    except Exception: pass
                if len(found)==3: found_folder=kind; break
            if len(found)==3: break
        if len(found)==3: break
        if attempt<4: time.sleep(3)
    print(json.dumps({"status":"found","folder":found_folder,"links":found} if len(found)==3 else {"status":"not_found","searched_folders":sorted(searched)}))
except Exception:
    status="setup_error" if stage=="setup" else "auth_error" if stage=="authenticate" else "mailbox_error" if stage=="folders" else "imap_error"
    print(json.dumps({"status":status,"stage":stage}))
finally:
    if mail:
        try: mail.logout()
        except Exception: pass
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
  let helper: string | undefined;
  if (process.env.PUENTE_SMTP_HELPER) {
    if (!isAbsolute(process.env.PUENTE_SMTP_HELPER))
      throw new Error("Use the absolute external Gmail helper path.");
    helper = await realpath(process.env.PUENTE_SMTP_HELPER);
  }
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
  let requestId: string | undefined;
  let emailSent = false;
  let receivedInGmail = false;
  let gmailDeliveryStatus = "not_requested";
  let gmailFolder: string | null = null;
  let emailSentAtCst: string | null = null;
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
    if (!bridgeId) return;
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
    const login = await client.auth.signInWithPassword({
      email: "acme@puente.demo",
      password: process.env.PUENTE_DEMO_PASSWORD!,
    });
    if (login.error || !login.data.session)
      throw new Error("Fictional demo account login failed.");
    ownerToken = login.data.session.access_token;
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
    if (helper) {
      gmailDeliveryStatus = "unconfirmed";
      try {
        const read = await subprocess(
          process.env.PUENTE_PYTHON_PATH || "python3",
          ["-c", imapReader, helper],
          {
            NODE_ENV: process.env.NODE_ENV || "development",
            PATH: process.env.PATH || "/usr/bin:/bin",
            LANG: "en_US.UTF-8",
            PYTHONIOENCODING: "utf-8",
          },
          JSON.stringify({
            recipient,
            origin: base.origin,
            request_id: requestId,
            message_id: sentMail.message_id,
          }),
          55_000,
        );
        if (read.status !== 0) gmailDeliveryStatus = "subprocess_failed";
        else {
          const result = z
            .object({
              status: z.enum([
                "found",
                "not_found",
                "setup_error",
                "auth_error",
                "mailbox_error",
                "imap_error",
              ]),
            })
            .parse(JSON.parse(read.stdout));
          gmailDeliveryStatus = result.status;
          if (result.status === "found") {
            const received = z
              .object({
                folder: z.enum(["all", "inbox", "spam", "trash"]),
                links: z.object({
                  approve: z.url(),
                  deny: z.url(),
                  manual: z.url(),
                }),
              })
              .parse(JSON.parse(read.stdout));
            receivedInGmail = (["approve", "deny", "manual"] as const).every(
              (action) =>
                new URL(received.links[action]).searchParams.get("token") ===
                new URL(message.links[action]).searchParams.get("token"),
            );
            gmailDeliveryStatus = receivedInGmail
              ? "confirmed"
              : "link_mismatch";
            if (receivedInGmail) {
              gmailFolder = received.folder;
              gmailDeliveryStatus = `delivered_${gmailFolder}`;
              pass(
                `Read-only Gmail inspection confirms the exact AgentMail message in ${gmailFolder}`,
              );
            }
          }
        }
      } catch {
        if (abort.signal.aborted) throw new Error("Verification interrupted.");
        gmailDeliveryStatus = "reader_failed";
      }
      if (!receivedInGmail)
        console.log(
          `DELIVERY ${gmailDeliveryStatus}; continuing the independent signed-approval checks`,
        );
    }
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
    const approved = await success(
      "/api/approvals/confirm",
      undefined,
      "POST",
      { token: tokens.approve, createRule: true },
    );
    z.object({
      request: z.object({
        status: z.literal("approved"),
        rule_created: z.literal(false),
      }),
    }).parse(approved);
    const delivery = z
      .object({
        status: z.literal("delivered"),
        download_url: z.url(),
        sha256: z.string(),
        extracted_text: z.string().min(1),
        receipt: z.object({
          payload: z.record(z.string(), z.unknown()),
          signature: z.string(),
        }),
      })
      .parse(await success(`/api/requests/${requestId}`, agentToken));
    const original = await fetch(delivery.download_url, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]),
    });
    assert.equal(original.status, 200);
    assert.equal(
      hash(new Uint8Array(await original.arrayBuffer())),
      delivery.sha256,
    );
    const verification = z.object({ valid: z.literal(true) }).parse(
      await success("/api/receipts/verify", undefined, "POST", {
        payload: delivery.receipt.payload,
        signature: delivery.receipt.signature,
      }),
    );
    assert(verification.valid);
    pass(
      "Email approval enabled original PDF delivery with matching SHA-256 and Ed25519 receipt",
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
    assert.equal(
      (
        await fetch(delivery.download_url, {
          signal: AbortSignal.timeout(25_000),
        })
      ).status,
      403,
    );
    pass(
      "Consumed and sibling links rejected; revocation blocked token and issued download URL",
    );
  } finally {
    await cleanup();
    ownerToken = "";
    agentToken = "";
  }
  console.log(
    JSON.stringify({
      success: true,
      overall_status: receivedInGmail
        ? gmailFolder === "spam"
          ? "passed_delivered_spam"
          : "passed_with_recipient_delivery"
        : "passed_delivery_unconfirmed",
      approval_flow_verified: true,
      agentmail_provider_status: "accepted",
      email_sent_at_cst: emailSentAtCst,
      checks: passes.length,
      email_sent: emailSent,
      gmail_delivery_confirmed: receivedInGmail,
      gmail_delivery_status: gmailDeliveryStatus,
      gmail_folder: gmailFolder,
      webhook_reply_tested: false,
      recipient_count: emailSent ? 1 : 0,
      temporary_data_removed: true,
      credentials_persisted: false,
      interrupted,
    }),
  );
}
main().catch(() => {
  console.error(
    "AgentMail verification failed. Private errors and tokens were suppressed. Review the PASS lines to locate the failing stage; finally attempted revocation and cleanup.",
  );
  process.exitCode = 1;
});
