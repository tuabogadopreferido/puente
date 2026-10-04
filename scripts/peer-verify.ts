/** Opt-in real WebRTC regression. Temporary, isolated metadata fixtures only. */
import { loadEnvConfig } from "@next/env";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  RTCPeerConnection as NodePeer,
  type RTCDataChannel as NodeChannel,
} from "werift";
import { PDFDocument } from "pdf-lib";
import { admin } from "../src/lib/supabase-admin";
import {
  configurePeerRuntime,
  registerLocalFiles,
  beginPeerDownload,
  type LocalSourceHandle,
  type PeerTransfer,
} from "../src/lib/p2p-client";
if (!process.argv.includes("--execute")) {
  console.log("NOT RUN: add --execute for isolated peer transfer tests.");
  process.exit(0);
}
loadEnvConfig(process.cwd());
const base = process.env.PUENTE_TEST_URL || "http://localhost:3100";
const db = admin(),
  ids = [randomUUID(), randomUUID()],
  userIds: string[] = [],
  handles: LocalSourceHandle[] = [];
const tokens = ids.map(() => "po_" + randomBytes(32).toString("base64url"));
const connectionIds = ids.map(() => randomUUID());
const purposeId = randomUUID();
const bridgeId = randomUUID(),
  requestId = randomUUID(),
  counterpartyToken = "pt_" + randomBytes(32).toString("base64url");
