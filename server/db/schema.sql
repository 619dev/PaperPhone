-- PaperPhone IM — Database Schema
-- MySQL 8.0+  |  utf8mb4  |  InnoDB
--
-- Usage:
--   Manual    : mysql -u root -p paperphone < schema.sql
--   Docker    : mounted into /docker-entrypoint-initdb.d/
--   Server    : auto-executed on startup via index.js / initMomentsTables()
--
-- Note: CREATE DATABASE / USE are intentionally omitted.
-- The target database must already be selected before importing.

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36)   PRIMARY KEY,
  username    VARCHAR(64)   NOT NULL UNIQUE,
  nickname    VARCHAR(128)  NOT NULL,
  avatar      VARCHAR(512)  DEFAULT NULL,
  password    VARCHAR(255)  NOT NULL,
  -- ECDH Identity Key (Curve25519 public key, base64)
  ik_pub      TEXT          NOT NULL,
  -- Signed PreKey (Curve25519 public, base64)
  spk_pub     TEXT          NOT NULL,
  spk_sig     TEXT          NOT NULL,
  -- ML-KEM-768 long-term public key (base64)
  kem_pub     TEXT          NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_online   TINYINT(1)    NOT NULL DEFAULT 0,
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── One-Time PreKeys (X3DH OPKs) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prekeys (
  id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)     NOT NULL,
  key_id      INT             NOT NULL,
  opk_pub     TEXT            NOT NULL,
  used        TINYINT(1)      NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_unused (user_id, used)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Friendships ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friends (
  id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)     NOT NULL,
  friend_id   VARCHAR(36)     NOT NULL,
  status      ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
  auto_delete INT             NOT NULL DEFAULT 604800,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pair (user_id, friend_id),
  FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: add auto_delete to friends (idempotent)
SET @f_ad = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friends' AND COLUMN_NAME = 'auto_delete');
SET @f_sql = IF(@f_ad = 0,
  'ALTER TABLE friends ADD COLUMN auto_delete INT NOT NULL DEFAULT 604800 AFTER status',
  'SELECT 1');
PREPARE f_stmt FROM @f_sql;
EXECUTE f_stmt;
DEALLOCATE PREPARE f_stmt;

-- ── Groups ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `groups` (
  id          VARCHAR(36)   PRIMARY KEY,
  name        VARCHAR(128)  NOT NULL,
  avatar      VARCHAR(512)  DEFAULT NULL,
  owner_id    VARCHAR(36)   NOT NULL,
  notice      TEXT          DEFAULT NULL,
  auto_delete INT           NOT NULL DEFAULT 604800,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: add auto_delete to groups (idempotent)
SET @g_ad = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'groups' AND COLUMN_NAME = 'auto_delete');
SET @g_sql = IF(@g_ad = 0,
  'ALTER TABLE `groups` ADD COLUMN auto_delete INT NOT NULL DEFAULT 604800 AFTER notice',
  'SELECT 1');
PREPARE g_stmt FROM @g_sql;
EXECUTE g_stmt;
DEALLOCATE PREPARE g_stmt;

-- ── Group Members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  group_id    VARCHAR(36)   NOT NULL,
  user_id     VARCHAR(36)   NOT NULL,
  role        ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  muted       TINYINT(1)    NOT NULL DEFAULT 0,
  joined_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: add muted column to group_members (idempotent)
SET @gm_muted = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'group_members' AND COLUMN_NAME = 'muted');
SET @gm_sql = IF(@gm_muted = 0,
  'ALTER TABLE group_members ADD COLUMN muted TINYINT(1) NOT NULL DEFAULT 0 AFTER role',
  'SELECT 1');
PREPARE gm_stmt FROM @gm_sql;
EXECUTE gm_stmt;
DEALLOCATE PREPARE gm_stmt;

