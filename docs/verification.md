# Verification evidence

Verified on 2026-10-03 using fictional Acme Supplies and Globex Servicios data.

## Database and private originals

Live checks passed: all application tables checked by schema verification use RLS; anonymous reads, browser writes and browser execution of privileged RPCs are denied. Both demo Auth users see all eight seeded documents and no other company's rows; additional owned uploads are permitted. All 16 private PDF originals match their SHA-256. Concurrent code redemption produces exactly one token. Approval action binding, sibling-link consumption, replay denial and revocation passed. A rolled-back regression confirms that an unclassified document cannot create a reusable sharing rule.

## REST and MCP transport

The real MCP SDK Streamable HTTP client passed seven integration groups against both the local app and the deployed https://puente-phi.vercel.app: owner Auth and actor scope; MCP initialization/discovery/exchange; tenant isolation and injection-shaped input rejection; original PDF, extracted text and Ed25519 receipts; financial owner approval; expired/unlisted-purpose escalation; immediate revocation of REST, MCP and an already-issued download ticket. Tampered receipts fail verification. Temporary records were removed. This proves the protocol path independently of an LLM.

## Claude-driven MCP run

Status: **BLOCKED by Gateway model entitlement**.

Native Vercel OIDC was provisioned and the Gateway model catalog returned the tested Claude slugs. Tiny inference requests returned these results:

| Model | Provider response |
| --- | --- |
| anthropic/claude-sonnet-5.5 | HTTP 403, GatewayInternalServerError: free-tier access denied; paid credits required |
| anthropic/claude-sonnet-5 | HTTP 403, same entitlement restriction |
| anthropic/claude-sonnet-4.6 | HTTP 403, same entitlement restriction |
| anthropic/claude-haiku-4.5 | HTTP 403, same entitlement restriction |
| anthropic/claude-3-haiku | HTTP 500, Internal Server Error |

No model-driven completion is claimed. The ready-to-run `scripts/claude-mcp-verify.ts` uses a credential-free local tool harness: Claude chooses `exchange_code`, `list_documents`, `get_document` and `download_original`, while the harness retains all one-time codes, bearer tokens and signed download tickets locally. The original PDF and receipt are validated in that harness. Neither credentials nor extracted document text enter model tool results.

After model access is available, run `node --import tsx scripts/claude-mcp-verify.ts`. It loads ignored environment files with Next.js and performs an inference preflight before creating any test state. A successful run will update this evidence with the actual model, tool sequence and verified SHA-256. The verifier removes its fresh bridge and temporary rows and never logs codes, tokens, prompts, document text or model responses.

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

The test revoked and removed its temporary bridge, request, links, tokens, events and receipt in `finally`. Credentials and live tokens remained only in process memory. The single email remains in the reviewer mailbox with consumed links. No Gmail credentials were copied into the repository or deployment. This verifies the operator-run SMTP fallback, not automatic AgentMail delivery or inbound email replies. Manual response uses the signed page.

## Secret handling and production dependencies

A scan of all 84 Git-history blobs then present found no exact matches for the five configured private values. The production HTML and nine browser scripts were checked against those values with no matches. Environment files and work files remain ignored; the local environment file has mode 600. The production dependency audit reported zero vulnerabilities. These checks supplement the source review and are limited to the scanned values and dependency advisory database.
