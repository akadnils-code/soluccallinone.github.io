# -*- coding: utf-8 -*-
# Script de la vidéo « All In One – Amk Logistique ». Chaque phrase décrit uniquement une fonction réellement présente dans l'application (v10.2.2).
NAV = lambda i: [i * 412 / 6, 797, 412 / 6, 63]

SECTIONS = [
    "Introduction",
    "Le problème résolu",
    "Présentation de l’application",
    "Découverte des menus",
    "Explication détaillée",
    "Démonstration pratique",
    "Les avantages",
    "Conclusion",
]

B = []
def beat(sec, mode, screen, title, pts, say, hl=True, hlrect=None, cards=None, kicker=None):
    B.append(dict(sec=sec, mode=mode, screen=screen, title=title, pts=pts, say=say, hl=hl, hlrect=hlrect, cards=cards or [], kicker=kicker or ""))

# ---------- 0 Introduction ----------
beat(0, "full", None, "All In One", [],
     ["Bonjour, et bienvenue.",
      "Je vous présente All In One, l’application d’Amk Logistique.",
      "Dans cette vidéo, nous allons parcourir chaque onglet, chaque menu, et voir pas à pas comment s’en servir."],
     cards=[("Confirmer", "les commandes payées à la livraison"), ("Livrer", "et suivre chaque colis"), ("Encaisser", "et tenir vos comptes")], kicker="Application de confirmation et de livraison")

# ---------- 1 Problème ----------
beat(1, "full", None, "Le problème", [],
     ["Quand on vend en ligne avec paiement à la livraison, tout repose sur la confirmation.",
      "Un client qui ne répond pas, une adresse incomplète, un colis refusé : ce sont du temps et de l’argent perdus.",
      "All In One réunit au même endroit la confirmation des commandes, le suivi de la livraison et les comptes avec vos vendeurs."],
     cards=[("Client injoignable", "il faut relancer, encore et encore"), ("Adresse incomplète", "le livreur ne trouve pas"), ("Colis refusé", "un retour qui coûte cher"), ("Une seule application", "confirmation · livraison · comptes")], kicker="Ce que l’application résout")

# ---------- 2 Présentation ----------
beat(2, "phone", "home", "À qui s’adresse l’application ?",
     ["Confirmateurs de commandes", "Vendeurs en ligne : Instagram, TikTok, Facebook, WhatsApp", "Livreurs et réseau de livraison"],
     ["Elle s’adresse aux confirmateurs de commandes, aux vendeurs en ligne qui vendent sur Instagram, TikTok, Facebook ou WhatsApp, et à ceux qui gèrent des livreurs.",
      "C’est une application web, installable sur le téléphone, qui continue de fonctionner hors ligne."], hl=False)

# ---------- 3 Menus ----------
beat(3, "phone", "home", "Les six onglets du bas",
     ["Accueil", "Confirmer", "Commandes", "Livraison", "Compte", "Paramètres"],
     ["En bas de l’écran, six onglets : Accueil, Confirmer, Commandes, Livraison, Compte et Paramètres.",
      "Nous allons les ouvrir un par un."], hlrect=[0, 797, 412, 63])

# ---------- 4 Détail ----------
beat(4, "phone", "home", "Accueil · le résumé de la journée",
     ["Commandes en attente", "Taux de confirmation du mois", "Gain en dirhams"],
     ["L’accueil résume votre journée : les commandes en attente, le taux de confirmation du mois et vos gains en dirhams.",
      "Cinq raccourcis ronds, en haut, ouvrent directement Confirmer, Commandes, Livraison, Vendeurs et l’Aide."], hlrect=[8, 62, 396, 84])
beat(4, "phone", "home_check", "Accueil · boutiques et alertes",
     ["Mes boutiques, avec leur code QR", "À vérifier : commandes à corriger"],
     ["Plus bas, vos boutiques avec leur code QR, puis la carte À vérifier, qui signale les commandes à corriger, par exemple celles sans livreur."], hl=False)

beat(4, "phone", "calls", "Confirmer · les appels à passer",
     ["Appeler", "Confirmé", "Annulé"],
     ["Dans Confirmer, chaque commande à appeler affiche trois boutons : Appeler, Confirmé et Annulé.",
      "Après trois tentatives sans réponse, le client est marqué injoignable et relancé par WhatsApp."])
