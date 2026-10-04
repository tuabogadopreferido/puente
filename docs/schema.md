# Puente database contract

Puente uses PostgreSQL in Supabase project `puente` (`iuhxutsngsmpzjaklzlp`), organization `tuabogadopreferido`, region `us-west-1`. Supabase Auth maintains user identities. The database contains account, catalog, permission and coordination metadata. It contains no original PDFs or extracted document text; the former `documents` Storage bucket and upload-session RPCs have been removed.

All identifiers are UUIDs unless noted. Timestamps are `timestamptz`; document expiration is a `YYYY-MM-DD` date or null. The API resolves ownership from verified credentials before using its server-side service-role client. Browser roles cannot mutate tables directly.

## Tables

| Table                     | Data and constraints                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companies`               | Workspace name, nullable `tax_id`, verified owner contact email.                                                                                                                        |
| `company_members`         | Auth user, company, owner role; the login flow maintains one private workspace per user.                                                                                                |
| `email_login_challenges`  | Email, display name, HMAC fingerprints for code and IP, Auth user, state, attempt counter and ten-minute expiry. No plaintext code.                                                     |
| `human_sessions`          | Supabase Auth session ID and user, fixed creation time plus exactly 30 days, nullable revocation time.                                                                                  |
| `owner_agent_connections` | User/company, label, SHA-256 credential hash, creation and revocation times. No expiry.                                                                                                 |
| `purposes`                | A company's closed list of permitted business-purpose IDs and names.                                                                                                                    |
| `document_sources`        | Company/user, optional durable owner connection or human session, source label and heartbeat deadline. No local path, Drive credential or file contents.                                |
| `documents`               | Company, title, document type, expiration, sensitivity, SHA-256, size, source ID and opaque source key; classification source; optional batch, sharing override and revision.           |
| `document_batches`        | Company-scoped name, sharing settings, policy revision and creation time.                                                                                                               |
| `rules`                   | Company, optional counterparty, document type and purpose for routine automatic approval.                                                                                               |
| `bridges`                 | Two companies, active/revoked status and deadline no more than 24 hours from creation.                                                                                                  |
| `access_codes`            | Hashed single-use bridge code, acting company, expiry and consumption time.                                                                                                             |
| `agent_tokens`            | Hashed counterpart credential, acting company, bridge and expiry capped by the bridge.                                                                                                  |
| `requests`                | Owner/requester, bridge, document, purpose, captured sharing revision, approval status/reason, optional return offers, manual response and approval-mail identifiers.                   |
| `receipts`                | Owner/receiver, signed authorization payload, Ed25519 signature and public key.                                                                                                         |
| `peer_transfers`          | Hashed recipient capability, document/source/receipt IDs, expected hash, recipient authorization scope, five-minute maximum expiry, state and bounded SDP offer/answer. No file chunks. |
| `access_events`           | Owner/actor, optional bridge/document, action and structured audit detail.                                                                                                              |
| `approval_links`          | Hashed approval capability, request, action, expiry and consumption time.                                                                                                               |
| `invitations`             | Hashed invitation capability, inviter, verified recipient email, company/purpose/optional offers, acceptance status and resulting bridge.                                               |

The `documents_metadata_only` database constraint requires `storage_path IS NULL`, `extracted_text = ''`, and non-null source ID, source key and byte count. Those two legacy columns remain solely for schema compatibility. A PDF is limited to 20 MiB; Puente no longer parses or classifies the original on its server.

Document types are `tax_status`, `tax_compliance`, `incorporation`, `power_of_attorney`, `bank_cover`, `proof_of_address`, `repse`, `representative_id`, `balance_sheet`, `income_statement`, `tax_return`, and `other`.

## Email login and session boundaries

The person supplies a name and email. Supabase generates the one-time email code; Puente sends it through AgentMail and verifies it with Supabase Auth. `reserve_email_login`, `claim_email_login` and `finish_email_login` serialize rate limits, verification attempts and account setup. Verification permits at most six attempts, codes expire after ten minutes, and each challenge can be consumed once.

Successful verification creates a private workspace when needed, records the verified email and initializes four business purposes. It then binds `human_sessions` to the verified Auth `session_id`. Refreshing a Supabase access token retains this session ID and cannot extend its fixed 30-day deadline. Server authorization and restrictive RLS policies both require a current, unrevoked human session. Logout revokes that session; it does not revoke durable owner-agent credentials.

Human sessions, durable owner credentials and counterpart bridge credentials have independent lifetimes. A `po_` owner credential has no automatic expiry. A `pt_` counterpart credential is limited to its bridge, which lasts at most 24 hours. Owner membership and explicit connection revocation remain prerequisites on every durable-agent operation.

## File sources and transfers

A browser retains the selected `File` objects while its source tab stays open. The local Node connector retains originals on the owner's computer and stores only paths, hashes and opaque source identifiers in its private local manifest. A synchronized Drive folder can be used through that filesystem. Cloud Drive OAuth is not implemented.

`POST /api/sources` registers or resumes a source. `POST /api/sources/documents` registers metadata after the source computes SHA-256 locally. An identical company/hash/size registration reconnects the existing catalog document to the new source without resetting its classification or sharing settings. Changed bytes need a new source key and document version. Source polling refreshes a 45-second presence deadline and returns only authorized transfer offers for that authenticated source.

An approved request produces an Ed25519 authorization receipt and a random recipient transfer capability. Only its hash is stored. The transfer lasts at most five minutes and never beyond the recipient's current bridge or owner authorization. Its browser link carries the capability in a URL fragment; API calls transmit it in the Authorization header. The response contains metadata and a transfer descriptor, never extracted text or PDF bytes.

The recipient and source exchange bounded SDP through `/api/transfers/{id}` and `/api/sources/{id}`. Ordered WebRTC data channels carry the original directly between peers in 16 KiB chunks. SHA-256 and exact size are verified by the recipient before offering a download or writing the local destination. HTTP endpoints and Supabase Storage never carry those file bytes.

Every coordination check revalidates the source owner credential/session and the recipient's independent authorization. Counterpart transfers additionally validate the receipt's approved request and current sharing revision. The connector rechecks while transferring; a final authorization check is required before completion. Bytes already received cannot be recalled.

`complete_peer_transfer` commits the receiver-reported completion event and signaling cleanup atomically and idempotently. A signed receipt proves what Puente authorized; the completion report is not independent proof that a human read the document. Owner self-access uses `scope: owner` and no bridge. Current owner events include `owner_peer_transfer_authorized` and `peer_document_received`; historical owner event names remain allowed by the audit constraint.

A `pg_cron` job clears expired signaling once per minute, including when the source is disconnected, and deletes transfer rows more than 24 hours past expiry. Receipt and audit records remain. STUN is configured for peer discovery. No TURN service is provisioned by default; some network combinations therefore cannot connect. The Node connector can use privately supplied ICE configuration.

## Batch and document sharing

Sharing settings contain `mode` (`rules` or `approval`) and `allowed_purpose_ids`. A null purpose list permits all purposes already in the company's closed list; an empty list permits none. An unknown or missing purpose cannot obtain document access.

A document inherits its batch settings unless it has an explicit override. Unbatched documents use the default rule mode with all company purposes. A per-document override takes precedence over its batch. Rule mode still requires the existing routine-document, sensitivity, expiry, counterparty and purpose checks; approval mode always creates a pending owner decision.

`save_document_batch` and `set_document_sharing` serialize changes per company, validate every document/purpose/batch against that company and recheck the owner's durable connection or human session. No original bytes change. Public requests capture the effective revision as `document-revision:batch-or-override:batch-revision`. The unbatched initial value is `0:none:0`.

Changing effective sharing settings invalidates previously approved requests and their active transfer capabilities. Request creation, approval, polling, delivery and peer authorization enforce the current purpose and revision. The receiver must submit a new request after such a change. Internal owner access remains independent of counterpart sharing policies.

## Authorization, approvals and invitations

RLS scopes owner-readable metadata by company and additionally enforces human-session expiry. Credential, challenge, invitation, source, transfer and batch tables have no direct browser grants; authenticated APIs provide scoped results. `access_events`, `requests` and `bridges` participate in Supabase Realtime under those owner policies.

`redeem_access_code` consumes a valid single-use code and inserts its scoped counterpart token in one transaction. `resolve_access_request` and `consume_approval_link` lock requests, consume approval capabilities and invalidate sibling links. GET navigation only inspects an approval; an explicit POST resolves it. Return offers are optional. Sensitive documents still require owner approval, even when routine documents have an automatic rule.

`accept_company_invitation` validates the invited user's confirmed email, creates or reuses the private workspace, and creates a 24-hour bilateral bridge without automatic sharing rules. Invitation capabilities grant no document access by themselves.

Mutation RPCs execute as `SECURITY INVOKER`, with execution revoked from PUBLIC, anon and authenticated and granted only to the service role. Private, narrowly scoped `SECURITY DEFINER` helpers read verified Auth email/session state or enforce human-session RLS. Their search paths are empty; Auth-reading helpers additionally require the service-role claim.

## Classification metadata

`correct_document_classification` over MCP and `PATCH /api/documents/{id}` use the same owner-scoped function. They accept document type, sensitivity and/or expiration, reject unknown fields, recheck ownership and apply an optimistic type/sensitivity comparison. Financial types remain sensitive; routine onboarding types remain routine. An `other` classification retains the owner's sensitivity choice.

Classification changes do not move the original, alter its SHA-256 or expose document contents. The owning agent will inspect and classify its local original, then update Puente's metadata. Retired upload endpoints and stored-file download endpoints return 410; their old Storage/RPC capability flow is unavailable.
