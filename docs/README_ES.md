# PaperPhone IM

🌐 **Otros idiomas / Other Languages:** [中文](README_CN.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [Français](README_FR.md) · [Deutsch](README_DE.md) · [Русский](README_RU.md)

Una aplicación de mensajería instantánea cifrada de extremo a extremo estilo WeChat, con cifrado ECDH sin estado + XSalsa20-Poly1305 por mensaje, videollamadas en tiempo real, almacenamiento Cloudflare R2, soporte multilingüe y despliegue iOS PWA.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](#) [![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](#) [![Redis](https://img.shields.io/badge/Redis-7.x-red)](#) [![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20%2B%20Mesh-orange)](#)

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

---
<img width=30% height=30% src="images/ui1.jpg" alt="ui1">
<img width=30% height=30% src="images/ui2.jpg" alt="ui2">
<img width=30% height=30% src="images/ui3.jpg" alt="ui3">
<img width=30% height=30% src="images/ui4.jpg" alt="ui4">
<img width=30% height=30% src="images/ui5.jpg" alt="ui5">
<img width=30% height=30% src="images/ui6.jpg" alt="ui6">
<img width=30% height=30% src="images/ui7.jpg" alt="ui7">
<img width=30% height=30% src="images/ui8.jpg" alt="ui8">
<img width=30% height=30% src="images/ui9.jpg" alt="ui9">
<img width=30% height=30% src="images/ui10.jpg" alt="ui10">
<img width=30% height=30% src="images/ui11.jpg" alt="ui11">
<img width=30% height=30% src="images/ui12.jpg" alt="ui12">
<img width=30% height=30% src="images/ui13.jpg" alt="ui13">
<img width=30% height=30% src="images/ui14.jpg" alt="ui14">

## Características

| Función | Descripción |
|---------|-------------|
| 🔐 Cifrado E2E | ECDH sin estado + XSalsa20-Poly1305 — claves efímeras por mensaje, secreto hacia adelante |
| 🗝️ Servidor de conocimiento cero | El servidor solo almacena texto cifrado; las claves privadas nunca salen del dispositivo |
| 📹 Videollamadas/voz | WebRTC P2P (1:1) + Mesh (grupo), Cloudflare TURN para atravesar NAT |
| 👥 Chat grupal | Hasta 2000 miembros, mensajes en texto plano, modo No molestar, gestión de miembros |
| ⏱️ Eliminación automática | 5 niveles (nunca/1d/3d/1sem/1mes), en DMs ambas partes, en grupos solo propietario |
| 🔔 Notificaciones push | Web Push (VAPID) + OneSignal canal doble |
| 🌐 Multilingüe | ZH/EN/JA/KO/FR/DE/RU/ES — detección automática + selección manual |
| 📱 iOS sin certificado empresarial | PWA vía Safari "Añadir a inicio", sin firma de Apple |
| 💬 Mensajería rica | Texto, imágenes, video, archivos (PDF/DOCX/XLSX etc. con iconos de tipo), mensajes de voz, 200+ emojis (8 categorías), packs de stickers Telegram, confirmaciones de lectura |
| 🌐 Momentos | Feed social: texto + hasta 9 fotos o 1 vídeo (≤ 10 min), likes (avatares de amigos), comentarios, visibilidad por etiquetas |
| 👤 Perfil de usuario | Página de perfil (avatar / apodo / feed de Momentos), con controles de privacidad bidireccionales «Ocultar sus momentos» y «Ocultar mis momentos» |
| 📰 Cronología | Feed público estilo Xiaohongshu — diseño masonry 2 columnas, imágenes/vídeos + texto (máx. 50 archivos, 2000 car.), publicación anónima, likes y comentarios |
| 🏷️ Etiquetas de amigos | Múltiples etiquetas por amigo (paleta de 12 colores), filtrar contactos por etiqueta |
| 🗂️ Almacenamiento R2 | Cloudflare R2 para imágenes/audio — URL CDN opcional |
| 🔑 Auth de dos factores (2FA) | TOTP compatible con Google Authenticator, 8 códigos de recuperación, verificación obligatoria al iniciar sesión |
| 📷 Escaneo QR y compartir | Escanea códigos QR para añadir amigos o unirse a grupos; QR de grupo con caducidad configurable (1 sem./1 mes/3 meses) |
| 🏗️ Auto-alojable | Despliegue Docker Compose en un comando |

---

## Stack tecnológico

```
Backend (server/)
  Node.js 20 + Express + ws
  MySQL 8.0 — usuarios, mensajes (texto cifrado)
  Redis — presencia en línea + enrutamiento entre nodos
  Cloudflare R2 — almacenamiento de archivos (API compatible S3)
  Autenticación JWT + bcrypt

Frontend (client/)
  HTML nativo + Vanilla JS (ESM, sin bundler)
  libsodium-wrappers (WebAssembly — Curve25519 / XSalsa20-Poly1305)
  API WebRTC — videollamadas / llamadas de voz
  PWA: manifest.json + Service Worker

Capa criptográfica
  ECDH sin estado + XSalsa20-Poly1305 — par de claves efímeras por mensaje
  Persistencia de claves en 4 niveles: memoria → localStorage → sessionStorage → IndexedDB
  Todas las claves privadas solo en el dispositivo — nunca se envían al servidor
```

---

## Inicio rápido

### Opción 0: Zeabur — Despliegue en la nube con un clic

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> Se requiere un paso manual después del despliegue:
> 1. Consola Zeabur → servicio **server** → Variables de entorno → copiar el valor de `ZEABUR_WEB_URL`
> 2. Servicio **client** → Variables de entorno → agregar `SERVER_URL` = valor copiado
> 3. Reiniciar el servicio client

### Opción 1: Docker Compose (recomendado)

```bash
git clone <repo-url> && cd paperphone
cp server/.env.example server/.env
# Editar: DB_PASS / JWT_SECRET / R2_* etc.
docker compose up -d
open http://localhost
```

> Imágenes Docker Hub: `facilisvelox/paperphone-client:latest` y `facilisvelox/paperphone-server:latest`

### Opción 2: Inicio local manual

```bash
# Backend
cd server && npm install && npm run dev   # → http://localhost:3000

# Frontend
npx serve client -p 8080   # → http://localhost:8080
```

---

## Configuración de videollamadas — Cloudflare TURN

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

| Tipo | Transporte | Recomendado para |
|------|-----------|------------------|
| Video 1:1 | WebRTC P2P + TURN | Todos los escenarios |
| Voz 1:1 | WebRTC P2P + TURN | Todos los escenarios |
| Llamada grupal | WebRTC Mesh | Hasta 6 participantes |

> **Sin configuración**: solo STUN. Las llamadas en LAN funcionan sin configuración adicional.

---

## Notificaciones push

| Canal | Plataformas | Configuración |
|-------|-------------|---------------|
| Web Push | Navegadores + iOS PWA (Safari 16.4+) | Claves VAPID |
| OneSignal | Apps nativas Median.co | App ID + REST Key |

```bash
npx web-push generate-vapid-keys
```

---

## iOS — Instalación permanente sin certificado

1. Desplegar en servidor HTTPS → 2. Abrir en Safari → 3. Compartir ⬆️ → 4. «Añadir a pantalla de inicio»

---

## Modelo de seguridad

```
Registro: IK + SPK + 10×OPK generados localmente, claves públicas subidas
Mensaje: ECDH efímero → X25519 → XSalsa20-Poly1305
El servidor ve: ✅ texto cifrado + metadatos de enrutamiento  ❌ texto plano / claves privadas
```

---

## Esquema de base de datos

19 tablas, creadas automáticamente en el primer inicio:

| Tabla | Propósito |
|-------|-----------|
| `users` | Perfiles + claves públicas ECDH/OPK |
| `prekeys` | Pre-claves X3DH de un solo uso |
| `friends` | Relaciones de amistad |
| `groups` / `group_members` | Grupos + miembros |
| `messages` | Mensajes cifrados |
| `moments` / `moment_images` | Publicaciones + imágenes |
| `moment_videos` | Videos de publicaciones (miniatura + duración, 1 por publicación, ≤ 10 min) |
| `moment_likes` / `moment_comments` | Likes + comentarios |
| `push_subscriptions` | Web Push (VAPID) |
| `onesignal_players` | Dispositivos OneSignal |
| `user_totp` | Secretos TOTP 2FA y códigos de recuperación |
| `moment_privacy` | Configuración de privacidad de momentos a nivel de usuario (ocultar/no mostrar) |
| `timeline_posts` | Publicaciones de cronología (texto ≤2000 car., anónimo opcional) |
| `timeline_media` | Medios de cronología (imágenes/vídeos, máx. 50 por post) |
| `timeline_likes` | Likes de cronología |
| `timeline_comments` | Comentarios de cronología (anónimo opcional) |
| `group_invites` | Enlaces de invitación a grupos (con caducidad, para unirse por QR) |

---

## Variables de entorno

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `PORT` | Puerto del servidor | `3000` |
| `JWT_SECRET` | Clave de firma JWT (**cambiar en producción**) | dev_secret |
| `DB_HOST`/`DB_PASS`/`DB_NAME` | Conexión MySQL | — |
| `REDIS_HOST`/`REDIS_PASS` | Conexión Redis | — |
| `R2_ACCOUNT_ID` | ID de cuenta Cloudflare | — |
| `R2_ACCESS_KEY_ID` | Clave de acceso R2 API | — |
| `R2_SECRET_ACCESS_KEY` | Clave secreta R2 API | — |
| `R2_BUCKET` | Nombre del bucket R2 | — |
| `R2_PUBLIC_URL` | URL pública R2 (opc.) | — |
| `CF_CALLS_APP_ID` | Calls App ID (opc.) | — |
| `CF_CALLS_APP_SECRET` | Calls Secret (opc.) | — |
| `VAPID_PUBLIC_KEY` | Clave pública VAPID (opc.) | — |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID (opc.) | — |
| `ONESIGNAL_APP_ID` | OneSignal App ID (opc.) | — |
| `ONESIGNAL_REST_KEY` | OneSignal REST Key (opc.) | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (opc., proxy de stickers) | — |
| `STICKER_PACKS` | Lista de packs de stickers (opc., separados por coma `nombre:etiqueta`, ilimitado) | 8 packs por defecto |

---

## Licencia

MIT © PaperPhone Contributors
