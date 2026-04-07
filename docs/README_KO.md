# PaperPhone IM

🌐 **다른 언어 / Other Languages:** [中文](README_CN.md) · [English](README_EN.md) · [日本語](README_JA.md) · [Français](README_FR.md) · [Deutsch](README_DE.md) · [Русский](README_RU.md) · [Español](README_ES.md)

WeChat 스타일의 종단간 암호화 인스턴트 메시징 앱. 무상태 ECDH + XSalsa20-Poly1305 메시지별 암호화, 실시간 영상 통화, Cloudflare R2 파일 저장소, 다국어 지원 및 iOS PWA 배포를 지원합니다.

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

## 기능

| 기능 | 설명 |
|------|------|
| 🔐 종단간 암호화 | 무상태 ECDH + XSalsa20-Poly1305 — 메시지별 임시 키, 전방 비밀성 |
| 🗝️ 제로 지식 서버 | 서버는 암호문만 저장, 개인 키는 기기를 떠나지 않음 |
| 📹 영상/음성 통화 | WebRTC P2P (1:1) + Mesh (그룹), Cloudflare TURN을 통한 NAT 트래버설 |
| 👥 그룹 채팅 | 최대 2000명, 일반 텍스트 메시지 (비암호화), 방해 금지 모드, 멤버 관리 |
| ⏱️ 메시지 자동 삭제 | 5단계 (안함/1일/3일/1주/1개월), DM에서 양쪽 설정 가능, 그룹은 방장만 |
| 🔔 알림 | Web Push (VAPID) + OneSignal 이중 채널 — 오프라인에서도 알림 수신 |
| 🌐 다국어 | 중국어·영어·일본어·한국어·프랑스어·독일어·러시아어·스페인어 (자동 감지 + 수동 전환) |
| 📱 iOS — 기업 인증서 불필요 | Safari "홈 화면에 추가"를 통한 PWA, Apple 서명 없이 영구 작동 |
| 💬 풍부한 메시징 | 텍스트, 이미지, 영상, 문서 파일 (PDF/DOCX/XLSX 등 타입 아이콘 포함), 음성 메시지, 이모지 패널 (200+종, 8분류), Telegram 스티커 팩, 읽음 확인 |
| 🌐 모먼트 | 텍스트 + 최대 9장 사진 또는 1개 동영상 (≤ 10분), 좋아요 (친구 아바타 표시), 댓글, 태그 기반 공개 범위 제어 |
| 👤 사용자 프로필 | 연락처 프로필 (아바타/닉네임/모먼트 피드), 「이 사람의 모먼트 숨기기」 및 「내 모먼트 비공개」 양방향 개인정보 제어 |
| 📰 타임라인 | 샤오홍슈 스타일 공개 피드—2열 매스너리 레이아웃, 이미지/동영상+텍스트(최대 50개 미디어, 2000자), 익명 게시, 좋아요/댓글 |
| 🏷️ 친구 태그 | 친구에게 여러 태그 할당 (12색 프리셋), 태그별 연락처 필터링 |
| 🗂️ R2 오브젝트 스토리지 | Cloudflare R2로 이미지/음성 파일 저장 — 선택적 공개 CDN URL |
| 🔑 2단계 인증 (2FA) | Google Authenticator 호환 TOTP, 8개 일회용 복구 코드, 로그인 시 강제 인증 |
| 📷 QR 코드 스캔 & 공유 | QR 코드 스캔으로 친구 추가 · 그룹 참여, 그룹 QR은 유효기간 설정 가능 (1주/1개월/3개월) |
| 🏗️ 셀프 호스팅 가능 | Docker Compose 원커맨드 배포, Node.js + Redis 멀티 노드 지원 |

---

## 기술 스택

```
백엔드 (server/)
  Node.js 20 + Express + ws
  MySQL 8.0  — 사용자, 메시지 영속화 (암호문)
  Redis      — 온라인 상태 + 크로스 노드 라우팅
  Cloudflare R2 — 이미지/음성 파일 저장소 (S3 호환 API)
  JWT + bcrypt 인증

프론트엔드 (client/)
  네이티브 HTML + Vanilla JS (ESM, 번들러 불필요)
  libsodium-wrappers (WebAssembly — Curve25519 / XSalsa20-Poly1305)
  WebRTC API — 영상/음성 통화
  PWA: manifest.json + Service Worker

암호화 레이어
  무상태 ECDH + XSalsa20-Poly1305 — 메시지별 임시 ECDH 키페어
  개인 키 4단계 영속화: 메모리 → localStorage → sessionStorage → IndexedDB
  모든 개인 키는 기기에만 저장 — 절대 서버로 전송되지 않음
```

---

## 빠른 시작

### 방법 0: Zeabur 원클릭 클라우드 배포

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> 템플릿 배포 후 수동 단계 하나가 필요합니다. 이 작업을 하지 않으면 로그인/회원가입이 작동하지 않습니다:
> 1. Zeabur 콘솔 → **server 서비스** → 환경 변수 → `ZEABUR_WEB_URL` 값 복사 (예: `http://10.43.x.x:3000`)
> 2. **client 서비스** → 환경 변수 → 변수 `SERVER_URL` 추가 = 위에서 복사한 값
> 3. client 서비스 재시작

