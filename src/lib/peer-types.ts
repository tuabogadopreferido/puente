export interface PeerTransfer {
  transfer_id: string;
  transfer_secret: string;
  sha256: string;
  title: string;
  size_bytes: number;
  expires_at: string;
  answer?: { type: "answer"; sdp: string } | null;
  status?: string;
}
export interface SourceOffer {
  transfer_id: string;
  source_key: string;
  sha256: string;
  size_bytes: number;
  offer: { type: "offer"; sdp: string };
}
export const PEER_MAX_BYTES = 20 * 1024 * 1024;
export const PEER_CHUNK_BYTES = 16 * 1024;
