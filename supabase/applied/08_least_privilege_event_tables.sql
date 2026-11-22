-- Appliquée le 2026-11-22 (audit). Moindre privilège sur les tables d'événements :
-- plus aucun droit INSERT / DELETE / TRUNCATE / REFERENCES / TRIGGER pour authenticated et anon
-- (TRUNCATE contourne la sécurité par ligne). Les écritures passent par les fonctions Edge (clé service).
revoke insert, delete, truncate, references, trigger on public.order_events, public.order_replies, public.vendor_forms from authenticated, anon;
grant select, update on public.order_events, public.order_replies, public.vendor_forms to authenticated;
