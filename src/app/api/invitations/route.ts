import { requireOwner } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { createInvitation } from "@/lib/invitations";
export async function POST(request: Request) {
  return endpoint(async () =>
    createInvitation(await requireOwner(request), await request.json()),
  );
}
