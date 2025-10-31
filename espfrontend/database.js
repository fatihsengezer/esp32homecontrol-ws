const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Data klasörünü oluştur
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Veritabanı dosyası yolu
const dbPath = path.join(dataDir, 'esp32home.db');
console.log('📁 Database file:', dbPath);

// Veritabanı bağlantısı
const db = new Database(dbPath);

// Veritabanını başlat
function initDatabase() {
    try {
        console.log('📊 Veritabanı başlatılıyor...');
        
        // Kullanıcılar tablosu
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT,
                email TEXT,
                role TEXT DEFAULT 'user',
                websocket_port INTEGER UNIQUE,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table ready');
        
        // Mevcut tabloya websocket_port kolonu ekle (eğer yoksa)
        try {
            db.exec(`ALTER TABLE users ADD COLUMN websocket_port INTEGER`);
            console.log('✅ WebSocket port column added');
        } catch (err) {
            if (!err.message.includes('duplicate column name')) {
                console.error('❌ WebSocket port column error:', err);
            }
        }
        
        // UNIQUE constraint'i ayrı olarak ekle
        try {
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_websocket_port ON users(websocket_port) WHERE websocket_port IS NOT NULL`);
            console.log('✅ WebSocket port unique index added');
        } catch (err) {
            console.error('❌ WebSocket port unique index error:', err);
        }

        // Session'lar tablosu
        db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                expires_at DATETIME NOT NULL,
                remember_me BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);
        console.log('✅ Sessions table ready');

        // Güvenlik anahtarları tablosu
        db.exec(`
            CREATE TABLE IF NOT EXISTS security_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_value TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);
        console.log('✅ Security keys table ready');

        // Cihazlar tablosu
        db.exec(`
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT UNIQUE NOT NULL,
                device_name TEXT NOT NULL,
                ip_address TEXT,
                mac_address TEXT,
                location TEXT,
                description TEXT,
                owner_id INTEGER,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users (id)
            )
        `);
        console.log('✅ Devices table ready');
        
        // Kullanıcı düzenleri tablosu
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                layout_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);
        console.log('✅ User layouts table ready');
        
        // Migration dosyasını çalıştır (device config tabloları için)
        try {
            const migrationPath = path.join(__dirname, 'database', 'migrations', '001_add_device_config_tables.sql');
            if (fs.existsSync(migrationPath)) {
                const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
                db.exec(migrationSQL);
                console.log('✅ Migration 001 executed');
            }
        } catch (err) {
            console.error('❌ Migration error:', err);
        }
        
        // Varsayılan kullanıcıları ekle
        insertDefaultUsers();
        console.log('✅ Veritabanı başlatma tamamlandı');
        
        return Promise.resolve();
    } catch (err) {
        console.error('❌ Database init error:', err);
        return Promise.reject(err);
    }
}

// Varsayılan kullanıcıları ekle
function insertDefaultUsers() {
    try {
        // Admin kullanıcısı
        db.exec(`
            INSERT OR IGNORE INTO users (username, password, name, role) 
            VALUES ('admin', 'admin123', 'Administrator', 'admin')
        `);
        console.log('✅ Default admin user ready');

        // Erhan kullanıcısı
        db.exec(`
            INSERT OR IGNORE INTO users (username, password, name, role) 
            VALUES ('erhan', 'erhan123', 'Erhan', 'user')
        `);
        console.log('✅ Default erhan user ready');
    } catch (err) {
        console.error('❌ Default users error:', err);
    }
}

