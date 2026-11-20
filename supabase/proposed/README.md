# Migrations proposées — NON appliquées, NON testées sur une base

Ces fichiers ne sont **pas** exécutés par l'application. Ils sont fournis pour relecture.
Ordre et conditions :

1. Déployer la fonction Firebase `track`, puis fusionner la PR (client 10.3.1 : n'envoie plus `trackAuth`, `dc`, clés).
2. Vérifier que **tous** les appareils du vendeur sont passés à 10.3.1 (sinon ils re-pousseraient les secrets / les perdraient).
3. Tester `01` sur une **branche Supabase** ou une copie, jamais directement en production.
4. Appliquer `01`, puis vérifier que le suivi fonctionne encore (commande neuve + commande ancienne).
5. `02` (retrait de l'ancienne fonction Edge `track`) seulement quand plus aucun lien ancien n'est utilisé.

Retour arrière : `01_rollback.sql`.
