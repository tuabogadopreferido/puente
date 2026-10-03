import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "./http";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
      .join(",") +
    "}"
  );
}
function privateKey() {
  const k = process.env.RECEIPT_PRIVATE_KEY;
  if (!k) throw new ApiError(503, "Receipt signing is not configured");
  return createPrivateKey(Buffer.from(k, "base64").toString("utf8"));
}
export function publicKey() {
  return createPublicKey(privateKey())
    .export({ type: "spki", format: "pem" })
    .toString();
}
export function signReceipt(payload: unknown) {
  return {
    signature: sign(
      null,
      Buffer.from(canonical(payload)),
      privateKey(),
    ).toString("base64"),
    public_key: publicKey(),
    algorithm: "Ed25519",
  };
}
export function verifyReceipt(payload: unknown, signature: string) {
  try {
    return verify(
      null,
      Buffer.from(canonical(payload)),
      publicKey(),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
function secret() {
  const s = process.env.APP_SIGNING_SECRET;
  if (!s || s.length < 32)
    throw new ApiError(503, "Download signing is not configured");
  return s;
}
export function signDownload(payload: Record<string, unknown>) {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return (
    value +
    "." +
    createHmac("sha256", secret()).update(value).digest("base64url")
  );
}
export function readDownload(value: string): {
  receipt_id: string;
  token_hash: string;
  exp: number;
} {
  const [raw, sig, extra] = value.split(".");
  if (!raw || !sig || extra) throw new ApiError(401, "Invalid download link");
  const expected = createHmac("sha256", secret()).update(raw).digest();
  const actual = Buffer.from(sig, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new ApiError(401, "Invalid download signature");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString());
  } catch {
    throw new ApiError(401, "Invalid download link");
  }
  if (
    !payload.exp ||
    payload.exp < Date.now() ||
    !payload.receipt_id ||
    !payload.token_hash
  )
    throw new ApiError(401, "Download link expired");
  return payload;
}
