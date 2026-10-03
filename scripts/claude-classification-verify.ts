/**
 * Real production classification check. Two uploads maximum; no model preflight or retries.
 * Run only after confirming the deployed classifier uses direct Anthropic without fallback.
 * Authentication material and generated PDFs stay in memory. No bridge is created or changed.
 */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute only after the direct-Anthropic production deployment is ready.",
  );
  process.exit(0);
}

loadEnvConfig(process.cwd());
const base = (
  process.env.PUENTE_TEST_URL || "https://puente-phi.vercel.app"
).replace(/\/$/, "");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.PUENTE_DEMO_PASSWORD;
if (!supabaseUrl || !service || !publicKey || !password)
  throw new Error("Missing demo verification environment");
if (base !== "https://puente-phi.vercel.app")
  throw new Error(
    "This verifier is restricted to the published Puente production origin",
  );
if (new URL(supabaseUrl).hostname !== "iuhxutsngsmpzjaklzlp.supabase.co")
  throw new Error("Unexpected Supabase project; no test state was created");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(supabaseUrl, service, options);
const acme = "11111111-1111-4111-8111-111111111111";
const runId = randomUUID();
const seededIds = Array.from(
  { length: 8 },
  (_, index) =>
    `dddd0000-0001-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const samples = [
  {
    label: "compliance opinion",
    title: `classification-check-${runId}-a`,
    expected: {
      document_type: "tax_compliance",
      expires_at: "2026-12-31",
      sensitive: false,
    },
    lines: [
      "FICTIONAL DOCUMENT FOR SOFTWARE VERIFICATION. NOT AN OFFICIAL SAT RECORD.",
      "Acme Supplies S.A. de C.V. - fictional company",
      "Opinion del cumplimiento de obligaciones fiscales",
      "SAT tax compliance opinion: POSITIVE.",
      "Tax registration: ACS260101DE0 (fictional).",
      "Review date: 2026-10-03.",
      "Valid until / Fecha de vencimiento: 2026-12-31.",
      "The company is current with its tax filing obligations in this synthetic scenario.",
      "This opinion contains no revenue, income, asset, liability or tax-payment amounts.",
    ],
  },
  {
    label: "financial balance sheet",
    title: `classification-check-${runId}-b`,
    expected: {
      document_type: "balance_sheet",
      expires_at: null,
      sensitive: true,
    },
    lines: [
      "FICTIONAL FINANCIAL DOCUMENT FOR SOFTWARE VERIFICATION.",
      "Acme Supplies S.A. de C.V. - fictional company",
      "Balance general / Balance sheet",
      "Financial position as of 2026-09-30. Currency: MXN.",
      "Cash and cash equivalents: MXN 850,000.00.",
      "Total assets: MXN 4,500,000.00.",
      "Total liabilities: MXN 1,750,000.00.",
      "Shareholders equity: MXN 2,750,000.00.",
      "The reporting date states the financial position; this document has no expiry date.",
    ],
  },
] as const;

const uploadedSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  title: z.string(),
  document_type: z.string(),
  expires_at: z.string().nullable(),
  sensitive: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storage_path: z.string(),
  extracted_text: z.string(),
  classification_source: z.string(),
});
type Uploaded = z.infer<typeof uploadedSchema>;
type Observation = {
  sample: string;
  classification_source: string;
  document_type: string;
  expires_at: string | null;
  sensitive: boolean;
  original_sha256_verified: boolean;
};
const uploaded = new Map<string, Uploaded>();
const attemptedTitles = new Set<string>();
const observations: Observation[] = [];
const checks: string[] = [];
let uploadCalls = 0;
let baseline = "";
let cleanupPassed = false;
let seedsUnchanged = false;

class CheckFailure extends Error {}
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}
function pass(label: string) {
  checks.push(label);
  console.log("PASS " + label);
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function jsonRequest(
  path: string,
  token: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  must(
    response.ok,
    "An authenticated verification endpoint rejected the request",
  );
  return response.json() as Promise<unknown>;
}
async function seededSnapshot() {
  const result = await admin
    .from("documents")
    .select(
      "id,title,document_type,sensitive,expires_at,sha256,storage_path,classification_source",
    )
    .eq("company_id", acme)
    .in("id", seededIds)
    .order("id");
  must(
    !result.error && result.data?.length === 8,
    "The expected eight Acme seed records were not found",
  );
  return JSON.stringify(result.data);
}
async function makePdf(lines: readonly string[]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Fictional Puente verification sample");
  pdf.setAuthor("Puente synthetic test");
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((text, index) =>
    page.drawText(text, {
      x: 40,
      y: 735 - index * 36,
      size: index === 0 ? 9 : 10,
      font,
      color: rgb(0.12, 0.2, 0.2),
    }),
  );
  return pdf.save();
}
async function upload(
  sample: (typeof samples)[number],
  bytes: Uint8Array,
  ownerToken: string,
) {
  must(uploadCalls < 2, "The two-upload inference budget has been exhausted");
  attemptedTitles.add(sample.title);
  uploadCalls++;
  const form = new FormData();
  // Neutral filenames force the classifier to use content rather than the document name.
  form.append(
    "file",
    new File([Uint8Array.from(bytes)], `${sample.title}.pdf`, {
      type: "application/pdf",
    }),
  );
  const response = await fetch(base + "/api/documents/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: form,
    // Longer than the route's 120-second limit, so a failed response is not followed by a retry.
    signal: AbortSignal.timeout(180_000),
    redirect: "error",
  });
  must(
    response.status === 201,
    "Production PDF upload failed; it will not be retried",
  );
  const result = z
    .object({ document: uploadedSchema })
    .safeParse(await response.json());
  must(
    result.success,
    "The upload response did not match the document contract",
  );
  const document = result.data.document;
  uploaded.set(document.id, document);
  must(
    document.company_id === acme && document.title === sample.title,
    "Uploaded metadata was outside this test scope",
  );
  must(
    document.storage_path === `${acme}/${document.id}.pdf`,
    "Unexpected original storage path",
  );
  const observation: Observation = {
    sample: sample.label,
    // Only fixed, recognized source/type labels enter public evidence.
    classification_source: [
      "claude_anthropic",
      "claude_ai_gateway",
      "awaiting_owner_review",
    ].includes(document.classification_source)
      ? document.classification_source
      : "unrecognized",
    document_type: ["tax_compliance", "balance_sheet", "other"].includes(
      document.document_type,
    )
      ? document.document_type
      : "unexpected_type",
    expires_at:
      document.expires_at && /^\d{4}-\d{2}-\d{2}$/.test(document.expires_at)
        ? document.expires_at
        : null,
    sensitive: document.sensitive,
    original_sha256_verified: false,
  };
  observations.push(observation);
  must(
    document.classification_source === "claude_anthropic",
    "Direct Claude classification was not observed; no additional upload will be attempted",
  );
  must(
    document.document_type === sample.expected.document_type,
    "Claude returned an unexpected document type",
  );
  must(
    document.expires_at === sample.expected.expires_at,
    "Claude did not preserve the explicit expiry semantics",
  );
  must(
    document.sensitive === sample.expected.sensitive,
    "Financial sensitivity did not match the document content",
  );
  must(
    document.extracted_text.trim().length > 40,
    "The synthetic PDF text was not extracted",
  );
  pass(`${sample.label}: direct Claude source, type, expiry and sensitivity`);

  const expectedHash = sha(bytes);
  must(
    document.sha256 === expectedHash,
    "Upload metadata hash differed from the original bytes",
  );
  const stored = await admin.storage
    .from("documents")
    .download(document.storage_path);
  must(
    !stored.error && stored.data,
    "The private stored original could not be retrieved",
  );
  const storedBytes = new Uint8Array(await stored.data.arrayBuffer());
  must(
    sha(storedBytes) === expectedHash &&
      Buffer.from(storedBytes).equals(Buffer.from(bytes)),
    "Private Storage changed the original PDF bytes",
  );
  pass(`${sample.label}: private Storage preserves the exact original`);

  const deliveryResult = z
    .object({
      document_id: z.uuid(),
      original_pdf: z.literal(true),
      sha256: z.string(),
      download_url: z.string().url(),
      receipt: z.object({
        payload: z.record(z.string(), z.unknown()),
        signature: z.string(),
        algorithm: z.literal("Ed25519"),
      }),
    })
    .safeParse(
      await jsonRequest(
        `/api/owner/documents/${document.id}/download`,
        ownerToken,
        "POST",
      ),
    );
  must(
    deliveryResult.success,
    "Owner delivery did not return an original and signed receipt",
  );
  const delivery = deliveryResult.data;
  must(
    delivery.document_id === document.id &&
      delivery.sha256 === expectedHash &&
      delivery.receipt.payload.sha256 === expectedHash,
    "Owner delivery metadata did not bind the same original",
  );
  const downloadUrl = new URL(delivery.download_url);
  must(
    downloadUrl.origin === base &&
      downloadUrl.pathname === `/api/owner/documents/${document.id}/download`,
    "Owner download URL was outside the expected production route",
  );
  const downloaded = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  must(
    downloaded.ok &&
      downloaded.headers.get("content-type")?.includes("application/pdf"),
    "The original PDF download failed",
  );
  const returnedBytes = new Uint8Array(await downloaded.arrayBuffer());
  must(
    sha(returnedBytes) === expectedHash &&
      Buffer.from(returnedBytes).equals(Buffer.from(bytes)),
    "The delivered PDF differed from the uploaded original",
  );
  const verified = z.object({ valid: z.literal(true) }).safeParse(
    await jsonRequest("/api/receipts/verify", ownerToken, "POST", {
      payload: delivery.receipt.payload,
      signature: delivery.receipt.signature,
    }),
  );
  must(verified.success, "The owner delivery receipt signature did not verify");
  observation.original_sha256_verified = true;
  pass(`${sample.label}: HTTP original and Ed25519 receipt verified`);
}
async function cleanup() {
  if (!attemptedTitles.size) {
    seedsUnchanged = Boolean(baseline) && (await seededSnapshot()) === baseline;
    cleanupPassed = true;
    return;
  }
  // Recover IDs if the server saved a row but the upload response was interrupted.
  const found = await admin
    .from("documents")
    .select("*")
    .eq("company_id", acme)
    .in("title", [...attemptedTitles]);
  must(!found.error, "Temporary document discovery for cleanup failed");
  for (const row of found.data || []) {
    const document = uploadedSchema.safeParse(row);
    must(
      document.success,
      "Temporary cleanup metadata did not match the document contract",
    );
    uploaded.set(document.data.id, document.data);
  }
  for (const document of uploaded.values()) {
    must(
      attemptedTitles.has(document.title) &&
        document.company_id === acme &&
        !seededIds.includes(document.id) &&
        document.storage_path === `${acme}/${document.id}.pdf`,
      "Temporary document cleanup scope guard failed",
    );
    const requests = await admin
      .from("requests")
      .select("id")
      .eq("document_id", document.id)
      .eq("owner_company_id", acme);
    must(!requests.error, "Temporary request lookup failed");
    if (requests.data?.length) {
      const links = await admin
        .from("approval_links")
        .delete()
        .in(
          "request_id",
          requests.data.map((row) => row.id),
        );
      must(!links.error, "Temporary approval-link cleanup failed");
    }
    const receipts = await admin
      .from("receipts")
      .delete()
      .eq("company_id", acme)
      .filter("payload->>document_id", "eq", document.id);
    const events = await admin
      .from("access_events")
      .delete()
      .eq("company_id", acme)
      .eq("document_id", document.id);
    const removedRequests = await admin
      .from("requests")
      .delete()
      .eq("owner_company_id", acme)
      .eq("document_id", document.id);
    must(
      !receipts.error && !events.error && !removedRequests.error,
      "Temporary receipt, event or request cleanup failed",
    );
    const removed = await admin
      .from("documents")
      .delete()
      .eq("id", document.id)
      .eq("company_id", acme)
      .eq("title", document.title);
    must(!removed.error, "Temporary document-row cleanup failed");
    const storage = await admin.storage
      .from("documents")
      .remove([document.storage_path]);
    must(!storage.error, "Temporary original cleanup failed");
    const remaining = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("id", document.id);
    const remainingObjects = await admin.storage
      .from("documents")
      .list(acme, { search: `${document.id}.pdf`, limit: 10 });
    must(
      !remaining.error &&
        remaining.count === 0 &&
        !remainingObjects.error &&
        !remainingObjects.data?.some(
          (object) => object.name === `${document.id}.pdf`,
        ),
      "A temporary document or original remained after cleanup",
    );
  }
  if (baseline) {
    seedsUnchanged = (await seededSnapshot()) === baseline;
    must(seedsUnchanged, "Seeded documents changed during verification");
  }
  cleanupPassed = true;
}
async function writeEvidence(success: boolean, failure: string | null) {
  const heading = "## Live Claude document classification";
  const rows = observations
    .map(
      (row) =>
        `| ${row.sample} | ${row.classification_source} | ${row.document_type} | ${row.expires_at || "none"} | ${row.sensitive} | ${row.original_sha256_verified ? "PASS" : "not verified"} |`,
    )
    .join("\n");
  const section = `${heading}\n\nStatus: **${success ? "PASS" : "FAIL"}**. Production endpoint: https://puente-phi.vercel.app. Upload calls: ${uploadCalls}/2. Cleanup: **${cleanupPassed ? "PASS" : "FAILED"}**.\n\n${failure ? failure + " No complete classification run is claimed.\n\n" : "Two new synthetic PDFs were uploaded through the real owner API. Both returned `claude_anthropic`, with the expected content-derived type, explicit expiry semantics and financial sensitivity. Metadata, private Storage and authenticated owner delivery preserved each original byte-for-byte and matched its SHA-256; both Ed25519 receipts verified.\n\n"}${rows ? "| Sample | Source | Type | Expiry | Sensitive | Original hash |\n| --- | --- | --- | --- | --- | --- |\n" + rows + "\n\n" : ""}The script made no inference preflight and retried no uploads. The direct-only classifier deployment must be confirmed before execution to keep the total at two inference calls. Tokens, PDFs and signed download URLs stayed in memory; logs and this section contain no credentials or document content. Cleanup targets only this run's unique document titles and their originals, receipts, events and request traces. No bridge is read or changed, and the eight seeded Acme records are checked for changes.\n\nReproduce only after deployment readiness with \`node --import tsx scripts/claude-classification-verify.ts --execute\`. Without \`--execute\`, the script exits without network calls.\n`;
  const existing = await readFile("docs/verification.md", "utf8");
  const start = existing.indexOf(heading);
  const next =
    start < 0 ? -1 : existing.indexOf("\n## ", start + heading.length);
  await writeFile(
    "docs/verification.md",
    start < 0
      ? existing.trimEnd() + "\n\n" + section
      : existing.slice(0, start) +
          section +
          (next < 0 ? "" : existing.slice(next)),
  );
}
async function main() {
  let failure: string | null = null;
  try {
    baseline = await seededSnapshot();
    const auth = createClient(supabaseUrl!, publicKey!, options);
    const result = await auth.auth.signInWithPassword({
      email: "acme@puente.demo",
      password: password!,
    });
    must(
      !result.error && result.data.session,
      "Acme owner authentication failed",
    );
    const ownerToken = result.data.session.access_token;
    const membership = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", result.data.session.user.id)
      .eq("company_id", acme)
      .eq("role", "owner")
      .maybeSingle();
    must(
      !membership.error && membership.data?.company_id === acme,
      "Authenticated owner scope did not match the fictional Acme company",
    );
    for (const sample of samples)
      await upload(sample, await makePdf(sample.lines), ownerToken);
  } catch (error) {
    // Never print SDK/provider errors, payloads, prompts, JWTs or signed URLs.
    failure =
      error instanceof CheckFailure
        ? error.message
        : "Classification verification encountered an unexpected error; sensitive details were suppressed.";
  } finally {
    try {
      await cleanup();
    } catch {
      failure =
        (failure ? failure + " " : "") +
        "Cleanup did not complete; inspect this run's temporary classification-check records.";
    }
  }
  const success =
    !failure &&
    observations.length === 2 &&
    observations.every((row) => row.original_sha256_verified) &&
    cleanupPassed;
  await writeEvidence(success, failure);
  console.log(
    JSON.stringify({
      success,
      upload_calls: uploadCalls,
      checks: checks.length,
      direct_claude_samples: observations.filter(
        (row) => row.classification_source === "claude_anthropic",
      ).length,
      temporary_data_removed: cleanupPassed,
      seeded_documents_unchanged: seedsUnchanged,
      bridges_untouched: true,
    }),
  );
  if (!success) {
    console.error(
      "FAIL " +
        (failure || "The complete two-document result was not verified."),
    );
    process.exitCode = 1;
  }
}
main().catch(() => {
  console.error(
    "Verification evidence could not be completed. No credentials or document content were logged.",
  );
  process.exitCode = 1;
});
