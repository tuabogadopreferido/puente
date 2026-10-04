# MVP verification evidence

Current architecture: passwordless accounts, metadata-only catalog and direct WebRTC file transfers. Historical evidence below concerns the retired storage-based prototype and does not establish current functionality.

## Current checks, 4 October 2026

- Email authentication: 8 integration groups pass. These cover native Supabase OTP verification, fixed 30-day sessions, tenant isolation, replay and rate limits, logout, and independence from owner-agent credentials. An email-only sign-in preserves an existing account's profile.
- Real AgentMail transport: a code sent to the project's own inbox was retrieved from its sent message and successfully verified. This confirms sender acceptance and the code flow; delivery to a separate external inbox has not been asserted.
- Direct transfers: 11 local integration groups pass against the live metadata database. Owner and counterpart receivers each receive 20 MiB with matching SHA-256. Bad secrets, foreign tenants, premature acknowledgement, revoked access, offline sources and changed document sharing settings are rejected. Duplicate completion frames and acknowledgements do not create duplicate receipt events.
- Native browser: a synthetic PDF was received from a second browser tab with SHA-256 verification. No PDF bytes were uploaded to the application or Storage. The saved PDF in the local Downloads directory had the exact original SHA-256.
- Batch settings: 9 integration groups pass, including inheritance, overrides, purpose restrictions, cross-tenant rejection, stale approvals and revoked owner access. Native UI creation with document selection succeeded.
- Cleanup removed the old 17 originals, demo companies and demo Auth users. The Storage bucket was removed. Test harnesses delete their fixtures.
- Expired peer signaling is cleared by the database cleanup job. Peer-transfer completion is atomic and clears signaling once acknowledged. A receipt records authorization; the subsequent receiver event records reported completion.

Production deployment `puente-pj6bhxsqw` at application commit `7440d79` passed all 11 direct-transfer groups. The real MCP SDK passed five more groups against production: four batch tools, bearer/header handling, counterparty rejection, foreign document isolation, and revocation. The browser signed in on the production domain using the code sent by AgentMail, showed Create account and email-only Sign in, and opened the new dashboard. OpenAPI returned 35 paths with the production origin. Both local and Vercel production builds, TypeScript and ESLint passed.

Security advisors returned ten informational entries for intentionally service-only tables with RLS and no browser grants. The remaining leaked-password warning does not cover this passwordless flow; native password sign-in cannot obtain a Puente human-session allowlist entry. No password route is exposed by the application.

 Browser-to-browser transfer needs the source online. There is no hosted TURN relay and no cloud-only Drive OAuth integration; synchronized Drive folders work through the local connector.

## Bilateral company roles

On 2026-10-04, `scripts/bilateral-verify.ts --execute` passed five integration groups against production. Two MCP clients retained their owner credentials in their Authorization headers and used explicit bridge-token arguments to request from each other through the same bridge. Both directions required the actual document owner to approve, rejected self-approval and foreign metadata/sharing changes, and accepted requests with no reciprocal offers. Each PDF arrived over WebRTC with its original SHA-256. Returning to an owner call preserved each company’s own scope. Temporary records and users were removed; no notification email was sent by this test.

Application commit `424c1c1`, deployed as `puente-1l57d9jst`, makes the requesting company explicit when generating a code and distinguishes incoming decisions from outgoing status. The live agent guide and copied instructions describe both roles and the independent credential lifetimes. Local and Vercel production builds and ESLint passed. The authenticated production UI showed both code directions, an incoming request with Approve/Decline, and an outgoing request with status only. The temporary browser verification account and its fixtures were subsequently removed.

## Historical prototype evidence

The following observations are retained as history. Do not run its seed or storage-based harnesses against the current MVP database.


Verified on 2026-10-03 using fictional Acme Supplies and Globex Servicios data.

## Database and private originals

