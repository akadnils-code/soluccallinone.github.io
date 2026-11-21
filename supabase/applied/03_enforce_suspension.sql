-- APPLIQUÉE en production le 2026-11-21 (migration « enforce_tenant_suspension_and_revoke_anon »), après test complet dans une transaction annulée.
-- 03_enforce_suspension.sql
-- But : (1) rendre la suspension d'une entreprise réelle côté base,
--       (2) retirer les droits inutiles donnés au rôle anonyme (anon).
-- Tout est dans une seule transaction : si une commande échoue, rien n'est modifié.
-- Annulation : 03_rollback.sql

begin;

-- ─────────────────────────────────────────────────────────────
-- 1) SUSPENSION RÉELLE
--    has_role() est utilisée par presque toutes les règles RLS (orders, vendors,
--    couriers, payments, blacklist, tenant_settings, memberships, import_local_data).
--    Elle exige désormais que l'entreprise soit « active ».
-- ─────────────────────────────────────────────────────────────
create or replace function public.has_role(p_tenant uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id   = auth.uid()
      and m.role      = any (p_roles)
      and t.status    = 'active'
  );
$$;

-- is_member() ne dépend PLUS de has_role() : un membre d'une entreprise suspendue doit
-- pouvoir lire son entreprise et son appartenance, pour que l'application affiche
-- « Cette entreprise est suspendue » au lieu de planter. Il ne peut rien lire d'autre.
create or replace function public.is_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id   = auth.uid()
      and m.role = any (array['owner','admin','agent','courier','vendor'])
  );
$$;

-- Les règles ci-dessous interrogeaient « memberships » directement et contournaient donc
-- le contrôle du statut. Elles passent par has_role() et sont limitées aux utilisateurs connectés.
drop policy if exists order_events_select  on public.order_events;
drop policy if exists order_events_update  on public.order_events;
drop policy if exists order_replies_select on public.order_replies;
drop policy if exists order_replies_update on public.order_replies;
drop policy if exists vendor_forms_select  on public.vendor_forms;
drop policy if exists vendor_forms_update  on public.vendor_forms;

create policy order_events_select on public.order_events
  for select to authenticated
  using (public.has_role(tenant_id, array['owner','admin','agent']));
create policy order_events_update on public.order_events
  for update to authenticated
  using      (public.has_role(tenant_id, array['owner','admin','agent']))
  with check (public.has_role(tenant_id, array['owner','admin','agent']));

create policy order_replies_select on public.order_replies
  for select to authenticated
  using (public.has_role(tenant_id, array['owner','admin','agent']));
create policy order_replies_update on public.order_replies
  for update to authenticated
  using      (public.has_role(tenant_id, array['owner','admin','agent']))
  with check (public.has_role(tenant_id, array['owner','admin','agent']));

create policy vendor_forms_select on public.vendor_forms
  for select to authenticated
  using (public.has_role(tenant_id, array['owner','admin']));
create policy vendor_forms_update on public.vendor_forms
  for update to authenticated
  using      (public.has_role(tenant_id, array['owner','admin']))
  with check (public.has_role(tenant_id, array['owner','admin']));

-- Fonctions qui testaient « memberships » directement : ajout du contrôle du statut.
create or replace function public.create_vendor_form(p_tenant uuid, p_vendor text)
returns text
language plpgsql
security definer
set search_path = 'public'
as $function$
declare k text;
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not public.has_role(p_tenant, array['owner','admin']) then raise exception 'Accès refusé'; end if;
  if coalesce(trim(p_vendor),'') = '' then raise exception 'Vendeur manquant'; end if;
  select key into k from public.vendor_forms where tenant_id = p_tenant and vendor_name = left(trim(p_vendor),60) and active limit 1;
  if k is null then
    k := replace(gen_random_uuid()::text,'-','');
    insert into public.vendor_forms (tenant_id, vendor_name, key) values (p_tenant, left(trim(p_vendor),60), k);
  end if;
  return k;
end $function$;

create or replace function public.revoke_vendor_form(p_tenant uuid, p_vendor text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not public.has_role(p_tenant, array['owner','admin']) then raise exception 'Accès refusé'; end if;
  update public.vendor_forms set active = false where tenant_id = p_tenant and vendor_name = left(trim(p_vendor),60);
end $function$;

create or replace function public.register_webhook_key(p_tenant uuid, p_key text, p_vendor text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not public.has_role(p_tenant, array['owner','admin']) then raise exception 'Accès refusé'; end if;
  if p_key !~ '^[A-Za-z0-9]{16,64}$' then raise exception 'Clé invalide'; end if;

  insert into public.webhook_keys (tenant_id, key, default_vendor)
  values (p_tenant, p_key, left(coalesce(p_vendor, ''), 60))
  on conflict (tenant_id) do update
    set key = excluded.key, default_vendor = excluded.default_vendor, updated_at = now();
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2) DROITS EN TROP POUR LE RÔLE ANONYME
-- ─────────────────────────────────────────────────────────────
-- Les utilisateurs connectés utilisent le rôle « authenticated » : ils ne sont pas touchés.
revoke all on public.order_events from anon;
revoke all on public.vendor_forms from anon;

-- Ces deux fonctions refusaient déjà l'accès sans connexion ; on retire aussi le droit de les appeler.
revoke execute on function public.create_vendor_form(uuid, text) from public, anon;
revoke execute on function public.revoke_vendor_form(uuid, text) from public, anon;
grant  execute on function public.create_vendor_form(uuid, text) to authenticated;
grant  execute on function public.revoke_vendor_form(uuid, text) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────
-- VÉRIFICATION après application (lecture seule)
-- ─────────────────────────────────────────────────────────────
-- select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';                 -- attendu : 0 ligne
-- select routine_name from information_schema.routine_privileges
--   where routine_schema = 'public' and grantee in ('anon','PUBLIC')
--   and routine_name <> 'touch_updated_at';                              -- attendu : 0 ligne
-- select policyname, roles from pg_policies where schemaname='public'
--   and tablename in ('order_events','order_replies','vendor_forms');   -- attendu : {authenticated}
