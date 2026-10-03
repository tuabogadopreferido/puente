/** Opt-in production owner-agent regression. Uses synthetic PDFs and temporary credentials only. */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute for temporary synthetic owner-agent checks.",
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
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, service, options);
const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const run = randomUUID();
const labels = [`owner-agent-check-${run}-a`, `owner-agent-check-${run}-b`];
const filename = `owner-agent-check-${run}.pdf`;
const bridgeId = randomUUID();
const clients: Client[] = [];
const checks: string[] = [];
let bridgeAttempted = false;
let seedBaseline = "";
let ownerUserId = "";
let uploadId = "";
let uploadPath = "";
class CheckError extends Error {}
function must(value: unknown, message: string): asserts value {
  if (!value) throw new CheckError(message);
}
function pass(message: string) {
  checks.push(message);
  console.log("PASS " + message);
}
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const connectionSchema = z.object({
  connection: z.object({
    id: z.uuid(),
    label: z.string(),
    revoked_at: z.null(),
  }),
  token: z.string().regex(/^po_[A-Za-z0-9_-]+$/),
});
const preparedSchema = z.object({
  uploadId: z.uuid(),
  path: z.string(),
  upload_url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
});
const documentSchema = z.object({
  document: z.object({
    id: z.uuid(),
    company_id: z.uuid(),
    sha256: z.string(),
    document_type: z.string(),
    classification_source: z.string(),
  }),
});
const deliverySchema = z.object({
  download_url: z.string().url(),
  sha256: z.string(),
  receipt: z.object({
    payload: z.record(z.string(), z.unknown()),
    signature: z.string(),
  }),
});

