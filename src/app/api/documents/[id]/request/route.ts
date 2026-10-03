import { z } from "zod";
import { endpoint } from "@/lib/http";
import { requireAgent } from "@/lib/auth";
import { requestDocument } from "@/lib/core";
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const body = z
      .object({
        purpose_id: z.uuid().optional(),
        purpose: z.string().min(1).max(500).optional(),
        offered_document_ids: z.array(z.uuid()).max(100).optional(),
      })
      .parse(await req.json());
    return requestDocument(await requireAgent(req), {
      ...body,
      document_id: z.uuid().parse((await context.params).id),
    });
  });
}
