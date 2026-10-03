import { bearer } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { listOwnerDocuments, requireOwnerAgentToken } from "@/lib/owner-agent";
export async function GET(request: Request) {
  return endpoint(async () =>
    listOwnerDocuments(await requireOwnerAgentToken(bearer(request))),
  );
}
