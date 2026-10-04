-- A disconnected owner must not leave expired network addresses in signaling.
-- Only coordination metadata is processed; this database contains no PDFs.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('puente-peer-signal-cleanup','* * * * *',$cleanup$
  update public.peer_transfers
    set offer=null,answer=null,status=case when status='completed' then status else 'cancelled' end
    where expires_at<=now() and (offer is not null or answer is not null or status in ('pending','connected'));
  delete from public.peer_transfers where expires_at<now()-interval '24 hours';
$cleanup$);
