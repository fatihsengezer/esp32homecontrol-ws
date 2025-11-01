// Migration 003: Add IP address to WOL profiles
// Bu script'i server çalışırken de çalıştırabilirsiniz

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'esp32home.db');
const db = new Database(dbPath);

console.log('🔄 Migration 003: IP address kolonu kontrol ediliyor...');

try {
    // ip_address kolonunu kontrol et
    const tableInfo = db.prepare("PRAGMA table_info(wol_profiles)").all();
    const hasIpAddress = tableInfo.some(col => col.name === 'ip_address');
    
    if (!hasIpAddress) {
        console.log('📊 ip_address kolonu ekleniyor...');
        db.exec(`
            ALTER TABLE wol_profiles ADD COLUMN ip_address VARCHAR(45) DEFAULT '0.0.0.0';
            UPDATE wol_profiles SET ip_address = '0.0.0.0' WHERE ip_address IS NULL;
        `);
        console.log('✅ Migration 003 tamamlandı: ip_address kolonu eklendi');
    } else {
        console.log('✅ ip_address kolonu zaten mevcut, migration gerekmiyor');
    }
} catch (error) {
    if (error.message && error.message.includes('duplicate column')) {
        console.log('⚠️ ip_address kolonu zaten mevcut (duplicate error)');
    } else {
        console.error('❌ Migration hatası:', error);
        process.exit(1);
    }
} finally {
    db.close();
}

console.log('🎉 Migration kontrolü tamamlandı!');

