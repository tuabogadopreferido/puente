import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { ApiError } from "@/lib/http";
import { analyzePdf, ingestionResult, MAX_PDF_BYTES } from "@/lib/ingestion";
import type { PuenteDocument } from "@/lib/types";

export interface UploadOwner {
  userId: string;
  companyId: string;
}
export const uploadInitSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (name) => /\.pdf$/i.test(name) && !/[\x00-\x1f]/.test(name),
        "A PDF filename is required.",
      ),
    size: z.number().int().min(1).max(MAX_PDF_BYTES),
  })
  .strict();
export const uploadCompleteSchema = z.object({ uploadId: z.uuid() }).strict();

export async function readUploadJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "Send upload metadata as JSON.", "invalid_request");
  if (Number(request.headers.get("content-length") || 0) > 4096)
    throw new ApiError(413, "Upload metadata is too large.", "invalid_request");
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 4096)
    throw new ApiError(413, "Upload metadata is too large.", "invalid_request");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(400, "Invalid upload metadata.", "invalid_request");
  }
}

function rpcFailure(error: { code?: string }): never {
  if (error.code === "P0002")
    throw new ApiError(404, "Upload session not found.", "upload_not_found");
  if (error.code === "42501")
    throw new ApiError(403, "Upload is outside your company.", "forbidden");
  if (error.code === "55P03")
    throw new ApiError(
      409,
      "This upload is being processed. Please retry shortly.",
      "upload_in_progress",
    );
  if (error.code === "22023")
    throw new ApiError(
      410,
      "This upload session is no longer available. Start a new upload.",
      "upload_expired",
    );
  throw new ApiError(
    503,
    "Upload processing is temporarily unavailable. Please retry.",
    "upload_unavailable",
  );
}

export async function initializeDocumentUpload(
  owner: UploadOwner,
  input: z.infer<typeof uploadInitSchema>,
) {
  const db = admin();
  const uploadId = randomUUID();
  const path = `${owner.companyId}/${uploadId}.pdf`;
  const inserted = await db.from("document_upload_sessions").insert({
    id: uploadId,
    company_id: owner.companyId,
    user_id: owner.userId,
    filename: input.filename,
    expected_size: input.size,
    storage_path: path,
  });
  if (inserted.error)
    throw new ApiError(
      503,
      "Upload could not be initialized. Please retry.",
      "upload_unavailable",
    );
  // The capability permits INSERT of exactly this path, never a replacement or a read.
  const signed = await db.storage
    .from("documents")
    .createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.token || signed.data.path !== path)
    throw new ApiError(
      503,
      "Upload could not be initialized. Please retry.",
      "upload_unavailable",
    );
  return {
    uploadId,
    token: signed.data.token,
    path,
    signedUrl: signed.data.signedUrl,
  };
}

const claimedSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    document: z.custom<PuenteDocument>(),
  }),
  z.object({
    status: z.literal("processing"),
    session: z.object({
      id: z.uuid(),
      company_id: z.uuid(),
      user_id: z.uuid(),
      filename: z.string(),
      expected_size: z.number().int().min(1).max(MAX_PDF_BYTES),
      storage_path: z.string(),
      lease_id: z.uuid(),
    }),
  }),
]);

export async function completeDocumentUpload(
  owner: UploadOwner,
  uploadId: string,
  beforeCommit?: () => Promise<void>,
) {
  const db = admin();
  const leaseId = randomUUID();
  const claim = await db.rpc("claim_document_upload", {
    p_upload_id: uploadId,
    p_user_id: owner.userId,
    p_company_id: owner.companyId,
    p_lease_id: leaseId,
  });
  if (claim.error) rpcFailure(claim.error);
  const parsedClaim = claimedSchema.safeParse(claim.data);
  if (!parsedClaim.success)
    throw new ApiError(
      503,
      "Upload state could not be verified. Please retry.",
      "upload_unavailable",
    );
  const claimed = parsedClaim.data;
  if (claimed.status === "completed") {
    await beforeCommit?.();
    return ingestionResult(claimed.document);
  }
  const session = claimed.session;
  const path = `${owner.companyId}/${uploadId}.pdf`;
  if (
    session.id !== uploadId ||
    session.user_id !== owner.userId ||
    session.company_id !== owner.companyId ||
    session.storage_path !== path ||
    session.lease_id !== leaseId
  )
    throw new ApiError(403, "Upload is outside your company.", "forbidden");

  try {
    const info = await db.storage.from("documents").info(path);
    if (info.error || !info.data) {
      if (
        info.error?.status === 404 ||
        info.error?.statusCode === "404" ||
        ("code" in (info.error || {}) &&
          (info.error as { code?: string }).code === "NoSuchKey")
      )
        throw new ApiError(
          409,
          "The PDF upload has not finished. Please retry completion.",
          "upload_not_ready",
        );
      throw new ApiError(
        503,
        "The uploaded PDF could not be checked. Please retry.",
        "upload_unavailable",
      );
    }
    if (
      info.data.size !== undefined &&
      (info.data.size !== session.expected_size ||
        info.data.size > MAX_PDF_BYTES)
    )
      throw new ApiError(
        400,
        "The uploaded PDF size does not match the upload session.",
        "upload_size_mismatch",
      );
    const contentType = info.data.contentType?.split(";")[0].toLowerCase();
    if (contentType && contentType !== "application/pdf")
      throw new ApiError(400, "This file is not a PDF.", "invalid_pdf");
    const downloaded = await db.storage.from("documents").download(
      path,
      {},
      {
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (downloaded.error || !downloaded.data)
      throw new ApiError(
        503,
        "The uploaded PDF could not be read. Please retry.",
        "upload_unavailable",
      );
    // Both metadata and the actual downloaded byte count are server-validated.
    if (
      downloaded.data.size !== session.expected_size ||
      downloaded.data.size > MAX_PDF_BYTES
    )
      throw new ApiError(
        400,
        "The uploaded PDF size does not match the upload session.",
        "upload_size_mismatch",
      );
    const original = new Uint8Array(await downloaded.data.arrayBuffer());
    if (original.byteLength !== session.expected_size)
      throw new ApiError(
        400,
        "The uploaded PDF size does not match the upload session.",
        "upload_size_mismatch",
      );
    const metadata = await analyzePdf(original, session.filename);
    await beforeCommit?.();
    const finished = await db.rpc("finish_document_upload", {
      p_upload_id: uploadId,
      p_user_id: owner.userId,
      p_company_id: owner.companyId,
      p_lease_id: leaseId,
      p_metadata: metadata,
    });
    if (finished.error) rpcFailure(finished.error);
    return ingestionResult(finished.data as PuenteDocument);
  } catch (error) {
    // Conditional release cannot undo a completed transaction or another worker's lease.
    // Keep original objects until the signed capability expires; deleting now could permit reuse.
    try {
      await db
        .from("document_upload_sessions")
        .update({
          status:
            error instanceof ApiError && error.status === 400
              ? "failed"
              : "pending",
          lease_id: null,
          lease_until: null,
        })
        .eq("id", uploadId)
        .eq("user_id", owner.userId)
        .eq("company_id", owner.companyId)
        .eq("status", "processing")
        .eq("lease_id", leaseId);
    } catch {
      /* The lease expires if the database is temporarily unreachable. */
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "Upload processing is temporarily unavailable. Please retry.",
      "upload_unavailable",
    );
  }
}
