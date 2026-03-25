# PaperPhone IM

A WeChat-style end-to-end encrypted instant messaging app with stateless ECDH + XSalsa20-Poly1305 per-message encryption, real-time video calls, Cloudflare R2 file storage, multi-language support and iOS PWA deployment.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](#) [![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](#) [![Redis](https://img.shields.io/badge/Redis-7.x-red)](#) [![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20%2B%20Mesh-orange)](#)

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

---

## Features

| Feature | Description |
|---------|-------------|
| 🔐 End-to-End Encryption | Stateless ECDH + XSalsa20-Poly1305 — ephemeral keys per message, forward secrecy |
| 🗝️ Zero-Knowledge Server | Server stores only ciphertext; private keys never leave the device |
| 📹 Video & Voice Calls | WebRTC P2P (1:1) + Mesh (group), Cloudflare TURN for NAT traversal |
| 🌐 Multi-Language | Chinese, English, Japanese, Korean, French — auto-detect + manual switch |
| 📱 iOS — No Enterprise Cert | PWA via Safari "Add to Home Screen", works permanently without Apple signing |
| 💬 Rich Messaging | Text, images, voice messages, 64-emoji panel, delivery receipts, typing indicators |
| 🌐 Moments | WeChat-style social feed: text + up to 9 photos, likes, comments |
| 🗂️ R2 Object Storage | Cloudflare R2 for image/voice files — optional public CDN URL |
| 🏗️ Self-Hostable | Docker Compose one-command deployment; Node.js + Redis multi-node ready |

---

## Tech Stack

```
Backend (server/)
  Node.js 20 + Express + ws
  MySQL 8.0  — users, messages (persisted ciphertext)
  Redis      — online presence + cross-node routing
  Cloudflare R2 — image/voice file storage (S3-compatible API)
  JWT + bcrypt authentication

Frontend (client/)
  Native HTML + Vanilla JS (ESM, no bundler required)
  libsodium-wrappers (WebAssembly — Curve25519 / XSalsa20-Poly1305)
  WebRTC API — video / voice calls
  PWA: manifest.json + Service Worker

Cryptographic Layer
  Stateless ECDH + XSalsa20-Poly1305 — ephemeral keypair per message
  Four-tier key persistence: memory → localStorage → sessionStorage → IndexedDB
  All private keys stored on-device only — never sent to the server
```

---

## Quick Start

### Option 0: Zeabur One-Click Cloud Deploy

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> One manual step is required after the template deploys, otherwise login/register won't work:
> 1. Go to Zeabur Console → **server service** → Environment Variables → copy the value of `ZEABUR_WEB_URL` (e.g. `http://10.43.x.x:3000`)
> 2. Go to **client service** → Environment Variables → add variable `SERVER_URL` = the value copied above
> 3. Restart the client service

**Known notes:**
- On first startup, the server automatically creates all database tables (`CREATE TABLE IF NOT EXISTS`) — no manual SQL import needed
- Redis runs without a password inside the cluster (intra-cluster network isolation is sufficient)
- If MySQL access is denied, manually set `DB_PASS` on the server service to the value of `MYSQL_ROOT_PASSWORD` from the MySQL service
- To get the **internal IP** of any service container, open that service's Terminal in the Zeabur console and run:
  ```bash
  hostname -i
  ```

---

### Option 1: Docker Compose (Recommended — no local build needed)

```bash
# Clone the repository
git clone <repo-url> && cd paperphone

# Copy and edit environment variables
cp server/.env.example server/.env
# Fill in: DB_PASS / JWT_SECRET / CF_CALLS_APP_ID etc.

# Pull images and start everything
docker compose up -d

# Check service status
docker compose ps

# Open in browser
open http://localhost
```

> Pre-built images on Docker Hub:
> - `facilisvelox/paperphone-client:latest`
> - `facilisvelox/paperphone-server:latest`
>
> **Note**: The server automatically initialises the database schema on first startup — no manual SQL import required.

### Option 2: Manual Local Start

#### 1. Prepare the environment

```bash
# Copy and edit environment variables
cp server/.env.example server/.env
# Fill in DB_HOST / DB_PASS / REDIS_HOST / R2_* etc.

# Note: the server auto-runs schema.sql on first startup
```

#### 2. Start the backend

```bash
cd server
npm install
npm run dev   # → http://localhost:3000
```

#### 3. Start the frontend

```bash
npx serve client -p 8080
# → http://localhost:8080
```

---

## Video Call Configuration

Video and voice calls use WebRTC P2P and work out of the box on the same LAN. For cross-network calls, a TURN server is required for NAT traversal.

### Using Cloudflare TURN (Recommended)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Calls** → create an App
2. Copy the **App ID** and **App Secret** (Token Key)
3. Add them to `server/.env`:

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

4. Restart the backend — TURN credentials are fetched automatically per call session (TTL: 86 400 s)

> **Without credentials**: the server falls back to STUN only (Google + Cloudflare public STUN). Calls work on LAN without any extra configuration.

### Call Types

| Type | Transport | Recommended for |
|------|-----------|-----------------|
| 1:1 Video Call | WebRTC P2P + TURN | All scenarios |
| 1:1 Voice Call | WebRTC P2P + TURN | All scenarios |
| Group Video / Voice | WebRTC Mesh (full-mesh) | Up to 6 participants |

---

## iOS — Permanent No-Cert Deployment

1. Deploy to a server with an HTTPS domain (required for WebRTC and Web Crypto APIs)
2. Open `https://your.domain.com` in **Safari**
3. Tap the Share button ⬆️ at the bottom of the screen
4. Select **Add to Home Screen** → **Add**

The app behaves identically to a native app — no Apple enterprise certificate required, no expiry.

---

## Production Deployment (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend static files
    location / {
        root /path/to/paperphone/client;
        try_files $uri /index.html;
    }

    # REST API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # WebSocket (messaging + call signalling)
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

---

## Project Structure

```
paperphone/
├── docker-compose.yml
├── server/
│   ├── .env                    # Environment variables (incl. Cloudflare TURN keys)
│   └── src/
│       ├── app.js              # Express application
│       ├── routes/
│       │   ├── auth.js         # Register / Login (incl. X3DH public key upload)
│       │   ├── users.js        # User search / Prekey bundle download
│       │   ├── friends.js      # Friend requests / Accept
│       │   ├── groups.js       # Group management
│       │   ├── messages.js     # Historical messages (paginated ciphertext)
│       │   ├── upload.js       # Cloudflare R2 file upload
│       │   ├── files.js        # File proxy (when R2_PUBLIC_URL is not set)
│       │   ├── moments.js      # Moments feed (posts / likes / comments)
│       │   └── calls.js        # TURN credential issuance
│       └── ws/
│           └── wsServer.js     # WebSocket router (messages + call signalling)
│
└── client/
    ├── index.html              # SPA entry + PWA meta tags
    ├── manifest.json           # PWA manifest
    ├── sw.js                   # Service Worker (offline cache)
    └── src/
        ├── style.css           # Premium design system (dark/light, glassmorphism)
        ├── app.js              # Router + global state + incoming call listener
        ├── api.js              # HTTP client
        ├── socket.js           # WebSocket client (auto-reconnect)
        ├── i18n.js             # Multi-language engine (zh / en / ja / ko / fr)
        ├── services/
        │   └── webrtc.js       # WebRTC manager — CallManager class
        ├── crypto/
        │   ├── ratchet.js      # X3DH + Double Ratchet + ML-KEM-768
        │   └── keystore.js     # IndexedDB private key store
        └── pages/
            ├── login.js        # Login / Register (key generation, language picker)
            ├── chats.js        # Chat list
            ├── chat.js         # Chat window (E2E encryption, call buttons)
            ├── contacts.js     # Contacts (friend requests, online status)
            ├── discover.js     # Discover page
            ├── profile.js      # Me / Settings (language, key fingerprint, PWA)
            └── call.js         # Call UI (incoming / active / multi-party video)
```

---

## Database Schema

9 tables, auto-created on first server startup (`CREATE TABLE IF NOT EXISTS`):

| Table | Purpose |
|-------|---------|
| `users` | User profiles + ECDH/OPK public keys |
| `prekeys` | X3DH one-time prekey pool |
| `friends` | Friendship relationships (pending / accepted / blocked) |
| `groups` / `group_members` | Group chats + membership |
| `messages` | Encrypted payloads (offline buffer, deletable after delivery) |
| `moments` | Social posts (text ≤ 1024 chars) |
| `moment_images` | Post images (up to 9 per post) |
| `moment_likes` | Likes (unique per user per post) |
| `moment_comments` | Comments (≤ 512 chars each) |

---

## Security Model

```
On Registration:
  Device generates IK (Identity Key) + SPK (Signed PreKey) + 10× OPK (One-Time PreKeys)
  Public keys are uploaded; private keys stay on-device (four-tier persistence)

On Each Message:
  Sender fetches recipient's IK public key
  Generates a fresh ephemeral ECDH keypair (per-message)
  X25519 ECDH → shared secret → XSalsa20-Poly1305 encrypt
  Ephemeral public key sent in message header; destroyed after use

What the Server Sees:
  ✅ Ciphertext blob + routing metadata (sender / recipient UUID, timestamps)
  ❌ Plaintext / private keys / ephemeral keys / call content
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | JWT signing key (**change in production**) | dev_secret |
| `DB_HOST` / `DB_PASS` / `DB_NAME` | MySQL connection | — |
| `REDIS_HOST` / `REDIS_PASS` | Redis connection | — |
| `R2_ACCOUNT_ID` | Cloudflare account ID | — |
| `R2_ACCESS_KEY_ID` | R2 API token access key | — |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret key | — |
| `R2_BUCKET` | R2 bucket name | — |
| `R2_PUBLIC_URL` | R2 public base URL (optional) — enables direct CDN links | — |
| `CF_CALLS_APP_ID` | Cloudflare Calls App ID (optional) | — |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret (optional) | — |

---

## License

MIT © PaperPhone Contributors
