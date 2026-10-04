/** Opt-in integration checks against Puente. No email is sent; fixtures are removed. */
import { loadEnvConfig } from "@next/env";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { verifyEmailCode, verifiedSessionId } from "../src/lib/email-otp";
import {
  requireHumanSession,
  requireOwner,
  requireAgentToken,
  sha256,
} from "../src/lib/auth";
import {
  createOwnerAgentConnection,
  authenticateOwnerAgentConnection,
} from "../src/lib/owner-agent-connections";
import { ApiError } from "../src/lib/http";
import { POST as logout } from "../src/app/api/auth/logout/route";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: add --execute for temporary auth fixtures; no email is sent.",
  );
  process.exit(0);
}
loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (
  new URL(url).hostname !== "iuhxutsngsmpzjaklzlp.supabase.co" ||
  !anon ||
  !service
)
  throw new Error("Expected Puente environment required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, service, options);
const run = randomUUID();
const users = new Set<string>();
const companies = new Set<string>();
const challenges = new Set<string>();
const bridges = new Set<string>();
const tokens = new Set<string>();
const emails = new Set<string>();
let passed = 0;
function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pass(message: string) {
  passed++;
  console.log(`PASS ${message}`);
}
function fingerprint(value: string) {
  return createHmac("sha256", process.env.APP_SIGNING_SECRET!)
    .update(`puente.email-login.v1:${value}`)
    .digest("hex");
}
function request(token?: string) {
  return new Request("https://puente-phi.vercel.app/api/auth/verify-code", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
async function denied(action: () => Promise<unknown>, expected = 401) {
  try {
    await action();
  } catch (error) {
    must(
      error instanceof ApiError && error.status === expected,
      `Expected denial ${expected}`,
    );
    return;
  }
  throw new Error("Expected authentication denial");
}
async function fixture(label: string) {
  const email = `auth-${run}-${label}@example.invalid`;
  emails.add(email);
  const { data: challenge, error } = await db.rpc("reserve_email_login", {
    p_email: email,
    p_name: `Auth fixture ${label}`,
    p_ip_hash: fingerprint(`test-ip:${label}:${run}`),
  });
  must(
    !error && challenge?.challenge_id,
    "Could not reserve fixture challenge",
  );
  const id = challenge.challenge_id as string;
  challenges.add(id);
  const { data: generated, error: ge } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  must(
    !ge && generated?.user && generated.properties.email_otp,
    "Native Supabase code unavailable",
  );
  users.add(generated.user.id);
  const code = generated.properties.email_otp;
  const update = await db
    .from("email_login_challenges")
    .update({
      status: "ready",
      user_id: generated.user.id,
      code_hash: fingerprint(`${id}:${code}`),
    })
    .eq("id", id);
  must(!update.error, "Could not ready fixture challenge");
  return { email, challenge_id: id, code, userId: generated.user.id };
}
async function login(label: string) {
  const input = await fixture(label);
  const result = await verifyEmailCode(request(), {
    challenge_id: input.challenge_id,
    email: input.email,
    code: input.code,
  });
  companies.add(result.company_id);
  return { ...input, ...result };
}
function browser(session: Session) {
  return createClient(url, anon, {
    ...options,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

async function main() {
  try {
    const a = await login("a");
    const b = await login("b");
    const owner = await requireOwner(request(a.session.access_token));
    must(
      owner.userId === a.userId && owner.companyId === a.company_id,
      "Login identity mismatch",
    );
    const company = await db
      .from("companies")
      .select("name,tax_id,contact_email")
      .eq("id", a.company_id)
      .single();
    const docs = await db
      .from("documents")
      .select("id")
      .eq("company_id", a.company_id);
    must(
      !company.error &&
        company.data?.tax_id === null &&
        company.data.contact_email === a.email &&
        company.data.name === "Auth fixture a" &&
        docs.data?.length === 0,
      "Workspace must be empty and verified, without invented tax ID",
    );
    const sessionId = verifiedSessionId(a.session.access_token);
    const record = await db
      .from("human_sessions")
      .select("created_at,expires_at")
      .eq("session_id", sessionId)
      .single();
    must(
      record.data &&
        Date.parse(record.data.expires_at) -
          Date.parse(record.data.created_at) ===
          30 * 86400_000,
      "Session must last exactly 30 days",
    );
    pass(
      "Native email code creates one verified private workspace and a fixed 30-day session",
    );

    const own = await browser(a.session).from("companies").select("id");
    const foreign = await browser(a.session)
      .from("company_members")
      .select("user_id")
      .eq("user_id", b.userId);
    must(
      !own.error &&
        own.data?.length === 1 &&
        own.data[0].id === a.company_id &&
        !foreign.error &&
        foreign.data?.length === 0,
      "RLS leaked another workspace",
    );
    pass("RLS isolates two actual signed-in users");

    const protectedTable = await browser(a.session)
      .from("human_sessions")
      .select("session_id");
    const protectedRpc = await browser(a.session).rpc("finish_email_login", {
      p_challenge_id: a.challenge_id,
      p_user_id: a.userId,
      p_session_id: sessionId,
    });
    must(
      protectedTable.error && protectedRpc.error,
      "Browser must not mint, inspect or extend session records",
    );
    pass(
      "Browser roles cannot read or mint the server-controlled session allowlist",
    );

    await denied(
      () =>
        verifyEmailCode(request(), {
          challenge_id: a.challenge_id,
          email: a.email,
          code: a.code,
        }),
      400,
    );
    const resent = await db.rpc("reserve_email_login", {
      p_email: a.email,
      p_name: "No duplicate",
      p_ip_hash: fingerprint(`other:${run}`),
    });
    must(
      !resent.error && resent.data?.rate_limited && !resent.data.challenge_id,
      "Immediate resend must be rate limited",
    );
    const capped = await fixture("attempts");
    for (let attempt = 0; attempt < 6; attempt++) {
      const wrong = await db.rpc("claim_email_login", {
        p_challenge_id: capped.challenge_id,
        p_email: capped.email,
        p_code_hash: "0".repeat(64),
      });
      must(
        !wrong.error && wrong.data?.valid === false,
        "Wrong code should fail",
      );
    }
    await denied(
      () =>
        verifyEmailCode(request(), {
          challenge_id: capped.challenge_id,
          email: capped.email,
          code: capped.code,
        }),
      400,
    );
    pass(
      "Codes are single use, resend is throttled, and six wrong attempts lock the challenge",
    );

    const direct = await fixture("bypass");
    const native = createClient(url, anon, options);
    const nativeResult = await native.auth.verifyOtp({
      email: direct.email,
      token: direct.code,
      type: "email",
    });
    must(
      !nativeResult.error && nativeResult.data.session,
      "Direct native OTP fixture failed",
    );
    await denied(() =>
      requireHumanSession(request(nativeResult.data.session!.access_token)),
    );
    const directRead = await browser(nativeResult.data.session)
      .from("companies")
      .select("id");
    must(
      !directRead.error && directRead.data?.length === 0,
      "Native auth bypass must not expose application data",
    );
    pass(
      "Calling Supabase verifyOtp directly cannot bypass Puente's human-session allowlist",
    );

    const durable = await createOwnerAgentConnection(owner, {
      label: `auth-regression-${run}`,
    });
    const bridge = await db
      .from("bridges")
      .insert({
        company_a_id: a.company_id,
        company_b_id: b.company_id,
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
      })
      .select("id")
      .single();
    must(!bridge.error && bridge.data, "Temporary bridge unavailable");
    bridges.add(bridge.data.id);
    const bridgeToken = `pt_${randomUUID()}`;
    tokens.add(sha256(bridgeToken));
    const bt = await db.from("agent_tokens").insert({
      token_hash: sha256(bridgeToken),
      bridge_id: bridge.data.id,
      actor_company_id: b.company_id,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    must(!bt.error, "Bridge token fixture unavailable");
    const created = new Date(Date.now() - 31 * 86400_000);
    const expired = await db
      .from("human_sessions")
      .update({
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + 30 * 86400_000).toISOString(),
      })
      .eq("session_id", sessionId);
    must(!expired.error, "Could not age human session");
    await denied(() => requireOwner(request(a.session.access_token)));
    const expiredRead = await browser(a.session).from("companies").select("id");
    must(
      !expiredRead.error && expiredRead.data?.length === 0,
      "Expired session retained RLS access",
    );
    const refreshClient = createClient(url, anon, options);
    const refreshed = await refreshClient.auth.refreshSession({
      refresh_token: a.session.refresh_token,
    });
    must(
      !refreshed.error &&
        refreshed.data.session &&
        verifiedSessionId(refreshed.data.session.access_token) === sessionId,
      "Native token refresh fixture failed",
    );
    await denied(() =>
      requireOwner(request(refreshed.data.session!.access_token)),
    );
    const refreshedRead = await browser(refreshed.data.session)
      .from("companies")
      .select("id");
    must(
      !refreshedRead.error && refreshedRead.data?.length === 0,
      "Token refresh extended expired access",
    );
    const durableOwner = await authenticateOwnerAgentConnection(durable.token);
    const bridgeOwner = await requireAgentToken(bridgeToken);
    must(
      durableOwner.companyId === a.company_id &&
        bridgeOwner.actorCompanyId === b.company_id,
      "Human expiry must not revoke independent agent/bridge tokens",
    );
    pass(
      "At day 30 APIs/RLS deny even refreshed JWTs, while owner-agent and bridge credentials remain independent",
    );

    const signout = await logout(request(b.session.access_token));
    must(signout.ok, "Explicit logout failed");
    await denied(() => requireHumanSession(request(b.session.access_token)));
    const loggedOutRead = await browser(b.session)
      .from("companies")
      .select("id");
    must(
      !loggedOutRead.error && loggedOutRead.data?.length === 0,
      "Logged-out JWT retained RLS access",
    );
    pass(
      "Logout immediately revokes server and RLS access before the JWT itself expires",
    );
  } finally {
    if (tokens.size)
      must(
        !(
          await db
            .from("agent_tokens")
            .delete()
            .in("token_hash", [...tokens])
        ).error,
        "Token cleanup failed",
      );
    if (bridges.size)
      must(
        !(
          await db
            .from("bridges")
            .delete()
            .in("id", [...bridges])
        ).error,
        "Bridge cleanup failed",
      );
    for (const company of companies) {
      for (const table of [
        "owner_agent_connections",
        "purposes",
        "company_members",
      ])
        must(
          !(await db.from(table).delete().eq("company_id", company)).error,
          `Cleanup failed: ${table}`,
        );
      must(
        !(await db.from("companies").delete().eq("id", company)).error,
        "Company cleanup failed",
      );
    }
    for (const user of users)
      must(
        !(await db.auth.admin.deleteUser(user)).error,
        "Auth user cleanup failed",
      );
    if (challenges.size)
      must(
        !(
          await db
            .from("email_login_challenges")
            .delete()
            .in("id", [...challenges])
        ).error,
        "Challenge cleanup failed",
      );
    if (emails.size) {
      const remaining = await db
        .from("email_login_challenges")
        .select("id")
        .in("email", [...emails]);
      must(
        !remaining.error && remaining.data?.length === 0,
        "Challenge fixtures remain",
      );
    }
  }
  console.log(
    `PASS ${passed} auth integration groups; temporary data removed; no email sent.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Auth verification failed",
  );
  process.exitCode = 1;
});
