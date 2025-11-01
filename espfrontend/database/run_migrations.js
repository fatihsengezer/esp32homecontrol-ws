const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Migration dosyalarını çalıştır
async function runMigrations() {
    const dbPath = path.join(__dirname, '..', 'data', 'esp32home.db');
    const db = new sqlite3.Database(dbPath);
    
    console.log('🔄 Database migrations başlatılıyor...');
    
    try {
        // Migration 001: Device config tables
        console.log('📊 Migration 001: Device config tables...');
        const migration001 = fs.readFileSync(path.join(__dirname, 'migrations', '001_add_device_config_tables.sql'), 'utf8');
        await runSQL(db, migration001);
        console.log('✅ Migration 001 tamamlandı');
        
        // Migration 002: Update devices table
        console.log('📊 Migration 002: Update devices table...');
        const migration002 = fs.readFileSync(path.join(__dirname, 'migrations', '002_update_devices_table.sql'), 'utf8');
        await runSQL(db, migration002);
        console.log('✅ Migration 002 tamamlandı');
        
        // Migration 003: Add IP address to WOL profiles
        console.log('📊 Migration 003: Add IP address to WOL profiles...');
        try {
            const migration003 = fs.readFileSync(path.join(__dirname, 'migrations', '003_add_ip_to_wol_profiles.sql'), 'utf8');
            await runSQL(db, migration003);
            console.log('✅ Migration 003 tamamlandı');
        } catch (error) {
            // Kolon zaten varsa hata verme (güvenli)
            if (error.message && error.message.includes('duplicate column')) {
                console.log('⚠️ Migration 003: ip_address kolonu zaten mevcut, atlanıyor');
            } else {
                throw error;
            }
        }
        
        console.log('🎉 Tüm migrations başarıyla tamamlandı!');
        
    } catch (error) {
        console.error('❌ Migration hatası:', error);
        throw error;
    } finally {
        db.close();
    }
}

// SQL çalıştırma helper fonksiyonu
function runSQL(db, sql) {
    return new Promise((resolve, reject) => {
        // SQL'i ; ile böl ve her birini ayrı ayrı çalıştır
        const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
        let completed = 0;
        let hasError = false;
        
        statements.forEach((statement, index) => {
            const trimmed = statement.trim();
            if (trimmed.length === 0) {
                completed++;
                if (completed === statements.length && !hasError) resolve();
                return;
            }
            
            // Yorum satırlarını atla
            if (trimmed.startsWith('--') || trimmed.startsWith('/*')) {
                completed++;
                if (completed === statements.length && !hasError) resolve();
                return;
            }
            
            db.run(trimmed, (err) => {
                if (err) {
                    console.error(`❌ SQL Error (statement ${index + 1}):`, err.message);
                    console.error(`Statement: ${trimmed.substring(0, 100)}...`);
                    hasError = true;
                    reject(err);
                    return;
                }
                completed++;
                if (completed === statements.length && !hasError) resolve();
            });
        });
    });
}

// Eğer doğrudan çalıştırılıyorsa migration'ları başlat
if (require.main === module) {
    runMigrations().catch(console.error);
}

module.exports = { runMigrations };
