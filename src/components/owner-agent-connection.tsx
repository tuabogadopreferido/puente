"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";

type Connection = {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
};
type OwnerApi = <T>(path: string, init?: RequestInit) => Promise<T>;

function configuration(endpoint: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        puente_owner: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

function connectionDate(value: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "Etc/GMT+6",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))} CST (UTC-6)`;
}

export function OwnerAgentConnection({
  companyName,
  api,
  onUpload,
}: {
  companyName: string;
  api: OwnerApi;
  onUpload: () => void;
}) {
  const [label, setLabel] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [created, setCreated] = useState<{
    connection: Connection;
    token: string;
  } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [endpoint] = useState(
    () =>
      new URL(
        "/api/mcp",
        process.env.NEXT_PUBLIC_APP_URL ||
          (typeof window !== "undefined"
            ? window.location.origin
            : "https://puente-phi.vercel.app"),
      ).href,
  );
  const instructions = `You are the owner agent for ${companyName} in Puente.

1. Add the separately copied puente_owner MCP configuration to a client that supports Streamable HTTP with custom Authorization headers. Keep the private owner token in that client's secure configuration.
2. Use list_documents to inspect our company's own vault. Owner access can read originals, upload files, manage bridges and decide document requests. The server verifies the company and permissions for each action.
3. To upload an original PDF (maximum 20 MiB and 80 pages), call prepare_document_upload with {filename, size}, where size is the exact byte count.
4. Send the untouched PDF bytes to the returned upload_url using the returned HTTP method, content type and headers. This is a direct binary upload to private Storage; do not send a base64 JSON body or alter the file.
5. Call complete_document_upload with {uploadId}. Preserve the uploadId for retries so the same upload is completed. Read the returned document and notice; a notice requiring owner review does not mean AI classification succeeded.
6. To correct an owned document, call correct_document_classification with {document_id, document_type?, sensitive?, expires_at?}. Include at least one correction field and no unknown fields. Use a valid YYYY-MM-DD expiry or null to clear it. Financial types balance_sheet, income_statement and tax_return are always sensitive; onboarding types tax_status, tax_compliance, incorporation, power_of_attorney, bank_cover, proof_of_address, repse and representative_id are always non-sensitive. Only other lets you choose sensitive; omitted values are preserved except for this type-based normalization. The result contains id, title, document_type, sensitive, expires_at and classification_source: owner_reviewed. The original bytes and SHA-256 stay unchanged. This is owner review, not a new AI classification. The server rechecks active owner membership and revocation; bridge tokens cannot correct documents.
7. Use get_document for our own originals, create_bridge / issue_access_code / revoke_bridge to manage partner access, and list_requests / decide_request for owner decisions. A partner's documents remain subject to that partner's rules.
8. This owner credential has no expiration. It works until I revoke this specific connection in Connect my agent, or you call revoke_owner_access to revoke your own access. This disconnects only this company agent; existing bridges and counterparty download permissions remain unchanged. Never publish the token or place it in a URL.`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ connections: Connection[] }>(
        "/api/owner/agent-connections",
      );
      setConnections(result.connections);
      setCreated((current) =>
        current &&
        result.connections.some(
          (item) => item.id === current.connection.id && item.revoked_at,
        )
          ? null
          : current,
      );
    } catch {
      setError(
        "Agent access could not be loaded. Refresh the list to try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  async function createAccess(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy || loading) return;
    setBusy("create");
    setError("");
    setMessage("");
    try {
      const result = await api<{ connection: Connection; token: string }>(
        "/api/owner/agent-connections",
        {
          method: "POST",
          body: JSON.stringify({ label: label.trim() }),
        },
      );
      setCreated(result);
      setConnections((current) => [
        result.connection,
        ...current.filter((item) => item.id !== result.connection.id),
      ]);
      setLabel("");
      setMessage(
        "Agent access created. Copy its private configuration before closing this panel.",
      );
    } catch {
      setError(
        "Access creation could not be confirmed. Refresh the list before trying again; a connection may already have been created.",
      );
    } finally {
      setBusy("");
    }
  }
  async function copyConfiguration() {
    if (!created || busy || created.connection.revoked_at) return;
    setBusy("copy-config");
    setError("");
    try {
      await navigator.clipboard.writeText(
        configuration(endpoint, created.token),
      );
      setMessage(
        "Private MCP configuration copied. Paste it only into the agent client you trust with company administration.",
      );
    } catch {
      setError(
        "Clipboard access was unavailable. Allow clipboard access in your browser and try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function copyInstructions() {
    setBusy("copy-instructions");
    setError("");
    try {
      await navigator.clipboard.writeText(instructions);
      setMessage(
        "Agent instructions copied. They contain no access token; copy the MCP configuration separately.",
      );
    } catch {
      setError(
        "Clipboard access was unavailable. Allow clipboard access in your browser and try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function revoke() {
    if (!revokeTarget || busy) return;
    setBusy("revoke");
    setError("");
    setMessage("");
    try {
      await api(`/api/owner/agent-connections/${revokeTarget.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setConnections((current) =>
        current.map((item) =>
          item.id === revokeTarget.id
            ? { ...item, revoked_at: new Date().toISOString() }
            : item,
        ),
      );
      if (created?.connection.id === revokeTarget.id) setCreated(null);
      setMessage(`Access for ${revokeTarget.label} was revoked.`);
      setRevokeTarget(null);
    } catch {
      setError(
        "Revocation could not be confirmed. Refresh the list and check this connection's status.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="info-banner compact">
        <ShieldCheck size={22} />
        <p>
          This connection gives your agent owner access to{" "}
          <strong>{companyName}</strong>: read and upload documents, manage
          bridges, and decide requests. It has full company permissions.
        </p>
      </div>
      <p className="form-note">
        <strong>No expiration · Until you revoke it.</strong> Revoke this
        connection here, or let the connected agent call{" "}
        <code>revoke_owner_access</code>.
      </p>
      <div className="review-facts">
        <div>
          <span>COMPANY</span>
          <strong>{companyName}</strong>
        </div>
        <div>
          <span>MCP ENDPOINT</span>
          <strong>{endpoint}</strong>
        </div>
      </div>
      <p className="form-note">
        Use an MCP client that supports Streamable HTTP and custom Authorization
        headers.
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="info-banner compact" role="status">
          {message}
        </p>
      )}
      {created ? (
        <>
          <div className="review-facts">
            <div>
              <span>NEW AGENT ACCESS</span>
              <strong>{created.connection.label}</strong>
            </div>
            <div>
              <span>PRIVATE TOKEN</span>
              <strong aria-label="Private token hidden">
                ••••••••••••••••
              </strong>
            </div>
          </div>
          <p className="form-note">
            Copy the configuration before closing. This token is available to
            copy only now. Losing it requires creating new access and revoking
            the old connection.
          </p>
          <pre className="code-block" style={{ whiteSpace: "pre-wrap" }}>
            {configuration(endpoint, "<PRIVATE_OWNER_AGENT_TOKEN>")}
          </pre>
          <button
            className="button button-dark button-full"
            disabled={!!busy}
            onClick={() => void copyConfiguration()}
          >
            <Copy size={16} />
            Copy MCP configuration
          </button>
          <p className="form-note">
            The copied configuration contains the private token and grants the
            company permissions described above. Keep it out of public files,
            screenshots and shared messages.
          </p>
        </>
      ) : (
        <form onSubmit={createAccess}>
          <label>
            Agent name
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={120}
              placeholder="For example, Finance assistant"
              disabled={!!busy}
              autoComplete="off"
            />
          </label>
          <button
            className="button button-dark button-full"
            disabled={!label.trim() || !!busy || loading}
          >
            <KeyRound size={16} />
            {busy === "create"
              ? "Creating agent access…"
              : "Create agent access"}
          </button>
        </form>
      )}
      <ol className="form-note" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
        <li>
          Create a named connection and copy its private MCP configuration.
        </li>
        <li>
          Add the configuration to your agent client, then copy the instructions
          below into that agent.
        </li>
        <li>
          Ask it to list your company&apos;s vault or upload an original PDF.
          You can revoke its access here at any time.
        </li>
      </ol>
      <button
        className="button button-outline button-full"
        disabled={!!busy}
        onClick={() => void copyInstructions()}
      >
        <Copy size={16} />
        Copy agent instructions
      </button>
      <div className="panel-heading" style={{ marginTop: 20 }}>
        <div>
          <h3>Your agent connections</h3>
          <p>Only connections created by your account appear here.</p>
        </div>
        <button
          className="button button-outline button-small"
          disabled={loading || !!busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="form-note">
          <LoaderCircle className="spin" size={16} /> Loading connections…
        </p>
      ) : !connections.length ? (
        <p className="form-note">You have no agent connections yet.</p>
      ) : (
        connections.map((connection) => (
          <div className="review-facts" key={connection.id}>
            <div>
              <span>
                {connection.revoked_at ? "REVOKED" : "ACTIVE · NO EXPIRATION"}
              </span>
              <strong>{connection.label}</strong>
              <small>Created {connectionDate(connection.created_at)}</small>
            </div>
            {connection.revoked_at ? (
              <p className="form-note">
                Revoked {connectionDate(connection.revoked_at)}
              </p>
            ) : revokeTarget?.id === connection.id ? (
              <div
                role="group"
                aria-label={`Confirm revocation of ${connection.label}`}
              >
                <p className="form-note">
                  Revoke <strong>{connection.label}</strong> for{" "}
                  <strong>{companyName}</strong>? This agent will immediately
                  lose company access. This disconnects only this company agent.
                  Existing bridges and counterparty download permissions remain
                  unchanged.
                </p>
                <div className="decision-actions">
                  <button
                    className="button button-outline"
                    disabled={!!busy}
                    onClick={() => setRevokeTarget(null)}
                  >
                    Keep access
                  </button>
                  <button
                    className="button button-danger"
                    disabled={!!busy}
                    onClick={() => void revoke()}
                  >
                    {busy === "revoke" ? "Revoking…" : "Revoke access now"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button button-outline danger-text"
                disabled={!!busy}
                onClick={() => {
                  setRevokeTarget(connection);
                  setMessage("");
                }}
              >
                Revoke access
              </button>
            )}
          </div>
        ))
      )}
      <p className="form-note">
        You can also upload a PDF yourself. It goes into{" "}
        <strong>{companyName}</strong>&apos;s own vault.
      </p>
      <button
        className="button button-outline button-full"
        disabled={!!busy}
        onClick={onUpload}
      >
        <Upload size={16} />
        Upload document
      </button>
    </>
  );
}
