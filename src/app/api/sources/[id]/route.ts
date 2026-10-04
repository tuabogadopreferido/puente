import { bearer } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import { pollPeerSource, answerPeerSource } from "@/lib/peer-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  return endpoint(async () =>
    pollPeerSource(
      await requireOwnerAgentToken(bearer(req)),
      (await ctx.params).id,
    ),
  );
}
export async function POST(req: Request, ctx: Context) {
  return endpoint(async () =>
    answerPeerSource(
      await requireOwnerAgentToken(bearer(req)),
      (await ctx.params).id,
      await req.json(),
    ),
  );
}
