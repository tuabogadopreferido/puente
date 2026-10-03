export async function GET() {
 const bearer=[{bearerAuth:[]}];
 const schema={type:'object',required:['document_id'],properties:{document_id:{type:'string',format:'uuid'},purpose_id:{type:'string',format:'uuid'},purpose:{type:'string'},offered_document_ids:{type:'array',items:{type:'string',format:'uuid'}}}};
 const response={description:'JSON result. Delivery includes original PDF download_url, extracted_text, sha256 and an Ed25519 receipt; exceptional requests return pending and request_id.'};
 const op=(summary:string,requestSchema?:unknown)=>({summary,security:bearer,...(requestSchema?{requestBody:{required:true,content:{'application/json':{schema:requestSchema}}}}:{}),responses:{'200':response,'400':{description:'Invalid request'},'401':{description:'Missing, expired or invalid token'},'403':{description:'Bridge revoked, expired or outside token scope'}}});
 return Response.json({openapi:'3.1.0',info:{title:'Puente API',version:'1.0.0',description:'Agent-native bilateral access to private corporate originals. All demo documents and companies are fictional.'},servers:[{url:process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000'}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Scoped token from a one-time bridge code; up to 24 hours.'}}},paths:{
 '/api/access/exchange':{post:{...op('Exchange a one-time code for a scoped token',{type:'object',required:['code'],properties:{code:{type:'string'}}}),security:[]}},
 '/api/documents':{get:op('List counterpart metadata, closed privacy purposes and reciprocal offers')},
 '/api/requests':{post:op('Request an original document with a purpose and reciprocal offer',schema)},
 '/api/documents/{id}/request':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],post:op('Request a specific original PDF',{...schema,required:[],properties:{purpose_id:{type:'string',format:'uuid'},purpose:{type:'string'},offered_document_ids:{type:'array',items:{type:'string',format:'uuid'}}}})},
 '/api/requests/{id}':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],get:op('Poll an approval and retrieve the original after approval')},
 '/api/receipts/verify':{get:{summary:'Get the server Ed25519 public key',responses:{'200':{description:'Public key'}}},post:{...op('Verify a receipt with the server key',{type:'object',required:['payload','signature'],properties:{payload:{type:'object',additionalProperties:true},signature:{type:'string'}}}),security:[]}},
 '/api/health':{get:{summary:'Database-backed health',responses:{'200':{description:'Healthy'},'503':{description:'Unavailable'}}}}
 }});
}
