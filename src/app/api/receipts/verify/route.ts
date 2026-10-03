import { z } from 'zod';
import { endpoint } from '@/lib/http';
import { verifyReceipt,publicKey } from '@/lib/crypto';
export async function POST(req: Request) { return endpoint(async () => { const body=z.object({payload:z.record(z.string(),z.unknown()),signature:z.string().max(200)}).parse(await req.json()); return {valid:verifyReceipt(body.payload,body.signature),algorithm:'Ed25519',public_key:publicKey()}; }); }
export async function GET() { return endpoint(async () => ({algorithm:'Ed25519',public_key:publicKey(),canonicalization:'Recursive lexicographic JSON object keys; UTF-8'})); }
