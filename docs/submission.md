# Puente: submission copy

## Project title

**Puente: private corporate document exchange for agents**

## Short pitch

Puente lets agents exchange original company PDFs through purpose-bound, revocable permissions, with reciprocal offers and a signed receipt for every delivery.

## Project description

Businesses repeatedly exchange the same corporate documents for vendor onboarding, contracts and compliance. Those exchanges leave companies without a consistent record of who received each file, for what purpose, or under which permission.

Puente keeps each company's dossier in private storage and connects business partners through a bilateral permission called a bridge. An agent redeems a one-time code, declares a purpose from the owner's approved list, and offers its own company's documents in return. Owner rules authorize routine requests. Financial documents, expired files without a current replacement, unknown classifications, unlisted purposes and unmatched rules require a human decision.

Every authorized delivery includes the unchanged original PDF, extracted text and an Ed25519-signed receipt containing the file's SHA-256 fingerprint, recipient, bridge, purpose and delivery time. The owner sees access events through Supabase Realtime. Revocation blocks future agent calls and previously issued download links; it does not remove copies that a recipient has already downloaded.

MCP, REST with OpenAPI, and an llms.txt guide expose the same authorization core to different agents and models. Owners use the web dashboard or an internal agent authenticated with their Supabase session. Mexico is the first market, demonstrated with fictional Acme Supplies and Globex Servicios dossiers; the interface and developer documentation are in English.

The live demo exercises reciprocal exchange, routine authorization, a financial-document exception, owner approval, receipt delivery and immediate revocation. Seeded documents remain explicitly labeled owner-reviewed. Two separate production uploads were correctly classified by Claude Opus 5.5 through direct Anthropic, including their expiry and financial sensitivity; both original PDFs and signed receipts were verified.

Automatic AgentMail escalation also delivered a real review message with three signed decision links to the configured Gmail mailbox, where it arrived in Spam. Its fresh seven-check production roundtrip passed: signed-link approval, original delivery, SHA-256 and Ed25519 verification, replay rejection, revocation and cleanup. The operator-run local SMTP fallback previously passed too. Manual responses are available through the dashboard and signed page.

## How Supabase is used

Supabase is the application's operational core:

- **Postgres** stores companies, memberships, purposes, policies, bilateral bridges, document metadata, requests, receipts and audit events. Atomic database functions consume single-use codes and approval links.
- **Auth** verifies company owners. Database membership determines their authorization scope.
- **Private Storage** preserves original PDFs. The application verifies authorization and file integrity before serving original bytes.
- **Row Level Security** isolates company data; browser users have scoped reads and cannot write directly to the protected tables.
- **Realtime** updates the owner's dashboard when access and request events occur.

## Tools used

| Tool or service | Role |
| --- | --- |
| Supabase | Postgres, Auth, private Storage, RLS, Realtime and atomic authorization functions |
| Vercel | Production deployment of the Next.js application and its server endpoints |
| Next.js, React and TypeScript | Human dashboard and shared REST/MCP application logic |
| Model Context Protocol | Model-independent agent tools for document access and owner administration |
| Vercel AI SDK | Direct Anthropic classification; optional AI Gateway configuration when no direct key is set |
| Claude Opus 5.5 | Direct Anthropic with workspace routing and low effort; two production PDF classifications passed |
| AgentMail | Automatic production review email and three decision links verified; inbound webhook registration is blocked by missing permissions |
| Local SMTP helper and read-only IMAP | Verified operator-run review notification, signed-link approval and original delivery; separate from application mail automation |
| unpdf | PDF text extraction |
| pdf-lib | Creation of the clearly labeled fictional sample PDFs |
| Node.js crypto | SHA-256 fingerprints, Ed25519 receipts and signed, expiring application tokens |
| Codex and Claude | Development assistance |

## Links

