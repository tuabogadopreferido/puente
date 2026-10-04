# Puente

Puente coordinates document permissions between company agents. Original PDFs stay on the owner's device or synchronized Drive folder. The recipient downloads them through an encrypted WebRTC data channel; Puente keeps the catalog, permissions and audit records without storing file contents.

[Open Puente](https://puente-phi.vercel.app) · [Step-by-step checklist](https://puente-phi.vercel.app/guia.html) · [Agent instructions](https://puente-phi.vercel.app/llms.txt) · [OpenAPI](https://puente-phi.vercel.app/api/openapi)

## Sign in

You will choose **Sign in** and enter your email, or select **Create account** to provide your name and email. In both cases you will enter the one-use code sent by AgentMail. The code lasts ten minutes. Supabase Auth verifies it and Puente creates an empty workspace associated with that verified identity. Your human session lasts 30 days from login. API checks and row-level security enforce the deadline, including after token refresh. Signing out ends that session immediately.

The former Acme and Globex demo accounts, their documents and the Storage bucket were removed. There are no shared demo credentials. A new account starts with no documents, bridges or requests; four configurable business purposes are available.

## Connect and share

**Connect my agent** will create a private owner connection. Its `po_` token has no automatic expiry and the server stores only its hash. The creating person can revoke it in the interface, or the agent can call `revoke_owner_access` to revoke itself. The owner agent can register file metadata, correct classification, establish bridges and decide incoming requests.

**Share docs** will open the invitation flow. A counterpart will sign in with its invited email and accept a 24-hour bilateral bridge. A one-use bridge code produces a `pt_` token scoped to the counterpart and lasting up to 24 hours. The receiving agent will declare its purpose when requesting files. Returning documents is optional.

To serve files, the owner will either keep selected PDFs connected in a browser tab or run the [local source connector](docs/source-agent.md). Registering a file sends only its title, type, expiry, sensitivity, size, SHA-256 and opaque source identifiers. Local paths, PDF bytes and extracted text are not sent to Puente. The agent will classify files locally; the owner can correct the metadata in the interface.

Both companies can serve and request documents through the same bridge. Serving and requesting are roles of each operation. Each company and its agent retain these separate capabilities:

| Operation                             | Authority                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Serve its own documents               | Register sources, classify files, configure batches and sharing, and decide incoming requests with its owner credential.                |
| Request the other company's documents | Use a bridge credential identifying its own company as requester; access depends on the document owner's purposes, rules and decisions. |

For example, company A can request B's incorporation document while B requests A's tax certificate through the same bridge. Neither request grants authority to administer the other company's workspace. Returning documents remains optional, and an offer requires its own authorization before transfer.

The same agent can perform both roles. It will retain its permanent owner credential separately from each temporary bridge token. In **Bridges**, **Code for my agent** identifies the current company as requester; **Code for partner** identifies the other company. When MCP is configured with an owner Authorization header, the agent will pass the bridge token explicitly in the `token` argument for counterpart calls. That argument takes precedence over the header.

An approved request returns a direct-transfer descriptor and an Ed25519 authorization receipt. The source and recipient then establish their WebRTC connection. The receiver verifies the expected byte length and SHA-256 before saving. A receipt alone does not prove receipt of the original; successful reception is recorded separately as a receiver-reported event.

## Document batches and exceptions

You will create a batch to group documents under the same sharing settings: existing permission policies or approval for every request, plus all configured purposes or a selected subset. Each document can inherit its batch settings or use an individual override. An empty selected-purpose list allows no requests. Financial documents continue to require approval.

Changing sharing settings, moving a document or changing its classification invalidates earlier requests and counterpart transfer permissions. A new request is required. Recent activity and pending requests appear in the notification bell at the upper right.

## Permission lifetimes

| Credential          | Lifetime                                                 | Purpose                                    |
| ------------------- | -------------------------------------------------------- | ------------------------------------------ |
| Human session       | 30 days from login, or until logout                      | Workspace administration                   |
| Owner agent `po_`   | Until its creator or the agent revokes it                | Operate only the owner's workspace         |
| Counterpart `pt_`   | Up to 24 hours, bounded by the bridge                    | Request documents under that bridge        |
| Transfer capability | Up to five minutes, bounded by its underlying permission | Establish and complete one direct transfer |

Revoking a bridge does not revoke the owner's agent. Revoking an agent does not revoke a bridge, although that agent can no longer serve its source. Both participants periodically recheck authorization during a transfer. Bytes already received cannot be recalled.

Financial, expired, unclassified and uncovered requests require an owner decision. Routine documents may use explicitly saved rules for approved business purposes. AgentMail routes review messages to the owning workspace's verified contact email. A manual email reply does not grant access.

## Availability

The serving device and connector must stay online during transfer. The browser source stops when its tab closes; the local connector can run independently of the interface. A synchronized Google Drive folder is supported as a local source. Cloud-only Drive OAuth integration is not configured.

This release uses WebRTC with STUN. Restrictive networks that require TURN may prevent a direct connection; the receiver reports a connection failure instead of pretending to deliver a file. No TURN service or persistent Storage fallback is configured. Each source supports up to 30 selected PDFs, each up to 20 MiB.

## Infrastructure

The application runs on Next.js/Vercel. Supabase PostgreSQL stores verified user memberships, metadata, rules, bridges, requests, receipts and short-lived signaling. Supabase Auth issues and refreshes identity tokens. AgentMail delivers access codes and review messages.

Production uses the Supabase organization **tuabogadopreferido**, project **puente** (`iuhxutsngsmpzjaklzlp`, `us-west-1`), database **postgres** on PostgreSQL 17. The old private `documents` Storage bucket has been deleted. The database rejects documents containing a storage path or extracted text.

## Development

You will use Node.js 22 or later, install the locked dependencies with `npm ci`, and put your configuration in the ignored `.env.local`. Required server variables are `SUPABASE_SERVICE_ROLE_KEY`, `APP_SIGNING_SECRET`, `APPROVAL_SIGNING_SECRET`, `RECEIPT_PRIVATE_KEY`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` and, for replies, `AGENTMAIL_WEBHOOK_SECRET`. Browser-safe variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_APP_URL`.

You will apply the migrations in `supabase/migrations/` in order, then run `npm run dev`. Migration `email_otp_human_sessions` establishes verified onboarding and the 30-day session boundary. Migration `peer_document_sources` replaces Storage uploads with source metadata and signaling. Existing installations require an explicitly authorized data migration; this project was reset by its owner before the change. Never delete another installation's files as an automatic upgrade.

`npm run lint`, `npx tsc --noEmit` and `npm run build` check the application. The current authentication regression is `node --env-file=.env.local --import tsx scripts/email-auth-verify.ts --execute`. It creates and removes isolated fixtures and does not send email. See [verification evidence](docs/verification.md) for executed tests and their limits.

Historical hackathon Storage/seed tests describe the retired architecture. The legacy seed command is restricted to localhost and must not run against the production MVP. No keys, credentials, live transfer descriptors or private source manifests belong in git.

## Protocol

The MCP endpoint is `/api/mcp` (Streamable HTTP, protocol implementation version 2.0.0). Both permanent owner credentials and current human JWTs are accepted by owner tools; counterparties use bridge tokens. The [live agent guide](https://puente-phi.vercel.app/llms.txt) and OpenAPI specify the contracts.

Owner tools include `register_source`, `register_document`, `correct_document_classification`, `list_document_batches`, `create_document_batch`, `update_document_batch`, `set_document_sharing`, `create_bridge`, `issue_access_code`, `revoke_bridge`, `list_requests`, `decide_request` and `revoke_owner_access`. Counterparts use `exchange_code`, `list_documents`, `request_document`, `get_document` and `get_request_status`. Receipt verification is public for caller-supplied data.

The former upload endpoints and `/api/download` return HTTP 410. Never send PDF bytes or base64 through MCP. The `/receive` page and local receiver connector perform the actual file transfer.
