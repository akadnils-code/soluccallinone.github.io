## Clôture 10.3.1 (corrections finales)
- GPS : plus d'envoi de position après Livré/Refusé ; une erreur 409 de position n'affiche plus de bannière « Suivi » (corrigé).
- Serveur : `courierUpdate` (ancien) refuse `bad:1` tant que la commande n'est pas en cours (cohérent avec `courierEvent`), test ajouté.
- Synchro Supabase : `trackAuth` et `dc` (jetons/codes de livraison) ne sont plus envoyés dans `orders.data` ; clés sensibles des réglages (`trackOwnerKey`, `ttok`, `rtok`, `whk`, `db`, `ikey`, `ckey`, `tiles`) exclues de l'envoi et de l'import ; secrets locaux conservés lors d'une réception. Tests unitaires + contrôle statique de `cloud.js`.
- Événements en attente : au-delà de 1000, l'avertissement « traitement partiel » est affiché.
- `supabase/proposed/` : migrations SQL **proposées, non appliquées, non testées** (sauvegarde + nettoyage + déclencheurs + retour arrière).
- Limite connue : un événement livreur déjà « terminé » dans la file locale n'est pas renvoyé si l'action est refaite sur la même mission (le serveur reste idempotent).
- Non vérifié : déploiement Firebase réel/émulateur, appareils réels hors ligne, synchro Supabase de bout en bout, SQL proposé.
- Tests : 86 (serveur, client, e2e Chromium), tous verts.



# Version 10.3.1 : suivi automatique des livreurs (correctif prioritaire)

## Constat (audit avant modification)
- Deux circuits concurrents : Firebase (`functions/index.js`, fonction `track`, règles dans `database.rules.json`) et Supabase (fonction Edge `track` déployée en production mais absente du dépôt, table `order_events`, lue par `cloud.js`).
- Les boutons `data-cev` envoyaient « Récupéré / Livré / Refusé » à Supabase avec un jeton **commun à toute la boutique** (dérivé de la clé d'import) : un seul lien livreur permettait de marquer « Livré » n'importe quelle commande de la boutique, sans code de livraison ni contrôle de transition.
- Erreurs masquées : `pullEvents()` / `pullReplies()` (`catch(x){}`), accusés `PATCH` ignorés, publication propriétaire `fbp` et lecture `fbg` seulement dans la console.
- Autres défauts trouvés : en Firebase, le bouton « Livré » ne faisait rien ; « Récupéré » et « Refusé » n'étaient pas rejouables hors ligne ; une publication du propriétaire fondée sur un état local en retard (génération d'un lien) pouvait **effacer** « Récupéré » côté serveur ; seules les 25 dernières commandes étaient interrogées ; un « Livré » pouvait écraser un « Refusé ».