// Kullanıcı işlemleri
const userDB = {
    authenticate: (username, password) => {
        try {
            const row = db.prepare('SELECT * FROM users WHERE username = ? AND password = ? AND is_active = 1').get(username, password);
            return Promise.resolve(row);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getUserById: (id) => {
        try {
            const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
            return Promise.resolve(row);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getUserByUsername: (username) => {
        try {
            const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            return Promise.resolve(row);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getAllUsers: () => {
        try {
            const rows = db.prepare('SELECT id, username, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC').all();
            return Promise.resolve(rows);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    createUser: (userData) => {
        try {
            const { username, password, name, email, role } = userData;
            const stmt = db.prepare('INSERT INTO users (username, password, name, email, role) VALUES (?, ?, ?, ?, ?)');
            const result = stmt.run(username, password, name, email, role || 'user');
            return Promise.resolve({ id: result.lastInsertRowid, ...userData });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    updateUser: (id, userData) => {
        try {
            // Sadece tanımlı alanları güncelle
            const updates = [];
            const values = [];
            
            if (userData.username !== undefined) {
                updates.push('username = ?');
                values.push(userData.username);
            }
            if (userData.name !== undefined) {
                updates.push('name = ?');
                values.push(userData.name);
            }
            if (userData.email !== undefined) {
                updates.push('email = ?');
                values.push(userData.email);
            }
            if (userData.role !== undefined) {
                updates.push('role = ?');
                values.push(userData.role);
            }
            if (userData.is_active !== undefined) {
                updates.push('is_active = ?');
                // SQLite boolean desteği yok, 0/1 kullan
                values.push(userData.is_active ? 1 : 0);
            }
            if (userData.websocket_port !== undefined) {
                updates.push('websocket_port = ?');
                values.push(userData.websocket_port);
            }
            if (userData.password !== undefined) {
                updates.push('password = ?');
                values.push(userData.password);
                console.log('🔐 Şifre güncelleniyor (database.js)');
            }
            
            // Eğer güncellenecek alan yoksa, sadece updated_at güncelle
            if (updates.length === 0) {
                updates.push('updated_at = CURRENT_TIMESTAMP');
            } else {
                updates.push('updated_at = CURRENT_TIMESTAMP');
            }
            
            // WHERE clause için id ekle
            values.push(id);
            
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            console.log('📝 UpdateUser query:', query);
            console.log('📝 UpdateUser values:', values.map((v, i) => i === values.length - 1 ? v : (v === userData.password ? '***' : v)));
            
            const stmt = db.prepare(query);
            stmt.run(...values);
            console.log('✅ User updated successfully');
            return Promise.resolve({ id, ...userData });
        } catch (err) {
            console.error('❌ UpdateUser exception:', err);
            return Promise.reject(err);
        }
    },
    deleteUser: (id) => {
        try {
            const stmt = db.prepare('DELETE FROM users WHERE id = ?');
            const result = stmt.run(id);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Session işlemleri
const sessionDB = {
    createSession: (sessionId, userId, expiresAt, rememberMe = false) => {
        try {
            console.log('🔧 Database: Inserting session:', { sessionId: sessionId.substring(0, 8) + '...', userId, expiresAt, rememberMe });
            const expiresTimestamp = new Date(expiresAt).getTime();
            console.log('🔧 Database: Converted expiresAt to timestamp:', expiresTimestamp);
            // SQLite boolean desteği yok, 0/1 kullan
            const rememberMeInt = rememberMe ? 1 : 0;
            
            const stmt = db.prepare('INSERT INTO sessions (session_id, user_id, expires_at, remember_me) VALUES (?, ?, ?, ?)');
            const result = stmt.run(sessionId, userId, expiresTimestamp, rememberMeInt);
            
            console.log('✅ Database: Session inserted successfully, ID:', result.lastInsertRowid);
            console.log('🔧 Database: Session data:', { sessionId, userId, expiresAt, rememberMe });
            
            // Verification
            try {
                const verifyRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
                console.log('🔍 Database: Session verification result:', verifyRow);
            } catch (err2) {
                console.error('❌ Database: Session verification error:', err2);
            }
            
            return Promise.resolve({ sessionId, userId, expiresAt, rememberMe });
        } catch (err) {
            console.error('❌ Database: Session insert error:', err);
            return Promise.reject(err);
        }
    },
    getSession: (sessionId) => {
        try {
            console.log('🔍 Database: Getting session:', sessionId ? sessionId.substring(0, 8) + '...' : 'undefined');
            const row = db.prepare('SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?').get(sessionId, new Date().getTime());
            console.log('🔍 Database: Session query result:', row);
            return Promise.resolve(row);
        } catch (err) {
            console.error('❌ Database: Session get error:', err);
            return Promise.reject(err);
        }
    },
    deleteSession: (sessionId) => {
        try {
            const stmt = db.prepare('DELETE FROM sessions WHERE session_id = ?');
            const result = stmt.run(sessionId);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    cleanExpiredSessions: () => {
        try {
            const now = Date.now();
            const stmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
            const result = stmt.run(now);
            console.log(`🧹 ${result.changes} süresi dolmuş session temizlendi (<= ${now})`);
            return Promise.resolve({ cleaned: result.changes });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Güvenlik anahtarı işlemleri
const securityKeyDB = {
    createKey: (userId, keyValue, expiresAt) => {
        try {
            const expiresTimestamp = new Date(expiresAt).getTime();
            console.log('🔐 DB: Inserting security key', { userId, key: keyValue.substring(0,8)+'...', expiresAt: expiresTimestamp });
            
            const stmt = db.prepare('INSERT INTO security_keys (user_id, key_value, expires_at) VALUES (?, ?, ?)');
            stmt.run(userId, keyValue, expiresTimestamp);
            return Promise.resolve({ userId, keyValue, expiresAt: expiresTimestamp });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    validateKey: (userId, keyValue) => {
        try {
            const now = Date.now();
            const row = db.prepare(`
                SELECT * FROM security_keys 
                WHERE user_id = ? AND key_value = ? AND expires_at > ?
                ORDER BY created_at DESC LIMIT 1
            `).get(userId, keyValue, now);
            
            console.log('🔐 DB: validateKey result:', !!row);
            return Promise.resolve(row);
        } catch (err) {
            console.error('🔐 DB: validateKey error:', err);
            return Promise.reject(err);
        }
    },
    clearUserKeys: (userId) => {
        try {
            const stmt = db.prepare('DELETE FROM security_keys WHERE user_id = ?');
            const result = stmt.run(userId);
            return Promise.resolve({ cleared: result.changes });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Cihaz işlemleri
const deviceDB = {
    getAllDevices: () => {
        try {
            const rows = db.prepare(`
                SELECT d.*, u.username as owner_name 
                FROM devices d 
                LEFT JOIN users u ON d.owner_id = u.id 
                ORDER BY d.created_at DESC
            `).all();
            return Promise.resolve(rows);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getDevicesByOwner: (ownerId) => {
        try {
            const rows = db.prepare(`
                SELECT d.*, u.username as owner_name 
                FROM devices d 
                LEFT JOIN users u ON d.owner_id = u.id 
                WHERE d.owner_id = ? OR d.owner_id IS NULL
                ORDER BY d.created_at DESC
            `).all(ownerId);
            return Promise.resolve(rows);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    createDevice: (deviceData) => {
        try {
            const { device_id, device_name, ip_address, mac_address, location, description, owner_id } = deviceData;
            const stmt = db.prepare('INSERT INTO devices (device_id, device_name, ip_address, mac_address, location, description, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
            const result = stmt.run(device_id, device_name, ip_address, mac_address, location, description, owner_id || null);
            return Promise.resolve({ id: result.lastInsertRowid, ...deviceData });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getByDeviceId: (deviceId) => {
        try {
            const row = db.prepare('SELECT d.*, u.username as owner_name FROM devices d LEFT JOIN users u ON d.owner_id = u.id WHERE d.device_id = ?').get(deviceId);
            return Promise.resolve(row || null);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    updateDevice: (id, deviceData) => {
        try {
            const { device_name, ip_address, mac_address, location, description, owner_id, is_active } = deviceData;
            // SQLite boolean desteği yok, 0/1 kullan
            const isActiveInt = is_active !== undefined ? (is_active ? 1 : 0) : undefined;
            const stmt = db.prepare('UPDATE devices SET device_name = ?, ip_address = ?, mac_address = ?, location = ?, description = ?, owner_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            stmt.run(device_name, ip_address, mac_address, location, description, owner_id, isActiveInt, id);
            return Promise.resolve({ id, ...deviceData });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    updateByDeviceId: (deviceId, deviceData) => {
        try {
            // Sadece tanımlı alanları güncelle
            const updates = [];
            const values = [];
            
            if (deviceData.device_name !== undefined) {
                updates.push('device_name = ?');
                values.push(deviceData.device_name);
            }
            if (deviceData.ip_address !== undefined) {
                updates.push('ip_address = ?');
                values.push(deviceData.ip_address);
            }
            if (deviceData.mac_address !== undefined) {
                updates.push('mac_address = ?');
                values.push(deviceData.mac_address);
            }
            if (deviceData.location !== undefined) {
                updates.push('location = ?');
                values.push(deviceData.location);
            }
            if (deviceData.description !== undefined) {
                updates.push('description = ?');
                values.push(deviceData.description);
            }
            if (deviceData.owner_id !== undefined) {
                updates.push('owner_id = ?');
                values.push(deviceData.owner_id);
            }
            if (deviceData.is_active !== undefined) {
                updates.push('is_active = ?');
                // SQLite boolean desteği yok, 0/1 kullan
                values.push(deviceData.is_active ? 1 : 0);
            }
            
            // Eğer güncellenecek alan yoksa, sadece updated_at güncelle
            if (updates.length === 0) {
                updates.push('updated_at = CURRENT_TIMESTAMP');
            } else {
                updates.push('updated_at = CURRENT_TIMESTAMP');
            }
            
            // WHERE clause için deviceId ekle
            values.push(deviceId);
            
            const query = `UPDATE devices SET ${updates.join(', ')} WHERE device_id = ?`;
            
            const stmt = db.prepare(query);
            stmt.run(...values);
            return Promise.resolve({ device_id: deviceId, ...deviceData });
        } catch (err) {
            console.error('❌ UpdateByDeviceId exception:', err);
            return Promise.reject(err);
        }
    },
    deleteDevice: (id) => {
        try {
            const stmt = db.prepare('DELETE FROM devices WHERE id = ?');
            const result = stmt.run(id);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    deleteByDeviceId: (deviceId) => {
        try {
            const stmt = db.prepare('DELETE FROM devices WHERE device_id = ?');
            const result = stmt.run(deviceId);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Kullanıcı düzenleri (layout)
const layoutDB = {
    getForUser: (userId) => {
        try {
            const row = db.prepare('SELECT layout_json FROM user_layouts WHERE user_id = ?').get(userId);
            return Promise.resolve(row ? row.layout_json : null);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    setForUser: (userId, layoutJson) => {
        try {
            const stmt = db.prepare('INSERT INTO user_layouts (user_id, layout_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = CURRENT_TIMESTAMP');
            stmt.run(userId, layoutJson);
            return Promise.resolve({ updated: true });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    getAll: () => {
        try {
            const rows = db.prepare(`
                SELECT ul.user_id, u.username, ul.layout_json, ul.updated_at
                FROM user_layouts ul
                JOIN users u ON u.id = ul.user_id
                ORDER BY ul.updated_at DESC
            `).all();
            return Promise.resolve(rows || []);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    deleteForUser: (userId) => {
        try {
            const stmt = db.prepare('DELETE FROM user_layouts WHERE user_id = ?');
            const result = stmt.run(userId);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Device config işlemleri
const deviceConfigDB = {
    // Cihaz konfigürasyonu kaydet
    saveConfig: (deviceId, configJson, version = 1) => {
        try {
            const stmt = db.prepare('INSERT INTO device_configs (device_id, config_json, version, applied) VALUES (?, ?, ?, ?)');
            const result = stmt.run(deviceId, JSON.stringify(configJson), version, false);
            return Promise.resolve({ id: result.lastInsertRowid, deviceId, configJson, version });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihaz konfigürasyonunu güncelle (applied olarak işaretle)
    markConfigApplied: (deviceId, requestId = null) => {
        try {
            let query = 'UPDATE device_configs SET applied = 1, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?';
            let params = [deviceId];
            
            if (requestId) {
                // Eğer request_id varsa, config_json içinde arama yap
                query += ' AND config_json LIKE ?';
                params.push(`%"request_id":"${requestId}"%`);
            }
            
            const stmt = db.prepare(query);
            const result = stmt.run(...params);
            return Promise.resolve({ updated: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihazın son konfigürasyonunu al
    getLastConfig: (deviceId) => {
        try {
            const row = db.prepare('SELECT * FROM device_configs WHERE device_id = ? ORDER BY created_at DESC LIMIT 1').get(deviceId);
            return Promise.resolve(row ? { ...row, config_json: JSON.parse(row.config_json) } : null);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihazın uygulanmamış konfigürasyonlarını al
    getPendingConfigs: (deviceId) => {
        try {
            const rows = db.prepare('SELECT * FROM device_configs WHERE device_id = ? AND applied = 0 ORDER BY created_at DESC').all(deviceId);
            return Promise.resolve(rows.map(row => ({ ...row, config_json: JSON.parse(row.config_json) })));
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Config queue işlemleri
const configQueueDB = {
    // Kuyruğa mesaj ekle
    addToQueue: (deviceId, payload, maxRetries = 5) => {
        try {
            const stmt = db.prepare('INSERT INTO config_queue (device_id, payload, max_retries, status) VALUES (?, ?, ?, ?)');
            const result = stmt.run(deviceId, JSON.stringify(payload), maxRetries, 'pending');
            return Promise.resolve({ id: result.lastInsertRowid, deviceId, payload });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Bekleyen mesajları al
    getPendingMessages: () => {
        try {
            const rows = db.prepare("SELECT * FROM config_queue WHERE status = 'pending' ORDER BY created_at ASC").all();
            return Promise.resolve(rows.map(row => ({ ...row, payload: JSON.parse(row.payload) })));
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Mesaj durumunu güncelle
    updateMessageStatus: (id, status, errorMessage = null) => {
        try {
            const query = errorMessage 
                ? 'UPDATE config_queue SET status = ?, last_try = CURRENT_TIMESTAMP, retries = retries + 1 WHERE id = ?'
                : 'UPDATE config_queue SET status = ?, last_try = CURRENT_TIMESTAMP WHERE id = ?';
            const params = errorMessage ? [status, id] : [status, id];
            
            const stmt = db.prepare(query);
            const result = stmt.run(...params);
            return Promise.resolve({ updated: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Başarısız mesajları temizle
    cleanupFailedMessages: (maxAge = 24 * 60 * 60 * 1000) => { // 24 saat
        try {
            const cutoffTime = new Date(Date.now() - maxAge).getTime();
            const stmt = db.prepare("DELETE FROM config_queue WHERE status = 'failed' AND created_at < ?");
            const result = stmt.run(cutoffTime);
            return Promise.resolve({ cleaned: result.changes });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// WOL profiles işlemleri
const wolProfilesDB = {
    // WOL profili ekle
    addProfile: (deviceId, name, mac, broadcastIp, port = 9) => {
        try {
            const stmt = db.prepare('INSERT INTO wol_profiles (device_id, name, mac, broadcast_ip, port) VALUES (?, ?, ?, ?, ?)');
            const result = stmt.run(deviceId, name, mac, broadcastIp, port);
            return Promise.resolve({ id: result.lastInsertRowid, deviceId, name, mac, broadcastIp, port });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihazın WOL profillerini al
    getProfilesByDevice: (deviceId) => {
        try {
            const rows = db.prepare('SELECT * FROM wol_profiles WHERE device_id = ? ORDER BY created_at ASC').all(deviceId);
            return Promise.resolve(rows);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // WOL profili sil
    deleteProfile: (id) => {
        try {
            const stmt = db.prepare('DELETE FROM wol_profiles WHERE id = ?');
            const result = stmt.run(id);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // WOL profili güncelle
    updateProfile: (id, profileData) => {
        try {
            const updates = [];
            const values = [];
            
            if (profileData.name !== undefined) {
                updates.push('name = ?');
                values.push(profileData.name);
            }
            if (profileData.mac !== undefined) {
                updates.push('mac = ?');
                values.push(profileData.mac);
            }
            if (profileData.broadcast_ip !== undefined) {
                updates.push('broadcast_ip = ?');
                values.push(profileData.broadcast_ip);
            }
            if (profileData.port !== undefined) {
                updates.push('port = ?');
                values.push(profileData.port);
            }
            
            if (updates.length === 0) {
                return Promise.resolve({ id, ...profileData });
            }
            
            // updated_at ekle (varsa, yoksa hata olmaz - SQLite esnek)
            updates.push('updated_at = CURRENT_TIMESTAMP');
            values.push(id);
            
            const query = `UPDATE wol_profiles SET ${updates.join(', ')} WHERE id = ?`;
            
            const stmt = db.prepare(query);
            const result = stmt.run(...values);
            
            if (result.changes === 0) {
                console.warn('⚠️ WOL profili güncellenmedi (id bulunamadı):', id);
            }
            
            return Promise.resolve({ id, ...profileData, updated: result.changes > 0 });
        } catch (err) {
            console.error('❌ WOL profili güncelleme hatası:', err);
            return Promise.reject(err);
        }
    }
};

// Device tokens işlemleri
const deviceTokensDB = {
    // Token oluştur
    createToken: (deviceId, token, tokenType = 'persistent', expiresAt = null) => {
        try {
            const stmt = db.prepare('INSERT INTO device_tokens (device_id, token, token_type, expires_at) VALUES (?, ?, ?, ?)');
            const result = stmt.run(deviceId, token, tokenType, expiresAt);
            return Promise.resolve({ id: result.lastInsertRowid, deviceId, token, tokenType, expiresAt });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Token doğrula
    validateToken: (deviceId, token) => {
        try {
            const now = new Date().getTime();
            const row = db.prepare('SELECT * FROM device_tokens WHERE device_id = ? AND token = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1').get(deviceId, token, now);
            
            if (row) {
                // Token kullanım zamanını güncelle
                try {
                    const updateStmt = db.prepare('UPDATE device_tokens SET last_used = CURRENT_TIMESTAMP WHERE id = ?');
                    updateStmt.run(row.id);
                } catch (updateErr) {
                    // Ignore update error
                }
            }
            
            return Promise.resolve(row);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihazın aktif token'ını al
    getActiveToken: (deviceId) => {
        try {
            const now = new Date().getTime();
            const row = db.prepare('SELECT * FROM device_tokens WHERE device_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1').get(deviceId, now);
            return Promise.resolve(row);
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Token'ı iptal et
    revokeToken: (deviceId, token) => {
        try {
            const stmt = db.prepare('DELETE FROM device_tokens WHERE device_id = ? AND token = ?');
            const result = stmt.run(deviceId, token);
            return Promise.resolve({ deleted: result.changes > 0 });
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Config history işlemleri
const configHistoryDB = {
    // Geçmiş kaydı ekle
    addHistory: (deviceId, userId, action, configJson = null, errorMessage = null, ipAddress = null) => {
        try {
            const stmt = db.prepare('INSERT INTO config_history (device_id, user_id, action, config_json, error_message, ip_address) VALUES (?, ?, ?, ?, ?, ?)');
            const result = stmt.run(deviceId, userId, action, configJson ? JSON.stringify(configJson) : null, errorMessage, ipAddress);
            return Promise.resolve({ id: result.lastInsertRowid, deviceId, userId, action });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    
    // Cihazın geçmişini al
    getHistoryByDevice: (deviceId, limit = 50) => {
        try {
            const rows = db.prepare('SELECT ch.*, u.username FROM config_history ch LEFT JOIN users u ON ch.user_id = u.id WHERE ch.device_id = ? ORDER BY ch.created_at DESC LIMIT ?').all(deviceId, limit);
            return Promise.resolve(rows.map(row => ({
                ...row,
                config_json: row.config_json ? JSON.parse(row.config_json) : null
            })));
        } catch (err) {
            return Promise.reject(err);
        }
    }
};

// Kullanılabilir port bulma fonksiyonu
function findAvailablePort() {
    try {
        const rows = db.prepare('SELECT websocket_port FROM users WHERE websocket_port IS NOT NULL').all();
        const usedPortNumbers = rows.map(row => row.websocket_port);
        const allowedPorts = [5130, 5131, 5136];
        
        // İzin verilen portlardan boş olanı bul
        for (const port of allowedPorts) {
            if (!usedPortNumbers.includes(port)) {
                return Promise.resolve(port);
            }
        }
        
        return Promise.resolve(null); // Boş port bulunamadı
    } catch (err) {
        return Promise.reject(err);
    }
}

module.exports = {
    initDatabase,
    userDB,
    deviceDB,
    sessionDB,
    securityKeyDB,
    layoutDB,
    deviceConfigDB,
    configQueueDB,
    wolProfilesDB,
    deviceTokensDB,
    configHistoryDB,
    portDB: {
        // Kullanılabilir port aralığı - sadece belirli portlar
        ALLOWED_PORTS: [5130, 5131, 5136],
        
        // Kullanıcıya port ata
        assignPort: (userId) => {
            try {
                // Mevcut kullanıcının portunu kontrol et
                const row = db.prepare('SELECT websocket_port FROM users WHERE id = ?').get(userId);
                
                if (row && row.websocket_port) {
                    // Kullanıcının zaten portu var
                    return Promise.resolve(row.websocket_port);
                }
                
                // Boş port bul
                return findAvailablePort().then(port => {
                    if (!port) {
                        return Promise.reject(new Error('Kullanılabilir port bulunamadı (5130, 5131, 5136)'));
                    }
                    
                    // Portu kullanıcıya ata
                    const stmt = db.prepare('UPDATE users SET websocket_port = ? WHERE id = ?');
                    stmt.run(port, userId);
                    console.log(`✅ Port ${port} kullanıcı ${userId} için atandı`);
                    return Promise.resolve(port);
                });
            } catch (err) {
                return Promise.reject(err);
            }
        },
        
        // Kullanıcının portunu al
        getUserPort: (userId) => {
            try {
                const row = db.prepare('SELECT websocket_port FROM users WHERE id = ?').get(userId);
                return Promise.resolve(row ? row.websocket_port : null);
            } catch (err) {
                return Promise.reject(err);
            }
        },
        
        // Portu serbest bırak
        releasePort: (port) => {
            try {
                const stmt = db.prepare('UPDATE users SET websocket_port = NULL WHERE websocket_port = ?');
                stmt.run(port);
                console.log(`✅ Port ${port} serbest bırakıldı`);
                return Promise.resolve();
            } catch (err) {
                return Promise.reject(err);
            }
        },
        
        // Kullanılan portları listele
        getUsedPorts: () => {
            try {
                const rows = db.prepare('SELECT id, username, websocket_port FROM users WHERE websocket_port IS NOT NULL').all();
                return Promise.resolve(rows);
            } catch (err) {
                return Promise.reject(err);
            }
        }
    },
    db
};
