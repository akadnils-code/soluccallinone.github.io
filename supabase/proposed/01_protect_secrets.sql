-- PROPOSITION — non appliquée. Sauvegarde puis nettoyage des secrets dans orders.data et tenant_settings.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 1) Sauvegarde (accessible seulement au rôle propriétaire de la base)
create table if not exists private.orders_secrets_backup as
  select tenant_id, id, data->'trackAuth' as track_auth, data->'dc' as dc, now() as saved_at
  from public.orders where data ? 'trackAuth' or data ? 'dc';

-- 2) Nettoyage des données existantes
update public.orders set data = data - 'trackAuth' - 'dc' where data ? 'trackAuth' or data ? 'dc';

-- 3) Filtre à l'écriture : les secrets ne peuvent plus entrer
create or replace function public.strip_order_secrets() returns trigger
language plpgsql as $$
begin
  new.data := new.data - 'trackAuth' - 'dc';
  return new;
end $$;
drop trigger if exists trg_strip_order_secrets on public.orders;
create trigger trg_strip_order_secrets before insert or update on public.orders
  for each row execute function public.strip_order_secrets();

create or replace function public.strip_setting_secrets() returns trigger
language plpgsql as $$
begin
  if jsonb_typeof(new.value) = 'object' then
    new.value := new.value - 'trackOwnerKey' - 'ttok' - 'rtok' - 'whk' - 'ikey' - 'ckey' - 'db' - 'tiles';
  end if;
  return new;
end $$;
-- ADAPTER : vérifier le nom réel de la colonne JSON de tenant_settings avant application.
-- drop trigger if exists trg_strip_setting_secrets on public.tenant_settings;
-- create trigger trg_strip_setting_secrets before insert or update on public.tenant_settings
--   for each row execute function public.strip_setting_secrets();
commit;
-- NB : import_local_data(p_tenant, p_data) insère p_data->'set' sans filtre ; à corriger dans la fonction
-- (retirer ces clés) après relecture de sa définition actuelle.
