# Verification evidence

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
