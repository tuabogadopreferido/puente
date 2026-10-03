"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  FileCheck2,
  FileText,
  Fingerprint,
  FolderClosed,
  GitBranch,
  Globe2,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldEllipsis,
  Sparkles,
  Terminal,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { normalizeSensitivity } from "@/lib/document-policy";

type Company = {
  id: string;
  name: string;
  legal_name?: string;
  tax_id?: string;
  rfc?: string;
  email?: string;
};
type Document = {
  id: string;
  company_id: string;
  title?: string;
  name?: string;
  filename?: string;
  original_filename?: string;
  document_type: string;
  is_sensitive?: boolean;
  sensitive?: boolean;
  expires_at?: string | null;
  sha256?: string;
  file_sha256?: string;
  classification_source?: string;
  classification_reason?: string;
  classification?: Record<string, unknown>;
  created_at?: string;
  byte_size?: number;
  file_size?: number;
};
type Purpose = {
  id: string;
  company_id?: string;
  name: string;
  label?: string;
  description?: string;
};
type Rule = {
  id: string;
  company_id?: string;
  owner_company_id?: string;
  counterparty_company_id?: string;
  counterparty_id?: string;
  purpose_id: string;
  document_types?: string[];
  document_type?: string;
  document_id?: string;
  enabled?: boolean;
  is_active?: boolean;
};
type Bridge = {
  id: string;
  company_a_id?: string;
  company_b_id?: string;
  owner_company_id?: string;
  counterparty_company_id?: string;
  status: string;
  expires_at?: string;
  revoked_at?: string | null;
  created_at?: string;
};
type RequestItem = {
  id: string;
  document_id: string;
  purpose_id: string;
  purpose_text?: string;
  requester_company_id?: string;
  actor_company_id?: string;
  owner_company_id?: string;
  status: string;
  reason?: string;
  escalation_reason?: string;
  created_at: string;
  manual_response?: string;
};
type EventItem = {
  id: string;
  event_type?: string;
  action?: string;
  type?: string;
  company_id?: string;
  actor_company_id?: string;
  document_id?: string;
  request_id?: string;
  bridge_id?: string;
  details?: Record<string, unknown>;
  created_at: string;
};
type Dashboard = {
  company: Company;
  companies: Company[];
  documents: Document[];
  purposes: Purpose[];
  rules: Rule[];
  bridges: Bridge[];
  requests: RequestItem[];
  events: EventItem[];
};
type View =
  "vault" | "bridges" | "policies" | "requests" | "activity" | "playground";
type Delivery = {
  download_url?: string;
  extracted_text?: string;
  receipt?: Record<string, unknown>;
  status?: string;
  request?: RequestItem;
  delivery?: Delivery;
  request_id?: string;
  message?: string;
  reason?: string;
  manual_response?: string;
};
type AgentDocumentResult = {
  id: string;
  document: Document;
  response?: Delivery;
  error?: string;
  requesting?: boolean;
};
const empty: Dashboard = {
  company: { id: "", name: "" },
  companies: [],
  documents: [],
  purposes: [],
  rules: [],
  bridges: [],
  requests: [],
  events: [],
};
const navigation = [
  { id: "vault", label: "Document vault", icon: FolderClosed },
  { id: "bridges", label: "Bridges", icon: GitBranch },
  { id: "policies", label: "Policies", icon: ShieldEllipsis },
  { id: "requests", label: "Requests", icon: Bell },
  { id: "activity", label: "Activity", icon: Activity },
] as const;
const docTypes: Record<string, string> = {
  tax_status: "Tax registration",
  tax_compliance: "Tax compliance",
  incorporation: "Articles of incorporation",
  power_of_attorney: "Power of attorney",
  bank_cover: "Bank account details",
  representative_id: "Representative ID",
  proof_of_address: "Proof of address",
  repse: "REPSE registration",
  balance_sheet: "Balance sheet",
  income_statement: "Income statement",
  tax_return: "Tax return",
  other: "Other document",
};
const nice = (value?: string) =>
  value
    ? docTypes[value] ||
      value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
    : "Document";
const docName = (doc?: Document) =>
  doc?.title ||
  doc?.name ||
  doc?.original_filename ||
  doc?.filename ||
  nice(doc?.document_type);
const sensitive = (doc: Document) => Boolean(doc.is_sensitive ?? doc.sensitive);
const needsReview = (doc: Document) =>
  ["awaiting_owner_review", "unclassified"].includes(
    doc.classification_source || "",
  );
const classificationLabel = (source: string) =>
  ["claude_ai_gateway", "claude_anthropic"].includes(source)
    ? "AI classified"
    : ["awaiting_owner_review", "unclassified"].includes(source)
      ? "Needs owner review"
      : /owner|demo_fixture/.test(source)
        ? "Owner reviewed"
        : nice(source);
