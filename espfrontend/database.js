const sqlite3 = require('sqlite3').verbose();
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
const db = new sqlite3.Database(dbPath);

// Veritabanını başlat
function initDatabase() {
    return new Promise((resolve, reject) => {
        console.log('📊 Veritabanı başlatılıyor...');
        
        // Kullanıcılar tablosu
        db.run(`
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
        `, (err) => {
            if (err) {
                console.error('❌ Users table error:', err);
                reject(err);
            } else {
                console.log('✅ Users table ready');
                // Mevcut tabloya websocket_port kolonu ekle (eğer yoksa)
                db.run(`ALTER TABLE users ADD COLUMN websocket_port INTEGER`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('❌ WebSocket port column error:', err);
                    } else if (!err) {
                        console.log('✅ WebSocket port column added');
                        // UNIQUE constraint'i ayrı olarak ekle
                        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_websocket_port ON users(websocket_port) WHERE websocket_port IS NOT NULL`, (err2) => {
                            if (err2) {
                                console.error('❌ WebSocket port unique index error:', err2);
                            } else {
                                console.log('✅ WebSocket port unique index added');
                            }
                        });
                    }
                });
            }
        });

        // Session'lar tablosu
        db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                expires_at DATETIME NOT NULL,
                remember_me BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `, (err) => {
            if (err) {
                console.error('❌ Sessions table error:', err);
                reject(err);
            } else {
                console.log('✅ Sessions table ready');
            }
        });

        // Güvenlik anahtarları tablosu
        db.run(`
            CREATE TABLE IF NOT EXISTS security_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_value TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `, (err) => {
            if (err) {
                console.error('❌ Security keys table error:', err);
                reject(err);
            } else {
                console.log('✅ Security keys table ready');
            }
        });

        // Cihazlar tablosu
        db.run(`
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
        `, (err) => {
            if (err) {
                console.error('❌ Devices table error:', err);
                reject(err);
            } else {
                console.log('✅ Devices table ready');
                // Kullanıcı düzenleri tablosu
                db.run(`
                    CREATE TABLE IF NOT EXISTS user_layouts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        layout_json TEXT NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id),
                        FOREIGN KEY (user_id) REFERENCES users (id)
                    )
                `, (err2) => {
                    if (err2) {
                        console.error('❌ User layouts table error:', err2);
                        reject(err2);
                    } else {
                        console.log('✅ User layouts table ready');
                        // Varsayılan kullanıcıları ekle
                        insertDefaultUsers().then(() => {
                            console.log('✅ Veritabanı başlatma tamamlandı');
                            resolve();
                        }).catch(reject);
                    }
                });
            }
        });
    });
}

// Varsayılan kullanıcıları ekle
function insertDefaultUsers() {
    return new Promise((resolve, reject) => {
        // Admin kullanıcısı
        db.run(`
            INSERT OR IGNORE INTO users (username, password, name, role) 
            VALUES ('admin', 'admin123', 'Administrator', 'admin')
        `, (err) => {
            if (err) {
                console.error('❌ Admin user insert error:', err);
                reject(err);
            } else {
                console.log('✅ Default admin user ready');
            }
        });

        // Erhan kullanıcısı
        db.run(`
            INSERT OR IGNORE INTO users (username, password, name, role) 
            VALUES ('erhan', 'erhan123', 'Erhan', 'user')
        `, (err) => {
            if (err) {
                console.error('❌ Erhan user insert error:', err);
                reject(err);
            } else {
                console.log('✅ Default erhan user ready');
                resolve();
            }
        });
    });
}

// Kullanıcı işlemleri
const userDB = {
    authenticate: (username, password) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM users WHERE username = ? AND password = ? AND is_active = 1',
                [username, password],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },
    getUserById: (id) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM users WHERE id = ?',
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },
    getUserByUsername: (username) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM users WHERE username = ?',
                [username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },
    getAllUsers: () => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT id, username, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    },
    createUser: (userData) => {
        return new Promise((resolve, reject) => {
            const { username, password, name, email, role } = userData;
            db.run(
                'INSERT INTO users (username, password, name, email, role) VALUES (?, ?, ?, ?, ?)',
                [username, password, name, email, role || 'user'],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...userData });
                }
            );
        });
    },
    updateUser: (id, userData) => {
        return new Promise((resolve, reject) => {
            const { name, email, role, is_active } = userData;
            db.run(
                'UPDATE users SET name = ?, email = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [name, email, role, is_active, id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id, ...userData });
                }
            );
        });
    },
    deleteUser: (id) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM users WHERE id = ?',
                [id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }
};

