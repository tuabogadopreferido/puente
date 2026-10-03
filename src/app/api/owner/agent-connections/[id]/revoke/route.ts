import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { revokeOwnerAgentConnection } from "@/lib/owner-agent-connections";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    revokeOwnerAgentConnection(
      await requireOwner(request),
      z.uuid().parse((await context.params).id),
    ),
  );
}
