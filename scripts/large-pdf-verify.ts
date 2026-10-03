/** Opt-in production regression: synthetic 16 MiB PDF, no real documents or email. */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute to verify synthetic uploads in production.",
  );
  process.exit(0);
}
loadEnvConfig(process.cwd());
const base = "https://puente-phi.vercel.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = process.env.PUENTE_DEMO_PASSWORD!;
if (
  !url ||
  !service ||
  !anon ||
  !password ||
  new URL(url).hostname !== "iuhxutsngsmpzjaklzlp.supabase.co"
)
  throw new Error("Expected Puente demo environment is unavailable");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, service, opts);
const uploader = createClient(url, anon, opts);
const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const run = randomUUID();
const bridgeId = randomUUID();
const names = [`large-pdf-check-${run}.pdf`, `invalid-pdf-check-${run}.pdf`];
const sessions = new Map<string, string>();
const checks: string[] = [];
let baseline = "";
let bridgeAttempted = false;
class CheckError extends Error {}
function must(value: unknown, message: string): asserts value {
  if (!value) throw new CheckError(message);
}
function pass(message: string) {
  checks.push(message);
  console.log("PASS " + message);
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const initialized = z.object({
  uploadId: z.uuid(),
  path: z.string(),
  token: z.string(),
});
const documentSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  title: z.string(),
  sha256: z.string(),
  storage_path: z.string(),
  document_type: z.string(),
  classification_source: z.string(),
});
const completeSchema = z.object({
  document: documentSchema,
  notice: z.string(),
});
const deliverySchema = z.object({
  download_url: z.string().url(),
  sha256: z.string(),
  receipt: z.object({
    payload: z.record(z.string(), z.unknown()),
    signature: z.string(),
  }),
  offered_document_ids: z.array(z.string()).optional(),
});

async function request(
  path: string,
  token = "",
  body?: unknown,
  method = "POST",
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(150_000),
  });
  const data: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
