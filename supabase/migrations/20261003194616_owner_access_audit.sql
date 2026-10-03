-- Owner self-access has no external bridge; tenant RLS still applies.
alter table public.access_events alter column bridge_id drop not null;
alter table public.access_events add constraint access_event_scope check (bridge_id is not null or (company_id = actor_company_id and action in ('owner_document_delivered', 'owner_pdf_downloaded')));
