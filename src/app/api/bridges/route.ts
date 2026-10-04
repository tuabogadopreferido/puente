import { z } from "zod";
import { endpoint } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { createBridge } from "@/lib/core";
export async function POST(req: Request) {
  return endpoint(async () => {
    const owner = await requireOwner(req);
    const body = z
      .object({
        counterparty_id: z.uuid(),
        expires_in_hours: z.number().int().min(1).max(24).default(24),
      })
      .parse(await req.json());
    return createBridge(
      owner.companyId,
      body.counterparty_id,
      body.expires_in_hours,
    );
  });
}
