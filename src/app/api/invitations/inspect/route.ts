import { endpoint } from "@/lib/http";
import { inspectInvitation } from "@/lib/invitations";
export async function GET(request: Request) {
  return endpoint(() =>
    inspectInvitation(new URL(request.url).searchParams.get("token") || ""),
  );
}