**알려진 참고 사항:**
- 첫 시작 시 서버가 자동으로 모든 데이터베이스 테이블을 생성합니다 (`CREATE TABLE IF NOT EXISTS`) — SQL 수동 임포트 불필요
- Redis는 클러스터 내에서 비밀번호 없이 작동합니다
- MySQL 접근이 거부되면 server 서비스의 `DB_PASS`를 MySQL 서비스의 `MYSQL_ROOT_PASSWORD` 값으로 수동 설정하세요
- 서비스 컨테이너의 **내부 IP**를 확인하려면 Zeabur 콘솔에서 해당 서비스의 터미널을 열고 실행:
  ```bash
  hostname -i
  ```

---

### 방법 1: Docker Compose (권장 — 로컬 빌드 불필요)

```bash
# 저장소 클론
git clone <repo-url> && cd paperphone

# 환경 변수 복사 및 편집
cp server/.env.example server/.env
# DB_PASS / JWT_SECRET / R2_* 등 입력

# 이미지 풀 및 시작
docker compose up -d

# 서비스 상태 확인
docker compose ps

# 브라우저에서 열기
open http://localhost
```

> Docker Hub의 사전 빌드 이미지:
> - `facilisvelox/paperphone-client:latest`
> - `facilisvelox/paperphone-server:latest`
>
> **참고**: 서버는 첫 시작 시 자동으로 데이터베이스 스키마를 초기화합니다 — SQL 수동 임포트가 필요하지 않습니다.

### 방법 2: 로컬 수동 시작

#### 1. 환경 준비

```bash
# 환경 변수 복사 및 편집
cp server/.env.example server/.env
# DB_HOST / DB_PASS / REDIS_HOST / R2_* 등 입력

# 참고: 서버는 첫 시작 시 자동으로 schema.sql을 실행합니다
```

#### 2. 백엔드 시작

```bash
cd server
npm install
npm run dev   # → http://localhost:3000
```

#### 3. 프론트엔드 시작

```bash
npx serve client -p 8080
# → http://localhost:8080
```

---

## 영상 통화 설정

영상 및 음성 통화는 WebRTC P2P를 사용하며 동일 LAN에서 바로 사용할 수 있습니다. 다른 네트워크 간 통화에는 NAT 트래버설을 위한 TURN 서버가 필요합니다.

### Cloudflare TURN 사용 (권장)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Calls** → 앱 생성
2. **App ID**와 **App Secret** (토큰 키) 복사
3. `server/.env`에 추가:

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

4. 백엔드 재시작 — TURN 자격 증명은 통화 세션마다 자동 발급됩니다 (TTL: 86,400초)

> **미설정 시**: STUN 전용으로 폴백합니다 (Google + Cloudflare 공개 STUN). LAN 통화는 추가 설정 없이 작동합니다.

### 통화 유형

| 유형 | 전송 방식 | 권장 사용 |
|------|-----------|-----------|
| 1:1 영상 통화 | WebRTC P2P + TURN | 모든 시나리오 |
| 1:1 음성 통화 | WebRTC P2P + TURN | 모든 시나리오 |
| 그룹 영상/음성 | WebRTC Mesh (풀 메시) | 최대 6명 |

---

## 푸시 알림 설정

오프라인 메시지 알림은 **두 채널**을 통해 배달되어 최대 전달률을 보장합니다:

| 채널 | 플랫폼 | 설정 |
|------|--------|------|
| Web Push (VAPID) | 브라우저 (Chrome/Edge/Firefox) + iOS PWA (Safari 16.4+) | VAPID 키 |
| OneSignal | Median.co 경유 네이티브 Android/iOS 앱 | OneSignal App ID + REST Key |

### Web Push 설정

1. VAPID 키 생성 (1회만):

```bash
cd server
npx web-push generate-vapid-keys
```

2. `server/.env`에 추가:

```env
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_SUBJECT=mailto:admin@your-domain.com
```

3. 서버 재시작 — 사용자가 설정 페이지에서 알림을 활성화할 수 있습니다

> **iOS 사용자**는 먼저 "홈 화면에 추가" (PWA)를 해야 하며, iOS 16.4 이상만 지원됩니다.

### OneSignal 설정 (Median.co 네이티브 앱)