async function login(email: string) {
  const client = createClient(url, anon, opts);
  const result = await client.auth.signInWithPassword({ email, password });
  must(!result.error && result.data.session, "Demo authentication failed");
  return { token: result.data.session.access_token, client };
}
async function seedSnapshot() {
  const ids = [1, 2].flatMap((company) =>
    Array.from(
      { length: 8 },
      (_, i) =>
        `dddd0000-000${company}-4000-8000-${String(i + 1).padStart(12, "0")}`,
    ),
  );
  const exact = await db
    .from("documents")
    .select("id,title,sha256,classification_source")
    .in("id", ids)
    .order("id");
  must(
    !exact.error && exact.data.length === 16,
    "Expected synthetic seed baseline not found",
  );
  return JSON.stringify(exact.data);
}
async function initialize(filename: string, size: number, token: string) {
  const result = await request("/api/documents/upload/init", token, {
    filename,
    size,
  });
  must(result.ok, "Upload initialization failed");
  const parsed = initialized.safeParse(result.data);
  must(parsed.success, "Unexpected upload initialization response");
  const upload = parsed.data;
  must(
    upload.path === `${acme}/${upload.uploadId}.pdf`,
    "Upload path escaped the authenticated company",
  );
  sessions.set(upload.uploadId, upload.path);
  return upload;
}
async function verifyDelivery(
  value: unknown,
  original: Uint8Array,
  label: string,
) {
  const parsed = deliverySchema.safeParse(value);
  must(parsed.success, `${label}: invalid delivery response`);
  const delivery = parsed.data;
  const target = new URL(delivery.download_url);
  must(
    target.origin === base && target.pathname.startsWith("/api/"),
    `${label}: download escaped Puente`,
  );
  const response = await fetch(target, {
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  must(
    response.ok &&
      response.headers.get("content-type")?.includes("application/pdf"),
    `${label}: PDF download failed`,
  );
  const downloaded = new Uint8Array(await response.arrayBuffer());
  must(
    downloaded.length === original.length &&
      sha(downloaded) === sha(original) &&
      delivery.sha256 === sha(original),
    `${label}: original bytes or SHA differ`,
  );
  const verified = await request("/api/receipts/verify", "", {
    payload: delivery.receipt.payload,
    signature: delivery.receipt.signature,
  });
  must(
    verified.ok &&
      z.object({ valid: z.literal(true) }).safeParse(verified.data).success,
    `${label}: receipt verification failed`,
  );
  pass(`${label}: full 16 MiB original and signed receipt verified`);
  return delivery;
}
async function main() {
  baseline = await seedSnapshot();
  const [{ token: owner, client: ownerClient }, { token: other }] =
    await Promise.all([login("acme@puente.demo"), login("globex@puente.demo")]);
  const noAuth = await request("/api/documents/upload/init", "", {
    filename: names[0],
    size: 1024,
  });
  const oversize = await request("/api/documents/upload/init", owner, {
    filename: names[0],
    size: 20 * 1024 * 1024 + 1,
  });
  must(
    noAuth.status === 401 && [400, 413].includes(oversize.status),
    "Auth or 20 MiB limit was not enforced",
  );
  pass("Unauthenticated and oversized uploads rejected before Storage");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = [
    "SYNTHETIC SOFTWARE TEST. NOT AN OFFICIAL DOCUMENT.",
    "Fictional Acme Supplies company",
    "SAT opinion del cumplimiento de obligaciones fiscales",
    "Positive tax compliance opinion. All filing obligations are current.",
    "No financial amounts. Valid until 2027-12-31.",
  ];
  lines.forEach((line, i) =>
    page.drawText(line, { x: 35, y: 750 - i * 28, size: 11, font }),
  );
  // Valid unreferenced stream makes the original large without real or hidden user data.
  pdf.context.register(
    pdf.context.stream(new Uint8Array(16 * 1024 * 1024).fill(32)),
  );
  const original = await pdf.save({ useObjectStreams: false });
  must(
    original.length > 16 * 1024 * 1024 && original.length < 20 * 1024 * 1024,
    "Synthetic PDF has an unexpected size",
  );
  const upload = await initialize(names[0], original.length, owner);
  const isolation = await request("/api/documents/upload/complete", other, {
    uploadId: upload.uploadId,
  });
  must(
    [403, 404].includes(isolation.status),
    "Another company could finalize the upload",
  );
  const deniedDirect = await ownerClient
    .from("document_upload_sessions")
    .select("id")
    .eq("id", upload.uploadId);
  must(
    deniedDirect.error || deniedDirect.data?.length === 0,
    "Private upload sessions were exposed to browser role",
  );
  pass("Upload session is private and bound to its owner");
  const storage = await uploader.storage
    .from("documents")
    .uploadToSignedUrl(upload.path, upload.token, original, {
      contentType: "application/pdf",
      upsert: false,
    });
  must(!storage.error, "Direct signed Storage upload failed");
  pass("16 MiB original uploaded directly to private Storage");
  const completions = await Promise.all([
    request("/api/documents/upload/complete", owner, {
      uploadId: upload.uploadId,
    }),
    request("/api/documents/upload/complete", owner, {
      uploadId: upload.uploadId,
    }),
  ]);
  const completed = completions.find((response) => response.ok);
  must(
    completed &&
      completions.every((response) => response.ok || response.status === 409),
    "Concurrent finalization failed unexpectedly",
  );
  const parsed = completeSchema.safeParse(completed.data);
  must(parsed.success, "Unexpected completion response");
  const doc = parsed.data.document;
  must(
    doc.id === upload.uploadId &&
      doc.company_id === acme &&
      doc.sha256 === sha(original),
    "Original metadata did not match upload",
  );
  const replay = await request("/api/documents/upload/complete", owner, {
    uploadId: upload.uploadId,
  });
  const repeated = completeSchema.safeParse(replay.data);
  must(
    replay.ok && repeated.success && repeated.data.document.id === doc.id,
    "Completion retry was not idempotent",
  );
  pass(
    "Concurrent completion and replay preserve one document with original SHA",
  );
  must(
    doc.classification_source === "claude_anthropic" &&
      doc.document_type === "tax_compliance",
    "Real Claude classification did not return the synthetic compliance type",
  );
  pass("Real Claude classification returned tax_compliance");
  const ownerDelivery = await request(
    `/api/owner/documents/${doc.id}/download`,
    owner,
  );
  must(ownerDelivery.ok, "Owner delivery authorization failed");
  await verifyDelivery(
    ownerDelivery.data,
    original,
    "Owner streaming download",
  );

  const malformed = new TextEncoder().encode(
    "This is not a PDF. It is a synthetic negative test.",
  );
  const bad = await initialize(names[1], malformed.length, owner);
  const badStorage = await uploader.storage
    .from("documents")
    .uploadToSignedUrl(bad.path, bad.token, malformed, {
      contentType: "application/pdf",
      upsert: false,
    });
  must(!badStorage.error, "Negative fixture could not be staged");
  const rejected = await request("/api/documents/upload/complete", owner, {
    uploadId: bad.uploadId,
  });
  must([400, 422].includes(rejected.status), "A non-PDF was accepted");
  const badDoc = await db.from("documents").select("id").eq("id", bad.uploadId);
  must(
    !badDoc.error && badDoc.data.length === 0,
    "Invalid original was published as a document",
  );
  pass("Server rejects forged PDF content without publishing metadata");

  // Dedicated bridge UUID ensures exact cleanup even if a network response is lost.
  bridgeAttempted = true;
  const bridge = await db
    .from("bridges")
    .insert({
      id: bridgeId,
      company_a_id: acme,
      company_b_id: globex,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  must(!bridge.error, "Temporary bridge fixture could not be created");
  const issued = await request(`/api/bridges/${bridgeId}/code`, owner, {});
  const code = z.object({ code: z.string() }).safeParse(issued.data);
  must(issued.ok && code.success, "Scoped access code failed");
  const exchange = await request("/api/access/exchange", "", {
    code: code.data.code,
  });
  const tokenResult = z.object({ token: z.string() }).safeParse(exchange.data);
  must(exchange.ok && tokenResult.success, "Scoped code exchange failed");
  const token = tokenResult.data.token;
  const purpose = await db
    .from("purposes")
    .select("id")
    .eq("company_id", acme)
    .eq("name", "Alta como proveedor")
    .single();
  must(!purpose.error && purpose.data, "Expected purpose fixture unavailable");
  const rules = await db
    .from("rules")
    .select("id")
    .eq("company_id", acme)
    .eq("document_type", "tax_compliance")
    .eq("purpose_id", purpose.data.id)
    .or(`counterparty_id.is.null,counterparty_id.eq.${globex}`);
  must(
    !rules.error && rules.data.length > 0,
    "No automatic rule; refusing to send an approval email",
  );
  const input = { document_id: doc.id, purpose_id: purpose.data.id };
  for (const offered of [undefined, []]) {
    const result = await request("/api/requests", token, {
      ...input,
      ...(offered === undefined ? {} : { offered_document_ids: offered }),
    });
    const delivered = z
      .object({
        status: z.literal("delivered"),
        offered_document_ids: z.array(z.string()).length(0),
      })
      .safeParse(result.data);
    must(
      result.ok && delivered.success,
      "Optional offers did not yield a delivery with zero offers",
    );
    if (offered !== undefined) {
      const download = await verifyDelivery(
        result.data,
        original,
        "Counterparty streaming download",
      );
      const revoke = await request(
        `/api/bridges/${bridgeId}/revoke`,
        owner,
        {},
      );
      must(revoke.ok, "Temporary bridge revocation failed");
      const blocked = await fetch(download.download_url, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      must(
        blocked.status === 403,
        "Previously issued large-PDF ticket survived revocation",
      );
      pass("Revocation blocks an already-issued large-PDF ticket");
    } else {
      const forged = await request("/api/requests", token, {
        ...input,
        offered_document_ids: [doc.id],
      });
      must(
        forged.status === 403,
        "Foreign reciprocal offer bypassed company checks",
      );
    }
  }
  pass(
    "Omitted and empty reciprocal offers work; foreign offers remain rejected",
  );
}
async function cleanup() {
  // Recover our uniquely named intents if init succeeded but its response was lost.
  const found = await db
    .from("document_upload_sessions")
    .select("id,storage_path")
    .eq("company_id", acme)
    .in("filename", names);
  must(!found.error, "Temporary upload discovery failed");
  for (const row of found.data) {
    must(
      row.storage_path === `${acme}/${row.id}.pdf`,
      "Cleanup scope mismatch",
    );
    sessions.set(row.id, row.storage_path);
  }
  if (bridgeAttempted) {
    const requestRows = await db
      .from("requests")
      .select("id")
      .eq("bridge_id", bridgeId);
    must(!requestRows.error, "Cleanup request lookup failed");
    if (requestRows.data.length)
      must(
        !(
          await db
            .from("approval_links")
            .delete()
            .in(
              "request_id",
              requestRows.data.map((row) => row.id),
            )
        ).error,
        "Approval cleanup failed",
      );
    for (const table of [
      "access_events",
      "requests",
      "access_codes",
      "agent_tokens",
    ])
      must(
        !(await db.from(table).delete().eq("bridge_id", bridgeId)).error,
        "Bridge traces cleanup failed",
      );
    must(
      !(
        await db
          .from("receipts")
          .delete()
          .filter("payload->>bridge_id", "eq", bridgeId)
      ).error,
      "Bridge receipt cleanup failed",
    );
    must(
      !(await db.from("bridges").delete().eq("id", bridgeId)).error,
      "Temporary bridge cleanup failed",
    );
  }
  for (const [id, path] of sessions) {
    must(
      !(
        await db
          .from("receipts")
          .delete()
          .eq("company_id", acme)
          .filter("payload->>document_id", "eq", id)
      ).error,
      "Owner receipt cleanup failed",
    );
    must(
      !(
        await db
          .from("access_events")
          .delete()
          .eq("company_id", acme)
          .eq("document_id", id)
      ).error,
      "Owner audit cleanup failed",
    );
    must(
      !(
        await db
          .from("document_upload_sessions")
          .delete()
          .eq("id", id)
          .eq("company_id", acme)
          .in("filename", names)
      ).error,
      "Upload session cleanup failed",
    );
    must(
      !(await db.from("documents").delete().eq("id", id).eq("company_id", acme))
        .error,
      "Document cleanup failed",
    );
    must(
      !(await db.storage.from("documents").remove([path])).error,
      "Original cleanup failed",
    );
    const objects = await db.storage
      .from("documents")
      .list(acme, { search: `${id}.pdf` });
    must(
      !objects.error &&
        !objects.data.some((object) => object.name === `${id}.pdf`),
      "Temporary original remained",
    );
  }
  if (baseline)
    must(
      (await seedSnapshot()) === baseline,
      "Seed records changed during verification",
    );
  pass(
    "Temporary sessions, originals and bridge removed; all 16 seeds unchanged",
  );
}
async function runChecks() {
  let failure = "";
  try {
    await main();
  } catch (error) {
    failure =
      error instanceof CheckError
        ? error.message
        : "Unexpected verification error; sensitive details suppressed";
  }
  try {
    await cleanup();
  } catch (error) {
    failure += ` Cleanup: ${error instanceof CheckError ? error.message : "failed; inspect temporary large-pdf-check records"}`;
  }
  if (failure) {
    console.error("FAIL " + failure);
    process.exitCode = 1;
  } else console.log(`PASS ${checks.length} production checks`);
}
void runChecks();
