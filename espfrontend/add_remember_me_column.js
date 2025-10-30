const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Veritabanı dosyası yolu
const dbPath = path.join(__dirname, 'data', 'esp32home.db');

// Veritabanı bağlantısı
const db = new sqlite3.Database(dbPath);

console.log('🔧 remember_me kolonu ekleniyor...');

// remember_me kolonunu ekle
db.run("ALTER TABLE sessions ADD COLUMN remember_me BOOLEAN DEFAULT 0", (err) => {
    if (err) {
        if (err.message.includes('duplicate column name')) {
            console.log('✅ remember_me kolonu zaten mevcut');
        } else {
            console.error('❌ Hata:', err.message);
        }
    } else {
        console.log('✅ remember_me kolonu başarıyla eklendi');
    }
    
    // Tabloyu kontrol et
    db.all("PRAGMA table_info(sessions)", (err, columns) => {
        if (err) {
            console.error('❌ Tablo bilgisi alınamadı:', err);
        } else {
            console.log('\n📊 Sessions tablosu kolonları:');
            columns.forEach(col => {
                console.log(`- ${col.name} (${col.type})`);
            });
        }
        
        db.close();
    });
});