beat(4, "phone", "calls_more", "Confirmer · Plus d’options",
     ["Script d’appel", "Lien de confirmation client", "Rappeler dans 1 h, 3 h ou demain", "Modifier l’adresse"],
     ["Le bouton Plus d’options ouvre le script d’appel, le lien de confirmation à envoyer au client, les rappels à une heure, trois heures ou demain, et la modification de l’adresse."], hl=False)
beat(4, "phone", "calls_wa", "Confirmer · Relances WhatsApp",
     ["Envoyer sur WhatsApp", "Le client répond OUI, NON ou MODIFIER", "Vous touchez sa réponse"],
     ["L’onglet Relances WhatsApp prépare le message à envoyer.",
      "Le client répond oui, non ou modifier, et vous touchez sa réponse dans l’application."])

beat(4, "phone", "ord", "Commandes · retrouver une commande",
     ["Filtre par vendeur", "Filtre par statut", "Recherche : nom ou numéro"],
     ["Dans Commandes, vous filtrez par vendeur et par statut, ou vous cherchez un nom ou un numéro."], hlrect=[12, 82, 388, 118])
beat(4, "phone", "ord_cards", "Commandes · après la confirmation",
     ["Historique du colis", "Commander à nouveau", "Détails & actions"],
     ["Une commande confirmée propose l’historique du colis, la possibilité de commander à nouveau, et un menu de détails et d’actions."])
beat(4, "phone", "ord_add", "Commandes · Ajouter une commande",
     ["Vendeur, client, téléphone", "Produit, adresse, ville", "Montant à encaisser, canal de vente"],
     ["Pour ajouter une commande, ouvrez l’onglet Ajouter et remplissez le formulaire : vendeur, client, téléphone, produit, adresse, ville, montant à encaisser et canal de vente."])
beat(4, "phone", "ord_paste", "Commandes · Coller un message WhatsApp",
     ["Colle « NOUVELLE COMMANDE… »", "Plusieurs messages d’un coup"],
     ["Vous pouvez aussi coller un message de commande reçu sur WhatsApp, ou plusieurs d’un coup."])
beat(4, "phone", "ord_bulk", "Commandes · Liste ou fichier CSV",
     ["Une commande par ligne", "Depuis Excel ou Google Sheets", "Ou un fichier CSV"],
     ["Autre solution : coller une liste, une commande par ligne, depuis Excel ou Google Sheets, ou choisir un fichier C S V."])

beat(4, "phone", "del", "Livraison · les quatre compteurs",
     ["À valider", "Validées", "En cours de livraison", "Livrées"],
     ["L’onglet Livraison affiche quatre compteurs : à valider, validées, en cours de livraison et livrées."], hlrect=[12, 275, 388, 60])
beat(4, "phone", "del_map", "Livraison · la carte et le trajet",
     ["Carte nationale des livraisons en cours", "Suivi Waze", "Simulation de trajet"],
     ["Une carte du Maroc montre les livraisons en cours, avec le suivi Waze et une simulation de trajet."], hl=False)
beat(4, "phone", "del_cards", "Livraison · confier un colis",
     ["Choisir le livreur", "Remis au livreur", "Annulé"],
     ["Pour chaque commande validée, vous choisissez le livreur, puis vous touchez Remis au livreur."])
beat(4, "phone", "del_proofs", "Livraison · preuves et avis",
     ["Photo du colis remis", "Horodatée, avec la position GPS", "Sondages de satisfaction"],
     ["Preuves et avis rassemble la photo du colis remis, horodatée avec l’heure et la position GPS, et les sondages de satisfaction."])

beat(4, "phone", "more", "Compte · Gestion",
     ["Vendeurs partenaires", "Finances & soldes", "Automatisations", "Catalogue, réseau, affaires, prévisions, partenariat"],
     ["L’onglet Compte regroupe vos outils en deux parties : Gestion et Opérations.",
      "Dans Gestion, on trouve le pilotage de l’activité et le développement commercial."], hl=False)
