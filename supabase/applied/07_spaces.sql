-- Appliqué le 2026-11-21 (migration « short_links_spaces »)
-- Espaces livreur (dsp) et vendeur (vsp) : un lien personnel par livreur / vendeur, sans compte.
alter table public.short_links drop constraint short_links_kind_check;
alter table public.short_links add constraint short_links_kind_check check (kind = any (array['t','l','cf','dsp','vsp']));
create unique index if not exists short_links_space_uq on public.short_links (tenant_id, kind, order_id) where kind in ('dsp','vsp');
-- Pour ces deux types, order_id contient l'identifiant du livreur / du vendeur et payload = {"n": "<nom>"}.
