import { z } from "zod";
import { bearer } from "@/lib/auth";
import { endpoint, fail } from "@/lib/http";
import {
  downloadOwnerOriginal,
  getOwnerDocument,
  requireOwnerAgentToken,
} from "@/lib/owner-agent";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return endpoint(async () =>
    getOwnerDocument(
      await requireOwnerAgentToken(bearer(request)),
      z.uuid().parse((await context.params).id),
    ),
  );
}
export async function GET(request: Request, context: Context) {
  try {
    return await downloadOwnerOriginal(
      z.uuid().parse((await context.params).id),
      new URL(request.url).searchParams.get("ticket") || "",
    );
  } catch (error) {
    return fail(error);
  }
}
