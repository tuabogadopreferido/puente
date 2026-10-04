-- File bytes and extracted contents stay on the owner's device. These tables
-- contain a catalog and bounded, short-lived WebRTC signaling only.
create table public.document_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id),
  owner_connection_id uuid references public.owner_agent_connections(id),
  human_session_id uuid,
  label text not null check(length(label) between 1 and 100),
  online_until timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(id, company_id)
);
alter table public.documents alter column storage_path drop not null;
alter table public.documents add column source_id uuid;
alter table public.documents add column source_key uuid;
alter table public.documents add column size_bytes integer check(size_bytes between 1 and 20971520);
alter table public.documents add constraint documents_source_fk foreign key(source_id,company_id) references public.document_sources(id,company_id);
alter table public.documents add constraint documents_source_key_unique unique(source_id,source_key);
-- Existing rows are removed by the explicitly authorized MVP reset. NOT VALID
-- makes this migration safe to apply before that reset while guarding new writes.
alter table public.documents add constraint documents_metadata_only check(storage_path is null and extracted_text = '' and source_id is not null and source_key is not null and size_bytes is not null) not valid;

create table public.peer_transfers (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique,
  document_id uuid not null references public.documents(id) on delete cascade,
  source_id uuid not null references public.document_sources(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  receipt_id uuid not null references public.receipts(id),
  bridge_token_hash text,
  owner_user_id uuid,
  owner_connection_id uuid,
  owner_expires_at timestamptz,
  owner_session_id uuid,
  expected_sha256 text not null,
  offer jsonb,
  answer jsonb,
  status text not null default 'pending' check(status in ('pending','connected','completed','cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check((bridge_token_hash is not null) <> (owner_user_id is not null)),
  check(offer is null or octet_length(offer::text) <= 32768),
  check(answer is null or octet_length(answer::text) <= 32768)
);
create index peer_transfers_source_pending on public.peer_transfers(source_id,expires_at) where status in ('pending','connected');
alter table public.document_sources enable row level security;
alter table public.peer_transfers enable row level security;
revoke all on public.document_sources, public.peer_transfers from public, anon, authenticated;
grant all on public.document_sources, public.peer_transfers to service_role;

-- No code path may re-enable a persistent upload using the retired RPCs.
drop function if exists public.claim_document_upload(uuid,uuid,uuid,uuid);
drop function if exists public.finish_document_upload(uuid,uuid,uuid,uuid,jsonb);
drop table if exists public.document_upload_sessions;

alter table public.documents validate constraint documents_metadata_only;
