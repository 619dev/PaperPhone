# PaperPhone IM

🌐 **Другие языки / Other Languages:** [中文](README.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [Français](README_FR.md) · [Deutsch](README_DE.md) · [Español](README_ES.md)

Мессенджер в стиле WeChat со сквозным шифрованием — безсостоянийный ECDH + XSalsa20-Poly1305 для каждого сообщения, видеозвонки в реальном времени, хранилище файлов Cloudflare R2, многоязычная поддержка и развёртывание iOS PWA.

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

## Возможности

| Функция | Описание |
|---------|----------|
| 🔐 Сквозное шифрование | Безсостоянийный ECDH + XSalsa20-Poly1305 — эфемерные ключи на каждое сообщение, прямая секретность |
| 🗝️ Сервер с нулевым знанием | Сервер хранит только шифротекст; закрытые ключи никогда не покидают устройство |
| 📹 Видео/аудио звонки | WebRTC P2P (1:1) + Mesh (группа), Cloudflare TURN для NAT-обхода |
| 👥 Групповой чат | До 2000 участников, обычный текст (без шифрования), режим «Не беспокоить», управление участниками |
| ⏱️ Автоудаление | 5 уровней (никогда/1д/3д/1нед/1мес), в ЛС — обе стороны, в группах — только владелец |
| 🔔 Push-уведомления | Web Push (VAPID) + OneSignal — двойной канал |
| 🌐 Многоязычность | ZH/EN/JA/KO/FR/DE/RU/ES — автоопределение + ручной выбор |
| 📱 iOS без сертификата | PWA через Safari «На экран Домой», без корпоративного сертификата Apple |
| 💬 Расширенные сообщения | Текст, изображения, видео, документы (PDF/DOCX/XLSX и др. с иконками типов), голосовые сообщения, 200+ эмодзи (8 категорий), стикер-паки Telegram, подтверждения прочтения |
| 🌐 Моменты | Социальная лента: текст + до 9 фото или 1 видео (≤ 10 мин), лайки (аватары друзей), комментарии, управление видимостью по тегам |
| 👤 Профиль пользователя | Страница профиля (аватар / ник / лента моментов), с двусторонним управлением конфиденциальностью «Скрыть их моменты» и «Скрыть мои моменты» |
| 📰 Лента | Публичная лента в стиле Xiaohongshu — 2-колоночный masonry-макет, изображения/видео + текст (до 50 медиа, 2000 симв.), анонимные публикации, лайки и комментарии |
| 🏷️ Теги друзей | Несколько тегов на друга (палитра из 12 цветов), фильтрация контактов по тегам |
| 🗂️ Хранилище R2 | Cloudflare R2 для изображений/аудио — опциональный CDN URL |
| 🔑 Двухфакторная аутент. (2FA) | TOTP совместимый с Google Authenticator, 8 одноразовых кодов восстановления, обязательная проверка при входе |
| 📷 QR-скан и обмен | Сканирование QR-кода для добавления друзей и вступления в группы; QR группы с настраиваемым сроком (1 нед./1 мес./3 мес.) |
| 🏗️ Самостоятельное размещение | Docker Compose в одну команду |

---

## Технологический стек

```
Бэкенд (server/)
  Node.js 20 + Express + ws
  MySQL 8.0 — пользователи, сообщения (шифротекст)
  Redis — статус онлайн + маршрутизация между узлами
  Cloudflare R2 — хранилище файлов (S3-совместимый API)
  JWT + bcrypt аутентификация

Фронтенд (client/)
  Нативный HTML + Vanilla JS (ESM, без сборщика)
  libsodium-wrappers (WebAssembly — Curve25519 / XSalsa20-Poly1305)
  WebRTC API — видео/аудио звонки
  PWA: manifest.json + Service Worker

Криптографический слой
  Безсостоянийный ECDH + XSalsa20-Poly1305 — эфемерная пара ключей на сообщение
  4-уровневое хранение ключей: память → localStorage → sessionStorage → IndexedDB
  Закрытые ключи только на устройстве — никогда не отправляются на сервер
```

---

## Быстрый старт

### Вариант 0: Zeabur — облачное развёртывание в один клик

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> После развёртывания шаблона необходим один ручной шаг:
> 1. Консоль Zeabur → сервис **server** → Переменные → скопировать `ZEABUR_WEB_URL`
> 2. Сервис **client** → Переменные → добавить `SERVER_URL` = скопированное значение
> 3. Перезапустить сервис client

### Вариант 1: Docker Compose (рекомендуется)

```bash
git clone <repo-url> && cd paperphone
cp server/.env.example server/.env
# Заполнить: DB_PASS / JWT_SECRET / R2_* и т.д.
docker compose up -d
open http://localhost
```

> Образы Docker Hub: `facilisvelox/paperphone-client:latest` и `facilisvelox/paperphone-server:latest`

### Вариант 2: Локальный ручной запуск

```bash
# Бэкенд
cd server && npm install && npm run dev   # → http://localhost:3000

# Фронтенд
npx serve client -p 8080   # → http://localhost:8080
```

---

## Настройка видеозвонков — Cloudflare TURN

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

| Тип | Транспорт | Рекомендуется для |
|-----|-----------|-------------------|
| 1:1 Видео | WebRTC P2P + TURN | Все сценарии |
| 1:1 Голос | WebRTC P2P + TURN | Все сценарии |
| Групповой | WebRTC Mesh | До 6 участников |

> **Без настройки**: только STUN. Звонки в ЛВС работают без дополнительных настроек.

---

## Push-уведомления

| Канал | Платформы | Настройка |
|-------|-----------|-----------|
| Web Push | Браузеры + iOS PWA (Safari 16.4+) | Ключи VAPID |
| OneSignal | Нативные приложения Median.co | App ID + REST Key |

```bash
npx web-push generate-vapid-keys
```

---

## iOS — Постоянная установка без сертификата

1. Развернуть на HTTPS-сервере → 2. Открыть в Safari → 3. Поделиться ⬆️ → 4. «На экран Домой»

---

## Модель безопасности

```
Регистрация: IK + SPK + 10×OPK генерируются локально, публичные ключи загружаются
Сообщение: Эфемерный ECDH → X25519 → XSalsa20-Poly1305
Сервер видит: ✅ шифротекст + метаданные маршрутизации  ❌ открытый текст / закрытые ключи
```

---

## Схема базы данных

19 таблиц, создаются автоматически при первом запуске:

| Таблица | Назначение |
|---------|------------|
| `users` | Профили + публичные ключи ECDH/OPK |
| `prekeys` | Одноразовые предключи X3DH |
| `friends` | Связи дружбы |
| `groups` / `group_members` | Группы + участники |
| `messages` | Зашифрованные сообщения |
| `moments` / `moment_images` | Посты + изображения |
| `moment_videos` | Видео постов (обложка + длительность, 1 на пост, ≤ 10 мин) |
| `moment_likes` / `moment_comments` | Лайки + комментарии |
| `push_subscriptions` | Web Push (VAPID) |
| `onesignal_players` | OneSignal устройства |
| `user_totp` | TOTP 2FA — секреты и коды восстановления |
| `moment_privacy` | Настройки конфиденциальности моментов на уровне пользователя (скрыть/не показывать) |
| `timeline_posts` | Публикации ленты (текст ≤2000 симв., анонимно возможно) |
| `timeline_media` | Медиа ленты (изображения/видео, макс. 50 на пост) |
| `timeline_likes` | Лайки ленты |
| `timeline_comments` | Комментарии ленты (анонимно возможно) |
| `group_invites` | Ссылки-приглашения в группы (со сроком действия, для QR-кодов) |

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|-------------|
| `PORT` | Порт сервера | `3000` |
| `JWT_SECRET` | Ключ подписи JWT (**изменить в продакшене**) | dev_secret |
| `DB_HOST`/`DB_PASS`/`DB_NAME` | Подключение MySQL | — |
| `REDIS_HOST`/`REDIS_PASS` | Подключение Redis | — |
| `R2_ACCOUNT_ID` | ID аккаунта Cloudflare | — |
| `R2_ACCESS_KEY_ID` | Ключ доступа R2 API | — |
| `R2_SECRET_ACCESS_KEY` | Секретный ключ R2 API | — |
| `R2_BUCKET` | Имя бакета R2 | — |
| `R2_PUBLIC_URL` | Публичный URL R2 (опц.) | — |
| `CF_CALLS_APP_ID` | Calls App ID (опц.) | — |
| `CF_CALLS_APP_SECRET` | Calls Secret (опц.) | — |
| `VAPID_PUBLIC_KEY` | Публичный ключ VAPID (опц.) | — |
| `VAPID_PRIVATE_KEY` | Закрытый ключ VAPID (опц.) | — |
| `ONESIGNAL_APP_ID` | OneSignal App ID (опц.) | — |
| `ONESIGNAL_REST_KEY` | OneSignal REST Key (опц.) | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (опц., прокси стикеров) | — |
| `STICKER_PACKS` | Список стикер-паков (опц., через запятую `имя:метка`, без ограничений) | 8 встр. паков |

---

## Лицензия

MIT © PaperPhone Contributors
