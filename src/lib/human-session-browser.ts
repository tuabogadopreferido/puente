import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export async function validateHumanSession(session: Session | null) {
  if (!session) return null;
  const response = await fetch("/api/auth/session", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (response.status === 401) {
    await getSupabaseBrowser()?.auth.signOut({ scope: "local" });
    return null;
  }
  if (!response.ok)
    throw new Error(
      "Your session could not be checked. Please refresh to try again.",
    );
  return session;
}

export async function endHumanSession(session: Session) {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok && response.status !== 401) {
    throw new Error("Sign-out could not be confirmed. Please try again.");
  }
  const result = await getSupabaseBrowser()?.auth.signOut({ scope: "local" });
  if (result?.error)
    throw new Error(
      "The server session was closed, but this browser could not clear its local session. Please retry sign-out.",
    );
}
