import { z } from "zod";
import { endpoint } from "@/lib/http";
import { requireAgent } from "@/lib/auth";
import { requestDocument } from "@/lib/core";
const requestSchema = z.object({
  document_id: z.uuid(),
  purpose_id: z.uuid().optional(),
  purpose: z.string().min(1).max(500).optional(),
  offered_document_ids: z.array(z.uuid()).max(100).optional(),
});
export async function POST(req: Request) {
  return endpoint(async () =>
    requestDocument(
      await requireAgent(req),
      requestSchema.parse(await req.json()),
    ),
  );
}
