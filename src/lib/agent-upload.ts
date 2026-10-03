import { ApiError } from "@/lib/http";
import {
  requireOwnerAgentToken,
  recheckOwnerAgentContext,
} from "@/lib/owner-agent";
import {
  initializeDocumentUpload,
  completeDocumentUpload,
  uploadInitSchema,
  uploadCompleteSchema,
} from "@/lib/document-upload";
import { MAX_PDF_BYTES } from "@/lib/ingestion";
import type { z } from "zod";

type UploadSession = Awaited<ReturnType<typeof initializeDocumentUpload>>;

/** Build HTTP instructions only for the exact signed capability issued by this server. */
export function agentUploadInstructions(
  session: UploadSession,
  supabaseUrl: string,
) {
  let uploadUrl: URL;
  let base: URL;
  try {
    base = new URL(supabaseUrl);
    uploadUrl = new URL(session.signedUrl);
  } catch {
    throw new ApiError(
      503,
      "The private upload destination is unavailable.",
      "upload_unavailable",
    );
  }
  const expectedPath = `${base.pathname.replace(/\/$/, "")}/storage/v1/object/upload/sign/documents/${session.path}`;
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    uploadUrl.origin !== base.origin ||
    uploadUrl.username ||
    uploadUrl.password ||
    uploadUrl.hash ||
    uploadUrl.pathname !== expectedPath ||
    uploadUrl.searchParams.get("token") !== session.token ||
    [...uploadUrl.searchParams.keys()].some((key) => key !== "token") ||
    uploadUrl.searchParams.getAll("token").length !== 1
  )
    throw new ApiError(
      503,
      "The private upload destination could not be verified.",
      "upload_unavailable",
    );
  return {
    uploadId: session.uploadId,
    path: session.path,
    upload_url: session.signedUrl,
    method: "PUT" as const,
    content_type: "application/pdf",
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "max-age=0",
      "x-upsert": "false",
    },
    body_format: "raw_binary",
    max_bytes: MAX_PDF_BYTES,
    max_pages: 80,
    next_tool: "complete_document_upload",
    next_arguments: { uploadId: session.uploadId },
    instructions: [
      "Keep upload_url private. Its signature authorizes a single fixed object path for up to two hours.",
      "Send the unchanged original PDF bytes as the PUT body directly to upload_url with the returned headers. No Authorization or apikey header is needed. Do not send base64, JSON, a remote URL, or the PDF body to Puente MCP.",
      "After Storage accepts the PUT, call complete_document_upload with uploadId and your owner credential. Completion validates the actual PDF, its size and pages, computes SHA-256, and classifies it.",
      "If the PUT response is lost, call complete_document_upload with the same uploadId before starting another upload. Completed sessions are idempotent; processing sessions ask you to retry.",
    ],
  };
}

export async function prepareAgentDocumentUpload(
  token: string,
  input: z.infer<typeof uploadInitSchema>,
) {
  const owner = await requireOwnerAgentToken(token);
  const data = uploadInitSchema.parse(input);
  const session = await initializeDocumentUpload(owner, data);
  await recheckOwnerAgentContext(owner);
  return agentUploadInstructions(
    session,
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  );
}

export async function completeAgentDocumentUpload(
  token: string,
  uploadId: string,
) {
  const owner = await requireOwnerAgentToken(token);
  const input = uploadCompleteSchema.parse({ uploadId });
  return completeDocumentUpload(owner, input.uploadId, () =>
    recheckOwnerAgentContext(owner),
  );
}
