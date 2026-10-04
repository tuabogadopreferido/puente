import { verifyEmailCode } from "@/lib/email-otp";
import { endpoint } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  return endpoint(async () => verifyEmailCode(request, await request.json()));
}
