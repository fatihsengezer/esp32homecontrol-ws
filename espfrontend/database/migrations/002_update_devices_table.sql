-- ==================== UPDATE DEVICES TABLE ====================
-- Migration: 002_update_devices_table.sql
-- Tarih: 2025-01-27
-- Açıklama: Devices tablosuna konfigürasyon yönetimi için gerekli kolonları ekle

-- Devices tablosuna yeni kolonlar ekle
ALTER TABLE devices ADD COLUMN last_seen DATETIME NULL;
ALTER TABLE devices ADD COLUMN current_token VARCHAR(512) NULL;
ALTER TABLE devices ADD COLUMN token_expires DATETIME NULL;
ALTER TABLE devices ADD COLUMN firmware_version VARCHAR(50) NULL;
ALTER TABLE devices ADD COLUMN capabilities TEXT NULL; -- JSON array of capabilities

-- Mevcut devices tablosundaki is_online kolonunu güncelle (eğer yoksa ekle)
-- SQLite'da ALTER COLUMN yok, bu yüzden yeni tablo oluşturup veriyi taşıyalım

-- Yeni devices tablosu oluştur
CREATE TABLE devices_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(50) UNIQUE NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(20) DEFAULT 'esp32',
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    firmware_version VARCHAR(50),
    hardware_version VARCHAR(20),
    is_online BOOLEAN DEFAULT 0,
    last_seen DATETIME NULL,
    current_token VARCHAR(512) NULL,
    token_expires DATETIME NULL,
    capabilities TEXT NULL,
    location VARCHAR(100),
    description TEXT,
    owner_id INTEGER,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Mevcut veriyi yeni tabloya kopyala
INSERT INTO devices_new (
    id, device_id, device_name, device_type, ip_address, mac_address, 
    firmware_version, hardware_version, is_online, last_seen, current_token, 
    token_expires, capabilities, location, description, owner_id, is_active, 
    created_at, updated_at
)
SELECT 
    id, device_id, device_name, 'esp32', ip_address, mac_address,
    NULL, NULL, 0, NULL, NULL, NULL, NULL, location, description, 
    owner_id, is_active, created_at, updated_at
FROM devices;

-- Eski tabloyu sil ve yenisini yeniden adlandır
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;

-- Index'leri yeniden oluştur
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_owner_id ON devices(owner_id);
CREATE INDEX IF NOT EXISTS idx_devices_is_online ON devices(is_online);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);



