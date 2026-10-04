/** Opt-in batch/override authorization regression. Synthetic metadata only; no mail. */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { admin } from "../src/lib/supabase-admin";
import { createOwnerAgentConnection } from "../src/lib/owner-agent-connections";
import { requireOwnerAgentToken } from "../src/lib/owner-agent";
import {
  getDocumentSharing,
  assertSharingPurpose,
  assertRequestSharing,
  saveDocumentBatch,
  setDocumentSharing,
  listDocumentBatches,
} from "../src/lib/document-sharing";
import { resolveRequest } from "../src/lib/approval";
import { decideAccess } from "../src/lib/rules";
import type { PuenteDocument, Purpose, Rule } from "../src/lib/types";
import { ApiError } from "../src/lib/http";
if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute for synthetic batch authorization checks.",
  );
  process.exit(0);
}
loadEnvConfig(process.cwd());
const db = admin(),
  company = randomUUID(),
  foreign = randomUUID(),
  source = randomUUID(),
  docIds = [randomUUID(), randomUUID()],
  purposeIds = [randomUUID(), randomUUID()],
  foreignPurpose = randomUUID(),
  foreignDoc = randomUUID(),
  bridgeId = randomUUID(),
  requestId = randomUUID();
let userId = "",
  connectionId = "",
  passed = 0;
