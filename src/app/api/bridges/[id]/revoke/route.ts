import { endpoint } from '@/lib/http';
import { requireOwner } from '@/lib/auth';
import { revokeBridge } from '@/lib/core';
export async function POST(req: Request, context: {params:Promise<{id:string}>}) { return endpoint(async () => revokeBridge((await requireOwner(req)).companyId,(await context.params).id)); }