async function http(path: string, token = "", body?: unknown, method = "POST") {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: (await response.json().catch(() => null)) as unknown,
    cache: response.headers.get("cache-control"),
  };
}
async function login(email: string) {
  const client = createClient(url, anon, options);
  const response = await client.auth.signInWithPassword({ email, password });
  must(!response.error && response.data.session, "Demo authentication failed");
  return {
    token: response.data.session.access_token,
    userId: response.data.session.user.id,
    client,
  };
}
async function connect(token: string) {
  const client = new Client(
    { name: "Puente synthetic owner-agent verifier", version: "1.0.0" },
    { capabilities: {} },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
  deny = false,
) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 150_000,
  });
  if (deny) {
    must(result.isError, `Unauthorized ${name} was accepted`);
    return null;
  }
  must(!result.isError, `MCP ${name} failed`);
  if (result.structuredContent) return result.structuredContent;
  const content = result.content as { type: string; text?: string }[];
  const text = content.find((entry) => entry.type === "text")?.text;
  must(text, "MCP did not return a structured response");
  return JSON.parse(text) as unknown;
}
async function seeds() {
  const ids = [1, 2].flatMap((company) =>
    Array.from(
      { length: 8 },
      (_, i) =>
        `dddd0000-000${company}-4000-8000-${String(i + 1).padStart(12, "0")}`,
    ),
  );
  const result = await db
    .from("documents")
    .select("id,title,sha256,classification_source")
    .in("id", ids)
    .order("id");
  must(!result.error && result.data.length === 16, "Seed baseline unavailable");
  return JSON.stringify(result.data);
}
async function verifyPdf(value: unknown, expected: Uint8Array) {
  const parsed = deliverySchema.safeParse(value);
  must(parsed.success, "Delivery response did not match the contract");
  const delivery = parsed.data;
  const target = new URL(delivery.download_url);
  must(
    target.origin === base && target.pathname.startsWith("/api/"),
    "Unexpected download origin",
  );
  const response = await fetch(target, {
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  must(response.ok, "Original download failed");
  must(
    hash(new Uint8Array(await response.arrayBuffer())) === hash(expected) &&
      delivery.sha256 === hash(expected),
    "Original PDF integrity differed",
  );
  const receipt = await http("/api/receipts/verify", "", {
    payload: delivery.receipt.payload,
    signature: delivery.receipt.signature,
  });
  must(
    receipt.ok &&
      z.object({ valid: z.literal(true) }).safeParse(receipt.data).success,
    "Original receipt signature failed",
  );
  return delivery;
}
async function main() {
  seedBaseline = await seeds();
  const [owner, other] = await Promise.all([
    login("acme@puente.demo"),
    login("globex@puente.demo"),
  ]);
  ownerUserId = owner.userId;
  must(
    (await http("/api/owner/agent-connections", "", { label: labels[0] }))
      .status === 401,
    "Connection creation accepted no owner authentication",
  );
  const connections = [];
  for (const label of labels) {
    const created = await http("/api/owner/agent-connections", owner.token, {
      label,
    });
    const parsed = connectionSchema.safeParse(created.data);
    must(
      created.ok && parsed.success && created.cache?.includes("no-store"),
      "Private owner connection creation failed",
    );
    connections.push(parsed.data);
    const record = await db
      .from("owner_agent_connections")
      .select("*")
      .eq("id", parsed.data.connection.id)
      .single();
    must(
      !record.error &&
        record.data.token_hash === hash(parsed.data.token) &&
        !JSON.stringify(record.data).includes(parsed.data.token) &&
        !("expires_at" in record.data),
      "Connection token storage or lifetime contract failed",
    );
  }
  pass(
    "Owner connections are non-expiring, privately returned once and stored as hashes",
  );
  const listing = await http(
    "/api/owner/agent-connections",
    owner.token,
    undefined,
    "GET",
  );
  must(
    listing.ok &&
      connections.every(
        (connection) =>
          !JSON.stringify(listing.data).includes(connection.token),
      ),
    "Connection listing disclosed a token",
  );
  const browserRead = await owner.client
    .from("owner_agent_connections")
    .select("token_hash");
  must(
    browserRead.error || browserRead.data?.length === 0,
    "Browser role could directly read credential records",
  );
  const foreignRevoke = await http(
    `/api/owner/agent-connections/${connections[0].connection.id}/revoke`,
    other.token,
    {},
  );
  must(
    [403, 404].includes(foreignRevoke.status),
    "Another owner revoked this connection",
  );
  pass(
    "Credential records stay private and another company cannot revoke them",
  );
  const aged = await db
    .from("owner_agent_connections")
    .update({ created_at: "2000-01-01T00:00:00Z" })
    .eq("id", connections[0].connection.id)
    .eq("user_id", owner.userId);
  must(!aged.error, "Fixture age could not be set");
  const primary = await connect(connections[0].token);
  const secondary = await connect(connections[1].token);
  const tools = await primary.listTools();
  for (const name of [
    "list_documents",
    "prepare_document_upload",
    "complete_document_upload",
    "revoke_owner_access",
  ])
    must(
      tools.tools.some((tool) => tool.name === name),
      "An owner MCP tool was missing",
    );
  const catalog = z
    .object({
      access_scope: z.literal("owner"),
      documents: z.array(z.object({ company_id: z.uuid() })),
    })
    .safeParse(await call(primary, "list_documents"));
  must(
    catalog.success &&
      catalog.data.documents.every((doc) => doc.company_id === acme),
    "Owner metadata escaped its company",
  );
  await call(
    primary,
    "get_document",
    { document_id: "dddd0000-0002-4000-8000-000000000001" },
    true,
  );
  pass(
    "A simulated old connection remains valid and accesses only its own company",
  );
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  [
    "SYNTHETIC TEST DOCUMENT. NOT AN OFFICIAL RECORD.",
    "Acme Supplies - Fictional Mexican company",
    "SAT opinion del cumplimiento de obligaciones fiscales",
    "Positive tax compliance. Tax filings are current.",
    "Valid until 2027-12-31. No financial amounts.",
  ].forEach((text, i) =>
    page.drawText(text, { x: 40, y: 750 - 30 * i, font, size: 11 }),
  );
  const original = await pdf.save();
  const prepared = preparedSchema.safeParse(
    await call(primary, "prepare_document_upload", {
      filename,
      size: original.length,
    }),
  );
  must(prepared.success, "MCP upload preparation failed");
  uploadId = prepared.data.uploadId;
  uploadPath = prepared.data.path;
  must(
    uploadPath === `${acme}/${uploadId}.pdf`,
    "MCP upload path escaped owner scope",
  );
  const uploadUrl = new URL(prepared.data.upload_url);
  must(
    uploadUrl.origin === new URL(url).origin &&
      uploadUrl.pathname ===
        `/storage/v1/object/upload/sign/documents/${uploadPath}`,
    "MCP upload URL escaped private Storage path",
  );
  must(
    !Object.keys(prepared.data.headers).some((name) =>
      /authorization|apikey/i.test(name),
    ),
    "Upload instructions exposed an unnecessary credential header",
  );
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: prepared.data.headers,
    body: new Blob([Uint8Array.from(original)], { type: "application/pdf" }),
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  must(uploaded.ok, "Raw signed PDF transfer failed");
  const completed = documentSchema.safeParse(
    await call(primary, "complete_document_upload", { uploadId }),
  );
  must(
    completed.success &&
      completed.data.document.id === uploadId &&
      completed.data.document.company_id === acme &&
      completed.data.document.sha256 === hash(original),
    "MCP completion did not preserve the original",
  );
  must(
    completed.data.document.document_type === "tax_compliance" &&
      completed.data.document.classification_source === "claude_anthropic",
    "Synthetic upload did not receive expected real Claude classification",
  );
  const retry = documentSchema.safeParse(
    await call(primary, "complete_document_upload", { uploadId }),
  );
  must(
    retry.success && retry.data.document.id === uploadId,
    "MCP completion was not idempotent",
  );
  const ownDelivery = await verifyPdf(
    await call(primary, "get_document", { document_id: uploadId }),
    original,
  );
  pass(
    "Actual MCP prepare, raw Storage PUT, classify, complete, replay and original download passed",
  );

  bridgeAttempted = true;
  must(
    !(
      await db
        .from("bridges")
        .insert({
          id: bridgeId,
          company_a_id: acme,
          company_b_id: globex,
          expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        })
    ).error,
    "Temporary independent bridge failed",
  );
  const issued = await http(`/api/bridges/${bridgeId}/code`, owner.token, {});
  const code = z.object({ code: z.string() }).safeParse(issued.data);
  must(issued.ok && code.success, "Bridge code failed");
  const exchange = await http("/api/access/exchange", "", {
    code: code.data.code,
  });
  const exchanged = z.object({ token: z.string() }).safeParse(exchange.data);
  must(exchange.ok && exchanged.success, "Bridge code exchange failed");
  const counterpart = await connect(exchanged.data.token);
  await call(
    counterpart,
    "prepare_document_upload",
    { filename, size: original.length },
    true,
  );
  await call(counterpart, "revoke_owner_access", {}, true);
  pass("A counterparty token cannot upload to the owner or revoke its agent");
  const purpose = await db
    .from("purposes")
    .select("id")
    .eq("company_id", acme)
    .eq("name", "Alta como proveedor")
    .single();
  must(!purpose.error && purpose.data, "Synthetic purpose missing");
  const rules = await db
    .from("rules")
    .select("id")
    .eq("company_id", acme)
    .eq("document_type", "tax_compliance")
    .eq("purpose_id", purpose.data.id)
    .or(`counterparty_id.is.null,counterparty_id.eq.${globex}`);
  must(
    !rules.error && rules.data.length > 0,
    "Refusing a test that would send an approval email",
  );
  const external = await http("/api/requests", exchanged.data.token, {
    document_id: uploadId,
    purpose_id: purpose.data.id,
    offered_document_ids: [],
  });
  must(external.ok, "Independent bridge request failed");
  const externalDelivery = await verifyPdf(external.data, original);
  await call(primary, "revoke_owner_access");
  await call(primary, "list_documents", {}, true);
  await call(primary, "complete_document_upload", { uploadId }, true);
  const ownBlocked = await fetch(ownDelivery.download_url, {
    redirect: "error",
  });
  must(
    [401, 403].includes(ownBlocked.status),
    "Revoked owner connection retained its internal download",
  );
  const externalStillWorks = await fetch(externalDelivery.download_url, {
    redirect: "error",
  });
  must(
    externalStillWorks.ok &&
      hash(new Uint8Array(await externalStillWorks.arrayBuffer())) ===
        hash(original),
    "Owner self-revocation affected counterparty download",
  );
  await call(secondary, "list_documents");
  const liveBridge = await db
    .from("bridges")
    .select("status")
    .eq("id", bridgeId)
    .single();
  must(
    !liveBridge.error && liveBridge.data.status === "active",
    "Owner self-revocation changed bridge status",
  );
  pass(
    "Self-revocation blocks only that owner agent; bridge, counterparty link and second agent remain active",
  );
  must(
    (await http(`/api/bridges/${bridgeId}/revoke`, owner.token, {})).ok,
    "Bridge revocation failed",
  );
  await call(secondary, "list_documents");
  must(
    (await fetch(externalDelivery.download_url, { redirect: "error" }))
      .status === 403,
    "Revoked bridge retained counterparty download",
  );
  pass(
    "Bridge revocation blocks counterpart downloads without affecting the owner agent",
  );
  must(
    (
      await http(
        `/api/owner/agent-connections/${connections[1].connection.id}/revoke`,
        owner.token,
        {},
      )
    ).ok,
    "Owner interface revocation endpoint failed",
  );
  await call(secondary, "list_documents", {}, true);
  pass("Owner interface endpoint revokes the selected persistent agent");
}
async function cleanup() {
  for (const client of clients) await client.close().catch(() => undefined);
  if (ownerUserId) {
    const found = await db
      .from("owner_agent_connections")
      .select("id")
      .eq("user_id", ownerUserId)
      .eq("company_id", acme)
      .in("label", labels);
    must(!found.error, "Temporary connections could not be found for cleanup");
    if (found.data.length) {
      const ids = found.data.map((entry) => entry.id);
      must(
        !(
          await db
            .from("owner_agent_connections")
            .update({ revoked_at: new Date().toISOString() })
            .in("id", ids)
        ).error,
        "Temporary credentials could not be revoked",
      );
      must(
        !(await db.from("owner_agent_connections").delete().in("id", ids))
          .error,
        "Temporary credential cleanup failed",
      );
    }
  }
  if (bridgeAttempted) {
    const requests = await db
      .from("requests")
      .select("id")
      .eq("bridge_id", bridgeId);
    must(!requests.error, "Temporary requests lookup failed");
    if (requests.data.length)
      must(
        !(
          await db
            .from("approval_links")
            .delete()
            .in(
              "request_id",
              requests.data.map((row) => row.id),
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
        "Temporary bridge traces cleanup failed",
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
  const sessions = await db
    .from("document_upload_sessions")
    .select("id,storage_path")
    .eq("company_id", acme)
    .eq("filename", filename);
  must(!sessions.error, "Temporary upload session discovery failed");
  for (const session of sessions.data) {
    must(
      session.storage_path === `${acme}/${session.id}.pdf`,
      "Cleanup upload scope mismatch",
    );
    must(
      !(
        await db
          .from("receipts")
          .delete()
          .eq("company_id", acme)
          .filter("payload->>document_id", "eq", session.id)
      ).error,
      "Owner receipts cleanup failed",
    );
    must(
      !(
        await db
          .from("access_events")
          .delete()
          .eq("company_id", acme)
          .eq("document_id", session.id)
      ).error,
      "Owner audit cleanup failed",
    );
    must(
      !(await db.from("document_upload_sessions").delete().eq("id", session.id))
        .error,
      "Upload session cleanup failed",
    );
    must(
      !(
        await db
          .from("documents")
          .delete()
          .eq("id", session.id)
          .eq("company_id", acme)
      ).error,
      "Uploaded document cleanup failed",
    );
    must(
      !(await db.storage.from("documents").remove([session.storage_path]))
        .error,
      "Original cleanup failed",
    );
  }
  if (seedBaseline)
    must((await seeds()) === seedBaseline, "Seeded documents changed");
  pass(
    "Temporary owner credentials, upload and bridge removed; all 16 seeds unchanged",
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
    failure += ` Cleanup: ${error instanceof CheckError ? error.message : "failed; inspect only owner-agent-check fixtures"}`;
  }
  if (failure) {
    console.error("FAIL " + failure);
    process.exitCode = 1;
  } else console.log(`PASS ${checks.length} owner-agent production checks`);
}
void runChecks();
