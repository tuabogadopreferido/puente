/** Local, opt-in SMTP fallback for one fictional pending demo request. Never imported by the app. */
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { admin } from "../src/lib/supabase-admin";
import { issueApprovalLinks } from "../src/lib/approval";
import { renderApprovalEmail } from "../src/lib/email";

const usage =
  "Usage: node --env-file=.env.local --import tsx scripts/demo-email.ts --request <UUID> [--send]\nDefault: validate and render a redacted dry run, without mail or approval-token writes.\nRequired env: PUENTE_REVIEW_EMAIL, PUENTE_SMTP_HELPER (absolute external helper path), NEXT_PUBLIC_APP_URL (production HTTPS), Supabase server settings and APPROVAL_SIGNING_SECRET.\nThe external helper loads its own Gmail credentials. SMTP is never deployed with the app.";
const python = `import importlib.util,json,os,sys
try:
    spec=importlib.util.spec_from_file_location("puente_smtp_helper",sys.argv[1])
    helper=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.load_env()
    payload=json.load(sys.stdin)
    user=os.environ.get("GMAIL_USER")
    password=os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not password:
        raise RuntimeError("SMTP setup missing")
except Exception:
    print(json.dumps({"status":"setup_error"}))
    sys.exit(3)
try:
    helper.send_via_smtp(user=user,password=password,sender=user,sender_name="Puente demo",to=[payload["recipient"]],cc=[],bcc=[],subject=payload["subject"],body=payload["text"],html_body=payload["html"],reply_to=None,attachments=[])
    print(json.dumps({"status":"sent"}))
except Exception:
    print(json.dumps({"status":"send_failed_or_unknown"}))
    sys.exit(4)
`;
type SmtpResult = "sent" | "setup_error" | "send_failed_or_unknown";
async function localSmtp(
  helper: string,
  payload: Record<string, string>,
): Promise<SmtpResult> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: SmtpResult) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    // Signed links travel through stdin, never process arguments, shell strings, files, or stdout.
    const child = spawn(
      process.env.PUENTE_PYTHON_PATH || "python3",
      ["-c", python, helper],
      {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          NODE_ENV: process.env.NODE_ENV || "development",
          PATH: process.env.PATH || "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          PYTHONIOENCODING: "utf-8",
        },
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("send_failed_or_unknown");
    }, 45_000);
    child.stdout.on("data", (chunk) => {
      if (output.length < 8000) output += chunk.toString();
    });
    child.stderr.resume(); // Never echo provider errors or credential-bearing helper diagnostics.
    child.on("error", () => finish("setup_error"));
    child.on("close", () => {
      try {
        const result = JSON.parse(output.trim());
        finish(
          result.status === "sent"
            ? "sent"
            : result.status === "setup_error"
              ? "setup_error"
              : "send_failed_or_unknown",
        );
      } catch {
        finish("send_failed_or_unknown");
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage);
    return;
  }
  if (process.env.VERCEL)
    throw new Error("This SMTP helper is local-only and cannot run in Vercel.");
  const index = args.indexOf("--request");
  if (
    index < 0 ||
    !args[index + 1] ||
    args.some(
      (value, position) =>
        position !== index + 1 && !["--request", "--send"].includes(value),
    )
  )
    throw new Error(usage);
  const requestId = z.uuid().parse(args[index + 1]);
  const shouldSend = args.includes("--send");
  const recipient = z.email().parse(process.env.PUENTE_REVIEW_EMAIL);
  const configuredHelper = process.env.PUENTE_SMTP_HELPER;
  if (!configuredHelper || !isAbsolute(configuredHelper))
    throw new Error(
      "PUENTE_SMTP_HELPER must name the absolute external SMTP helper path.",
    );
  const helper = await realpath(configuredHelper);
  const helperSource = await readFile(helper, "utf8");
  if (
    !helperSource.includes("def send_via_smtp(") ||
    !helperSource.includes("smtp.gmail.com") ||
    !helperSource.includes("def load_env(")
  )
    throw new Error(
      "The configured helper is not the supported Gmail SMTP helper.",
    );
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
  if (
    base.protocol !== "https:" ||
    ["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error(
      "Set NEXT_PUBLIC_APP_URL to the production HTTPS origin before preparing mail.",
    );
  const db = admin();
  const { data: request, error } = await db
    .from("requests")
    .select("*")
    .eq("id", requestId)
    .single();
  if (error || !request || request.status !== "pending")
    throw new Error("Choose exactly one existing pending request.");
  if (request.email_message_id)
    throw new Error(
      "This request already has a notification or a delivery attempt; it will not be sent again.",
    );
  const fictional = new Set([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  if (
    !fictional.has(request.owner_company_id) ||
    !fictional.has(request.requester_company_id)
  )
    throw new Error(
      "SMTP demo is restricted to the fictional Acme and Globex fixtures.",
    );
  const [document, requester, owner, bridge] = await Promise.all([
    db
      .from("documents")
      .select("title")
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
    db
      .from("bridges")
      .select("status,expires_at")
      .eq("id", request.bridge_id)
      .single(),
  ]);
  if (
    !document.data ||
    !requester.data ||
    !owner.data ||
    bridge.data?.status !== "active" ||
    Date.parse(bridge.data.expires_at) <= Date.now()
  )
    throw new Error(
      "Request details are unavailable or its bridge is inactive.",
    );
  const render = (links: Record<string, string>) =>
    renderApprovalEmail({
      requestId,
      documentTitle: document.data!.title,
      requesterName: requester.data!.name,
      ownerName: owner.data!.name,
      purpose: request.purpose_text,
      reason: request.reason,
      links,
      replyViaEmail: false,
    });
  if (!shouldSend) {
    const content = render({
      approve: `${base.origin}/approve?token=REDACTED`,
      deny: `${base.origin}/approve?token=REDACTED`,
      manual: `${base.origin}/approve?token=REDACTED`,
    });
    if (
      !content.html.includes("Give a manual response") ||
      !content.text.includes("does not process email replies")
    )
      throw new Error("Email rendering failed verification.");
    console.log(
      JSON.stringify({
        mode: "dry-run",
        ready: true,
        request_id: requestId,
        recipient_configured: true,
        production_origin: base.origin,
        buttons: ["Approve", "Do not approve", "Give a manual response"],
        manual_response: "signed_page_only",
        expires_after_hours: 24,
        transport: "local_smtp",
        sent: false,
      }),
    );
    return;
  }
  const attempt = `smtp-demo:reserved:${randomUUID()}`;
  const { data: claimed, error: claimError } = await db
    .from("requests")
    .update({ email_message_id: attempt })
    .eq("id", requestId)
    .eq("status", "pending")
    .is("email_message_id", null)
    .select("id")
    .maybeSingle();
  if (claimError || !claimed)
    throw new Error(
      "Another notification attempt already claimed this request.",
    );
  let deliveryStarted = false;
  try {
    const tokens = await issueApprovalLinks(requestId);
    const links = Object.fromEntries(
      Object.entries(tokens).map(([action, token]) => [
        action,
        `${base.origin}/approve?token=${encodeURIComponent(token)}`,
      ]),
    );
    const content = render(links);
    deliveryStarted = true;
    const outcome = await localSmtp(helper, { recipient, ...content });
    if (outcome === "setup_error") {
      deliveryStarted = false;
      throw new Error(
        "The external SMTP helper is not configured or could not start. No send was confirmed.",
      );
    }
    if (outcome !== "sent")
      throw new Error(
        "SMTP delivery failed or is uncertain. This request remains reserved to prevent duplicate mail; inspect delivery before retrying.",
      );
    const marker = attempt.replace(":reserved:", ":sent:");
    const { error: saveError } = await db
      .from("requests")
      .update({ email_message_id: marker, email_thread_id: null })
      .eq("id", requestId)
      .eq("email_message_id", attempt);
    await db.from("access_events").insert({
      company_id: request.owner_company_id,
      actor_company_id: request.owner_company_id,
      bridge_id: request.bridge_id,
      document_id: request.document_id,
      action: "smtp_demo_sent",
      detail: {
        request_id: requestId,
        transport: "local_smtp",
        manual_response: "signed_page_only",
      },
    });
    console.log(
      JSON.stringify({
        status: "sent",
        request_id: requestId,
        transport: "local_smtp",
        recipients: 1,
        tracking_saved: !saveError,
        approval_links: "signed_single_use_24h",
        manual_response: "signed_page_only",
      }),
    );
  } catch (error) {
    if (!deliveryStarted)
      await db
        .from("requests")
        .update({ email_message_id: null })
        .eq("id", requestId)
        .eq("email_message_id", attempt);
    throw error;
  }
}
main().catch((error) => {
  console.error(
    error instanceof z.ZodError
      ? "Invalid or missing demo configuration. Run --help for required settings."
      : error instanceof Error
        ? error.message
        : "SMTP demo failed.",
  );
  process.exitCode = 1;
});
