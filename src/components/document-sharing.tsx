"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  FolderClosed,
  Layers3,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Purpose = { id: string; name: string };
type DocumentItem = {
  id: string;
  title?: string;
  name?: string;
  filename?: string;
};
export type SharingSettings = {
  mode: "rules" | "approval";
  allowed_purpose_ids: string[] | null;
};
type Batch = {
  id: string;
  name: string;
  settings: SharingSettings;
  document_ids: string[];
  revision: number;
};
type DocumentSharing = {
  document_id: string;
  batch_id: string | null;
  override: SharingSettings | null;
  effective: SharingSettings;
  revision: string;
};
const defaultSettings: SharingSettings = {
  mode: "rules",
  allowed_purpose_ids: null,
};
const documentName = (doc: DocumentItem) =>
  doc.title || doc.name || doc.filename || "Document";
const message = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "Sharing settings could not be saved.";

function SettingsFields({
  value,
  onChange,
  purposes,
  disabled = false,
}: {
  value: SharingSettings;
  onChange: (value: SharingSettings) => void;
  purposes: Purpose[];
  disabled?: boolean;
}) {
  return (
    <div className="sharing-fields">
      <label>
        Approval
        <select
          value={value.mode}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              mode: event.target.value as SharingSettings["mode"],
            })
          }
        >
          <option value="rules">Use my permission policies</option>
          <option value="approval">Ask me before every request</option>
        </select>
      </label>
      <label>
        Allowed purposes
        <select
          value={value.allowed_purpose_ids === null ? "all" : "selected"}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              allowed_purpose_ids: event.target.value === "all" ? null : [],
            })
          }
        >
          <option value="all">All purposes allowed by my policies</option>
          <option value="selected">Only purposes I select</option>
        </select>
      </label>
      {value.allowed_purpose_ids !== null && (
        <div className="sharing-purpose-list">
          {purposes.map((purpose) => (
            <label key={purpose.id} className="checkbox-label">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.allowed_purpose_ids!.includes(purpose.id)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    allowed_purpose_ids: event.target.checked
                      ? [...value.allowed_purpose_ids!, purpose.id]
                      : value.allowed_purpose_ids!.filter(
                          (id) => id !== purpose.id,
                        ),
                  })
                }
              />
              <span>{purpose.name}</span>
            </label>
          ))}
          {value.allowed_purpose_ids.length === 0 && (
            <p className="form-note">
              No purposes selected: document requests will be blocked.
            </p>
          )}
        </div>
      )}
      <p className="form-note">
        The bridge and your existing policies will still apply. Sensitive
        documents will require approval.
      </p>
    </div>
  );
}

