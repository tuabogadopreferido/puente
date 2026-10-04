/** Opt-in deployed MCP classification regression. Synthetic fixtures only; no Claude or email calls. */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { documentTypes } from "../src/lib/document-policy";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute for isolated synthetic owner classification checks.",
  );
  process.exit(0);
}
if (process.argv.slice(2).some((arg) => arg !== "--execute"))
  throw new Error("Only --execute is supported.");
loadEnvConfig(process.cwd());
const base = "https://puente-phi.vercel.app";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = process.env.PUENTE_DEMO_PASSWORD!;
if (
  !supabaseUrl ||
  !service ||
  !anon ||
  !password ||
  new URL(supabaseUrl).hostname !== "iuhxutsngsmpzjaklzlp.supabase.co"
)
  throw new Error("Expected Puente demo environment is unavailable.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(supabaseUrl, service, options);
const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const run = randomUUID();
const fixtures = [acme, globex].map((companyId) => {
  const id = randomUUID();
  return { id, companyId, path: `${companyId}/${id}.pdf`, attempted: false };
});
const connections = [acme, globex].map((companyId, index) => ({
  companyId,
  userId: "",
  label: `classification-check-${run}-${index}`,
  attempted: false,
  ids: new Set<string>(),
}));
const clients: Client[] = [];
const passes: string[] = [];
let baseline = "";
class CheckError extends Error {}
function must(value: unknown, message: string): asserts value {
  if (!value) throw new CheckError(message);
}
function pass(message: string) {
  passes.push(message);
  console.log("PASS " + message);
}
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const metadataSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    document_type: z.enum(documentTypes),
    sensitive: z.boolean(),
    expires_at: z.string().nullable(),
    classification_source: z.literal("owner_reviewed"),
  })
  .strict();
