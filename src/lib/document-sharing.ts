import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { ApiError, assertDb } from "@/lib/http";
import {
  recheckOwnerAgentContext,
  type OwnerAgentContext,
} from "@/lib/owner-agent";

export const sharingSettingsInput = z
  .object({
    mode: z.enum(["rules", "approval"]),
    // Null allows all purposes in this company's closed list; [] allows none.
    allowed_purpose_ids: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate purposes")
      .nullable(),
  })
  .strict();
export type SharingSettings = z.infer<typeof sharingSettingsInput>;
export const batchCreateInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    document_ids: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate documents")
      .default([]),
    settings: sharingSettingsInput.default({
      mode: "rules",
      allowed_purpose_ids: null,
    }),
  })
  .strict();
export const batchUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    document_ids: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate documents")
      .optional(),
    settings: sharingSettingsInput.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide a batch change");
export const documentSharingInput = z
  .object({
    batch_id: z.uuid().nullable().optional(),
    override: sharingSettingsInput.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide a sharing change");
type SharingDocument = {
  id: string;
  batch_id: string | null;
  sharing_override: SharingSettings | null;
  sharing_revision: number;
};
type Batch = {
  id: string;
  name: string;
  settings: SharingSettings;
  revision: number;
  created_at: string;
};
export interface DocumentSharing {
  document_id: string;
  batch_id: string | null;
  override: SharingSettings | null;
  effective: SharingSettings;
  revision: string;
  company_purpose_ids: string[];
}
const defaults: SharingSettings = { mode: "rules", allowed_purpose_ids: null };
function effectiveDocument(
  doc: SharingDocument,
  batch: Batch | undefined,
  companyPurposeIds: string[],
): DocumentSharing {
  return {
    document_id: doc.id,
    batch_id: doc.batch_id,
    override: doc.sharing_override,
    effective: doc.sharing_override ?? batch?.settings ?? defaults,
    revision: `${doc.sharing_revision}:${doc.sharing_override ? "override" : (doc.batch_id ?? "none")}:${doc.sharing_override ? 0 : (batch?.revision ?? 0)}`,
    company_purpose_ids: companyPurposeIds,
  };
}
async function companyPurposes(companyId: string) {
  const { data, error } = await admin()
    .from("purposes")
    .select("id")
    .eq("company_id", companyId);
  assertDb(error);
  return (data ?? []).map((row) => row.id as string);
}
async function validateSettings(
  companyId: string,
  settings: SharingSettings | undefined | null,
) {
  if (!settings?.allowed_purpose_ids) return;
  const allowed = new Set(await companyPurposes(companyId));
  if (settings.allowed_purpose_ids.some((id) => !allowed.has(id)))
    throw new ApiError(
      400,
      "Choose purposes belonging to this workspace",
      "invalid_purposes",
    );
}
function ownerParams(owner: OwnerAgentContext) {
  return {
    p_company_id: owner.companyId,
    p_user_id: owner.userId,
    p_connection_id: owner.connectionId ?? null,
    p_session_id: owner.humanSessionId ?? null,
  };
}
export async function listDocumentBatches(owner: OwnerAgentContext) {
  await recheckOwnerAgentContext(owner);
  const [batchResult, docResult, purposes] = await Promise.all([
    admin()
      .from("document_batches")
      .select("id,name,settings,revision,created_at")
      .eq("company_id", owner.companyId)
      .order("created_at"),
    admin()
      .from("documents")
      .select("id,batch_id,sharing_override,sharing_revision")
      .eq("company_id", owner.companyId),
    companyPurposes(owner.companyId),
  ]);
  assertDb(batchResult.error);
  assertDb(docResult.error);
  const batches = (batchResult.data ?? []) as Batch[],
    docs = (docResult.data ?? []) as SharingDocument[];
  return {
    batches: batches.map((batch) => ({
      ...batch,
      document_ids: docs
        .filter((doc) => doc.batch_id === batch.id)
        .map((doc) => doc.id),
    })),
    documents: docs.map((doc) =>
      effectiveDocument(
        doc,
        batches.find((batch) => batch.id === doc.batch_id),
        purposes,
      ),
    ),
  };
}
export async function getDocumentSharing(
  companyId: string,
  documentId: string,
): Promise<DocumentSharing> {
  const { data: doc, error } = await admin()
    .from("documents")
    .select("id,batch_id,sharing_override,sharing_revision")
    .eq("id", z.uuid().parse(documentId))
    .eq("company_id", companyId)
    .maybeSingle();
  assertDb(error);
  if (!doc) throw new ApiError(404, "Document not found", "not_found");
  let batch: Batch | undefined;
  if (doc.batch_id) {
    const result = await admin()
      .from("document_batches")
      .select("id,name,settings,revision,created_at")
      .eq("id", doc.batch_id)
      .eq("company_id", companyId)
      .single();
    assertDb(result.error);
    batch = result.data as Batch;
  }
  return effectiveDocument(
    doc as SharingDocument,
    batch,
    await companyPurposes(companyId),
  );
}
export function assertSharingPurpose(
  sharing: DocumentSharing,
  purposeId: string | null,
) {
  if (
    !purposeId ||
    !sharing.company_purpose_ids.includes(purposeId) ||
    (sharing.effective.allowed_purpose_ids !== null &&
      !sharing.effective.allowed_purpose_ids.includes(purposeId))
  )
    throw new ApiError(
      403,
      "This document's sharing settings do not allow that purpose",
      "sharing_purpose_denied",
    );
}
export async function assertRequestSharing(request: {
  owner_company_id: string;
  document_id: string;
  purpose_id: string | null;
  sharing_revision?: string | null;
}) {
  const sharing = await getDocumentSharing(
    request.owner_company_id,
    request.document_id,
  );
  if ((request.sharing_revision ?? "0:none:0") !== sharing.revision)
    throw new ApiError(
      409,
      "Sharing settings changed. Submit a new document request for approval.",
      "sharing_changed",
    );
  assertSharingPurpose(sharing, request.purpose_id);
  return sharing.effective;
}
export async function saveDocumentBatch(
  owner: OwnerAgentContext,
  id: string | null,
  value: unknown,
) {
  const input = id
    ? batchUpdateInput.parse(value)
    : batchCreateInput.parse(value);
  await recheckOwnerAgentContext(owner);
  await validateSettings(owner.companyId, input.settings);
  const { data, error } = await admin().rpc("save_document_batch", {
    ...ownerParams(owner),
    p_batch_id: id ? z.uuid().parse(id) : null,
    p_name: input.name ?? null,
    p_document_ids: input.document_ids ?? null,
    p_settings: input.settings ?? null,
  });
  if (error)
    throw new ApiError(
      409,
      "The batch could not be saved. Check its documents and reload.",
      "batch_conflict",
    );
  const catalog = await listDocumentBatches(owner);
  return { batch: catalog.batches.find((batch) => batch.id === data.id) };
}
export async function setDocumentSharing(
  owner: OwnerAgentContext,
  id: string,
  value: unknown,
) {
  const input = documentSharingInput.parse(value);
  await recheckOwnerAgentContext(owner);
  await validateSettings(owner.companyId, input.override);
  const { error } = await admin().rpc("set_document_sharing", {
    ...ownerParams(owner),
    p_document_id: z.uuid().parse(id),
    p_patch: input,
  });
  if (error)
    throw new ApiError(
      409,
      "Sharing settings could not be saved. Check the document and batch, then reload.",
      "sharing_conflict",
    );
  return getDocumentSharing(owner.companyId, id);
}
