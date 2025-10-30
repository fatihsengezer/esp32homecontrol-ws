const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Veritabanı tablolarını kontrol et
async function checkTables() {
    const dbPath = path.join(__dirname, '..', 'data', 'esp32home.db');
    const db = new sqlite3.Database(dbPath);
    
    console.log('📊 Veritabanı tabloları kontrol ediliyor...');
    
    try {
        // Tüm tabloları listele
        const tables = await new Promise((resolve, reject) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log('\n📋 Mevcut tablolar:');
        tables.forEach(table => {
            console.log(`  - ${table.name}`);
        });
        
        // Yeni tabloları kontrol et
        const newTables = ['device_configs', 'config_queue', 'wol_profiles', 'device_tokens', 'config_history'];
        console.log('\n✅ Yeni tablolar:');
        newTables.forEach(tableName => {
            const exists = tables.some(t => t.name === tableName);
            console.log(`  - ${tableName}: ${exists ? '✅ Mevcut' : '❌ Eksik'}`);
        });
        
        // Örnek veri ekle
        console.log('\n🔧 Örnek veri ekleniyor...');
        
        // Device token ekle
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT OR IGNORE INTO device_tokens (device_id, token, token_type) 
                VALUES ('ESP12345', 'test-token-123', 'persistent')
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('  - Örnek device token eklendi');
        
        // WOL profili ekle
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT OR IGNORE INTO wol_profiles (device_id, name, mac, broadcast_ip, port) 
                VALUES ('ESP12345', 'Test PC', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 9)
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('  - Örnek WOL profili eklendi');
        
        console.log('\n🎉 Veritabanı hazır!');
        
    } catch (error) {
        console.error('❌ Hata:', error);
    } finally {
        db.close();
    }
}

// Eğer doğrudan çalıştırılıyorsa kontrol et
if (require.main === module) {
    checkTables().catch(console.error);
}

module.exports = { checkTables };



