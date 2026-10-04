import { bearer } from "@/lib/auth";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import { endpoint } from "@/lib/http";
import { saveDocumentBatch } from "@/lib/document-sharing";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    saveDocumentBatch(
      await requireOwnerAgentToken(bearer(request)),
      (await context.params).id,
      await request.json(),
    ),
  );
}
