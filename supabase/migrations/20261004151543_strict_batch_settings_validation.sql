-- Fail closed even if a privileged internal caller omits mode or adds fields.
create or replace function puente_private.validate_sharing_settings(p_company_id uuid,p_settings jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(jsonb_typeof(p_settings),'null') <> 'object' then raise exception 'Invalid sharing settings'; end if;
  if coalesce(p_settings->>'mode','') not in ('rules','approval') or not(p_settings ? 'allowed_purpose_ids') or exists(select 1 from jsonb_object_keys(p_settings) k where k not in ('mode','allowed_purpose_ids')) then raise exception 'Invalid sharing settings'; end if;
  if p_settings->'allowed_purpose_ids' <> 'null'::jsonb then
    if jsonb_typeof(p_settings->'allowed_purpose_ids')<>'array' then raise exception 'Invalid purposes'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_settings->'allowed_purpose_ids') x(id) where not exists(select 1 from public.purposes p where p.company_id=p_company_id and p.id=x.id::uuid)) then raise exception 'Purpose outside workspace'; end if;
  end if;
end $$;
