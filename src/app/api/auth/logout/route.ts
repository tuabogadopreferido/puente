import { requireHumanSession } from "@/lib/auth";
import { checkLoginOrigin } from "@/lib/email-otp";
import { admin } from "@/lib/supabase-admin";
import { assertDb, endpoint } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    checkLoginOrigin(request);
    const { user, sessionId } = await requireHumanSession(request);
    const { error } = await admin()
      .from("human_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .eq("user_id", user.id);
    assertDb(error);
    return { signed_out: true };
  });
}
