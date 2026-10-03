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
| requests | id, bridge_id, requester_company_id, owner_company_id, document_id, purpose_id (nullable), purpose_text, status (`pending`, `approved`, `denied`, `manual`), reason, offered_document_ids (UUID array), manual_response, email_thread_id, email_message_id, created_at, updated_at |
| access_events | id, company_id (document owner), actor_company_id, bridge_id, document_id (nullable), action, detail (JSON), created_at |
| receipts | id, company_id (document owner), receiver_company_id, payload (JSON), signature, public_key, created_at |
| approval_links | id, token_hash, request_id, action (`approve`, `deny`, `manual`), expires_at, used_at, created_at |

Standard document types: `tax_status`, `tax_compliance`, `incorporation`, `power_of_attorney`, `bank_cover`, `proof_of_address`, `repse`, `representative_id`, `balance_sheet`, `income_statement`, `tax_return`, `other`.

Storage bucket `documents` is private. Object paths use `<company_id>/<document_id>.pdf`; uploaded bytes must remain identical to the original. Browser users receive no Storage policies; original delivery uses a short-lived signed application download ticket. Its endpoint revalidates the bridge and token before returning the original bytes.

## Service-only atomic RPCs

`redeem_access_code(p_code_hash text, p_token_hash text)` consumes one valid code and inserts its 24-hour token in one transaction. It returns `{bridge_id, actor_company_id, expires_at}` or raises an exception for expired, reused, revoked, or malformed credentials. The token deadline cannot exceed the bridge deadline.

`consume_approval_link(p_token_hash text, p_action text, p_create_rule boolean = false, p_manual_response text = null)` locks the request, consumes a matching unexpired link, invalidates its sibling links, updates request status, and returns the request as JSON. Optional rules are added only for valid closed-list purposes and routine, current documents. Every sensitive request still requires its own approval. All RPC EXECUTE privileges are revoked from PUBLIC, anon and authenticated; only service_role can call them.

The API must hash random high-entropy codes, agent tokens and approval tokens with SHA-256 before storing or passing them to an RPC. Browser GET navigation must never consume approval links; the confirmation page submits POST.

## Realtime and authorization

`access_events`, `requests` and `bridges` join the `supabase_realtime` publication. Each subscription uses the signed-in owner's Supabase JWT and RLS. Metadata for a counterpart company is visible only when it participates in the owner's bridge; the counterpart's document rows remain inaccessible.

An active bridge permits either company to request from the other, but does not authorize a document automatically. Every agent call verifies the token, bridge status and expiry, requested owner, document ownership, purpose and rules. Revocation stops subsequent server calls and invalidates previously issued application download tickets because every download rechecks the bridge.

`resolve_access_request(p_request_id uuid, p_owner_company_id uuid, p_action text, p_create_rule boolean = false, p_manual_response text = null, p_token_hash text = null)` provides the same atomic resolution to an authenticated owner (after API ownership verification), or a token holder when a token hash is supplied. Both variants lock the request and invalidate all approval links; a manual response can later be approved or denied by the authenticated owner.
