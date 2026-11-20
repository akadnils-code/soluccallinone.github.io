# Migrations Supabase 10.3.1 — APPLIQUÉES en production le 2026-11-20

Migration `protect_tracking_secrets_10_3_1` (voir `01_protect_secrets.sql`, adapté : colonne `tenant_settings.data`) :
- sauvegarde des secrets dans `private.orders_secrets_backup` (17 commandes) ;
- `orders.data` nettoyé de `trackAuth` et `dc` ;
- déclencheurs `trg_strip_order_secrets` et `trg_strip_setting_secrets` (filtrent aussi `import_local_data`).

Ancienne fonction Edge `track` : remplacée par une réponse 410 (voir `02_disable_legacy_track.md`).
Retour arrière des commandes : `01_rollback.sql` (supprime le déclencheur des commandes, remet les secrets sauvegardés).
Le suivi des livreurs passe uniquement par la fonction Firebase `track`.
