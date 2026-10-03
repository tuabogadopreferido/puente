import type { Metadata } from "next";
import Link from "next/link";
import { inspectInvitation } from "@/lib/invitations";
import InviteForm from "./invite-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Company invitation · Puente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let preview;
  let error = "";
  try {
    preview = await inspectInvitation(token || "");
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "This invitation is unavailable.";
  }
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f4ee",
        padding: "45px 20px",
        color: "#193c31",
        fontFamily: "Arial,sans-serif",
      }}
    >
      <div style={{ maxWidth: 590, margin: "auto" }}>
        <Link
          href="/"
          style={{
            color: "#14583f",
            fontWeight: 750,
            fontSize: 27,
            textDecoration: "none",
          }}
        >
          puente
        </Link>
        <section
          style={{
            marginTop: 24,
            background: "white",
            borderRadius: 18,
            border: "1px solid #e0e5dc",
            padding: "30px clamp(20px,5vw,35px)",
          }}
        >
          <p
            style={{
              letterSpacing: 2,
              fontSize: 11,
              textTransform: "uppercase",
              color: "#728070",
            }}
          >
            Company invitation
          </p>
          <h1 style={{ fontSize: 31, lineHeight: 1.18, margin: "12px 0 22px" }}>
            {preview
              ? `${preview.inviter_name} invited your company.`
              : "Invitation unavailable"}
          </h1>
          {error && <p role="alert">{error}</p>}
          {preview && token && (
            <>
              <dl
                style={{
                  background: "#f4f6f0",
                  borderRadius: 12,
                  padding: 20,
                  display: "grid",
                  gap: 8,
                  lineHeight: 1.6,
                }}
              >
                <dt style={{ color: "#718170", fontSize: 13 }}>
                  Invited company
                </dt>
                <dd style={{ margin: "0 0 10px" }}>{preview.company_name}</dd>
                <dt style={{ color: "#718170", fontSize: 13 }}>
                  Declared purpose
                </dt>
                <dd style={{ margin: "0 0 10px" }}>{preview.purpose_name}</dd>
                <dt style={{ color: "#718170", fontSize: 13 }}>
                  Reciprocal offer
                </dt>
                <dd style={{ margin: 0 }}>
                  {preview.offered_document_count} documents offered for
                  requests under the inviter&apos;s permissions.
                </dd>
              </dl>
              <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                You will sign in with the email address that received this
                invitation. If you create a new account, you will confirm that
                mailbox before accepting. Acceptance will create a bilateral
                bridge valid for 24 hours; document requests will still require
                their own permissions.
              </p>
              <InviteForm token={token} companyName={preview.company_name} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
