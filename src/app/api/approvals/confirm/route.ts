import { z } from "zod";
import { resolveTokenApproval } from "@/lib/approval";
export const runtime = "nodejs";
const input = z.object({
  token: z.string().max(2000),
  createRule: z.boolean().optional(),
  manualResponse: z.string().max(5000).optional(),
});
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    if (Number(request.headers.get("content-length") || 0) > 10_000)
      return Response.json({ error: "Request is too large." }, { status: 413 });
    const result = await resolveTokenApproval(
      input.parse(await request.json()),
    );
    return Response.json(
      { request: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "This request could not be resolved.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
