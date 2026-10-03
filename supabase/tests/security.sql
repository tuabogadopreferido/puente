-- Read-only deployment checks. Every returned value must be true.
select bool_and(c.relrowsecurity) as every_table_has_rls,
       bool_and(not has_table_privilege('anon',c.oid,'select,insert,update,delete')) as anonymous_has_no_access,
       bool_and(not has_table_privilege('authenticated',c.oid,'insert,update,delete')) as browsers_cannot_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r';
select bool_and(not p.prosecdef) as no_security_definer,
       bool_and(not has_function_privilege('anon',p.oid,'execute')) as anonymous_cannot_execute,
       bool_and(not has_function_privilege('authenticated',p.oid,'execute')) as browsers_cannot_execute,
       bool_and(has_function_privilege('service_role',p.oid,'execute')) as backend_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
select not public as documents_bucket_is_private from storage.buckets where id='documents';
