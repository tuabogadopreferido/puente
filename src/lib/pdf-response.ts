const PDF_CHUNK_BYTES = 64 * 1024;

/** Stream bytes only after the caller has verified the original hash and access. */
export function streamPdfResponse(
  bytes: Uint8Array,
  title: string,
  sha256: string,
): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + PDF_CHUNK_BYTES, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80)}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Puente-SHA256": sha256,
    },
  });
}
