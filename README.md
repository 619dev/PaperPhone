# PaperPhone IM

一款微信风格的端对端加密即时通讯应用，采用无状态 ECDH + XSalsa20-Poly1305 逐消息加密，支持 iOS PWA 永久免签与 Cloudflare R2 文件存储。

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](#) [![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](#) [![Redis](https://img.shields.io/badge/Redis-7.x-red)](#) [![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20%2B%20Mesh-orange)](#)

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

---

## 特性

| 功能 | 说明 |
|------|------|
| 🔐 端对端加密 | 无状态 ECDH + XSalsa20-Poly1305，逐消息临时密钥，前向保密 |
| 🗝️ 零知识服务器 | 服务器只存储密文，私钥仅在设备本地（四层持久化） |
| 📹 视频/语音通话 | WebRTC P2P（1:1）+ Mesh（多人），Cloudflare TURN 穿透 |
| 🌐 多语言 | 中文、英文、日语、韩语、法语（自动检测 + 手动切换） |
| 📱 iOS 永久免签 | PWA H5 → Safari「添加到主屏幕」，无需企业证书 |
| 💬 消息功能 | 文字、图片、语音消息、Emoji 面板（64 个）、已读状态 |
| 🌐 朋友圈 | 发动态（文字+最多9张图）、点赞、评论、好友动态流 |
| 🗂️ R2 对象存储 | Cloudflare R2 存储图片/语音，可选公开 CDN 直链 |
| 🏗️ 可自托管 | Docker Compose 一键部署，支持 Node.js + Redis 多节点 |

---

## 技术栈

```
后端 (server/)
  Node.js 20 + Express + ws
  MySQL 8.0  — 用户/消息持久化
  Redis      — 在线状态 + 跨节点路由
  Cloudflare R2 — 图片/语音文件存储（S3 兼容 API）
  JWT + bcrypt 认证

前端 (client/)
  原生 HTML + Vanilla JS (ESM，无打包工具)
  libsodium-wrappers (WebAssembly, Curve25519 / XSalsa20-Poly1305)
  WebRTC API  — 视频/语音通话
  PWA: manifest.json + Service Worker

加密层
  无状态 ECDH + XSalsa20-Poly1305 — 逐消息临时 ECDH 密钥对，前向保密
  私钥四层持久化: 内存 → localStorage → sessionStorage → IndexedDB
  私钥全程存储在设备本地，从不上传服务器
```

---

## 快速启动

### 方式零：Zeabur 一键云部署

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/P2J7Y3?referralCode=619dev)

> [!NOTE]
> 部署完成后需手动完成一步配置，否则注册/登录无法使用：
> 1. 进入 Zeabur 控制台 → **server 服务** → Environment Variables → 复制 `ZEABUR_WEB_URL` 的值（如 `http://10.43.x.x:3000`）
> 2. 进入 **client 服务** → Environment Variables → 添加变量 `SERVER_URL` = 上一步复制的值
> 3. Restart client 服务

**已知注意事项：**
- 首次启动 server 会自动创建数据库表（`CREATE TABLE IF NOT EXISTS`），无需手动导入 schema
- Redis 在集群内无需密码，已默认关闭认证
- 若需配置 MySQL root 密码，可在 server 服务的 `DB_PASS` 里手动填写 MySQL 服务的 `MYSQL_ROOT_PASSWORD`
- 如需获取某个服务容器的**内网 IP**，在 Zeabur 控制台打开该服务的命令行（Terminal），输入：
  ```bash
  hostname -i
  ```

---

### 方式一：Docker Compose（推荐，无需本地构建）

```bash
# 克隆仓库
git clone <repo-url> && cd paperphone

# 复制并编辑环境变量
cp server/.env.example server/.env
# 按需编辑：DB_PASS / JWT_SECRET / CF_CALLS_APP_ID 等

# 拉取镜像并一键启动
docker compose up -d

# 查看服务状态
docker compose ps

# 访问
open http://localhost
```

> 镜像已发布至 Docker Hub：
> - `facilisvelox/paperphone-client:latest`
> - `facilisvelox/paperphone-server:latest`
>
> **注意**：server 首次启动会自动初始化数据库 schema，无需手动导入 SQL 文件。

### 方式二：本地手动启动

#### 1. 准备环境

```bash
# 复制并编辑环境变量
cp server/.env.example server/.env
# 填写 DB_HOST / DB_PASS / REDIS_HOST / R2_* 等

# 注：server 首次启动会自动执行 schema.sql，无需手动导入
```

#### 2. 启动后端

```bash
cd server
npm install
npm run dev   # → http://localhost:3000
```

#### 3. 启动前端

```bash
npx serve client -p 8080
# → http://localhost:8080
```

---

## 视频通话配置

视频通话使用 WebRTC P2P，局域网内开箱即用。跨网络通话需要配置 TURN 服务器（用于 NAT 穿透）。

### 使用 Cloudflare TURN（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Calls** → 创建 App
2. 获取 **App ID** 和 **App Secret**（Token Key）
3. 填入 `server/.env`：

```env
CF_CALLS_APP_ID=your_app_id_here
CF_CALLS_APP_SECRET=your_app_secret_here
```

4. 重启后端，TURN 凭据会在每次通话时自动刷新（TTL 86400s）

> **未配置时**：自动降级为 STUN only（Google + Cloudflare 公共 STUN），局域网内可正常通话。

### 通话功能说明

