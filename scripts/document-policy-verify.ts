/** Exercises owner classification through HTTP using one temporary metadata row, removed in finally. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { documentTypes } from "../src/lib/document-policy";

const base = (process.env.PUENTE_TEST_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = process.env.PUENTE_DEMO_PASSWORD!;
if (!url || !anon || !secret || !password)
  throw new Error("Missing demo environment");
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const id = randomUUID();
const acme = "11111111-1111-4111-8111-111111111111";
let inserted = false;
let checks = 0;
async function login(email: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  assert(!result.error && result.data.session, "Demo sign-in failed");
  return result.data.session.access_token;
}
async function patch(
  token: string,
  body: Record<string, unknown>,
  documentId: string = id,
) {
  const response = await fetch(`${base}/api/documents/${documentId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, data: await response.json() };
}
async function main() {
  const [owner, otherOwner] = await Promise.all([
    login("acme@puente.demo"),
    login("globex@puente.demo"),
  ]);
  const created = await admin.from("documents").insert({
    id,
    company_id: acme,
    title: "Temporary classification policy verification",
    document_type: "other",
    sensitive: false,
    sha256: "0".repeat(64),
    storage_path: `${acme}/policy-test-${id}.pdf`,
    extracted_text: "",
    classification_source: "owner_reviewed",
  });
  assert(!created.error, "Temporary metadata creation failed");
  inserted = true;
  for (const type of documentTypes.filter((type) => type !== "other")) {
    const expected = [
      "balance_sheet",
      "income_statement",
      "tax_return",
    ].includes(type);
    const result = await patch(owner, {
      document_type: type,
      sensitive: !expected,
    });
    assert.equal(result.status, 200, "Type correction failed");
    assert.equal(result.data.document_type, type);
    assert.equal(
      result.data.sensitive,
      expected,
      "Sensitivity must follow effective type",
    );
    const partial = await patch(owner, { sensitive: !expected });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.document_type, type);
    assert.equal(
      partial.data.sensitive,
      expected,
      "Partial correction must respect existing type",
    );
    checks += 2;
  }
  for (const value of [false, true]) {
    const result = await patch(owner, {
      document_type: "other",
      sensitive: value,
    });
    assert.equal(result.status, 200);
    assert.equal(
      result.data.sensitive,
      value,
      "Other documents retain the owner sensitivity choice",
    );
    checks++;
  }
  const noFlag = await patch(owner, { document_type: "bank_cover" });
  assert.equal(noFlag.status, 200);
  assert.equal(noFlag.data.sensitive, false);
  checks++;
  const leapDay = await patch(owner, { expires_at: "2028-02-29" });
  assert.equal(leapDay.status, 200);
  assert.equal(leapDay.data.expires_at, "2028-02-29");
  checks++;
  for (const expires_at of [
    "2026-02-30",
    "2026-02-29",
    "2026-13-01",
    "0000-01-01",
    "2026-10-03T00:00:00Z",
  ]) {
    assert.equal(
      (await patch(owner, { expires_at })).status,
      400,
      "Invalid calendar date must fail validation",
    );
    checks++;
  }
  assert.equal(
    (await patch(owner, { sensitive: true }, "not-a-uuid")).status,
    400,
  );
  checks++;
  assert.equal(
    (await patch(otherOwner, { document_type: "balance_sheet" })).status,
    404,
  );
  checks++;
  const final = await admin
    .from("documents")
    .select("document_type,sensitive,expires_at")
    .eq("id", id)
    .single();
  assert(!final.error);
  assert.deepEqual(final.data, {
    document_type: "bank_cover",
    sensitive: false,
    expires_at: "2028-02-29",
  });
  checks++;
}
main()
  .then(() =>
    console.log(
      JSON.stringify({
        success: true,
        checks,
        policy: "onboarding_routine_financial_sensitive_other_owner_choice",
      }),
    ),
  )
  .catch(() => {
    console.error(
      "Classification endpoint verification failed. No credentials or document content logged.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!inserted) return;
    const removed = await admin
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("company_id", acme);
    const remaining = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    if (removed.error || remaining.error || remaining.count !== 0) {
      console.error("Temporary metadata cleanup failed");
      process.exitCode = 1;
    } else
      console.log(
        JSON.stringify({
          temporary_document_removed: true,
          seeded_documents_unchanged: true,
        }),
      );
  });
