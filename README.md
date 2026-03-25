# PaperPhone IM

一款微信风格的端对端加密即时通讯应用，融合了 BoxIM 架构和 SimpleX Chat 的安全模型。

## 特性

| 功能 | 说明 |
|------|------|
| 🔐 端对端加密 | X3DH 初始密钥协商 + Double Ratchet 前向保密 |
| ⚛️ 抗量子 | ML-KEM-768 (CRYSTALS-Kyber, NIST 标准) 注入每轮 Ratchet |
| 🗝️ 零知识服务器 | 服务器只存储密文，私钥仅在设备 IndexedDB |
| 📱 iOS 永久免签 | PWA H5 → Safari "添加到主屏幕"，无需企业证书 |
| 🌐 微信 UI | 四标签底栏，气泡聊天，语音消息，图片，表情 |
| 🏗️ 可集群 | Node.js + Redis 多节点消息路由 |

## 技术栈

```
后端 (server/)
  Node.js + Express + ws
  MySQL 8.0 (用户/消息持久化)
  Redis (在线状态 + 跨节点路由)
  MinIO (文件/图片对象存储)
  JWT + bcrypt 认证

前端 (client/)
  原生 HTML + Vanilla JS (ESM)
  libsodium-wrappers (WebAssembly, Curve25519)
  ML-KEM-768 (crystals-kyber)
  PWA: manifest.json + Service Worker

加密层
  X3DH → Double Ratchet → ML-KEM-768 抗量子注入
  私钥存储于 IndexedDB (从不发送至服务器)
```

## 快速启动

### 1. 准备环境

```bash
# MySQL 创建数据库
mysql -u root -p < server/db/schema.sql

# 复制环境变量
cp server/.env.example server/.env
# 编辑 server/.env 填写 MySQL/Redis/MinIO 配置
```

### 2. 启动后端

```bash
cd server
npm install
npm run dev   # 监听 http://localhost:3000
```

### 3. 启动前端 (开发)

```bash
# 使用任意静态服务器
npx serve client -p 8080
# 访问 http://localhost:8080
```

### 4. 生产部署

```nginx
# Nginx 反向代理示例 (需要 SSL 证书)
server {
    listen 443 ssl;
    server_name your.domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 静态文件
    location / {
        root /path/to/paperphone/client;
        try_files $uri /index.html;
    }

    # API + WebSocket
    location /api/ { proxy_pass http://localhost:3000; }
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## iOS 永久免签部署

1. 部署到有 HTTPS 域名的服务器
2. 用 **Safari** 打开 `https://your.domain.com`
3. 点击底部分享按钮 ⬆️
4. 选择「添加到主屏幕」
5. 点击「添加」

即可获得与原生 App 相同的体验，无需 Apple 企业证书，永久有效！

## 项目结构

```
paperphone/
├── server/
│   ├── src/
│   │   ├── app.js          # Express 应用
│   │   ├── index.js        # 入口 + 服务器启动
│   │   ├── db/
│   │   │   ├── mysql.js    # MySQL 连接池
│   │   │   ├── redis.js    # Redis 客户端
│   │   │   └── minio.js    # MinIO 对象存储
│   │   ├── routes/
│   │   │   ├── auth.js     # 注册/登录 (含 X3DH 公钥上传)
│   │   │   ├── users.js    # 用户搜索/Prekey 下载
│   │   │   ├── friends.js  # 好友申请/接受
│   │   │   ├── groups.js   # 群组管理
│   │   │   ├── upload.js   # MinIO 文件上传
│   │   │   └── messages.js # 历史消息 (密文)
│   │   ├── ws/
│   │   │   └── wsServer.js # WebSocket 消息路由
│   │   └── middlewares/
│   │       └── auth.js     # JWT 中间件
│   └── db/
│       └── schema.sql      # MySQL 建表脚本
│
└── client/
    ├── index.html          # SPA 入口 + PWA meta
    ├── manifest.json       # PWA 清单
    ├── sw.js               # Service Worker
    └── src/
        ├── style.css       # 微信风格设计系统
        ├── app.js          # 路由 + 全局状态
        ├── api.js          # HTTP 客户端
        ├── socket.js       # WebSocket 客户端
        ├── crypto/
        │   ├── ratchet.js  # X3DH + Double Ratchet + ML-KEM
        │   └── keystore.js # IndexedDB 私钥存储
        └── pages/
            ├── login.js    # 登录/注册 (含密钥生成)
            ├── chats.js    # 会话列表
            ├── chat.js     # 聊天窗口 (E2E 加密)
            ├── contacts.js # 通讯录
            ├── discover.js # 发现
            └── profile.js  # 我的/设置
```

## 安全模型

```
注册时:
  设备生成 IK (身份密钥) + SPK (签名预密钥) + 10x OPK (一次性预密钥)
  公钥上传服务器，私钥仅存 IndexedDB

首次发消息时:
  发送方下载接收方 Prekey Bundle
  X3DH 四次 DH 得到共享秘密
  初始化 Double Ratchet，注入 ML-KEM-768 KEM 共享秘密
  后续每条消息独立密钥 (前向保密)

服务器:
  只看到：密文 + 路由元数据
  不存储：明文、私钥、会话状态
  消息投递后自动标记，可配置定期清理
```