Live checks passed: all application tables checked by schema verification use RLS; anonymous reads, browser writes and browser execution of privileged RPCs are denied. Both demo Auth users see all eight seeded documents and no other company's rows; additional owned uploads are permitted. All 16 private PDF originals match their SHA-256. Concurrent code redemption produces exactly one token. Approval action binding, sibling-link consumption, replay denial and revocation passed. A rolled-back regression confirms that an unclassified document cannot create a reusable sharing rule.

## REST and MCP transport

The real MCP SDK Streamable HTTP client passed seven integration groups against both the local app and the deployed https://puente-phi.vercel.app: owner Auth and actor scope; MCP initialization/discovery/exchange; tenant isolation and injection-shaped input rejection; original PDF, extracted text and Ed25519 receipts; financial owner approval; expired/unlisted-purpose escalation; immediate revocation of REST, MCP and an already-issued download ticket. Tampered receipts fail verification. Temporary records were removed. This proves the protocol path independently of an LLM.

## Claude-driven MCP run

Status: **BLOCKED**.

Model: `claude-opus-5-5`. Provider: `claude_anthropic`. Effort: `low`. Endpoint: `https://puente-phi.vercel.app/api/mcp`.

The real run completed MCP `exchange_code`. The following model turn returned `finishReason: content-filter` with zero output tokens, tool calls or tool errors. The installed Anthropic provider maps native `stop_reason: refusal` to this reason. No complete model-driven download is claimed and no further inference was attempted after the refusal was identified. The separate MCP SDK end-to-end checks above remain valid. Temporary bridge and test rows were removed.

No model-driven completion is claimed.

The harness keeps the one-time code, agent bearer token and signed download ticket locally. Claude receives credential-free tool schemas and an opaque original handle; the harness forwards real MCP calls and verifies returned bytes. Neither credentials nor extracted document text enter model prompts or tool results.

Reproduce with `node --import tsx scripts/claude-mcp-verify.ts` after the configured Claude provider is accessible. The script loads ignored environment files with Next.js and removes its fresh bridge and test rows. It never prints prompts, document text or model responses.

## Authenticated Realtime

`scripts/realtime-verify.ts` passed with two real Supabase Auth subscriptions: the owner received its inserted access event through Postgres Changes, while the other company subscribed to the same owner filter received no event. The temporary bridge and event were removed. This tests delivery and RLS isolation through the live Realtime transport.

## Invitation readiness

Signed-link creation and verified-user invitation acceptance passed integration tests, including the deployed production endpoints. Production checks rejected unauthenticated creation, tampered signatures and the wrong recipient email; the correct confirmed recipient accepted, and a retry returned the same bridge. Inspection returned only the six allowed metadata fields. No mail was sent, no rules or document requests were created, and the temporary invitation, bridge and events were removed. Acceptance requires the exact confirmed email and grants no automatic document access. Supabase Auth now uses the production app as its site URL with explicit production/local invitation redirects; email confirmation remains enabled.

