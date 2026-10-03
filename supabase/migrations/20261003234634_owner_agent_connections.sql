-- Durable owner credentials remain private, store hashes only, and are revocable.
create table public.owner_agent_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null check (length(label) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (user_id, company_id)
    references public.company_members(user_id, company_id) on delete cascade
);
alter table public.owner_agent_connections enable row level security;
revoke all on public.owner_agent_connections from public, anon, authenticated;
grant all on public.owner_agent_connections to service_role;
create index owner_agent_connections_owner
  on public.owner_agent_connections(user_id, company_id, created_at desc);
comment on table public.owner_agent_connections is
  'Owner-created access without automatic expiry. Only a SHA-256 token hash is stored; the creator may revoke each connection. Every use checks current owner membership and revoked_at. Never expose token_hash through the UI.';
