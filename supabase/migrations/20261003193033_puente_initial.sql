-- Puente: private corporate dossiers, bilateral access, atomic credentials.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  tax_id text not null,
  contact_email text not null,
  created_at timestamptz not null default now()
);
create table public.company_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create table public.purposes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(name) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (company_id, name), unique (id, company_id)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  title text not null,
  document_type text not null,
  expires_at date,
  sensitive boolean not null default true,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  extracted_text text not null default '',
  classification_source text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  counterparty_id uuid references public.companies(id),
  document_type text not null,
  purpose_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (purpose_id, company_id) references public.purposes(id, company_id),
  unique nulls not distinct (company_id, counterparty_id, document_type, purpose_id)
);
create table public.bridges (
  id uuid primary key default gen_random_uuid(),
  company_a_id uuid not null references public.companies(id),
  company_b_id uuid not null references public.companies(id),
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  check (company_a_id <> company_b_id)
);
create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  bridge_id uuid not null references public.bridges(id),
  actor_company_id uuid not null references public.companies(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  bridge_id uuid not null references public.bridges(id),
  actor_company_id uuid not null references public.companies(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.bridges(id),
  requester_company_id uuid not null references public.companies(id),
  owner_company_id uuid not null references public.companies(id),
  document_id uuid not null,
  purpose_id uuid,
  purpose_text text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'manual')),
  reason text not null,
  offered_document_ids uuid[] not null default '{}',
  manual_response text,
  email_thread_id text,
  email_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, owner_company_id) references public.documents(id, company_id),
  foreign key (purpose_id, owner_company_id) references public.purposes(id, company_id),
  check (requester_company_id <> owner_company_id)
);
create table public.access_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_company_id uuid not null references public.companies(id),
  bridge_id uuid not null references public.bridges(id),
  document_id uuid references public.documents(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  receiver_company_id uuid not null references public.companies(id),
  payload jsonb not null,
  signature text,
  public_key text,
  created_at timestamptz not null default now()
);
create table public.approval_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid not null references public.requests(id),
  action text not null check (action in ('approve', 'deny', 'manual')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index company_members_company on public.company_members(company_id);
create index documents_company on public.documents(company_id, document_type, created_at desc);
create index rules_counterparty on public.rules(counterparty_id);
create index rules_purpose on public.rules(purpose_id, company_id);
create index bridges_company_a on public.bridges(company_a_id);
create index bridges_company_b on public.bridges(company_b_id);
create index access_codes_bridge on public.access_codes(bridge_id);
create index access_codes_actor on public.access_codes(actor_company_id);
create index agent_tokens_bridge on public.agent_tokens(bridge_id);
create index agent_tokens_actor on public.agent_tokens(actor_company_id);
create index requests_owner on public.requests(owner_company_id, created_at desc);
create index requests_requester on public.requests(requester_company_id, created_at desc);
create index requests_bridge on public.requests(bridge_id);
create index requests_document_owner on public.requests(document_id, owner_company_id);
create index requests_purpose_owner on public.requests(purpose_id, owner_company_id);
create index requests_email_thread on public.requests(email_thread_id) where email_thread_id is not null;
create index access_events_company_time on public.access_events(company_id, created_at desc);
create index access_events_actor on public.access_events(actor_company_id);
create index access_events_bridge on public.access_events(bridge_id);
create index access_events_document on public.access_events(document_id);
create index receipts_company on public.receipts(company_id, created_at desc);
create index receipts_receiver on public.receipts(receiver_company_id);
create index approval_links_request on public.approval_links(request_id);

-- All browser access is read-only. Secret-bearing rows have no browser grants.
do $$ declare table_name text; begin
  foreach table_name in array array['companies','company_members','purposes','documents','rules','bridges','access_codes','agent_tokens','requests','access_events','receipts','approval_links'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;
grant select on public.companies, public.company_members, public.purposes, public.documents,
  public.rules, public.bridges, public.requests, public.access_events, public.receipts to authenticated;
create policy own_membership on public.company_members for select to authenticated using (user_id = (select auth.uid()));
create policy company_directory on public.companies for select to authenticated using (
  id in (select company_id from public.company_members where user_id = (select auth.uid()))
  or exists (select 1 from public.bridges b where (b.company_a_id = companies.id or b.company_b_id = companies.id)
    and (b.company_a_id in (select company_id from public.company_members where user_id = (select auth.uid()))
      or b.company_b_id in (select company_id from public.company_members where user_id = (select auth.uid()))))
);
create policy owner_purposes on public.purposes for select to authenticated using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy owner_documents on public.documents for select to authenticated using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy owner_rules on public.rules for select to authenticated using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy participant_bridges on public.bridges for select to authenticated using (
  company_a_id in (select company_id from public.company_members where user_id = (select auth.uid()))
  or company_b_id in (select company_id from public.company_members where user_id = (select auth.uid()))
);
create policy participant_requests on public.requests for select to authenticated using (
  owner_company_id in (select company_id from public.company_members where user_id = (select auth.uid()))
  or requester_company_id in (select company_id from public.company_members where user_id = (select auth.uid()))
);
create policy owner_access_events on public.access_events for select to authenticated using (company_id in (select company_id from public.company_members where user_id = (select auth.uid())));
create policy participant_receipts on public.receipts for select to authenticated using (
  company_id in (select company_id from public.company_members where user_id = (select auth.uid()))
  or receiver_company_id in (select company_id from public.company_members where user_id = (select auth.uid()))
);

-- SECURITY INVOKER is intentional. Only the backend service role can execute.
create function public.redeem_access_code(p_code_hash text, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.access_codes; b public.bridges; t public.agent_tokens;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
  select * into c from public.access_codes where code_hash = p_code_hash for update;
  if not found or c.used_at is not null or c.expires_at <= now() then raise exception 'Code expired or already used'; end if;
  select * into b from public.bridges where id = c.bridge_id for share;
  if not found or b.status <> 'active' or b.expires_at <= now()
    or c.actor_company_id not in (b.company_a_id, b.company_b_id) then raise exception 'Bridge inactive'; end if;
  update public.access_codes set used_at = now() where id = c.id;
  insert into public.agent_tokens(token_hash, bridge_id, actor_company_id, expires_at)
    values (p_token_hash, c.bridge_id, c.actor_company_id, least(now() + interval '24 hours', b.expires_at)) returning * into t;
  return jsonb_build_object('bridge_id',t.bridge_id,'actor_company_id',t.actor_company_id,'expires_at',t.expires_at);
end $$;
revoke all on function public.redeem_access_code(text,text) from public, anon, authenticated;
grant execute on function public.redeem_access_code(text,text) to service_role;

create function public.resolve_access_request(
  p_request_id uuid, p_owner_company_id uuid, p_action text,
  p_create_rule boolean default false, p_manual_response text default null, p_token_hash text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.requests; b public.bridges; d public.documents; l public.approval_links; new_status text; rule_created boolean := false;
begin
  if p_action not in ('approve','deny','manual') then raise exception 'Invalid approval action'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if not found or r.owner_company_id <> p_owner_company_id then raise exception 'Request not found'; end if;
  if r.status not in ('pending','manual') then raise exception 'Request already resolved'; end if;
  select * into b from public.bridges where id = r.bridge_id for share;
  if not found or b.status <> 'active' or b.expires_at <= now()
    or r.owner_company_id not in (b.company_a_id,b.company_b_id)
    or r.requester_company_id not in (b.company_a_id,b.company_b_id) then raise exception 'Bridge inactive'; end if;
  select * into d from public.documents where id = r.document_id and company_id = r.owner_company_id;
  if not found then raise exception 'Document not found'; end if;
  if p_token_hash is not null then
    select * into l from public.approval_links where token_hash = p_token_hash and request_id = r.id and action = p_action for update;
    if not found or l.used_at is not null or l.expires_at <= now() then raise exception 'Approval link expired or already used'; end if;
  end if;
  update public.approval_links set used_at = now() where request_id = r.id and used_at is null;
  new_status := case p_action when 'approve' then 'approved' when 'deny' then 'denied' else 'manual' end;
  update public.requests set status = new_status, manual_response = coalesce(p_manual_response, manual_response), updated_at = now()
    where id = r.id returning * into r;
  if p_action = 'approve' and p_create_rule and r.purpose_id is not null and not d.sensitive and (d.expires_at is null or d.expires_at >= current_date) then
    insert into public.rules(company_id,counterparty_id,document_type,purpose_id)
      values(r.owner_company_id,r.requester_company_id,d.document_type,r.purpose_id) on conflict do nothing;
    rule_created := true;
  end if;
  insert into public.access_events(company_id,actor_company_id,bridge_id,document_id,action,detail)
    values(r.owner_company_id,r.owner_company_id,r.bridge_id,r.document_id,'request_' || new_status,
      jsonb_build_object('request_id',r.id,'rule_created',rule_created,'via',case when p_token_hash is null then 'owner' else 'approval_link' end));
  return to_jsonb(r) || jsonb_build_object('rule_created',rule_created);
end $$;
revoke all on function public.resolve_access_request(uuid,uuid,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.resolve_access_request(uuid,uuid,text,boolean,text,text) to service_role;

create function public.consume_approval_link(p_token_hash text, p_action text, p_create_rule boolean default false, p_manual_response text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.approval_links; r public.requests;
begin
  select * into l from public.approval_links where token_hash = p_token_hash and action = p_action;
  if not found then raise exception 'Approval link not found'; end if;
  select * into r from public.requests where id = l.request_id;
  return public.resolve_access_request(r.id,r.owner_company_id,p_action,p_create_rule,p_manual_response,p_token_hash);
end $$;
revoke all on function public.consume_approval_link(text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.consume_approval_link(text,text,boolean,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('documents','documents',false,20971520,array['application/pdf'])
  on conflict (id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf'];
-- No storage.objects policy: only authorized backend requests can issue links.
alter publication supabase_realtime add table public.access_events, public.requests, public.bridges;
