alter table public.access_events drop constraint access_event_scope;
alter table public.access_events add constraint access_event_scope check (
  bridge_id is not null or (company_id = actor_company_id and action in (
    'owner_document_delivered', 'owner_pdf_downloaded', 'owner_peer_transfer_authorized', 'peer_document_received'
  ))
);
-- Receipt acknowledgement and signaling cleanup commit together. No document
-- bytes enter this function; the acknowledgement is explicitly receiver-reported.
create function public.complete_peer_transfer(p_transfer_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.peer_transfers; actor uuid; b uuid;
begin
  select * into t from public.peer_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer unavailable' using errcode='P0002'; end if;
  if t.status='completed' then return jsonb_build_object('ok',true); end if;
  if t.status<>'connected' or t.expires_at<=now() then raise exception 'Transfer not connected' using errcode='22023'; end if;
  actor:=t.company_id;
  if t.bridge_token_hash is not null then
    select actor_company_id, bridge_id into actor,b from public.agent_tokens where token_hash=t.bridge_token_hash;
    if actor is null then raise exception 'Bridge token revoked' using errcode='42501'; end if;
  end if;
  insert into public.access_events(company_id,actor_company_id,bridge_id,document_id,action,detail)
    values(t.company_id,actor,b,t.document_id,'peer_document_received',jsonb_build_object('receipt_id',t.receipt_id,'sha256',t.expected_sha256,'transport','webrtc','receiver_reported',true));
  update public.peer_transfers set status='completed',offer=null,answer=null where id=t.id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.complete_peer_transfer(uuid) from public,anon,authenticated;
grant execute on function public.complete_peer_transfer(uuid) to service_role;
