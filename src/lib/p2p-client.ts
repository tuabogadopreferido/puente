import {
  PEER_CHUNK_BYTES,
  PEER_MAX_BYTES,
  type PeerTransfer,
  type SourceOffer,
} from "./peer-types";
export type { PeerTransfer } from "./peer-types";
export interface LocalSourceHandle {
  sourceId: string;
  documents: Array<{ id: string; title: string }>;
  close(): void;
}
type Runtime = {
  baseUrl?: string;
  createPeer?: () => RTCPeerConnection;
  sendBytes?: (channel: RTCDataChannel, bytes: Uint8Array) => void;
};
let runtime: Runtime = {};
/** Used by the local Node connector; browsers use their native WebRTC stack. */
export function configurePeerRuntime(value: Runtime) {
  runtime = value;
}
function peer() {
  return (
    runtime.createPeer?.() ??
    new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })
  );
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function api<T>(
  path: string,
  token: string,
  value?: unknown,
): Promise<T> {
  const response = await fetch(`${runtime.baseUrl ?? ""}${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Peer coordination failed.");
  return body as T;
}
async function hash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function gathered(pc: RTCPeerConnection) {
  const deadline = Date.now() + 15000;
  while (pc.iceGatheringState !== "complete") {
    if (Date.now() > deadline)
      throw new Error("The network could not prepare a peer connection.");
    await delay(100);
  }
  if (!pc.localDescription?.sdp)
    throw new Error("Peer connection has no local description.");
  return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
}
export async function getPeerTransfer(
  id: string,
  secret: string,
): Promise<PeerTransfer> {
  return api(`/api/transfers/${encodeURIComponent(id)}`, secret);
}
export async function registerLocalFiles(
  tokenProvider: () => Promise<string>,
  files: File[],
  onStatus?: (message: string) => void,
  options?: { sourceId?: string; sourceKeys?: string[]; label?: string },
): Promise<LocalSourceHandle> {
  if (!files.length || files.length > 30)
    throw new Error("Choose between 1 and 30 PDF files.");
  for (const file of files) {
    if (
      !/\.pdf$/i.test(file.name) ||
      file.size < 1 ||
      file.size > PEER_MAX_BYTES
    )
      throw new Error("Each original must be a PDF no larger than 20 MiB.");
    if ((await file.slice(0, 5).text()) !== "%PDF-")
      throw new Error(`${file.name} is not an original PDF.`);
  }
  const token = await tokenProvider();
  const source = await api<{ id: string }>("/api/sources", token, {
    ...(options?.sourceId ? { id: options.sourceId } : {}),
    label: options?.label ?? "Local document source",
  });
  const entries = new Map<string, { file: File; sha256: string }>();
  const documents: LocalSourceHandle["documents"] = [];
  for (const [index, file] of files.entries()) {
    onStatus?.(`Registering ${file.name}`);
    // File objects and complete original bytes never leave this device via HTTP.
    const key = options?.sourceKeys?.[index] ?? crypto.randomUUID(),
      digest = await hash(await file.arrayBuffer());
    try {
      const document = await api<{ id: string; title: string }>(
        "/api/sources/documents",
        await tokenProvider(),
        {
          source_id: source.id,
          source_key: key,
          title: file.name.replace(/\.pdf$/i, ""),
          sha256: digest,
          size_bytes: file.size,
          document_type: "other",
          sensitive: true,
          expires_at: null,
        },
      );
      entries.set(key, { file, sha256: digest });
      documents.push(document);
    } catch (error) {
      if (!documents.length) throw error;
      onStatus?.(
        `Could not register ${file.name}; other registered files remain connected.`,
      );
    }
  }
  let closed = false;
  const connections = new Map<string, RTCPeerConnection>();
  const seen = new Set<string>();
  async function answer(offer: SourceOffer) {
    const entry = entries.get(offer.source_key);
    if (
      !entry ||
      entry.sha256 !== offer.sha256 ||
      entry.file.size !== offer.size_bytes
    )
      throw new Error("The requested source file is unavailable or changed.");
    const pc = peer();
    connections.set(offer.transfer_id, pc);
    let acceptedChannel: RTCDataChannel | null = null;
    pc.ondatachannel = ({ channel }) => {
      if (channel.label !== "puente-file") {
        channel.close();
        return;
      }
      if (acceptedChannel) {
        if (acceptedChannel !== channel) channel.close();
        return;
      }
      acceptedChannel = channel;
      let sending = false;
      channel.onopen = async () => {
        // Native adapters can dispatch open more than once. One peer transfer
        // has exactly one original, regardless of repeated lifecycle events.
        if (sending) return;
        sending = true;
        try {
          // A fresh owner/bridge check immediately precedes every new transfer.
          const access = await api<{ offers: SourceOffer[] }>(
            `/api/sources/${source.id}`,
            await tokenProvider(),
          );
          if (
            !access.offers.some(
              (item) => item.transfer_id === offer.transfer_id,
            )
          )
            throw new Error("Transfer permission ended.");
          channel.send(
            JSON.stringify({
              type: "metadata",
              size: entry.file.size,
              sha256: entry.sha256,
            }),
          );
          for (
            let offset = 0;
            offset < entry.file.size;
            offset += PEER_CHUNK_BYTES
          ) {
            if (
              closed ||
              pc.connectionState === "closed" ||
              channel.readyState !== "open"
            )
              throw new Error("Transfer interrupted.");
            while (channel.bufferedAmount > 256 * 1024) {
              if (closed || channel.readyState !== "open")
                throw new Error("Transfer interrupted.");
              await delay(15);
            }
            const chunk = new Uint8Array(
              await entry.file
                .slice(offset, offset + PEER_CHUNK_BYTES)
                .arrayBuffer(),
            );
            if (runtime.sendBytes) runtime.sendBytes(channel, chunk);
            // Select the explicit binary overload across native WebRTC implementations.
            else channel.send(chunk.buffer);
          }
          channel.send(JSON.stringify({ type: "complete" }));
          onStatus?.(`Sent ${entry.file.name} directly to the receiver`);
        } catch {
          pc.close();
        }
      };
    };
    await pc.setRemoteDescription(offer.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    const answer = await gathered(pc);
    if (closed) {
      pc.close();
      return;
    }
    await api(`/api/sources/${source.id}`, await tokenProvider(), {
      transfer_id: offer.transfer_id,
      answer,
    });
  }
  async function poll() {
    while (!closed) {
      try {
        const result = await api<{ offers: SourceOffer[] }>(
          `/api/sources/${source.id}`,
          await tokenProvider(),
        );
        const valid = new Set(result.offers.map((item) => item.transfer_id));
        for (const [id, pc] of connections)
          if (!valid.has(id)) {
            pc.close();
            connections.delete(id);
          }
        for (const offer of result.offers)
          if (!seen.has(offer.transfer_id)) {
            seen.add(offer.transfer_id);
            void answer(offer).catch((error) => {
              connections.get(offer.transfer_id)?.close();
              onStatus?.(
                error instanceof Error
                  ? error.message
                  : "Source connection failed.",
              );
            });
          }
      } catch (error) {
        // Lost authentication/authorization stops every live peer immediately.
        for (const pc of connections.values()) pc.close();
        connections.clear();
        onStatus?.(
          error instanceof Error ? error.message : "Source unavailable.",
        );
      }
      await delay(2000);
    }
  }
  void poll();
  onStatus?.("Source connected. Keep this tab or local connector running.");
  return {
    sourceId: source.id,
    documents,
    close() {
      closed = true;
      for (const pc of connections.values()) pc.close();
      entries.clear();
    },
  };
}
export async function beginPeerDownload(
  transfer: PeerTransfer,
  onProgress?: (received: number, total: number) => void,
): Promise<Blob> {
  if (
    !Number.isInteger(transfer.size_bytes) ||
    transfer.size_bytes < 1 ||
    transfer.size_bytes > PEER_MAX_BYTES
  )
    throw new Error("Invalid document size.");
  const pc = peer(),
    channel = pc.createDataChannel("puente-file", { ordered: true });
  channel.binaryType = "arraybuffer";
  let received = 0,
    metadata = false,
    done = false,
    finalizing = false,
    answerSet = false;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let rejectResult: (reason: Error) => void = () => {};
  const result = new Promise<Blob>((resolve, reject) => {
    rejectResult = reject;
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "The owner's source is offline or this network cannot establish a peer connection. Keep the source open and retry.",
          ),
        ),
      60000,
    );
    channel.onmessage = async (event) => {
      try {
        // Completion freezes an exact-size byte snapshot before asynchronous
        // hashing/authorization. Later frames cannot change that snapshot or
        // turn a verified delivery into an error while its acknowledgement runs.
        if (done || finalizing) return;
        if (typeof event.data === "string") {
          if (event.data.length > 1024)
            throw new Error("Invalid peer control message.");
          const message = JSON.parse(event.data);
          if (message.type === "metadata") {
            if (
              metadata ||
              message.sha256 !== transfer.sha256 ||
              message.size !== transfer.size_bytes
            )
              throw new Error(
                "Source identity or size does not match the authorized document.",
              );
            metadata = true;
          } else if (message.type === "complete") {
            if (!metadata || received !== transfer.size_bytes)
              throw new Error("The original file was not fully received.");
            finalizing = true;
            const bytes = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            if ((await hash(bytes.buffer)) !== transfer.sha256)
              throw new Error("Original file integrity check failed.");
            // Finish only if the source credential and recipient permission remain active.
            await api(
              `/api/transfers/${transfer.transfer_id}`,
              transfer.transfer_secret,
              { action: "complete", sha256: transfer.sha256 },
            );
            done = true;
            clearTimeout(timer);
            resolve(new Blob([bytes], { type: "application/pdf" }));
          } else throw new Error("Unexpected peer message.");
          return;
        }
        if (!metadata || finalizing)
          throw new Error("Source sent bytes outside its file transfer.");
        const data =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : ArrayBuffer.isView(event.data)
              ? new Uint8Array(
                  event.data.buffer,
                  event.data.byteOffset,
                  event.data.byteLength,
                )
              : null;
        if (
          !data ||
          data.byteLength > PEER_CHUNK_BYTES ||
          received + data.byteLength > transfer.size_bytes
        )
          throw new Error("Invalid peer file chunk.");
        chunks.push(new Uint8Array(data));
        received += data.byteLength;
        onProgress?.(received, transfer.size_bytes);
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            reject(new Error("The source stopped sending the original file.")),
          Math.min(
            30000,
            Math.max(1, Date.parse(transfer.expires_at) - Date.now()),
          ),
        );
      } catch (error) {
        reject(error);
      }
    };
    channel.onerror = () => {
      if (!done && !finalizing) reject(new Error("Peer connection failed."));
    };
    channel.onclose = () => {
      // The sender may observe the committed acknowledgement and close its
      // channel before the receiver's HTTP response finishes arriving.
      if (!done && !finalizing)
        reject(new Error("The source disconnected before delivery completed."));
    };
  });
  // Attach a handler immediately: negotiation may outlast the timeout promise.
  void result.catch(() => {});
  try {
    await pc.setLocalDescription(await pc.createOffer());
    const offer = await gathered(pc);
    await api(
      `/api/transfers/${transfer.transfer_id}`,
      transfer.transfer_secret,
      { action: "offer", offer },
    );
    void (async () => {
      while (!done && pc.connectionState !== "closed") {
        try {
          const state = await getPeerTransfer(
            transfer.transfer_id,
            transfer.transfer_secret,
          );
          if (!answerSet && state.answer) {
            answerSet = true;
            await pc.setRemoteDescription(state.answer);
          }
        } catch (error) {
          rejectResult(
            error instanceof Error
              ? error
              : new Error("Transfer permission ended."),
          );
          return;
        }
        await delay(2000);
      }
    })();
    return await result;
  } finally {
    done = true;
    clearTimeout(timer!);
    pc.close();
    chunks.length = 0;
  }
}
