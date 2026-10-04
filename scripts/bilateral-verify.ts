/** Opt-in production MCP + WebRTC reciprocity regression; isolated fixtures, no email. */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PDFDocument } from "pdf-lib";
import {
  RTCPeerConnection as NodePeer,
  type RTCDataChannel as NodeChannel,
} from "werift";
import { admin } from "../src/lib/supabase-admin";
import { createOwnerAgentConnection } from "../src/lib/owner-agent-connections";
import {
  configurePeerRuntime,
  registerLocalFiles,
  beginPeerDownload,
  type LocalSourceHandle,
  type PeerTransfer,
} from "../src/lib/p2p-client";

if (!process.argv.includes("--execute")) {
  console.log("NOT RUN: add --execute for isolated bilateral MCP/peer checks.");
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
const db = admin();
const companyIds = [randomUUID(), randomUUID()];
const purposeIds = [randomUUID(), randomUUID()];
const userIds: string[] = [],
  tokens: string[] = [],
  documents: string[] = [];
const clients: Client[] = [],
  sources: LocalSourceHandle[] = [],
  originals: Uint8Array[] = [];
let bridgeId = "",
  passed = 0;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pass(message: string) {
  passed++;
  console.log(`PASS ${message}`);
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  must(!result.isError, `${name} failed`);
  must(result.structuredContent, `${name} did not return structured content`);
  return result.structuredContent as Record<string, unknown>;
}
async function denied(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args });
  must(result.isError === true, `${name} accepted unauthorized access`);
}
configurePeerRuntime({
  baseUrl: base,
  createPeer: () =>
    new NodePeer({
      iceServers: [],
      iceAdditionalHostAddresses: ["127.0.0.1"],
    }) as unknown as RTCPeerConnection,
  sendBytes: (channel, bytes) =>
    (channel as unknown as NodeChannel).send(Buffer.from(bytes)),
});

