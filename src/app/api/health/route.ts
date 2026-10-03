import { json } from "@/lib/http";
import { admin } from "@/lib/supabase-admin";
export async function GET() {
  try {
    const { error } = await admin()
      .from("companies")
      .select("id", { count: "exact", head: true });
    return json(
      {
        status: error ? "degraded" : "ok",
        database: !error,
        service: "Puente",
      },
      error ? 503 : 200,
    );
  } catch {
    return json(
      { status: "unconfigured", database: false, service: "Puente" },
      503,
    );
  }
}
