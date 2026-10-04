import { bearer } from "@/lib/auth";
import { endpoint } from "@/lib/http";
import { requireOwnerAgentToken } from "@/lib/owner-agent";
import {
  correctDocumentClassification,
  documentClassificationCorrectionInput,
} from "@/lib/document-classification";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const owner = await requireOwnerAgentToken(bearer(req));
    const data = documentClassificationCorrectionInput.parse(await req.json());
    return correctDocumentClassification(owner, {
      document_id: (await context.params).id,
      ...data,
    });
  });
}
