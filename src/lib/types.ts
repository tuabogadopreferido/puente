export type UUID = string;
export type ISODate = string;
export type DocumentType =
  | 'tax_status' | 'tax_compliance' | 'incorporation' | 'power_of_attorney'
  | 'bank_cover' | 'proof_of_address' | 'repse' | 'representative_id'
  | 'balance_sheet' | 'income_statement' | 'tax_return' | 'other';
export type RequestStatus = 'pending' | 'approved' | 'denied' | 'manual';
export type ApprovalAction = 'approve' | 'deny' | 'manual';
export interface Company { id: UUID; name: string; tax_id: string; contact_email: string; created_at: string }
export interface CompanyMember { user_id: UUID; company_id: UUID; role: 'owner'; created_at: string }
export interface Purpose { id: UUID; company_id: UUID; name: string; created_at: string }
export interface Document { id: UUID; company_id: UUID; title: string; document_type: DocumentType | string; expires_at: ISODate | null; sensitive: boolean; sha256: string; storage_path: string; extracted_text: string; classification_source: string; created_at: string }
export type PuenteDocument = Document;
export interface Rule { id: UUID; company_id: UUID; counterparty_id: UUID | null; document_type: string; purpose_id: UUID; created_at: string }
export interface Bridge { id: UUID; company_a_id: UUID; company_b_id: UUID; status: 'active' | 'revoked'; expires_at: string; created_at: string }
export interface AccessCode { id: UUID; code_hash: string; bridge_id: UUID; actor_company_id: UUID; expires_at: string; used_at: string | null; created_at: string }
export interface AgentToken { id: UUID; token_hash: string; bridge_id: UUID; actor_company_id: UUID; expires_at: string; created_at: string }
export interface DocumentRequest { id: UUID; bridge_id: UUID; requester_company_id: UUID; owner_company_id: UUID; document_id: UUID; purpose_id: UUID | null; purpose_text: string; status: RequestStatus; reason: string; offered_document_ids: UUID[]; manual_response: string | null; email_thread_id: string | null; email_message_id: string | null; created_at: string; updated_at: string }
export interface AccessEvent { id: UUID; company_id: UUID; actor_company_id: UUID; bridge_id: UUID; document_id: UUID | null; action: string; detail: Record<string, unknown>; created_at: string }
export interface Receipt { id: UUID; company_id: UUID; receiver_company_id: UUID; payload: Record<string, unknown>; signature: string | null; public_key: string | null; created_at: string }
export interface ApprovalLink { id: UUID; token_hash: string; request_id: UUID; action: ApprovalAction; expires_at: string; used_at: string | null; created_at: string }
