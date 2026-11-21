# All In One — Amk Logistique (v10.5.0)
Application web installable (PWA) de confirmation, livraison et suivi des commandes paiement à la livraison (COD) au Maroc.
Données chiffrées sur le téléphone, suivi en direct et import automatique via Firebase (facultatifs).

## Fichiers à mettre à la racine du dépôt GitHub
index.html · styles.css · app.js · cloud.js · sw.js · manifest.webmanifest · privacy.html · icon-192.png · icon-512.png · icon-512-maskable.png
Dossiers et fichiers du dépôt hors site : `functions/` (Cloud Function de suivi), `formation/` (guide illustré, vidéo, sous-titres, captures), `supabase-*.sql`, `database.rules.json`, `firebase.json`, `exemple-commandes.csv`, `RAPPORT-MODIFICATIONS.md`. Le script Google Apps Script d'import Gmail et le guide de mise en service ne sont pas dans ce dépôt.
Configuration Firebase à conserver dans le dépôt : firebase.json, database.rules.json et le dossier functions/. Ne publie jamais functions/.env.

## Déployer le suivi sécurisé Firebase

Le suivi en direct repose désormais sur `functions/track`. Les règles Firebase bloquent les lectures et écritures directes des suivis ; le code de livraison n’est remis qu’au lien client autorisé. Les anciens liens de suivi ne sont plus valides : après déploiement, renvoie les nouveaux liens client et livreur depuis l’application.

1. Installe Firebase CLI, connecte-toi (`firebase login`) et sélectionne ton projet (`firebase use --add`). Le projet doit avoir Realtime Database et le plan Firebase requis pour Cloud Functions.
2. Dans `functions/.env`, définis `TRACKING_DATABASE_URL` avec l’URL exacte de ta Realtime Database (copie `functions/.env.example`). Ne publie jamais ce fichier.
3. Crée une clé propriétaire aléatoire (par exemple `openssl rand -base64 48`) et conserve-la en lieu sûr. Configure-la comme secret : `firebase functions:secrets:set TRACKING_OWNER_KEY`.
4. Installe les dépendances et déploie les règles ainsi que la fonction :
   ```sh
   npm --prefix functions install
   firebase deploy --only database,functions:track
   ```
5. Dans l’application, ouvre Réglages → Connexions → Suivi et renseigne l’URL de la base, l’URL de la fonction (`https://europe-west1-ID_DU_PROJET.cloudfunctions.net/track`) et la même clé propriétaire. Utilise « Tester la connexion ».
6. Vérifie le suivi sur un appareil client et un appareil livreur avant d’utiliser les nouveaux liens en production.

La clé propriétaire donne les droits de publication et de lecture des suivis : elle doit rester dans l’application propriétaire, protégée par le code PIN de l’appareil. Si elle est compromise, remplace le secret Firebase et la clé dans l’application, puis republie la fonction.

## Changements v9.6.1 (sécurisation du suivi)
- Les lectures, publications, statuts, positions GPS et validations de livraison passent par une Cloud Function avec des jetons distincts client/livreur.
- Le code de livraison n’est plus dans le lien Base64 ; il est renvoyé uniquement au client autorisé. Les essais incorrects sont comptés et bloqués côté serveur après trois erreurs pendant 30 minutes.
- Les règles Realtime Database interdisent désormais l’accès direct aux données de suivi et à l’authentification privée. Voir « Déployer le suivi sécurisé Firebase ».
- La pagination des commandes cloud a été stabilisée pour éviter de répéter une page lorsque plusieurs lignes partagent le même horodatage.
- Cloud Functions utilise Node.js 24 et des dépendances sans vulnérabilité npm connue au moment de la vérification.

## Mise à jour depuis Android
1. GitHub > dépôt > Add file > Upload files : envoyer les fichiers ci-dessus, puis Commit changes.
2. Rouvrir l'appli deux fois (mise à jour du cache). Le numéro de version est affiché dans Paramètres → Aide et à propos → Version & mises à jour.