- **Live demo:** [https://puente-phi.vercel.app](https://puente-phi.vercel.app)
- **Public repository:** [https://github.com/tuabogadopreferido/puente](https://github.com/tuabogadopreferido/puente)
- **Agent guide:** [https://puente-phi.vercel.app/llms.txt](https://puente-phi.vercel.app/llms.txt)
- **MCP endpoint:** [https://puente-phi.vercel.app/api/mcp](https://puente-phi.vercel.app/api/mcp)
- **OpenAPI:** [https://puente-phi.vercel.app/api/openapi](https://puente-phi.vercel.app/api/openapi)
- **Screenshots:** [Repository screenshots](https://github.com/tuabogadopreferido/puente/tree/main/docs/screenshots)
- **Video:** `[pending: Roberto will record and provide the final video URL]`

Published screenshots contain fictional document metadata, public receipt information and interface state. Access tokens, one-time codes, live decision links and private signing material are excluded.

## Public reviewer accounts

| Company | Email | Public demo password |
| --- | --- | --- |
| Acme Supplies S.A. de C.V. | `acme@puente.demo` | `PuenteDemo2026!` |
| Globex Servicios S.A. de C.V. | `globex@puente.demo` | `PuenteDemo2026!` |

The reviewer will select **Try the live demo** to enter Acme's workspace, or use either account above. These accounts and all stored sample documents are fictional and deliberately public for judging.

## Reviewer walkthrough

1. The reviewer will open **Bridges**, create a fresh bridge to Globex and generate a one-time access code. This will avoid interference from another visitor's use of the shared demonstration bridge.
2. In **Agent playground**, the reviewer will exchange the code, choose **SAT compliance opinion** and purpose **Alta como proveedor**, then select at least one Globex document to offer. **Request original PDF** will return the original, extracted text and signed receipt.
3. The reviewer will request **Balance sheet 2026** to trigger human review. From **Requests**, Acme's owner will approve it; after returning to Agent playground, **Check owner decision** will retrieve the delivery.
4. In **Activity**, the reviewer will inspect the recorded exchange before revoking the bridge and selecting **Check access** in the playground. The application will reject further access through that bridge.

The playground sends real REST requests and uses the same decision logic as MCP. It is not a simulated model conversation. A compatible MCP client can connect through the endpoint and configuration documented in the README.

## Current verification boundaries

- **Claude classification passed in production.** Two new synthetic PDFs returned the expected type, expiry and sensitivity through direct Anthropic using Claude Opus 5.5. Private Storage and HTTP delivery preserved their original bytes and SHA-256, and both Ed25519 receipts verified. Seeded files still display **Owner reviewed**. Earlier Gateway HTTP 403 results are historical and do not describe the current direct-Anthropic classifier.
- **Automatic AgentMail delivery is verified.** The production configuration sent a real review message with all three signed links; Gmail placed it in Spam. The fresh AgentMail roundtrip passed seven checks covering actual delivery, signed links, approval, original integrity, signatures, replay rejection, revocation and cleanup. Its message was received on 2026-10-03 at 15:04:59 CST (UTC-6). The earlier operator-run SMTP fallback also passed.
- **MCP protocol and model behavior have separate evidence.** The real MCP SDK passed seven core integration groups. The Claude-driven run completed `exchange_code` but stopped on the second model step with Anthropic `finishReason: content-filter`; a complete Claude-driven MCP exchange is not claimed.
- **Manual responses work through the dashboard and signed review page.** AgentMail webhook registration returned HTTP 403 (`missing_permission`) for `webhook_create` / `webhook_read`, so inbound email replies remain blocked and unverified. A manual response does not authorize document delivery.
- **Auth signup mail remains a separate dependency.** The review-email evidence does not establish Supabase Auth confirmation delivery. Custom Auth SMTP is not configured; new external mailbox signup remains unverified, while the confirmed fictional demo accounts can exercise invitation acceptance.
- **Video submission is pending.** Roberto will record and provide the final video URL.