const digest = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const must = (v: unknown, message: string) => {
  if (!v) throw new Error(message);
};
let passed = 0;
function pass(message: string) {
  passed++;
  console.log(`PASS ${message}`);
}
async function api(path: string, token: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
const sentByChannel = new WeakMap<RTCDataChannel, number>();
configurePeerRuntime({
  baseUrl: base,
  createPeer: () =>
    new NodePeer({
      iceServers: [],
      iceAdditionalHostAddresses: ["127.0.0.1"],
    }) as unknown as RTCPeerConnection,
  sendBytes: (channel, bytes) => {
    const native = channel as unknown as NodeChannel;
    native.send(Buffer.from(bytes));
    const count = (sentByChannel.get(channel) ?? 0) + bytes.byteLength;
    sentByChannel.set(channel, count);
    // Reproduce the native-browser race: a repeated completion arrives while
    // the receiver is hashing and awaiting its final authorization response.
    if (count === 20 * 1024 * 1024)
      native.send(JSON.stringify({ type: "complete" }));
  },
});
async function main() {
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db.auth.admin.createUser({
        email: `peer-check-${ids[i]}@example.invalid`,
        email_confirm: true,
      });
      if (user.error || !user.data.user)
        throw new Error("Could not create isolated peer fixture user");
      userIds.push(user.data.user.id);
      let r = await db.from("companies").insert({
        id: ids[i],
        name: "Temporary peer verification",
        tax_id: "",
        contact_email: user.data.user.email,
      });
      if (r.error) throw r.error;
      r = await db.from("company_members").insert({
        company_id: ids[i],
        user_id: user.data.user.id,
        role: "owner",
      });
      if (r.error) throw r.error;
      r = await db.from("owner_agent_connections").insert({
        id: connectionIds[i],
        company_id: ids[i],
        user_id: user.data.user.id,
        label: "Temporary peer verification",
        token_hash: digest(tokens[i]),
      });
      if (r.error) throw r.error;
    }
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const small = await pdf.save();
    const bytes = new Uint8Array(20 * 1024 * 1024);
    bytes.fill(32);
    bytes.set(small);
    const original = new File([bytes], "peer-check-original.pdf", {
      type: "application/pdf",
    });
    const source = await registerLocalFiles(async () => tokens[0], [original]);
    handles.push(source);
    const documentId = source.documents[0].id;
    const stored = await db
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();
    must(
      !stored.error &&
        stored.data.storage_path === null &&
        stored.data.extracted_text === "" &&
        stored.data.size_bytes === bytes.byteLength,
      "File contents were persisted or metadata was wrong",
    );
    const buckets = await db.storage.listBuckets();
    must(
      !buckets.data?.some((b) => b.id === "documents"),
      "Legacy document storage bucket remains",
    );
    pass(
      "20 MiB original registered as metadata only; no Storage bucket or extracted text",
    );
    const foreign = await api(`/api/sources/${source.sourceId}`, tokens[1]);
    must(foreign.status === 404, "Another company accessed a local source");
    pass("Source ownership rejects another company");
    const issue = await api(
      `/api/owner/documents/${documentId}/download`,
      tokens[0],
      {},
    );
    must(issue.status === 200, `Transfer issue failed: ${issue.data.error}`);
    const transfer = issue.data.transfer as PeerTransfer;
    const wrong = await api(
      `/api/transfers/${transfer.transfer_id}`,
      randomBytes(32).toString("base64url"),
    );
    must(wrong.status === 401, "Wrong transfer capability was accepted");
    const premature = await api(
      `/api/transfers/${transfer.transfer_id}`,
      transfer.transfer_secret,
      { action: "complete", sha256: transfer.sha256 },
    );
    must(premature.status === 409, "Pending transfer accepted completion");
    pass(
      "Recipient capability and transfer-state checks reject invalid access",
    );
    const blob = await beginPeerDownload(transfer);
    const received = new Uint8Array(await blob.arrayBuffer());
    must(
      received.byteLength === bytes.byteLength &&
        digest(received) === digest(bytes),
      "Original bytes changed in peer transfer",
    );
    pass(
      "Two real WebRTC peers delivered 20 MiB with identical SHA-256 and byte count",
    );
    const retry = await api(
      `/api/transfers/${transfer.transfer_id}`,
      transfer.transfer_secret,
      { action: "complete", sha256: transfer.sha256 },
    );
    must(retry.status === 200, "Completion retry failed");
    const audits = await db
      .from("access_events")
      .select("id")
      .eq("document_id", documentId)
      .eq("action", "peer_document_received");
    must(audits.data?.length === 1, "Completion duplicated receipt audit");
    pass("Completion is idempotent and signaling is cleared");
    const purposeSetup = await db.from("purposes").insert({
      id: purposeId,
      company_id: ids[0],
      name: "Peer verification purpose",
    });
    if (purposeSetup.error) throw purposeSetup.error;
    let setup = await db.from("bridges").insert({
      id: bridgeId,
      company_a_id: ids[0],
      company_b_id: ids[1],
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    if (setup.error) throw setup.error;
    setup = await db.from("agent_tokens").insert({
      token_hash: digest(counterpartyToken),
      bridge_id: bridgeId,
      actor_company_id: ids[1],
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    if (setup.error) throw setup.error;
    setup = await db.from("requests").insert({
      id: requestId,
      bridge_id: bridgeId,
      requester_company_id: ids[1],
      owner_company_id: ids[0],
      document_id: documentId,
      purpose_text: "Isolated peer verification",
      purpose_id: purposeId,
      status: "approved",
      reason: "Test fixture",
    });
    if (setup.error) throw setup.error;
    const bridgeIssue = await api(
      `/api/requests/${requestId}`,
      counterpartyToken,
    );
    must(
      bridgeIssue.status === 200,
      `Bridge transfer issue failed: ${bridgeIssue.data.error}`,
    );
    const bridgeTransfer = bridgeIssue.data.transfer as PeerTransfer;
    const partnerOriginal = await beginPeerDownload(bridgeTransfer);
    must(
      digest(new Uint8Array(await partnerOriginal.arrayBuffer())) ===
        digest(bytes),
      "The authorized counterparty received different bytes",
    );
    pass(
      "An approved counterparty receives the same 20 MiB original through its bridge",
    );
    must(
      Date.parse(bridgeTransfer.expires_at) <= Date.now() + 300000,
      "Transfer exceeds bridge lifetime bound",
    );
    await db.from("bridges").update({ status: "revoked" }).eq("id", bridgeId);
    const invalidBridge = await api(
      `/api/transfers/${bridgeTransfer.transfer_id}`,
      bridgeTransfer.transfer_secret,
    );
    must(invalidBridge.status === 403, "Revoked bridge still allows download");
    const ownStillWorks = await api(
      `/api/owner/documents/${documentId}/download`,
      tokens[0],
      {},
    );
    must(
      ownStillWorks.status === 200,
      "Bridge revocation incorrectly revoked source owner",
    );
    pass(
      "Bridge revocation blocks its receiver while permanent owner access remains independent",
    );
    await db.from("bridges").update({ status: "active" }).eq("id", bridgeId);
    const activeIssue = await api(
      `/api/requests/${requestId}`,
      counterpartyToken,
    );
    must(activeIssue.status === 200, "Could not issue mid-transfer check");
    let revokedDuringTransfer = false;
    try {
      await beginPeerDownload(activeIssue.data.transfer, (received) => {
        if (!revokedDuringTransfer && received >= 65536) {
          revokedDuringTransfer = true;
          void db
            .from("bridges")
            .update({ status: "revoked" })
            .eq("id", bridgeId)
            .then(() => {});
        }
      });
      throw new Error("Revoked transfer unexpectedly completed");
    } catch (error) {
      must(
        revokedDuringTransfer &&
          !String(error).includes("unexpectedly completed"),
        "Live bridge revocation was not enforced",
      );
    }
    pass("Revocation during an active WebRTC transfer prevents final delivery");
    await db.from("bridges").update({ status: "active" }).eq("id", bridgeId);
    const policyIssue = await api(
      `/api/requests/${requestId}`,
      counterpartyToken,
    );
    must(
      policyIssue.status === 200,
      "Could not issue sharing-policy regression transfer",
    );
    const policyResponse = await fetch(
      `${base}/api/documents/${documentId}/sharing`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokens[0]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          override: { mode: "approval", allowed_purpose_ids: [purposeId] },
        }),
      },
    );
    must(
      policyResponse.status === 200,
      "Document sharing override could not be applied",
    );
    const staleTransfer = await api(
      `/api/transfers/${policyIssue.data.transfer.transfer_id}`,
      policyIssue.data.transfer.transfer_secret,
    );
    must(
      [409, 410].includes(staleTransfer.status),
      "A changed sharing policy did not invalidate the active transfer",
    );
    const staleRequest = await api(
      `/api/requests/${requestId}`,
      counterpartyToken,
    );
    must(
      staleRequest.status === 409,
      "A previously approved request ignored changed sharing permissions",
    );
    pass(
      "Sharing changes invalidate existing requests and transfer capabilities",
    );
    const revokedIssue = await api(
      `/api/owner/documents/${documentId}/download`,
      tokens[0],
      {},
    );
    must(revokedIssue.status === 200, "Could not issue revocation test");
    await db
      .from("owner_agent_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", connectionIds[0]);
    const revoked = await api(
      `/api/transfers/${revokedIssue.data.transfer.transfer_id}`,
      revokedIssue.data.transfer.transfer_secret,
    );
    must(
      revoked.status === 403,
      "Revoked source connection allowed a transfer",
    );
    pass("Revoking the owner connection invalidates existing transfers");
    await db
      .from("owner_agent_connections")
      .update({ revoked_at: null })
      .eq("id", connectionIds[0]);
    source.close();
    await pause(2500);
    await db
      .from("document_sources")
      .update({ online_until: new Date(Date.now() - 60000).toISOString() })
      .eq("id", source.sourceId);
    const offline = await api(
      `/api/owner/documents/${documentId}/download`,
      tokens[0],
      {},
    );
    must(
      offline.status === 503,
      "Offline source was presented as downloadable",
    );
    pass(
      "Offline source produces an explicit error rather than a stored-file fallback",
    );
    const t = await db
      .from("peer_transfers")
      .select("offer,answer")
      .eq("id", transfer.transfer_id)
      .single();
    must(
      !t.data?.offer && !t.data?.answer,
      "Completed signaling retained network metadata",
    );
  } finally {
    for (const h of handles) h.close();
    await pause(100);
    await db.from("requests").delete().eq("id", requestId);
    await db.from("agent_tokens").delete().eq("bridge_id", bridgeId);
    for (const table of [
      "peer_transfers",
      "access_events",
      "receipts",
      "documents",
      "document_sources",
      "owner_agent_connections",
      "company_members",
    ]) {
      const r = await db.from(table).delete().in("company_id", ids);
      if (r.error)
        throw new Error(`Fixture cleanup failed: ${table}: ${r.error.message}`);
    }
    await db.from("bridges").delete().eq("id", bridgeId);
    await db.from("purposes").delete().eq("id", purposeId);
    const r = await db.from("companies").delete().in("id", ids);
    if (r.error) throw r.error;
    for (const id of userIds) {
      const r = await db.auth.admin.deleteUser(id);
      if (r.error) throw r.error;
    }
  }
  console.log(
    `PASS ${passed} peer verification groups; all temporary fixtures removed.`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