const connectionSchema = z.object({
  connection: z.object({ id: z.uuid(), label: z.string() }),
  token: z.string().regex(/^po_[A-Za-z0-9_-]{43}$/),
});

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
    .select("*")
    .in("id", ids)
    .order("id");
  must(
    !result.error && result.data?.length === 16,
    "Sixteen-document seed baseline unavailable",
  );
  return JSON.stringify(result.data);
}
async function readFixture(id: string) {
  const result = await db.from("documents").select("*").eq("id", id).single();
  must(!result.error && result.data, "Synthetic fixture could not be read");
  return result.data as Record<string, unknown>;
}
async function http(
  path: string,
  token: string,
  body: unknown,
  method = "POST",
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    data: (await response.json().catch(() => null)) as unknown,
  };
}
async function login(email: string) {
  const client = createClient(supabaseUrl, anon, options);
  const result = await client.auth.signInWithPassword({ email, password });
  must(!result.error && result.data.session, "Synthetic demo sign-in failed");
  return {
    token: result.data.session.access_token,
    userId: result.data.session.user.id,
  };
}
async function connect(token?: string) {
  const client = new Client(
    { name: "Puente synthetic classification verifier", version: "1.0.0" },
    { capabilities: {} },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }),
  );
  return client;
}
async function tool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 30_000,
  });
  must(!result.isError, "Expected MCP operation was rejected");
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content as { type: string; text?: string }[]).find(
    (part) => part.type === "text",
  )?.text;
  must(text, "MCP response was not structured");
  return JSON.parse(text) as unknown;
}
async function denied(
  client: Client,
  args: Record<string, unknown>,
  schemaFailure = false,
) {
  try {
    const result = await client.callTool(
      {
        name: "correct_document_classification",
        arguments: args,
      },
      undefined,
      { timeout: 30_000 },
    );
    must(result.isError, "A prohibited classification change was accepted");
  } catch (error) {
    // Only a real SDK invalid-parameters rejection counts; transport/network failures never pass.
    if (
      schemaFailure &&
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams
    )
      return;
    throw error;
  }
}
async function correction(client: Client, changes: Record<string, unknown>) {
  const result = metadataSchema.safeParse(
    await tool(client, "correct_document_classification", {
      document_id: fixtures[0].id,
      ...changes,
    }),
  );
  must(
    result.success && result.data.id === fixtures[0].id,
    "Classification metadata contract differs",
  );
  return result.data;
}
async function cleanup() {
  const failures: string[] = [];
  await Promise.allSettled(clients.map((client) => client.close()));
  for (const connection of connections) {
    if (!connection.attempted || !connection.userId) continue;
    try {
      // Unique per-run labels recover IDs if an API response was lost; all mutations use exact recovered IDs.
      const recovered = await db
        .from("owner_agent_connections")
        .select("id")
        .eq("user_id", connection.userId)
        .eq("company_id", connection.companyId)
        .eq("label", connection.label);
      if (recovered.error) {
        failures.push("connection lookup");
        continue;
      }
      for (const row of recovered.data || [])
        connection.ids.add(row.id as string);
      for (const id of connection.ids) {
        const revoked = await db
          .from("owner_agent_connections")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", connection.userId)
          .eq("company_id", connection.companyId);
        if (revoked.error) failures.push("connection revocation");
        const removed = await db
          .from("owner_agent_connections")
          .delete()
          .eq("id", id)
          .eq("user_id", connection.userId)
          .eq("company_id", connection.companyId);
        if (removed.error) failures.push("connection deletion");
      }
      const remaining = await db
        .from("owner_agent_connections")
        .select("id")
        .eq("user_id", connection.userId)
        .eq("company_id", connection.companyId)
        .eq("label", connection.label);
      if (remaining.error || remaining.data?.length)
        failures.push("connection verification");
    } catch {
      failures.push("connection cleanup");
    }
  }
  for (const fixture of fixtures) {
    if (!fixture.attempted) continue;
    try {
      const removed = await db
        .from("documents")
        .delete()
        .eq("id", fixture.id)
        .eq("company_id", fixture.companyId);
      if (removed.error) failures.push("fixture metadata");
      const object = await db.storage.from("documents").remove([fixture.path]);
      if (object.error) failures.push("fixture original");
      const remaining = await db
        .from("documents")
        .select("id")
        .eq("id", fixture.id);
      const exists = await db.storage
        .from("documents")
        .list(fixture.companyId, { search: fixture.id + ".pdf", limit: 100 });
      if (
        remaining.error ||
        remaining.data?.length ||
        exists.error ||
        exists.data?.some((object) => object.name === fixture.id + ".pdf")
      )
        failures.push("fixture verification");
    } catch {
      failures.push("fixture cleanup");
    }
  }
  if (baseline) {
    try {
      if ((await seeds()) !== baseline) failures.push("seed baseline");
    } catch {
      failures.push("seed verification");
    }
  }
  must(
    failures.length === 0,
    "Exact synthetic cleanup or seed verification failed; inspection required",
  );
  pass(
    "Exact temporary fixtures and owner credentials removed; all 16 seed rows unchanged",
  );
}
async function main() {
  try {
    baseline = await seeds();
    const logins = await Promise.all([
      login("acme@puente.demo"),
      login("globex@puente.demo"),
    ]);
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const original = await pdf.save();
    const originalHash = hash(original);
    for (const fixture of fixtures) {
      const existing = await db
        .from("documents")
        .select("id")
        .eq("id", fixture.id);
      const object = await db.storage
        .from("documents")
        .list(fixture.companyId, { search: fixture.id + ".pdf", limit: 100 });
      must(
        !existing.error &&
          !existing.data?.length &&
          !object.error &&
          !object.data?.some((entry) => entry.name === fixture.id + ".pdf"),
        "Synthetic fixture identity was not empty",
      );
      fixture.attempted = true;
      const stored = await db.storage
        .from("documents")
        .upload(fixture.path, original, {
          contentType: "application/pdf",
          upsert: false,
        });
      must(!stored.error, "Synthetic PDF storage failed");
      const inserted = await db.from("documents").insert({
        id: fixture.id,
        company_id: fixture.companyId,
        title: "Synthetic classification verification",
        document_type: "other",
        sensitive: false,
        expires_at: null,
        sha256: originalHash,
        storage_path: fixture.path,
        extracted_text: "Synthetic verification only.",
        classification_source: "awaiting_owner_review",
      });
      must(!inserted.error, "Synthetic metadata creation failed");
    }
    const tokens: string[] = [];
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      connection.userId = logins[i].userId;
      const preexisting = await db
        .from("owner_agent_connections")
        .select("id")
        .eq("user_id", connection.userId)
        .eq("company_id", connection.companyId)
        .eq("label", connection.label);
      must(
        !preexisting.error && !preexisting.data?.length,
        "Temporary connection identity was not empty",
      );
      connection.attempted = true;
      const response = await http(
        "/api/owner/agent-connections",
        logins[i].token,
        { label: connection.label },
      );
      must(
        response.status === 201,
        "Temporary owner credential creation failed",
      );
      const parsed = connectionSchema.safeParse(response.data);
      must(
        parsed.success && parsed.data.connection.label === connection.label,
        "Owner connection contract differs",
      );
      connection.ids.add(parsed.data.connection.id);
      tokens.push(parsed.data.token);
    }
    const [owner, other, anonymous, counterparty, legacy] = await Promise.all([
      connect(tokens[0]),
      connect(tokens[1]),
      connect(),
      connect("pt_" + randomUUID()),
      connect(logins[0].token),
    ]);
    const discovered = await owner.listTools();
    must(
      discovered.tools.some(
        (item) => item.name === "correct_document_classification",
      ),
      "Classification tool was not discovered",
    );
    pass("Actual MCP SDK discovers owner classification correction");
    for (const document_type of documentTypes.filter(
      (type) => type !== "other",
    )) {
      const sensitive = [
        "balance_sheet",
        "income_statement",
        "tax_return",
      ].includes(document_type);
      const changed = await correction(owner, {
        document_type,
        sensitive: !sensitive,
      });
      must(
        changed.document_type === document_type &&
          changed.sensitive === sensitive,
        "Type sensitivity policy was not enforced",
      );
      const partial = await correction(owner, { sensitive: !sensitive });
      must(
        partial.document_type === document_type &&
          partial.sensitive === sensitive,
        "Partial sensitivity ignored existing type",
      );
    }
    pass(
      "All 11 fixed types and partial corrections enforce financial/onboarding sensitivity",
    );
    for (const sensitive of [true, false])
      must(
        (await correction(owner, { document_type: "other", sensitive }))
          .sensitive === sensitive,
        "Other sensitivity choice was lost",
      );
    must(
      (await correction(owner, { expires_at: "2028-02-29" })).expires_at ===
        "2028-02-29",
      "Valid leap date was rejected",
    );
    must(
      (await correction(owner, { expires_at: null })).expires_at === null,
      "Explicit null did not clear expiration",
    );
    pass(
      "Other sensitivity choices, calendar date and explicit null correction work",
    );
    const argumentOwner = await correction(anonymous, {
      token: tokens[0],
      document_type: "tax_compliance",
      sensitive: true,
    });
    must(
      argumentOwner.sensitive === false,
      "Optional owner token argument failed",
    );
    must(
      (
        await correction(legacy, {
          document_type: "balance_sheet",
          sensitive: false,
        })
      ).sensitive,
      "Legacy owner JWT MCP parity failed",
    );
    const durableRest = await http(
      `/api/documents/${fixtures[0].id}`,
      tokens[0],
      { document_type: "bank_cover", sensitive: true },
      "PATCH",
    );
    must(
      durableRest.status === 200 &&
        metadataSchema.parse(durableRest.data).sensitive === false,
      "Durable owner REST parity failed",
    );
    pass(
      "Owner header/argument credentials and durable REST/legacy JWT MCP parity work",
    );

    const before = await Promise.all(
      fixtures.map((fixture) => readFixture(fixture.id)),
    );
    const invalid = [
      { document_id: fixtures[0].id },
      { document_id: fixtures[0].id, unknown: true },
      { document_id: fixtures[0].id, document_type: "unknown_type" },
      { document_id: fixtures[0].id, sensitive: "false" },
      { document_id: "not-a-uuid", sensitive: true },
      ...[
        "2026-02-30",
        "2026-02-29",
        "0000-01-01",
        "2026-13-01",
        "2026-10-03T00:00:00Z",
      ].map((expires_at) => ({ document_id: fixtures[0].id, expires_at })),
    ];
    for (const args of invalid) await denied(owner, args, true);
    await denied(other, { document_id: fixtures[0].id, sensitive: true });
    await denied(owner, { document_id: fixtures[1].id, sensitive: true });
    await denied(owner, {
      token: tokens[1],
      document_id: fixtures[0].id,
      sensitive: true,
    });
    await denied(anonymous, { document_id: fixtures[0].id, sensitive: true });
    await denied(counterparty, {
      document_id: fixtures[0].id,
      sensitive: true,
    });
    const after = await Promise.all(
      fixtures.map((fixture) => readFixture(fixture.id)),
    );
    must(
      JSON.stringify(before) === JSON.stringify(after),
      "A denied operation changed fixture metadata",
    );
    pass(
      "Empty/unknown/date/UUID inputs, foreign company, anonymous and counterparty access are denied without mutation",
    );
    const revoked = await tool(owner, "revoke_owner_access", {});
    must(
      z.object({ status: z.literal("revoked") }).safeParse(revoked).success,
      "Temporary owner revocation failed",
    );
    const beforeRevoked = await readFixture(fixtures[0].id);
    await denied(owner, { document_id: fixtures[0].id, sensitive: true });
    must(
      JSON.stringify(beforeRevoked) ===
        JSON.stringify(await readFixture(fixtures[0].id)),
      "Revoked owner changed metadata",
    );
    const legacyRest = await http(
      `/api/documents/${fixtures[0].id}`,
      logins[0].token,
      { document_type: "income_statement", sensitive: false, expires_at: null },
      "PATCH",
    );
    must(
      legacyRest.status === 200 &&
        metadataSchema.parse(legacyRest.data).sensitive,
      "Legacy JWT REST regression failed",
    );
    pass(
      "Revoked owner credentials cannot correct; native owner JWT REST access remains valid",
    );

    for (const fixture of fixtures) {
      const stored = await db.storage.from("documents").download(fixture.path);
      const current = await readFixture(fixture.id);
      must(
        !stored.error && stored.data,
        "Synthetic original could not be verified",
      );
      must(
        hash(new Uint8Array(await stored.data.arrayBuffer())) ===
          originalHash &&
          current.sha256 === originalHash &&
          current.storage_path === fixture.path &&
          current.extracted_text === "Synthetic verification only." &&
          current.title === "Synthetic classification verification",
        "Classification changed original content or immutable fields",
      );
    }
    pass(
      "Storage SHA-256, original paths, titles and extracted text remain unchanged",
    );
  } finally {
    await cleanup();
  }
  console.log(
    JSON.stringify({
      success: true,
      checks: passes.length,
      mcp_sdk_verified: true,
      original_pdf_unchanged: true,
      temporary_data_removed: true,
      seed_documents_unchanged: 16,
      claude_calls: 0,
      emails_sent: 0,
      credentials_persisted: false,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof CheckError
      ? error.message
      : "Owner classification verification failed. Private errors and credentials were suppressed; inspect the last PASS stage.",
  );
  process.exitCode = 1;
});
