import { bearer } from "@/lib/auth";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import { endpoint } from "@/lib/http";
import { listDocumentBatches, saveDocumentBatch } from "@/lib/document-sharing";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () =>
    listDocumentBatches(await requireOwnerAgentToken(bearer(request))),
  );
}
export async function POST(request: Request) {
  return endpoint(async () =>
    saveDocumentBatch(
      await requireOwnerAgentToken(bearer(request)),
      null,
      await request.json(),
    ),
  );
}
