const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Veritabanı dosyası yolu
const dbPath = path.join(__dirname, 'data', 'esp32home.db');

// Veritabanı bağlantısı
const db = new sqlite3.Database(dbPath);

console.log('🔍 Session verilerini kontrol ediliyor...\n');

// Session'ları listele
db.all("SELECT * FROM sessions ORDER BY expires_at DESC LIMIT 5", (err, rows) => {
    if (err) {
        console.error('❌ Hata:', err);
    } else {
        console.log('📊 Son 5 session:');
        console.log('================================');
        rows.forEach((row, index) => {
            console.log(`${index + 1}. Session ID: ${row.session_id.substring(0, 8)}...`);
            console.log(`   User ID: ${row.user_id}`);
            console.log(`   Expires: ${row.expires_at}`);
            console.log(`   Remember Me: ${row.remember_me ? 'Evet' : 'Hayır'}`);
            console.log('--------------------------------');
        });
    }
    
    // Kullanıcıları da listele
    db.all("SELECT id, username, name, role FROM users", (err, users) => {
        if (err) {
            console.error('❌ Kullanıcı hatası:', err);
        } else {
            console.log('\n👥 Kullanıcılar:');
            console.log('================================');
            users.forEach((user, index) => {
                console.log(`${index + 1}. ${user.username} (${user.name}) - ${user.role}`);
            });
        }
        
        db.close();
    });
});
