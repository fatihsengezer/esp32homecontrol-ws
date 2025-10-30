const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Veritabanı dosyası yolu
const dbPath = path.join(__dirname, 'data', 'esp32home.db');

// Veritabanı bağlantısı
const db = new sqlite3.Database(dbPath);

console.log('🔍 Sessions tablosu yapısını kontrol ediliyor...\n');

// Sessions tablosunun yapısını kontrol et
db.all("PRAGMA table_info(sessions)", (err, rows) => {
    if (err) {
        console.error('❌ Hata:', err);
    } else {
        console.log('📊 Sessions tablosu yapısı:');
        console.log('================================');
        rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.name} (${row.type}) - ${row.notnull ? 'NOT NULL' : 'NULL'} - ${row.pk ? 'PRIMARY KEY' : ''}`);
        });
    }
    
    // Sessions tablosundaki tüm verileri kontrol et
    db.all("SELECT * FROM sessions", (err, sessions) => {
        if (err) {
            console.error('❌ Session verisi hatası:', err);
        } else {
            console.log('\n📊 Sessions tablosundaki tüm veriler:');
            console.log('================================');
            if (sessions.length === 0) {
                console.log('❌ Sessions tablosunda veri yok!');
            } else {
                sessions.forEach((session, index) => {
                    console.log(`${index + 1}. Session ID: ${session.session_id.substring(0, 8)}...`);
                    console.log(`   User ID: ${session.user_id}`);
                    console.log(`   Expires: ${session.expires_at}`);
                    console.log(`   Remember Me: ${session.remember_me ? 'Evet' : 'Hayır'}`);
                    console.log('--------------------------------');
                });
            }
        }
        
        db.close();
    });
});



