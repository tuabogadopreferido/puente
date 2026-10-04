import { bearer } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { readPeerTransfer, signalPeerTransfer } from "@/lib/peer-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  return endpoint(async () =>
    readPeerTransfer((await ctx.params).id, bearer(req)),
  );
}
export async function POST(req: Request, ctx: Context) {
  return endpoint(async () =>
    signalPeerTransfer((await ctx.params).id, bearer(req), await req.json()),
  );
}
