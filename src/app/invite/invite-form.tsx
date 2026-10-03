"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
export default function InviteForm({
  token,
  companyName,
}: {
  token: string;
  companyName: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) return;
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, value) =>
      setSession(value),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const client = getSupabaseBrowser();
      if (!client) throw new Error("Authentication is not configured.");
      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/invite?token=${encodeURIComponent(token)}`,
          },
        });
        if (error) throw error;
        setSession(data.session);
        setMessage(
          "You will receive an email confirmation link. After confirming your mailbox, you will return to this invitation and sign in to accept. Keep this invitation link available.",
        );
      } else {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }
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
        "Your bridge is ready. You can open the workspace and upload your company's documents. Each document request will follow the owner's permissions.",
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
              void getSupabaseBrowser()
                ?.auth.signOut()
                .then(() => {
                  setSession(null);
                  setMessage("");
                })
            }
          >
            Use a different email
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className={`button ${mode === "signin" ? "button-dark" : "button-outline"}`}
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`button ${mode === "signup" ? "button-dark" : "button-outline"}`}
              onClick={() => setMode("signup")}
            >
              Create account
            </button>
          </div>
          <form onSubmit={authenticate} style={{ display: "grid", gap: 16 }}>
            <label>
              Invited email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
                minLength={8}
              />
            </label>
            <button className="button button-dark button-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account and confirm email"
                  : "Sign in to review invitation"}
            </button>
          </form>
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
