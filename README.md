# All In One — Amk Logistique (v9.6.1)
Application web installable (PWA) de confirmation, livraison et suivi des commandes paiement à la livraison (COD) au Maroc.
Données chiffrées sur le téléphone, suivi en direct et import automatique via Firebase (facultatifs).

## Fichiers à mettre à la racine du dépôt GitHub
index.html · styles.css · app.js · cloud.js · sw.js · manifest.webmanifest · privacy.html · icon-192.png · icon-512.png · icon-512-maskable.png
Hors site : import-gmail.gs (Google Apps Script), GUIDE-MISE-EN-SERVICE.md, README.md.
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
2. Rouvrir l'appli deux fois (mise à jour du cache). Le numéro de version s'affiche en haut.

## Changements v9.6.0
- Menu Plus : 5 groupes repliables (seul le premier est ouvert).
- Automatisations : liste noire automatique après 2 refus à la livraison (désactivée par défaut) et alerte de colis en livraison depuis plus de 48 h.

## Changements v9.5.0 (écrans simplifiés)
- Appels, Commandes, Suivi des colis : chaque carte n'affiche plus que l'essentiel ; le reste est rangé dans « Plus d'options ». Bouton « Tout déplier / replier » en haut de l'écran.

## Changements v9.4.1 (audit)
- Leaflet hébergé dans vendor/leaflet (plus de CDN) : la CSP n’autorise plus que les scripts du site ; carte utilisable hors ligne.
- Politique de confidentialité : ajout du stockage cloud Supabase. À compléter avant publication : [NOM / SOCIÉTÉ] et [E-MAIL DE CONTACT].

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
Appels et WhatsApp « en un mot » avec mémo de rappel · commandes · suivi de livraison (carte, simulation, preuve photo GPS) · avis 1 à 5 · finances et rapport hebdomadaire · import automatique · verrouillage par code, empreinte ou visage · arabe / anglais (partiel).

## Sécurité
- Code de livraison limité à 3 essais par mission (blocage serveur de 30 min après déploiement de la fonction).
- Verrouillage par code PIN (chiffrement AES-GCM) ; empreinte / visage via le système du téléphone, sans jamais quitter l'appareil.

## Limites connues
- Le suivi sécurisé et le blocage serveur ne sont actifs qu’après déploiement de la Cloud Function et des règles Firebase, puis configuration de la clé dans l’application. Les anciens liens doivent être réémis.
- Les réponses WhatsApp des clients ne sont pas lues automatiquement (API WhatsApp Business payante).
- NFC, caméra, GPS et Firebase réels : à tester sur de vrais téléphones. Le NFC ne fonctionne pas sur iPhone.
- Conformité loi 09-08 : voir GUIDE-MISE-EN-SERVICE.md (déclaration CNDP et autorisation de transfert à faire).
