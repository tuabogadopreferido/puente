import { requireOwner } from "@/lib/auth";
import { ApiError, fail, json } from "@/lib/http";
import {
  completeDocumentUpload,
  readUploadJson,
  uploadCompleteSchema,
} from "@/lib/document-upload";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const input = uploadCompleteSchema.parse(await readUploadJson(request));
    return json(await completeDocumentUpload(owner, input.uploadId));
  } catch (error) {
    if (error instanceof ApiError || error instanceof ZodError)
      return fail(error);
    return json(
      {
        error: "Upload processing is temporarily unavailable. Please retry.",
        code: "upload_unavailable",
      },
      503,
    );
  }
}
