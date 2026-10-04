import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { ApiError, assertDb } from "@/lib/http";
import { documentTypes, normalizeSensitivity } from "@/lib/document-policy";
import {
  requireOwnerAgentToken,
  recheckOwnerAgentContext,
  type OwnerAgentContext,
} from "@/lib/owner-agent";

const correctionFields = {
  document_type: z.enum(documentTypes).optional(),
  sensitive: z.boolean().optional(),
  expires_at: z.iso
    .date()
    .refine((value) => value >= "0001-01-01", "Use a valid calendar date")
    .nullable()
    .optional(),
};
const correction = z.object(correctionFields).strict();
function hasCorrection(value: z.infer<typeof correction>) {
  return (
    value.document_type !== undefined ||
    value.sensitive !== undefined ||
    value.expires_at !== undefined
  );
}
const correctionRequired = {
  message:
    "Provide at least one classification field: document_type, sensitive, or expires_at.",
};
export const documentClassificationCorrectionInput = correction.refine(
  hasCorrection,
  correctionRequired,
);
export const ownerDocumentClassificationInput = z
  .object({
    document_id: z.uuid(),
    ...correctionFields,
  })
  .strict()
  .refine(hasCorrection, correctionRequired);

/** Both REST and MCP update classification metadata through this owner-scoped core. */
export async function correctDocumentClassification(
  owner: OwnerAgentContext,
  value: unknown,
) {
  const { document_id: id, ...data } =
    ownerDocumentClassificationInput.parse(value);
  await recheckOwnerAgentContext(owner);
  const db = admin();
  const { data: current, error: readError } = await db
    .from("documents")
    .select("document_type,sensitive")
    .eq("id", id)
    .eq("company_id", owner.companyId)
    .maybeSingle();
  assertDb(readError);
  if (!current) throw new ApiError(404, "Document not found", "not_found");

  const effectiveType = data.document_type ?? current.document_type;
  const sensitivity = normalizeSensitivity(
    effectiveType,
    data.sensitive ?? current.sensitive,
  );
  // Recheck the durable connection, membership and token lifetime immediately before writing.
  await recheckOwnerAgentContext(owner);
  const { data: doc, error } = await db
    .from("documents")
    .update({
      ...data,
      sensitive: sensitivity,
      classification_source: "owner_reviewed",
    })
    .eq("id", id)
    .eq("company_id", owner.companyId)
    // Preserve optimistic conflict protection for partial corrections.
    .eq("document_type", current.document_type)
    .eq("sensitive", current.sensitive)
    .select("id,title,document_type,sensitive,expires_at,classification_source")
    .maybeSingle();
  assertDb(error);
  if (!doc)
    throw new ApiError(
      409,
      "The classification changed. Reload the document and try again.",
      "classification_conflict",
    );
  return doc;
}

export async function correctOwnerDocumentClassification(
  token: string,
  value: unknown,
) {
  const owner = await requireOwnerAgentToken(token);
  return correctDocumentClassification(owner, value);
}
