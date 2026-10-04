/** Original files remain on this device. Only metadata and SDP use Puente HTTP. */
import { readFile, writeFile, readdir, stat, mkdir, chmod } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  RTCPeerConnection as NodePeer,
  type RTCDataChannel as NodeChannel,
} from "werift";
import {
  configurePeerRuntime,
  registerLocalFiles,
  beginPeerDownload,
  getPeerTransfer,
  type PeerTransfer,
} from "../src/lib/p2p-client";

const base = (
  process.env.PUENTE_URL || "https://puente-phi.vercel.app"
).replace(/\/$/, "");
const parsed = new URL(base);
if (
  parsed.protocol !== "https:" &&
  !(
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
)
  throw new Error("Use HTTPS for the Puente server.");
const rtcServers = process.env.PUENTE_ICE_SERVERS
  ? JSON.parse(process.env.PUENTE_ICE_SERVERS)
  : [{ urls: "stun:stun.l.google.com:19302" }];
configurePeerRuntime({
  baseUrl: base,
  createPeer: () =>
    new NodePeer({ iceServers: rtcServers }) as unknown as RTCPeerConnection,
  sendBytes: (channel, bytes) =>
    (channel as unknown as NodeChannel).send(Buffer.from(bytes)),
});
const [command, ...args] = process.argv.slice(2);
async function serve(paths: string[]) {
  const token = process.env.PUENTE_OWNER_TOKEN;
  if (!token?.startsWith("po_"))
    throw new Error(
      "Set PUENTE_OWNER_TOKEN to your private Connect my agent credential.",
    );
  if (!paths.length)
    throw new Error(
      "Provide a PDF file or a directory on this device. Drive-synced folders are supported.",
    );
  const expanded: string[] = [];
  for (const name of paths) {
    const absolute = resolve(name),
      info = await stat(absolute);
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute))
        if (/\.pdf$/i.test(entry)) expanded.push(resolve(absolute, entry));
    } else expanded.push(absolute);
  }
  const unique = [...new Set(expanded)];
  if (!unique.length || unique.length > 30)
    throw new Error("Choose between 1 and 30 PDFs per connector.");
  const statePath =
    process.env.PUENTE_SOURCE_STATE ||
    resolve(
      homedir(),
      ".puente",
      createHash("sha256")
        .update(base + token)
        .digest("hex")
        .slice(0, 20) + ".json",
    );
  type State = {
    sourceId?: string;
    entries: Record<string, { key: string; hash: string }>;
  };
  let state: State = { entries: {} };
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const files: File[] = [],
    keys: string[] = [];
  for (const path of unique) {
    const info = await stat(path);
    if (info.size > 20 * 1024 * 1024)
      throw new Error(`${basename(path)} exceeds 20 MiB.`);
    const bytes = await readFile(path),
      hash = createHash("sha256").update(bytes).digest("hex");
    const previous = state.entries[path];
    const key = previous?.hash === hash ? previous.key : randomUUID();
    state.entries[path] = { key, hash };
    keys.push(key);
    files.push(new File([bytes], basename(path), { type: "application/pdf" }));
  }
  const handle = await registerLocalFiles(
    async () => token,
    files,
    (message) => process.stdout.write(message + "\n"),
    {
      sourceId: state.sourceId,
      sourceKeys: keys,
      label: "Local agent connector",
    },
  );
  state.sourceId = handle.sourceId;
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  await chmod(statePath, 0o600);
  process.stdout.write(JSON.stringify({ documents: handle.documents }) + "\n");
  process.stdout.write(
    `Serving ${handle.documents.length} original PDF(s) from this device. Stop with Ctrl+C.\n`,
  );
  const close = () => {
    handle.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
async function receive(
  descriptorPath: string | undefined,
  outputPath: string | undefined,
) {
  if (!descriptorPath || !outputPath)
    throw new Error(
      "Usage: receive /private/transfer.json /destination/original.pdf",
    );
  const json = JSON.parse(await readFile(resolve(descriptorPath), "utf8"));
  const supplied: PeerTransfer = json.transfer ?? json;
  const transfer = await getPeerTransfer(
    supplied.transfer_id,
    supplied.transfer_secret,
  );
  const original = await beginPeerDownload(transfer);
  // Never overwrite an existing user file.
  await writeFile(
    resolve(outputPath),
    Buffer.from(await original.arrayBuffer()),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    `Original verified and saved (${original.size} bytes, SHA-256 ${transfer.sha256}).\n`,
  );
}
async function main() {
  try {
    if (command === "--help" || command === "help") {
      process.stdout.write(
        "Usage: peer-connector.ts serve <PDF paths or directory> | receive <private transfer.json> <output.pdf>\n",
      );
      return;
    }
    if (command === "serve") await serve(args);
    else if (command === "receive") await receive(args[0], args[1]);
    else
      throw new Error(
        "Usage: peer-connector.ts serve <PDF paths or directory> | receive <private transfer.json> <output.pdf>",
      );
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "Connector failed") + "\n",
    );
    process.exit(1);
  }
}
void main();
