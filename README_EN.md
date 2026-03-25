# PaperPhone IM

A WeChat-style end-to-end encrypted instant messaging app with X3DH + Double Ratchet + ML-KEM-768 post-quantum encryption, real-time video calls, multi-language support and iOS PWA deployment.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](#) [![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](#) [![Redis](https://img.shields.io/badge/Redis-7.x-red)](#) [![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20%2B%20Mesh-orange)](#)

---

## Features

| Feature | Description |
|---------|-------------|
| 🔐 End-to-End Encryption | X3DH key agreement + Double Ratchet forward secrecy |
| ⚛️ Post-Quantum | ML-KEM-768 (CRYSTALS-Kyber, NIST standard) injected into every Ratchet step |
| 🗝️ Zero-Knowledge Server | Server stores only ciphertext; private keys never leave the device |
| 📹 Video & Voice Calls | WebRTC P2P (1:1) + Mesh (group), Cloudflare TURN for NAT traversal |
| 🌐 Multi-Language | Chinese, English, Japanese, Korean, French — auto-detect + manual switch |
| 📱 iOS — No Enterprise Cert | PWA via Safari "Add to Home Screen", works permanently without Apple signing |
| 💬 Rich Messaging | Text, images, voice messages, 64-emoji panel, delivery receipts, typing indicators |
| 🏗️ Self-Hostable | Docker Compose one-command deployment; Node.js + Redis multi-node ready |

---

## Tech Stack

```
Backend (server/)
  Node.js 20 + Express + ws
  MySQL 8.0  — users, messages (persisted ciphertext)
  Redis      — online presence + cross-node routing
  MinIO      — file and image object storage
  JWT + bcrypt authentication

Frontend (client/)
  Native HTML + Vanilla JS (ESM, no bundler required)
  libsodium-wrappers (WebAssembly — Curve25519 / Ed25519)
  ML-KEM-768 (CRYSTALS-Kyber)
  WebRTC API — video / voice calls
  PWA: manifest.json + Service Worker

Cryptographic Layer
  X3DH (4-DH) → shared secret establishment
  Double Ratchet → per-message independent keys (forward secrecy)
  ML-KEM-768   → injected each step for post-quantum protection
  All private keys stored in IndexedDB — never sent to the server
```

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repo-url> && cd paperphone

# Copy environment config
cp server/.env.example server/.env.docker
# Edit server/.env.docker as needed

# Start everything (MySQL + Redis + MinIO + backend + Nginx)
docker compose up -d

# Open in browser
open http://localhost:8080
```

### Option 2: Manual Local Start

#### 1. Prepare the environment

```bash
# Create MySQL database
mysql -u root -p < server/db/schema.sql

# Copy and edit environment variables
cp server/.env.example server/.env
# Fill in DB_HOST / DB_PASS / REDIS_HOST / MINIO_* etc.
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
│       │   ├── upload.js       # MinIO file upload
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

## Security Model

```
On Registration:
  Device generates IK (Identity Key) + SPK (Signed PreKey) + 10× OPK (One-Time PreKeys)
  Public keys are uploaded; private keys stay in IndexedDB and never leave the device

On First Message:
  Sender downloads recipient's Prekey Bundle (IK_pub + SPK_pub + OPK_pub)
  X3DH four-way DH → 32-byte shared secret
  Double Ratchet initialised; ML-KEM-768 shared secret injected
  Every subsequent message uses an independent key (forward + break-in recovery secrecy)

What the Server Sees:
  ✅ Ciphertext blob + routing metadata (sender / recipient UUID, timestamps)
  ❌ Plaintext / private keys / session state / call content
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | JWT signing key (**change in production**) | dev_secret |
| `DB_HOST` / `DB_PASS` / `DB_NAME` | MySQL connection | — |
| `REDIS_HOST` / `REDIS_PASS` | Redis connection | — |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` | MinIO object storage | — |
| `CF_CALLS_APP_ID` | Cloudflare Calls App ID (optional) | — |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret (optional) | — |

---

## License

MIT © PaperPhone Contributors
