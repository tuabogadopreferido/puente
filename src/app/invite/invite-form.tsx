"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { EmailAccessForm } from "@/components/email-access-form";
import {
  validateHumanSession,
  endHumanSession,
} from "@/lib/human-session-browser";
export default function InviteForm({
  token,
  companyName,
}: {
  token: string;
  companyName: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) return;
    client.auth
      .getSession()
      .then(({ data }) => validateHumanSession(data.session))
      .then(setSession)
      .catch((reason) =>
        setMessage(
          reason instanceof Error
            ? reason.message
            : "Session verification failed.",
        ),
      );
    const { data } = client.auth.onAuthStateChange((_event, value) =>
      setSession(value),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  async function accept() {
    if (!session) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The invitation could not be accepted.",
        );
      setAccepted(true);
      setMessage(
        "Your bridge is ready. You can open the workspace and register your company's files at their source. Each document request will follow the owner's permissions.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Acceptance failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 25, display: "grid", gap: 15 }}>
      {accepted ? (
        <>
          <p
            role="status"
            style={{
              padding: 18,
              background: "#e5f3e9",
              lineHeight: 1.6,
              borderRadius: 10,
            }}
          >
            {message}
          </p>
          <Link className="button button-dark button-full" href="/">
            Open workspace
          </Link>
        </>
      ) : session ? (
        <>
          <p style={{ fontSize: 14 }}>
            Signed in as <strong>{session.user.email}</strong>
          </p>
          <button
            className="button button-dark button-full"
            disabled={busy}
            onClick={() => void accept()}
          >
            {busy
              ? "Creating your bridge…"
              : `Accept invitation for ${companyName}`}
          </button>
          <button
            className="button button-outline button-full"
            disabled={busy}
            onClick={() =>
              void endHumanSession(session)
                .then(() => {
                  setSession(null);
                  setMessage("");
                })
                .catch((reason) =>
                  setMessage(
                    reason instanceof Error
                      ? reason.message
                      : "Sign-out could not be confirmed.",
                  ),
                )
            }
          >
            Use a different email
          </button>
        </>
      ) : (
        <>
          <EmailAccessForm onSession={setSession} />
        </>
      )}
      {!accepted && message && (
        <p
          role="status"
          style={{
            background: "#f4f6f0",
            padding: 15,
            lineHeight: 1.6,
            borderRadius: 10,
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
