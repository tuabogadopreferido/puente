-- Private upload capabilities. Browser roles have no direct session/table access.
create table public.document_upload_sessions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id),
  filename text not null check (length(filename) between 1 and 255),
  expected_size bigint not null check (expected_size between 1 and 20971520),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  expires_at timestamptz not null default now() + interval '2 hours',
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (storage_path = company_id::text || '/' || id::text || '.pdf'),
  check ((status = 'processing') = (lease_id is not null and lease_until is not null)),
  check ((status = 'completed') = (completed_at is not null))
);
alter table public.document_upload_sessions enable row level security;
revoke all on public.document_upload_sessions from public, anon, authenticated;
grant all on public.document_upload_sessions to service_role;
create index document_upload_sessions_expiry on public.document_upload_sessions(expires_at) where status <> 'completed';
comment on table public.document_upload_sessions is
  'Private server-owned upload sessions. Cleanup may remove only this recorded path after expires_at plus five minutes, when its signed upload capability has expired. Completed originals must never be removed by session cleanup.';

create function public.claim_document_upload(
  p_upload_id uuid, p_user_id uuid, p_company_id uuid, p_lease_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.document_upload_sessions; d public.documents;
begin
  select * into s from public.document_upload_sessions where id = p_upload_id for update;
  if not found or s.user_id <> p_user_id or s.company_id <> p_company_id then
    raise exception using errcode = 'P0002', message = 'upload_not_found';
  end if;
  if not exists(select 1 from public.company_members where user_id = p_user_id and company_id = p_company_id and role = 'owner') then
    raise exception using errcode = '42501', message = 'upload_forbidden';
  end if;
  if s.status = 'completed' then
    select * into d from public.documents where id = s.id and company_id = s.company_id;
    if not found then raise exception using errcode = 'P0002', message = 'upload_document_not_found'; end if;
    return jsonb_build_object('status','completed','document',to_jsonb(d));
  end if;
  if s.expires_at <= now() or s.status = 'failed' then
    raise exception using errcode = '22023', message = 'upload_expired_or_failed';
  end if;
  if s.status = 'processing' and s.lease_until > now() then
    raise exception using errcode = '55P03', message = 'upload_in_progress';
  end if;
  if p_lease_id is null then raise exception using errcode = '22023', message = 'invalid_upload_lease'; end if;
  update public.document_upload_sessions
    set status = 'processing', lease_id = p_lease_id, lease_until = now() + interval '3 minutes'
    where id = s.id returning * into s;
  return jsonb_build_object('status','processing','session',to_jsonb(s));
end $$;
revoke all on function public.claim_document_upload(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_document_upload(uuid,uuid,uuid,uuid) to service_role;

create function public.finish_document_upload(
  p_upload_id uuid, p_user_id uuid, p_company_id uuid, p_lease_id uuid, p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.document_upload_sessions; d public.documents; kind text; source text;
begin
  select * into s from public.document_upload_sessions where id = p_upload_id for update;
  if not found or s.user_id <> p_user_id or s.company_id <> p_company_id then
    raise exception using errcode = 'P0002', message = 'upload_not_found';
  end if;
  if not exists(select 1 from public.company_members where user_id = p_user_id and company_id = p_company_id and role = 'owner') then
    raise exception using errcode = '42501', message = 'upload_forbidden';
  end if;
  if s.status = 'completed' then
    select * into d from public.documents where id = s.id and company_id = s.company_id;
    if not found then raise exception using errcode = 'P0002', message = 'upload_document_not_found'; end if;
    return to_jsonb(d);
  end if;
  if s.expires_at <= now() then raise exception using errcode = '22023', message = 'upload_expired_or_failed'; end if;
  if s.status <> 'processing' or s.lease_id is distinct from p_lease_id or s.lease_until <= now() then
    raise exception using errcode = '55P03', message = 'upload_lease_lost';
  end if;
  kind := p_metadata->>'document_type';
  source := p_metadata->>'classification_source';
  if kind is null or kind not in ('tax_status','tax_compliance','incorporation','power_of_attorney','bank_cover','proof_of_address','repse','representative_id','balance_sheet','income_statement','tax_return','other')
    or source is null or source not in ('claude_anthropic','claude_ai_gateway','awaiting_owner_review')
    or coalesce(p_metadata->>'sha256','') !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_metadata->>'title','')) not between 1 and 180
    or jsonb_typeof(p_metadata->'sensitive') is distinct from 'boolean'
  then raise exception using errcode = '22023', message = 'invalid_upload_metadata'; end if;
  insert into public.documents(
    id, company_id, title, document_type, expires_at, sensitive, sha256, storage_path, extracted_text, classification_source
  ) values (
    s.id, s.company_id, p_metadata->>'title', kind, (p_metadata->>'expires_at')::date,
    case when kind in ('balance_sheet','income_statement','tax_return') then true
      when kind in ('tax_status','tax_compliance','incorporation','power_of_attorney','bank_cover','proof_of_address','repse','representative_id') then false
      else (p_metadata->>'sensitive')::boolean end,
    p_metadata->>'sha256', s.storage_path, left(coalesce(p_metadata->>'extracted_text',''),200000), source
  ) returning * into d;
  update public.document_upload_sessions
    set status = 'completed', completed_at = now(), lease_id = null, lease_until = null
    where id = s.id;
  return to_jsonb(d);
end $$;
revoke all on function public.finish_document_upload(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_document_upload(uuid,uuid,uuid,uuid,jsonb) to service_role;
