import { endpoint } from "@/lib/http";
import { requireAgent } from "@/lib/auth";
import { pollRequest } from "@/lib/core";
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    pollRequest(await requireAgent(req), (await context.params).id),
  );
}
