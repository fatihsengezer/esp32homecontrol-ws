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
        
        // Varsayılan kullanıcıları ekle
        insertDefaultUsers();
        console.log('✅ Veritabanı başlatma tamamlandı');
        
    } catch (err) {
        console.error('❌ Database init error:', err);
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
            const { name, email, role, is_active, websocket_port, password } = userData;
            let query, params;
            if (password !== undefined) {
                query = 'UPDATE users SET name = ?, email = ?, role = ?, is_active = ?, websocket_port = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
                params = [name, email, role, is_active, websocket_port, password, id];
            } else {
                query = 'UPDATE users SET name = ?, email = ?, role = ?, is_active = ?, websocket_port = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
                params = [name, email, role, is_active, websocket_port, id];
            }
            const stmt = db.prepare(query);
            stmt.run(...params);
            return Promise.resolve({ id, ...userData });
        } catch (err) {
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
            
            const stmt = db.prepare('INSERT INTO sessions (session_id, user_id, expires_at, remember_me) VALUES (?, ?, ?, ?)');
            const result = stmt.run(sessionId, userId, expiresTimestamp, rememberMe);
            
            console.log('✅ Database: Session inserted successfully, ID:', result.lastInsertRowid);
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
            const stmt = db.prepare('UPDATE devices SET device_name = ?, ip_address = ?, mac_address = ?, location = ?, description = ?, owner_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            stmt.run(device_name, ip_address, mac_address, location, description, owner_id, is_active, id);
            return Promise.resolve({ id, ...deviceData });
        } catch (err) {
            return Promise.reject(err);
        }
    },
    updateByDeviceId: (deviceId, deviceData) => {
        try {
            const { device_name, ip_address, mac_address, location, description, owner_id, is_active } = deviceData;
            const stmt = db.prepare('UPDATE devices SET device_name = ?, ip_address = ?, mac_address = ?, location = ?, description = ?, owner_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ?');
            stmt.run(device_name, ip_address, mac_address, location, description, owner_id, is_active, deviceId);
            return Promise.resolve({ device_id: deviceId, ...deviceData });
        } catch (err) {
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

module.exports = {
    initDatabase,
    userDB,
    deviceDB,
    sessionDB,
    securityKeyDB,
    layoutDB,
    portDB: {
        // Kullanılabilir port aralığı - sadece belirli portlar
        ALLOWED_PORTS: [5130, 5131, 5136],
        
        // Kullanıcıya port ata
        assignPort: (userId) => {
            try {
                // Mevcut kullanıcının portunu kontrol et
                const user = db.prepare('SELECT websocket_port FROM users WHERE id = ?').get(userId);
                
                if (user && user.websocket_port) {
                    // Kullanıcının zaten portu var
                    return Promise.resolve(user.websocket_port);
                }
                
                // Boş port bul
                const usedPorts = db.prepare('SELECT websocket_port FROM users WHERE websocket_port IS NOT NULL').all();
                const usedPortNumbers = usedPorts.map(row => row.websocket_port);
                const allowedPorts = [5130, 5131, 5136];
                
                // İzin verilen portlardan boş olanı bul
                for (const port of allowedPorts) {
                    if (!usedPortNumbers.includes(port)) {
                        // Portu kullanıcıya ata
                        const stmt = db.prepare('UPDATE users SET websocket_port = ? WHERE id = ?');
                        stmt.run(port, userId);
                        console.log(`✅ Port ${port} kullanıcı ${userId} için atandı`);
                        return Promise.resolve(port);
                    }
                }
                
                return Promise.reject(new Error('Kullanılabilir port bulunamadı (5130, 5131, 5136)'));
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
                const result = stmt.run(port);
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


