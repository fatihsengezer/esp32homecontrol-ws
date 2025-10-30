-- ==================== DEVICE CONFIG MANAGEMENT TABLES ====================
-- Migration: 001_add_device_config_tables.sql
-- Tarih: 2025-01-27
-- Açıklama: ESP32 cihazları için dinamik konfigürasyon yönetimi tabloları

-- Cihaz konfigürasyonları tablosu (en güncel config)
CREATE TABLE IF NOT EXISTS device_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(128) NOT NULL,
    config_json TEXT NOT NULL, -- JSON formatında config
    version INTEGER DEFAULT 1,
    applied BOOLEAN DEFAULT 0, -- Cihaz tarafından uygulandı mı
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Konfigürasyon kuyruğu (cihaz offline iken)
CREATE TABLE IF NOT EXISTS config_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(128) NOT NULL,
    payload TEXT NOT NULL, -- JSON formatında gönderilecek mesaj
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    status VARCHAR(32) DEFAULT 'pending', -- pending, sent, failed, applied
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_try DATETIME NULL,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- WOL profilleri tablosu
CREATE TABLE IF NOT EXISTS wol_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(128) NOT NULL,
    name VARCHAR(128) NOT NULL,
    mac VARCHAR(17) NOT NULL,
    broadcast_ip VARCHAR(45) NOT NULL,
    port INTEGER DEFAULT 9,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Cihaz token'ları tablosu (kimlik doğrulama için)
CREATE TABLE IF NOT EXISTS device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(128) NOT NULL,
    token VARCHAR(512) NOT NULL,
    token_type VARCHAR(32) DEFAULT 'persistent', -- persistent, pairing, short_lived
    expires_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME NULL,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Konfigürasyon geçmişi tablosu (audit log)
CREATE TABLE IF NOT EXISTS config_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(128) NOT NULL,
    user_id INTEGER NULL,
    action VARCHAR(50) NOT NULL, -- sent, applied, failed, queued
    config_json TEXT NULL,
    error_message TEXT NULL,
    ip_address VARCHAR(45) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_device_configs_device_id ON device_configs(device_id);
CREATE INDEX IF NOT EXISTS idx_device_configs_applied ON device_configs(applied);
CREATE INDEX IF NOT EXISTS idx_config_queue_device_id ON config_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_config_queue_status ON config_queue(status);
CREATE INDEX IF NOT EXISTS idx_config_queue_created_at ON config_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_wol_profiles_device_id ON wol_profiles(device_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device_id ON device_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_config_history_device_id ON config_history(device_id);
CREATE INDEX IF NOT EXISTS idx_config_history_created_at ON config_history(created_at);

-- ==================== TRIGGERS ====================
-- device_configs güncelleme trigger'ı
CREATE TRIGGER IF NOT EXISTS update_device_configs_updated_at 
    AFTER UPDATE ON device_configs
    FOR EACH ROW
    BEGIN
        UPDATE device_configs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