1. [OneSignal Dashboard](https://onesignal.com)에서 앱 생성 및 Firebase 설정
2. Median.co에서 OneSignal 활성화 후 App ID 입력
3. OneSignal **App ID**와 **REST API Key**를 `server/.env`에 추가:

```env
ONESIGNAL_APP_ID=your_onesignal_app_id
ONESIGNAL_REST_KEY=your_onesignal_rest_api_key
```

> **미설정 시**: 푸시 알림이 자동으로 비활성화됩니다 — 다른 기능에는 영향 없습니다.

---

## iOS — 인증서 없는 영구 배포

1. HTTPS 도메인 서버에 배포 (WebRTC 및 Web Crypto API에 HTTPS 필요)
2. **Safari**에서 `https://your.domain.com` 열기
3. 화면 하단의 공유 버튼 ⬆️ 탭
4. **홈 화면에 추가** → **추가** 선택

네이티브 앱과 동일하게 작동합니다 — Apple 기업 인증서 불필요, 만료 없음.

---

## 프로덕션 배포 (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 프론트엔드 정적 파일
    location / {
        root /path/to/paperphone/client;
        try_files $uri /index.html;
    }

    # REST API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # WebSocket (메시징 + 통화 시그널링)
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

## 데이터베이스 스키마

19개 테이블, 서버 첫 시작 시 자동 생성 (`CREATE TABLE IF NOT EXISTS`):

| 테이블 | 용도 |
|--------|------|
| `users` | 사용자 프로필 + ECDH/OPK 공개 키 |
| `prekeys` | X3DH 원타임 프리키 풀 |
| `friends` | 친구 관계 (pending / accepted / blocked) |
| `groups` / `group_members` | 그룹 채팅 + 멤버 (알림 끄기 상태 포함) |
| `messages` | 암호화된 메시지 (오프라인 버퍼, 전달 후 삭제 가능) |
| `moments` | 소셜 게시물 (텍스트 ≤ 1024자) |
| `moment_images` | 게시물 이미지 (게시물당 최대 9개) |
| `moment_videos` | 게시물 동영상 (썸네일 + 재생 시간, 게시물당 1개, ≤ 10분) |
| `moment_likes` | 좋아요 (사용자당 게시물당 고유) |
| `moment_comments` | 댓글 (≤ 512자) |
| `push_subscriptions` | Web Push 구독 (VAPID) |
| `onesignal_players` | OneSignal 기기 등록 (Median.co) |
| `user_totp` | TOTP 2단계 인증 비밀 키 및 복구 코드 |
| `moment_privacy` | 모먼트 사용자 수준 개인정보 설정 (숨김/비공개) |
| `timeline_posts` | 타임라인 게시물 (텍스트 ≤2000자, 익명 지원) |
| `timeline_media` | 타임라인 미디어 (이미지/동영상, 게시물당 최대 50개) |
| `timeline_likes` | 타임라인 좋아요 |
| `timeline_comments` | 타임라인 댓글 (익명 지원) |
| `group_invites` | 그룹 초대 링크 (유효기간 포함, QR 코드 참여용) |

---

## 보안 모델

```
등록 시:
  기기가 IK (아이덴티티 키) + SPK (서명 프리키) + 10× OPK (원타임 프리키) 생성
  공개 키는 업로드, 개인 키는 기기에 보관 (4단계 영속화)

메시지 전송 시:
  발신자가 수신자의 IK 공개 키를 가져옴
  임시 ECDH 키페어 생성 (메시지마다 새로운 페어)
  X25519 ECDH → 공유 비밀 → XSalsa20-Poly1305 암호화
  임시 공개 키는 메시지 헤더로 전송, 사용 후 파기

서버가 보는 것:
  ✅ 암호문 블롭 + 라우팅 메타데이터 (발신자/수신자 UUID, 타임스탬프)
  ❌ 평문 / 개인 키 / 임시 키 / 통화 내용
```

---

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `3000` |
| `JWT_SECRET` | JWT 서명 키 (**프로덕션에서 반드시 변경**) | dev_secret |
| `DB_HOST` / `DB_PASS` / `DB_NAME` | MySQL 연결 | — |
| `REDIS_HOST` / `REDIS_PASS` | Redis 연결 | — |
| `R2_ACCOUNT_ID` | Cloudflare 계정 ID | — |
| `R2_ACCESS_KEY_ID` | R2 API 토큰 액세스 키 | — |
| `R2_SECRET_ACCESS_KEY` | R2 API 토큰 시크릿 키 | — |
| `R2_BUCKET` | R2 버킷 이름 | — |
| `R2_PUBLIC_URL` | R2 공개 기본 URL (선택) — CDN 직접 링크 활성화 | — |
| `CF_CALLS_APP_ID` | Cloudflare Calls App ID (선택) | — |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret (선택) | — |
| `VAPID_PUBLIC_KEY` | Web Push VAPID 공개 키 (선택) | — |
| `VAPID_PRIVATE_KEY` | Web Push VAPID 개인 키 (선택) | — |
| `VAPID_SUBJECT` | VAPID 연락처 이메일 (선택) | `mailto:admin@paperphone.app` |
| `ONESIGNAL_APP_ID` | OneSignal App ID (선택, Median.co용) | — |
| `ONESIGNAL_REST_KEY` | OneSignal REST API Key (선택) | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (선택, 스티커 팩 프록시) | — |
| `STICKER_PACKS` | 사용자 정의 스티커 팩 목록 (선택, 쉼표 구분 `이름:라벨`, 무제한) | 기본 8개 팩 |

---

## 라이선스

MIT © PaperPhone Contributors
