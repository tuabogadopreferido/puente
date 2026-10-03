import { requireOwner } from "@/lib/auth";
import { endpoint, fail, json } from "@/lib/http";
import {
  createOwnerAgentConnection,
  listOwnerAgentConnections,
} from "@/lib/owner-agent-connections";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () =>
    listOwnerAgentConnections(await requireOwner(request)),
  );
}
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    return json(
      await createOwnerAgentConnection(owner, await request.json()),
      201,
    );
  } catch (error) {
    return fail(error);
  }
}
