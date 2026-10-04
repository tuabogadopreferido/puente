# Source and receiver connector

The source connector serves PDFs directly from the owner's computer. It sends metadata and WebRTC signaling to Puente. The receiving connector obtains bytes through a WebRTC data channel and verifies SHA-256 before writing an original PDF to its destination.

## Prepare the owner agent

1. The owner will sign in to Puente with an email code.
2. In **Connect my agent**, they will name a connection and create its permanent credential.
3. The agent will keep that `po_` credential in the private `PUENTE_OWNER_TOKEN` environment variable. It will never put it in a command argument, repository file, public message or diagnostic log.
4. The agent will clone the public repository, use Node.js 22 or later, and run `npm ci` to install its locked dependencies.
5. It will set `PUENTE_URL` to `https://puente-phi.vercel.app`, then run the connector with the selected file or folder:

```sh
node --import tsx scripts/peer-connector.ts serve "/absolute/path/to/document.pdf"
```

A folder path selects its PDFs at the top level; the connector does not recurse into unrelated folders. Up to 30 PDFs, each no larger than 20 MiB, can be selected per connector. A Google Drive folder synchronized onto the computer works in the same way. The connector cannot retrieve cloud-only Drive files without that local synchronization.

The source process will remain running. Its local manifest in `~/.puente` contains file paths, source identifiers and hashes, with private file permissions. It contains neither the credential nor PDF contents. `PUENTE_SOURCE_STATE` can select a different private manifest path.

Registration begins with `other` and sensitive classification. The owner agent will inspect its local original and call `correct_document_classification` through MCP with the document's returned id. Puente does not receive the extracted text or perform server-side classification. A changed original will require a restart and a new document version; the connector detects changes in its startup hash and assigns a new source key. Prior approval never transfers to changed bytes.

The owner agent will use `list_document_batches`, `create_document_batch` and `update_document_batch` to organize related documents and set their shared policy. `set_document_sharing` will assign a document to a batch or set a document-specific override. Each policy will select rule-based handling or mandatory approval and the permitted purposes from the workspace's closed list. An override will take precedence over the batch; clearing it will restore inheritance. Changing a policy invalidates earlier counterpart requests and their transfer capabilities, so the receiving agent will request authorization again.

The interface offers another source option: the person will select PDFs in **Register documents** and keep that tab open. No PDF upload occurs. The local connector is preferable when an agent needs to serve files without keeping the interface open.

## Receive an authorized file

The receiving agent will first request a document through MCP or REST using its bridge token and declared purpose. After approval, the response will contain a `transfer` object and `download_url`.

It will write the private transfer object to a temporary file outside the repository with owner-only read/write permission. It will then run:

```sh
node --import tsx scripts/peer-connector.ts receive "/private/transfer.json" "/destination/original.pdf"
```

The receiver accepts either the transfer object or a complete response containing `transfer`. It will refuse to overwrite an existing destination. The agent will report delivery only after the command verifies and saves the complete PDF; afterward it will remove its temporary transfer descriptor.

A person can instead open the private `download_url`, wait for verification and select **Save original PDF**. The original source tab will remain open separately. Transfer secrets in browser links use the URL fragment and are not sent as HTTP query parameters.

After a failed connection attempt, the receiving agent will request a fresh transfer descriptor before trying again. The SDP offer is bound to a single connection attempt; reusing its link with a new peer connection will be rejected. The source will stay connected throughout the retry.

## Connectivity and revocation

The source device must stay online. The counterpart bridge lasts at most 24 hours; each direct-transfer setup lasts at most five minutes and never outlives that permission. The connector periodically rechecks the source credential and the receiver's permission. Revoking an owner connection disconnects that source but leaves other owner connections and existing bridges intact.

The default WebRTC configuration uses Google's public STUN service for network discovery. STUN does not receive PDF contents. Some network combinations require a TURN relay; none is configured by default. In that situation the connector reports a failed connection. A Node deployment with its own TURN service can supply its private ICE configuration in `PUENTE_ICE_SERVERS`; browser TURN provisioning is not implemented. No provider credentials or hypothetical TURN availability are included in this repository.

The maximum file size and hash are checked at both ends. Puente keeps authorization receipts and a receiver-reported completion event, never a copy of the file. A signed receipt proves what Puente authorized; it does not independently prove that a human read the PDF.
