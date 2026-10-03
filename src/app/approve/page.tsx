import type { Metadata } from "next";
import Link from "next/link";
import { inspectApproval } from "@/lib/approval";
import ApprovalForm from "./approval-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review a request · Puente", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let details;
  let error = "";
  try { if (!token) throw new Error("Open a review link from your Puente notification email."); details = await inspectApproval(token); }
  catch (cause) { error = cause instanceof Error ? cause.message : "This review link is unavailable."; }
  const document = details?.document;
  const allowRule = !!details?.request.purpose_id && !["awaiting_owner_review", "unclassified"].includes(document?.classification_source || "") && !document?.sensitive && (!document?.expires_at || document.expires_at >= new Date().toISOString().slice(0, 10));
  return <main style={{ minHeight: "100vh", background: "#f5f4ee", padding: "50px 20px", color: "#193c31", fontFamily: "Arial, sans-serif" }}>
    <div style={{ maxWidth: 580, margin: "0 auto" }}>
      <Link href="/" style={{ fontSize: 25, letterSpacing: "-1px", color: "#14583f", fontWeight: 750, textDecoration: "none" }}>puente</Link>
      <section style={{ background: "white", border: "1px solid #e1e4db", padding: "32px clamp(20px,5vw,36px)", marginTop: 28, borderRadius: 20, boxShadow: "0 12px 45px #18382908" }}>
        <p style={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: "#738276", margin: "0 0 14px" }}>Private document review</p>
        <h1 style={{ fontSize: 32, lineHeight: 1.15, letterSpacing: "-1px", margin: "0 0 22px" }}>{details ? details.action === "approve" ? "Approve this request" : details.action === "deny" ? "Decline this request" : "Give a manual response" : "Review link unavailable"}</h1>
        {error && <p role="alert" style={{ lineHeight: 1.6 }}>{error}</p>}
        {details && token && <>
          <p style={{ lineHeight: 1.65 }}><strong>{details.requester}</strong> requested <strong>{document?.title || "a document"}</strong> from {details.owner}.</p>
          <dl style={{ display: "grid", gap: 8, margin: "24px 0", padding: 20, background: "#f4f6f0", borderRadius: 12, fontSize: 14, lineHeight: 1.5 }}>
            <dt style={{ color: "#708171" }}>Declared purpose</dt><dd style={{ margin: "0 0 10px" }}>{details.request.purpose_text}</dd>
            <dt style={{ color: "#708171" }}>Reason for review</dt><dd style={{ margin: 0 }}>{details.request.reason}</dd>
          </dl>
          <ApprovalForm token={token} action={details.action} allowRule={allowRule} />
          <p style={{ color: "#798277", fontSize: 12, lineHeight: 1.6, marginTop: 24 }}>Opening this page does not change access. Your decision will be recorded when you confirm it. This link can be used once within 24 hours.</p>
        </>}
      </section>
    </div>
  </main>;
}
