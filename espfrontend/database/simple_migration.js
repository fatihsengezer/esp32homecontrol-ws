const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Basit migration script
async function runSimpleMigration() {
    const dbPath = path.join(__dirname, '..', 'data', 'esp32home.db');
    const db = new sqlite3.Database(dbPath);
    
    console.log('🔄 Basit migration başlatılıyor...');
    
    try {
        // Device configs tablosu
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS device_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(128) NOT NULL,
                    config_json TEXT NOT NULL,
                    version INTEGER DEFAULT 1,
                    applied BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ device_configs tablosu oluşturuldu');
        
        // Config queue tablosu
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS config_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(128) NOT NULL,
                    payload TEXT NOT NULL,
                    retries INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 5,
                    status VARCHAR(32) DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_try DATETIME NULL,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ config_queue tablosu oluşturuldu');
        
        // WOL profiles tablosu
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS wol_profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(128) NOT NULL,
                    name VARCHAR(128) NOT NULL,
                    mac VARCHAR(17) NOT NULL,
                    broadcast_ip VARCHAR(45) NOT NULL,
                    port INTEGER DEFAULT 9,
                    ip_address VARCHAR(45) DEFAULT '0.0.0.0',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ wol_profiles tablosu oluşturuldu');
        
        // Device tokens tablosu
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS device_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(128) NOT NULL,
                    token VARCHAR(512) NOT NULL,
                    token_type VARCHAR(32) DEFAULT 'persistent',
                    expires_at DATETIME NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used DATETIME NULL,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ device_tokens tablosu oluşturuldu');
        
        // Config history tablosu
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS config_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(128) NOT NULL,
                    user_id INTEGER NULL,
                    action VARCHAR(50) NOT NULL,
                    config_json TEXT NULL,
                    error_message TEXT NULL,
                    ip_address VARCHAR(45) NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ config_history tablosu oluşturuldu');
        
        // Index'leri oluştur
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_device_configs_device_id ON device_configs(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_device_configs_applied ON device_configs(applied)',
            'CREATE INDEX IF NOT EXISTS idx_config_queue_device_id ON config_queue(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_config_queue_status ON config_queue(status)',
            'CREATE INDEX IF NOT EXISTS idx_wol_profiles_device_id ON wol_profiles(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_device_tokens_device_id ON device_tokens(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_config_history_device_id ON config_history(device_id)'
        ];
        
        for (const indexSql of indexes) {
            await new Promise((resolve, reject) => {
                db.run(indexSql, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        console.log('✅ Index\'ler oluşturuldu');
        
        console.log('🎉 Migration başarıyla tamamlandı!');
        
    } catch (error) {
        console.error('❌ Migration hatası:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Eğer doğrudan çalıştırılıyorsa migration'ı başlat
if (require.main === module) {
    runSimpleMigration().catch(console.error);
}

module.exports = { runSimpleMigration };



