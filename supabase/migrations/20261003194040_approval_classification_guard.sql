-- Unreviewed classification must not become a reusable sharing rule.
create or replace function public.resolve_access_request(
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
  select * into d from public.documents where id = r.document_id and company_id = r.owner_company_id for share;
  if not found then raise exception 'Document not found'; end if;
  if p_token_hash is not null then
    select * into l from public.approval_links where token_hash = p_token_hash and request_id = r.id and action = p_action for update;
    if not found or l.used_at is not null or l.expires_at <= now() then raise exception 'Approval link expired or already used'; end if;
  end if;
  update public.approval_links set used_at = now() where request_id = r.id and used_at is null;
  new_status := case p_action when 'approve' then 'approved' when 'deny' then 'denied' else 'manual' end;
  update public.requests set status = new_status, manual_response = coalesce(p_manual_response, manual_response), updated_at = now()
    where id = r.id returning * into r;
  if p_action = 'approve' and p_create_rule and r.purpose_id is not null and not d.sensitive and d.classification_source not in ('awaiting_owner_review','unclassified') and (d.expires_at is null or d.expires_at >= current_date) then
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

