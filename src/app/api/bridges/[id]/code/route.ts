import { z } from "zod";
import { endpoint } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { issueCode } from "@/lib/core";
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const owner = await requireOwner(req);
    const body = z
      .object({ actor_company_id: z.uuid().optional() })
      .parse(await req.json());
    return issueCode(
      owner.companyId,
      (await context.params).id,
      body.actor_company_id,
    );
  });
}