// Session işlemleri
const sessionDB = {
    createSession: (sessionId, userId, expiresAt, rememberMe = false) => {
        return new Promise((resolve, reject) => {
            console.log('🔧 Database: Inserting session:', { sessionId: sessionId.substring(0, 8) + '...', userId, expiresAt, rememberMe });
            const expiresTimestamp = new Date(expiresAt).getTime();
            console.log('🔧 Database: Converted expiresAt to timestamp:', expiresTimestamp);
            db.run(
                'INSERT INTO sessions (session_id, user_id, expires_at, remember_me) VALUES (?, ?, ?, ?)',
                [sessionId, userId, expiresTimestamp, rememberMe],
                function(err) {
                    if (err) {
                        console.error('❌ Database: Session insert error:', err);
                        reject(err);
                    } else {
                        console.log('✅ Database: Session inserted successfully, ID:', this.lastID);
                        console.log('🔧 Database: Session data:', { sessionId, userId, expiresAt, rememberMe });
                        db.get('SELECT * FROM sessions WHERE id = ?', [this.lastID], (err2, row) => {
                            if (err2) {
                                console.error('❌ Database: Session verification error:', err2);
                            } else {
                                console.log('🔍 Database: Session verification result:', row);
                            }
                        });
                        resolve({ sessionId, userId, expiresAt, rememberMe });
                    }
                }
            );
        });
    },
    getSession: (sessionId) => {
        return new Promise((resolve, reject) => {
            console.log('🔍 Database: Getting session:', sessionId ? sessionId.substring(0, 8) + '...' : 'undefined');
            db.get(`
                SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?
            `, [sessionId, new Date().getTime()], (err, row) => {
                if (err) {
                    console.error('❌ Database: Session get error:', err);
                    reject(err);
                } else {
                    console.log('🔍 Database: Session query result:', row);
                    resolve(row);
                }
            });
        });
    },
    deleteSession: (sessionId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM sessions WHERE session_id = ?',
                [sessionId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    },
    cleanExpiredSessions: () => {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            db.run(
                'DELETE FROM sessions WHERE expires_at <= ?',
                [now],
                function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`🧹 ${this.changes} süresi dolmuş session temizlendi (<= ${now})`);
                        resolve({ cleaned: this.changes });
                    }
                }
            );
        });
    }
};

// Güvenlik anahtarı işlemleri
const securityKeyDB = {
    createKey: (userId, keyValue, expiresAt) => {
        return new Promise((resolve, reject) => {
            const expiresTimestamp = new Date(expiresAt).getTime();
            console.log('🔐 DB: Inserting security key', { userId, key: keyValue.substring(0,8)+'...', expiresAt: expiresTimestamp });
            db.run(
                'INSERT INTO security_keys (user_id, key_value, expires_at) VALUES (?, ?, ?)',
                [userId, keyValue, expiresTimestamp],
                function(err) {
                    if (err) reject(err);
                    else resolve({ userId, keyValue, expiresAt: expiresTimestamp });
                }
            );
        });
    },
    validateKey: (userId, keyValue) => {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            db.get(`
                SELECT * FROM security_keys 
                WHERE user_id = ? AND key_value = ? AND expires_at > ?
                ORDER BY created_at DESC LIMIT 1
            `, [userId, keyValue, now], (err, row) => {
                if (err) {
                    console.error('🔐 DB: validateKey error:', err);
                    reject(err);
                } else {
                    console.log('🔐 DB: validateKey result:', !!row);
                    resolve(row);
                }
            });
        });
    },
    clearUserKeys: (userId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM security_keys WHERE user_id = ?',
                [userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ cleared: this.changes });
                }
            );
        });
    }
};

