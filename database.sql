-- Rapid OTP MySQL Database Schema
-- Generated to match existing MongoDB models

CREATE DATABASE IF NOT EXISTS rapid_otp;
USE rapid_otp;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) DEFAULT '',
    avatar_color VARCHAR(255) DEFAULT '#3b82f6',
    balance DOUBLE DEFAULT 0,
    is_banned TINYINT(1) DEFAULT 0,
    is_admin TINYINT(1) DEFAULT 0,
    total_spent DOUBLE DEFAULT 0,
    total_orders INT DEFAULT 0,
    notes TEXT,
    api_key VARCHAR(255) DEFAULT '',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 2. Countries Table
CREATE TABLE IF NOT EXISTS Countries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    flag VARCHAR(255) DEFAULT '🌍',
    is_active TINYINT(1) DEFAULT 1,
    sort_order INT DEFAULT 0,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    INDEX idx_country_sort (sort_order, name)
);

-- 3. Servers Table
CREATE TABLE IF NOT EXISTS Servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    country_id VARCHAR(255), -- Reference ID as string for compatibility
    api_key VARCHAR(255) DEFAULT '',
    api_get_number_url VARCHAR(255) DEFAULT '',
    api_check_status_url VARCHAR(255) DEFAULT '',
    api_cancel_url VARCHAR(255) DEFAULT '',
    api_retry_url VARCHAR(255) DEFAULT '',
    auto_cancel_minutes INT DEFAULT 20,
    retry_count INT DEFAULT 0,
    min_cancel_minutes INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    multi_otp_supported TINYINT(1) DEFAULT 0,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 4. Services Table
CREATE TABLE IF NOT EXISTS Services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    server_id VARCHAR(255),
    service_code VARCHAR(255) NOT NULL,
    country_code VARCHAR(255) NOT NULL,
    price DOUBLE NOT NULL,
    image_url VARCHAR(255) DEFAULT '',
    icon_color VARCHAR(255) DEFAULT '',
    success_rate VARCHAR(255) DEFAULT '95%',
    avg_time VARCHAR(255) DEFAULT '2m',
    is_active TINYINT(1) DEFAULT 1,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS Orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    server_name VARCHAR(255) DEFAULT '',
    country VARCHAR(255) DEFAULT '',
    phone VARCHAR(255) DEFAULT '',
    otp VARCHAR(255) DEFAULT '',
    all_otps JSON, -- Supported in MySQL 5.7.8+
    status ENUM('active', 'completed', 'refunded', 'expired', 'cancelled') DEFAULT 'active',
    cost DOUBLE NOT NULL,
    expires_at DATETIME,
    min_cancel_at DATETIME,
    external_order_id VARCHAR(255) DEFAULT '',
    multi_otp_enabled TINYINT(1) DEFAULT 0,
    last_check_at DATETIME,
    service_image VARCHAR(255) DEFAULT '',
    service_color VARCHAR(255) DEFAULT '',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 6. Transactions Table
CREATE TABLE IF NOT EXISTS Transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    type ENUM('deposit', 'purchase', 'refund', 'bonus', 'deduction') NOT NULL,
    amount DOUBLE NOT NULL,
    balance_after DOUBLE DEFAULT 0,
    description VARCHAR(255) DEFAULT '',
    reference VARCHAR(255) DEFAULT '',
    order_id VARCHAR(255) DEFAULT '',
    status ENUM('pending', 'completed', 'failed') DEFAULT 'completed',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    INDEX idx_tx_user (user_id)
);

-- 7. Settings Table
CREATE TABLE IF NOT EXISTS Settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(255) UNIQUE NOT NULL,
    `value` JSON, -- Store Mixed types as JSON
    label VARCHAR(255) DEFAULT '',
    `group` VARCHAR(255) DEFAULT 'general',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 8. PromoCodes Table
CREATE TABLE IF NOT EXISTS PromoCodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    amount DOUBLE NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    usage_limit INT DEFAULT 1,
    used_count INT DEFAULT 0,
    used_by JSON, -- Array of User IDs
    expired_at DATETIME,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 9. AccountCategories Table
CREATE TABLE IF NOT EXISTS AccountCategories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255) DEFAULT '🗂️',
    price DOUBLE NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    sort_order INT DEFAULT 0,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
);

-- 10. ReadymadeAccounts Table
CREATE TABLE IF NOT EXISTS ReadymadeAccounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id VARCHAR(255) NOT NULL,
    credentials TEXT NOT NULL,
    notes TEXT,
    status ENUM('available', 'sold', 'reserved') DEFAULT 'available',
    sold_to VARCHAR(255) DEFAULT NULL,
    sold_at DATETIME DEFAULT NULL,
    price_at_sale DOUBLE DEFAULT NULL,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    INDEX idx_acc_cat (category_id),
    INDEX idx_acc_status (status)
);