-- ── Messages ──────────────────────────────────────────────────────────────
-- Server stores encrypted payloads for offline delivery only.
-- Once delivered via WebSocket, messages may be pruned.
CREATE TABLE IF NOT EXISTS messages (
  id          VARCHAR(36)   PRIMARY KEY,
  type        ENUM('private','group') NOT NULL,
  from_id     VARCHAR(36)   NOT NULL,
  to_id       VARCHAR(36)   NOT NULL,   -- user_id or group_id
  ciphertext  LONGTEXT      NOT NULL,   -- base64 encrypted payload (for recipient)
  header      TEXT          DEFAULT NULL, -- ephemeral public key (for E2EE, recipient)
  self_ciphertext LONGTEXT  DEFAULT NULL, -- base64 encrypted payload (for sender)
  self_header TEXT          DEFAULT NULL, -- ephemeral public key (for E2EE, sender)
  msg_type    ENUM('text','image','file','voice','video_call','system') NOT NULL DEFAULT 'text',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered   TINYINT(1)    NOT NULL DEFAULT 0,
  read_at     DATETIME      DEFAULT NULL,
  INDEX idx_to_undelivered (to_id, delivered, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: add self_ciphertext / self_header for dual encryption (idempotent)
SET @db_name = DATABASE();
SET @tbl = 'messages';

SET @col_check = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = @tbl AND COLUMN_NAME = 'self_ciphertext');
SET @sql = IF(@col_check = 0,
  'ALTER TABLE messages ADD COLUMN self_ciphertext LONGTEXT DEFAULT NULL AFTER header, ADD COLUMN self_header TEXT DEFAULT NULL AFTER self_ciphertext',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Moments (朋友圈) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moments (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)   NOT NULL,
  text_content VARCHAR(1024) NOT NULL DEFAULT '',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Moment Images ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moment_images (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  moment_id   BIGINT UNSIGNED NOT NULL,
  url         TEXT            NOT NULL,
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_moment_id (moment_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Moment Likes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moment_likes (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  moment_id   BIGINT UNSIGNED NOT NULL,
  user_id     VARCHAR(36)     NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_like (moment_id, user_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Moment Comments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moment_comments (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  moment_id   BIGINT UNSIGNED NOT NULL,
  user_id     VARCHAR(36)     NOT NULL,
  text_content VARCHAR(512)   NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_moment_id (moment_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Push Subscriptions (Web Push / VAPID) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)     NOT NULL,
  endpoint    TEXT            NOT NULL,
  p256dh      TEXT            NOT NULL,
  auth        TEXT            NOT NULL,
  user_agent  VARCHAR(255)    DEFAULT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_endpoint (user_id, endpoint(512)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_push_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── OneSignal Players (Median.co native push) ────────────────────────────
CREATE TABLE IF NOT EXISTS onesignal_players (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)     NOT NULL,
  player_id   VARCHAR(64)     NOT NULL,
  platform    VARCHAR(16)     DEFAULT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_player (player_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_os_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sessions (Login Device Tracking) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id           VARCHAR(36)   PRIMARY KEY,
  user_id      VARCHAR(36)   NOT NULL,
  device_name  VARCHAR(128)  DEFAULT NULL,
  device_type  VARCHAR(16)   DEFAULT NULL,
  os           VARCHAR(64)   DEFAULT NULL,
  browser      VARCHAR(64)   DEFAULT NULL,
  ip_address   VARCHAR(45)   DEFAULT NULL,
  last_active  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked      TINYINT(1)    NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sess_user (user_id, revoked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Friend Tags ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_tags (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)   NOT NULL,
  name        VARCHAR(32)   NOT NULL,
  color       VARCHAR(7)    DEFAULT '#2196F3',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_tag (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ft_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Friend Tag Assignments (many-to-many) ────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_tag_assignments (
  tag_id      BIGINT UNSIGNED NOT NULL,
  friend_id   VARCHAR(36)     NOT NULL,
  PRIMARY KEY (tag_id, friend_id),
  FOREIGN KEY (tag_id)    REFERENCES friend_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Moment Visibility Rules ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moment_visibility (
  moment_id   BIGINT UNSIGNED NOT NULL,
  type        ENUM('whitelist','blacklist') NOT NULL,
  target_type ENUM('tag','user') NOT NULL,
  target_id   VARCHAR(36) NOT NULL,
  PRIMARY KEY (moment_id, target_type, target_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: add visibility column to moments (idempotent)
SET @m_vis = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moments' AND COLUMN_NAME = 'visibility');
SET @m_sql = IF(@m_vis = 0,
  "ALTER TABLE moments ADD COLUMN visibility ENUM('public','whitelist','blacklist') NOT NULL DEFAULT 'public' AFTER text_content",
  'SELECT 1');
PREPARE m_stmt FROM @m_sql;
EXECUTE m_stmt;
DEALLOCATE PREPARE m_stmt;
