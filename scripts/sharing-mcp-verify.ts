/** Real MCP SDK regression for owner sharing tools. Synthetic metadata; no mail/files. */
import { loadEnvConfig } from "@next/env";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { admin } from "../src/lib/supabase-admin";
import { createOwnerAgentConnection } from "../src/lib/owner-agent-connections";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: --execute verifies the deployed MCP sharing tools with temporary fixtures.",
  );
  process.exit(0);
}
loadEnvConfig(process.cwd());
const base = process.env.PUENTE_TEST_URL || "https://puente-phi.vercel.app";
if (
  !["puente-phi.vercel.app", "localhost", "127.0.0.1"].includes(
    new URL(base).hostname,
  )
)
  throw new Error("Unexpected verification host");
const db = admin(),
  company = randomUUID(),
  foreign = randomUUID(),
  source = randomUUID(),
  documentId = randomUUID(),
  purposeId = randomUUID(),
  foreignBatch = randomUUID();
const clients: Client[] = [];
let userId = "",
  connectionId = "",
  passes = 0;
function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pass(message: string) {
  passes++;
  console.log(`PASS ${message}`);
}
async function connect(token?: string) {
  const client = new Client({
    name: "Puente sharing regression",
    version: "1.0.0",
  });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", base), {
      requestInit: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }),
  );
  return client;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  must(!result.isError, `${name} failed`);
  const value = result.structuredContent;
  must(
    value && typeof value === "object",
    `${name} did not return structured content`,
  );
  return value as Record<string, unknown>;
}
async function denied(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  must(result.isError === true, `${name} accepted an unauthorized call`);
}
async function main() {
  try {
    must(
      !(
        await db.from("companies").insert([
          {
            id: company,
            name: "MCP sharing fixture",
            tax_id: null,
            contact_email: "mcp-sharing@example.invalid",
          },
          {
            id: foreign,
            name: "Other MCP fixture",
            tax_id: null,
            contact_email: "mcp-other@example.invalid",
          },
        ])
      ).error,
      "Company fixtures failed",
    );
    const created = await db.auth.admin.createUser({
      email: `mcp-sharing-${company}@example.invalid`,
      email_confirm: true,
    });
    must(!created.error && created.data.user, "Auth fixture failed");
    userId = created.data.user.id;
    must(
      !(
        await db
          .from("company_members")
          .insert({ company_id: company, user_id: userId })
      ).error,
      "Membership fixture failed",
    );
    const connection = await createOwnerAgentConnection(
      { userId, companyId: company },
      { label: "mcp-sharing-regression" },
    );
    connectionId = connection.connection.id;
    must(
      !(
        await db
          .from("document_sources")
          .insert({
            id: source,
            company_id: company,
            user_id: userId,
            owner_connection_id: connectionId,
            label: "Metadata-only MCP fixture",
          })
      ).error,
      "Source fixture failed",
    );
    must(
      !(
        await db
          .from("purposes")
          .insert({ id: purposeId, company_id: company, name: "MCP purpose" })
      ).error,
      "Purpose fixture failed",
    );
    must(
      !(
        await db
          .from("documents")
          .insert({
            id: documentId,
            company_id: company,
            title: "Metadata-only MCP fixture",
            document_type: "tax_status",
            sensitive: false,
            sha256: "b".repeat(64),
            storage_path: null,
            extracted_text: "",
            source_id: source,
            source_key: randomUUID(),
            size_bytes: 100,
            classification_source: "owner_reviewed",
          })
      ).error,
      "Document fixture failed",
    );
    must(
      !(
        await db
          .from("document_batches")
          .insert({
            id: foreignBatch,
            company_id: foreign,
            name: "Private foreign batch",
          })
      ).error,
      "Foreign batch fixture failed",
    );
    const owner = await connect(connection.token),
      anonymous = await connect();
    const catalog = await owner.listTools();
    const names = [
      "list_document_batches",
      "create_document_batch",
      "update_document_batch",
      "set_document_sharing",
    ];
    must(
      names.every((name) => catalog.tools.some((tool) => tool.name === name)),
      "MCP sharing tools missing from deployment",
    );
    const initial = await call(owner, "list_document_batches");
    must(
      Array.isArray(initial.batches) && initial.batches.length === 0,
      "Foreign batch leaked into owner catalog",
    );
    const createdBatch = await call(owner, "create_document_batch", {
      name: "Shared onboarding",
      document_ids: [documentId],
      settings: { mode: "approval", allowed_purpose_ids: [purposeId] },
    });
    const batch = createdBatch.batch as { id: string; document_ids: string[] };
    must(
      batch?.id && batch.document_ids.includes(documentId),
      "Created batch did not contain selected document",
    );
    const edited = await call(owner, "update_document_batch", {
      batch_id: batch.id,
      name: "Renamed onboarding",
    });
    const editedBatch = edited.batch as {
      name: string;
      settings: { mode: string };
      document_ids: string[];
    };
    must(
      editedBatch.name === "Renamed onboarding" &&
        editedBatch.settings.mode === "approval" &&
        editedBatch.document_ids.includes(documentId),
      "Batch rename silently reset sharing",
    );
    const settings = await call(owner, "set_document_sharing", {
      document_id: documentId,
      override: { mode: "rules", allowed_purpose_ids: null },
    });
    must(
      (settings.effective as { mode: string }).mode === "rules" &&
        settings.batch_id === batch.id,
      "Document override did not preserve batch assignment",
    );
    pass(
      "All four deployed MCP tools work with a permanent owner token and preserve explicit settings",
    );

    const explicit = await call(anonymous, "list_document_batches", {
      token: connection.token,
    });
    must(
      Array.isArray(explicit.batches) && explicit.batches.length === 1,
      "Explicit owner token argument failed",
    );
    await denied(anonymous, "list_document_batches");
    pass(
      "Header and explicit token authentication work; missing credentials are denied",
    );

    const counterpart = `pt_${randomBytes(32).toString("base64url")}`;
    await denied(owner, "list_document_batches", { token: counterpart });
    await denied(owner, "create_document_batch", {
      token: counterpart,
      name: "Denied",
      document_ids: [documentId],
    });
    await denied(owner, "update_document_batch", {
      token: counterpart,
      batch_id: batch.id,
      name: "Denied",
    });
    await denied(owner, "set_document_sharing", {
      token: counterpart,
      document_id: documentId,
      override: null,
    });
    pass(
      "A counterparty credential cannot read or change sharing through any of the four owner tools",
    );

    await denied(owner, "update_document_batch", {
      batch_id: foreignBatch,
      name: "Denied foreign change",
    });
    await denied(owner, "set_document_sharing", {
      document_id: documentId,
      batch_id: foreignBatch,
    });
    const foreignUnchanged = await db
      .from("document_batches")
      .select("name")
      .eq("id", foreignBatch)
      .single();
    must(
      foreignUnchanged.data?.name === "Private foreign batch",
      "A foreign batch changed",
    );
    pass(
      "MCP rejects foreign workspace targets without changing their records",
    );

    must(
      !(
        await db
          .from("owner_agent_connections")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", connectionId)
      ).error,
      "Could not revoke test owner token",
    );
    await denied(owner, "list_document_batches");
    await denied(owner, "create_document_batch", {
      name: "Denied revoked",
      document_ids: [],
    });
    await denied(owner, "update_document_batch", {
      batch_id: batch.id,
      name: "Denied revoked",
    });
    await denied(owner, "set_document_sharing", {
      document_id: documentId,
      override: null,
    });
    pass("Revocation immediately blocks all four sharing tools");
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    must(
      !(await db.from("documents").delete().eq("company_id", company)).error,
      "Document cleanup failed",
    );
    must(
      !(
        await db
          .from("document_batches")
          .delete()
          .in("company_id", [company, foreign])
      ).error,
      "Batch cleanup failed",
    );
    for (const table of [
      "document_sources",
      "owner_agent_connections",
      "purposes",
      "company_members",
    ])
      must(
        !(await db.from(table).delete().eq("company_id", company)).error,
        `Cleanup failed for ${table}`,
      );
    must(
      !(await db.from("companies").delete().in("id", [company, foreign])).error,
      "Company cleanup failed",
    );
    if (userId)
      must(
        !(await db.auth.admin.deleteUser(userId)).error,
        "User cleanup failed",
      );
  }
  console.log(
    `PASS ${passes} real MCP groups; fixtures removed; no email or file bytes used.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "MCP sharing verification failed",
  );
  process.exitCode = 1;
});
