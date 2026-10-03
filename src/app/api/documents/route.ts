import { endpoint } from '@/lib/http';
import { requireAgent } from '@/lib/auth';
import { listDocuments } from '@/lib/core';
export async function GET(req: Request) { return endpoint(async () => listDocuments(await requireAgent(req))); }
