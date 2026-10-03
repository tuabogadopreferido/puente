import { readDownload } from "@/lib/crypto";
import { agentFromHash, sha256 } from "@/lib/auth";
import { admin } from "@/lib/supabase-admin";
import { fail, ApiError, assertDb } from "@/lib/http";
import { logEvent } from "@/lib/core";
import { streamPdfResponse } from "@/lib/pdf-response";
export async function GET(req: Request) {
  try {
    const ticket = readDownload(
      new URL(req.url).searchParams.get("ticket") ?? "",
    );
    const ctx = await agentFromHash(ticket.token_hash);
    const { data: receipt, error } = await admin()
      .from("receipts")
      .select("payload")
      .eq("id", ticket.receipt_id)
      .eq("company_id", ctx.targetCompanyId)
      .eq("receiver_company_id", ctx.actorCompanyId)
      .single();
    assertDb(error);
    if (!receipt || receipt.payload.bridge_id !== ctx.bridge.id)
      throw new ApiError(403, "Receipt is outside this bridge");
    const { data: doc, error: de } = await admin()
      .from("documents")
      .select("*")
      .eq("id", receipt.payload.document_id)
      .eq("company_id", ctx.targetCompanyId)
      .single();
    assertDb(de);
    const { data: file, error: fe } = await admin()
      .storage.from("documents")
      .download(doc.storage_path);
    assertDb(fe);
    if (!file) throw new ApiError(404, "Original PDF unavailable");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sha256(bytes) !== receipt.payload.sha256)
      throw new ApiError(409, "Original file integrity check failed");
    await agentFromHash(ticket.token_hash);
    await logEvent(
      ctx.targetCompanyId,
      ctx.actorCompanyId,
      ctx.bridge.id,
      "pdf_downloaded",
      doc.id,
      { receipt_id: ticket.receipt_id },
    );
    return streamPdfResponse(bytes, doc.title, doc.sha256);
  } catch (e) {
    return fail(e);
  }
}
