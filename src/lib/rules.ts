import type { PuenteDocument, Rule, Purpose } from './types';
export interface RuleDecision { allowed: boolean; reason: string }
export function decideAccess(doc: PuenteDocument, purpose: Purpose | null, rules: Rule[], actorCompanyId: string, now = new Date()): RuleDecision {
  if (!purpose || purpose.company_id !== doc.company_id) return { allowed: false, reason: 'The purpose is outside the owner’s approved privacy notice.' };
  if (doc.sensitive || ['balance_sheet', 'income_statement', 'tax_return'].includes(doc.document_type)) return { allowed: false, reason: 'Financial information requires a decision by the owner.' };
  if (['awaiting_owner_review', 'unclassified'].includes(doc.classification_source) || doc.document_type === 'other') return { allowed: false, reason: 'The document needs an owner classification review.' };
  if (doc.expires_at && doc.expires_at < now.toISOString().slice(0,10)) return { allowed: false, reason: 'The document has expired and requires an owner decision.' };
  const match = rules.some(r => r.company_id === doc.company_id && r.document_type === doc.document_type && r.purpose_id === purpose.id && (!r.counterparty_id || r.counterparty_id === actorCompanyId));
  return match ? { allowed: true, reason: 'Matched a preapproved document, counterparty and purpose rule.' } : { allowed: false, reason: 'No preapproved rule covers this document, company and purpose.' };
}