| 类型 | 技术方案 | 适用场景 |
|------|----------|----------|
| 私聊 1:1 视频 | WebRTC P2P + TURN | 所有场景 |
| 私聊 1:1 语音 | WebRTC P2P + TURN | 所有场景 |
| 群组多人语音/视频 | WebRTC Mesh（全连接） | ≤ 6 人 |

---

## iOS 永久免签部署

1. 部署到有 HTTPS 域名的服务器（WebRTC 和加密 API 需要 HTTPS）
2. 用 **Safari** 打开 `https://your.domain.com`
3. 点击底部分享按钮 ⬆️
4. 选择「添加到主屏幕」→「添加」

即可获得与原生 App 相同的体验，无需 Apple 企业证书，永久有效！

---

## 生产部署（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端静态文件
    location / {
        root /path/to/paperphone/client;
        try_files $uri /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # WebSocket 信令
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

## 项目结构

```
paperphone/
├── docker-compose.yml
├── server/
│   ├── .env                    # 环境变量（如 Cloudflare TURN 密钥）
│   └── src/
│       ├── app.js              # Express 应用入口
│       ├── routes/
│       │   ├── auth.js         # 注册/登录（含 X3DH 公钥上传）
│       │   ├── users.js        # 用户搜索 / Prekey 下载
│       │   ├── friends.js      # 好友申请 / 接受
│       │   ├── groups.js       # 群组管理
│       │   ├── messages.js     # 历史消息（密文分页）
│       │   ├── upload.js       # Cloudflare R2 文件上传
│       │   ├── files.js        # 文件代理（R2_PUBLIC_URL 未设时）
│       │   ├── moments.js      # 朋友圈（动态/点赞/评论）
│       │   └── calls.js        # TURN 凭据派发
│       └── ws/
│           └── wsServer.js     # WebSocket 路由（含通话信令）
│
└── client/
    ├── index.html              # SPA 入口 + PWA 元数据
    ├── manifest.json           # PWA 清单
    ├── sw.js                   # Service Worker（离线缓存）
    └── src/
        ├── style.css           # Premium 设计系统（暗色/亮色，玻璃拟态）
        ├── app.js              # 路由 + 全局状态 + 来电监听
        ├── api.js              # HTTP 客户端
        ├── socket.js           # WebSocket 客户端（自动重连）
        ├── i18n.js             # 多语言引擎（zh/en/ja/ko/fr）
        ├── services/
        │   └── webrtc.js       # WebRTC 管理器（CallManager）
        ├── crypto/
        │   ├── ratchet.js      # X3DH + Double Ratchet + ML-KEM-768
        │   └── keystore.js     # 四层私钥持久化（内存/localStorage/sessionStorage/IndexedDB）
        └── pages/
            ├── login.js        # 登录/注册（含密钥生成、语言切换）
            ├── chats.js        # 会话列表
            ├── chat.js         # 聊天窗口（E2E 加密、通话按钮）
            ├── contacts.js     # 通讯录（好友申请/在线状态）
            ├── discover.js     # 发现页
            ├── profile.js      # 我的/设置（语言、指纹、PWA）
            └── call.js         # 通话 UI（来电/通话中/多人视频）
```

---

## 数据库结构

共 9 张表，首次启动自动创建（`CREATE TABLE IF NOT EXISTS`）：

| 表名 | 说明 |
|------|------|
| `users` | 用户信息 + ECDH/OPK 公钥 |
| `prekeys` | X3DH 一次性预密钥池 |
| `friends` | 好友关系（pending/accepted/blocked） |
| `groups` / `group_members` | 群组 + 成员 |
| `messages` | 加密消息（离线缓冲，送达后可删） |
| `moments` | 朋友圈动态（文字 ≤1024 字） |
| `moment_images` | 动态图片（每条最多 9 张） |
| `moment_likes` | 点赞（每用户每条唯一） |
| `moment_comments` | 评论（最多 512 字/条） |

---

## 安全模型

```
注册时:
  设备本地生成 IK（身份密钥）+ SPK（签名预密钥）+ 10x OPK（一次性预密钥）
  公钥上传服务器，私钥四层持久化，永不离开设备

发送消息时:
  发送方下载接收方 IK 公钥
  生成临时 ECDH 密钥对（每条消息独立）
  X25519 ECDH → 共享秘密 → XSalsa20-Poly1305 加密
  临时公钥附在消息 header 中，接收方解密后销毁

服务器所见:
  ✅ 密文 blob + 路由元数据（发件人/收件人 UUID）
  ❌ 明文 / 私钥 / 临时密钥 / 通话内容
```

---

## 环境变量参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `JWT_SECRET` | JWT 签名密钥（**生产必改**） | dev_secret |
| `DB_HOST` / `DB_PASS` / `DB_NAME` | MySQL 连接配置 | — |
| `REDIS_HOST` / `REDIS_PASS` | Redis 连接配置 | — |
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID | — |
| `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key | — |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret Key | — |
| `R2_BUCKET` | R2 Bucket 名称 | — |
| `R2_PUBLIC_URL` | R2 公开 URL（可选），设置后文件走 CDN 直链 | — |
| `CF_CALLS_APP_ID` | Cloudflare Calls App ID（可选） | — |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret（可选） | — |
---
如果这个项目对你有用的话，请我喝罐可乐吧。
<img width=30% height=30% src="https://raw.githubusercontent.com/619dev/PaperPhone/main/%E8%AF%B7%E6%88%91%E5%96%9D%E5%8F%AF%E4%B9%90.jpg" alt="qrcode">
