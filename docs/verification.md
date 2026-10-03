# Verification evidence

Verified on 2026-10-03 using fictional Acme Supplies and Globex Servicios data.

## Database and private originals

Live checks passed: all application tables checked by schema verification use RLS; anonymous reads, browser writes and browser execution of privileged RPCs are denied. Both demo Auth users see only their own eight documents. All 16 private PDF originals match their SHA-256. Concurrent code redemption produces exactly one token. Approval action binding, sibling-link consumption, replay denial and revocation passed. A rolled-back regression confirms that an unclassified document cannot create a reusable sharing rule.

## REST and MCP transport

The real MCP SDK Streamable HTTP client passed seven integration groups against the local app: owner Auth and actor scope; MCP initialization/discovery/exchange; tenant isolation and injection-shaped input rejection; original PDF, extracted text and Ed25519 receipts; financial owner approval; expired/unlisted-purpose escalation; immediate revocation of REST, MCP and an already-issued download ticket. Tampered receipts fail verification. Temporary records were removed. This proves the protocol path independently of an LLM.

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
