"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export function EmailAccessForm({
  onSession,
}: {
  onSession: (session: Session) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!resendAt) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          ...(mode === "signup" ? { name: name.trim() } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The code could not be sent. Please try again.",
        );
      setChallenge(result.challenge_id);
      setCode("");
      setResendAt(Date.now() + (result.resend_after || 60) * 1000);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The code could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!challenge) return sendCode();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: challenge,
          email: email.trim(),
          code,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This code could not be verified.");
      const client = getSupabaseBrowser();
      if (!client) throw new Error("Authentication is not configured.");
      const { data, error: sessionError } = await client.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (sessionError || !data.session)
        throw sessionError || new Error("The session could not be opened.");
      onSession(data.session);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "This code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="email-access-form">
      {challenge ? (
        <>
          <p className="form-note" role="status">
            We sent an access code to <strong>{email}</strong>. You will enter
            it below to stay signed in for 30 days.
          </p>
          <label>
            Access code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              pattern="[0-9]{6,10}"
              maxLength={10}
              minLength={6}
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 10))
              }
              placeholder="Code from your email"
              disabled={busy}
            />
          </label>
        </>
      ) : (
        <>
          <div
            className="email-access-modes"
            role="group"
            aria-label="Account access"
          >
            <button
              type="button"
              className={`button ${mode === "signin" ? "button-dark" : "button-outline"}`}
              disabled={busy}
              aria-pressed={mode === "signin"}
              onClick={() => {
                setMode("signin");
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`button ${mode === "signup" ? "button-dark" : "button-outline"}`}
              disabled={busy}
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setError("");
              }}
            >
              Create account
            </button>
          </div>
          {mode === "signup" && (
            <label>
              Your name
              <input
                autoComplete="name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Full name"
                disabled={busy}
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              disabled={busy}
            />
          </label>
        </>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button button-dark button-full"
        disabled={
          busy ||
          (challenge
            ? !/^\d{6,10}$/.test(code)
            : !email.trim() || (mode === "signup" && !name.trim()))
        }
      >
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <>
            {challenge ? "Enter workspace" : "Email me a code"}
            <ArrowRight size={17} />
          </>
        )}
      </button>
      {challenge ? (
        <div className="email-access-secondary">
          <button
            type="button"
            className="button button-outline button-small"
            disabled={busy || remaining > 0}
            onClick={() => void sendCode()}
          >
            {remaining > 0 ? `Resend in ${remaining}s` : "Resend code"}
          </button>
          <button
            type="button"
            className="button button-outline button-small"
            disabled={busy}
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError("");
            }}
          >
            Change email
          </button>
        </div>
      ) : (
        <p className="form-note">
          Your access code will arrive by email. This browser will stay signed
          in for 30 days.
        </p>
      )}
    </form>
  );
}
