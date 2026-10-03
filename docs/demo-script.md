# Puente: three-minute demo

**Live app:** [puente-phi.vercel.app](https://puente-phi.vercel.app)

**Repository:** [tuabogadopreferido/puente](https://github.com/tuabogadopreferido/puente)

This script runs from **0:00 to 3:00**. The presenter will use the real REST-powered Agent playground as Globex's agent, with Acme's owner dashboard in the same browser. The agent session will remain connected when the presenter switches to Requests and back.

## Preparation before the recording

1. The presenter will open the app at a desktop viewport of approximately 1440 × 1050 and sign in as `acme@puente.demo` with the public demo password `PuenteDemo2026!`.
2. In Bridges, the presenter will create a fresh 24-hour bridge to Globex. This will isolate the recording from other visitors who can revoke the shared demonstration bridge.
3. The presenter will confirm that the vault contains **SAT compliance opinion** and **Balance sheet 2026**, and that the purpose **Alta como proveedor** is available. The sample documents will display **Owner reviewed**.
4. For the recording, the presenter will start on Document vault. A separate tab may hold the [agent guide](https://puente-phi.vercel.app/llms.txt) or [MCP endpoint](https://puente-phi.vercel.app/api/mcp) for the closing reference; neither is needed to complete the dashboard flow.

All companies, people, identifiers and PDFs in the demonstration are fictional. The presenter will keep tokens, invitation links and unrelated browser tabs out of screenshots intended for the public repository.

## Timed walkthrough

| Time | What the presenter will do | Spoken narration |
| --- | --- | --- |
| **0:00–0:25** | The presenter will show Acme's vault and the document access labels. | “Companies repeatedly exchange the same onboarding files. Puente lets agents request originals for approved purposes. These fictional seeded samples are owner-reviewed; two separate production uploads were classified correctly by Claude Opus 5.5, with their original PDFs preserved.” |
| **0:25–0:50** | In Bridges, the presenter will generate an access code for the fresh Globex bridge, copy it, open Agent playground, paste it and select **Connect agent**. | “A bridge connects two companies in both directions. This one-time code gives Globex's agent a temporary token. The connection allows it to make requests; each document still has to satisfy Acme's rules.” |
| **0:50–1:35** | The presenter will select **SAT compliance opinion**, purpose **Alta como proveedor**, and at least one Globex document to offer in return. After **Request original PDF**, the presenter will show the delivered status, receipt and extracted-text tabs, then download the original PDF. | “This console makes real API calls as Globex's agent. It declares vendor onboarding as its purpose and offers Globex's own document in return. Acme's existing rule approves this routine request. The response contains the unchanged original PDF, extracted text and an Ed25519-signed receipt. The receipt binds the file's SHA-256 fingerprint to the recipient, bridge, purpose and delivery time.” |
| **1:35–2:20** | The presenter will choose **Balance sheet 2026**, retain the purpose and reciprocal offer, and request it. After the pending response, the presenter will open Requests, review the new balance-sheet request and approve it. Returning to Agent playground, the presenter will select **Check owner decision**. | “A balance sheet contains financial information, so it requires a human decision even when the purpose is familiar. Acme can see who requested it and why. I am approving this particular request as the owner. Globex's agent can now retrieve the original. A future request for this financial document will require a new approval.” |
| **2:20–2:45** | The presenter will show Activity, revoke the fresh demonstration bridge, return to Agent playground and select **Check access**. | “Supabase Realtime updates the owner's activity log as the exchange happens. Now I revoke this bridge. The next agent call is rejected, and previously issued download links are checked against the bridge again. Files already downloaded remain with their recipients.” |
| **2:45–3:00** | The presenter will finish on the denied-access result or the vault, with the production URL visible. | “Puente exposes this same authorization core through MCP and REST, with an agent guide at llms.txt. Supabase provides Auth, private Storage, Postgres, row-level security and live events. The result is a documented, purpose-bound exchange between companies.” |

## Verified capabilities and recording boundaries

The timed walkthrough uses the dashboard for the owner's decision. Production classification and automatic outbound email now have live evidence; the limits below will keep the narration consistent with what was actually verified.

- **Classification:** production uses Claude Opus 5.5 directly through Anthropic, with workspace routing and low effort. Two newly uploaded synthetic PDFs passed type, expiry and financial-sensitivity checks; their original bytes, SHA-256 fingerprints and Ed25519 receipts also verified. The seeded vault files remain **Owner reviewed**, and the presenter will not describe those fixtures as AI-classified. A recorded upload will show its actual returned classification; an inference failure will still leave the original for owner review.
- **Automatic escalation:** AgentMail sent a real production review message to the configured Gmail mailbox with all three signed decision links. It arrived in Spam. A fresh production roundtrip passed all seven checks, including approval through the received email, original integrity, signed receipt, replay rejection, revocation and cleanup. The presenter can approve through a newly delivered email or use Requests for the timed walkthrough. If asked: “Automatic review email and its approval-to-delivery flow are verified; Gmail placed the test message in Spam.”
- **Local SMTP fallback:** the separate operator-run test passed seven checks, including a real message, read-only IMAP retrieval of its signed links, non-mutating GET, explicit approval, original-PDF integrity, Ed25519 verification, sibling/replay rejection and revocation with cleanup. This remains fallback evidence and does not establish Supabase Auth signup-mail delivery.
- **Manual response:** the presenter may demonstrate **Send manual response** through the dashboard or signed review page after the timed run. It supplies instructions without granting document access. AgentMail webhook registration is blocked by HTTP 403 (`missing_permission`) for `webhook_create` / `webhook_read`; a reply sent to the email itself is not a verified working path.
- **MCP:** the playground uses the real REST API, and the actual MCP SDK separately passed seven integration groups against the same core. The Claude-driven MCP run completed `exchange_code`, then stopped on its second model step with `finishReason: content-filter`. The presenter will not describe that run as a completed autonomous exchange. This limit is separate from the successful Claude PDF classifications. Earlier Gateway credit-related HTTP 403 responses are historical, not the current classifier's status.

An email-based recording will require a fresh pending request and a newly delivered message. The presenter will show a real observed result, using the configured mailbox's Spam folder if needed, and will keep signed links out of public screenshots. The verified test links were consumed or invalidated during cleanup.

## Recovery during the demonstration

If a shared bridge has been revoked or a code has already been used, the presenter will create a new bridge and issue a new code. An expired original-download link will be replaced by polling the approved request while its bridge is active. The presenter will select at least one offered document before submitting; reciprocal offers are required.

The presenter will avoid refreshing or closing the browser during the financial approval roundtrip. Navigation between dashboard views preserves the in-memory agent session; a full page reload intentionally does not persist the agent token.
