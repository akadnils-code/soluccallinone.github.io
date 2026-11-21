-- APPLIQUÉE en production le 2026-11-21 (migration « short_links »), après test dans une transaction annulée (18 contrôles).
-- Liens courts : un code de 10 caractères (?r=CODE) retrouve la charge utile d'un lien client / livreur.
-- Écriture : rôles owner/admin/agent d'une entreprise ACTIVE seulement. Lecture publique : uniquement par la fonction Edge « link ».
create table if not exists public.short_links (
  code        text primary key check (code ~ '^[A-Za-z0-9]{10}$'),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('t','l','cf')),   -- t = suivi client, l = livreur, cf = confirmation client
  order_id    text not null check (char_length(order_id) between 1 and 80),
  payload     jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4000),
  revoked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '180 days'
);
create index if not exists short_links_tenant_idx on public.short_links (tenant_id, order_id);

alter table public.short_links enable row level security;
revoke all on public.short_links from anon;
revoke truncate, references, trigger on public.short_links from authenticated;

drop policy if exists short_links_all on public.short_links;
create policy short_links_all on public.short_links for all to authenticated
  using (public.has_role(tenant_id, array['owner','admin','agent']))
  with check (public.has_role(tenant_id, array['owner','admin','agent']));

-- Chaque écriture prolonge la validité du lien de 180 jours (la valeur envoyée par le client est ignorée).
create or replace function public.touch_short_link() returns trigger language plpgsql set search_path = '' as $f$
begin
  new.updated_at := now();
  new.expires_at := now() + interval '180 days';
  return new;
end $f$;
drop trigger if exists touch_short_links on public.short_links;
create trigger touch_short_links before insert or update on public.short_links
  for each row execute function public.touch_short_link();

-- Révoquer le lien d'une commande :   update public.short_links set revoked = true where order_id = '<id de la commande>';
-- Annulation complète :               drop table public.short_links;   (puis supprimer la fonction Edge « link »)