async function main() {
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db.auth.admin.createUser({
        email: `bilateral-${companyIds[i]}@example.invalid`,
        email_confirm: true,
      });
      must(!user.error && user.data.user, "Could not create isolated user");
      userIds.push(user.data.user.id);
      must(
        !(
          await db.from("companies").insert({
            id: companyIds[i],
            name: `Temporary bilateral ${i}`,
            tax_id: "",
            contact_email: "",
          })
        ).error,
        "Company fixture failed",
      );
      // Empty contacts deliberately fail notification validation before any provider call.
      must(
        !(
          await db.from("company_members").insert({
            company_id: companyIds[i],
            user_id: userIds[i],
            role: "owner",
          })
        ).error,
        "Membership fixture failed",
      );
      const connection = await createOwnerAgentConnection(
        { companyId: companyIds[i], userId: userIds[i] },
        { label: "Temporary bilateral verification" },
      );
      tokens.push(connection.token);
      must(
        !(
          await db.from("purposes").insert({
            id: purposeIds[i],
            company_id: companyIds[i],
            name: `Bilateral purpose ${i}`,
          })
        ).error,
        "Purpose fixture failed",
      );
      const client = new Client({
        name: "Puente bilateral regression",
        version: "1.0.0",
      });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL("/api/mcp", base), {
          requestInit: { headers: { Authorization: `Bearer ${tokens[i]}` } },
        }),
      );
      const pdf = await PDFDocument.create();
      pdf.addPage([100 + i, 100]);
      const bytes = await pdf.save();
      originals.push(bytes);
      const source = await registerLocalFiles(
        async () => tokens[i],
        [
          new File([new Uint8Array(bytes)], `bilateral-${i}.pdf`, {
            type: "application/pdf",
          }),
        ],
      );
      sources.push(source);
      documents.push(source.documents[0].id);
      await call(client, "correct_document_classification", {
        document_id: documents[i],
        document_type: "tax_status",
        sensitive: false,
      });
      await call(client, "set_document_sharing", {
        document_id: documents[i],
        override: { mode: "approval", allowed_purpose_ids: [purposeIds[i]] },
      });
      const ownCatalog = await call(client, "list_documents");
      must(
        ownCatalog.access_scope === "owner" &&
          (ownCatalog.documents as { id: string }[]).some(
            (d) => d.id === documents[i],
          ),
        "Owner catalog scope failed",
      );
    }
    pass(
      "Both agents register, classify and set approval permissions on their own documents",
    );
    const bridge = await call(clients[0], "create_bridge", {
      counterparty_id: companyIds[1],
      hours: 1,
    });
    must(typeof bridge.id === "string", "Bridge id unavailable");
    bridgeId = bridge.id;
    const requesterTokens: string[] = [];
    for (let ownerIndex = 0; ownerIndex < 2; ownerIndex++) {
      const requesterIndex = 1 - ownerIndex;
      const code = await call(clients[ownerIndex], "issue_access_code", {
        bridge_id: bridgeId,
      });
      must(
        code.actor_company_id === companyIds[requesterIndex],
        "Code actor did not follow bridge direction",
      );
      const access = await call(clients[requesterIndex], "exchange_code", {
        code: code.code,
      });
      must(
        access.bridge_id === bridgeId &&
          access.actor_company_id === companyIds[requesterIndex] &&
          typeof access.token === "string",
        "Exchange changed bridge or actor",
      );
      requesterTokens[requesterIndex] = access.token;
      const catalog = await call(clients[requesterIndex], "list_documents", {
        token: access.token,
      });
      must(
        (catalog.documents as { id: string }[]).some(
          (d) => d.id === documents[ownerIndex],
        ),
        "Counterpart catalog missing",
      );
      must(
        !(catalog.documents as { id: string }[]).some(
          (d) => d.id === documents[requesterIndex],
        ),
        "Requester catalog direction reversed",
      );
      must(
        (catalog.offered_documents as { id: string }[]).some(
          (d) => d.id === documents[requesterIndex],
        ),
        "Optional offers are not requester-owned",
      );
    }
    pass(
      "A and B issue reciprocal codes on one bridge; the same MCP clients switch scopes with explicit tokens",
    );
    for (let ownerIndex = 0; ownerIndex < 2; ownerIndex++) {
      const requesterIndex = 1 - ownerIndex;
      const requester = clients[requesterIndex],
        owner = clients[ownerIndex];
      const pt = requesterTokens[requesterIndex],
        documentId = documents[ownerIndex];
      await denied(requester, "correct_document_classification", {
        document_id: documentId,
        sensitive: true,
      });
      await denied(requester, "set_document_sharing", {
        document_id: documentId,
        override: null,
      });
      await denied(requester, "set_document_sharing", {
        token: pt,
        document_id: documentId,
        override: null,
      });
      await denied(requester, "request_document", {
        token: pt,
        document_id: documentId,
        purpose_id: purposeIds[requesterIndex],
      });
      const requested = await call(requester, "request_document", {
        token: pt,
        document_id: documentId,
        purpose_id: purposeIds[ownerIndex],
      });
      must(
        requested.status === "pending" &&
          typeof requested.request_id === "string",
        "Unapproved document escaped owner review",
      );
      must(
        Array.isArray(requested.offered_document_ids) &&
          requested.offered_document_ids.length === 0,
        "Reciprocal offer unexpectedly mandatory",
      );
      const requestId = requested.request_id;
      await denied(requester, "decide_request", {
        request_id: requestId,
        action: "approve",
      });
      await denied(requester, "decide_request", {
        token: pt,
        request_id: requestId,
        action: "approve",
      });
      const pending = await call(requester, "get_request_status", {
        token: pt,
        request_id: requestId,
      });
      must(
        pending.status === "pending" && !pending.transfer,
        "Requester self-approved its request",
      );
      const incoming = await call(owner, "list_requests");
      must(
        (incoming.requests as { id: string }[]).some((r) => r.id === requestId),
        "Owner cannot see incoming request",
      );
      const approved = await call(owner, "decide_request", {
        request_id: requestId,
        action: "approve",
      });
      must(
        approved.status === "approved",
        "Actual document owner could not approve",
      );
      const delivered = await call(requester, "get_request_status", {
        token: pt,
        request_id: requestId,
      });
      must(
        delivered.status === "delivered" && delivered.transfer,
        "Approved original did not become available",
      );
      const result = await beginPeerDownload(
        delivered.transfer as PeerTransfer,
      );
      must(
        digest(new Uint8Array(await result.arrayBuffer())) ===
          digest(originals[ownerIndex]),
        "Peer delivery changed original bytes",
      );
      const ownAgain = await call(requester, "list_documents");
      must(
        ownAgain.access_scope === "owner" &&
          (ownAgain.documents as { id: string }[]).some(
            (d) => d.id === documents[requesterIndex],
          ),
        "Temporary requester role replaced permanent owner access",
      );
      pass(
        `${requesterIndex ? "B requests A" : "A requests B"}: isolated owner controls, optional offers, owner-only approval and identical peer bytes`,
      );
    }
    const rows = await db
      .from("requests")
      .select(
        "bridge_id,requester_company_id,owner_company_id,email_message_id",
      )
      .eq("bridge_id", bridgeId);
    must(
      !rows.error &&
        rows.data.length === 2 &&
        rows.data.every((r) => !r.email_message_id),
      "Unexpected request or outbound notification",
    );
    must(
      new Set(rows.data.map((r) => r.requester_company_id)).size === 2 &&
        new Set(rows.data.map((r) => r.owner_company_id)).size === 2,
      "Both directions were not recorded",
    );
    pass(
      "The same bilateral bridge records each company as requester and owner; no emails were sent",
    );
  } finally {
    for (const source of sources) source.close();
    for (const client of clients) await client.close().catch(() => {});
    const cleanupErrors: string[] = [];
    const remove = async (table: string, column: string, values: string[]) => {
      const result = await db.from(table).delete().in(column, values);
      if (result.error) cleanupErrors.push(`${table}: ${result.error.message}`);
    };
    // Every deletion is bounded to these randomly generated fixture companies.
    for (const table of ["peer_transfers", "access_events", "receipts"])
      await remove(table, "company_id", companyIds);
    const fixtureRequests = await db
      .from("requests")
      .select("id")
      .in("owner_company_id", companyIds);
    if (fixtureRequests.error)
      cleanupErrors.push("Request cleanup lookup failed");
    if (fixtureRequests.data?.length)
      await remove(
        "approval_links",
        "request_id",
        fixtureRequests.data.map((r) => r.id),
      );
    await remove("requests", "owner_company_id", companyIds);
    if (bridgeId) {
      await remove("access_codes", "bridge_id", [bridgeId]);
      await remove("agent_tokens", "bridge_id", [bridgeId]);
      await remove("bridges", "id", [bridgeId]);
    }
    for (const table of [
      "documents",
      "document_sources",
      "owner_agent_connections",
      "company_members",
      "purposes",
    ])
      await remove(table, "company_id", companyIds);
    await remove("companies", "id", companyIds);
    for (const id of userIds) {
      const result = await db.auth.admin.deleteUser(id);
      if (result.error) cleanupErrors.push("Auth fixture cleanup failed");
    }
    must(
      !cleanupErrors.length,
      `Fixture cleanup failed: ${cleanupErrors.join("; ")}`,
    );
  }
  console.log(
    `PASS ${passed} bilateral verification groups; all temporary fixtures removed.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Bilateral verification failed",
  );
  process.exit(1);
});
