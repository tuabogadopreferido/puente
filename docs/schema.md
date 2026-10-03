# Puente database contract

All IDs are UUID strings. Timestamps are ISO 8601 timestamptz values; document expiry is a `YYYY-MM-DD` date or null. The server uses the service-role client only after authorization. Dashboard users authenticate through Supabase Auth and can select rows belonging to their company through RLS; browser roles have no direct writes.

| Table | Fields |
| --- | --- |
| companies | id, name, tax_id, contact_email, created_at |
| company_members | user_id (Auth), company_id, role (`owner`), created_at |
| purposes | id, company_id, name, created_at |
| documents | id, company_id, title, document_type, expires_at, sensitive, sha256, storage_path, extracted_text, classification_source, created_at |
| rules | id, company_id, counterparty_id (nullable for any counterparty), document_type, purpose_id, created_at |
| bridges | id, company_a_id, company_b_id, status (`active`, `revoked`), expires_at, created_at |
| access_codes | id, code_hash, bridge_id, actor_company_id, expires_at, used_at, created_at |
| agent_tokens | id, token_hash, bridge_id, actor_company_id, expires_at, created_at |
| owner_agent_connections | id, user_id, company_id, label, token_hash, created_at, revoked_at (no expiry) |
| requests | id, bridge_id, requester_company_id, owner_company_id, document_id, purpose_id (nullable), purpose_text, status (`pending`, `approved`, `denied`, `manual`), reason, offered_document_ids (UUID array), manual_response, email_thread_id, email_message_id, created_at, updated_at |
| access_events | id, company_id (document owner), actor_company_id, bridge_id (nullable for owner self-access), document_id (nullable), action, detail (JSON), created_at |
| receipts | id, company_id (document owner), receiver_company_id, payload (JSON), signature, public_key, created_at |
| approval_links | id, token_hash, request_id, action (`approve`, `deny`, `manual`), expires_at, used_at, created_at |
| invitations | id, token_hash, inviter_company_id, created_by_user_id, invited_email, company_name, purpose_id, offered_document_ids, status (`pending`, `accepted`, `cancelled`), expires_at, accepted_by_user_id, accepted_company_id, bridge_id, accepted_at, created_at |

Standard document types: `tax_status`, `tax_compliance`, `incorporation`, `power_of_attorney`, `bank_cover`, `proof_of_address`, `repse`, `representative_id`, `balance_sheet`, `income_statement`, `tax_return`, `other`.

Storage bucket `documents` is private. Object paths use `<company_id>/<document_id>.pdf`; uploaded bytes must remain identical to the original. Browser users receive no Storage policies; original delivery uses a short-lived signed application download ticket. Its endpoint revalidates the bridge and token for counterpart access, or active owner membership for internal owner access, before returning the original bytes.

## Service-only atomic RPCs

`redeem_access_code(p_code_hash text, p_token_hash text)` consumes one valid code and inserts its 24-hour token in one transaction. It returns `{bridge_id, actor_company_id, expires_at}` or raises an exception for expired, reused, revoked, or malformed credentials. The token deadline cannot exceed the bridge deadline.

`consume_approval_link(p_token_hash text, p_action text, p_create_rule boolean = false, p_manual_response text = null)` locks the request, consumes a matching unexpired link, invalidates its sibling links, updates request status, and returns the request as JSON. Optional rules are added only for valid closed-list purposes and routine, current documents. Every sensitive request still requires its own approval. All RPC EXECUTE privileges are revoked from PUBLIC, anon and authenticated; only service_role can call them.

The API must hash random high-entropy codes, agent tokens and approval tokens with SHA-256 before storing or passing them to an RPC. Browser GET navigation must never consume approval links; the confirmation page submits POST.

## Realtime and authorization

`access_events`, `requests` and `bridges` join the `supabase_realtime` publication. Each subscription uses the signed-in owner's Supabase JWT and RLS. Metadata for a counterpart company is visible only when it participates in the owner's bridge; the counterpart's document rows remain inaccessible.

An active bridge permits either company to request from the other, but does not authorize a document automatically. Every agent call verifies the token, bridge status and expiry, requested owner, document ownership, purpose and rules. Revocation stops subsequent server calls and invalidates previously issued application download tickets because every download rechecks the bridge.

`resolve_access_request(p_request_id uuid, p_owner_company_id uuid, p_action text, p_create_rule boolean = false, p_manual_response text = null, p_token_hash text = null)` provides the same atomic resolution to an authenticated owner (after API ownership verification), or a token holder when a token hash is supplied. Both variants lock the request and invalidate all approval links; a manual response can later be approved or denied by the authenticated owner.

## Owner-agent scope

A signed-in owner will create a named connection from **Connect my agent**. The server returns one random `po_` bearer credential once and stores only its SHA-256 hash in `owner_agent_connections`. The table has RLS and no `anon` or `authenticated` grants. Management routes authenticate the browser's Supabase Auth token and scope metadata and revocation to the creating user and company. MCP bearer credentials cannot create new credentials or revoke another connection.

Owner credentials have no automatic expiry. Each use resolves the hash, rejects a revoked connection and verifies current owner membership. The same authenticated creator may revoke it through the interface; MCP `revoke_owner_access` revokes only the calling connection. Legacy Supabase Auth bearer access remains supported with its own session expiry.

The owner's company scope is independent of counterpart bridge tokens. Revoking an owner connection does not change bridges, access codes, counterpart tokens or their download tickets. Conversely, a bridge's 24-hour expiry or revocation does not expire an owner credential. Caller-supplied company claims never authorize ownership.

Owner self-delivery receipts carry `scope: owner`, the verified user/company IDs, `bridge_id: null` and, for a durable credential, `owner_connection_id`. The separate owner download ticket binds that connection and rechecks membership, connection status and its own 60-second expiry before serving bytes. The `access_events` constraint permits a null bridge only when actor and owner are the same company and the action is `owner_document_delivered` or `owner_pdf_downloaded`.

MCP `prepare_document_upload` issues a private signed Storage URL for a fixed path. The agent will PUT the unchanged PDF bytes to that URL, then call `complete_document_upload`. Completion checks owner authorization again after classification and before publishing metadata. The two-hour Storage capability cannot overwrite an original; revocation prevents completion but does not cancel a previously issued staging capability.

## Company invitations

Invitation tokens are hashed and grant no document access. The `invitations` table has RLS and no browser grants, including no direct owner SELECT because its rows contain token hashes. The authenticated server provides scoped metadata instead.

`accept_company_invitation(p_token_hash text, p_user_id uuid)` runs only as service_role. It atomically validates expiry, locks the invitation, checks the authenticated user's confirmed email against the invited email, creates a company/member and four default privacy purposes if needed, and creates a 24-hour bilateral bridge without automatic sharing rules. Replays by the same accepted user are idempotent; other users cannot consume the invitation.

A private `puente_private.confirmed_invitation_email(uuid)` helper reads the verified Auth email. It is the only SECURITY DEFINER helper, has an empty search path and an explicit service-role check, lives outside the exposed schema, and grants execution only to service_role. Public mutation RPCs remain SECURITY INVOKER.


### Private large-file upload sessions

`document_upload_sessions` binds an upload UUID, company, authenticated owner, filename, expected size, immutable private Storage path, two-hour expiry, processing lease and completion state. Browser roles cannot read or mutate it. Service-only `claim_document_upload` and `finish_document_upload` enforce owner membership, serialize processing and publish document metadata atomically. Originals may contain at most 20 MiB and 80 pages. Requests and invitations may contain zero return offers.
