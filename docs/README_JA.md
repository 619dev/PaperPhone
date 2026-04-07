# PaperPhone IM

🌐 **他の言語 / Other Languages:** [中文](README_CN.md) · [English](README_EN.md) · [한국어](README_KO.md) · [Français](README_FR.md) · [Deutsch](README_DE.md) · [Русский](README_RU.md) · [Español](README_ES.md)

WeChatスタイルのエンドツーエンド暗号化インスタントメッセージアプリ。ステートレス ECDH + XSalsa20-Poly1305 のメッセージ単位暗号化、リアルタイムビデオ通話、Cloudflare R2 ファイルストレージ、多言語対応、iOS PWA デプロイをサポート。

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

## 機能一覧

| 機能 | 説明 |
|------|------|
| 🔐 エンドツーエンド暗号化 | ステートレス ECDH + XSalsa20-Poly1305 — メッセージごとの一時鍵、前方秘匿性 |
| 🗝️ ゼロ知識サーバー | サーバーは暗号文のみ保存。秘密鍵はデバイスから離れません |
| 📹 ビデオ/音声通話 | WebRTC P2P（1:1）+ Mesh（グループ）、Cloudflare TURN による NAT トラバーサル |
| 👥 グループチャット | 最大2000人、プレーンテキストメッセージ（暗号化なし）、通知オフモード、メンバー管理 |
| ⏱️ メッセージ自動削除 | 5段階（なし/1日/3日/1週間/1ヶ月）、DM は双方設定可、グループはオーナーのみ |
| 🔔 プッシュ通知 | Web Push (VAPID) + OneSignal デュアルチャネル — オフラインでも通知 |
| 🌐 多言語対応 | 中国語・英語・日本語・韓国語・フランス語・ドイツ語・ロシア語・スペイン語（自動検出＋手動切替） |
| 📱 iOS 永久署名不要 | PWA — Safari「ホーム画面に追加」でエンタープライズ証明書なしで利用可能 |
| 💬 リッチメッセージ | テキスト・画像・動画・ドキュメントファイル（PDF/DOCX/XLSX等、タイプ別アイコン付き）・音声・絵文字パネル（200+種、8カテゴリ）・Telegram ステッカーパック・既読確認 |
| 🌐 モーメンツ | テキスト＋最大9枚写真または1本の動画（≤10分）、いいね（友達アバター表示）、コメント、タグベースの公開範囲制御 |
| 👤 ユーザープロフィール | 連絡先プロフィール（アバター/ニックネーム/モーメンツフィード）、「この人のモーメンツを非表示」と「自分のモーメンツを非公開」の双方向プライバシー制御 |
| 📰 タイムライン | 小紅書スタイルの公開フィード——2列マソンリーレイアウト、画像/動画+テキスト（最大50メディア、2000文字）、匿名投稿、いいね・コメント |
| 🏷️ フレンドタグ | 友達に複数タグを設定（12色プリセット）、タグ別に連絡先をフィルタリング |
| 🗂️ R2 オブジェクトストレージ | Cloudflare R2 で画像/音声ファイルを保存 — オプションの CDN 直リンク |
| 🔑 二段階認証 (2FA) | Google Authenticator 対応 TOTP、8つのリカバリーコード、ログイン時に強制検証 |
| 📷 QRコードスキャン＆共有 | QRコードをスキャンして友達追加・グループ参加、グループQRは有効期限設定可能（1週間/1ヶ月/3ヶ月） |
| 🏗️ セルフホスト対応 | Docker Compose ワンコマンドデプロイ、Node.js + Redis マルチノード対応 |

---

## 技術スタック

```
バックエンド (server/)
  Node.js 20 + Express + ws
  MySQL 8.0  — ユーザー・メッセージの永続化
  Redis      — オンラインプレゼンス＋クロスノードルーティング
  Cloudflare R2 — 画像/音声ファイルストレージ（S3互換API）
  JWT + bcrypt 認証

フロントエンド (client/)
  ネイティブ HTML + Vanilla JS（ESM、バンドラー不要）
  libsodium-wrappers（WebAssembly — Curve25519 / XSalsa20-Poly1305）
  WebRTC API — ビデオ/音声通話
  PWA: manifest.json + Service Worker

暗号化レイヤー
  ステートレス ECDH + XSalsa20-Poly1305 — メッセージごとの一時 ECDH 鍵ペア
  秘密鍵4層永続化: メモリ → localStorage → sessionStorage → IndexedDB
  秘密鍵はデバイスにのみ保存、サーバーに送信されることはありません
```

---

## クイックスタート

### 方法0：Zeabur ワンクリッククラウドデプロイ

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> テンプレートのデプロイ後、1つの手動手順が必要です。これを行わないとログイン/登録が機能しません：
> 1. Zeabur コンソール → **server サービス** → 環境変数 → `ZEABUR_WEB_URL` の値をコピー（例：`http://10.43.x.x:3000`）
> 2. **client サービス** → 環境変数 → 変数 `SERVER_URL` を追加 = 上記でコピーした値
> 3. client サービスを再起動

