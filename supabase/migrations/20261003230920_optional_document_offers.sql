-- Document offers are optional for invitations as well as requests.
-- Ownership validation for every supplied offer remains in the API and acceptance RPC.
alter table public.invitations
  drop constraint invitations_offered_document_ids_check;
alter table public.invitations
  alter column offered_document_ids set default '{}',
  add constraint invitations_offered_document_ids_check
    check (cardinality(offered_document_ids) between 0 and 100);