Custom Supabase Auth SMTP is not configured. Its default sender is restricted to project-team addresses, so signup and confirmation by a new external mailbox have not been verified and require Auth SMTP before that path is ready. The existing confirmed fictional demo accounts can still exercise acceptance. This limit is separate from AgentMail invitation or approval mail. [Supabase Auth SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

## Public discovery and final review

The deployed health endpoint returned success. OpenAPI 3.1 serves 21 paths with the production origin, declared path parameters and separate counterparty, owner and invitee authentication schemes. The deployed agent guide includes owner and invitation flows. Final source review found no additional blocking authorization defect in those paths. Pattern scans of tracked files and Git history found no private keys or known token formats; this is a pattern check, not a complete secret audit.

## Classification correction policy

The HTTP regression `scripts/document-policy-verify.ts` passed 34 checks against a newly created temporary metadata row. All eight supplier-onboarding types remain nonsensitive, all three financial types remain sensitive, and `other` retains the owner's choice. Partial PATCH requests use the stored document type. The endpoint accepts a real leap day, rejects impossible calendar dates and malformed UUIDs, and denies another company's correction. Cleanup removed the temporary row; public fixtures were unchanged. The dashboard modal was also checked in the local browser without saving: the sensitivity control follows the selected type and is editable only for `other`.

## SMTP approval roundtrip

The optional local SMTP fallback passed seven checks against the deployed application. One real notification was sent to the configured reviewer and found through a read-only IMAP lookup. All three links had authentic signatures and the correct request/action binding; visiting the pages left the request pending. An explicit approval POST allowed the original fictional financial PDF to be retrieved with matching SHA-256 and a valid Ed25519 receipt. Financial approval did not create a reusable rule. Reusing the approval or either sibling link failed, and bridge revocation blocked the agent token and previously issued download URL.

The test revoked and removed its temporary bridge, request, links, tokens, events and receipt in `finally`. Credentials and live tokens remained only in process memory. The single email remains in the reviewer mailbox with consumed links. No Gmail credentials were copied into the repository or deployment. This section documents the operator-run SMTP fallback. Production AgentMail approval and inbound-reply evidence appear in their separate sections below.

## Secret handling and production dependencies

After the Anthropic and AgentMail deployment, all 152 Git-history blobs then present and the tracked or unignored working files were scanned against seven configured private values, including both new API keys, with no exact matches. The production HTML and nine browser scripts were checked against those values with no matches. Environment files and work files remain ignored; the local environment file has mode 600. The production dependency audit reported zero vulnerabilities. These checks supplement the source review and are limited to the scanned values and dependency advisory database.

The final production deployment also passed all 34 document-policy HTTP checks. Its temporary metadata row was removed and all seeded documents remained unchanged.

## Live Claude document classification

Status: **PASS**. Production endpoint: https://puente-phi.vercel.app. Upload calls: 2/2. Cleanup: **PASS**.

Two new synthetic PDFs were uploaded through the real owner API. Both returned `claude_anthropic`, with the expected content-derived type, explicit expiry semantics and financial sensitivity. Metadata, private Storage and authenticated owner delivery preserved each original byte-for-byte and matched its SHA-256; both Ed25519 receipts verified.

| Sample | Source | Type | Expiry | Sensitive | Original hash |
| --- | --- | --- | --- | --- | --- |
| compliance opinion | claude_anthropic | tax_compliance | 2026-12-31 | false | PASS |
| financial balance sheet | claude_anthropic | balance_sheet | none | true | PASS |

The script made no inference preflight and retried no uploads. The direct-only classifier deployment must be confirmed before execution to keep the total at two inference calls. Tokens, PDFs and signed download URLs stayed in memory; logs and this section contain no credentials or document content. Cleanup targets only this run's unique document titles and their originals, receipts, events and request traces. No bridge is read or changed, and the eight seeded Acme records are checked for changes.

Reproduce only after deployment readiness with `node --import tsx scripts/claude-classification-verify.ts --execute`. Without `--execute`, the script exits without network calls.

## AgentMail production approval roundtrip

Status: **PASS, delivered to Spam**. A fresh production request sent one real review notification on 2026-10-03 at 15:04:59 CST (UTC-6). `scripts/agentmail-demo-verify.ts` passed seven checks: automatic application dispatch; AgentMail readback matching the configured reviewer, thread and three signed actions; read-only Gmail confirmation in Spam; non-mutating review-page GETs; approval POST followed by original financial PDF SHA-256 and Ed25519 verification; rejection of consumed/sibling links and revocation of both token and issued download URL; and removal of all temporary bridge records. Financial approval created no reusable rule. No Gmail credentials were added to Puente or Vercel.

An earlier message reached Spam too; the first verifier checked only All Mail/Inbox and stopped before approval. Its temporary records were removed. The corrected reader discovers folders through IMAP flags, matches the exact Message-ID, and reports delivery location separately from the approval flow. Both test messages remain in the reviewer's mailbox with invalidated test links; no mailbox settings were changed.

The initial inbox-scoped key permitted message reading and sending but returned HTTP 403 with `code: missing_permission` when creating the production `message.received` webhook; inbox metadata and webhook listing were also forbidden. This earlier configuration blocker was resolved with a new production key scoped to the single Puente inbox and granting message read/send plus webhook read/create permissions. The enabled webhook and real inbound reply were then verified as described below.

Twelve offline checks in `scripts/agentmail-verify.ts` passed for concurrent notification claims, idempotency, uncertain delivery, signature/timestamp rejection, inbox/sender/thread/reply binding, unsafe labels, omitted-body retrieval, duplicate replies and transient database failures. These offline tests complement the real inbound-webhook test below.


## AgentMail inbound manual-reply roundtrip

Status: **PASS, nine production checks**. `scripts/agentmail-reply-verify.ts --run` sent one review notification on 2026-10-03 at 16:04:35 CST (UTC-6) and one actual manual reply. Puente recorded the applied response at 16:04:46 CST (UTC-6), the verifier's `manual_applied_at_cst` value; this is not the reply's send timestamp. The production `message.received` webhook was enabled for the single configured inbox. Its new scoped key and signing secret were configured in production; local credentials remained in the ignored environment file with mode 600, and deployment values were stored as sensitive variables.

The test verified the notification recipient, thread and three authentic decision links, then confirmed that GET previews left the request pending. A reply sent through the external SMTP helper retained the original reply headers. AgentMail received it on the matching thread, and the real provider webhook recorded its exact manual text. Polling returned no download URL, extracted text, SHA-256 or receipt; the database contained no approved request or delivery receipt for that temporary bridge.

All three decision links were consumed, and attempts to reuse any action were rejected. Revoking the temporary bridge disabled its agent token. Cleanup removed only the fresh test records; the shared demonstration bridge and seeded documents were preserved. No document was released by the manual response. The earlier approval test separately verifies authorized original delivery and download-link revocation.

The verified deployment is available at [puente-phi.vercel.app](https://puente-phi.vercel.app). This resolves the earlier AgentMail permission blocker; the Claude-driven MCP provider refusal remains unresolved. Supabase Auth signup email still requires its separate SMTP configuration.

This verifier is opt-in: review its source and obtain authorization for one notification and one reply before running it. The external helper retains Gmail credentials locally. Logs omit live links, credentials and reply content. The script attempts revocation and removal of correlated temporary records in `finally`; cleanup passed in the reported run. If bridge creation was attempted without a confirmed ID, it reports the creation and cleanup outcomes as unknown and requires inspection before another run. It does not search for or delete uncorrelated rows.


## Large PDFs, multiple requests and optional offers

Status: **PASS** in production on 2026-10-03 17:20 CST (UTC-6). Deployed source commits: `c30a2c5` and `88c075b`.

The opt-in `scripts/large-pdf-verify.ts --execute` passed eleven checks using a generated PDF of slightly more than 16 MiB. It tested initialization authorization and the 20 MiB limit; private owner-bound upload sessions; direct signed upload into the private bucket; concurrent completion and idempotent replay; real Claude classification as `tax_compliance`; original-byte SHA-256 and signed receipts through both owner and counterparty streaming downloads; rejection of forged PDF content; already-issued download denial after bridge revocation; omitted and empty offers; and rejection of another company's offered document. Cleanup removed this script's sessions, objects, document rows, bridge and traces. All sixteen seeded records were unchanged. No actual user PDF was read, uploaded or classified for this test. No review email was sent.

A separate production browser check confirmed **Select all** selects all nine visible documents and **Clear all** resets the selection. A two-document request for the seeded tax registration and SAT compliance samples returned two independent delivered results with all return-offer checkboxes empty. Those two deliberate UI test requests remain visible in the existing demo bridge's audit history. The browser test did not request the user's additional PDF, the financial document or the expired document.

The upload dialog now validates the 20 MiB limit and PDF header before submission, shows each transfer/classification phase and renders failures inside the dialog. The browser retains its upload session in memory for retries and completion is atomic on the server. Upload capabilities cannot overwrite originals. Abandoned upload cleanup remains an operational follow-up: objects must be retained until the two-hour upload capability expires, plus five minutes; there is no automatic janitor yet.

Invitations also accept zero offers. The production SQL constraint allows 0–100 IDs, and private upload sessions and RPCs remain inaccessible to `anon` and `authenticated` roles. Targeted offline tests, TypeScript, ESLint and the production build passed. This is separate from the still-blocked autonomous Claude/MCP run.

## Durable owner-agent access and independent bridge permissions

Status: **PASS, nine production checks**, 2026-10-03 at 17:52 CST (UTC-6). Deployment: `bc7f86b`, https://puente-phi.vercel.app. `scripts/owner-agent-verify.ts --execute` used two temporary credentials, one isolated bridge and one new synthetic PDF; it sent no review mail.

The deployed management API returned owner credentials once with `Cache-Control: no-store`, persisted only SHA-256 hashes and exposed no token in connection listings. The database has no expiration field for these connections, RLS is enabled, and browser roles cannot read their records. Another company's owner could not revoke them. A connection with a simulated creation date in 2000 remained valid; this verifies that age is not an authorization condition, rather than claiming a real multi-year run.

An actual MCP SDK client prepared an upload, sent raw unchanged bytes to its exact private signed Storage URL without an Authorization or apikey header, and completed classification through real Claude. The result was nonsensitive `tax_compliance` with the supplied `2027-12-31` expiry. Retrying completion returned the same document; both owner and counterpart downloads matched the original SHA-256 and their Ed25519 receipts verified. A counterpart token was denied both owner upload and owner self-revocation.

After `revoke_owner_access`, that credential lost access and its fresh internal download returned `403 connection_revoked`. The existing counterpart download, active bridge and second owner credential remained usable. Revoking the bridge then blocked its counterpart download while the second owner credential continued working. The JWT-authenticated interface endpoint independently revoked the second credential. Cleanup removed both credentials, the synthetic upload, isolated bridge and their traces; all 16 seeded document records remained unchanged.

The production browser panel was checked through **Connect my agent**: it shows company scope and no expiration, offers a named connection and separate instructions, and opens the manual PDF upload dialog in the same company. Credential creation and revocation were exercised through the real API; no browser-created production credential was left for the user. Targeted offline tests additionally checked revocation during upload completion and internal download, token hashing, owner isolation, signed URL validation and replay behavior. TypeScript, ESLint and local/production builds passed.

These checks establish the MCP transport and authorization behavior. The separate autonomous Claude/MCP run remains blocked as described above.

## Owner classification correction through MCP

Status: **PASS**, production https://puente-phi.vercel.app, application commit `073167e` on 2026-10-03 at 18:27 CST (UTC-6). The deployed MCP version 1.3.0 advertises `correct_document_classification`; the public agent guide and OpenAPI describe its input and owner authorization. The existing REST regression passed all 34 checks after both transports were connected to the same correction function.

`scripts/owner-classification-verify.ts --execute` passed eight production groups with actual MCP SDK clients: discovery; all eleven fixed document types and partial sensitivity normalization; owner choice for `other`, valid leap date and explicit expiry clearing; owner tokens in headers and arguments, legacy JWT MCP and durable-token REST parity; rejection of empty, unknown, invalid date/UUID, foreign-company, anonymous and counterpart-prefix inputs without mutation; revoked owner denial while native owner JWT access remained valid; unchanged original Storage bytes/SHA-256, path, title and extracted text; and exact fixture cleanup with all sixteen seed rows unchanged. The counterpart-denial check used a synthetic `pt_`-prefixed credential, rather than creating an external bridge.

The test created two temporary synthetic originals and two owner connections, then removed them. It invoked neither Claude nor email. Offline checks also covered a revocation between read and write, conflict 409 and strict schema extension. TypeScript, ESLint, local/production builds and the seven-configured-secret scan of 107 tracked or unignored files passed. Revocation recheck and metadata update are separate database queries; this test does not establish atomic cancellation of a write already in flight.

Corrections are recorded as `owner_reviewed`, preserving the distinction from AI classification. This capability does not change bridge tokens, download lifetimes, sharing rules or the status of the separate autonomous Claude/MCP run.
