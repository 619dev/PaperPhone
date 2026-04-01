# PaperPhone IM

🌐 **Autres langues / Other Languages:** [中文](README.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [Deutsch](README_DE.md) · [Русский](README_RU.md) · [Español](README_ES.md)

Une application de messagerie instantanée chiffrée de bout en bout, style WeChat, avec chiffrement ECDH sans état + XSalsa20-Poly1305 par message, appels vidéo en temps réel, stockage Cloudflare R2, support multilingue et déploiement iOS PWA.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](#) [![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](#) [![Redis](https://img.shields.io/badge/Redis-7.x-red)](#) [![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20%2B%20Mesh-orange)](#)

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

---
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui1.jpg" alt="ui1">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui2.jpg" alt="ui2">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui3.jpg" alt="ui3">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui4.jpg" alt="ui4">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui5.jpg" alt="ui5">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui6.jpg" alt="ui6">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui7.jpg" alt="ui7">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui8.jpg" alt="ui8">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui9.jpg" alt="ui9">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui10.jpg" alt="ui10">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui11.jpg" alt="ui11">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui12.jpg" alt="ui12">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui13.jpg" alt="ui13">
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/ui14.jpg" alt="ui14">

## Fonctionnalités

| Fonction | Description |
|----------|-------------|
| 🔐 Chiffrement E2E | ECDH sans état + XSalsa20-Poly1305 — clés éphémères par message, secret de transmission |
| 🗝️ Serveur à connaissance nulle | Le serveur ne stocke que le texte chiffré ; les clés privées ne quittent jamais l'appareil |
| 📹 Appels vidéo/audio | WebRTC P2P (1:1) + Mesh (groupe), Cloudflare TURN pour traversée NAT |
| 👥 Chat de groupe | Jusqu'à 2000 membres, messages en texte brut, mode Ne pas déranger |
| ⏱️ Suppression auto | 5 niveaux (jamais/1j/3j/1sem/1mois) |
| 🔔 Notifications push | Web Push (VAPID) + OneSignal double canal |
| 🌐 Multilingue | 中/EN/日/한/FR/DE/RU/ES — détection auto + sélection manuelle |
| 📱 iOS PWA | Safari « Ajouter à l'écran d'accueil », sans certificat Apple |
| 💬 Messagerie riche | Texte, images, vidéo, fichiers (PDF/DOCX/XLSX etc. avec icônes de type), audio, 200+ émojis (8 catégories), packs de stickers Telegram, accusés de réception |
| 🌐 Moments | Fil social : texte + 9 photos ou 1 vidéo (≤ 10 min), likes (avatars), commentaires, visibilité par tags |
| 👤 Profil utilisateur | Page de profil (avatar / pseudo / fil Moments), avec contrôles de confidentialité bidirectionnels « Masquer ses moments » et « Masquer mes moments » |
| 📰 Chronologie | Fil public style Xiaohongshu — grille maçonnerie 2 colonnes, images/vidéos + texte (max 50 médias, 2000 car.), publication anonyme, likes & commentaires |
| 🏷️ Tags d'amis | Plusieurs tags par ami (12 couleurs), filtrage des contacts |
| 🗂️ Stockage R2 | Cloudflare R2 pour images/audio — CDN optionnel |
| 🔑 Auth à deux facteurs (2FA) | TOTP compatible Google Authenticator, 8 codes de récupération, vérification obligatoire à la connexion |
| 🏗️ Auto-hébergeable | Docker Compose en une commande |

---

## Stack technique

```
Backend (server/)
  Node.js 20 + Express + ws
  MySQL 8.0 — utilisateurs, messages chiffrés
  Redis — présence en ligne + routage inter-nœuds
  Cloudflare R2 — stockage fichiers (API S3)
  JWT + bcrypt

Frontend (client/)
  HTML natif + Vanilla JS (ESM, sans bundler)
  libsodium-wrappers (WebAssembly)
  WebRTC API — appels vidéo/audio
  PWA : manifest.json + Service Worker

Cryptographie
  ECDH sans état + XSalsa20-Poly1305 — clés éphémères par message
  Persistance 4 niveaux : mémoire → localStorage → sessionStorage → IndexedDB
  Clés privées uniquement sur l'appareil
```

---

## Démarrage rapide

### Option 0 : Zeabur en un clic

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> Étape manuelle requise après déploiement :
> 1. Console Zeabur → **server** → Variables → copier `ZEABUR_WEB_URL`
> 2. **client** → Variables → ajouter `SERVER_URL` = valeur copiée
> 3. Redémarrer le client

### Option 1 : Docker Compose (recommandé)

```bash
git clone <repo-url> && cd paperphone
cp server/.env.example server/.env
# Éditer les variables
docker compose up -d
open http://localhost
```

### Option 2 : Démarrage local

```bash
# Backend
cd server && npm install && npm run dev

# Frontend
npx serve client -p 8080
```

---

## Appels vidéo — Cloudflare TURN

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

> Sans configuration : STUN uniquement, appels LAN fonctionnent.

---

## Notifications push

| Canal | Plateformes | Configuration |
|-------|-------------|---------------|
| Web Push | Navigateurs + iOS PWA 16.4+ | Clés VAPID |
| OneSignal | Apps Median.co | App ID + REST Key |

```bash
npx web-push generate-vapid-keys
```

---

## iOS — Sans certificat

1. Déployer avec HTTPS → 2. Ouvrir dans Safari → 3. Partager ⬆️ → 4. « Ajouter à l'écran d'accueil »

---

## Sécurité

```
Inscription : IK + SPK + 10×OPK générés localement, clés publiques uploadées
Message : ECDH éphémère → X25519 → XSalsa20-Poly1305
Serveur voit : ✅ texte chiffré + métadonnées  ❌ texte clair / clés privées
```

---

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port serveur | `3000` |
| `JWT_SECRET` | Clé JWT (**changer en prod**) | dev_secret |
| `DB_HOST`/`DB_PASS`/`DB_NAME` | MySQL | — |
| `REDIS_HOST`/`REDIS_PASS` | Redis | — |
| `R2_ACCOUNT_ID` | Cloudflare ID | — |
| `R2_ACCESS_KEY_ID` | Clé d'accès R2 | — |
| `R2_SECRET_ACCESS_KEY` | Clé secrète R2 | — |
| `R2_BUCKET` | Nom du bucket | — |
| `R2_PUBLIC_URL` | URL publique (optionnel) | — |
| `CF_CALLS_APP_ID` | Calls App ID (optionnel) | — |
| `CF_CALLS_APP_SECRET` | Calls Secret (optionnel) | — |
| `VAPID_PUBLIC_KEY` | Clé publique VAPID (optionnel) | — |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID (optionnel) | — |
| `ONESIGNAL_APP_ID` | OneSignal ID (optionnel) | — |
| `ONESIGNAL_REST_KEY` | OneSignal Key (optionnel) | — |
| `TELEGRAM_BOT_TOKEN` | Token Bot Telegram (optionnel, proxy stickers) | — |
| `STICKER_PACKS` | Packs de stickers personnalisés (optionnel, séparés par virgule `nom:label`, illimité) | 8 packs par défaut |

---

## Licence

MIT © PaperPhone Contributors
