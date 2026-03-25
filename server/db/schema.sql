-- PaperPhone IM Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS paperphone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE paperphone;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36) PRIMARY KEY,
  username    VARCHAR(64) NOT NULL UNIQUE,
  nickname    VARCHAR(128) NOT NULL,
  avatar      VARCHAR(512) DEFAULT NULL,
  password    VARCHAR(255) NOT NULL,
  -- X3DH Identity Key (public, base64)
  ik_pub      TEXT NOT NULL,
  -- Signed PreKey (public, base64)
  spk_pub     TEXT NOT NULL,
  spk_sig     TEXT NOT NULL,
  -- ML-KEM-768 long-term public key
  kem_pub     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_online   TINYINT(1) DEFAULT 0,
  INDEX idx_username (username)
) ENGINE=InnoDB;

-- One-time prekeys (X3DH OPKs)
CREATE TABLE IF NOT EXISTS prekeys (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  key_id      INT NOT NULL,
  opk_pub     TEXT NOT NULL,
  used        TINYINT(1) DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_unused (user_id, used)
) ENGINE=InnoDB;

-- Friendships
CREATE TABLE IF NOT EXISTS friends (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  friend_id   VARCHAR(36) NOT NULL,
  status      ENUM('pending','accepted','blocked') DEFAULT 'pending',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pair (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Groups
CREATE TABLE IF NOT EXISTS `groups` (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  avatar      VARCHAR(512) DEFAULT NULL,
  owner_id    VARCHAR(36) NOT NULL,
  notice      TEXT DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Group members
CREATE TABLE IF NOT EXISTS group_members (
  group_id    VARCHAR(36) NOT NULL,
  user_id     VARCHAR(36) NOT NULL,
  role        ENUM('owner','admin','member') DEFAULT 'member',
  joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Messages (server only stores ciphertext for offline delivery)
-- Once delivered, messages are deleted from server
CREATE TABLE IF NOT EXISTS messages (
  id           VARCHAR(36) PRIMARY KEY,
  type         ENUM('private','group') NOT NULL,
  from_id      VARCHAR(36) NOT NULL,
  to_id        VARCHAR(36) NOT NULL, -- user_id or group_id
  -- Encrypted payload (base64)
  ciphertext   LONGTEXT NOT NULL,
  -- X3DH initial message header if first message
  header       TEXT DEFAULT NULL,
  msg_type     ENUM('text','image','file','voice','video_call','system') DEFAULT 'text',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered    TINYINT(1) DEFAULT 0,
  INDEX idx_to_undelivered (to_id, delivered, created_at)
) ENGINE=InnoDB;
