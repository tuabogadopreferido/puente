/** End-to-end REST + actual MCP verification. Uses only synthetic demo data. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const base = (process.env.PUENTE_TEST_URL || 'http://127.0.0.1:3000').replace(/\/$/,'');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = process.env.PUENTE_DEMO_PASSWORD!;
if (!url || !secret || !anon || !password) throw new Error('Missing demo environment');
if (process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID && process.env.PUENTE_REVIEW_EMAIL) throw new Error('Run the local test server without AgentMail credentials to avoid sending real email.');
const admin = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const acme='11111111-1111-4111-8111-111111111111';
const globex='22222222-2222-4222-8222-222222222222';
let bridgeId: string | undefined;
const secretValues=[password,secret,anon];
const checks:string[]=[];
const mcp=new Client({name:'Puente integration verifier',version:'1.0.0'},{capabilities:{}});
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function pass(label:string) { checks.push(label); console.log('PASS '+label); }
function must(condition:unknown,message:string):asserts condition { assert(condition,message); }
const documentSchema=z.object({id:z.string(),company_id:z.string(),document_type:z.string(),sha256:z.string()});
const listSchema=z.object({documents:z.array(documentSchema),purposes:z.array(z.object({id:z.string(),name:z.string()})),offered_documents:z.array(documentSchema)});
const deliverySchema=z.object({status:z.literal('delivered'),request_id:z.string(),document_id:z.string(),original_pdf:z.literal(true),sha256:z.string(),download_url:z.string(),extracted_text:z.string(),offered_document_ids:z.array(z.string()),receipt:z.object({payload:z.record(z.string(),z.unknown()),signature:z.string(),public_key:z.string(),algorithm:z.literal('Ed25519')})});
const pendingSchema=z.object({status:z.literal('pending'),request_id:z.string(),reason:z.string()});
async function http(path:string,token?:string,method='GET',body?:unknown) {
  const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  let data:unknown; try {data=await response.json();} catch {data=null;}
  return {status:response.status,ok:response.ok,data};
}
async function tool(name:string,args:Record<string,unknown>,expectError=false) {
  const result=await mcp.callTool({name,arguments:args},undefined,{timeout:45000});
  if (expectError) { must(result.isError,`MCP ${name} should reject this call`); return null; }
  must(!result.isError,`MCP ${name} returned an error`);
  if(result.structuredContent)return result.structuredContent;
  const contents=result.content as {type:string;text?:string}[];
  const text=contents.find(c=>c.type==='text')?.text;
  must(text,`MCP ${name} did not return JSON`);
  return JSON.parse(text) as unknown;
}
async function login(email:string) {
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.auth.signInWithPassword({email,password});
  must(!result.error&&result.data.session,`Login failed for ${email}`);
  secretValues.push(result.data.session.access_token);
  return result.data.session.access_token;
}
async function checkPdf(value:unknown) {
  const delivery=deliverySchema.parse(value);
  must(delivery.offered_document_ids.length>0,'Delivery must include reciprocal offers');
  must(delivery.extracted_text.length>0,'Delivery must include extracted text');
  const response=await fetch(delivery.download_url,{signal:AbortSignal.timeout(30000)});
  must(response.ok,'Original PDF download failed');
  must(response.headers.get('content-type')?.includes('application/pdf'),'Original must be PDF');
  const bytes=new Uint8Array(await response.arrayBuffer());
  must(Buffer.from(bytes.subarray(0,5)).toString()==='%PDF-','Download has no PDF header');
  must(sha(bytes)===delivery.sha256,'Downloaded PDF differs from its SHA-256');
  must(delivery.receipt.payload.sha256===delivery.sha256,'Receipt hash differs from original');
  const verify=await http('/api/receipts/verify',undefined,'POST',{payload:delivery.receipt.payload,signature:delivery.receipt.signature});
  must(verify.ok&&z.object({valid:z.literal(true)}).safeParse(verify.data).success,'Original receipt signature is invalid');
  const tampered=await http('/api/receipts/verify',undefined,'POST',{payload:{...delivery.receipt.payload,purpose:'tampered'},signature:delivery.receipt.signature});
  must(tampered.ok&&z.object({valid:z.literal(false)}).safeParse(tampered.data).success,'Tampered receipt must fail verification');
  return delivery;
}
async function main() {
  const health=await http('/api/health'); must(health.ok,'Server health failed');
  const [ownerToken,requesterOwnerToken]=await Promise.all([login('acme@puente.demo'),login('globex@puente.demo')]);
  must(!(await http('/api/dashboard')).ok,'Unauthenticated dashboard must be denied');
  must(!(await http('/api/documents',ownerToken)).ok,'Owner Auth token must not impersonate an agent');
  const created=await http('/api/bridges',ownerToken,'POST',{counterparty_id:globex,expires_in_hours:2});
  must(created.ok,'Temporary bridge creation failed');
  bridgeId=z.object({id:z.string()}).parse(created.data).id;
  const issued=await http(`/api/bridges/${bridgeId}/code`,ownerToken,'POST',{});
  must(issued.ok,'Code issuance failed'); const code=z.object({code:z.string()}).parse(issued.data).code; secretValues.push(code);
  must(!(await http(`/api/bridges/${bridgeId}/code`,ownerToken,'POST',{actor_company_id:randomUUID()})).ok,'Outside-company actor must be rejected');
  pass('Supabase Auth owner flow and bridge actor scope enforced');

  await mcp.connect(new StreamableHTTPClientTransport(new URL(base+'/api/mcp')));
  const tools=await mcp.listTools();
  for(const name of ['exchange_code','list_documents','get_document','request_document','get_request_status','verify_receipt'])must(tools.tools.some(t=>t.name===name),`MCP tool missing: ${name}`);
  const exchange=z.object({token:z.string(),actor_company_id:z.string()}).parse(await tool('exchange_code',{code}));
  must(exchange.actor_company_id===globex,'Exchanged token actor differs from issued actor');
  const token=exchange.token; secretValues.push(token);
  const replay=await http('/api/access/exchange',undefined,'POST',{code});must(replay.status===401,'Access code replay must return 401');
  await tool('list_documents',{token:'invalid_token_for_test'},true);
  const listed=listSchema.parse(await tool('list_documents',{token}));
  must(listed.documents.every(d=>d.company_id===acme),'MCP listed another company dossier');
  must(listed.offered_documents.every(d=>d.company_id===globex),'MCP offered another company documents');
  pass('Actual MCP initialization, discovery, exchange, code replay and token isolation');

  const tax=listed.documents.find(d=>d.document_type==='tax_compliance')!;
  const balance=listed.documents.find(d=>d.document_type==='balance_sheet')!;
  const expired=listed.documents.find(d=>d.document_type==='proof_of_address')!;
  const purpose=listed.purposes.find(p=>p.name==='Alta como proveedor')!;
  must(tax&&balance&&expired&&purpose,'Expected seeded fixtures missing');
  await tool('get_document',{token,document_id:listed.offered_documents[0].id,purpose_id:purpose.id},true);
  await tool('get_document',{token,document_id:tax.id,purpose_id:purpose.id,offered_document_ids:[tax.id]},true);
  const invalidPath=await http('/api/documents/not-a-uuid/request',token,'POST',{purpose_id:purpose.id});must(invalidPath.status===400,'Malformed identifier must fail validation');
  const injectedId=await http('/api/requests',token,'POST',{document_id:"' OR '1'='1",purpose_id:purpose.id});must(injectedId.status===400,'SQL-shaped identifier must fail validation');
  pass('Cross-company document access and forged reciprocal offers denied');

  await checkPdf(await tool('get_document',{token,document_id:tax.id,purpose_id:purpose.id}));
  pass('MCP delivers unchanged original PDF, extracted text, reciprocal offer and verifiable Ed25519 receipt');
  const financial=pendingSchema.parse(await tool('get_document',{token,document_id:balance.id,purpose_id:purpose.id}));
  const deniedOwner=await http(`/api/requests/${financial.request_id}/decision`,requesterOwnerToken,'POST',{action:'approve'});
  must(!deniedOwner.ok,'Requester must not approve owner exception');
  const approval=await http(`/api/requests/${financial.request_id}/decision`,ownerToken,'POST',{action:'approve',create_rule:true});must(approval.ok,'Owner approval failed');
  await checkPdf(await tool('get_request_status',{token,request_id:financial.request_id}));
  const financialAgain=pendingSchema.parse(await tool('get_document',{token,document_id:balance.id,purpose_id:purpose.id}));
  must(financialAgain.status==='pending','Financial approval must remain per-request');
  pass('Financial exception requires actual owner approval and remains exceptional on next request');

  const expiredResult=pendingSchema.parse(await tool('request_document',{token,document_id:expired.id,purpose_id:purpose.id}));
  must(/expired/i.test(expiredResult.reason),'Expired document should state expiry reason');
  const unknown=pendingSchema.parse(await tool('request_document',{token,document_id:tax.id,purpose:'Unauthorized marketing resale'}));
  must(/purpose|privacy/i.test(unknown.reason),'Unlisted purpose should state privacy reason');
  pass('Expired document and unlisted purpose escalate without PDF delivery');

  const fresh=deliverySchema.parse(await tool('get_document',{token,document_id:tax.id,purpose_id:purpose.id}));
  const revoked=await http(`/api/bridges/${bridgeId}/revoke`,ownerToken,'POST',{});must(revoked.ok,'Bridge revocation failed');
  must((await http('/api/documents',token)).status===403,'Revoked token must reject REST calls');
  await tool('list_documents',{token},true);
  must((await fetch(fresh.download_url)).status===403,'Already-issued PDF ticket must fail immediately after revoke');
  must(!(await http(`/api/requests/${financialAgain.request_id}/decision`,ownerToken,'POST',{action:'approve'})).ok,'Revoked bridge must block pending approval');
  pass('Revocation blocks REST, MCP, pending approval and previously issued download tickets');
}
async function cleanup() {
  await mcp.close().catch(()=>undefined);
  if(!bridgeId)return;
  const requests=await admin.from('requests').select('id').eq('bridge_id',bridgeId);
  if(requests.data?.length)await admin.from('approval_links').delete().in('request_id',requests.data.map(r=>r.id));
  await admin.from('receipts').delete().filter('payload->>bridge_id','eq',bridgeId);
  for(const table of ['access_events','requests','agent_tokens','access_codes'])await admin.from(table).delete().eq('bridge_id',bridgeId);
  const result=await admin.from('bridges').delete().eq('id',bridgeId);
  must(!result.error,'Temporary bridge cleanup failed');
}
main().then(async()=>{await cleanup();console.log(JSON.stringify({success:true,checks:checks.length,transport:'MCP Streamable HTTP',temporary_data_removed:true}));}).catch(async(error:unknown)=>{
  let message=error instanceof Error?error.message:'Integration verification failed';
  for(const value of secretValues)if(value)message=message.replaceAll(value,'[REDACTED]');
  console.error('FAIL '+message);
  try {await cleanup();} catch {console.error('Cleanup failed; inspect temporary bridge rows.');}
  process.exitCode=1;
});
