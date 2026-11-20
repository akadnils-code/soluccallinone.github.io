-- PROPOSITION — non appliquée. Restaure les secrets sauvegardés.
begin;
drop trigger if exists trg_strip_order_secrets on public.orders;
update public.orders o set data = o.data
  || jsonb_strip_nulls(jsonb_build_object('trackAuth', b.track_auth, 'dc', b.dc))
from private.orders_secrets_backup b where b.tenant_id = o.tenant_id and b.id = o.id;
commit;
