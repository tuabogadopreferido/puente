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

The live demo exercises reciprocal exchange, routine authorization, a financial-document exception, owner approval, receipt delivery and immediate revocation. Sample documents are explicitly labeled owner-reviewed. Claude classification and AgentMail escalation are integrated, with a working owner-review fallback when those external services are unavailable. A real review email and its signed approval-to-delivery flow were also verified through a local SMTP helper run by the operator; automatic application dispatch through AgentMail remains blocked.

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
| Vercel AI SDK and AI Gateway | Claude document-classification integration |
| Claude | Configured classification provider; live classification is currently blocked by unavailable credits |
| AgentMail | Outbound review and inbound-reply integration implemented; automatic delivery remains blocked and real email replies are unverified |
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

## Current external-service status

The submission must retain these qualifications until fresh evidence confirms the services are working:

- Seeded documents are **owner-reviewed**. Claude inference through AI Gateway has returned HTTP 403 because the required credits are unavailable. The application retains uploads and requests owner review instead of claiming that AI classified them.
- AgentMail's integration is implemented, but automatic application delivery remains blocked. The separate **operator-run local SMTP fallback passed seven checks**: actual review-email delivery, read-only retrieval of its three signed links, non-mutating GET, approving POST, original-PDF SHA-256 and Ed25519 verification, rejection of sibling links and replay, and revocation with cleanup. This evidence concerns review notifications only and does not establish Supabase Auth signup-mail delivery.
- Manual responses work through the dashboard or signed review page and do not approve access. Real replies to an email have not been verified. Invitations continue to display their actual delivery status and provide a link when automated mail is unavailable.
- The video URL remains pending until Roberto records and supplies it. No generated demonstration video is included.
