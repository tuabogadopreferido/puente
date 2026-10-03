import { z } from "zod";
import { endpoint, assertDb, ApiError } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { admin } from "@/lib/supabase-admin";
import { documentTypes, normalizeSensitivity } from "@/lib/document-policy";

const correction = z
  .object({
    document_type: z.enum(documentTypes).optional(),
    sensitive: z.boolean().optional(),
    expires_at: z.iso
      .date()
      .refine((value) => value >= "0001-01-01", "Use a valid calendar date")
      .nullable()
      .optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { companyId } = await requireOwner(req);
    const id = z.uuid().parse((await context.params).id);
    const data = correction.parse(await req.json());
    const db = admin();
    const { data: current, error: readError } = await db
      .from("documents")
      .select("document_type,sensitive")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    assertDb(readError);
    if (!current) throw new ApiError(404, "Document not found");

    const effectiveType = data.document_type ?? current.document_type;
    const sensitivity = normalizeSensitivity(
      effectiveType,
      data.sensitive ?? current.sensitive,
    );
    const { data: doc, error } = await db
      .from("documents")
      .update({
        ...data,
        sensitive: sensitivity,
        classification_source: "owner_reviewed",
      })
      .eq("id", id)
      .eq("company_id", companyId)
      // Do not apply a partial correction to a type changed by another owner session.
      .eq("document_type", current.document_type)
      .eq("sensitive", current.sensitive)
      .select(
        "id,title,document_type,sensitive,expires_at,classification_source",
      )
      .maybeSingle();
    assertDb(error);
    if (!doc)
      throw new ApiError(
        409,
        "The classification changed. Reload the document and try again.",
      );
    return doc;
  });
}
