"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import {
  beginPeerDownload,
  getPeerTransfer,
  type PeerTransfer,
} from "@/lib/p2p-client";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ReceiveFile() {
  const [transfer, setTransfer] = useState<PeerTransfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(0);
  const [download, setDownload] = useState("");
  const fileUrl = useRef("");

  useEffect(() => {
    let mounted = true;
    const values = new URLSearchParams(window.location.hash.slice(1));
    const id = values.get("transfer");
    const secret = values.get("secret");
    if (!id || !secret) {
      queueMicrotask(() => {
        setError(
          "This download link is incomplete. Request a new link from your agent.",
        );
        setLoading(false);
      });
      return;
    }
    getPeerTransfer(id, secret)
      .then((value) => {
        if (mounted) setTransfer(value);
      })
      .catch((reason) => {
        if (mounted)
          setError(
            reason instanceof Error
              ? reason.message
              : "This download is unavailable.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    };
  }, []);

  async function receive() {
    if (!transfer || busy || attempted) return;
    setBusy(true);
    setAttempted(true);
    setError("");
    setReceived(0);
    try {
      const blob = await beginPeerDownload(transfer, (bytes) =>
        setReceived(bytes),
      );
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
      fileUrl.current = URL.createObjectURL(blob);
      setDownload(fileUrl.current);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The file could not be received. Ask the owner to keep their source online, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const percent = transfer?.size_bytes
    ? Math.min(100, Math.round((received / transfer.size_bytes) * 100))
    : 0;
  const filename = transfer
    ? `${transfer.title.replace(/\.pdf$/i, "")}.pdf`
    : "document.pdf";

  return (
    <main className="peer-download-page">
      <Link href="/" className="peer-brand">
        puente.
      </Link>
      <section className="peer-download-card">
        <span className="workspace-action-icon">
          <FileText size={25} />
        </span>
        <h1>{transfer?.title || "Receive a document"}</h1>
        <p>
          The original will transfer from the owner&apos;s connected source to
          this browser.
        </p>
        {loading && (
          <p role="status">
            <LoaderCircle size={18} className="spin" /> Checking download
            permissions…
          </p>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {transfer && (
          <>
            <dl className="peer-file-facts">
              <div>
                <dt>File size</dt>
                <dd>{fileSize(transfer.size_bytes)}</dd>
              </div>
              <div>
                <dt>Access valid until</dt>
                <dd>
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "Etc/GMT+6",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(transfer.expires_at))}{" "}
                  CST
                </dd>
              </div>
            </dl>
            {download ? (
              <>
                <p className="peer-verified" role="status">
                  <ShieldCheck size={19} /> Received and verified against the
                  owner&apos;s SHA-256.
                </p>
                <a
                  href={download}
                  download={filename}
                  className="button button-dark button-full"
                >
                  <ArrowDownToLine size={18} /> Save original PDF
                </a>
              </>
            ) : (
              <>
                <button
                  onClick={() => void receive()}
                  className="button button-dark button-full"
                  disabled={busy || attempted}
                >
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <ArrowDownToLine size={18} />
                  )}{" "}
                  {busy
                    ? "Receiving original…"
                    : attempted
                      ? "A new download link is needed"
                      : "Receive original PDF"}
                </button>
                {busy && (
                  <div className="peer-progress" role="status">
                    <progress value={received} max={transfer.size_bytes} />
                    <span>
                      {percent}% · {fileSize(received)} received
                    </span>
                  </div>
                )}
                {attempted && !busy && (
                  <p className="form-note">
                    You will request a new download link from your agent or
                    prepare another download in the workspace before trying
                    again.
                  </p>
                )}
                <p className="form-note">
                  The owner will keep their device and source connection online
                  during the transfer. If the source is unavailable, you will
                  need to retry when it reconnects.
                </p>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
