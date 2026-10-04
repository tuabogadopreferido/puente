import { bearer } from "@/lib/auth";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import { endpoint } from "@/lib/http";
import { getDocumentSharing, setDocumentSharing } from "@/lib/document-sharing";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(async () =>
    getDocumentSharing(
      (await requireOwnerAgentToken(bearer(request))).companyId,
      (await context.params).id,
    ),
  );
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () =>
    setDocumentSharing(
      await requireOwnerAgentToken(bearer(request)),
      (await context.params).id,
      await request.json(),
    ),
  );
}
