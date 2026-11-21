-- APPLIQUÉE en production le 2026-11-21 (migration « memberships_select_initplan_and_vendor_forms_index »).
-- Corrige deux alertes de performance de Supabase. Même logique d'accès qu'avant.

-- auth.uid() évalué une seule fois par requête (et non par ligne).
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(tenant_id, array['owner','admin']));

-- Index manquant sur la clé étrangère vendor_forms.tenant_id.
create index if not exists vendor_forms_tenant_idx on public.vendor_forms (tenant_id);

-- Annulation :
--   drop index if exists public.vendor_forms_tenant_idx;
--   drop policy if exists memberships_select on public.memberships;
--   create policy memberships_select on public.memberships for select to authenticated
--     using ((user_id = auth.uid()) or public.has_role(tenant_id, array['owner','admin']));
