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
| **0:00–0:25** | The presenter will show Acme's vault and the document access labels. | “Companies repeatedly send the same corporate documents to their business partners. Puente lets an agent request an original document for a defined business purpose. The company keeps its permission rules, and every delivery creates a record. These Mexican company documents are fictional and owner-reviewed.” |
| **0:25–0:50** | In Bridges, the presenter will generate an access code for the fresh Globex bridge, copy it, open Agent playground, paste it and select **Connect agent**. | “A bridge connects two companies in both directions. This one-time code gives Globex's agent a temporary token. The connection allows it to make requests; each document still has to satisfy Acme's rules.” |
| **0:50–1:35** | The presenter will select **SAT compliance opinion**, purpose **Alta como proveedor**, and at least one Globex document to offer in return. After **Request original PDF**, the presenter will show the delivered status, receipt and extracted-text tabs, then download the original PDF. | “This console makes real API calls as Globex's agent. It declares vendor onboarding as its purpose and offers Globex's own document in return. Acme's existing rule approves this routine request. The response contains the unchanged original PDF, extracted text and an Ed25519-signed receipt. The receipt binds the file's SHA-256 fingerprint to the recipient, bridge, purpose and delivery time.” |
| **1:35–2:20** | The presenter will choose **Balance sheet 2026**, retain the purpose and reciprocal offer, and request it. After the pending response, the presenter will open Requests, review the new balance-sheet request and approve it. Returning to Agent playground, the presenter will select **Check owner decision**. | “A balance sheet contains financial information, so it requires a human decision even when the purpose is familiar. Acme can see who requested it and why. I am approving this particular request as the owner. Globex's agent can now retrieve the original. A future request for this financial document will require a new approval.” |
| **2:20–2:45** | The presenter will show Activity, revoke the fresh demonstration bridge, return to Agent playground and select **Check access**. | “Supabase Realtime updates the owner's activity log as the exchange happens. Now I revoke this bridge. The next agent call is rejected, and previously issued download links are checked against the bridge again. Files already downloaded remain with their recipients.” |
| **2:45–3:00** | The presenter will finish on the denied-access result or the vault, with the production URL visible. | “Puente exposes this same authorization core through MCP and REST, with an agent guide at llms.txt. Supabase provides Auth, private Storage, Postgres, row-level security and live events. The result is a documented, purpose-bound exchange between companies.” |

## Current Claude and AgentMail variant

The walkthrough above is the truthful version to use while Claude credits and AgentMail delivery remain unavailable. It demonstrates working authorization, original delivery, signatures, human decisions and revocation without depending on those services.

- **Classification:** the presenter will say “owner-reviewed sample documents.” Claude through Vercel AI Gateway is integrated, but the observed credit failure returned HTTP 403. A successful live Claude classification must not be claimed. If an upload is shown, the presenter will let the application display **Needs review** when inference is unavailable, then review the type, financial sensitivity and expiry manually before saving the owner's classification.
- **Escalation:** the presenter will approve from Requests, as timed above. Automatic application dispatch through AgentMail remains blocked. If asked: “A real review email and its signed approval flow were verified through an operator-run local SMTP fallback. This walkthrough uses the dashboard; automatic AgentMail delivery is still unavailable.”
- **Local SMTP fallback, verified:** a real review email reached the configured inbox, where a local read-only IMAP check retrieved all three signed decision links. The seven-check test passed: opening a link did not mutate the request; submitting approval allowed the original PDF with a matching SHA-256 fingerprint and valid Ed25519 receipt; sibling links and replay were rejected; revocation and cleanup completed. An operator ran the local mail helper. This verifies review notifications, not automatic application dispatch or Supabase Auth signup mail.
- **Manual response:** after the timed run, the presenter may use **Send manual response** in the dashboard or the signed review page. That page-based response provides instructions to the requesting agent and grants no document access; the owner can later approve or decline. Real email-reply processing has not been verified and will not be presented as working.

If live Claude or AgentMail delivery is enabled before recording, the presenter will first complete and verify a fresh upload or a real message delivery. Only that observed result will replace the corresponding sentence or action in the script. An email-based recording will require a fresh pending request and a newly delivered message because the verified test links were consumed or invalidated during cleanup.

## Recovery during the demonstration

If a shared bridge has been revoked or a code has already been used, the presenter will create a new bridge and issue a new code. An expired original-download link will be replaced by polling the approved request while its bridge is active. The presenter will select at least one offered document before submitting; reciprocal offers are required.

The presenter will avoid refreshing or closing the browser during the financial approval roundtrip. Navigation between dashboard views preserves the in-memory agent session; a full page reload intentionally does not persist the agent token.
