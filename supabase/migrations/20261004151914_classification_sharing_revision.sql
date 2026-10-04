-- A newly sensitive, expired or reclassified original needs a fresh request.
create function puente_private.bump_classification_sharing_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.document_type is distinct from old.document_type
    or new.sensitive is distinct from old.sensitive
    or new.expires_at is distinct from old.expires_at
    or new.classification_source is distinct from old.classification_source then
    new.sharing_revision:=greatest(new.sharing_revision,old.sharing_revision)+1;
  end if;
  return new;
end $$;
revoke all on function puente_private.bump_classification_sharing_revision() from public,anon,authenticated;
grant execute on function puente_private.bump_classification_sharing_revision() to service_role;
create trigger document_classification_sharing_revision
before update of document_type,sensitive,expires_at,classification_source on public.documents
for each row execute function puente_private.bump_classification_sharing_revision();