function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pass(message: string) {
  passed++;
  console.log(`PASS ${message}`);
}
async function denied(fn: () => unknown | Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (error) {
    must(
      error instanceof ApiError && error.status === status,
      "Unexpected sharing rejection",
    );
    return;
  }
  throw new Error("Expected sharing denial");
}
async function main() {
  try {
    const companyCreate = await db.from("companies").insert([
      {
        id: company,
        name: "Sharing fixture",
        tax_id: null,
        contact_email: "sharing@example.invalid",
      },
      {
        id: foreign,
        name: "Other sharing fixture",
        tax_id: null,
        contact_email: "other@example.invalid",
      },
    ]);
    must(!companyCreate.error, "Could not create company fixtures");
    const user = await db.auth.admin.createUser({
      email: `sharing-${company}@example.invalid`,
      email_confirm: true,
    });
    must(!user.error && user.data.user, "Could not create owner fixture");
    userId = user.data.user.id;
    must(
      !(
        await db
          .from("company_members")
          .insert({ company_id: company, user_id: userId })
      ).error,
      "Could not create membership",
    );
    const connection = await createOwnerAgentConnection(
      { userId, companyId: company },
      { label: "sharing-regression" },
    );
    connectionId = connection.connection.id;
    const owner = await requireOwnerAgentToken(connection.token);
    must(
      !(
        await db.from("purposes").insert([
          ...purposeIds.map((id, index) => ({
            id,
            company_id: company,
            name: `Purpose ${index}`,
          })),
          {
            id: foreignPurpose,
            company_id: foreign,
            name: "Foreign purpose",
          },
        ])
      ).error,
      "Purpose fixtures unavailable",
    );
    must(
      !(
        await db.from("document_sources").insert({
          id: source,
          company_id: company,
          user_id: userId,
          owner_connection_id: connectionId,
          label: "Metadata-only fixture",
        })
      ).error,
      "Source fixture unavailable",
    );
    const documents = docIds.map((id, index) => ({
      id,
      company_id: company,
      title: `Document ${index}`,
      document_type: index ? "balance_sheet" : "tax_status",
      sensitive: !!index,
      sha256: "a".repeat(64),
      storage_path: null,
      extracted_text: "",
      source_id: source,
      source_key: randomUUID(),
      size_bytes: 100,
      classification_source: "owner_reviewed",
    }));
    must(
      !(await db.from("documents").insert(documents)).error,
      "Document fixtures unavailable",
    );
    const initial = await getDocumentSharing(company, docIds[0]);
    must(
      initial.revision === "0:none:0" && initial.effective.mode === "rules",
      "Default sharing changed",
    );
    assertSharingPurpose(initial, purposeIds[0]);
    await denied(() => assertSharingPurpose(initial, foreignPurpose), 403);
    await denied(() => assertSharingPurpose(initial, null), 403);
    pass(
      "Default sharing retains existing-rule review and restricts purposes to the owner's list",
    );
    const created = await saveDocumentBatch(owner, null, {
      name: "Restricted batch",
      document_ids: docIds,
      settings: { mode: "approval", allowed_purpose_ids: [purposeIds[0]] },
    });
    must(created.batch, "Batch not returned");
    const batchId = created.batch.id;
    const inherited = await getDocumentSharing(company, docIds[0]);
    must(
      inherited.effective.mode === "approval" && inherited.batch_id === batchId,
      "Batch settings did not reach document",
    );
    assertSharingPurpose(inherited, purposeIds[0]);
    await denied(() => assertSharingPurpose(inherited, purposeIds[1]), 403);
    const rename = await saveDocumentBatch(owner, batchId, {
      name: "Renamed batch",
    });
    const afterRename = await getDocumentSharing(company, docIds[0]);
    must(
      rename.batch?.document_ids.length === 2 &&
        afterRename.revision === inherited.revision &&
        afterRename.effective.mode === "approval",
      "Renaming reset settings, members or revision",
    );
    pass(
      "Batch settings inherit to every member; renaming preserves permissions and membership",
    );
    const override = await setDocumentSharing(owner, docIds[0], {
      override: { mode: "rules", allowed_purpose_ids: [purposeIds[1]] },
    });
    must(
      override.effective.mode === "rules" &&
        override.revision !== inherited.revision,
      "Explicit override unavailable",
    );
    assertSharingPurpose(override, purposeIds[1]);
    await denied(() => assertSharingPurpose(override, purposeIds[0]), 403);
    await saveDocumentBatch(owner, batchId, {
      settings: { mode: "approval", allowed_purpose_ids: [] },
    });
    const unchanged = await getDocumentSharing(company, docIds[0]);
    must(
      unchanged.revision === override.revision,
      "Parent settings replaced explicit document override",
    );
    const blocked = await getDocumentSharing(company, docIds[1]);
    await denied(() => assertSharingPurpose(blocked, purposeIds[0]), 403);
    const reset = await setDocumentSharing(owner, docIds[0], {
      override: null,
    });
    await denied(() => assertSharingPurpose(reset, purposeIds[1]), 403);
    pass(
      "Overrides are explicit and stable; clearing an override inherits the batch's empty deny-all purpose list",
    );
    await denied(
      () =>
        saveDocumentBatch(owner, null, {
          name: "Cross scope",
          document_ids: [foreignDoc],
        }),
      409,
    );
    await denied(
      () =>
        setDocumentSharing(owner, docIds[0], {
          override: { mode: "rules", allowed_purpose_ids: [foreignPurpose] },
        }),
      400,
    );
    await denied(
      () =>
        setDocumentSharing({ ...owner, companyId: foreign }, docIds[0], {
          override: null,
        }),
      403,
    );
    pass(
      "Cross-workspace documents, purposes and owner identities are rejected",
    );
    await setDocumentSharing(owner, docIds[0], {
      override: { mode: "approval", allowed_purpose_ids: null },
    });
    const approvedPolicy = await getDocumentSharing(company, docIds[0]);
    const oldRequest = {
      owner_company_id: company,
      document_id: docIds[0],
      purpose_id: purposeIds[0],
      sharing_revision: approvedPolicy.revision,
    };
    await assertRequestSharing(oldRequest);
    must(
      !(
        await db
          .from("bridges")
          .insert({
            id: bridgeId,
            company_a_id: company,
            company_b_id: foreign,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          })
      ).error,
      "Bridge fixture unavailable",
    );
    must(
      !(
        await db
          .from("requests")
          .insert({
            ...oldRequest,
            id: requestId,
            bridge_id: bridgeId,
            requester_company_id: foreign,
            purpose_text: "Purpose 0",
            status: "pending",
            reason: "Sharing guard fixture",
          })
      ).error,
      "Request fixture unavailable",
    );
    await setDocumentSharing(owner, docIds[0], {
      override: { mode: "approval", allowed_purpose_ids: [purposeIds[1]] },
    });
    await denied(() => assertRequestSharing(oldRequest), 409);
    await denied(
      () =>
        resolveRequest({
          requestId,
          ownerCompanyId: company,
          action: "approve",
        }),
      409,
    );
    await setDocumentSharing(owner, docIds[0], {
      override: { mode: "approval", allowed_purpose_ids: null },
    });
    await denied(() => assertRequestSharing(oldRequest), 409);
    pass(
      "Changed settings block owner approval; restoring them never revives an older request",
    );
    const malformed = await db.rpc("save_document_batch", {
      p_company_id: company,
      p_user_id: userId,
      p_connection_id: connectionId,
      p_session_id: null,
      p_batch_id: batchId,
      p_name: null,
      p_document_ids: null,
      p_settings: { allowed_purpose_ids: null },
    });
    must(malformed.error, "Database accepted settings with missing mode");
    pass(
      "Database validation fails closed when an internal caller omits a sharing mode",
    );
    const financial = documents[1] as unknown as PuenteDocument,
      purpose = { id: purposeIds[0], company_id: company } as Purpose,
      rule = {
        company_id: company,
        document_type: "balance_sheet",
        purpose_id: purposeIds[0],
        counterparty_id: null,
      } as Rule;
    must(
      !decideAccess(financial, purpose, [rule], foreign).allowed,
      "Financial information bypassed manual approval",
    );
    const catalog = await listDocumentBatches(owner);
    must(
      catalog.documents.length === 2 && catalog.batches.length === 1,
      "Owner batch catalog mismatch",
    );
    pass(
      "Financial documents remain subject to manual review; owner catalog exposes effective settings",
    );
    const revoked = await db
      .from("owner_agent_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", connectionId);
    must(!revoked.error, "Could not revoke fixture connection");
    await denied(
      () => setDocumentSharing(owner, docIds[0], { override: null }),
      403,
    );
    pass("Revoking an owner credential immediately blocks sharing changes");
  } finally {
    for (const table of ["requests", "rules"]) {
      const column = table === "requests" ? "owner_company_id" : "company_id";
      must(
        !(await db.from(table).delete().eq(column, company)).error,
        `Cleanup ${table} failed`,
      );
    }
    must(
      !(await db.from("bridges").delete().eq("id", bridgeId)).error,
      "Bridge cleanup failed",
    );
    must(
      !(await db.from("documents").delete().eq("company_id", company)).error,
      "Document cleanup failed",
    );
    for (const table of [
      "document_batches",
      "document_sources",
      "owner_agent_connections",
      "company_members",
    ])
      must(
        !(await db.from(table).delete().eq("company_id", company)).error,
        `Cleanup ${table} failed`,
      );
    must(
      !(await db.from("purposes").delete().in("company_id", [company, foreign]))
        .error,
      "Purpose cleanup failed",
    );
    must(
      !(await db.from("companies").delete().in("id", [company, foreign])).error,
      "Company cleanup failed",
    );
    if (userId)
      must(
        !(await db.auth.admin.deleteUser(userId)).error,
        "Auth cleanup failed",
      );
  }
  console.log(
    `PASS ${passed} sharing groups; metadata fixtures removed; no original files or email used.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Sharing verification failed",
  );
  process.exitCode = 1;
});
