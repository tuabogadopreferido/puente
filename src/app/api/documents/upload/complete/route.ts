/** Retired: Puente coordinates sources and never stores PDF bodies. */
export async function POST() {
  return Response.json(
    {
      error: "File storage has been removed. Connect your agent and register the file at its source.",
      code: "storage_removed",
      guide: "/llms.txt",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
