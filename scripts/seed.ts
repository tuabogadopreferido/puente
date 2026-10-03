/** Seed only synthetic hackathon data. Never point this script at a client database. */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.PUENTE_DEMO_PASSWORD;
if (!url || !secret || !password) throw new Error('Set Supabase URL, service role, and PUENTE_DEMO_PASSWORD. Run node --env-file=.env.local --import tsx scripts/seed.ts');
const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

export const DEMO = {
  acme: '11111111-1111-4111-8111-111111111111',
  globex: '22222222-2222-4222-8222-222222222222',
  bridge: '33333333-3333-4333-8333-333333333333',
};
const companies = [
  { id: DEMO.acme, name: 'Acme Supplies S.A. de C.V.', tax_id: 'ACS260101DE0', contact_email: 'acme@puente.demo', email: 'acme@puente.demo', short: 'Acme Supplies' },
  { id: DEMO.globex, name: 'Globex Servicios S.A. de C.V.', tax_id: 'GSE260101DE0', contact_email: 'globex@puente.demo', email: 'globex@puente.demo', short: 'Globex Servicios' },
];
const purposes = [
  'Alta como proveedor',
  'Celebración de contrato de prestación de servicios o suministro',
  'Cumplimiento de obligaciones fiscales y de REPSE',
  'Pago de contraprestaciones',
];
const fixtures = [
  { type: 'tax_status', title: 'Tax registration certificate', original: 'Constancia de situación fiscal', expiry: null, sensitive: false, lines: ['Tax regime: General corporate regime.', 'Registered activity: Wholesale supplies and professional services.', 'Registration status: Active. Fiscal address: Guadalajara, Jalisco.'] },
  { type: 'tax_compliance', title: 'SAT compliance opinion', original: 'Opinión del cumplimiento de obligaciones fiscales', expiry: '2026-12-31', sensitive: false, lines: ['Compliance opinion: POSITIVE.', 'Review date: 2026-10-03. Valid through: 2026-12-31.', 'No outstanding tax compliance items in this fictional scenario.'] },
  { type: 'incorporation', title: 'Articles of incorporation', original: 'Acta constitutiva', expiry: null, sensitive: false, lines: ['Legal form: Sociedad Anónima de Capital Variable.', 'Incorporation date: 2026-01-01. Duration: Indefinite.', 'Corporate purpose: Supplies and professional services.'] },
  { type: 'power_of_attorney', title: 'Representative power of attorney', original: 'Poder del representante legal', expiry: null, sensitive: false, lines: ['Representative: Alex Demo (fictional).', 'Authority: Execute supply and professional-services agreements.', 'The representative may complete vendor registration formalities.'] },
  { type: 'bank_cover', title: 'Bank account cover', original: 'Carátula bancaria', expiry: null, sensitive: false, lines: ['Institution: Banco de Demostración (fictional).', 'Account reference: DEMO-ACCOUNT-0001. Currency: MXN.', 'This cover contains account identification only; no balances.'] },
  { type: 'repse', title: 'REPSE registration', original: 'Registro de prestadoras de servicios especializados', expiry: '2027-01-01', sensitive: false, lines: ['Registration reference: REPSE-DEMO-2026.', 'Authorized specialty: Technical installation and maintenance.', 'Valid through: 2027-01-01.'] },
  { type: 'balance_sheet', title: 'Balance sheet 2026', original: 'Balance general', expiry: null, sensitive: true, lines: ['Reporting date: 2026-09-30. Currency: MXN.', 'Total assets: $4,500,000. Total liabilities: $1,750,000.', 'Shareholders equity: $2,750,000. Cash: $850,000.', 'Financial information requires a specific owner decision.'] },
  { type: 'proof_of_address', title: 'Expired proof of address', original: 'Comprobante de domicilio vencido', expiry: '2026-09-01', sensitive: false, lines: ['Service address: Avenida Ejemplo 100, Guadalajara, Jalisco.', 'Issue date: 2026-06-01. Valid through: 2026-09-01.', 'This expired fixture demonstrates the exception queue.'] },
] as const;

