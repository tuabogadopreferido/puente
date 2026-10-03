import { z } from 'zod';
import { endpoint } from '@/lib/http';
import { requireOwner } from '@/lib/auth';
import { resolveRequest } from '@/lib/approval';
export async function POST(req: Request, context: {params:Promise<{id:string}>}) { return endpoint(async () => { const owner=await requireOwner(req); const body=z.object({action:z.enum(['approve','deny','manual']),create_rule:z.boolean().optional(),manual_response:z.string().max(4000).optional()}).parse(await req.json()); return resolveRequest({requestId:(await context.params).id,ownerCompanyId:owner.companyId,action:body.action,createRule:body.create_rule,manualResponse:body.manual_response}); }); }
