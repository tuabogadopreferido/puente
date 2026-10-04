-- Human logins last 30 days. Owner-agent connections and bridge tokens have
-- independent lifetimes and never consult this allowlist.
alter table public.companies alter column tax_id drop not null;

create table public.email_login_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null check (length(display_name) between 1 and 200),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  code_hash text check (code_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','ready','verifying','used','failed')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index email_login_email_time on public.email_login_challenges(email,created_at desc);
create index email_login_ip_time on public.email_login_challenges(ip_hash,created_at desc);
create index email_login_user on public.email_login_challenges(user_id);
create table public.human_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at = created_at + interval '30 days')
);
create index human_sessions_user on public.human_sessions(user_id);
alter table public.email_login_challenges enable row level security;
alter table public.human_sessions enable row level security;
revoke all on public.email_login_challenges, public.human_sessions from public, anon, authenticated;
grant all on public.email_login_challenges, public.human_sessions to service_role;

create function public.reserve_email_login(p_email text,p_name text,p_ip_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare challenge uuid;
begin
  if p_email <> lower(trim(p_email)) or length(p_email) > 320 or p_email not like '%@%' or length(trim(p_name)) not between 1 and 200 then raise exception 'Invalid login request'; end if;
  -- Serialize global limit and reservations, including across concurrent functions.
  perform pg_advisory_xact_lock(790163041);
  delete from public.email_login_challenges where created_at < now() - interval '24 hours';
  if exists(select 1 from public.email_login_challenges where email=p_email and created_at > now()-interval '60 seconds')
    or (select count(*) from public.email_login_challenges where email=p_email and created_at > now()-interval '1 hour') >= 5
    or (select count(*) from public.email_login_challenges where ip_hash=p_ip_hash and created_at > now()-interval '1 hour') >= 20
    or (select count(*) from public.email_login_challenges where created_at > now()-interval '1 hour') >= 200
    then return jsonb_build_object('rate_limited',true); end if;
  update public.email_login_challenges set status='failed' where email=p_email and status in ('pending','ready');
  insert into public.email_login_challenges(email,display_name,ip_hash) values(p_email,trim(p_name),p_ip_hash) returning id into challenge;
  return jsonb_build_object('challenge_id',challenge);
end $$;

create function public.claim_email_login(p_challenge_id uuid,p_email text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.email_login_challenges;
begin
  select * into c from public.email_login_challenges where id=p_challenge_id for update;
  if not found or c.status <> 'ready' or c.expires_at <= now() or c.attempts >= 6 or c.email <> p_email then return jsonb_build_object('valid',false); end if;
  update public.email_login_challenges set attempts=attempts+1 where id=c.id;
  if c.code_hash is null or c.code_hash <> p_code_hash then return jsonb_build_object('valid',false); end if;
  update public.email_login_challenges set status='verifying' where id=c.id;
  return jsonb_build_object('valid',true);
end $$;

-- Auth's private schema is intentionally read only through a tightly scoped
-- service-role helper, never through client-controlled user_metadata.
create function puente_private.verified_login_session(p_user_id uuid,p_session_id uuid)
returns table(email text, session_created_at timestamptz)
language plpgsql security definer stable set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  return query select u.email::text,s.created_at from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_user_id and s.id=p_session_id and u.email_confirmed_at is not null;
end $$;
revoke all on function puente_private.verified_login_session(uuid,uuid) from public,anon,authenticated;
grant execute on function puente_private.verified_login_session(uuid,uuid) to service_role;

create function public.finish_email_login(p_challenge_id uuid,p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.email_login_challenges; verified_email text; session_created timestamptz; company uuid; membership_count integer;
begin
  select * into c from public.email_login_challenges where id=p_challenge_id for update;
  if not found or c.status <> 'verifying' or c.user_id <> p_user_id or c.expires_at <= now() then raise exception 'Login challenge unavailable'; end if;
  select s.email,s.session_created_at into verified_email,session_created from puente_private.verified_login_session(p_user_id,p_session_id) s;
  if verified_email is null or lower(trim(verified_email)) <> c.email or session_created < c.created_at or session_created + interval '30 days' <= now() then raise exception 'Verified session required'; end if;
  -- Same lock as invitation acceptance: a user gets one private workspace.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,112));
  select count(*),min(company_id::text)::uuid into membership_count,company from public.company_members where user_id=p_user_id and role='owner';
  if membership_count > 1 then raise exception 'Ambiguous company membership'; end if;
  if company is null then
    insert into public.companies(name,tax_id,contact_email) values(c.display_name,null,verified_email) returning id into company;
    insert into public.company_members(user_id,company_id,role) values(p_user_id,company,'owner');
    insert into public.purposes(company_id,name) values
      (company,'Alta como proveedor'),
      (company,'Celebración de contrato de prestación de servicios o suministro'),
      (company,'Cumplimiento de obligaciones fiscales y de REPSE'),
      (company,'Pago de contraprestaciones');
  end if;
  insert into public.human_sessions(session_id,user_id,created_at,expires_at)
    values(p_session_id,p_user_id,session_created,session_created+interval '30 days');
  update public.email_login_challenges set status='used',code_hash=null where id=c.id;
  return jsonb_build_object('company_id',company,'expires_at',session_created+interval '30 days');
end $$;

revoke all on function public.reserve_email_login(text,text,text), public.claim_email_login(uuid,text,text), public.finish_email_login(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_email_login(text,text,text), public.claim_email_login(uuid,text,text), public.finish_email_login(uuid,uuid,uuid) to service_role;

-- JWT refresh keeps the same session_id. Both RLS and server endpoints enforce
-- the original login's fixed expiry; refreshing cannot extend the 30 days.
create function puente_private.human_session_active()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.human_sessions s
    where s.user_id=(select auth.uid()) and s.session_id::text=(select auth.jwt()->>'session_id')
      and s.revoked_at is null and s.expires_at > now());
$$;
revoke all on function puente_private.human_session_active() from public,anon;
grant usage on schema puente_private to authenticated;
grant execute on function puente_private.human_session_active() to authenticated;
do $$ declare table_name text; begin
  foreach table_name in array array['companies','company_members','purposes','documents','rules','bridges','requests','access_events','receipts'] loop
    execute format('create policy human_session_required on public.%I as restrictive for all to authenticated using ((select puente_private.human_session_active())) with check ((select puente_private.human_session_active()))',table_name);
  end loop;
end $$;