## Navigation (depuis la v10.2)
Barre du bas : **Accueil · Confirmer · Commandes · Livraison · Compte · Paramètres**.
- **Compte** : deux onglets. *Gestion* = Pilotage de l'activité (Vendeurs partenaires, Finances & soldes, Automatisations) et Développement commercial (Catalogue produits, Réseau professionnel, Affaires & marges, Prévisions de revenus, Partenariat livraison). *Opérations* = Outils terrain (Codes QR & étiquettes NFC, Calculatrice) et Prospection (Carnet de prospects).
- **Paramètres** : 8 rubriques indépendantes : Compte et profil · Tarifs et messages · Sécurité et confidentialité · Sauvegarde et données · Connexions · Carte · Langue · Aide et à propos (Mode d'emploi, Version & mises à jour).

## Changements v10.5.0 : espaces livreur et vendeur, suivi en direct

- **Espace livreur** : un lien personnel court (`?r=CODE`, sans compte). Le livreur voit uniquement les commandes confirmées qui lui sont attribuées (retrait chez le vendeur, client, itinéraire, à encaisser) et touche **Récupéré / Livré / Refusé**. L'action est enregistrée par la fonction Edge `space` (vérifie que la commande est bien à lui, pas de retour en arrière après Livré/Refusé) ; la commission de livraison est figée comme dans l'appli.
- **Espace vendeur** : lien personnel en **lecture seule** (ses commandes, leur étape, le livreur, compteurs).
- **Propriétaire** : dans Livreurs et dans la fiche vendeur, bouton « Lien de son espace » (copie le lien et ouvre WhatsApp) et « Nouveau lien » (l'ancien cesse de fonctionner immédiatement). Le propriétaire garde toutes les fonctions.
- **Client** : le suivi court est **en direct** (la fonction `link` relit l'étape et le livreur dans la commande, la page se rafraîchit toute seule toutes les 30 s). Après « Je confirme », la page de confirmation propose « Suivre ma commande » : un seul lien suffit au client.
- Nécessite le compte cloud actif (owner/admin/agent). Sans cela, le bouton le signale ; les liens de commande gardent leur ancien format.
- Base : migration `supabase/applied/07_spaces.sql` ; fonctions `space` (nouvelle) et `link` (v2) déjà déployées en production.
- Limites : jeton = secret du lien (quiconque l'a voit ces commandes, d'où « Nouveau lien ») ; expiration 180 jours renouvelée à chaque modification ; non testé sur de vrais téléphones ; la fonction `space` n'a pu être appelée en réel depuis cet environnement (testée avec une base simulée).

## Changements v10.4.0 : liens courts
- Les liens envoyés aux clients (suivi, confirmation) et aux livreurs deviennent `https://…github.io/?r=Ab3xY9kLmN` (une cinquantaine de caractères) au lieu de plusieurs centaines. Les anciens longs liens déjà envoyés continuent de fonctionner.
- Fonctionnement : l'application enregistre le contenu du lien dans la table `short_links` (Supabase, `supabase/applied/06_short_links.sql`) ; la fonction Edge `link` (`supabase/functions/link/`) le rend à la page ouverte. Le contenu est mis à jour tout seul quand la commande change (même lien, nouvelle étape). Valide 180 jours après la dernière mise à jour.
- Condition : compte cloud connecté, entreprise active, rôle propriétaire, administrateur ou agent. Sinon l'application garde l'ancien long lien : rien ne casse hors connexion.
- L'enregistrement part en arrière-plan et se rejoue tout seul tant qu'il n'a pas réussi : si le vendeur envoie le lien au moment exact où il n'a plus de réseau, le client peut voir « Lien introuvable » ; renvoyer le lien règle le cas.
- À savoir : le contenu des liens (nom, adresse et téléphone du client pour le lien livreur, jetons de suivi) est maintenant aussi stocké dans Supabase, protégé par RLS (écriture par entreprise active, lecture publique uniquement par code de 10 caractères tiré au hasard). C'est le prix des liens courts. Révocation : `update public.short_links set revoked = true where order_id = '…'`.
- Tests : `test/e2e-short-link.test.js` (11 cas, Chromium) et `supabase/functions/link/link.test.mjs` (13 cas).
- Cache du service worker `cod-v84`.

## Changements v10.3.2
- Entreprise suspendue : l’erreur brute du serveur est remplacée par un message clair (synchronisation arrêtée, données conservées sur le téléphone). Aucune autre modification du code de l’application.
- Cache du service worker `cod-v83`.

## Suivi des livreurs (v10.3.1)

Un seul mécanisme pour les événements du livreur : la fonction Firebase `track` (`functions/tracking.js`, action `courierEvent`). Les boutons **Récupéré**, **Livré** (avec le code du client) et **Refusé** du lien livreur l'appellent avec un jeton propre à la commande ; la clé propriétaire n'apparaît jamais dans un lien.

- Le serveur contrôle les droits et les transitions, et ignore les répétitions (un événement envoyé plusieurs fois ne change la commande qu'une fois).
- Sans réseau, ou si la commande n'est pas encore publiée par le vendeur, l'événement reste sur le téléphone du livreur et est renvoyé automatiquement (bandeau d'état, bouton « Réessayer maintenant »). Un refus définitif (lien invalide, transition impossible) reste affiché.
- Côté vendeur, les erreurs de suivi et de synchronisation sont affichées (bandeau + notification) ; les publications échouées sont rejouées.
- Après mise à jour de `functions/`, redéploie la fonction : `firebase deploy --only functions:track` (non fait par cette version). Aucun changement de règles.
- L'ancien circuit Supabase (`order_events`) n'est plus alimenté par les nouveaux liens ; il reste lu pour les liens déjà distribués. Voir `supabase/legacy/README.md`.
- Tests : `npm test` (serveur, file livreur, et bout en bout si Playwright/Chromium est installé).

### Secrets et synchronisation
Les jetons de suivi (`trackAuth`), codes de livraison (`dc`) et clés sensibles des réglages restent sur l'appareil du vendeur : ils ne sont plus envoyés à Supabase. Côté base, des déclencheurs les filtrent aussi (voir `supabase/proposed/`, appliqué le 2026-11-20).

## Changements v10.2.2
- Textes d'aide, messages d'erreur et mode d'emploi alignés sur le nouveau menu Paramètres (plus de renvoi vers « Compte → Sécurité », « Compte → Mon profil », « Compte → Connexions »).
- Cache du service worker `cod-v71`.
- Vérifié en navigateur sans erreur JavaScript : 6 onglets, 8 rubriques de Paramètres, 11 tuiles du Compte, ajout d'un vendeur et d'une commande, passage dans Appels, chargement des données de démonstration.

## Changements v10.2.1 et v10.1.0
- Paramètres séparés de Compte (6e onglet), menu principal minimaliste puis un écran par rubrique.
- Compte réduit à deux onglets : Gestion et Opérations.
- Le Mode d'emploi et Version & mises à jour s'ouvrent depuis Paramètres → Aide et à propos.

## Changements v10.0.1
- Cartes Commandes, Livraison et Finances plus visuelles (bordure de couleur par statut, compteurs colorés).
- Formation refaite (vidéo sous-titrée FR, guide illustré, prompt vidéo cartoon) dans `formation/`.

## Changements v10.0.0
- Refonte visuelle : thème clair et épuré (blanc, orange vif, noir de contraste), en-tête blanc, navigation basse avec indicateur orange, bandeau d'accueil orange.
- Raccourcis ronds sur l'accueil : Confirmer, Commandes, Livraison, Vendeurs, Aide.
- **Mode d'emploi** intégré (aujourd'hui : Paramètres → Aide et à propos) : 8 sujets dépliables.

## Changements v9.7.0
- Nouveau menu **Compte → Profil & paramètres → Version & mises à jour** : version installée, recherche de mise à jour, bouton « Mettre à jour » (vide le cache sans toucher aux données), nouveautés.
- Le nom et la version ne s'affichent plus sur la page d'accueil.

## Changements v9.6.0
- Menu Plus : 5 groupes repliables (seul le premier est ouvert).
- Automatisations : liste noire automatique après 2 refus à la livraison (désactivée par défaut) et alerte de colis en livraison depuis plus de 48 h.

## Changements v9.5.0 (écrans simplifiés)
- Appels, Commandes, Suivi des colis : chaque carte n'affiche plus que l'essentiel ; le reste est rangé dans « Plus d'options ». Bouton « Tout déplier / replier » en haut de l'écran.

## Changements v9.4.1 (audit)
- Leaflet hébergé dans vendor/leaflet (plus de CDN) : la CSP n’autorise plus que les scripts du site ; carte utilisable hors ligne.
- Politique de confidentialité : ajout du stockage cloud Supabase (nom et e-mail de contact renseignés depuis).

## Changements v9.4.0
- Onglet Commandes : boutons « Historique du colis » (chronologie datée), « Commander à nouveau » (copie la commande) et « Preuve d’achat » (reçu téléchargeable) ; mention du délai de retour de 7 jours après livraison, comme sur Jumia.
- Les dates des étapes sont enregistrées à partir de cette version ; les anciennes commandes n’ont que la date de création.

## Changements v9.3.1 (sécurité)
- Politique de sécurité du contenu (CSP) dans index.html ; adresse Firebase vérifiée (firebaseio.com / firebasedatabase.app) avant tout envoi.
- Suivi d’une commande annulée : chronologie corrigée.
- Dépôt nettoyé : plus de clé de signature, d’APK ni de doublons ; .gitignore ajouté. Règles Firebase : utiliser uniquement database.rules.json.

## Changements v9.3.0
- Suivi client : chronologie verticale datée (reçue, validée, en livraison, livrée ou annulée) et carte « Détail de la commande » (montant, adresse, paiement à la livraison), inspirées du suivi Jumia.
- Le lien client contient maintenant le montant, l’adresse et la date de commande ; renvoyer le lien pour les anciennes commandes.

## Changements v8.7.0
- Saisie d’adresse : suggestions de types de voie (rue, boulevard, avenue, route, quartier…), d’adresses déjà utilisées et d’adresses OpenStreetMap ; suggestions de villes.
- Bouton « Marquer le repère sur la carte » sous chaque adresse (commande, vendeur, ajout) : le point est gardé avec la commande ou le vendeur.
- Le lien livreur utilise le repère exact pour l’itinéraire ; la carte d’accueil l’affiche.

## Changements v8.6.1
- Habillage noir / orange inspiré de « Max it » (Orange Maroc) ; la photo de profil, si présente, colore l’en-tête, le fond et le menu.
- Rôles (cloud.js) : le rôle du compte est connu dès le démarrage, même hors ligne. Un livreur ne voit que Livraison, un vendeur que Commandes, sans Compte ni Finances.
- Limite : cette garde est dans l’interface. L’isolation réelle des données demande les règles RLS Supabase (voir README).

## Changements v8.6.0
- Affichage plus compact (textes, cartes, boutons, menu du bas, carte) et compatible iPhone / Android / tous navigateurs.
- Accueil : carte des livraisons en cours par ville + bouton « Me géolocaliser » (aussi sur la carte de suivi Livraison).
- Adresses modifiables : bouton « Modifier adresse » sur chaque commande (nom, téléphone, adresse, ville + adresse du vendeur).
- Accueil : carte « À vérifier » (adresse manquante, ville inconnue, sans livreur, +48 h non livrée, numéro en double).
- Couleurs de l’en-tête, du fond, du menu et de la barre du navigateur calculées d’après la photo de profil.

## Changements v8.5.0 (réorganisation)
- En-tête : ta photo (ou tes initiales) ouvre Mon profil.
- Menu Compte regroupé : Pilotage de l’activité · Développement commercial · Outils terrain · Prospection · Profil & paramètres.
- Réglages en 4 volets : Profil · Activité (tarifs, messages) · Sécurité (code, biométrie, sauvegarde) · Connexions (suivi, import, cloud).
- Doublons supprimés : livreurs (une seule gestion, dans Réseau professionnel), formulaire d’article (Catalogue produits), export Excel (Finances), tableaux ville/canal (Finances), mémo de rappel (Relances WhatsApp), avis clients (une seule note moyenne, dans Livraison → Preuves & avis).
- Nom, société, téléphone, e-mail et ville du profil alimentent l’accueil et les relevés de commissions.

## Changements v8.4.0 (profil)
- Réglages → onglet **Profil** : carte de profil (photo, nom, fonction, société, téléphone/WhatsApp, e-mail, ville, Instagram), enregistrement, « Ajouter à mes contacts » (.vcf) et partage.
- Le nom, le téléphone, l’Instagram et le RIB sont ceux déjà utilisés pour les relevés et les liens vendeurs.

## Changements v8.1.2 (étape 0 : filet de sécurité)
- Version alignée partout (appli, cache du service worker, README).
- Restauration : une copie des données actuelles est téléchargée avant de les remplacer ; avertissement si la sauvegarde chiffrée est restaurée sans code activé.

## Changements v8.2.0 (étape 1 : fondations cloud)
- Nouveau fichier cloud.js : compte, création d’entreprise et copie des données vers Supabase (Réglages → Compte cloud).
- L’application reste locale d’abord ; le cloud est pour l’instant une copie. Voir supabase/GUIDE-ETAPE-1.md.

## Changements v8.3.0 (étape 2a : synchronisation)
- Synchronisation automatique entre appareils (commandes, vendeurs, livreurs, paiements, liste noire) : Réglages → Compte cloud → Synchronisation.
- Dernier envoi gagne, par enregistrement ; une modification locale non envoyée n’est jamais écrasée. Les images restent locales (étape 2c).

## Fonctions
Mode d'emploi intégré · formation en vidéo (`formation/`) · Appels et WhatsApp « en un mot » avec mémo de rappel · commandes · suivi de livraison (carte, simulation, preuve photo GPS) · avis 1 à 5 · finances et rapport hebdomadaire · import automatique · verrouillage par code, empreinte ou visage · arabe / anglais (partiel).

## Sécurité
- Code de livraison limité à 3 essais par mission (blocage serveur de 30 min après déploiement de la fonction).
- Verrouillage par code PIN (chiffrement AES-GCM) ; empreinte / visage via le système du téléphone, sans jamais quitter l'appareil.

## Limites connues
- Le suivi sécurisé et le blocage serveur ne sont actifs qu’après déploiement de la Cloud Function et des règles Firebase, puis configuration de la clé dans l’application. Les anciens liens doivent être réémis.
- Les réponses WhatsApp des clients ne sont pas lues automatiquement (API WhatsApp Business payante).
- NFC, caméra, GPS et Firebase réels : à tester sur de vrais téléphones. Le NFC ne fonctionne pas sur iPhone.
- Conformité loi 09-08 : voir GUIDE-MISE-EN-SERVICE.md (déclaration CNDP et autorisation de transfert à faire).
