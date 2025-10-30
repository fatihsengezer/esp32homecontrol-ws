-- ==================== ESP32 HOME AUTOMATION DATABASE SCHEMA ====================

-- Kullanıcılar tablosu
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'user', 'guest') DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    profile_picture VARCHAR(255),
    phone VARCHAR(20),
    timezone VARCHAR(50) DEFAULT 'Europe/Istanbul'
);

-- Session'lar tablosu
CREATE TABLE sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ESP32 Cihazları tablosu
CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id VARCHAR(50) UNIQUE NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    device_type ENUM('esp32', 'esp8266', 'arduino') DEFAULT 'esp32',
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    firmware_version VARCHAR(20),
    hardware_version VARCHAR(20),
    is_online BOOLEAN DEFAULT FALSE,
    last_seen DATETIME,
    location VARCHAR(100),
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Röle durumları tablosu
CREATE TABLE relay_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    relay_index INTEGER NOT NULL,
    relay_name VARCHAR(50),
    is_on BOOLEAN DEFAULT FALSE,
    last_changed DATETIME DEFAULT CURRENT_TIMESTAMP,
    changed_by INTEGER,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- WOL cihazları tablosu
CREATE TABLE wol_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    mac_address VARCHAR(17) NOT NULL,
    status ENUM('offline', 'booting', 'running', 'failed') DEFAULT 'offline',
    last_ping DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Sistem logları tablosu
CREATE TABLE system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL') DEFAULT 'INFO',
    category VARCHAR(50),
    message TEXT NOT NULL,
    user_id INTEGER,
    device_id INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

-- WebSocket bağlantıları tablosu
CREATE TABLE websocket_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INTEGER,
    device_id INTEGER,
    connection_type ENUM('user', 'device') NOT NULL,
    ip_address VARCHAR(45),
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    disconnected_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

-- Ziyaretçi istatistikleri tablosu
CREATE TABLE visitor_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    unique_visitors INTEGER DEFAULT 0,
    page_views INTEGER DEFAULT 0,
    avg_session_duration INTEGER DEFAULT 0, -- saniye
    bounce_rate DECIMAL(5,2) DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sistem ayarları tablosu
CREATE TABLE system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Backup geçmişi tablosu
CREATE TABLE backup_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_name VARCHAR(100) NOT NULL,
    backup_type ENUM('full', 'incremental', 'settings') NOT NULL,
    file_path VARCHAR(255),
    file_size INTEGER,
    status ENUM('success', 'failed', 'in_progress') DEFAULT 'in_progress',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Güvenlik olayları tablosu
CREATE TABLE security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type ENUM('login_failed', 'login_success', 'logout', 'unauthorized_access', 'suspicious_activity') NOT NULL,
    user_id INTEGER,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    details TEXT,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Zamanlanmış görevler tablosu
CREATE TABLE scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name VARCHAR(100) NOT NULL,
    task_type ENUM('relay', 'wol', 'system') NOT NULL,
    device_id INTEGER,
    target_id INTEGER, -- relay index veya wol device id
    action VARCHAR(50) NOT NULL, -- 'on', 'off', 'toggle', 'wake', 'shutdown'
    schedule_cron VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_run DATETIME,
    next_run DATETIME,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- API anahtarları tablosu
CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_name VARCHAR(100) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    permissions TEXT, -- JSON array of permissions
    last_used DATETIME,
    expires_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bildirimler tablosu
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'warning', 'error', 'success') DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==================== INDEXES ====================

-- Performance için indexler
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_devices_device_id ON devices(device_id);
CREATE INDEX idx_devices_owner_id ON devices(owner_id);
CREATE INDEX idx_relay_states_device_id ON relay_states(device_id);
CREATE INDEX idx_system_logs_created_at ON system_logs(created_at);
CREATE INDEX idx_system_logs_level ON system_logs(level);
CREATE INDEX idx_websocket_connections_user_id ON websocket_connections(user_id);
CREATE INDEX idx_websocket_connections_device_id ON websocket_connections(device_id);
CREATE INDEX idx_visitor_stats_date ON visitor_stats(date);
CREATE INDEX idx_security_events_created_at ON security_events(created_at);
CREATE INDEX idx_security_events_ip_address ON security_events(ip_address);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- ==================== TRIGGERS ====================

-- Users tablosu güncelleme trigger'ı
CREATE TRIGGER update_users_updated_at 
    AFTER UPDATE ON users
    FOR EACH ROW
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Devices tablosu güncelleme trigger'ı
CREATE TRIGGER update_devices_updated_at 
    AFTER UPDATE ON devices
    FOR EACH ROW
    BEGIN
        UPDATE devices SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- ==================== INITIAL DATA ====================

-- Varsayılan admin kullanıcısı
INSERT INTO users (username, password_hash, full_name, role, email) 
VALUES ('admin', '$2b$10$rQZ8K9vXvQZ8K9vXvQZ8K9vXvQZ8K9vXvQZ8K9vXvQZ8K9vXvQZ8K9vX', 'System Administrator', 'admin', 'admin@fatihdev.com');

-- Varsayılan sistem ayarları
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_public) VALUES
('site_name', 'FatihDev Home Automation', 'string', 'Site adı', TRUE),
('maintenance_mode', 'false', 'boolean', 'Bakım modu', FALSE),
('max_login_attempts', '5', 'number', 'Maksimum giriş denemesi', FALSE),
('session_timeout', '3600', 'number', 'Session timeout (saniye)', FALSE),
('backup_retention_days', '30', 'number', 'Backup saklama süresi (gün)', FALSE),
('log_retention_days', '90', 'number', 'Log saklama süresi (gün)', FALSE),
('enable_registration', 'false', 'boolean', 'Kayıt olma özelliği', FALSE),
('enable_api', 'true', 'boolean', 'API erişimi', FALSE);




