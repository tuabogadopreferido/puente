import { fail, ApiError } from "@/lib/http";
export async function GET() { return fail(new ApiError(410, "Stored downloads have been retired. Request a new peer transfer from the document source.", "peer_transfer_required")); }
