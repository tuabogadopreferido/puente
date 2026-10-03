import { z } from "zod";
import { endpoint } from "@/lib/http";
import { acceptInvitation } from "@/lib/invitations";
export async function POST(request: Request) {
  return endpoint(async () => {
    const input = z
      .object({ token: z.string().max(2000) })
      .parse(await request.json());
    return acceptInvitation(request, input.token);
  });
}
