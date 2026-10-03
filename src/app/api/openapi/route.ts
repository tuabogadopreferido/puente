type Schema = Record<string, unknown>;
const uuid: Schema = { type: "string", format: "uuid" };
const tokenSecurity = [{ bearerAuth: [] }];
const ownerSecurity = [{ ownerAuth: [] }];
const jsonBody = (schema: Schema) => ({
  required: true,
  content: { "application/json": { schema } },
});
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});
const requestPurpose = {
  purpose_id: uuid,
  purpose: { type: "string", minLength: 1, maxLength: 500 },
  offered_document_ids: {
    type: "array",
    items: uuid,
    maxItems: 100,
    default: [],
    description:
      "Optional documents owned by the requester. Omitted or empty means no offer and never grants reverse access.",
  },
};
const documentRequest = {
  ...object({ document_id: uuid, ...requestPurpose }, ["document_id"]),
  anyOf: [{ required: ["purpose_id"] }, { required: ["purpose"] }],
};
const decision = object(
  {
    action: { type: "string", enum: ["approve", "deny", "manual"] },
    create_rule: { type: "boolean", default: false },
    manual_response: {
      type: "string",
      maxLength: 4000,
      description:
        "Required for action manual; does not grant document access.",
    },
  },
  ["action"],
);
const idParameter = [{ name: "id", in: "path", required: true, schema: uuid }];
const ticketParameter = {
  name: "ticket",
  in: "query",
  required: true,
  schema: { type: "string" },
  description:
    "Short-lived signed ticket returned by the authorized delivery operation. Keep private.",
};
const jsonResult = {
  description:
    "JSON result. A delivery contains download_url, extracted_text, sha256 and an Ed25519 receipt; an exception returns pending and request_id.",
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
    },
  },
};
const errors = {
  "400": { description: "Invalid request" },
  "401": { description: "Missing, expired or invalid credential" },
  "403": {
    description: "Outside authorization scope, expired or revoked bridge",
  },
  "404": { description: "Resource unavailable within this scope" },
  "500": { description: "Operation unavailable" },
};
const op = (summary: string, body?: Schema, owner = false) => ({
  summary,
  security: owner ? ownerSecurity : tokenSecurity,
  ...(body ? { requestBody: jsonBody(body) } : {}),
  responses: { "200": jsonResult, ...errors },
});
const pdfResponse = {
  description:
    "Exact original PDF bytes after authorization and SHA-256 validation.",
  content: {
    "application/pdf": { schema: { type: "string", format: "binary" } },
  },
};