beat(4, "phone", "vend", "Compte · Vendeurs partenaires",
     ["Une fiche par boutique", "Commission par confirmation et par livraison", "Ajouter un vendeur"],
     ["Dans Vendeurs partenaires, chaque boutique a sa fiche, avec ses commissions : par défaut, cinq dirhams à la confirmation et six dirhams si la commande est livrée."])
beat(4, "phone", "fin", "Compte · Finances et soldes",
     ["Total gagné, déjà reçu, à encaisser", "Par vendeur, par ville, par canal, par livreur", "Export Excel"],
     ["Finances et soldes affiche le total gagné, le déjà reçu et l’à encaisser, puis le détail par vendeur, par ville, par canal de vente et par livreur, avec un export Excel."])
beat(4, "phone", "fin_week", "Compte · Rapport hebdomadaire",
     ["Commandes reçues, confirmées, annulées", "Quand vos clients commandent", "Recommandations"],
     ["Le rapport hebdomadaire résume la semaine, montre à quelle heure vos clients commandent, et propose des recommandations."], hl=False)
beat(4, "phone", "auto", "Compte · Automatisations",
     ["Livreur attribué automatiquement", "Liste noire après 2 refus", "Alerte colis en livraison depuis plus de 48 h"],
     ["Les automatisations attribuent un livreur automatiquement, rappellent les appels à passer, ajoutent un client à la liste noire après deux refus, et alertent si un colis est en livraison depuis plus de quarante-huit heures."])
beat(4, "phone", "net", "Compte · Développement commercial",
     ["Catalogue produits", "Réseau professionnel : acheteurs, grossistes, livreurs", "Affaires & simulateur de marge"],
     ["Le catalogue regroupe les produits de vos vendeurs.",
      "Le réseau professionnel garde vos contacts : acheteurs, grossistes et livreurs.",
      "Affaires et marges propose un simulateur de marge."], hl=False)
beat(4, "phone", "sim", "Compte · Prévisions et partenariat",
     ["Prévision de revenus", "Reversements aux vendeurs", "Proposition aux sociétés de livraison"],
     ["Prévisions de revenus estime vos commissions à la semaine et au mois.",
      "Partenariat livraison suit les reversements aux vendeurs et propose un texte à envoyer aux sociétés de livraison."], hl=False)
beat(4, "phone", "tools", "Compte · Opérations",
     ["Codes QR & étiquettes NFC", "Calculatrice", "Carnet de prospects"],
     ["Dans Opérations, les codes QR et les étiquettes NFC servent à partager ou scanner un lien, comme celui d’un vendeur ou la mission d’un livreur."])
beat(4, "phone", "calc", "Compte · Calculatrice",
     ["Calculs rapides, sans quitter l’application"],
     ["Une calculatrice intégrée permet de faire un calcul rapide."], hl=False)
beat(4, "phone", "wl", "Compte · Carnet de prospects",
     ["Confirmés · Annulés · Refusés", "Recherche par nom ou numéro", "Nouveau prospect"],
     ["Et le carnet de prospects suit vos appels sortants."], hl=False)

beat(4, "phone", "set_hub", "Paramètres · huit rubriques",
     ["Compte et profil", "Tarifs et messages", "Sécurité et confidentialité", "Sauvegarde et données", "Connexions · Carte · Langue · Aide"],
     ["Paramètres compte huit rubriques : Compte et profil, Tarifs et messages, Sécurité et confidentialité, Sauvegarde et données, Connexions, Carte, Langue, et Aide et à propos."], hlrect=[12, 108, 388, 420])
beat(4, "phone", "set_sec", "Paramètres · Sécurité",
     ["Code d’accès (chiffrement AES-256)", "Empreinte ou visage", "Politique de confidentialité"],
     ["Dans Sécurité et confidentialité, vous activez un code qui chiffre vos données sur l’appareil, et l’empreinte ou le visage si votre téléphone le permet."])
beat(4, "phone", "set_dat", "Paramètres · Sauvegarde et données",
     ["Télécharger la sauvegarde", "Restaurer un fichier .json", "Données de démonstration"],
     ["Sauvegarde et données permet de télécharger une copie chaque semaine, de la restaurer, et de charger des données de démonstration pour tester."])