**既知の注意事項：**
- 初回起動時、サーバーは自動的にすべてのデータベーステーブルを作成します（`CREATE TABLE IF NOT EXISTS`）— SQL の手動インポートは不要
- Redis はクラスター内でパスワードなしで動作します
- MySQL アクセスが拒否された場合、server サービスの `DB_PASS` を MySQL サービスの `MYSQL_ROOT_PASSWORD` に手動設定してください
- サービスコンテナの**内部IP**を取得するには、Zeabur コンソールで該当サービスのターミナルを開き、以下を実行：
  ```bash
  hostname -i
  ```

---

### 方法1：Docker Compose（推奨 — ローカルビルド不要）

```bash
# リポジトリをクローン
git clone <repo-url> && cd paperphone

# 環境変数をコピーして編集
cp server/.env.example server/.env
# DB_PASS / JWT_SECRET / R2_* などを編集

# イメージを取得して起動
docker compose up -d

# サービスステータスを確認
docker compose ps

# ブラウザで開く
open http://localhost
```

> Docker Hub のビルド済みイメージ：
> - `facilisvelox/paperphone-client:latest`
> - `facilisvelox/paperphone-server:latest`
>
> **注意**：サーバーは初回起動時に自動的にデータベーススキーマを初期化します — SQL の手動インポートは不要です。

### 方法2：ローカル手動起動

#### 1. 環境を準備

```bash
# 環境変数をコピーして編集
cp server/.env.example server/.env
# DB_HOST / DB_PASS / REDIS_HOST / R2_* などを入力

# 注：サーバーは初回起動時に自動で schema.sql を実行します
```

#### 2. バックエンドを起動

```bash
cd server
npm install
npm run dev   # → http://localhost:3000
```

#### 3. フロントエンドを起動

```bash
npx serve client -p 8080
# → http://localhost:8080
```

---

## ビデオ通話の設定

ビデオ通話と音声通話は WebRTC P2P を使用し、同一 LAN 内ではすぐに使えます。異なるネットワーク間の通話には、NAT トラバーサル用の TURN サーバーが必要です。

### Cloudflare TURN の使用（推奨）

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Calls** → App を作成
2. **App ID** と **App Secret**（Token Key）をコピー
3. `server/.env` に追加：

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

4. バックエンドを再起動 — TURN クレデンシャルは通話セッションごとに自動取得されます（TTL: 86,400秒）

> **未設定時**：STUN のみにフォールバックします（Google + Cloudflare パブリック STUN）。LAN 内の通話は追加設定なしで動作します。

### 通話タイプ

| タイプ | 通信方式 | 推奨用途 |
|--------|----------|----------|
| 1:1 ビデオ通話 | WebRTC P2P + TURN | すべてのシナリオ |
| 1:1 音声通話 | WebRTC P2P + TURN | すべてのシナリオ |
| グループ通話 | WebRTC Mesh（フルメッシュ） | 最大6人 |

---

## プッシュ通知の設定

オフラインメッセージ通知は**2つのチャネル**で配信され、配信率を最大化します：

| チャネル | 対応プラットフォーム | 設定 |
|----------|----------------------|------|
| Web Push (VAPID) | ブラウザ (Chrome/Edge/Firefox) + iOS PWA (Safari 16.4+) | VAPID キー |
| OneSignal | Median.co 経由のネイティブ Android/iOS アプリ | OneSignal App ID + REST Key |

### Web Push の設定

1. VAPID キーを生成（1回のみ）：

```bash
cd server
npx web-push generate-vapid-keys
```

2. `server/.env` に追加：

```env
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_SUBJECT=mailto:admin@your-domain.com
```

3. サーバーを再起動 — ユーザーは設定ページから通知を有効にできます

> **iOS ユーザー**は先に「ホーム画面に追加」（PWA）を行う必要があり、iOS 16.4以上のみサポートされます。

### OneSignal の設定（Median.co ネイティブアプリ）

