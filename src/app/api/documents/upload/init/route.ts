import { requireOwner } from "@/lib/auth";
import { ApiError, fail, json } from "@/lib/http";
import {
  initializeDocumentUpload,
  readUploadJson,
  uploadInitSchema,
} from "@/lib/document-upload";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const input = uploadInitSchema.parse(await readUploadJson(request));
    return json(await initializeDocumentUpload(owner, input), 201);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ZodError)
      return fail(error);
    return json(
      {
        error: "Upload could not be initialized. Please retry.",
        code: "upload_unavailable",
      },
      503,
    );
  }
}