beat(4, "phone", "set_help", "Paramètres · Aide et à propos",
     ["Mode d’emploi pas à pas", "Version & mises à jour"],
     ["Enfin, Aide et à propos ouvre le mode d’emploi pas à pas, et la page Version et mises à jour, pour installer la dernière version sans rien perdre."])

# ---------- 5 Démonstration ----------
beat(5, "phone", "d1_vendor", "Étape 1 · Créer un vendeur",
     ["Compte → Vendeurs partenaires", "Ajouter un vendeur", "Nom, téléphone, ville, puis Créer la fiche"],
     ["Passons à la pratique, avec un vrai parcours dans l’application.",
      "Étape un : Compte, Vendeurs partenaires, Ajouter un vendeur.",
      "Je saisis le nom de la boutique, son téléphone et sa ville, puis je crée la fiche."])
beat(5, "phone", "d1_vendor_ok", "Étape 1 · La boutique est créée",
     ["Vendeur ajouté", "La boutique apparaît dans la liste"],
     ["Le vendeur est ajouté, et la boutique apparaît dans la liste."])
beat(5, "phone", "d2_form", "Étape 2 · Ajouter une commande",
     ["Commandes → Ajouter", "Vendeur, client, téléphone, produit, adresse, ville"],
     ["Étape deux : dans Commandes, onglet Ajouter, je renseigne la boutique, la cliente, son numéro, le produit, l’adresse et la ville."], hl=False)
beat(5, "phone", "d2_add", "Étape 2 · Valider",
     ["Toucher Ajouter"], ["Je touche Ajouter."])
beat(5, "phone", "d2_list", "Étape 2 · La commande est créée",
     ["Statut : En attente"], ["La commande apparaît dans la liste, avec le statut En attente."])
beat(5, "phone", "d3_call", "Étape 3 · Confirmer",
     ["Confirmer → Appeler", "Puis Confirmé"],
     ["Étape trois : dans Confirmer, j’appelle la cliente, puis je touche Confirmé."])
beat(5, "phone", "d3_done", "Étape 3 · Confirmation enregistrée",
     ["« Confirmée » s’affiche"], ["L’application enregistre la confirmation."], hl=False)
beat(5, "phone", "d4_hand", "Étape 4 · Remise au livreur",
     ["Livraison → commande validée", "Remis au livreur"],
     ["Étape quatre : dans Livraison, la commande validée attend son livreur.",
      "Je touche Remis au livreur."])
beat(5, "phone", "d4_after", "Étape 4 · Prévenir le client",
     ["SMS ou WhatsApp", "Compteur « En cours de livraison » : 1"],
     ["L’application propose de prévenir la cliente par S M S ou par WhatsApp, et le compteur En cours de livraison passe à un."])
beat(5, "phone", "d5_fin", "Étape 5 · Suivre les résultats",
     ["Commandes reçues, confirmées, annulées", "Rapport hebdomadaire"],
     ["Étape cinq : le rapport hebdomadaire met à jour les commandes reçues, confirmées et annulées."], hl=False)

# ---------- 6 Avantages ----------
beat(6, "full", None, "Les avantages", [],
     ["Tout est réuni dans une seule application : confirmation, livraison et comptes vendeurs.",
      "Elle s’installe sur le téléphone, continue de fonctionner hors ligne, et vos données sont chiffrées sur votre appareil avec un code.",
      "Le français et l’arabe sont disponibles, l’arabe de façon partielle.",
      "Le suivi en direct, l’import automatique des commandes et le compte cloud sont facultatifs."],
     cards=[("Tout en un", "confirmation · livraison · comptes"), ("Installable et hors ligne", "données chiffrées par code"), ("Français et arabe", "arabe : traduction partielle"), ("Options facultatives", "suivi en direct, import, cloud")], kicker="Pourquoi All In One")

# ---------- 7 Conclusion ----------
beat(7, "full", None, "Merci !", [],
     ["Voilà pour le tour complet de All In One.",
      "Confirmer, livrer, encaisser : tout se fait depuis votre téléphone.",
      "Installez l’application, créez votre premier vendeur, et lancez-vous.",
      "Merci de votre attention."],
     cards=[("Confirmer", "Appeler · Confirmé · Annulé"), ("Livrer", "Remis au livreur · suivi"), ("Encaisser", "Finances & soldes")], kicker="logisticsallinoneamk@gmail.com")
