# Circuit Supabase « track » (hérité, non utilisé par les nouveaux liens)

`track.index.ts` est une **copie de référence en lecture seule** de la fonction Edge `track`
déployée sur le projet Supabase (version 1), ajoutée au dépôt pour permettre sa relecture.
Elle n'est **pas** déployée depuis ce dépôt et ne doit pas être modifiée ici sans la redéployer.

La migration `20261119082031_order_events_for_courier_status` (table `order_events`) est
déployée en production, mais son SQL n'était pas dans le dépôt et n'a pas été relu pour cette
mission (aucune requête SQL n'a été exécutée en production).

## Pourquoi ce circuit n'est plus alimenté
- Le jeton public `t` est le même pour **toute la boutique** : celui qui détient un seul lien livreur peut
  envoyer « Livré » pour n'importe quelle commande de la boutique.
- Aucun contrôle de transition ni de code de livraison : « Livré » n'exigeait pas le code du client.
- Pas de jeton propre à la commande, donc pas de révocation par commande.

Architecture retenue (v10.3.1) : un seul mécanisme, la fonction Firebase `track`
(`functions/tracking.js`, action `courierEvent`). Voir le README, section « Suivi des livreurs ».

`cloud.js` continue de lire `order_events` pour appliquer les événements des liens déjà distribués
(avec accusés d'application, nouvelles tentatives et erreurs visibles). Une fois ces anciens liens
expirés, la fonction Supabase `track` peut être désactivée par le propriétaire.
