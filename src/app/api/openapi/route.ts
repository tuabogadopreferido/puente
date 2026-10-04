import { z } from "zod";
import {
  sourceRegistration,
  peerDocumentRegistration,
  peerSignal,
  sourceSignal,
} from "@/lib/peer-server";
import { documentClassificationCorrectionInput } from "@/lib/document-classification";

import {
  batchCreateInput,
  batchUpdateInput,
  documentSharingInput,
} from "@/lib/document-sharing";

type Schema = Record<string, unknown>;
const uuid = { type: "string", format: "uuid" };
const str = { type: "string" };
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const body = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});
const results = {
  "200": {
    description:
      "JSON result. Authorized delivery returns a WebRTC transfer descriptor and signed authorization receipt; it does not contain PDF bytes or extracted text.",
  },
  "400": { description: "Invalid input" },
  "401": { description: "Invalid or expired credential" },
  "403": { description: "Outside scope or revoked permission" },
  "404": { description: "Unavailable in this scope" },
  "409": { description: "Changed source or conflicting operation" },
  "410": { description: "Expired transfer or retired storage route" },
  "429": { description: "Request limit reached" },
};
const op = (summary: string, credential = "ownerAuth", schema?: unknown) => ({
  summary,
  security: credential ? [{ [credential]: [] }] : [],
  ...(schema ? { requestBody: body(schema) } : {}),
  responses: results,
});
const id = [{ name: "id", in: "path", required: true, schema: uuid }];
const offers = {
  type: "array",
  items: uuid,
  maxItems: 100,
  default: [],
  description:
    "Optional reciprocal offer. Empty or omitted means no offer and never grants reverse access.",
};
const purpose = {
  purpose_id: uuid,
  purpose: { type: "string", maxLength: 500 },
  offered_document_ids: offers,
};

