import { bearer } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import { registerPeerDocument } from "@/lib/peer-server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  return endpoint(async () =>
    registerPeerDocument(
      await requireOwnerAgentToken(bearer(req)),
      await req.json(),
    ),
  );
}
