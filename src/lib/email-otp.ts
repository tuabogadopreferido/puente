import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { ApiError, assertDb } from "@/lib/http";

const emailInput = z
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
export const requestCodeInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().pipe(emailInput),
  })
  .strict();
export const verifyCodeInput = z
  .object({
    challenge_id: z.uuid(),
    email: z.string().trim().pipe(emailInput),
    code: z
      .string()
      .trim()
      .regex(/^\d{6,10}$/),
  })
  .strict();

function fingerprint(value: string) {
  const key = process.env.APP_SIGNING_SECRET;
  if (!key || key.length < 32)
    throw new ApiError(
      503,
      "Email sign-in is not configured",
      "auth_unavailable",
    );
  return createHmac("sha256", key)
    .update(`puente.email-login.v1:${value}`)
    .digest("hex");
}

/** Do not let another website silently send login email using a browser request. */
export function checkLoginOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const allowed = new Set([new URL(request.url).origin]);
  if (expected) allowed.add(new URL(expected).origin);
  if (!allowed.has(origin))
    throw new ApiError(403, "Open Puente to sign in", "invalid_origin");
}

export async function requestEmailCode(request: Request, value: unknown) {
  checkLoginOrigin(request);
  const input = requestCodeInput.parse(value);
  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX_ID;
  if (!key || !inbox)
    throw new ApiError(
      503,
      "Email delivery is not configured",
      "auth_unavailable",
    );
  // The hosting proxy sets this header. Email and global limits also apply, even
  // when a local development caller has no proxy-provided address.
  const ip = (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    "local"
  )
    .split(",")[0]
    .trim();
  const { data: reserved, error } = await admin().rpc("reserve_email_login", {
    p_email: input.email,
    p_name: input.name ?? "My workspace",
    p_ip_hash: fingerprint(`ip:${ip}`),
  });
  assertDb(error);
  if (!reserved?.challenge_id)
    throw new ApiError(
      429,
      "Please wait before requesting another code",
      "rate_limited",
    );
  const challengeId = z.uuid().parse(reserved.challenge_id);
  try {
    const { data, error: generateError } =
      await admin().auth.admin.generateLink({
        type: "magiclink",
        email: input.email,
        ...(input.name ? { options: { data: { full_name: input.name } } } : {}),
      });
    if (generateError || !data.properties?.email_otp || !data.user)
      throw new ApiError(
        503,
        "A sign-in code could not be created. Please retry.",
        "auth_unavailable",
      );
    const code = data.properties.email_otp;
    if (!/^\d{6,10}$/.test(code))
      throw new ApiError(
        503,
        "Email sign-in is temporarily unavailable",
        "auth_unavailable",
      );
    const { data: prepared, error: prepareError } = await admin()
      .from("email_login_challenges")
      .update({
        code_hash: fingerprint(`${challengeId}:${code}`),
        user_id: data.user.id,
        status: "ready",
      })
      .eq("id", challengeId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    assertDb(prepareError);
    if (!prepared)
      throw new ApiError(
        409,
        "A newer sign-in code has been requested",
        "code_replaced",
      );
    const response = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `puente-login-${challengeId}`,
        },
        body: JSON.stringify({
          to: [input.email],
          subject: "Your Puente sign-in code",
          text: `Your Puente sign-in code is ${code}.\n\nEnter it in the Puente tab where you requested it. It expires in 10 minutes and can be used once. You will stay signed in for 30 days.\n\nIf you did not request this code, ignore this email.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#17372e"><p>PUENTE</p><h1 style="font-size:26px">Your sign-in code</h1><p style="font-size:36px;letter-spacing:8px;font-weight:bold">${code}</p><p>Enter it in the Puente tab where you requested it. This code expires in 10 minutes and can be used once.</p><p>You will stay signed in for 30 days.</p><p style="font-size:13px;color:#667266">If you did not request this code, ignore this email.</p></div>`,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    // Never log the provider response: authentication email contains a credential.
    if (!response.ok)
      throw new ApiError(
        503,
        "Your code could not be delivered. Please retry shortly.",
        "email_unavailable",
      );
    return { challenge_id: challengeId, expires_in: 600, resend_after: 60 };
  } catch (error) {
    await admin()
      .from("email_login_challenges")
      .update({ status: "failed" })
      .eq("id", challengeId)
      .in("status", ["pending", "ready"]);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "Email sign-in is temporarily unavailable. Please retry shortly.",
      "auth_unavailable",
    );
  }
}

export function verifiedSessionId(token: string) {
  // Call only AFTER Supabase has verified the JWT (getUser or verifyOtp).
  try {
    return z
      .uuid()
      .parse(
        JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        ).session_id,
      );
  } catch {
    throw new ApiError(
      401,
      "Please request a new sign-in code",
      "unauthorized",
    );
  }
}

export async function verifyEmailCode(request: Request, value: unknown) {
  checkLoginOrigin(request);
  const input = verifyCodeInput.parse(value);
  const db = admin();
  const { data: claimed, error } = await db.rpc("claim_email_login", {
    p_challenge_id: input.challenge_id,
    p_email: input.email,
    p_code_hash: fingerprint(`${input.challenge_id}:${input.code}`),
  });
  assertDb(error);
  if (!claimed?.valid)
    throw new ApiError(
      400,
      "This code is invalid or expired. Request a new code if needed.",
      "invalid_code",
    );
  // A dedicated anon client avoids attaching a user's session to the singleton
  // service-role client used by unrelated concurrent API requests.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon)
    throw new ApiError(
      503,
      "Email sign-in is not configured",
      "auth_unavailable",
    );
  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: verifyError } = await auth.auth.verifyOtp({
    email: input.email,
    token: input.code,
    type: "email",
  });
  if (verifyError || !data.session || !data.user)
    throw new ApiError(
      400,
      "This code is invalid or expired. Request a new code.",
      "invalid_code",
    );
  const { data: registered, error: registerError } = await db.rpc(
    "finish_email_login",
    {
      p_challenge_id: input.challenge_id,
      p_user_id: data.user.id,
      p_session_id: verifiedSessionId(data.session.access_token),
    },
  );
  if (registerError || !registered?.company_id) {
    await auth.auth.signOut({ scope: "local" });
    throw new ApiError(
      503,
      "Your workspace could not be opened. Request another code and try again.",
      "auth_unavailable",
    );
  }
  return {
    session: data.session,
    session_expires_at: registered.expires_at,
    company_id: registered.company_id,
  };
}
