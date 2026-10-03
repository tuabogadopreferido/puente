import { z } from "zod";
import { endpoint } from "@/lib/http";
import { exchangeCode } from "@/lib/core";
export async function POST(req: Request) {
  return endpoint(async () => {
    const { code } = z
      .object({ code: z.string().min(12).max(200) })
      .parse(await req.json());
    return exchangeCode(code);
  });
}
