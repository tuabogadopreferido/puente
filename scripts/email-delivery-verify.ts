/** Explicit end-to-end email check, restricted to Puente's own AgentMail inbox. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { requestEmailCode, verifyEmailCode } from "../src/lib/email-otp";
import { requireOwner } from "../src/lib/auth";

if (!process.argv.includes("--execute")) {
  console.log(
    "NOT RUN: --execute sends one sign-in email to Puente's own inbox.",
  );
  process.exit(0);
}
loadEnvConfig(process.cwd());
const recipient = "puente-dataroom@agentmail.to";
const inbox = process.env.AGENTMAIL_INBOX_ID;
const key = process.env.AGENTMAIL_API_KEY;
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
type Message = {
  message_id: string;
  to: string[];
  subject?: string;
  created_at?: string;
  timestamp?: string;
  labels: string[];
};
async function mail(path: string) {
  const result = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox!)}/messages${path}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  must(result.ok, "AgentMail message read failed");
  return result.json();
}
async function main() {
  must(
    inbox === recipient && key,
    "This check may only target Puente's own inbox",
  );
  const baseline = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  must(
    !baseline.error &&
      !baseline.data.users.some(
        (user) => user.email?.toLowerCase() === recipient,
      ),
    "Inbox already belongs to a real Puente account; no test mutation performed",
  );
  let challengeId: string | undefined,
    companyId: string | undefined,
    userId: string | undefined;
  try {
    const started = Date.now();
    const request = new Request(
      "https://puente-phi.vercel.app/api/auth/request-code",
      { method: "POST" },
    );
    const challenge = await requestEmailCode(request, {
      name: "Puente email delivery verification",
      email: recipient,
    });
    challengeId = challenge.challenge_id;
    console.log(
      "PASS Application login flow sent one OTP email to Puente's own inbox",
    );
    let message: Message | undefined;
    for (let attempt = 0; attempt < 15; attempt++) {
      const listing = await mail("?limit=20");
      message = (listing.messages as Message[]).find(
        (item) =>
          item.subject === "Your Puente sign-in code" &&
          item.to.some((to) => to.includes(recipient)) &&
          Date.parse(item.created_at || item.timestamp || "") >=
            started - 2000 &&
          (item.labels.includes("received") || item.labels.includes("sent")),
      );
      if (message) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    must(
      message,
      "The sign-in message was not available in Puente's inbox within 30 seconds",
    );
    const received = await mail(`/${encodeURIComponent(message.message_id)}`);
    const code = String(received.text || "").match(
      /sign-in code is (\d{6,10})\./,
    )?.[1];
    must(code, "Received email did not contain the expected code");
    console.log(
      `PASS AgentMail persisted the ${message.labels.includes("received") ? "received" : "sent"} email; code read only from its message body`,
    );
    const result = await verifyEmailCode(request, {
      challenge_id: challengeId,
      email: recipient,
      code,
    });
    companyId = result.company_id;
    userId = result.session.user.id;
    const owner = await requireOwner(
      new Request("https://puente-phi.vercel.app/api/dashboard", {
        headers: { Authorization: `Bearer ${result.session.access_token}` },
      }),
    );
    must(
      owner.companyId === companyId && owner.userId === userId,
      "Delivered code did not establish a verified owner session",
    );
    console.log(
      "PASS Emailed code opened the empty workspace with a valid 30-day owner session",
    );
  } finally {
    if (challengeId && !userId) {
      const pending = await db
        .from("email_login_challenges")
        .select("user_id")
        .eq("id", challengeId)
        .maybeSingle();
      userId = pending.data?.user_id;
    }
    if (userId && !companyId) {
      const membership = await db
        .from("company_members")
        .select("company_id")
        .eq("user_id", userId)
        .maybeSingle();
      companyId = membership.data?.company_id;
    }
    if (companyId) {
      for (const table of ["purposes", "company_members"])
        must(
          !(await db.from(table).delete().eq("company_id", companyId)).error,
          "Workspace cleanup failed",
        );
      must(
        !(await db.from("companies").delete().eq("id", companyId)).error,
        "Workspace cleanup failed",
      );
    }
    if (userId)
      must(
        !(await db.auth.admin.deleteUser(userId)).error,
        "Auth user cleanup failed",
      );
    if (challengeId)
      must(
        !(
          await db.from("email_login_challenges").delete().eq("id", challengeId)
        ).error,
        "Challenge cleanup failed",
      );
  }
  console.log(
    "PASS Test account, workspace and session removed; email history preserved",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Email verification failed",
  );
  process.exitCode = 1;
});
