-- Appliquée le 2026-11-22 (audit). Les fonctions d'aide des règles d'accès (has_role, is_member, is_platform_admin)
-- quittent le schéma exposé « public » : elles ne sont plus appelables via /rest/v1/rpc/…, mais les règles
-- (qui les référencent par identifiant) continuent de fonctionner. Les 4 fonctions qui les appelaient par leur nom sont recréées.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.has_role(uuid, text[]) set schema private;
alter function public.is_member(uuid) set schema private;
alter function public.is_platform_admin() set schema private;
revoke execute on function private.has_role(uuid, text[]), private.is_member(uuid), private.is_platform_admin() from public, anon;
grant execute on function private.has_role(uuid, text[]), private.is_member(uuid), private.is_platform_admin() to authenticated;

do $$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_vendor_form','revoke_vendor_form','register_webhook_key','import_local_data') loop
    def := regexp_replace(pg_get_functiondef(r.oid), '(public\.)?\m(has_role|is_member|is_platform_admin)\(', 'private.\2(', 'g');
    execute def;
  end loop;
end $$;
