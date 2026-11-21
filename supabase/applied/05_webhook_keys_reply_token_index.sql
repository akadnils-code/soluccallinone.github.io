-- APPLIQUÉE en production le 2026-11-21 (migration « webhook_keys_reply_token_index »).
-- Jeton public de la page de confirmation client (identique à celui calculé par l'application
-- et par la fonction Edge « reply »), calculé par la base et indexé : la fonction retrouve
-- l'entreprise sans balayer toutes les clés (l'ancienne méthode s'arrêtait à 2000 entreprises).
alter table public.webhook_keys
  add column if not exists reply_tok text
  generated always as (left(encode(sha256((key || ':reply')::bytea), 'hex'), 24)) stored;

create unique index if not exists webhook_keys_reply_tok_idx on public.webhook_keys (reply_tok);

-- Annulation (la fonction « reply » version 1 n'utilise pas cette colonne ; la version 2 retombe sur l'ancien balayage) :
--   drop index if exists public.webhook_keys_reply_tok_idx;
--   alter table public.webhook_keys drop column if exists reply_tok;
