import { endpoint } from '@/lib/http';
import { requireOwner } from '@/lib/auth';
import { dashboard } from '@/lib/core';
export async function GET(req: Request) { return endpoint(async () => dashboard((await requireOwner(req)).companyId)); }