## Architecture retenue : un seul mécanisme, Firebase `track`
- Nouvelle action serveur `courierEvent` (`pickup` / `delivered` / `refused`) dans `functions/tracking.js` (logique testable ; `functions/index.js` n'est plus que le câblage Firebase, même fonction, même région, même secret).
- Autorisation : jeton livreur **propre à la commande** (haché côté serveur, comparaison à temps constant). Le jeton client ne permet aucune action livreur et inversement. La clé propriétaire n'est jamais dans un lien (contrôle automatique).
- Transitions vérifiées côté serveur : Récupéré (validée → en route), Livré (validée ou en route → livrée, **code de livraison exigé**, blocage 30 min après 3 erreurs), Refusé (validée ou en route → refusée). Livré après Refusé, Refusé après Livré, tout événement sur une commande non validée : 409.
- Idempotence : un `eventId` stable (`<type>-<id de suivi>`) est mémorisé côté serveur, et l'effet est de toute façon fondé sur l'état (un rejeu ne crée ni second événement d'historique, ni second changement de statut, ni essai de code consommé). Testé avec 5 envois simultanés.
- Événement jamais perdu : côté livreur, file persistante sur le téléphone (rechargement, fermeture de page, réseau coupé, 5xx, **404 = commande pas encore publiée**) avec nouvelles tentatives à délai croissant jusqu'à 24 h ; les refus définitifs (403, 409, 401, 429) sont conservés et affichés. Côté propriétaire, les publications échouées sont rejouées (`aio_pubq`), et une publication en retard ne peut plus abaisser un statut posé par le livreur (sauf correction manuelle volontaire, `allowRegress`).
- Les anciennes actions `courierUpdate`, `clientUpdate` et `deliver` sont conservées (anciennes pages en cache), avec les mêmes contrôles.
- Circuit Supabase conservé pour les liens déjà distribués, mais plus alimenté : `tlink` n'ajoute plus `tu`/`tk`, `cloud.js` ne calcule plus `ttok`. Les données existantes (dont `DB.set.ttok`) ne sont pas supprimées.

## Erreurs explicites
- Livreur : bandeau « ⏳ n événement(s) en attente d'envoi — raison » / « ⚠ Récupéré non envoyé : … », boutons Réessayer / Fermer.
- Propriétaire : bandeau + notification pour toute erreur de publication ou de lecture du suivi, bouton Réessayer.
- Synchronisation cloud : les erreurs de `pullReplies` / `pullEvents` (lecture, application, accusé) remontent dans l'état de synchronisation ; les événements dont la commande n'est pas encore là restent en attente (comptés, jamais acquittés) ; lecture paginée pour qu'ils ne bloquent pas les suivants.

## Fichiers
`functions/tracking.js` (nouveau), `functions/index.js`, `track-events.js` (nouveau), `app.js`, `cloud.js`, `index.html`, `sw.js` (cod-v82), `package.json` (nouveau, `npm test`), `functions/testing/fake-rtdb.js`, `functions/test/tracking.test.js`, `test/track-events.test.js`, `test/e2e-courier.test.js`, `supabase/legacy/*` (copie de référence), README, ce rapport. `database.rules.json` : inchangé (les nouveaux champs vivent dans `_privateTrackAuth`, écrit uniquement par la fonction).

## Tests (`npm test`)
- 44 tests serveur (événements, jetons invalides/absents/croisés, accès client↔livreur, transitions, code de livraison, répétitions et concurrence, commande non publiée, publication en retard) sur une base Realtime simulée qui reproduit le cache froid du SDK.
- 27 tests de la file livreur et du vidage Supabase (hors ligne, rechargement, 404, 403/409, abandon à 24 h, stockage plein, commande absente, échec d'accusé).
- 12 tests de bout en bout dans Chromium sur la vraie page livreur (Récupéré, Refusé, Livré, double appui, hors ligne, rechargement, jeton refusé, ancien lien, aucune clé propriétaire dans les liens).
- Les tests de fiabilité ont été éprouvés par mutation (cache froid, rejeu, jeton non vérifié : tous détectés).

## NON testé / points non résolus
- **Fonction Firebase non déployée, règles non exécutées dans l'émulateur** : tests faits sur une base simulée. À faire : `firebase deploy --only functions:track` après relecture, puis essai réel (publication, Récupéré, mauvais code, Livré).
- **La fonction Edge Supabase `track` reste active en production** (je n'ai rien modifié) et accepte toujours le jeton boutique des anciens liens. À désactiver par le propriétaire quand les anciens liens ne sont plus utilisés ; changer la clé d'import invalide immédiatement ces jetons.
- La migration `order_events_for_courier_status` n'est pas dans le dépôt et son SQL n'a pas été relu (aucun SQL exécuté en production).
- Sans Firebase configuré, le lien livreur reste le lien WhatsApp (comportement antérieur à 10.3.1) : le suivi automatique exige la fonction Firebase.
- Le code de livraison saisi hors ligne est gardé sur le téléphone du livreur jusqu'à l'envoi, puis effacé.
- `database.rules.json` n'a pas été rejoué (non modifié).

---
# Version 7.6.0 : structure des fichiers
`index.html` (page), `styles.css` (styles), `app.js` (logique), `sw.js` (cache cod-v13, liste mise à jour), `manifest.webmanifest`, `privacy.html`, `database.rules.json`. Logique inchangée : le code a seulement été déplacé. Syntaxe JS vérifiée ; aucun navigateur disponible ici, donc affichage non testé.

# Version 7.5.0 : code de livraison vérifié par le serveur

- Code de livraison : 6 chiffres ALÉATOIRES (plus calculé à partir de l'identifiant). Il n'est que dans le lien client.
- Le vendeur publie le code dans `/secret/<id>/ck` (illisible par tout le monde, écriture unique).
- Le livreur envoie le code saisi (`dc`) avec `s=3` : les règles Firebase comparent au secret. Mauvais code = écriture refusée.
- Une livraison validée ne peut plus être remise à un statut inférieur.
- Règles : ajout des champs `rt`, `fb`, `rq` (avis/demandes client, bloqués avant).

## NON testé / limites
- Règles jamais exécutées (émulateur ou console Firebase > Règles > Simulateur à faire).
- Pas de limitation de tentatives côté serveur (6 chiffres = 1 000 000 essais).
- Sans Firebase activé, la validation par code est refusée (plus de contrôle local).
- Anciennes commandes déjà liées : renvoyer le lien client pour publier leur secret.
- Le secret est publié à la création du lien : le générer avant de donner le lien livreur.


---
# Historique 7.1.0 → 7.4.0
# Rapport de modifications – Confirmation COD 7.1.0 → 7.4.0

Originaux conservés : `sauvegarde-originale/`. Diffs complets : `modifications-index.diff`, `modifications-sw.diff`.

## Modifications
| # | Changement | Testé (Chromium headless, 390 px) |
|---|---|---|
| 1 | Paiements vendeur : conflit `padd`/`pdel` supprimé | ajout + suppression OK |
| 2 | Suivi client : variable `e` masquée (`e is not a function`) | étapes affichées, 0 erreur JS |
| 3 | XSS : prix catalogue, montant livreur, prix importés forcés en nombres | `<img onerror>` non exécuté |
| 4 | `today()` en heure locale (plus UTC) | date correcte |
| 5 | Restauration : confirmation avant écrasement | non automatisé |
| 6 | Service worker : pas de cache des liens `?t= ?l= ?v=`, cache `cod-v11` | syntaxe seulement |
| 7 | QR code hors ligne (lib MIT Kazuhiko Arase) : fiche vendeur, suivi client, mission livreur, enregistrement SVG | QR affiché ; décodage OpenCV identique (29 et 73 modules) |
| 8 | NFC : écriture/lecture de lien (liens de l'appli uniquement) | seulement le repli sans NFC |
| 9 | Code d'accès : 8 caractères minimum, 600 000 itérations PBKDF2 (anciens codes toujours acceptés) | refus < 8 car., chiffrement, verrouillage, déverrouillage OK |
| 10 | Sauvegarde chiffrée si code actif + restauration avec code | aucun texte clair dans le fichier ; restauration OK |
| 11 | Livraison signalée à distance : validation du vendeur (réglable dans Automatisations, activé par défaut) | statut reste « En cours » jusqu'à validation |
| 13 | Accueil : carte « QR code & NFC » (mon application, lien de commande par vendeur, mission par livreur, lecture de tag NFC) | affichage, 3 QR décodés par OpenCV, repli NFC |
| 12 | `firebase/database.rules.json` : règles proposées | JSON valide **uniquement** |

## NON résolu / NON testé
- **Faille majeure :** le code de livraison est toujours calculable par le livreur et la base Firebase accepte les écritures de quiconque détient un lien. Le point 11 limite l'impact financier, il ne supprime pas la faille. Correctif réel = vérification côté serveur (Firebase Auth + règles ou fonction cloud).
- Règles Firebase (12) : jamais exécutées. À essayer dans l'émulateur Firebase avant production (elles peuvent bloquer des écritures de l'appli).
- Non testés : NFC réel, scan QR au téléphone, Firebase réel, GPS, Leaflet, mise à jour du service worker sur appareil, impression.
- Non fournis : comptes et rôles, paiement en ligne, conformité loi 09-08, conditions d'utilisation (à faire valider par un juriste).
- Fichiers jamais reçus : `manifest.webmanifest`, icônes, `privacy.html`.
- L'essai gratuit (30 commandes) donne un bonus de livraison de 0 dh : comportement existant, inchangé.

## Contrôle indépendant conseillé
1. Lire les `.diff`. 2. Rejouer les tests ci-dessus sur un vrai téléphone Android et un iPhone. 3. Faire auditer la partie Firebase.

## Version 7.4.0 : modules NFC et QR code

| Fonction | Où | Test (Chromium headless, caméra et NFC simulés) |
|---|---|---|
| Diagnostic (https, NFC, caméra, lecteur QR, Firebase, permissions) | Accueil → Diagnostic | affichage OK |
| Association d'un tag NFC à un vendeur, livreur, client ou commande | Accueil → Associer un tag ; bouton « Tag NFC » sur les cartes de commande | QR du tag décodé = `?go=ve.<id>` ; écriture NDEF simulée OK |
| Ouverture automatique de la fiche (`?go=`) | lecture NFC, scan QR ou lien | vendeur, commande, livreur, client OK ; URL nettoyée |
| QR unique par colis | cartes Livraison et liste des commandes confirmées (« QR colis ») | décodé OpenCV |
| Scanner caméra (BarcodeDetector) | Accueil → Scanner un QR ; page livreur | flux simulé OK |
| Vendeur scanne un colis : « Remis au livreur » (avec confirmation) | Accueil | statut 1→2, PATCH Firebase unique |
| Livreur scanne le colis : « Récupéré » | page livreur | PATCH s=2 |
| Livreur scanne le QR de livraison du client | page livreur ; QR affiché sur la page client à l'étape « en route » | PATCH s=3 |
| Anti-doublon et anti-erreur | tous les scans | doublons refusés sans second PATCH ; mauvais colis et mauvais code refusés |
| Secours sans lecteur natif / caméra refusée / sans https | fenêtre du scanner | messages affichés ; saisie manuelle OK |

Régression : paiements, suivi client, XSS, chiffrement, sauvegarde chiffrée, validation des livraisons à distance, QR de l'accueil : tous rejoués sans erreur JS.

### Limites à connaître
- Le NFC et la caméra réels n'ont PAS été testés : ils exigent ton téléphone (Chrome Android, https, tag NTAG213 ou supérieur).
- Le QR de livraison et le code à 4 chiffres reposent toujours sur le même secret calculable par le livreur : le scan améliore le confort et évite les doublons, pas la sécurité. La vraie protection exige une vérification serveur.
- La synchronisation Firebase a été testée avec un faux serveur (requêtes PATCH capturées), pas avec un vrai projet.
- Un tag ou un QR « fiche » (`?go=`) ne s'ouvre que sur le téléphone qui contient les données.
- Le NFC ne peut pas être lu en arrière-plan : il faut appuyer sur « Lire un tag NFC » (contrainte de Chrome).
