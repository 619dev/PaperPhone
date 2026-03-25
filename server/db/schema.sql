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
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pair (user_id, friend_id),
  FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Groups ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `groups` (
  id          VARCHAR(36)   PRIMARY KEY,
  name        VARCHAR(128)  NOT NULL,
  avatar      VARCHAR(512)  DEFAULT NULL,
  owner_id    VARCHAR(36)   NOT NULL,
  notice      TEXT          DEFAULT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Group Members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  group_id    VARCHAR(36)   NOT NULL,
  user_id     VARCHAR(36)   NOT NULL,
  role        ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  joined_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Messages ──────────────────────────────────────────────────────────────
-- Server stores encrypted payloads for offline delivery only.
-- Once delivered via WebSocket, messages may be pruned.
CREATE TABLE IF NOT EXISTS messages (
  id          VARCHAR(36)   PRIMARY KEY,
  type        ENUM('private','group') NOT NULL,
  from_id     VARCHAR(36)   NOT NULL,
  to_id       VARCHAR(36)   NOT NULL,   -- user_id or group_id
  ciphertext  LONGTEXT      NOT NULL,   -- base64 encrypted payload
  header      TEXT          DEFAULT NULL, -- ephemeral public key (for E2EE)
  msg_type    ENUM('text','image','file','voice','video_call','system') NOT NULL DEFAULT 'text',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered   TINYINT(1)    NOT NULL DEFAULT 0,
  INDEX idx_to_undelivered (to_id, delivered, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