export async function GET() {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const paths = {
    "/api/auth/request-code": {
      post: op(
        "Email a one-use ten-minute sign-in code",
        "",
        object(
          {
            name: { ...str, minLength: 1, maxLength: 200 },
            email: { ...str, format: "email" },
          },
          ["email"],
        ),
      ),
    },
    "/api/auth/verify-code": {
      post: op(
        "Verify code and create a fixed 30-day human session",
        "",
        object(
          {
            challenge_id: uuid,
            email: { ...str, format: "email" },
            code: { ...str, pattern: "^[0-9]{6,10}$" },
          },
          ["challenge_id", "email", "code"],
        ),
      ),
    },
    "/api/auth/session": {
      get: op("Read the original session expiry", "humanAuth"),
    },
    "/api/auth/logout": {
      post: op(
        "End this human session without revoking owner agents",
        "humanAuth",
      ),
    },
    "/api/dashboard": {
      get: op("Read the authenticated workspace", "humanAuth"),
    },
    "/api/owner/agent-connections": {
      get: op("List credentials created by this human", "humanAuth"),
      post: op(
        "Create permanent revocable owner credential; raw token returned once",
        "humanAuth",
        object({ label: str }, ["label"]),
      ),
    },
    "/api/owner/agent-connections/{id}/revoke": {
      parameters: id,
      post: op("Revoke only a credential created by this human", "humanAuth"),
    },
    "/api/sources": {
      post: op(
        "Register or refresh a source owned by this connection",
        "ownerAuth",
        z.toJSONSchema(sourceRegistration),
      ),
    },
    "/api/sources/{id}": {
      parameters: id,
      get: op("Heartbeat source and poll its currently authorized offers"),
      post: op(
        "Answer an authorized WebRTC offer",
        "ownerAuth",
        z.toJSONSchema(sourceSignal),
      ),
    },
    "/api/sources/documents": {
      post: op(
        "Catalog a PDF kept at its source, without file content",
        "ownerAuth",
        z.toJSONSchema(peerDocumentRegistration),
      ),
    },
    "/api/transfers/{id}": {
      parameters: id,
      get: op(
        "Read transfer status and answer; permission is rechecked",
        "transferAuth",
      ),
      post: op(
        "Submit offer, verified completion or cancellation",
        "transferAuth",
        z.toJSONSchema(peerSignal),
      ),
    },
    "/api/access/exchange": {
      post: op(
        "Redeem a one-use bridge code for a token lasting up to 24 hours",
        "",
        object({ code: str }, ["code"]),
      ),
    },
    "/api/documents": {
      get: op("List counterpart catalog and approved purposes", "bridgeAuth"),
    },
    "/api/owner/documents": { get: op("List own catalog", "humanAuth") },
    "/api/owner/documents/{id}/download": {
      parameters: id,
      post: op(
        "Authorize direct transfer from the owner's source",
        "humanAuth",
      ),
    },
    "/api/documents/{id}": {
      parameters: id,
      patch: op(
        "Correct owned classification metadata",
        "ownerAuth",
        z.toJSONSchema(documentClassificationCorrectionInput),
      ),
    },
    "/api/requests": {
      post: op(
        "Request source document with a declared purpose",
        "bridgeAuth",
        object({ document_id: uuid, ...purpose }, ["document_id"]),
      ),
    },
    "/api/documents/{id}/request": {
      parameters: id,
      post: op("Request a specific document", "bridgeAuth", object(purpose)),
    },
    "/api/requests/{id}": {
      parameters: id,
      get: op("Read request decision and authorized transfer", "bridgeAuth"),
    },
    "/api/requests/{id}/decision": {
      parameters: id,
      post: op(
        "Approve, deny or manually respond as document owner",
        "humanAuth",
        object(
          {
            action: { ...str, enum: ["approve", "deny", "manual"] },
            create_rule: { type: "boolean", default: false },
            manual_response: { ...str, maxLength: 5000 },
          },
          ["action"],
        ),
      ),
    },
    "/api/document-batches": {
      get: op("List owned batches and effective document sharing"),
      post: op(
        "Create a document batch",
        "ownerAuth",
        z.toJSONSchema(batchCreateInput),
      ),
    },
    "/api/document-batches/{id}": {
      parameters: id,
      patch: op(
        "Update a document batch",
        "ownerAuth",
        z.toJSONSchema(batchUpdateInput),
      ),
    },
    "/api/documents/{id}/sharing": {
      parameters: id,
      get: op("Read effective sharing settings"),
      patch: op(
        "Set batch inheritance or a document override",
        "ownerAuth",
        z.toJSONSchema(documentSharingInput),
      ),
    },
    "/api/bridges": {
      post: op(
        "Connect an existing counterparty for up to 24 hours",
        "humanAuth",
        object(
          {
            counterparty_id: uuid,
            expires_in_hours: {
              type: "integer",
              minimum: 1,
              maximum: 24,
              default: 24,
            },
          },
          ["counterparty_id"],
        ),
      ),
    },
    "/api/bridges/{id}/code": {
      parameters: id,
      post: op(
        "Issue a single-use code",
        "humanAuth",
        object({ actor_company_id: uuid }),
      ),
    },
    "/api/bridges/{id}/revoke": {
      parameters: id,
      post: op(
        "Revoke bilateral access and ongoing transfer authorization",
        "humanAuth",
      ),
    },
    "/api/invitations": {
      post: op(
        "Invite a verified email recipient to establish a bridge",
        "humanAuth",
        object(
          {
            email: { ...str, format: "email" },
            company_name: str,
            purpose_id: uuid,
            offered_document_ids: offers,
          },
          ["email", "company_name", "purpose_id"],
        ),
      ),
    },
    "/api/invitations/inspect": {
      get: {
        ...op("Read limited invitation metadata", ""),
        parameters: [
          { name: "token", in: "query", required: true, schema: str },
        ],
      },
    },
    "/api/invitations/accept": {
      post: op(
        "Accept only with the invited verified email",
        "humanAuth",
        object({ token: str }, ["token"]),
      ),
    },
    "/api/receipts/verify": {
      get: op("Get the public receipt verification key", ""),
      post: op(
        "Verify caller-supplied signed authorization receipt",
        "",
        object(
          {
            payload: { type: "object", additionalProperties: true },
            signature: str,
          },
          ["payload", "signature"],
        ),
      ),
    },
    "/api/mcp": {
      post: {
        ...op("Streamable HTTP MCP; per-tool credentials", "", {
          type: "object",
          additionalProperties: true,
        }),
        description:
          "MCP 2.0.0: exchange_code, list_documents, get_document, request_document, get_request_status, register_source, register_document, correct_document_classification, create_bridge, issue_access_code, revoke_bridge, list_requests, decide_request, revoke_owner_access, verify_receipt. Owner tools accept po_ or a current human bearer. Counterparty tools accept bridge tokens. See /llms.txt. PDF bytes never pass through MCP.",
      },
    },
    "/api/documents/upload": {
      post: {
        deprecated: true,
        responses: {
          "410": { description: "Storage removed; register a source instead" },
        },
      },
    },
    "/api/documents/upload/init": {
      post: {
        deprecated: true,
        responses: { "410": { description: "Storage removed" } },
      },
    },
    "/api/documents/upload/complete": {
      post: {
        deprecated: true,
        responses: { "410": { description: "Storage removed" } },
      },
    },
    "/api/download": {
      get: {
        deprecated: true,
        responses: {
          "410": {
            description:
              "PDF server delivery removed; use the direct-transfer receiver",
          },
        },
      },
    },
  };
  return Response.json({
    openapi: "3.1.0",
    info: {
      title: "Puente",
      version: "2.0.0",
      description:
        "Metadata and permission coordination with direct WebRTC delivery from the owner device. No PDF or extracted text storage. Human login: 30 days; owner agent: until revoked; counterpart bridge: up to 24 hours. Transfer setup: up to five minutes. Source must be online. STUN configured; TURN and cloud-only Drive OAuth are not configured.",
    },
    servers: [{ url: base }],
    paths,
    components: {
      securitySchemes: {
        humanAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Verified Supabase access JWT belonging to an unexpired 30-day Puente human session",
        },
        ownerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Durable po_ owner connection or current human JWT",
        },
        bridgeAuth: {
          type: "http",
          scheme: "bearer",
          description: "pt_ token scoped to one active bilateral bridge",
        },
        transferAuth: {
          type: "http",
          scheme: "bearer",
          description: "Secret limited to one authorized direct transfer",
        },
      },
    },
  });
}