export function DocumentSharingEditor({
  documentId,
  api,
  purposes,
  onSaved,
}: {
  documentId: string;
  api: Api;
  purposes: Purpose[];
  onSaved: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [custom, setCustom] = useState(false);
  const [settings, setSettings] = useState<SharingSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<DocumentSharing>(`/api/documents/${documentId}/sharing`),
      api<{ batches: Batch[] }>("/api/document-batches"),
    ])
      .then(([document, result]) => {
        if (!live) return;
        setBatches(result.batches);
        setBatchId(document.batch_id || "");
        setCustom(document.override !== null);
        setSettings(document.override || document.effective);
        setLoaded(true);
      })
      .catch((reason) => {
        if (live) setError(message(reason));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [documentId, api]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api(`/api/documents/${documentId}/sharing`, {
        method: "PATCH",
        body: JSON.stringify({
          batch_id: batchId || null,
          override: custom ? settings : null,
        }),
      });
      setSaved(true);
      onSaved();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  const batch = batches.find((item) => item.id === batchId);
  return (
    <section className="document-sharing-editor">
      <h3>
        <Layers3 size={17} /> Sharing settings
      </h3>
      {loading ? (
        <p className="form-note">
          <LoaderCircle size={15} className="spin" /> Loading settings…
        </p>
      ) : loaded ? (
        <>
          <label>
            Document batch
            <select
              value={batchId}
              disabled={busy}
              onChange={(event) => {
                setBatchId(event.target.value);
                setSaved(false);
              }}
            >
              <option value="">No batch</option>
              {batches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Configuration
            <select
              value={custom ? "custom" : "inherit"}
              disabled={busy}
              onChange={(event) => {
                setCustom(event.target.value === "custom");
                setSaved(false);
              }}
            >
              <option value="inherit">
                {batch
                  ? "Use this batch's settings"
                  : "Use my permission policies"}
              </option>
              <option value="custom">Customize this document</option>
            </select>
          </label>
          {custom ? (
            <SettingsFields
              value={settings}
              onChange={(value) => {
                setSettings(value);
                setSaved(false);
              }}
              purposes={purposes}
              disabled={busy}
            />
          ) : (
            <p className="form-note">
              {batch
                ? `This document will follow ${batch.name}. Future changes to that batch will apply here.`
                : "Your company policies will determine whether requests require approval."}
            </p>
          )}
          <button
            type="button"
            className="button button-outline button-full"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            Save sharing settings
          </button>
          {saved && (
            <p className="form-note" role="status">
              Sharing settings saved.
            </p>
          )}
        </>
      ) : null}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

export function DocumentBatchManager({
  api,
  documents,
  purposes,
  onSaved,
}: {
  api: Api;
  documents: DocumentItem[];
  purposes: Purpose[];
  onSaved: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [editing, setEditing] = useState<Batch | "new" | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<SharingSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const result = await api<{ batches: Batch[] }>("/api/document-batches");
    setBatches(result.batches);
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void refresh()
          .catch((reason) => setError(message(reason)))
          .finally(() => setLoading(false)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [refresh, documents]);
  function edit(batch: Batch | "new") {
    setEditing(batch);
    setError("");
    setNotice("");
    setName(batch === "new" ? "" : batch.name);
    setSelected(batch === "new" ? [] : batch.document_ids);
    setSettings(batch === "new" ? defaultSettings : batch.settings);
  }
  async function save() {
    if (!editing || !name.trim() || !selected.length || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        editing === "new"
          ? "/api/document-batches"
          : `/api/document-batches/${editing.id}`,
        {
          method: editing === "new" ? "POST" : "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            document_ids: selected,
            settings,
          }),
        },
      );
      await refresh();
      onSaved();
      setEditing(null);
      setNotice(
        "Batch saved. Its settings apply to documents that inherit from it.",
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel document-batches">
      <div className="panel-heading">
        <div>
          <h2>
            Document batches{" "}
            <span className="count-pill">{batches.length}</span>
          </h2>
          <p>Group documents that will use the same sharing settings.</p>
        </div>
        {!editing && (
          <button
            type="button"
            className="button button-outline button-small"
            disabled={!documents.length || loading}
            onClick={() => edit("new")}
          >
            <Plus size={15} /> Create batch
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close batch editor"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            <X size={19} />
          </button>
        )}
      </div>
      <div className="batch-content">
        {loading ? (
          <p className="form-note">Loading batches…</p>
        ) : editing ? (
          <div className="batch-editor">
            <div>
              <label>
                Batch name
                <input
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="For example, Supplier onboarding"
                  disabled={busy}
                />
              </label>
              <div className="batch-selection-heading">
                <strong>Documents</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setSelected(
                      selected.length === documents.length
                        ? []
                        : documents.map((doc) => doc.id),
                    )
                  }
                >
                  {selected.length === documents.length
                    ? "Clear selection"
                    : "Select all"}
                </button>
              </div>
              <div className="batch-document-list">
                {documents.map((doc) => (
                  <label key={doc.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(doc.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, doc.id]
                            : current.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    <span>{documentName(doc)}</span>
                  </label>
                ))}
              </div>
              <p className="form-note">
                Each document will belong to one batch. Moving it will update
                its group; any individual custom settings will remain.
              </p>
            </div>
            <div>
              <SettingsFields
                value={settings}
                onChange={setSettings}
                purposes={purposes}
                disabled={busy}
              />
              <button
                type="button"
                className="button button-dark button-full"
                disabled={busy || !name.trim() || !selected.length}
                onClick={() => void save()}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}{" "}
                Save batch
              </button>
            </div>
          </div>
        ) : batches.length ? (
          <div className="batch-grid">
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                className="batch-card"
                onClick={() => edit(batch)}
              >
                <Layers3 size={21} />
                <span>
                  <strong>{batch.name}</strong>
                  <small>
                    {batch.document_ids.length} documents ·{" "}
                    {batch.settings.mode === "approval"
                      ? "Approval for every request"
                      : "Permission policies"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <p className="batch-empty">
            <FolderClosed size={20} />{" "}
            {documents.length
              ? "You will select documents and set their shared permissions when you create a batch."
              : "Register documents to create your first batch."}
          </p>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="form-note" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
