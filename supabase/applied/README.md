# Migrations Supabase appliquées le 2026-11-21

| Fichier | Effet |
|---|---|
| `03_enforce_suspension.sql` | Suspension réelle : `has_role()` exige `tenants.status = 'active'`, donc un client suspendu n'a plus accès à ses données (commandes, vendeurs, livreurs, paiements, réglages, import). Il peut encore lire son entreprise et sa propre appartenance : l'application affiche « Cette entreprise est suspendue ». Retire aussi les droits inutiles du rôle `anon` (`order_events`, `vendor_forms`, appel de `create_vendor_form` / `revoke_vendor_form`). |
| `03_rollback.sql` | Annulation de la migration 03. |
| `04_perf_memberships_index.sql` | `auth.uid()` évalué une fois par requête dans `memberships_select`, index sur `vendor_forms.tenant_id`. |

## Vérification faite avant application
Test complet dans une transaction annulée (aucune donnée laissée) avec deux entreprises, un propriétaire, un livreur et le rôle anonyme :
- un client ne voit ni n'écrit chez un autre ;
- un client ne peut modifier ni son `plan`, ni son `status` ;
- entreprise suspendue : plus aucun accès aux données (lecture, écriture, import, formulaires vendeur, clé de webhook), accès rétabli à la réactivation, autres entreprises non affectées ;
- le rôle anonyme n'a plus aucun droit sur les tables ni sur les fonctions de la base.

Contrôle après application : le compte propriétaire voit toujours toutes ses données (26 commandes, 16 vendeurs, 5 livreurs).

## À savoir
- Les fonctions Edge `webhook`, `neworder`, `ingest` et `reply` écrivent avec la clé de service (elles contournent les règles RLS). Elles vérifient déjà que l'entreprise est `active`.
- La suspension ne couvre pas le suivi Firebase : cette fonction est indépendante de Supabase.
- Les rôles `courier` et `vendor` n'ont aucune règle d'accès aux données : un compte livreur ou vendeur connecté au cloud ne voit rien (pas de portail vendeur).
- Un propriétaire peut ajouter n'importe quel utilisateur comme membre de sa propre entreprise (fonctionnement voulu).
- La fonction Edge `reply` retrouve l'entreprise en recalculant un jeton pour chaque clé (limite de 2000 entreprises) et le jeton est commun à toute l'entreprise, pas par commande.
- Réglage à activer dans le tableau de bord Supabase : Authentication → protection contre les mots de passe divulgués (peut demander un plan payant).
