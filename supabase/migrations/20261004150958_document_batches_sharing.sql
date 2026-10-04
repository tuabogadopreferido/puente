-- Batch and document-level sharing settings. No original file contents are stored.
create table public.document_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check(length(name) between 1 and 100),
  settings jsonb not null default '{"mode":"rules","allowed_purpose_ids":null}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  unique(id,company_id)
);
create index document_batches_company on public.document_batches(company_id);
alter table public.document_batches enable row level security;
revoke all on public.document_batches from public,anon,authenticated;
grant all on public.document_batches to service_role;
alter table public.documents add column batch_id uuid;
alter table public.documents add column sharing_override jsonb;
alter table public.documents add column sharing_revision bigint not null default 0;
alter table public.documents add constraint documents_batch_company foreign key(batch_id,company_id) references public.document_batches(id,company_id);
create index documents_batch on public.documents(batch_id);
alter table public.requests add column sharing_revision text not null default '0:none:0';

create function puente_private.require_sharing_owner(p_company_id uuid,p_user_id uuid,p_connection_id uuid,p_session_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_user_id and role='owner') then raise exception 'Owner membership required'; end if;
  if p_connection_id is not null then
    if not exists(select 1 from public.owner_agent_connections where id=p_connection_id and user_id=p_user_id and company_id=p_company_id and revoked_at is null) then raise exception 'Owner connection unavailable'; end if;
  elsif p_session_id is not null then
    if not exists(select 1 from public.human_sessions where session_id=p_session_id and user_id=p_user_id and expires_at>now() and revoked_at is null) then raise exception 'Human session unavailable'; end if;
  else raise exception 'Owner credential required'; end if;
end $$;
create function puente_private.validate_sharing_settings(p_company_id uuid,p_settings jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_settings is null or jsonb_typeof(p_settings)<>'object' or p_settings->>'mode' not in ('rules','approval') or not(p_settings ? 'allowed_purpose_ids') then raise exception 'Invalid sharing settings'; end if;
  if p_settings->'allowed_purpose_ids' <> 'null'::jsonb then
    if jsonb_typeof(p_settings->'allowed_purpose_ids')<>'array' then raise exception 'Invalid purposes'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_settings->'allowed_purpose_ids') x(id) where not exists(select 1 from public.purposes p where p.company_id=p_company_id and p.id=x.id::uuid)) then raise exception 'Purpose outside workspace'; end if;
  end if;
end $$;
revoke all on function puente_private.require_sharing_owner(uuid,uuid,uuid,uuid),puente_private.validate_sharing_settings(uuid,jsonb) from public,anon,authenticated;
grant execute on function puente_private.require_sharing_owner(uuid,uuid,uuid,uuid),puente_private.validate_sharing_settings(uuid,jsonb) to service_role;

create function public.save_document_batch(p_company_id uuid,p_user_id uuid,p_connection_id uuid,p_session_id uuid,p_batch_id uuid,p_name text,p_document_ids uuid[],p_settings jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.document_batches; batch uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,81731));
  perform puente_private.require_sharing_owner(p_company_id,p_user_id,p_connection_id,p_session_id);
  if p_document_ids is not null and exists(select 1 from unnest(p_document_ids) x(id) where not exists(select 1 from public.documents d where d.id=x.id and d.company_id=p_company_id)) then raise exception 'Document outside workspace'; end if;
  if p_settings is not null then perform puente_private.validate_sharing_settings(p_company_id,p_settings); end if;
  if p_batch_id is null then
    if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Batch name required'; end if;
    insert into public.document_batches(company_id,name,settings) values(p_company_id,trim(p_name),coalesce(p_settings,'{"mode":"rules","allowed_purpose_ids":null}'::jsonb)) returning id into batch;
  else
    select * into b from public.document_batches where id=p_batch_id and company_id=p_company_id for update;
    if not found then raise exception 'Batch unavailable'; end if;
    batch:=b.id;
    update public.document_batches set name=coalesce(trim(p_name),name),settings=coalesce(p_settings,settings),revision=revision+case when p_settings is not null and p_settings is distinct from settings then 1 else 0 end where id=batch;
  end if;
  if p_document_ids is not null then
    update public.documents set batch_id=null,sharing_revision=sharing_revision+1 where company_id=p_company_id and batch_id=batch and not(id=any(p_document_ids));
    update public.documents set batch_id=batch,sharing_revision=sharing_revision+1 where company_id=p_company_id and id=any(p_document_ids) and batch_id is distinct from batch;
  end if;
  return jsonb_build_object('id',batch);
end $$;

create function public.set_document_sharing(p_company_id uuid,p_user_id uuid,p_connection_id uuid,p_session_id uuid,p_document_id uuid,p_patch jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.documents; next_batch uuid; next_override jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,81731));
  perform puente_private.require_sharing_owner(p_company_id,p_user_id,p_connection_id,p_session_id);
  select * into d from public.documents where id=p_document_id and company_id=p_company_id for update;
  if not found then raise exception 'Document unavailable'; end if;
  next_batch:=d.batch_id;next_override:=d.sharing_override;
  if p_patch ? 'batch_id' then
    next_batch:=(p_patch->>'batch_id')::uuid;
    if next_batch is not null and not exists(select 1 from public.document_batches where id=next_batch and company_id=p_company_id) then raise exception 'Batch outside workspace'; end if;
  end if;
  if p_patch ? 'override' then
    next_override:=nullif(p_patch->'override','null'::jsonb);
    if next_override is not null then perform puente_private.validate_sharing_settings(p_company_id,next_override); end if;
  end if;
  if next_batch is distinct from d.batch_id or next_override is distinct from d.sharing_override then
    update public.documents set batch_id=next_batch,sharing_override=next_override,sharing_revision=sharing_revision+1 where id=d.id;
  end if;
end $$;
revoke all on function public.save_document_batch(uuid,uuid,uuid,uuid,uuid,text,uuid[],jsonb),public.set_document_sharing(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_document_batch(uuid,uuid,uuid,uuid,uuid,text,uuid[],jsonb),public.set_document_sharing(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
