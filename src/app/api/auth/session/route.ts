import { requireHumanSession } from "@/lib/auth";
import { endpoint } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => ({
    expires_at: (await requireHumanSession(request)).expiresAt,
  }));
}