function fixedId(prefix: string, companyIndex: number, index: number) {
  return `${prefix}0000-${String(companyIndex + 1).padStart(4, '0')}-4000-8000-${String(index + 1).padStart(12, '0')}`;
}
function assertOk(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}
async function makePdf(company: typeof companies[number], fixture: typeof fixtures[number]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${company.short} - ${fixture.original}`);
  pdf.setAuthor('Puente synthetic demo fixtures');
  pdf.setCreationDate(new Date('2026-10-03T12:00:00Z'));
  pdf.setModificationDate(new Date('2026-10-03T12:00:00Z'));
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: rgb(0.07, 0.16, 0.16) });
  page.drawText(company.short, { x: 42, y: 747, font: bold, size: 22, color: rgb(1, 1, 1) });
  page.drawText('SYNTHETIC DEMO DOCUMENT', { x: 42, y: 727, font: regular, size: 9, color: rgb(0.55, 0.92, 0.73) });
  const lines = [fixture.original, company.name, `Fictional RFC: ${company.tax_id}`, '', ...fixture.lines, '', 'Prepared as a fictional source document for the Puente hackathon demo.', 'Not issued by SAT, STPS, a bank, or a notary. Not valid for any filing.', 'Puente stores and delivers these exact original PDF bytes.'];
  let y = 670;
  lines.forEach((line, index) => {
    page.drawText(line, { x: 42, y, font: index === 0 ? bold : regular, size: index === 0 ? 15 : 10, color: rgb(0.12, 0.2, 0.2), maxWidth: 525, lineHeight: 15 });
    y -= index === 0 ? 35 : 25;
  });
  page.drawLine({ start: { x: 42, y: 88 }, end: { x: 570, y: 88 }, color: rgb(0.8, 0.86, 0.84), thickness: 1 });
  page.drawText('Puente / fictional corporate dossier / 2026', { x: 42, y: 65, font: regular, size: 9, color: rgb(0.4, 0.48, 0.46) });
  return { bytes: await pdf.save(), text: `${company.short}\nSYNTHETIC DEMO DOCUMENT\n${lines.join('\n')}\nPuente / fictional corporate dossier / 2026` };
}

async function main() {
  const { data: users, error: userListError } = await supabase.auth.admin.listUsers({ perPage: 100 });
  assertOk(userListError, 'List demo users');
  for (const company of companies) {
    assertOk((await supabase.from('companies').upsert({ id: company.id, name: company.name, tax_id: company.tax_id, contact_email: company.contact_email })).error, 'Company');
    let user = users.users.find(u => u.email === company.email);
    if (!user) {
      const result = await supabase.auth.admin.createUser({ email: company.email, password, email_confirm: true, app_metadata: { demo: true } });
      assertOk(result.error, 'Create demo user');
      user = result.data.user ?? undefined;
    }
    if (!user) throw new Error('Demo user was not created');
    assertOk((await supabase.from('company_members').upsert({ user_id: user.id, company_id: company.id, role: 'owner' })).error, 'Company membership');
  }
  assertOk((await supabase.from('bridges').upsert({ id: DEMO.bridge, company_a_id: DEMO.acme, company_b_id: DEMO.globex, status: 'active', expires_at: '2026-11-03T00:00:00Z' })).error, 'Demo bridge');
  let documentsCreated = 0;
  for (const [companyIndex, company] of companies.entries()) {
    for (const [purposeIndex, name] of purposes.entries()) {
      assertOk((await supabase.from('purposes').upsert({ id: fixedId('aaaa', companyIndex, purposeIndex), company_id: company.id, name })).error, 'Purpose');
    }
    for (const [documentIndex, fixture] of fixtures.entries()) {
      const id = fixedId('dddd', companyIndex, documentIndex);
      const { bytes, text } = await makePdf(company, fixture);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const path = `${company.id}/${id}.pdf`;
      assertOk((await supabase.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true })).error, 'Upload synthetic PDF');
      assertOk((await supabase.from('documents').upsert({ id, company_id: company.id, title: fixture.title, document_type: fixture.type, expires_at: fixture.expiry, sensitive: fixture.sensitive, sha256: hash, storage_path: path, extracted_text: text, classification_source: 'owner_verified_demo_fixture' })).error, 'Document metadata');
      documentsCreated++;
    }
    for (const [ruleIndex, type] of ['tax_status','tax_compliance','incorporation','power_of_attorney','bank_cover','repse','proof_of_address'].entries()) {
      assertOk((await supabase.from('rules').upsert({ id: fixedId('eeee', companyIndex, ruleIndex), company_id: company.id, counterparty_id: companyIndex === 0 ? DEMO.globex : DEMO.acme, document_type: type, purpose_id: fixedId('aaaa', companyIndex, 0) })).error, 'Preapproved rule');
    }
  }
  console.log(JSON.stringify({ success: true, companies: 2, demo_users: companies.map(c => c.email), purposes: 8, documents: documentsCreated, rules: 14, bridge_id: DEMO.bridge, classification: 'Owner-verified synthetic fixtures; Claude ingestion runs on uploads.' }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
