-- ============================================================
--  Rapid OTP — MySQL Database Schema
--  Mirrors the MongoDB/Mongoose model definitions exactly.
--  All tables include `createdAt` and `updatedAt` timestamps
--  to match Mongoose `{ timestamps: true }` option.
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
-- NOTE: Please create your database manually or select it before running this script.
-- Example: USE `your_database_name`;


-- -----------------------------------------------------------
-- Table: Users
-- Model:  models/User.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Users` (
  `id`                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `username`          VARCHAR(30)      NOT NULL,
  `email`             VARCHAR(255)     NOT NULL,
  `password_hash`     VARCHAR(255)     NOT NULL,
  `display_name`      VARCHAR(100)     NOT NULL DEFAULT '',
  `avatar_color`      VARCHAR(20)      NOT NULL DEFAULT '#3b82f6',
  `balance`           DOUBLE           NOT NULL DEFAULT 0,
  `is_banned`         TINYINT(1)       NOT NULL DEFAULT 0,
  `is_admin`          TINYINT(1)       NOT NULL DEFAULT 0,
  `total_spent`       DOUBLE           NOT NULL DEFAULT 0,
  `total_orders`      INT UNSIGNED     NOT NULL DEFAULT 0,
  `notes`             TEXT             NOT NULL DEFAULT '',
  `api_key`           VARCHAR(255)     NOT NULL DEFAULT '',
  `currency`          VARCHAR(10)      NOT NULL DEFAULT 'INR',
  `referral_code`     VARCHAR(50)               DEFAULT NULL,
  `referred_by`       VARCHAR(50)               DEFAULT NULL,
  `referral_count`    INT UNSIGNED     NOT NULL DEFAULT 0,
  `referral_earnings` DOUBLE           NOT NULL DEFAULT 0,
  `has_deposited`     TINYINT(1)       NOT NULL DEFAULT 0,
  `createdAt`         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username`     (`username`),
  UNIQUE KEY `uq_users_email`        (`email`),
  UNIQUE KEY `uq_users_referral_code`(`referral_code`),
  KEY        `idx_users_referred_by` (`referred_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Countries
-- Model:  models/Country.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Countries` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(10)  NOT NULL,
  `name`       VARCHAR(100) NOT NULL,
  `flag`       VARCHAR(10)  NOT NULL DEFAULT '🌍',
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `createdAt`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_countries_code`       (`code`),
  KEY        `idx_countries_sort_name` (`sort_order`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Servers
-- Model:  models/Server.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Servers` (
  `id`                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`                  VARCHAR(100)  NOT NULL,
  `slug`                  VARCHAR(120)            DEFAULT NULL,
  `country_id`            INT UNSIGNED            DEFAULT NULL,   -- FK → Countries.id
  `api_key`               VARCHAR(255)  NOT NULL DEFAULT '',
  `api_get_number_url`    TEXT          NOT NULL,
  `api_check_status_url`  TEXT          NOT NULL,
  `api_cancel_url`        TEXT          NOT NULL,
  `api_retry_url`         TEXT          NOT NULL,
  `auto_cancel_minutes`   INT           NOT NULL DEFAULT 20,
  `retry_count`           INT           NOT NULL DEFAULT 0,
  `min_cancel_minutes`    INT           NOT NULL DEFAULT 0,
  `is_active`             TINYINT(1)    NOT NULL DEFAULT 1,
  `multi_otp_supported`   TINYINT(1)    NOT NULL DEFAULT 0,
  `check_interval`        INT           NOT NULL DEFAULT 3,
  `auto_add_services`     TINYINT(1)    NOT NULL DEFAULT 0,
  `extra_profit`          DOUBLE        NOT NULL DEFAULT 0,
  `createdAt`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_servers_country_id` (`country_id`),
  CONSTRAINT `fk_servers_country` FOREIGN KEY (`country_id`)
    REFERENCES `Countries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Services
-- Model:  models/Service.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Services` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(100)  NOT NULL,
  `server_id`     INT UNSIGNED            DEFAULT NULL,   -- FK → Servers.id
  `service_code`  VARCHAR(100)  NOT NULL,
  `country_code`  VARCHAR(20)   NOT NULL,
  `price`         DOUBLE        NOT NULL,
  `image_url`     VARCHAR(500)  NOT NULL DEFAULT '',
  `icon_color`    VARCHAR(20)   NOT NULL DEFAULT '',
  `success_rate`  VARCHAR(20)   NOT NULL DEFAULT '95%',
  `avg_time`      VARCHAR(20)   NOT NULL DEFAULT '2m',
  `check_interval`INT           NOT NULL DEFAULT 3,
  `is_active`     TINYINT(1)    NOT NULL DEFAULT 1,
  `is_auto`       TINYINT(1)    NOT NULL DEFAULT 0,
  `createdAt`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_services_server_id`    (`server_id`),
  KEY `idx_services_country_code` (`country_code`),
  KEY `idx_services_is_active`    (`is_active`),
  CONSTRAINT `fk_services_server` FOREIGN KEY (`server_id`)
    REFERENCES `Servers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Orders
-- Model:  models/Order.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Orders` (
  `id`                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `order_id`          VARCHAR(30)    NOT NULL,                          -- e.g. ORD-XXXXXXXXXX
  `user_id`           VARCHAR(50)    NOT NULL,                          -- user's id (string for cross-db compat)
  `service_name`      VARCHAR(100)   NOT NULL,
  `server_name`       VARCHAR(100)   NOT NULL DEFAULT '',
  `country`           VARCHAR(20)    NOT NULL DEFAULT '',
  `phone`             VARCHAR(30)    NOT NULL DEFAULT '',
  `otp`               TEXT           NOT NULL,
  `all_otps`          LONGTEXT                DEFAULT NULL,             -- array of OTP strings
  `status`            ENUM('active','completed','refunded','expired','cancelled')
                                     NOT NULL DEFAULT 'active',
  `cost`              DOUBLE         NOT NULL,
  `expires_at`        DATETIME                DEFAULT NULL,
  `min_cancel_at`     DATETIME                DEFAULT NULL,
  `external_order_id` VARCHAR(100)   NOT NULL DEFAULT '',
  `multi_otp_enabled` TINYINT(1)     NOT NULL DEFAULT 0,
  `last_check_at`     DATETIME                DEFAULT NULL,
  `service_image`     VARCHAR(500)   NOT NULL DEFAULT '',
  `service_color`     VARCHAR(20)    NOT NULL DEFAULT '',
  `check_interval`    INT            NOT NULL DEFAULT 3,
  `createdAt`         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_id`     (`order_id`),
  KEY        `idx_orders_user_id`     (`user_id`),
  KEY        `idx_orders_status`      (`status`),
  KEY        `idx_orders_created_at`  (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Transactions
-- Model:  models/Transaction.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Transactions` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(50)   NOT NULL,
  `type`          ENUM('deposit','purchase','refund','bonus','deduction')
                                NOT NULL,
  `amount`        DOUBLE        NOT NULL,
  `balance_after` DOUBLE        NOT NULL DEFAULT 0,
  `description`   VARCHAR(500)  NOT NULL DEFAULT '',
  `reference`     VARCHAR(255)  NOT NULL DEFAULT '',
  `order_id`      VARCHAR(30)   NOT NULL DEFAULT '',
  `status`        ENUM('pending','completed','failed')
                                NOT NULL DEFAULT 'completed',
  `createdAt`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_transactions_user_id`    (`user_id`),
  KEY `idx_transactions_type`       (`type`),
  KEY `idx_transactions_order_id`   (`order_id`),
  KEY `idx_transactions_created_at` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: Settings
-- Model:  models/Setting.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Settings` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key`       VARCHAR(100) NOT NULL,
  `value`     LONGTEXT              DEFAULT NULL,   -- Mixed type → TEXT for compat
  `label`     VARCHAR(255) NOT NULL DEFAULT '',
  `group`     VARCHAR(100) NOT NULL DEFAULT 'general',
  `createdAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settings_key`   (`key`),
  KEY        `idx_settings_group`(`group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: PromoCodes
-- Model:  models/PromoCode.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `PromoCodes` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(100) NOT NULL,
  `amount`      DOUBLE       NOT NULL,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `usage_limit` INT          NOT NULL DEFAULT 1,
  `used_count`  INT          NOT NULL DEFAULT 0,
  `used_by`     LONGTEXT              DEFAULT NULL,   -- array of user id strings
  `createdAt`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promocodes_code`      (`code`),
  KEY        `idx_promocodes_is_active`(`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: AccountCategories
-- Model:  models/AccountCategory.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `AccountCategories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `description` TEXT         NOT NULL DEFAULT '',
  `icon`        VARCHAR(20)  NOT NULL DEFAULT '🗂️',
  `price`       DOUBLE       NOT NULL,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `createdAt`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_accountcategories_is_active`  (`is_active`),
  KEY `idx_accountcategories_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------
-- Table: ReadymadeAccounts
-- Model:  models/ReadymadeAccount.js
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ReadymadeAccounts` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id`   INT UNSIGNED NOT NULL,               -- FK → AccountCategories.id
  `credentials`   TEXT         NOT NULL,
  `notes`         TEXT         NOT NULL DEFAULT '',
  `status`        ENUM('available','sold','reserved')
                               NOT NULL DEFAULT 'available',
  `sold_to`       VARCHAR(50)           DEFAULT NULL,
  `sold_at`       DATETIME              DEFAULT NULL,
  `price_at_sale` DOUBLE                DEFAULT NULL,
  `createdAt`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_readymadeaccounts_category_id` (`category_id`),
  KEY `idx_readymadeaccounts_status`      (`status`),
  CONSTRAINT `fk_readymade_category` FOREIGN KEY (`category_id`)
    REFERENCES `AccountCategories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
--  Seed: Default Settings
--  Mirrors the default values set by the admin panel.
-- ============================================================
INSERT IGNORE INTO `Settings` (`key`, `value`, `label`, `group`) VALUES
  ('site_name',         'Zaz',         'Site Name',         'branding'),
  ('site_logo',         'null',          'Site Logo URL',     'branding'),
  ('site_favicon',      'null',          'Favicon URL',       'branding'),
  ('primary_color',     '"#3b82f6"',     'Primary Color',     'branding'),
  ('default_theme',     '"dark"',        'Default Theme',     'branding'),
  ('maintenance_mode',  'false',         'Maintenance Mode',  'general'),
  ('min_deposit',       '10',            'Min Deposit (INR)', 'general'),
  ('referral_bonus',    '5',             'Referral Bonus %',  'general'),
  ('custom_css',        '""',            'Custom CSS',        'advanced'),
  ('head_scripts',      '""',            'Head Scripts',      'advanced'),
  ('foot_scripts',      '""',            'Foot Scripts',      'advanced');