export async function GET() {
  const paths = {
    "/api/access/exchange": {
      post: {
        ...op(
          "Exchange a one-time code for a company/bridge-scoped token",
          object({ code: { type: "string", minLength: 12, maxLength: 200 } }, [
            "code",
          ]),
        ),
        security: [],
      },
    },
    "/api/documents": {
      get: op(
        "List counterpart metadata, closed privacy purposes and reciprocal offers",
      ),
    },
    "/api/requests": {
      post: op(
        "Request an original with purpose and optional reciprocal offers",
        documentRequest,
      ),
    },
    "/api/documents/{id}/request": {
      parameters: idParameter,
      post: op("Request a specific counterpart original", {
        ...object(requestPurpose),
        anyOf: [{ required: ["purpose_id"] }, { required: ["purpose"] }],
      }),
    },
    "/api/requests/{id}": {
      parameters: idParameter,
      get: op(
        "Poll a counterpart request and retrieve the original after approval",
      ),
    },
    "/api/download": {
      get: {
        summary:
          "Download the authorized counterpart original; rechecks bridge/token and integrity",
        security: [],
        parameters: [ticketParameter],
        responses: { "200": pdfResponse, ...errors },
      },
    },
    "/api/dashboard": {
      get: op(
        "Read the authenticated owner company dashboard",
        undefined,
        true,
      ),
    },
    "/api/owner/documents": {
      get: op("List only the verified owner company dossier", undefined, true),
    },
    "/api/owner/documents/{id}/download": {
      parameters: idParameter,
      post: op(
        "Issue a signed owner-scoped receipt and original download ticket",
        undefined,
        true,
      ),
      get: {
        summary:
          "Download the owner original; rechecks active membership and expiry",
        security: [],
        parameters: [ticketParameter],
        responses: { "200": pdfResponse, ...errors },
      },
    },
    "/api/documents/upload": {
      post: {
        ...op(
          "Legacy multipart PDF upload, at most 4 MiB; use upload/init and upload/complete for larger originals",
          undefined,
          true,
        ),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: object(
                {
                  file: {
                    type: "string",
                    format: "binary",
                    description:
                      "Original PDF, at most 4 MiB (4,194,304 bytes) and 80 pages.",
                  },
                },
                ["file"],
              ),
            },
          },
        },
        responses: {
          "201": jsonResult,
          "413": { description: "PDF exceeds upload limit" },
          ...errors,
        },
      },
    },
    "/api/documents/upload/init": {
      post: {
        ...op(
          "Initialize a private direct-to-Storage PDF upload up to 20 MiB",
          {
            ...object(
              {
                filename: {
                  type: "string",
                  minLength: 1,
                  maxLength: 255,
                  pattern: "\\.[pP][dD][fF]$",
                },
                size: { type: "integer", minimum: 1, maximum: 20971520 },
              },
              ["filename", "size"],
            ),
            additionalProperties: false,
          },
          true,
        ),
        description:
          "Send metadata only, never PDF bytes through this route. The server binds the upload to the verified owner and a random private Storage path. Use Supabase storage.from('documents').uploadToSignedUrl(path, token, file, { contentType: 'application/pdf', upsert: false }), then call upload/complete. The upload capability is private, valid for two hours and cannot overwrite an existing object. PDF validity, exact byte count, at most 80 pages and SHA-256 are verified during completion.",
        responses: {
          "201": {
            description:
              "Private one-object upload capability. Keep the token and path out of logs.",
            content: {
              "application/json": {
                schema: object(
                  {
                    uploadId: uuid,
                    token: { type: "string" },
                    path: { type: "string" },
                  },
                  ["uploadId", "token", "path"],
                ),
              },
            },
          },
          "413": { description: "JSON metadata exceeds 4 KiB" },
          "415": { description: "Content-Type must be application/json" },
          "503": {
            description:
              "Upload initialization unavailable; no successful upload is claimed",
          },
          ...errors,
        },
      },
    },
    "/api/documents/upload/complete": {
      post: {
        ...op(
          "Validate and classify a directly uploaded original; completion is idempotent",
          {
            ...object({ uploadId: uuid }, ["uploadId"]),
            additionalProperties: false,
          },
          true,
        ),
        description:
          "The same verified owner finalizes the upload session. Server-read original bytes must match the declared size and a valid unencrypted PDF up to 20 MiB and 80 pages. The server computes SHA-256 and classifies by content without modifying or reuploading the original. Missing or unavailable classification remains awaiting_owner_review. Retry completion with the same uploadId after an uncertain Storage upload or completion response; completed sessions return the same document. Concurrent processing returns 409 and does not start duplicate classification.",
        responses: {
          "200": {
            description:
              "The finalized document and an honest classification notice, including on replay.",
            content: {
              "application/json": {
                schema: object(
                  {
                    document: { type: "object", additionalProperties: true },
                    notice: { type: "string" },
                  },
                  ["document", "notice"],
                ),
              },
            },
          },
          "409": {
            description:
              "upload_in_progress: retry shortly; upload_not_ready: Storage upload has not finished",
          },
          "410": {
            description:
              "Upload session expired or previously failed validation; initialize a new upload",
          },
          "413": { description: "JSON metadata exceeds 4 KiB" },
          "415": { description: "Content-Type must be application/json" },
          "503": {
            description:
              "Processing temporarily unavailable; retry the same uploadId",
          },
          ...errors,
        },
      },
    },
    "/api/documents/{id}": {
      parameters: idParameter,
      patch: op(
        "Correct owner document classification and explicitly mark it owner-reviewed",
        object({
          document_type: {
            type: "string",
            enum: [
              "tax_status",
              "tax_compliance",
              "incorporation",
              "power_of_attorney",
              "bank_cover",
              "proof_of_address",
              "repse",
              "representative_id",
              "balance_sheet",
              "income_statement",
              "tax_return",
              "other",
            ],
          },
          sensitive: { type: "boolean" },
          expires_at: { type: ["string", "null"], format: "date" },
        }),
        true,
      ),
    },
    "/api/bridges": {
      post: op(
        "Create an owner-authorized bilateral bridge with a registered company",
        object(
          {
            counterparty_id: uuid,
            expires_in_hours: {
              type: "integer",
              minimum: 1,
              maximum: 720,
              default: 24,
            },
          },
          ["counterparty_id"],
        ),
        true,
      ),
    },
    "/api/bridges/{id}/code": {
      parameters: idParameter,
      post: op(
        "Issue a one-time code for one participant of an owner bridge",
        object({ actor_company_id: uuid }),
        true,
      ),
    },
    "/api/bridges/{id}/revoke": {
      parameters: idParameter,
      post: op(
        "Revoke a bridge belonging to the verified owner company",
        undefined,
        true,
      ),
    },
    "/api/requests/{id}/decision": {
      parameters: idParameter,
      post: op(
        "Approve, deny or manually respond as the verified document owner",
        decision,
        true,
      ),
    },
    "/api/invitations": {
      post: op(
        "Invite a company using a closed-list purpose and optional owned document offers; return a private 24-hour link",
        object(
          {
            email: { type: "string", format: "email", maxLength: 320 },
            company_name: { type: "string", minLength: 1, maxLength: 200 },
            purpose_id: uuid,
            offered_document_ids: {
              type: "array",
              items: uuid,
              maxItems: 100,
              default: [],
              description:
                "Optional. Omitted or empty means no document offer.",
            },
          },
          ["email", "company_name", "purpose_id"],
        ),
        true,
      ),
    },
    "/api/invitations/inspect": {
      get: {
        summary:
          "Inspect signed invitation metadata only; exposes no document IDs, content or email",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string", maxLength: 2000 },
            description: "Private signed invitation token.",
          },
        ],
        responses: {
          "200": {
            description:
              "Inviter/company names, purpose name, offered-document count, status and expiry only.",
            content: {
              "application/json": {
                schema: object({
                  inviter_name: { type: "string" },
                  company_name: { type: "string" },
                  purpose_name: { type: "string" },
                  offered_document_count: { type: "integer" },
                  status: { type: "string" },
                  expires_at: { type: "string", format: "date-time" },
                }),
              },
            },
          },
          "410": { description: "Expired invitation" },
          ...errors,
        },
      },
    },
    "/api/invitations/accept": {
      post: {
        ...op(
          "Accept as the invited, confirmed Auth user; create a company if needed and a bridge without document grants",
          object({ token: { type: "string", maxLength: 2000 } }, ["token"]),
        ),
        security: [{ inviteeAuth: [] }],
        description:
          "Company membership is not required. The server verifies the Auth user and confirmed email; the database checks that email independently. Repeated acceptance by the same user is idempotent.",
        responses: {
          "200": {
            description:
              "Accepted or already_accepted with invitation_id, company_id and bridge_id.",
          },
          "410": { description: "Expired invitation" },
          ...errors,
        },
      },
    },
    "/api/receipts/verify": {
      get: {
        summary: "Get the trusted server Ed25519 public key",
        security: [],
        responses: { "200": jsonResult },
      },
      post: {
        ...op(
          "Verify caller-supplied receipt data without exposing private records",
          object(
            {
              payload: { type: "object", additionalProperties: true },
              signature: { type: "string", maxLength: 200 },
            },
            ["payload", "signature"],
          ),
        ),
        security: [],
      },
    },
    "/api/approvals/confirm": {
      post: {
        ...op(
          "Consume a signed single-use email decision token",
          object(
            {
              token: { type: "string", maxLength: 2000 },
              createRule: { type: "boolean" },
              manualResponse: { type: "string", maxLength: 5000 },
            },
            ["token"],
          ),
        ),
        security: [],
      },
    },
    "/api/health": {
      get: {
        summary: "Database-backed health",
        security: [],
        responses: {
          "200": { description: "Healthy" },
          "503": { description: "Unavailable" },
        },
      },
    },
  };
  return Response.json({
    openapi: "3.1.0",
    info: {
      title: "Puente API",
      version: "1.1.0",
      description:
        "Bilateral access to private corporate originals. Owner Auth JWTs are verified by Supabase Auth; membership comes from the database, never caller-provided claims. All demo data is fictional.",
    },
    servers: [
      {
        url: (
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        ).replace(/\/$/, ""),
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Counterparty token returned by one-time bridge-code exchange; scoped to a company and bridge, up to 24 hours.",
        },
        ownerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Access token returned by Supabase Auth sign-in. The server verifies it and resolves company_members; never send a service-role key or self-declared company claims.",
        },
        inviteeAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Verified Supabase Auth access token for the invitation email, with a confirmed mailbox. No prior company membership is required.",
        },
      },
    },
    paths,
  });
}
