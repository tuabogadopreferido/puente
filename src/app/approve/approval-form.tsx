"use client";
import { useState } from "react";
import type { ApprovalAction } from "@/lib/types";
export default function ApprovalForm({ token, action, allowRule }: { token: string; action: ApprovalAction; allowRule: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const labels = { approve: "Confirm approval", deny: "Confirm denial", manual: "Send response" };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/approvals/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, createRule: form.get("createRule") === "on", manualResponse: String(form.get("manualResponse") || "") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The decision could not be saved.");
      setDone(true);
      setMessage(action === "approve" ? "Approved. The requesting agent can now retrieve this original PDF." : action === "deny" ? "Request denied. No document access was granted." : "Your response is available to the requesting agent. Document access remains restricted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setPending(false); }
  }
  if (done) return <div role="status" style={{ background: "#e6f4eb", borderRadius: 12, padding: 22, lineHeight: 1.6 }}>{message}</div>;
  return <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
    {action === "manual" && <label style={{ display: "grid", gap: 10 }}>Your response<textarea name="manualResponse" required maxLength={5000} rows={5} placeholder="Write the response the requesting agent will receive." style={{ border: "1px solid #c4d0c8", borderRadius: 10, padding: 12, font: "inherit", width: "100%", boxSizing: "border-box" }} /></label>}
    {action === "approve" && allowRule && <label style={{ display: "flex", alignItems: "flex-start", gap: 10, lineHeight: 1.5 }}><input type="checkbox" name="createRule" style={{ marginTop: 5 }} />Approve future requests for this document type, counterparty and purpose.</label>}
    {action === "approve" && !allowRule && <p style={{ color: "#685b40", fontSize: 14 }}>This exception requires individual review. This approval will apply only to this request.</p>}
    <button disabled={pending} type="submit" style={{ cursor: pending ? "wait" : "pointer", background: action === "deny" ? "#863b30" : "#14583f", color: "white", padding: "16px 24px", border: 0, borderRadius: 12, fontSize: 16, fontWeight: 650 }}>{pending ? "Saving decision…" : labels[action]}</button>
    {message && <p role="alert" style={{ color: "#863b30", lineHeight: 1.5 }}>{message}</p>}
  </form>;
}