1. [OneSignal Dashboard](https://onesignal.com) でアプリを作成し、Firebase を設定
2. Median.co で OneSignal を有効にし、App ID を入力
3. OneSignal の **App ID** と **REST API Key** を `server/.env` に追加：

```env
ONESIGNAL_APP_ID=your_onesignal_app_id
ONESIGNAL_REST_KEY=your_onesignal_rest_api_key
```

> **未設定時**：プッシュ通知は自動的に無効化されます — 他の機能には影響しません。

---

## iOS — 証明書不要の永続デプロイ

1. HTTPS ドメインのサーバーにデプロイ（WebRTC と Web Crypto API には HTTPS が必要）
2. **Safari** で `https://your.domain.com` を開く
3. 画面下部の共有ボタン ⬆️ をタップ
4. **ホーム画面に追加** → **追加** を選択

ネイティブアプリと同様に動作します — Apple エンタープライズ証明書不要、期限なし。

---

## 本番デプロイ（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # フロントエンド静的ファイル
    location / {
        root /path/to/paperphone/client;
        try_files $uri /index.html;
    }

    # REST API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # WebSocket（メッセージング＋通話シグナリング）
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

## データベーススキーマ

19テーブル、サーバー初回起動時に自動作成（`CREATE TABLE IF NOT EXISTS`）：

| テーブル | 用途 |
|----------|------|
| `users` | ユーザー情報 + ECDH/OPK 公開鍵 |
| `prekeys` | X3DH ワンタイムプリキープール |
| `friends` | 友達関係（pending / accepted / blocked） |
| `groups` / `group_members` | グループチャット＋メンバー（通知オフ状態含む） |
| `messages` | 暗号化メッセージ（オフラインバッファ、配信後削除可能） |
| `moments` | ソーシャル投稿（テキスト ≤ 1024文字） |
| `moment_images` | 投稿画像（1投稿最大9枚） |
| `moment_videos` | 投稿動画（サムネイル＋再生時間、1投稿1本、≤10分） |
| `moment_likes` | いいね（ユーザーごと投稿ごとにユニーク） |
| `moment_comments` | コメント（≤ 512文字/件） |
| `push_subscriptions` | Web Push サブスクリプション（VAPID） |
| `onesignal_players` | OneSignal デバイス登録（Median.co） |
| `user_totp` | TOTP 二段階認証のシークレットとリカバリーコード |
| `moment_privacy` | モーメンツのユーザーレベルプライバシー設定（非表示/非公開） |
| `timeline_posts` | タイムライン投稿（テキスト ≤2000文字、匿名対応） |
| `timeline_media` | タイムラインメディア（画像/動画、最大50件/投稿） |
| `timeline_likes` | タイムラインいいね |
| `timeline_comments` | タイムラインコメント（匿名対応） |
| `group_invites` | グループ招待リンク（有効期限付き、QRコード参加用） |

---

## セキュリティモデル

```
登録時:
  デバイスが IK（アイデンティティキー）+ SPK（署名付きプリキー）+ 10× OPK（ワンタイムプリキー）を生成
  公開鍵はアップロード、秘密鍵はデバイスに保存（4層永続化）

メッセージ送信時:
  送信者が受信者の IK 公開鍵を取得
  一時 ECDH 鍵ペアを生成（メッセージごとに新しいペア）
  X25519 ECDH → 共有秘密 → XSalsa20-Poly1305 暗号化
  一時公開鍵はメッセージヘッダーで送信、使用後に破棄

サーバーが見るもの:
  ✅ 暗号文ブロブ＋ルーティングメタデータ（送受信者UUID、タイムスタンプ）
  ❌ 平文 / 秘密鍵 / 一時鍵 / 通話内容
```

---

## 環境変数リファレンス

| 変数 | 説明 | デフォルト |
|------|------|------------|
| `PORT` | サーバーポート | `3000` |
| `JWT_SECRET` | JWT 署名キー（**本番環境では必ず変更**） | dev_secret |
| `DB_HOST` / `DB_PASS` / `DB_NAME` | MySQL 接続設定 | — |
| `REDIS_HOST` / `REDIS_PASS` | Redis 接続設定 | — |
| `R2_ACCOUNT_ID` | Cloudflare アカウント ID | — |
| `R2_ACCESS_KEY_ID` | R2 API トークンのアクセスキー | — |
| `R2_SECRET_ACCESS_KEY` | R2 API トークンのシークレットキー | — |
| `R2_BUCKET` | R2 バケット名 | — |
| `R2_PUBLIC_URL` | R2 公開 URL（任意）— CDN 直リンクを有効化 | — |
| `CF_CALLS_APP_ID` | Cloudflare Calls App ID（任意） | — |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret（任意） | — |
| `VAPID_PUBLIC_KEY` | Web Push VAPID 公開鍵（任意） | — |
| `VAPID_PRIVATE_KEY` | Web Push VAPID 秘密鍵（任意） | — |
| `VAPID_SUBJECT` | VAPID 連絡先メール（任意） | `mailto:admin@paperphone.app` |
| `ONESIGNAL_APP_ID` | OneSignal App ID（任意、Median.co用） | — |
| `ONESIGNAL_REST_KEY` | OneSignal REST API Key（任意） | — |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（任意、ステッカープロキシ） | — |
| `STICKER_PACKS` | カスタムステッカーパック（任意、カンマ区切り `名前:ラベル`、無制限） | デフォルト8パック |

---

## ライセンス

MIT © PaperPhone Contributors