// Cihaz işlemleri
const deviceDB = {
    getAllDevices: () => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT d.*, u.username as owner_name 
                FROM devices d 
                LEFT JOIN users u ON d.owner_id = u.id 
                ORDER BY d.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    getDevicesByOwner: (ownerId) => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT d.*, u.username as owner_name 
                FROM devices d 
                LEFT JOIN users u ON d.owner_id = u.id 
                WHERE d.owner_id = ? OR d.owner_id IS NULL
                ORDER BY d.created_at DESC
            `, [ownerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    createDevice: (deviceData) => {
        return new Promise((resolve, reject) => {
            const { device_id, device_name, ip_address, mac_address, location, description, owner_id } = deviceData;
            db.run(
                'INSERT INTO devices (device_id, device_name, ip_address, mac_address, location, description, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [device_id, device_name, ip_address, mac_address, location, description, owner_id || null],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...deviceData });
                }
            );
        });
    },
    getByDeviceId: (deviceId) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT d.*, u.username as owner_name FROM devices d LEFT JOIN users u ON d.owner_id = u.id WHERE d.device_id = ?',
                [deviceId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    },
    updateDevice: (id, deviceData) => {
        return new Promise((resolve, reject) => {
            const { device_name, ip_address, mac_address, location, description, owner_id, is_active } = deviceData;
            db.run(
                'UPDATE devices SET device_name = ?, ip_address = ?, mac_address = ?, location = ?, description = ?, owner_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [device_name, ip_address, mac_address, location, description, owner_id, is_active, id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id, ...deviceData });
                }
            );
        });
    },
    updateByDeviceId: (deviceId, deviceData) => {
        return new Promise((resolve, reject) => {
            const { device_name, ip_address, mac_address, location, description, owner_id, is_active } = deviceData;
            db.run(
                'UPDATE devices SET device_name = ?, ip_address = ?, mac_address = ?, location = ?, description = ?, owner_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?',
                [device_name, ip_address, mac_address, location, description, owner_id, is_active, deviceId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ device_id: deviceId, ...deviceData });
                }
            );
        });
    },
    deleteDevice: (id) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM devices WHERE id = ?',
                [id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    },
    deleteByDeviceId: (deviceId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM devices WHERE device_id = ?',
                [deviceId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }
};

// Kullanıcı düzenleri (layout)
const layoutDB = {
    getForUser: (userId) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT layout_json FROM user_layouts WHERE user_id = ?',
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.layout_json : null);
                }
            );
        });
    },
    setForUser: (userId, layoutJson) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO user_layouts (user_id, layout_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = CURRENT_TIMESTAMP',
                [userId, layoutJson],
                function(err) {
                    if (err) reject(err);
                    else resolve({ updated: true });
                }
            );
        });
    },
    getAll: () => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT ul.user_id, u.username, ul.layout_json, ul.updated_at
                 FROM user_layouts ul
                 JOIN users u ON u.id = ul.user_id
                 ORDER BY ul.updated_at DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    },
    deleteForUser: (userId) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM user_layouts WHERE user_id = ?',
                [userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }
};

// Device config işlemleri
const deviceConfigDB = {
    // Cihaz konfigürasyonu kaydet
    saveConfig: (deviceId, configJson, version = 1) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO device_configs (device_id, config_json, version, applied) VALUES (?, ?, ?, ?)',
                [deviceId, JSON.stringify(configJson), version, false],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, deviceId, configJson, version });
                }
            );
        });
    },
    
    // Cihaz konfigürasyonunu güncelle (applied olarak işaretle)
    markConfigApplied: (deviceId, requestId = null) => {
        return new Promise((resolve, reject) => {
            let query = 'UPDATE device_configs SET applied = 1, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?';
            let params = [deviceId];
            
            if (requestId) {
                // Eğer request_id varsa, config_json içinde arama yap
                query += ' AND config_json LIKE ?';
                params.push(`%"request_id":"${requestId}"%`);
            }
            
            db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ updated: this.changes > 0 });
            });
        });
    },
    
    // Cihazın son konfigürasyonunu al
    getLastConfig: (deviceId) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM device_configs WHERE device_id = ? ORDER BY created_at DESC LIMIT 1',
                [deviceId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? { ...row, config_json: JSON.parse(row.config_json) } : null);
                }
            );
        });
    },
    
    // Cihazın uygulanmamış konfigürasyonlarını al
    getPendingConfigs: (deviceId) => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM device_configs WHERE device_id = ? AND applied = 0 ORDER BY created_at DESC',
                [deviceId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => ({ ...row, config_json: JSON.parse(row.config_json) })));
                }
            );
        });
    }
};

// Config queue işlemleri
const configQueueDB = {
    // Kuyruğa mesaj ekle
    addToQueue: (deviceId, payload, maxRetries = 5) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO config_queue (device_id, payload, max_retries, status) VALUES (?, ?, ?, ?)',
                [deviceId, JSON.stringify(payload), maxRetries, 'pending'],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, deviceId, payload });
                }
            );
        });
    },
    
    // Bekleyen mesajları al
    getPendingMessages: () => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM config_queue WHERE status = "pending" ORDER BY created_at ASC',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => ({ ...row, payload: JSON.parse(row.payload) })));
                }
            );
        });
    },
    
    // Mesaj durumunu güncelle
    updateMessageStatus: (id, status, errorMessage = null) => {
        return new Promise((resolve, reject) => {
            const query = errorMessage 
                ? 'UPDATE config_queue SET status = ?, last_try = CURRENT_TIMESTAMP, retries = retries + 1 WHERE id = ?'
                : 'UPDATE config_queue SET status = ?, last_try = CURRENT_TIMESTAMP WHERE id = ?';
            const params = errorMessage ? [status, id] : [status, id];
            
            db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ updated: this.changes > 0 });
            });
        });
    },
    
    // Başarısız mesajları temizle
    cleanupFailedMessages: (maxAge = 24 * 60 * 60 * 1000) => { // 24 saat
        return new Promise((resolve, reject) => {
            const cutoffTime = new Date(Date.now() - maxAge).getTime();
            db.run(
                'DELETE FROM config_queue WHERE status = "failed" AND created_at < ?',
                [cutoffTime],
                function(err) {
                    if (err) reject(err);
                    else resolve({ cleaned: this.changes });
                }
            );
        });
    }
};

// WOL profiles işlemleri
const wolProfilesDB = {
    // WOL profili ekle
    addProfile: (deviceId, name, mac, broadcastIp, port = 9) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO wol_profiles (device_id, name, mac, broadcast_ip, port) VALUES (?, ?, ?, ?, ?)',
                [deviceId, name, mac, broadcastIp, port],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, deviceId, name, mac, broadcastIp, port });
                }
            );
        });
    },
    
    // Cihazın WOL profillerini al
    getProfilesByDevice: (deviceId) => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM wol_profiles WHERE device_id = ? ORDER BY created_at ASC',
                [deviceId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    },
    
    // WOL profili sil
    deleteProfile: (id) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM wol_profiles WHERE id = ?',
                [id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }
};

// Device tokens işlemleri
const deviceTokensDB = {
    // Token oluştur
    createToken: (deviceId, token, tokenType = 'persistent', expiresAt = null) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO device_tokens (device_id, token, token_type, expires_at) VALUES (?, ?, ?, ?)',
                [deviceId, token, tokenType, expiresAt],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, deviceId, token, tokenType, expiresAt });
                }
            );
        });
    },
    
    // Token doğrula
    validateToken: (deviceId, token) => {
        return new Promise((resolve, reject) => {
            const now = new Date().getTime();
            db.get(
                'SELECT * FROM device_tokens WHERE device_id = ? AND token = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1',
                [deviceId, token, now],
                (err, row) => {
                    if (err) reject(err);
                    else {
                        if (row) {
                            // Token kullanım zamanını güncelle
                            db.run('UPDATE device_tokens SET last_used = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
                        }
                        resolve(row);
                    }
                }
            );
        });
    },
    
    // Cihazın aktif token'ını al
    getActiveToken: (deviceId) => {
        return new Promise((resolve, reject) => {
            const now = new Date().getTime();
            db.get(
                'SELECT * FROM device_tokens WHERE device_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1',
                [deviceId, now],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },
    
    // Token'ı iptal et
    revokeToken: (deviceId, token) => {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM device_tokens WHERE device_id = ? AND token = ?',
                [deviceId, token],
                function(err) {
                    if (err) reject(err);
                    else resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }
};

// Config history işlemleri
const configHistoryDB = {
    // Geçmiş kaydı ekle
    addHistory: (deviceId, userId, action, configJson = null, errorMessage = null, ipAddress = null) => {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO config_history (device_id, user_id, action, config_json, error_message, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
                [deviceId, userId, action, configJson ? JSON.stringify(configJson) : null, errorMessage, ipAddress],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, deviceId, userId, action });
                }
            );
        });
    },
    
    // Cihazın geçmişini al
    getHistoryByDevice: (deviceId, limit = 50) => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT ch.*, u.username FROM config_history ch LEFT JOIN users u ON ch.user_id = u.id WHERE ch.device_id = ? ORDER BY ch.created_at DESC LIMIT ?',
                [deviceId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => ({
                        ...row,
                        config_json: row.config_json ? JSON.parse(row.config_json) : null
                    })));
                }
            );
        });
    }
};

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
            return new Promise((resolve, reject) => {
                // Mevcut kullanıcının portunu kontrol et
                db.get('SELECT websocket_port FROM users WHERE id = ?', [userId], (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    if (row && row.websocket_port) {
                        // Kullanıcının zaten portu var
                        resolve(row.websocket_port);
                        return;
                    }
                    
                    // Boş port bul
                    findAvailablePort().then(port => {
                        if (!port) {
                            reject(new Error('Kullanılabilir port bulunamadı (5130, 5131, 5136)'));
                            return;
                        }
                        
                        // Portu kullanıcıya ata
                        db.run('UPDATE users SET websocket_port = ? WHERE id = ?', [port, userId], function(err) {
                            if (err) {
                                reject(err);
                            } else {
                                console.log(`✅ Port ${port} kullanıcı ${userId} için atandı`);
                                resolve(port);
                            }
                        });
                    }).catch(reject);
                });
            });
        },
        
        // Kullanıcının portunu al
        getUserPort: (userId) => {
            return new Promise((resolve, reject) => {
                db.get('SELECT websocket_port FROM users WHERE id = ?', [userId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.websocket_port : null);
                });
            });
        },
        
        // Portu serbest bırak
        releasePort: (port) => {
            return new Promise((resolve, reject) => {
                db.run('UPDATE users SET websocket_port = NULL WHERE websocket_port = ?', [port], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Port ${port} serbest bırakıldı`);
                        resolve();
                    }
                });
            });
        },
        
        // Kullanılan portları listele
        getUsedPorts: () => {
            return new Promise((resolve, reject) => {
                db.all('SELECT id, username, websocket_port FROM users WHERE websocket_port IS NOT NULL', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }
    },
    db
};

// Kullanılabilir port bulma fonksiyonu
function findAvailablePort() {
    return new Promise((resolve, reject) => {
        db.all('SELECT websocket_port FROM users WHERE websocket_port IS NOT NULL', (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            const usedPortNumbers = rows.map(row => row.websocket_port);
            const allowedPorts = [5130, 5131, 5136];
            
            // İzin verilen portlardan boş olanı bul
            for (const port of allowedPorts) {
                if (!usedPortNumbers.includes(port)) {
                    resolve(port);
                    return;
                }
            }
            
            resolve(null); // Boş port bulunamadı
        });
    });
}


