import { fail } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { ingestPdf, MAX_MULTIPART_PDF_BYTES } from "@/lib/ingestion";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (
      Number(request.headers.get("content-length") || 0) >
      MAX_MULTIPART_PDF_BYTES + 64_000
    )
      return Response.json(
        { error: "Upload a PDF up to 4 MB." },
        { status: 413 },
      );
    const body = await request.formData();
    const file = body.get("file");
    if (!(file instanceof File))
      return Response.json(
        { error: "A PDF file is required." },
        { status: 400 },
      );
    if (!file.size || file.size > MAX_MULTIPART_PDF_BYTES)
      return Response.json(
        { error: "Upload a PDF up to 4 MB." },
        { status: 413 },
      );
    const result = await ingestPdf({ file, ...owner });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
