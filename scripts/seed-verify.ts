/** Live checks against fictional demo data; transient test rows are removed. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = process.env.PUENTE_DEMO_PASSWORD!;
if (!url || !secret || !anonKey || !password)
  throw new Error("Missing demo environment");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const acme = "11111111-1111-4111-8111-111111111111";
const globex = "22222222-2222-4222-8222-222222222222";
const bridge = randomUUID();
const fixtureIds = (companyIndex: number) =>
  Array.from(
    { length: 8 },
    (_, i) =>
      `dddd0000-${String(companyIndex + 1).padStart(4, "0")}-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
const allFixtureIds = [...fixtureIds(0), ...fixtureIds(1)];
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const randomHash = () => digest(randomBytes(32));
const passed: string[] = [];
const record = (name: string) => {
  passed.push(name);
  console.log(`PASS ${name}`);
};
const requireSuccess = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
async function main() {
  const anon = createClient(url, anonKey, options);
  assert(
    (await anon.from("documents").select("id")).error,
    "Anonymous document read must fail",
  );
  record("Anonymous document access denied");
  for (const [email, company] of [
    ["acme@puente.demo", acme],
    ["globex@puente.demo", globex],
  ]) {
    const client = createClient(url, anonKey, options);
    requireSuccess(
      (await client.auth.signInWithPassword({ email, password })).error,
    );
    const { data, error } = await client
      .from("documents")
      .select("id,company_id");
    requireSuccess(error);
    const expected = fixtureIds(company === acme ? 0 : 1);
    assert(
      expected.every((id) => data?.some((d) => d.id === id)),
      "Every seeded company document must be visible",
    );
    assert(data?.every((d) => d.company_id === company));
    assert(
      (await client.from("agent_tokens").select("*")).error,
      "Token table must be inaccessible",
    );
    assert(
      (
        await client
          .from("documents")
          .update({ title: "FORBIDDEN" })
          .eq("id", randomUUID())
      ).error,
      "Browser update must fail",
    );
    assert(
      (
        await client.rpc("redeem_access_code", {
          p_code_hash: randomHash(),
          p_token_hash: randomHash(),
        })
      ).error,
      "Browser RPC call must fail",
    );
    record(
      `${email}: own-company RLS, no secrets, no writes, no privileged RPC`,
    );
  }
  const { data: docs, error: docsError } = await admin
    .from("documents")
    .select("*")
    .in("id", allFixtureIds);
  requireSuccess(docsError);
  assert.equal(docs?.length, 16);
  for (const doc of docs!) {
    const downloaded = await admin.storage
      .from("documents")
      .download(doc.storage_path);
    requireSuccess(downloaded.error);
    assert.equal(
      digest(new Uint8Array(await downloaded.data!.arrayBuffer())),
      doc.sha256,
    );
  }
  record("All 16 seeded private PDF originals match stored SHA-256");
  const sample = docs![0];
  const publicUrl = admin.storage
    .from("documents")
    .getPublicUrl(sample.storage_path).data.publicUrl;
  assert(!(await fetch(publicUrl)).ok, "Public Storage URL must fail");
  const signed = await admin.storage
    .from("documents")
    .createSignedUrl(sample.storage_path, 60);
  requireSuccess(signed.error);
  const signedDownload = await fetch(signed.data!.signedUrl);
  assert(signedDownload.ok);
  assert.equal(
    digest(new Uint8Array(await signedDownload.arrayBuffer())),
    sample.sha256,
  );
  record(
    "Public Storage download denied; short signed URL returns unchanged original",
  );

  requireSuccess(
    (
      await admin
        .from("bridges")
        .insert({
          id: bridge,
          company_a_id: acme,
          company_b_id: globex,
          expires_at: new Date(Date.now() + 86400000 * 2).toISOString(),
        })
    ).error,
  );
  const codeHash = randomHash();
  requireSuccess(
    (
      await admin
        .from("access_codes")
        .insert({
          code_hash: codeHash,
          bridge_id: bridge,
          actor_company_id: globex,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
    ).error,
  );
  const raced = await Promise.all(
    [1, 2].map(() =>
      admin.rpc("redeem_access_code", {
        p_code_hash: codeHash,
        p_token_hash: randomHash(),
      }),
    ),
  );
  assert.equal(raced.filter((r) => !r.error).length, 1);
  assert.equal(raced.filter((r) => r.error).length, 1);
  const token = raced.find((r) => !r.error)!.data;
  assert.equal(token.actor_company_id, globex);
  assert(
    Math.abs(new Date(token.expires_at).valueOf() - Date.now() - 86400000) <
      10000,
  );
  record(
    "Concurrent code redemption yields exactly one company-scoped 24-hour token",
  );
  const expired = randomHash();
  requireSuccess(
    (
      await admin
        .from("access_codes")
        .insert({
          code_hash: expired,
          bridge_id: bridge,
          actor_company_id: globex,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        })
    ).error,
  );
  assert(
    (
      await admin.rpc("redeem_access_code", {
        p_code_hash: expired,
        p_token_hash: randomHash(),
      })
    ).error,
  );
  record("Expired code rejected");

  const balance = docs!.find(
    (d) => d.company_id === acme && d.document_type === "balance_sheet",
  )!;
  const requestId = randomUUID();
  requireSuccess(
    (
      await admin
        .from("requests")
        .insert({
          id: requestId,
          bridge_id: bridge,
          requester_company_id: globex,
          owner_company_id: acme,
          document_id: balance.id,
          purpose_id: "aaaa0000-0001-4000-8000-000000000001",
          purpose_text: "Alta como proveedor",
          reason: "security_test_sensitive",
          offered_document_ids: [],
        })
    ).error,
  );
  const hashes = {
    approve: randomHash(),
    deny: randomHash(),
    manual: randomHash(),
  };
  requireSuccess(
    (
      await admin
        .from("approval_links")
        .insert(
          Object.entries(hashes).map(([action, token_hash]) => ({
            token_hash,
            action,
            request_id: requestId,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          })),
        )
    ).error,
  );
  assert(
    (
      await admin.rpc("consume_approval_link", {
        p_token_hash: hashes.approve,
        p_action: "deny",
      })
    ).error,
  );
  record("Approval token cannot perform another action");
  const approved = await admin.rpc("consume_approval_link", {
    p_token_hash: hashes.approve,
    p_action: "approve",
    p_create_rule: true,
  });
  requireSuccess(approved.error);
  assert.equal(approved.data.status, "approved");
  assert.equal(approved.data.rule_created, false);
  const { data: links } = await admin
    .from("approval_links")
    .select("used_at")
    .eq("request_id", requestId);
  assert(links?.every((l) => l.used_at));
  assert(
    (
      await admin.rpc("consume_approval_link", {
        p_token_hash: hashes.deny,
        p_action: "deny",
      })
    ).error,
  );
  assert(
    (
      await admin.rpc("consume_approval_link", {
        p_token_hash: hashes.approve,
        p_action: "approve",
      })
    ).error,
  );
  record(
    "Approval consumes all sibling links, blocks replay, preserves financial escalation",
  );
  const pendingId = randomUUID();
  requireSuccess(
    (
      await admin
        .from("requests")
        .insert({
          id: pendingId,
          bridge_id: bridge,
          requester_company_id: globex,
          owner_company_id: acme,
          document_id: balance.id,
          purpose_text: "Alta como proveedor",
          reason: "security_test_revocation",
        })
    ).error,
  );
  requireSuccess(
    (await admin.from("bridges").update({ status: "revoked" }).eq("id", bridge))
      .error,
  );
  const revokedCode = randomHash();
  requireSuccess(
    (
      await admin
        .from("access_codes")
        .insert({
          code_hash: revokedCode,
          bridge_id: bridge,
          actor_company_id: globex,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
    ).error,
  );
  assert(
    (
      await admin.rpc("redeem_access_code", {
        p_code_hash: revokedCode,
        p_token_hash: randomHash(),
      })
    ).error,
  );
  assert(
    (
      await admin.rpc("resolve_access_request", {
        p_request_id: pendingId,
        p_owner_company_id: acme,
        p_action: "approve",
      })
    ).error,
  );
  record("Revoked bridge blocks code redemption and pending approval");
}
async function cleanup() {
  const requests = await admin
    .from("requests")
    .select("id")
    .eq("bridge_id", bridge);
  if (requests.data?.length)
    await admin
      .from("approval_links")
      .delete()
      .in(
        "request_id",
        requests.data.map((r) => r.id),
      );
  for (const table of [
    "access_events",
    "requests",
    "agent_tokens",
    "access_codes",
  ])
    await admin.from(table).delete().eq("bridge_id", bridge);
  await admin.from("bridges").delete().eq("id", bridge);
}
main()
  .then(async () => {
    await cleanup();
    console.log(JSON.stringify({ success: true, checks: passed.length }));
  })
  .catch(async (error) => {
    console.error(error.message);
    await cleanup();
    process.exitCode = 1;
  });
