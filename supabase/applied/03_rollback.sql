-- ANNULATION de 03_enforce_suspension.sql (remet l’état lu dans la base le 2026-11-21 avant la migration).
begin;

create or replace function public.has_role(p_tenant uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create or replace function public.is_member(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(p_tenant, array['owner', 'admin', 'agent', 'courier', 'vendor']);
$$;

drop policy if exists order_events_select  on public.order_events;
drop policy if exists order_events_update  on public.order_events;
drop policy if exists order_replies_select on public.order_replies;
drop policy if exists order_replies_update on public.order_replies;
drop policy if exists vendor_forms_select  on public.vendor_forms;
drop policy if exists vendor_forms_update  on public.vendor_forms;

create policy order_events_select on public.order_events for select to public
  using (exists (select 1 from public.memberships m where m.tenant_id = order_events.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])));
create policy order_events_update on public.order_events for update to public
  using (exists (select 1 from public.memberships m where m.tenant_id = order_events.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])))
  with check (exists (select 1 from public.memberships m where m.tenant_id = order_events.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])));

create policy order_replies_select on public.order_replies for select to authenticated
  using (exists (select 1 from public.memberships m where m.tenant_id = order_replies.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])));
create policy order_replies_update on public.order_replies for update to authenticated
  using (exists (select 1 from public.memberships m where m.tenant_id = order_replies.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])))
  with check (exists (select 1 from public.memberships m where m.tenant_id = order_replies.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin','agent'])));

create policy vendor_forms_select on public.vendor_forms for select to public
  using (exists (select 1 from public.memberships m where m.tenant_id = vendor_forms.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin'])));
create policy vendor_forms_update on public.vendor_forms for update to public
  using (exists (select 1 from public.memberships m where m.tenant_id = vendor_forms.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin'])))
  with check (exists (select 1 from public.memberships m where m.tenant_id = vendor_forms.tenant_id
         and m.user_id = (select auth.uid()) and m.role = any (array['owner','admin'])));

create or replace function public.create_vendor_form(p_tenant uuid, p_vendor text)
returns text language plpgsql security definer set search_path = 'public' as $function$
declare k text;
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.role in ('owner','admin')) then raise exception 'Accès refusé'; end if;
  if coalesce(trim(p_vendor),'') = '' then raise exception 'Vendeur manquant'; end if;
  select key into k from public.vendor_forms where tenant_id = p_tenant and vendor_name = left(trim(p_vendor),60) and active limit 1;
  if k is null then
    k := replace(gen_random_uuid()::text,'-','');
    insert into public.vendor_forms (tenant_id, vendor_name, key) values (p_tenant, left(trim(p_vendor),60), k);
  end if;
  return k;
end $function$;

create or replace function public.revoke_vendor_form(p_tenant uuid, p_vendor text)
returns void language plpgsql security definer set search_path = 'public' as $function$
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.role in ('owner','admin')) then raise exception 'Accès refusé'; end if;
  update public.vendor_forms set active = false where tenant_id = p_tenant and vendor_name = left(trim(p_vendor),60);
end $function$;

create or replace function public.register_webhook_key(p_tenant uuid, p_key text, p_vendor text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accès refusé'; end if;
  if not exists (select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.role in ('owner','admin')) then
    raise exception 'Accès refusé';
  end if;
  if p_key !~ '^[A-Za-z0-9]{16,64}$' then raise exception 'Clé invalide'; end if;
  insert into public.webhook_keys (tenant_id, key, default_vendor)
  values (p_tenant, p_key, left(coalesce(p_vendor, ''), 60))
  on conflict (tenant_id) do update
    set key = excluded.key, default_vendor = excluded.default_vendor, updated_at = now();
end;
$$;

-- Droits anon (tels que lus avant la migration)
grant all on public.order_events to anon;
grant all on public.vendor_forms to anon;
grant execute on function public.create_vendor_form(uuid, text) to public, anon;
grant execute on function public.revoke_vendor_form(uuid, text) to public, anon;

commit;