const date = (value?: string | null) =>
  value
    ? new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-06:00` : value,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Etc/GMT+6",
      })
    : "No expiration";
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Etc/GMT+6",
      }) + " CST"
    : "";
const expired = (value?: string | null) =>
  !!value &&
  (/^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value < new Date().toLocaleDateString("en-CA", { timeZone: "Etc/GMT+6" })
    : new Date(value).getTime() <= Date.now());
const activeBridge = (bridge: Bridge) =>
  bridge.status !== "revoked" &&
  !bridge.revoked_at &&
  !expired(bridge.expires_at);
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path
          d="M5 28V16C5 9.925 9.925 5 16 5h4c6.075 0 11 4.925 11 11v12M12 28V17a6 6 0 0 1 12 0v11"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M2 28h32M12 21h12"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
      <span>
        puente<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function EmptyState({
  icon = <FolderClosed size={26} />,
  title,
  text,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab") {
        const focusable = closeRef.current
          ?.closest("[role=dialog]")
          ?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
          );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = previous;
      previousFocus?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function BridgeArt() {
  return (
    <div className="bridge-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="art-company">
        <Building2 size={26} />
        <span>YOUR COMPANY</span>
        <div className="tiny-docs">
          <FileText />
          <FileText />
          <FileText />
        </div>
      </div>
      <div className="art-connection">
        <span />
        <div>
          <LockKeyhole size={20} />
        </div>
        <span />
      </div>
      <div className="art-agent">
        <Sparkles size={25} />
        <span>ANY AGENT</span>
        <div className="agent-pulse">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="art-caption">
        <ShieldCheck size={14} /> Access with a declared purpose and a time
        limit.
      </div>
    </div>
  );
}

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(demo = false) {
    setBusy(true);
    setError("");
    try {
      const client = getSupabaseBrowser();
      if (!client)
        throw new Error(
          "The workspace is being configured. Please try again shortly.",
        );
      const result = await client.auth.signInWithPassword({
        email: demo ? "acme@puente.demo" : email,
        password: demo ? "PuenteDemo2026!" : password,
      });
      if (result.error) throw result.error;
      if (result.data.session) onSession(result.data.session);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <Logo />
          <span className="edition">BUILT FOR THE AGENT ERA</span>
        </div>
        <div className="login-story-main">
          <div className="eyebrow">
            <span className="small-line" /> COMPANY DOCUMENTS, CONNECTED
          </div>
          <h1>
            Corporate documents,
            <br />
            shared with
            <br />
            <em>purpose.</em>
          </h1>
          <p className="login-description">
            Give business partners the documents they need for an approved
            purpose, with a record of every exchange.
          </p>
          <BridgeArt />
          <div className="login-proof">
            <span>
              <CheckCircle2 size={16} /> Original PDFs
            </span>
            <span>
              <Fingerprint size={16} /> Verifiable receipts
            </span>
            <span>
              <Radio size={16} /> Live audit trail
            </span>
          </div>
        </div>
        <div className="login-footer">
          <span>A record of every authorized exchange.</span>
          <a href="/llms.txt">
            For agents <ArrowUpRight size={14} />
          </a>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-top-note">
          <LockKeyhole size={14} /> Secure workspace
        </div>
        <div className="login-form-wrap">
          <div className="login-icon">
            <GitBranch size={24} />
          </div>
          <div className="eyebrow">WELCOME TO PUENTE</div>
          <h2>
            A better way
            <br />
            to do business.
          </h2>
          <p>
            Sign in to manage your company&apos;s documents and permissions.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <label>
              Work email
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <button className="button button-dark button-full" disabled={busy}>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <>
                  Enter workspace
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <div className="form-divider">
            <span />
            EXPLORING PUENTE?
            <span />
          </div>
          <button
            className="button button-outline button-full"
            disabled={busy}
            onClick={() => void signIn(true)}
          >
            <Sparkles size={16} /> Try the live demo
            <ArrowUpRight size={15} />
          </button>
          <p className="demo-note">
            A real workspace with fictional Mexican companies.
            <br />
            No personal or client documents.
          </p>
        </div>
        <div className="login-stack">
          Made with <span className="supabase-mark">ϟ</span>
          <strong>Supabase</strong>
          <span className="stack-divider" />
          Built for Supabase Select 2026
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<View>("vault");
  const [data, setData] = useState<Dashboard>(empty);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [realtime, setRealtime] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [counterparty, setCounterparty] = useState("");
  const [codeResult, setCodeResult] = useState<{
    code: string;
    expires_at: string;
  } | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [decision, setDecision] = useState<RequestItem | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Bridge | null>(null);
  const [manualResponse, setManualResponse] = useState("");
  const [createRule, setCreateRule] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadPhase, setUploadPhase] = useState("");
  const [pendingUploadSession, setPendingUploadSession] = useState<{
    uploadId: string;
    token: string;
    path: string;
    uploaded: boolean;
  } | null>(null);
  const uploadInFlight = useRef(false);
  const uploadSelection = useRef(0);
  const [correctionType, setCorrectionType] = useState("");
  const [correctionSensitive, setCorrectionSensitive] = useState(false);
  const [correctionExpiry, setCorrectionExpiry] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCompany, setInviteCompany] = useState("");
  const [invitePurpose, setInvitePurpose] = useState("");
  const [inviteOffers, setInviteOffers] = useState<string[]>([]);
  const [invitation, setInvitation] = useState<{
    invite_url: string;
    expires_at: string;
    email?: { status: string; message?: string };
  } | null>(null);
  const api = useCallback(
    async <T,>(
      path: string,
      init?: RequestInit,
      token?: string,
    ): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (!(init?.body instanceof FormData))
        headers.set("Content-Type", "application/json");
      if (token || session?.access_token)
        headers.set(
          "Authorization",
          `Bearer ${token || session?.access_token}`,
        );
      const response = await fetch(path, { ...init, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message ||
                payload.message ||
                `Request failed (${response.status})`,
        );
      return payload as T;
    },
    [session?.access_token],
  );
  const refresh = useCallback(
    async (quiet = false) => {
      if (!session) return;
      if (!quiet) setLoading(true);
      try {
        const payload = await api<Dashboard>("/api/dashboard");
        setData({ ...empty, ...payload });
        setError("");
      } catch (err) {
        setError(errorText(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [api, session],
  );
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) {
      const timeout = window.setTimeout(() => setInitializing(false), 0);
      return () => window.clearTimeout(timeout);
    }
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, next) => setSession(next),
    );
    return () => subscription.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [session, refresh]);
  useEffect(() => {
    if (!session) return;
    const client = getSupabaseBrowser();
    if (!client) return;
    const channel = client
      .channel("puente-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "access_events" },
        () => void refresh(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "requests" },
        () => void refresh(true),
      )
      .subscribe((status) => setRealtime(status === "SUBSCRIBED"));
    const poll = window.setInterval(() => void refresh(true), 15000);
    return () => {
      void client.removeChannel(channel);
      window.clearInterval(poll);
      setRealtime(false);
    };
  }, [session, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  function navigate(next: View) {
    setView(next);
    setSearch("");
    setMobileNav(false);
  }
  const companyName = (id?: string) =>
    data.companies.find((company) => company.id === id)?.name ||
    (id === data.company.id
      ? data.company.name
      : !id
        ? "Any business partner"
        : "Business partner");
  const purposeName = (id?: string) =>
    data.purposes.find((purpose) => purpose.id === id)?.name ||
    "Declared business purpose";
  const pending = data.requests.filter(
    (request) =>
      ["pending", "pending_approval", "escalated"].includes(request.status) &&
      request.owner_company_id === data.company.id,
  );
  const active = data.bridges.filter(activeBridge);
  const visibleDocs = data.documents.filter(
    (doc) =>
      (filter === "all" ||
        (filter === "sensitive"
          ? sensitive(doc)
          : filter === "expired"
            ? expired(doc.expires_at)
            : !sensitive(doc) &&
              !expired(doc.expires_at) &&
              !needsReview(doc))) &&
      `${docName(doc)} ${nice(doc.document_type)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function mutate(
    id: string,
    action: () => Promise<unknown>,
    message: string,
  ) {
    setBusy(id);
    setError("");
    try {
      await action();
      setToast(message);
      await refresh(true);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy("");
    }
  }
  async function selectUploadFile(file: File | null) {
    const selection = ++uploadSelection.current;
    setSelectedFile(null);
    setPendingUploadSession(null);
    setUploadError("");
    setUploadPhase("");
    if (!file) return;
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type &&
        !["application/pdf", "application/octet-stream"].includes(file.type))
    ) {
      setUploadError("Choose a PDF file.");
      return;
    }
    if (!file.size || file.size > 20 * 1024 * 1024) {
      setUploadError(
        file.size
          ? "This PDF exceeds the 20 MB limit. Choose a smaller PDF."
          : "This file is empty. Choose a PDF with content.",
      );
      return;
    }
    setUploadPhase("Checking PDF…");
    try {
      const header = await file.slice(0, 5).text();
      if (selection !== uploadSelection.current) return;
      if (header !== "%PDF-")
        throw new Error(
          "This file is not a valid PDF. Choose the original PDF file.",
        );
      setSelectedFile(file);
    } catch (err) {
      if (selection === uploadSelection.current) setUploadError(errorText(err));
    } finally {
      if (selection === uploadSelection.current) setUploadPhase("");
    }
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setBusy("upload");
    setUploadError("");
    let current = pendingUploadSession;
    let completed = false;
    try {
      const client = getSupabaseBrowser();
      if (!client)
        throw new Error(
          "The workspace is being configured. Please try again shortly.",
        );
      if (!current) {
        setUploadPhase("Preparing upload…");
        const result = await api<{
          uploadId: string;
          token: string;
          path: string;
        }>("/api/documents/upload/init", {
          method: "POST",
          body: JSON.stringify({
            filename: selectedFile.name,
            size: selectedFile.size,
          }),
        });
        current = { ...result, uploaded: false };
        setPendingUploadSession(current);
      }
      if (!current.uploaded) {
        setUploadPhase("Uploading original…");
        const { error: storageError } = await client.storage
          .from("documents")
          .uploadToSignedUrl(current.path, current.token, selectedFile, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (storageError) {
          // The PUT may have reached Storage despite a lost response. Complete
          // checks this same session's object; never allocate another path here.
          setUploadPhase("Checking uploaded original…");
        } else {
          current = { ...current, uploaded: true };
          setPendingUploadSession(current);
          setUploadPhase("Classifying document…");
        }
      } else {
        setUploadPhase("Classifying document…");
      }
      const result = await api<{ document: Document; notice?: string }>(
        "/api/documents/upload/complete",
        {
          method: "POST",
          body: JSON.stringify({ uploadId: current.uploadId }),
        },
      );
      completed = true;
      // Clear the completed operation before refreshing so a failed dashboard
      // refresh cannot present it as a failed upload and create a duplicate.
      setPendingUploadSession(null);
      setSelectedFile(null);
      setUploadOpen(false);
      setData((previous) => ({
        ...previous,
        documents: [
          result.document,
          ...previous.documents.filter((doc) => doc.id !== result.document.id),
        ],
      }));
      setToast(
        result.notice ||
          "Document uploaded. Review its classification in the vault.",
      );
      setUploadPhase("Refreshing vault…");
      await refresh(true);
    } catch (err) {
      if (completed)
        setError(
          "The document was saved, but the vault could not refresh. Refresh the workspace to see it.",
        );
      else setUploadError(errorText(err));
    } finally {
      setBusy("");
      setUploadPhase("");
      uploadInFlight.current = false;
    }
  }
  async function sendInvitation(e: FormEvent) {
    e.preventDefault();
    await mutate(
      "invite",
      async () => {
        setInvitation(
          await api("/api/invitations", {
            method: "POST",
            body: JSON.stringify({
              email: inviteEmail,
              company_name: inviteCompany,
              purpose_id: invitePurpose,
              offered_document_ids: inviteOffers,
            }),
          }),
        );
      },
      "Invitation created. Review its delivery status below.",
    );
  }
  async function createBridge(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(
        "bridge",
        () =>
          api("/api/bridges", {
            method: "POST",
            body: JSON.stringify({
              counterparty_id: counterparty,
              expires_in_hours: 24,
            }),
          }),
        "Your bridge is ready. Generate an access code to connect an agent.",
      )
    ) {
      setBridgeOpen(false);
      setView("bridges");
    }
  }
  async function generateCode(bridge: Bridge) {
    const actor =
      bridge.company_a_id === data.company.id
        ? bridge.company_b_id
        : bridge.company_a_id || bridge.counterparty_company_id;
    await mutate(
      bridge.id,
      async () => {
        const result = await api<{ code: string; expires_at: string }>(
          `/api/bridges/${bridge.id}/code`,
          { method: "POST", body: JSON.stringify({ actor_company_id: actor }) },
        );
        setCodeResult(result);
      },
      "One-time access code created.",
    );
  }
  async function decide(action: string) {
    if (!decision) return;
    if (
      await mutate(
        "decision",
        () =>
          api(`/api/requests/${decision.id}/decision`, {
            method: "POST",
            body: JSON.stringify({
              action,
              create_rule: createRule,
              manual_response: manualResponse,
            }),
          }),
        action === "approve"
          ? "Request approved. The agent can now retrieve the document."
          : action === "deny"
            ? "Request denied."
            : "Your response was recorded.",
      )
    )
      setDecision(null);
  }
  async function saveCorrection() {
    if (!selectedDoc) return;
    if (
      await mutate(
        "correction",
        () =>
          api(`/api/documents/${selectedDoc.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              document_type: correctionType,
              sensitive: correctionSensitive,
              expires_at: correctionExpiry || null,
            }),
          }),
        "Document classification updated.",
      )
    )
      setSelectedDoc(null);
  }
  function openDocument(doc: Document) {
    setSelectedDoc(doc);
    setCorrectionType(doc.document_type);
    setCorrectionSensitive(
      normalizeSensitivity(doc.document_type, sensitive(doc)),
    );
    setCorrectionExpiry(doc.expires_at?.slice(0, 10) || "");
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard.");
    } catch {
      setError(
        "Clipboard access was unavailable. You can select and copy the text.",
      );
    }
  }
  if (initializing)
    return (
      <div className="app-loading">
        <Logo />
        <LoaderCircle className="spin" size={23} />
        <p>Opening your workspace</p>
      </div>
    );
  if (!session) return <Login onSession={setSession} />;
  const currentLabel =
    view === "playground"
      ? "Agent playground"
      : navigation.find((item) => item.id === view)?.label;
  return (
    <div className="app-shell">
      <button
        className={`nav-scrim ${mobileNav ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={() => setMobileNav(false)}
      />
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="sidebar-logo">
          <Logo />
        </div>
        <button
          className="workspace-switch"
          onClick={() =>
            setToast(
              "You are viewing the company linked to your authenticated account.",
            )
          }
        >
          <span className="company-avatar">
            {data.company.name?.slice(0, 1) || "A"}
          </span>
          <span>
            <strong>
              {data.company.name?.replace(/ S\.A\..*/, "") || "Your workspace"}
            </strong>
            <small>Company workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "requests" && pending.length > 0 && (
                <b className="nav-count">{pending.length}</b>
              )}
              {view === id && <span className="nav-active-mark" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-developer">
          <span className="nav-caption">DEVELOPER</span>
          <button
            className={`nav-item ${view === "playground" ? "active" : ""}`}
            onClick={() => navigate("playground")}
          >
            <Terminal size={18} />
            <span>Agent playground</span>
            <ArrowUpRight size={14} />
          </button>
          <a
            className="nav-item"
            href="/llms.txt"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={18} />
            <span>Documentation</span>
            <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={22} />
            <strong>Private by default.</strong>
            <p>Your files are shared only through an authorized bridge.</p>
            <span>
              <i /> ORIGINALS PRESERVED
            </span>
          </div>
          <div className="profile">
            <div className="profile-avatar">
              {session.user.email?.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>Workspace owner</strong>
              <span>{session.user.email}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                void getSupabaseBrowser()
                  ?.auth.signOut()
                  .then(() => {
                    setSession(null);
                    setData(empty);
                  })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{currentLabel}</strong>
          </div>
          <div className="topbar-right">
            <span className={`live-state ${realtime ? "connected" : ""}`}>
              <i />
              {realtime ? "Live updates on" : "Syncing workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <button
              className="notification-button"
              aria-label={`${pending.length} pending requests`}
              onClick={() => navigate("requests")}
            >
              <Bell size={18} />
              {pending.length > 0 && <i />}
            </button>
            <div className="top-avatar">
              {data.company.name?.slice(0, 1) || "A"}
            </div>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <XCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "vault" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR COMPANY, CONNECTED</div>
                  <h1>
                    Document vault<span className="title-dot">.</span>
                  </h1>
                  <p>
                    Your originals stay private. You decide how they are shared.
                  </p>
                </div>
                <button
                  className="button button-dark"
                  onClick={() => setUploadOpen(true)}
                >
                  <Plus size={17} />
                  Upload document
                </button>
              </div>
              <div className="overview-row">
                <section className="welcome-card">
                  <div>
                    <Badge tone="glass">
                      <LockKeyhole size={12} /> BUILT ON TRUST
                    </Badge>
                    <h2>
                      Business moves faster
                      <br />
                      when permissions are clear.
                    </h2>
                    <p>
                      Connect a partner with a defined purpose,
                      <br />
                      so their agent can handle the paperwork.
                    </p>
                    <button
                      onClick={() => {
                        setCounterparty(
                          data.companies.find((c) => c.id !== data.company.id)
                            ?.id || "",
                        );
                        setBridgeOpen(true);
                      }}
                    >
                      Create a bridge <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="mini-bridge">
                    <div className="mini-node">
                      <Building2 size={27} />
                      <span>You</span>
                    </div>
                    <div className="mini-link">
                      <span />
                      <div>
                        <Check size={17} />
                      </div>
                      <span />
                    </div>
                    <div className="mini-node partner">
                      <Sparkles size={27} />
                      <span>Your partner</span>
                    </div>
                    <div className="mini-label">PERMISSION TO CONNECT</div>
                  </div>
                </section>
                <section className="stat-stack">
                  <div className="stat-card">
                    <div className="stat-icon">
                      <FolderClosed size={20} />
                    </div>
                    <div>
                      <span>Documents secured</span>
                      <strong>
                        {data.documents.length.toString().padStart(2, "0")}
                      </strong>
                    </div>
                    <span className="stat-foot">Private vault</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon teal">
                      <GitBranch size={20} />
                    </div>
                    <div>
                      <span>Active bridges</span>
                      <strong>
                        {active.length.toString().padStart(2, "0")}
                      </strong>
                    </div>
                    <button
                      className="stat-link"
                      onClick={() => navigate("bridges")}
                      aria-label="View bridges"
                    >
                      <ArrowUpRight size={21} />
                    </button>
                  </div>
                </section>
              </div>
              <div className="content-columns">
                <section className="panel documents-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Your documents{" "}
                        <span className="count-pill">
                          {data.documents.length}
                        </span>
                      </h2>
                      <p>
                        Original files. Organized and ready for authorized
                        agents.
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Upload a document"
                      onClick={() => setUploadOpen(true)}
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  <div className="table-controls">
                    <div className="tabs" aria-label="Filter documents">
                      {[
                        ["all", "All documents"],
                        ["ready", "Standard"],
                        ["sensitive", "Sensitive"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={filter === id ? "selected" : ""}
                          onClick={() => setFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="Search documents"
                        placeholder="Search files"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>DOCUMENT NAME</th>
                          <th>ACCESS</th>
                          <th>VALID UNTIL</th>
                          <th aria-label="Document details" />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDocs.map((doc) => (
                          <tr key={doc.id} onClick={() => openDocument(doc)}>
                            <td>
                              <div className="document-cell">
                                <div
                                  className={`document-icon ${sensitive(doc) ? "sensitive-icon" : ""}`}
                                >
                                  <FileText size={20} />
                                  <span>PDF</span>
                                </div>
                                <div>
                                  <button
                                    className="document-name"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDocument(doc);
                                    }}
                                  >
                                    {docName(doc)}
                                  </button>
                                  <span className="document-subtitle">
                                    {nice(doc.document_type)}
                                    {doc.classification_source && (
                                      <>
                                        <span className="mid-dot">·</span>
                                        {classificationLabel(
                                          doc.classification_source,
                                        )}
                                      </>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>
                              {needsReview(doc) ? (
                                <Badge tone="amber">Needs review</Badge>
                              ) : sensitive(doc) ? (
                                <Badge tone="amber">
                                  <LockKeyhole size={11} /> Sensitive
                                </Badge>
                              ) : expired(doc.expires_at) ? (
                                <Badge tone="red">Expired</Badge>
                              ) : (
                                <Badge tone="green">
                                  <Check size={11} /> Standard
                                </Badge>
                              )}
                            </td>
                            <td className="date-cell">
                              {date(doc.expires_at)}
                            </td>
                            <td>
                              <ChevronRight size={15} className="muted" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visibleDocs.length === 0 && (
                      <EmptyState
                        title={
                          loading
                            ? "Loading your vault"
                            : search
                              ? "No matching documents"
                              : "Your vault is ready"
                        }
                        text={
                          search
                            ? "Try another name or document type."
                            : "Upload a PDF to classify and securely share it with a business partner."
                        }
                      />
                    )}
                  </div>
                  <div className="table-footer">
                    <ShieldCheck size={14} />
                    <span>
                      Your original PDFs remain intact. Every delivery includes
                      a SHA-256 receipt.
                    </span>
                  </div>
                </section>
                <aside className="right-column">
                  <section className="panel activity-preview">
                    <div className="panel-heading">
                      <h2>Recent activity</h2>
                      <span
                        className={`live-dot ${realtime ? "is-live" : ""}`}
                      />
                    </div>
                    {data.events.length ? (
                      <div className="timeline">
                        {data.events.slice(0, 4).map((event) => (
                          <button
                            key={event.id}
                            className="timeline-event"
                            onClick={() => setSelectedEvent(event)}
                          >
                            <div className="timeline-icon">
                              <Activity size={14} />
                            </div>
                            <div>
                              <strong>
                                {nice(
                                  event.event_type ||
                                    event.action ||
                                    event.type,
                                )}
                              </strong>
                              <p>
                                {event.document_id
                                  ? docName(
                                      data.documents.find(
                                        (d) => d.id === event.document_id,
                                      ),
                                    )
                                  : event.actor_company_id
                                    ? companyName(event.actor_company_id)
                                    : "Workspace update"}
                              </p>
                              <time>{time(event.created_at)}</time>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="quiet-activity">
                        <Activity size={25} />
                        <h3>A clear record, from day one.</h3>
                        <p>
                          Document requests, decisions and deliveries will
                          appear here.
                        </p>
                      </div>
                    )}
                    <button
                      className="panel-link"
                      onClick={() => navigate("activity")}
                    >
                      View all activity
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  <section className="exception-card">
                    <div className="exception-icon">
                      <ShieldEllipsis size={20} />
                    </div>
                    <h3>
                      {pending.length
                        ? `${pending.length} request${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} your review`
                        : "You handle the exceptions."}
                    </h3>
                    <p>
                      {pending.length
                        ? "A partner needs your permission. Review the document and declared purpose."
                        : "Policies handle routine requests. Sensitive documents always come to you."}
                    </p>
                    <button onClick={() => navigate("requests")}>
                      {pending.length ? "Review requests" : "Explore requests"}
                      <ArrowRight size={15} />
                    </button>
                  </section>
                </aside>
              </div>
              <div className="agent-strip">
                <div className="agent-strip-icon">
                  <Terminal size={24} />
                </div>
                <div>
                  <h3>Ready for your agent.</h3>
                  <p>
                    One secure connection. MCP, REST, or any model you work
                    with.
                  </p>
                </div>
                <button
                  className="button button-outline"
                  onClick={() => navigate("playground")}
                >
                  Open playground
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </>
          )}
          {view === "bridges" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PURPOSE-BOUND CONNECTIONS</div>
                  <h1>
                    Your bridges<span className="title-dot">.</span>
                  </h1>
                  <p>
                    A two-way permission between your company and a business
                    partner.
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setInviteOpen(true);
                      setInviteOffers([]);
                      setInvitation(null);
                      setInvitePurpose(data.purposes[0]?.id || "");
                    }}
                  >
                    Invite company
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    className="button button-dark"
                    onClick={() => {
                      setCounterparty(
                        data.companies.find((c) => c.id !== data.company.id)
                          ?.id || "",
                      );
                      setBridgeOpen(true);
                    }}
                  >
                    <Plus size={17} />
                    Create a bridge
                  </button>
                </div>
              </div>
              <div className="info-banner">
                <ShieldCheck size={19} />
                <p>
                  One-time codes connect an agent for up to 24 hours. Revoking a
                  bridge stops future access immediately.
                </p>
              </div>
              <div className="bridges-grid">
                {data.bridges.map((bridge) => {
                  const other =
                    bridge.company_a_id === data.company.id
                      ? bridge.company_b_id
                      : bridge.company_a_id || bridge.counterparty_company_id;
                  const isActive = activeBridge(bridge);
                  return (
                    <section className="panel bridge-card" key={bridge.id}>
                      <div className="bridge-card-top">
                        <span className="bridge-company-icon">
                          <Building2 size={24} />
                        </span>
                        <Badge tone={isActive ? "green" : "neutral"}>
                          <span className="badge-dot" />
                          {isActive
                            ? "Active"
                            : bridge.revoked_at || bridge.status === "revoked"
                              ? "Revoked"
                              : "Expired"}
                        </Badge>
                      </div>
                      <h2>{companyName(other)}</h2>
                      <p className="bridge-relation">
                        {data.company.name}
                        <Link2 size={14} />
                        {companyName(other)}
                      </p>
                      <div className="bridge-meta">
                        <div>
                          <Clock3 size={15} />
                          <span>
                            Expires {date(bridge.expires_at)}
                            <small>{time(bridge.expires_at)}</small>
                          </span>
                        </div>
                        <div>
                          <CheckCheck size={15} />
                          <span>
                            Two-way document exchange
                            <small>Both companies can request and offer</small>
                          </span>
                        </div>
                      </div>
                      <div className="bridge-actions">
                        <button
                          className="button button-dark"
                          disabled={!isActive || busy === bridge.id}
                          onClick={() => void generateCode(bridge)}
                        >
                          <KeyRound size={15} />
                          Access code
                        </button>
                        <button
                          className="button button-outline danger-text"
                          disabled={!isActive || !!busy}
                          onClick={() => setRevokeTarget(bridge)}
                        >
                          Revoke
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>
              {!data.bridges.length && (
                <section className="panel">
                  <EmptyState
                    icon={<GitBranch size={28} />}
                    title="Your next business connection starts here"
                    text="Create a bridge to a registered company. Its agent will request documents using the purpose and permissions you approve."
                  />
                </section>
              )}
            </>
          )}
          {view === "policies" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    HUMAN DECISIONS, AGENT EXECUTION
                  </div>
                  <h1>
                    Permission policies<span className="title-dot">.</span>
                  </h1>
                  <p>
                    Routine access follows your rules. Exceptions come back to
                    you.
                  </p>
                </div>
                <Badge tone="green">
                  <ShieldCheck size={13} /> Owner controlled
                </Badge>
              </div>
              <div className="policy-summary">
                <div>
                  <ShieldCheck size={23} />
                  <h3>Approved by purpose</h3>
                  <p>
                    A rule matches the document, business partner and declared
                    purpose.
                  </p>
                </div>
                <div>
                  <LockKeyhole size={23} />
                  <h3>Sensitive means review</h3>
                  <p>
                    Financial statements and tax returns with figures always
                    require a human decision.
                  </p>
                </div>
                <div>
                  <Clock3 size={23} />
                  <h3>Validity matters</h3>
                  <p>
                    An expired document without a current version is escalated
                    for review.
                  </p>
                </div>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Preapproved rules{" "}
                      <span className="count-pill">{data.rules.length}</span>
                    </h2>
                    <p>
                      Approve a request and save a rule to authorize the same
                      exchange next time.
                    </p>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>DOCUMENT SCOPE</th>
                        <th>BUSINESS PARTNER</th>
                        <th>APPROVED PURPOSE</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rules.map((rule) => (
                        <tr key={rule.id}>
                          <td>
                            <div className="rule-doc">
                              <ShieldCheck size={18} />
                              <strong>
                                {rule.document_types?.map(nice).join(", ") ||
                                  (rule.document_type
                                    ? nice(rule.document_type)
                                    : docName(
                                        data.documents.find(
                                          (doc) => doc.id === rule.document_id,
                                        ),
                                      ))}
                              </strong>
                            </div>
                          </td>
                          <td>
                            {companyName(
                              rule.counterparty_company_id ||
                                rule.counterparty_id,
                            )}
                          </td>
                          <td>{purposeName(rule.purpose_id)}</td>
                          <td>
                            <Badge
                              tone={
                                rule.enabled === false ||
                                rule.is_active === false
                                  ? "neutral"
                                  : "green"
                              }
                            >
                              {rule.enabled === false ||
                              rule.is_active === false
                                ? "Inactive"
                                : "Preapproved"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.rules.length && (
                    <EmptyState
                      icon={<ShieldEllipsis size={28} />}
                      title="Every request starts with your permission"
                      text="When you approve a standard document request, you can save that decision as a policy for future requests."
                    />
                  )}
                </div>
              </section>
              <section className="panel purposes-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Declared purposes</h2>
                    <p>
                      A closed list from your company&apos;s privacy notice.
                    </p>
                  </div>
                  <Globe2 size={22} />
                </div>
                {data.purposes
                  .filter(
                    (p) => !p.company_id || p.company_id === data.company.id,
                  )
                  .map((purpose, index) => (
                    <div className="purpose-row" key={purpose.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{purpose.name}</strong>
                        {purpose.description && <p>{purpose.description}</p>}
                      </div>
                      <CheckCircle2 size={17} />
                    </div>
                  ))}
              </section>
            </>
          )}
          {view === "requests" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR JUDGMENT, WHEN IT MATTERS</div>
                  <h1>
                    Access requests<span className="title-dot">.</span>
                  </h1>
                  <p>
                    Review exceptions with the document, recipient and purpose
                    in context.
                  </p>
                </div>
                <Badge tone={pending.length ? "amber" : "green"}>
                  {pending.length} awaiting review
                </Badge>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Requests{" "}
                    <span className="count-pill">{data.requests.length}</span>
                  </h2>
                  <span className="small-muted">
                    Sensitive documents always require approval
                  </span>
                </div>
                <div className="request-list">
                  {[...data.requests]
                    .sort(
                      (a, b) =>
                        Number(
                          ["pending", "escalated", "pending_approval"].includes(
                            b.status,
                          ),
                        ) -
                        Number(
                          ["pending", "escalated", "pending_approval"].includes(
                            a.status,
                          ),
                        ),
                    )
                    .map((request) => (
                      <div className="request-row" key={request.id}>
                        <div className="request-icon">
                          <FileCheck2 size={23} />
                        </div>
                        <div className="request-info">
                          <h3>
                            {docName(
                              data.documents.find(
                                (doc) => doc.id === request.document_id,
                              ),
                            )}
                          </h3>
                          <p>
                            <strong>
                              {companyName(
                                request.requester_company_id ||
                                  request.actor_company_id,
                              )}
                            </strong>
                            <span className="mid-dot">·</span>
                            {request.purpose_text ||
                              purposeName(request.purpose_id)}
                          </p>
                          <span>
                            {request.escalation_reason ||
                              request.reason ||
                              "Permission evaluated against company policy"}
                          </span>
                        </div>
                        <div className="request-status">
                          <Badge
                            tone={
                              [
                                "pending",
                                "pending_approval",
                                "escalated",
                              ].includes(request.status)
                                ? "amber"
                                : ["approved", "delivered"].includes(
                                      request.status,
                                    )
                                  ? "green"
                                  : "neutral"
                            }
                          >
                            {nice(request.status)}
                          </Badge>
                          <small>{date(request.created_at)}</small>
                        </div>
                        <button
                          className="button button-outline"
                          onClick={() => {
                            setDecision(request);
                            setManualResponse("");
                            setCreateRule(false);
                          }}
                        >
                          {[
                            "pending",
                            "pending_approval",
                            "escalated",
                          ].includes(request.status)
                            ? "Review request"
                            : "View details"}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    ))}
                </div>
                {!data.requests.length && (
                  <EmptyState
                    icon={<CheckCheck size={30} />}
                    title="Nothing needs your attention"
                    text="When an agent requests a sensitive document or an exception to your policy, you will be able to review it here."
                  />
                )}
              </section>
            </>
          )}
          {view === "activity" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">EVERY EXCHANGE, ACCOUNTED FOR</div>
                  <h1>
                    Activity log<span className="title-dot">.</span>
                  </h1>
                  <p>
                    A traceable record of requests, approvals, deliveries and
                    revocations.
                  </p>
                </div>
                <span className={`live-state ${realtime ? "connected" : ""}`}>
                  <i />
                  {realtime
                    ? "Live from Supabase"
                    : "Refreshing every 15 seconds"}
                </span>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Workspace events{" "}
                    <span className="count-pill">{data.events.length}</span>
                  </h2>
                  <button
                    className="button button-outline button-small"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>
                </div>
                <div className="event-list">
                  {data.events.map((event) => (
                    <button
                      key={event.id}
                      className="event-row"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div
                        className={`event-icon ${/revok|denied/.test(event.event_type || event.action || "") ? "event-warn" : ""}`}
                      >
                        <Activity size={18} />
                      </div>
                      <div className="event-info">
                        <strong>
                          {nice(event.event_type || event.action || event.type)}
                        </strong>
                        <p>
                          {event.document_id
                            ? docName(
                                data.documents.find(
                                  (d) => d.id === event.document_id,
                                ),
                              )
                            : event.actor_company_id
                              ? companyName(event.actor_company_id)
                              : "Workspace event"}
                          <span className="mid-dot">·</span>
                          <span className="event-id">
                            {event.id.slice(0, 8)}
                          </span>
                        </p>
                      </div>
                      <div className="event-time">
                        <span>{time(event.created_at)}</span>
                        <small>{date(event.created_at)}</small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                {!data.events.length && (
                  <EmptyState
                    icon={<Activity size={28} />}
                    title="Your audit trail starts with the first action"
                    text="Create a bridge, request a document or make a decision. Events will appear as they happen."
                  />
                )}
              </section>
            </>
          )}
          <div hidden={view !== "playground"}>
            <AgentPlayground
              api={api}
              data={data}
              onRefresh={() => void refresh(true)}
              onToast={setToast}
            />
          </div>
          <footer className="workspace-footer">
            <span>
              <Logo small />
              Purpose-bound document exchange.
            </span>
            <span>
              Built with Supabase<span className="mid-dot">·</span>Select 2026
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {uploadOpen && (
        <Modal
          title="Add to your document vault"
          subtitle="The original PDF will be preserved. Classification is based on its content."
          onClose={() => {
            if (!uploadInFlight.current) setUploadOpen(false);
          }}
        >
          <form onSubmit={upload}>
            <label className={`upload-zone ${selectedFile ? "has-file" : ""}`}>
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy === "upload"}
                aria-describedby="upload-status upload-error"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  e.target.value = "";
                  void selectUploadFile(file);
                }}
              />
              <div>
                <Upload size={28} />
              </div>
              <strong>
                {selectedFile ? selectedFile.name : "Choose a PDF to upload"}
              </strong>
              <span id="upload-status" role="status" aria-live="polite">
                {uploadPhase ||
                  (selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · ${pendingUploadSession?.uploaded ? "Original uploaded; ready to finish" : "Ready to upload"}`
                    : "PDF files up to 20 MB · Original content stays intact")}
              </span>
            </label>
            {uploadError && (
              <div className="inline-error" id="upload-error" role="alert">
                {uploadError}
              </div>
            )}
            <p className="form-note">
              Maximum file size: 20 MB (20,971,520 bytes). Keep this page open
              until the upload finishes.
            </p>
            <div className="info-banner compact">
              <Sparkles size={18} />
              <p>
                The document type, sensitivity and expiration will be
                identified. You can review and correct the result.
              </p>
            </div>
            <button
              className="button button-dark button-full"
              disabled={!selectedFile || busy === "upload"}
            >
              {busy === "upload" ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  {uploadPhase || "Preparing upload…"}
                </>
              ) : (
                <>
                  <Upload size={16} />
                  {pendingUploadSession?.uploaded
                    ? "Retry classification"
                    : pendingUploadSession
                      ? "Retry upload"
                      : "Upload document"}
                </>
              )}
            </button>
          </form>
        </Modal>
      )}
      {bridgeOpen && (
        <Modal
          title="Connect a business partner"
          subtitle="Create a two-way bridge with a registered company."
          onClose={() => setBridgeOpen(false)}
        >
          <form onSubmit={createBridge}>
            <label>
              Business partner
              <select
                required
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
              >
                <option value="">Select a company</option>
                {data.companies
                  .filter((company) => company.id !== data.company.id)
                  .map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="bridge-explainer">
              <div>
                <Clock3 size={20} />
                <strong>24-hour validity</strong>
                <p>You can revoke access at any time.</p>
              </div>
              <div>
                <CheckCheck size={20} />
                <strong>Both directions</strong>
                <p>Your partner can request and offer documents.</p>
              </div>
            </div>
            <p className="form-note">
              A bridge permits requests. Your policies still determine which
              documents can be delivered.
            </p>
            <button
              className="button button-dark button-full"
              disabled={!counterparty || busy === "bridge"}
            >
              {busy === "bridge" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <>
                  <GitBranch size={17} />
                  Create bridge
                </>
              )}
            </button>
          </form>
        </Modal>
      )}
      {inviteOpen && (
        <Modal
          title={
            invitation
              ? "Your invitation is ready"
              : "Invite a company to Puente"
          }
          subtitle={
            invitation
              ? "Access will begin only after the recipient signs in and accepts."
              : "Start a reciprocal exchange with a company that is not on Puente yet."
          }
          onClose={() => setInviteOpen(false)}
        >
          {invitation ? (
            <>
              <div className="info-banner compact">
                <CheckCircle2 size={18} />
                <p>
                  {invitation.email?.message ||
                    (invitation.email?.status === "sent"
                      ? "The invitation email was sent."
                      : "Use the invitation link below to connect your partner.")}
                </p>
              </div>
              <div className="hash-box">
                <span>INVITATION LINK</span>
                <code>{invitation.invite_url}</code>
              </div>
              <button
                className="button button-outline button-full"
                onClick={() => void copy(invitation.invite_url)}
              >
                <Copy size={14} />
                Copy invitation link
              </button>
              <p className="form-note invitation-expiry">
                Expires {date(invitation.expires_at)} at{" "}
                {time(invitation.expires_at)}. The recipient must verify the
                invited email address.
              </p>
            </>
          ) : (
            <form onSubmit={sendInvitation}>
              <label>
                Company name
                <input
                  required
                  value={inviteCompany}
                  onChange={(e) => setInviteCompany(e.target.value)}
                  placeholder="Your partner’s legal company name"
                />
              </label>
              <label>
                Recipient email
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="contact@partner.com"
                />
              </label>
              <label>
                Purpose of the exchange
                <select
                  required
                  value={invitePurpose}
                  onChange={(e) => setInvitePurpose(e.target.value)}
                >
                  <option value="">Select a purpose</option>
                  {data.purposes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="offer-title">
                <CheckCheck size={16} />
                <strong>Documents you will offer</strong>
                <span>Optional</span>
              </div>
              <div className="offer-list">
                {data.documents.map((doc) => (
                  <label className="checkbox-label" key={doc.id}>
                    <input
                      type="checkbox"
                      checked={inviteOffers.includes(doc.id)}
                      onChange={(e) =>
                        setInviteOffers((ids) =>
                          e.target.checked
                            ? [...ids, doc.id]
                            : ids.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    <span>{docName(doc)}</span>
                  </label>
                ))}
              </div>
              <p className="form-note">
                Offering a document is optional. The invitation shares no PDF.
                The recipient will verify their email and accept the exchange
                before a bridge is created.
              </p>
              <button
                className="button button-dark button-full"
                disabled={!invitePurpose || !!busy}
              >
                {busy === "invite" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <>
                    Create invitation
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}
        </Modal>
      )}
      {codeResult && (
        <Modal
          title="Your agent's connection starts here"
          subtitle="This code can be exchanged exactly once for a temporary access token."
          onClose={() => setCodeResult(null)}
        >
          <div className="access-code">
            <span>ONE-TIME ACCESS CODE</span>
            <code>{codeResult.code}</code>
            <button
              className="button button-outline"
              onClick={() => void copy(codeResult.code)}
            >
              <Copy size={14} />
              Copy code
            </button>
          </div>
          <p className="form-note">
            <Clock3 size={14} />
            Expires {date(codeResult.expires_at)} at{" "}
            {time(codeResult.expires_at)}. Keep this code with the intended
            recipient.
          </p>
          <div className="code-block">
            <code>
              POST /api/access/exchange
              <br />
              {JSON.stringify({ code: codeResult.code })}
            </code>
          </div>
          <button
            className="button button-dark button-full"
            onClick={() => {
              setCodeResult(null);
              navigate("playground");
            }}
          >
            Open agent playground
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {selectedDoc && (
        <Modal
          title={docName(selectedDoc)}
          subtitle="Document classification and integrity"
          onClose={() => setSelectedDoc(null)}
        >
          <div className="document-detail-top">
            <div className="document-icon">
              <FileText size={25} />
              <span>PDF</span>
            </div>
            <div>
              <strong>Original PDF preserved</strong>
              <p>Available to authorized agents through a bridge.</p>
            </div>
            <ShieldCheck size={23} />
          </div>
          <label>
            Document type
            <select
              value={correctionType}
              onChange={(e) => {
                const documentType = e.target.value;
                setCorrectionType(documentType);
                setCorrectionSensitive(
                  normalizeSensitivity(documentType, correctionSensitive),
                );
              }}
            >
              {Object.entries(docTypes).map(([key, name]) => (
                <option value={key} key={key}>
                  {name}
                </option>
              ))}
              {!docTypes[correctionType] && (
                <option value={correctionType}>{nice(correctionType)}</option>
              )}
            </select>
          </label>
          <label>
            Valid until
            <input
              type="date"
              value={correctionExpiry}
              onChange={(e) => setCorrectionExpiry(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={correctionSensitive}
              disabled={correctionType !== "other"}
              onChange={(e) => setCorrectionSensitive(e.target.checked)}
            />
            <span>
              <strong>Sensitive financial document</strong>
              <small>
                {correctionType === "other"
                  ? "You can require approval for every request."
                  : correctionSensitive
                    ? "Financial documents require approval for every request."
                    : "Onboarding documents follow your permission policies."}
              </small>
            </span>
          </label>
          {selectedDoc.classification_reason && (
            <p className="form-note">
              Classification: {selectedDoc.classification_reason}
            </p>
          )}
          <div className="hash-box">
            <span>
              <Fingerprint size={15} />
              SHA-256 FINGERPRINT
            </span>
            <code>
              {selectedDoc.sha256 ||
                selectedDoc.file_sha256 ||
                "Fingerprint will be included with the delivery receipt."}
            </code>
          </div>
          <button
            className="button button-outline button-full owner-download"
            disabled={!!busy}
            onClick={() =>
              void mutate(
                "owner-download",
                async () => {
                  const delivery = await api<Delivery>(
                    `/api/owner/documents/${selectedDoc.id}/download`,
                    { method: "POST" },
                  );
                  if (delivery.download_url)
                    window.location.assign(delivery.download_url);
                },
                "Original PDF is ready. A delivery receipt was recorded.",
              )
            }
          >
            <ArrowDownToLine size={16} />
            Download original PDF
          </button>
          <button
            className="button button-dark button-full"
            disabled={!!busy}
            onClick={() => void saveCorrection()}
          >
            {busy === "correction" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <>
                <Check size={16} />
                Save classification
              </>
            )}
          </button>
        </Modal>
      )}
      {decision && (
        <Modal
          title="Review document request"
          subtitle="Your decision applies to this document and declared purpose."
          onClose={() => setDecision(null)}
        >
          <div className="review-facts">
            <div>
              <span>DOCUMENT</span>
              <strong>
                {docName(
                  data.documents.find((doc) => doc.id === decision.document_id),
                )}
              </strong>
            </div>
            <div>
              <span>REQUESTING COMPANY</span>
              <strong>
                {companyName(
                  decision.requester_company_id || decision.actor_company_id,
                )}
              </strong>
            </div>
            <div>
              <span>DECLARED PURPOSE</span>
              <strong>
                {decision.purpose_text || purposeName(decision.purpose_id)}
              </strong>
            </div>
            <div>
              <span>REASON FOR REVIEW</span>
              <strong>
                {decision.escalation_reason ||
                  decision.reason ||
                  nice(decision.status)}
              </strong>
            </div>
          </div>
          {["pending", "escalated", "pending_approval", "manual"].includes(
            decision.status,
          ) &&
          (!decision.owner_company_id ||
            decision.owner_company_id === data.company.id) ? (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={createRule}
                  onChange={(e) => setCreateRule(e.target.checked)}
                />
                <span>
                  <strong>Remember this approval as a rule</strong>
                  <small>
                    Sensitive and expired documents will still need review.
                  </small>
                </span>
              </label>
              <div className="decision-actions">
                <button
                  className="button button-dark"
                  disabled={!!busy}
                  onClick={() => void decide("approve")}
                >
                  <Check size={16} />
                  Approve
                </button>
                <button
                  className="button button-outline danger-text"
                  disabled={!!busy}
                  onClick={() => void decide("deny")}
                >
                  <X size={16} />
                  Decline
                </button>
              </div>
              <div className="manual-divider">OR RESPOND WITH CONTEXT</div>
              <label>
                Manual response
                <textarea
                  placeholder="Explain what the requesting agent should do next…"
                  value={manualResponse}
                  onChange={(e) => setManualResponse(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                className="button button-outline button-full"
                disabled={!manualResponse.trim() || !!busy}
                onClick={() => void decide("manual")}
              >
                Send manual response
                <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <div className="info-banner compact">
              <CheckCircle2 size={18} />
              <p>
                This request is {nice(decision.status).toLowerCase()}.
                {decision.manual_response && ` ${decision.manual_response}`}
              </p>
            </div>
          )}
        </Modal>
      )}
      {revokeTarget && (
        <Modal
          title="Revoke this bridge?"
          subtitle="Future requests and token access through this bridge will stop immediately."
          onClose={() => setRevokeTarget(null)}
        >
          <p className="form-note">
            Previously delivered documents remain with their recipients. Their
            delivery receipts stay in your audit trail.
          </p>
          <div className="decision-actions">
            <button
              className="button button-outline"
              onClick={() => setRevokeTarget(null)}
            >
              Keep bridge
            </button>
            <button
              className="button button-danger"
              disabled={!!busy}
              onClick={() =>
                void mutate(
                  "revoke",
                  () =>
                    api(`/api/bridges/${revokeTarget.id}/revoke`, {
                      method: "POST",
                    }),
                  "Bridge revoked. Future access is blocked.",
                ).then((ok) => {
                  if (ok) setRevokeTarget(null);
                })
              }
            >
              Revoke access
            </button>
          </div>
        </Modal>
      )}
      {selectedEvent && (
        <Modal
          title={nice(
            selectedEvent.event_type ||
              selectedEvent.action ||
              selectedEvent.type,
          )}
          subtitle={`${date(selectedEvent.created_at)} · ${time(selectedEvent.created_at)}`}
          onClose={() => setSelectedEvent(null)}
          wide
        >
          <div className="review-facts">
            <div>
              <span>EVENT ID</span>
              <strong className="monospace">{selectedEvent.id}</strong>
            </div>
            {selectedEvent.bridge_id && (
              <div>
                <span>BRIDGE</span>
                <strong className="monospace">{selectedEvent.bridge_id}</strong>
              </div>
            )}
          </div>
          <pre className="json-output">
            {JSON.stringify(selectedEvent, null, 2)}
          </pre>
          <button
            className="button button-outline"
            onClick={() => void copy(JSON.stringify(selectedEvent, null, 2))}
          >
            <Copy size={14} />
            Copy event
          </button>
        </Modal>
      )}
    </div>
  );
}

function AgentPlayground({
  api,
  data,
  onRefresh,
  onToast,
}: {
  api: <T>(path: string, init?: RequestInit, token?: string) => Promise<T>;
  data: Dashboard;
  onRefresh: () => void;
  onToast: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [expires, setExpires] = useState("");
  const [docs, setDocs] = useState<Document[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [offered, setOffered] = useState<Document[]>([]);
  const [offeredIds, setOfferedIds] = useState<string[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [purposeId, setPurposeId] = useState("");
  const [results, setResults] = useState<AgentDocumentResult[]>([]);
  const [batchProgress, setBatchProgress] = useState("");
  const batchInFlight = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function catalog(accessToken: string) {
    const response = await api<
      | {
          documents: Document[];
          purposes?: Purpose[];
          offered_documents?: Document[];
          own_documents?: Document[];
        }
      | Document[]
    >("/api/documents", { method: "GET" }, accessToken);
    const documents = Array.isArray(response)
      ? response
      : response.documents || [];
    const availablePurposes = Array.isArray(response)
      ? data.purposes
      : response.purposes || data.purposes;
    setDocs(documents);
    setPurposes(availablePurposes);
    setDocumentIds((ids) =>
      ids.filter((id) => documents.some((doc) => doc.id === id)),
    );
    setPurposeId(availablePurposes[0]?.id || "");
    setOffered(
      Array.isArray(response)
        ? []
        : response.offered_documents || response.own_documents || [],
    );
  }
  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy("connect");
    setError("");
    setResults([]);
    try {
      const response = await api<{
        token: string;
        access_token?: string;
        expires_at: string;
      }>("/api/access/exchange", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const accessToken = response.token || response.access_token || "";
      if (!accessToken)
        throw new Error("The exchange did not return an agent token.");
      setToken(accessToken);
      setExpires(response.expires_at);
      setCode("");
      await catalog(accessToken);
      onToast("Agent connected. Its permissions are scoped to this bridge.");
      onRefresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  async function requestDocuments() {
    const selected = docs.filter((doc) => documentIds.includes(doc.id));
    if (
      !token ||
      !purposeId ||
      !selected.length ||
      batchInFlight.current ||
      busy
    )
      return;
    batchInFlight.current = true;
    setBusy("batch");
    setError("");
    try {
      for (const [index, document] of selected.entries()) {
        const id = crypto.randomUUID();
        setBatchProgress(`Requesting ${index + 1} of ${selected.length}…`);
        setResults((previous) => [
          ...previous,
          { id, document, requesting: true },
        ]);
        try {
          const response = await api<Delivery>(
            "/api/requests",
            {
              method: "POST",
              body: JSON.stringify({
                document_id: document.id,
                purpose_id: purposeId,
                offered_document_ids: offeredIds,
              }),
            },
            token,
          );
          setResults((previous) =>
            previous.map((entry) =>
              entry.id === id
                ? { ...entry, response, requesting: false }
                : entry,
            ),
          );
        } catch (err) {
          setResults((previous) =>
            previous.map((entry) =>
              entry.id === id
                ? { ...entry, error: errorText(err), requesting: false }
                : entry,
            ),
          );
        }
      }
      onRefresh();
    } finally {
      setBusy("");
      setBatchProgress("");
      batchInFlight.current = false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SAME CORE. ANY AGENT.</div>
          <h1>
            Agent playground<span className="title-dot">.</span>
          </h1>
          <p>
            Run the real API flow, from a one-time code to a verifiable
            delivery.
          </p>
        </div>
        <a
          className="button button-outline"
          href="/llms.txt"
          target="_blank"
          rel="noreferrer"
        >
          Agent instructions
          <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="playground-intro">
        <Terminal size={23} />
        <p>
          This console acts as your partner&apos;s agent. You will connect with
          a bridge code, select an approved purpose, and request original
          documents. Each document is evaluated separately.
        </p>
        <Badge tone="glass">LIVE API</Badge>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <XCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      <div className="playground-grid">
        <div>
          <section className="panel playground-step">
            <div className="step-heading">
              <span>01</span>
              <div>
                <h2>Connect through a bridge</h2>
                <p>Generate a one-time code from the Bridges view.</p>
              </div>
              {token && <CheckCircle2 size={20} className="teal-text" />}
            </div>
            {token ? (
              <>
                <div className="connected-agent">
                  <span className="agent-connected-icon">
                    <Sparkles size={23} />
                  </span>
                  <div>
                    <strong>Agent session connected</strong>
                    <p>
                      Valid until {time(expires)} · {date(expires)}
                    </p>
                  </div>
                  <Badge tone="green">Scoped</Badge>
                </div>
                <div className="agent-session-actions">
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setToken("");
                      setDocs([]);
                      setDocumentIds([]);
                      setResults([]);
                      setOfferedIds([]);
                    }}
                  >
                    Disconnect locally
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setBusy("catalog");
                      setError("");
                      void catalog(token)
                        .catch((err) => setError(errorText(err)))
                        .finally(() => setBusy(""));
                    }}
                  >
                    <RefreshCw size={13} />
                    Check access
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={connect}>
                <label>
                  One-time access code
                  <input
                    className="monospace"
                    placeholder="Paste your bridge code"
                    value={code}
                    disabled={!!busy}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <button
                  className="button button-dark button-full"
                  disabled={!code.trim() || !!busy}
                >
                  {busy === "connect" ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <>
                      <KeyRound size={16} />
                      Connect agent
                    </>
                  )}
                </button>
              </form>
            )}
          </section>
          <section
            className={`panel playground-step ${!token ? "inactive-step" : ""}`}
          >
            <div className="step-heading">
              <span>02</span>
              <div>
                <h2>Declare your purpose</h2>
                <p>
                  Choose documents for one purpose. You may offer your own in
                  return.
                </p>
              </div>
            </div>
            <div className="offer-title">
              <FileText size={16} />
              <strong>Documents to request</strong>
              <span>{documentIds.length} selected</span>
            </div>
            <div className="agent-session-actions">
              <button
                type="button"
                disabled={!token || !!busy || !docs.length}
                onClick={() => setDocumentIds(docs.map((doc) => doc.id))}
              >
                Select all
              </button>
              <button
                type="button"
                disabled={!token || !!busy || !documentIds.length}
                onClick={() => setDocumentIds([])}
              >
                Clear all
              </button>
            </div>
            <div
              className="offer-list"
              role="group"
              aria-label="Documents to request"
            >
              {docs.map((doc) => (
                <label className="checkbox-label" key={doc.id}>
                  <input
                    type="checkbox"
                    disabled={!token || !!busy}
                    checked={documentIds.includes(doc.id)}
                    onChange={(e) =>
                      setDocumentIds((ids) =>
                        e.target.checked
                          ? [...ids, doc.id]
                          : ids.filter((id) => id !== doc.id),
                      )
                    }
                  />
                  <span>
                    {docName(doc)}
                    {sensitive(doc) ? " · Sensitive" : ""}
                  </span>
                </label>
              ))}
              {!docs.length && (
                <p className="form-note">
                  {token
                    ? "No documents are available through this bridge."
                    : "Documents will appear after connecting."}
                </p>
              )}
            </div>
            <label>
              Business purpose
              <select
                disabled={!token || !!busy}
                value={purposeId}
                onChange={(e) => setPurposeId(e.target.value)}
              >
                <option value="">Select a purpose</option>
                {purposes.map((purpose) => (
                  <option key={purpose.id} value={purpose.id}>
                    {purpose.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="offer-title">
              <CheckCheck size={16} />
              <strong>Offer your documents in return</strong>
              <span>Optional</span>
            </div>
            <p className="form-note">
              You can request documents without offering any. Offers remain
              subject to your company&apos;s permissions.
            </p>
            {offered.length ? (
              <div className="offer-list">
                {offered.map((doc) => (
                  <label key={doc.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      disabled={!token || !!busy}
                      checked={offeredIds.includes(doc.id)}
                      onChange={(e) =>
                        setOfferedIds((ids) =>
                          e.target.checked
                            ? [...ids, doc.id]
                            : ids.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    <span>{docName(doc)}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="form-note">
                {token
                  ? "No documents are available in the requesting company’s vault."
                  : "Your available documents will appear after connecting."}
              </p>
            )}
            <button
              className="button button-dark button-full"
              disabled={!token || !documentIds.length || !purposeId || !!busy}
              onClick={() => void requestDocuments()}
            >
              {busy === "batch" ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  {batchProgress}
                </>
              ) : (
                <>
                  <ArrowRight size={16} />
                  {documentIds.length > 1
                    ? `Request ${documentIds.length} original PDFs`
                    : "Request original PDF"}
                </>
              )}
            </button>
          </section>
        </div>
        <section className="panel response-panel">
          <div className="panel-heading">
            <div>
              <h2>Agent responses</h2>
              <p>Each document keeps its own decision and delivery.</p>
            </div>
            <span className="terminal-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
          {results.length ? (
            <div aria-live="polite">
              {results.map((entry) => (
                <AgentResult
                  key={entry.id}
                  entry={entry}
                  token={token}
                  api={api}
                  disabled={!!busy}
                  onUpdate={(response) =>
                    setResults((previous) =>
                      previous.map((item) =>
                        item.id === entry.id
                          ? { ...item, response, error: undefined }
                          : item,
                      ),
                    )
                  }
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          ) : (
            <div className="response-empty">
              <div className="response-illustration">
                <FileText size={42} />
                <div>
                  <ShieldCheck size={20} />
                </div>
              </div>
              <h3>
                Every delivery begins
                <br />
                with permission.
              </h3>
              <p>
                Your agent&apos;s response will appear here.
                <br />
                Every delivery includes the untouched PDF,
                <br />
                extracted text and a verifiable receipt.
              </p>
              <code>POST /api/requests</code>
            </div>
          )}
          <div className="playground-api-foot">
            <Code2 size={14} />
            <span>
              Available over REST and MCP at <code>/api/mcp</code>
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function AgentResult({
  entry,
  token,
  api,
  disabled,
  onUpdate,
  onRefresh,
}: {
  entry: AgentDocumentResult;
  token: string;
  api: <T>(path: string, init?: RequestInit, token?: string) => Promise<T>;
  disabled: boolean;
  onUpdate: (response: Delivery) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState("receipt");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<boolean | null>(null);
  const result = entry.response;
  const delivery = result?.delivery || result;
  const requestId = result?.request_id || result?.request?.id;
  async function checkRequest() {
    if (!requestId || disabled || busy) return;
    setBusy("poll");
    setError("");
    try {
      onUpdate(
        await api<Delivery>(
          `/api/requests/${requestId}`,
          { method: "GET" },
          token,
        ),
      );
      setVerified(null);
      onRefresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  async function verify() {
    if (!delivery?.receipt || disabled || busy) return;
    setBusy("verify");
    setError("");
    try {
      const response = await api<{ valid: boolean }>("/api/receipts/verify", {
        method: "POST",
        body: JSON.stringify(delivery.receipt),
      });
      setVerified(response.valid);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  return (
    <article
      style={{
        borderBottom: "1px solid var(--border, #e1e7df)",
        paddingBottom: 20,
        marginBottom: 20,
      }}
      aria-label={`Result for ${docName(entry.document)}`}
    >
      <div className="panel-heading">
        <h3>{docName(entry.document)}</h3>
      </div>
      <div
        className={`response-status ${delivery?.download_url ? "delivered" : ""}`}
      >
        {entry.requesting ? (
          <LoaderCircle size={20} className="spin" />
        ) : entry.error ? (
          <XCircle size={20} />
        ) : delivery?.download_url ? (
          <CheckCircle2 size={20} />
        ) : (
          <Clock3 size={20} />
        )}
        <div>
          <strong>
            {entry.requesting
              ? "Requesting document…"
              : entry.error
                ? "Request failed"
                : delivery?.download_url
                  ? "Document delivered"
                  : nice(
                      result?.status || result?.request?.status || "pending",
                    )}
          </strong>
          <p>
            {entry.error ||
              (delivery?.download_url
                ? "Original PDF, extracted text and an integrity receipt."
                : result?.manual_response ||
                  result?.reason ||
                  result?.message ||
                  "Each document is evaluated against the owner's permissions.")}
          </p>
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {delivery?.download_url && (
        <a
          className="button button-dark delivery-download"
          href={delivery.download_url}
          target="_blank"
          rel="noreferrer"
        >
          <ArrowDownToLine size={16} />
          Download original PDF
          <ArrowUpRight size={14} />
        </a>
      )}
      {requestId && (
        <button
          className="button button-outline delivery-download"
          disabled={disabled || !!busy}
          onClick={() => void checkRequest()}
        >
          <RefreshCw size={15} className={busy === "poll" ? "spin" : ""} />
          {delivery?.download_url
            ? "Refresh download link"
            : "Check owner decision"}
        </button>
      )}
      {delivery?.receipt && (
        <button
          className="button button-outline delivery-download"
          disabled={disabled || !!busy}
          onClick={() => void verify()}
        >
          <ShieldCheck size={15} />
          {busy === "verify" ? "Verifying receipt…" : "Verify receipt"}
        </button>
      )}
      {verified !== null && (
        <p className="form-note" role="status">
          {verified
            ? "Receipt signature verified (Ed25519)."
            : "Receipt signature is not valid."}
        </p>
      )}
      {result && (
        <>
          <div className="response-tabs">
            {[
              ["receipt", "Receipt"],
              ["text", "Extracted text"],
              ["raw", "Raw response"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <pre className="json-output response-output">
            {tab === "text"
              ? delivery?.extracted_text ||
                "Extracted text will be available after delivery."
              : tab === "receipt"
                ? delivery?.receipt
                  ? JSON.stringify(delivery.receipt, null, 2)
                  : "A receipt is generated when the original document is delivered."
                : JSON.stringify(result, null, 2)}
          </pre>
        </>
      )}
    </article>
  );
}
