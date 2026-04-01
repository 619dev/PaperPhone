# PaperPhone IM

🌐 **Andere Sprachen / Other Languages:** [中文](README.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [Français](README_FR.md) · [Русский](README_RU.md) · [Español](README_ES.md)

Eine Instant-Messaging-App im WeChat-Stil mit Ende-zu-Ende-Verschlüsselung über zustandsloses ECDH + XSalsa20-Poly1305 pro Nachricht, Echtzeit-Videoanrufe, Cloudflare R2 Dateispeicher, Mehrsprachigkeit und iOS-PWA-Bereitstellung.

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

## Funktionen

| Funktion | Beschreibung |
|----------|-------------|
| 🔐 E2E-Verschlüsselung | Zustandsloses ECDH + XSalsa20-Poly1305 — ephemere Schlüssel pro Nachricht, Forward Secrecy |
| 🗝️ Zero-Knowledge-Server | Server speichert nur Chiffretext; private Schlüssel verlassen niemals das Gerät |
| 📹 Video-/Sprachanrufe | WebRTC P2P (1:1) + Mesh (Gruppe), Cloudflare TURN für NAT-Traversal |
| 👥 Gruppenchat | Bis zu 2000 Mitglieder, Klartextnachrichten, Nicht-stören-Modus, Mitgliederverwaltung |
| ⏱️ Auto-Löschung | 5 Stufen (nie/1T/3T/1W/1M), in DMs beidseitig einstellbar, in Gruppen nur Inhaber |
| 🔔 Push-Benachrichtigungen | Web Push (VAPID) + OneSignal Dual-Kanal |
| 🌐 Mehrsprachig | ZH/EN/JA/KO/FR/DE/RU/ES — automatische Erkennung + manuelle Umschaltung |
| 📱 iOS ohne Unternehmenszertifikat | PWA über Safari „Zum Home-Bildschirm", funktioniert dauerhaft ohne Apple-Signatur |
| 💬 Rich Messaging | Text, Bilder, Video, Dokumentdateien (PDF/DOCX/XLSX usw. mit Typ-Icons), Sprachnachrichten, 200+ Emoji-Panel (8 Kategorien), Telegram-Stickerpakete, Lesebestätigungen |
| 🌐 Momente | Sozialer Feed: Text + bis zu 9 Fotos oder 1 Video (≤ 10 Min.), Likes (Freunde-Avatare), Kommentare, Tag-basierte Sichtbarkeit |
| 👤 Benutzerprofil | Kontaktprofil (Avatar/Nickname/Momente-Feed), mit bidirektionalen Datenschutzkontrollen „Deren Momente ausblenden“ und „Meine Momente verbergen“ |
| 📰 Zeitachse | Öffentlicher Feed im Xiaohongshu-Stil — 2-Spalten-Masonry-Layout, Bilder/Videos + Text (max. 50 Medien, 2000 Zeichen), anonymes Posten, Likes & Kommentare |
| 🏷️ Freunde-Tags | Mehrere Tags pro Freund (12-Farben-Palette), Kontakte nach Tags filtern |
| 🗂️ R2-Speicher | Cloudflare R2 für Bild-/Audiodateien — optionale CDN-URL |
| 🔑 Zwei-Faktor-Auth (2FA) | Google Authenticator–kompatibles TOTP, 8 einmalige Wiederherstellungscodes, Pflichtprüfung bei Anmeldung |
| 🏗️ Self-Hosting | Docker Compose Ein-Befehl-Deployment |

---

## Technologie-Stack

```
Backend (server/)
  Node.js 20 + Express + ws
  MySQL 8.0 — Benutzer, Nachrichten (verschlüsselt)
  Redis — Online-Status + Knotenübergreifendes Routing
  Cloudflare R2 — Bild-/Audio-Dateispeicher (S3-kompatible API)
  JWT + bcrypt Authentifizierung

Frontend (client/)
  Natives HTML + Vanilla JS (ESM, kein Bundler)
  libsodium-wrappers (WebAssembly — Curve25519 / XSalsa20-Poly1305)
  WebRTC API — Video-/Sprachanrufe
  PWA: manifest.json + Service Worker

Kryptographieschicht
  Zustandsloses ECDH + XSalsa20-Poly1305 — ephemeres Schlüsselpaar pro Nachricht
  4-Stufen-Schlüsselpersistenz: Speicher → localStorage → sessionStorage → IndexedDB
  Alle privaten Schlüssel nur auf dem Gerät — nie an den Server gesendet
```

---

## Schnellstart

### Option 0: Zeabur Ein-Klick-Cloud-Deployment

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> Nach dem Deployment ist ein manueller Schritt erforderlich:
> 1. Zeabur-Konsole → **server**-Dienst → Umgebungsvariablen → `ZEABUR_WEB_URL` kopieren
> 2. **client**-Dienst → Umgebungsvariablen → `SERVER_URL` = kopierter Wert
> 3. Client-Dienst neu starten

### Option 1: Docker Compose (empfohlen)

```bash
git clone <repo-url> && cd paperphone
cp server/.env.example server/.env
# Variablen bearbeiten: DB_PASS / JWT_SECRET / R2_* usw.
docker compose up -d
open http://localhost
```

> Docker-Hub-Images: `facilisvelox/paperphone-client:latest` und `facilisvelox/paperphone-server:latest`

### Option 2: Lokaler manueller Start

```bash
# Backend
cd server && npm install && npm run dev   # → http://localhost:3000

# Frontend
npx serve client -p 8080   # → http://localhost:8080
```

---

## Videoanruf-Konfiguration — Cloudflare TURN

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

| Typ | Transport | Empfohlen für |
|-----|-----------|---------------|
| 1:1 Video | WebRTC P2P + TURN | Alle Szenarien |
| 1:1 Sprache | WebRTC P2P + TURN | Alle Szenarien |
| Gruppenanruf | WebRTC Mesh | Bis zu 6 Teilnehmer |

> **Ohne Konfiguration**: Nur STUN. LAN-Anrufe funktionieren ohne Einrichtung.

---

## Push-Benachrichtigungen

| Kanal | Plattformen | Konfiguration |
|-------|-------------|---------------|
| Web Push | Browser + iOS PWA (Safari 16.4+) | VAPID-Schlüssel |
| OneSignal | Native Apps über Median.co | App ID + REST Key |

```bash
npx web-push generate-vapid-keys
```

---

## iOS — Permanente Installation ohne Zertifikat

1. Auf HTTPS-Server bereitstellen → 2. In Safari öffnen → 3. Teilen ⬆️ → 4. „Zum Home-Bildschirm"

---

## Sicherheitsmodell

```
Registrierung: IK + SPK + 10×OPK lokal generiert, öffentliche Schlüssel hochgeladen
Nachricht: Ephemeres ECDH → X25519 → XSalsa20-Poly1305
Server sieht: ✅ Chiffretext + Routing-Metadaten  ❌ Klartext / private Schlüssel
```

---

## Datenbankschema

18 Tabellen, automatisch beim ersten Start erstellt:

| Tabelle | Zweck |
|---------|-------|
| `users` | Benutzerprofile + ECDH/OPK-Schlüssel |
| `prekeys` | X3DH-Einmal-Prekeys |
| `friends` | Freundschaftsbeziehungen |
| `groups` / `group_members` | Gruppenchats + Mitglieder |
| `messages` | Verschlüsselte Nachrichten |
| `moments` / `moment_images` | Soziale Beiträge + Bilder |
| `moment_videos` | Beitrags-Videos (Vorschaubild + Dauer, 1 pro Beitrag, ≤ 10 Min.) |
| `moment_likes` / `moment_comments` | Likes + Kommentare |
| `push_subscriptions` | Web Push (VAPID) |
| `onesignal_players` | OneSignal-Geräte (Median.co) |
| `user_totp` | TOTP-Zwei-Faktor-Authentifizierungsschlüssel und Wiederherstellungscodes |
| `moment_privacy` | Momente-Benutzer-Datenschutzeinstellungen (ausblenden/verbergen) |
| `timeline_posts` | Zeitachse-Beiträge (Text ≤2000 Zeichen, anonym möglich) |
| `timeline_media` | Zeitachse-Medien (Bilder/Videos, max. 50 pro Beitrag) |
| `timeline_likes` | Zeitachse-Likes |
| `timeline_comments` | Zeitachse-Kommentare (anonym möglich) |

---

## Umgebungsvariablen

| Variable | Beschreibung | Standard |
|----------|-------------|----------|
| `PORT` | Server-Port | `3000` |
| `JWT_SECRET` | JWT-Signaturschlüssel (**in Produktion ändern**) | dev_secret |
| `DB_HOST`/`DB_PASS`/`DB_NAME` | MySQL-Verbindung | — |
| `REDIS_HOST`/`REDIS_PASS` | Redis-Verbindung | — |
| `R2_ACCOUNT_ID` | Cloudflare-Konto-ID | — |
| `R2_ACCESS_KEY_ID` | R2-API-Zugriffsschlüssel | — |
| `R2_SECRET_ACCESS_KEY` | R2-API-Geheimschlüssel | — |
| `R2_BUCKET` | R2-Bucket-Name | — |
| `R2_PUBLIC_URL` | Öffentliche R2-URL (optional) | — |
| `CF_CALLS_APP_ID` | Calls App ID (optional) | — |
| `CF_CALLS_APP_SECRET` | Calls Secret (optional) | — |
| `VAPID_PUBLIC_KEY` | VAPID öffentlicher Schlüssel (optional) | — |
| `VAPID_PRIVATE_KEY` | VAPID privater Schlüssel (optional) | — |
| `ONESIGNAL_APP_ID` | OneSignal App ID (optional) | — |
| `ONESIGNAL_REST_KEY` | OneSignal REST Key (optional) | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (optional, Sticker-Proxy) | — |
| `STICKER_PACKS` | Benutzerdefinierte Stickerpakete (optional, kommagetrennt `Name:Label`, unbegrenzt) | 8 Standard-Pakete |

---

## Lizenz

MIT © PaperPhone Contributors
