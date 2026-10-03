-- Invitation tokens never grant document access. Acceptance also requires a verified email.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  inviter_company_id uuid not null references public.companies(id),
  created_by_user_id uuid not null references auth.users(id),
  invited_email text not null check (length(invited_email) between 3 and 320 and invited_email = lower(trim(invited_email))),
  company_name text not null check (length(company_name) between 1 and 200),
  purpose_id uuid not null,
  offered_document_ids uuid[] not null check (cardinality(offered_document_ids) between 1 and 100),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  expires_at timestamptz not null,
  accepted_by_user_id uuid references auth.users(id),
  accepted_company_id uuid references public.companies(id),
  bridge_id uuid references public.bridges(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (purpose_id,inviter_company_id) references public.purposes(id,company_id)
);
create index invitations_inviter on public.invitations(inviter_company_id,created_at desc);
create index invitations_creator on public.invitations(created_by_user_id);
create index invitations_purpose on public.invitations(purpose_id,inviter_company_id);
create index invitations_accepted_user on public.invitations(accepted_by_user_id);
create index invitations_accepted_company on public.invitations(accepted_company_id);
create index invitations_bridge on public.invitations(bridge_id);
alter table public.invitations enable row level security;
revoke all on public.invitations from public, anon, authenticated;
grant all on public.invitations to service_role;

-- service_role cannot read auth.users directly. Expose only this private, service-only check.
create schema if not exists puente_private;
revoke all on schema puente_private from public, anon, authenticated;
grant usage on schema puente_private to service_role;
create function puente_private.confirmed_invitation_email(p_user_id uuid)
returns table(email text, confirmed boolean)
language plpgsql security definer stable set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Identity mismatch'; end if;
  return query select u.email::text, u.email_confirmed_at is not null from auth.users u where u.id = p_user_id;
end $$;
revoke all on function puente_private.confirmed_invitation_email(uuid) from public, anon, authenticated;
grant execute on function puente_private.confirmed_invitation_email(uuid) to service_role;

create function public.accept_company_invitation(p_token_hash text,p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.invitations; verified_email text; is_confirmed boolean; company uuid; new_bridge uuid; membership_count integer;
begin
  select * into i from public.invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'Invitation unavailable'; end if;
  select e.email,e.confirmed into verified_email,is_confirmed from puente_private.confirmed_invitation_email(p_user_id) e;
  if verified_email is null or not is_confirmed then raise exception 'Confirmed email required'; end if;
  if lower(trim(verified_email)) <> i.invited_email then raise exception 'Invitation email does not match authenticated user'; end if;
  if i.status = 'accepted' then
    if i.accepted_by_user_id <> p_user_id then raise exception 'Invitation already used'; end if;
    return jsonb_build_object('status','already_accepted','invitation_id',i.id,'company_id',i.accepted_company_id,'bridge_id',i.bridge_id);
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then raise exception 'Invitation expired or cancelled'; end if;
  if not exists(select 1 from public.company_members where user_id=i.created_by_user_id and company_id=i.inviter_company_id and role='owner') then raise exception 'Inviter membership is no longer active'; end if;
  if exists(select 1 from unnest(i.offered_document_ids) offered(id) where not exists(select 1 from public.documents d where d.id=offered.id and d.company_id=i.inviter_company_id)) then raise exception 'Offered documents are unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,112));
  select count(*),min(company_id::text)::uuid into membership_count,company from public.company_members where user_id=p_user_id and role='owner';
  if membership_count > 1 then raise exception 'Choose a single company membership before accepting'; end if;
  if company is null then
    insert into public.companies(name,tax_id,contact_email) values(i.company_name,'',verified_email) returning id into company;
    insert into public.company_members(user_id,company_id,role) values(p_user_id,company,'owner');
    insert into public.purposes(company_id,name) values
      (company,'Alta como proveedor'),
      (company,'Celebración de contrato de prestación de servicios o suministro'),
      (company,'Cumplimiento de obligaciones fiscales y de REPSE'),
      (company,'Pago de contraprestaciones');
  end if;
  if company=i.inviter_company_id then raise exception 'An invitation must connect two different companies'; end if;
  insert into public.bridges(company_a_id,company_b_id,expires_at) values(i.inviter_company_id,company,now()+interval '24 hours') returning id into new_bridge;
  update public.invitations set status='accepted',accepted_by_user_id=p_user_id,accepted_company_id=company,bridge_id=new_bridge,accepted_at=now() where id=i.id;
  insert into public.access_events(company_id,actor_company_id,bridge_id,action,detail) values
    (i.inviter_company_id,company,new_bridge,'invitation_accepted',jsonb_build_object('invitation_id',i.id,'purpose_id',i.purpose_id,'offered_document_count',cardinality(i.offered_document_ids),'automatic_document_access',false)),
    (company,company,new_bridge,'bridge_created',jsonb_build_object('invitation_id',i.id,'counterparty_id',i.inviter_company_id,'automatic_document_access',false));
  return jsonb_build_object('status','accepted','invitation_id',i.id,'company_id',company,'bridge_id',new_bridge);
end $$;
revoke all on function public.accept_company_invitation(text,uuid) from public,anon,authenticated;
grant execute on function public.accept_company_invitation(text,uuid) to service_role;
