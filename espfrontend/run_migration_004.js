// Migration 004: updated_at kolonu ekleme
// Kullanım: node run_migration_004.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'devices.db');
console.log('📁 Database file:', dbPath);

const db = new Database(dbPath);

try {
    console.log('🔄 Migration 004: updated_at kolonu kontrol ediliyor...');
    
    // Önce tablonun var olup olmadığını kontrol et
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='wol_profiles'
    `).get();
    
    if (!tableExists) {
        console.log('⚠️ wol_profiles tablosu bulunamadı. Önce veritabanı başlatılmalı.');
        db.close();
        process.exit(0);
    }
    
    // Tablo yapısını kontrol et
    const tableInfo = db.prepare("PRAGMA table_info(wol_profiles)").all();
    const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
    
    if (!hasUpdatedAt) {
        console.log('📊 Migration 004: updated_at kolonu ekleniyor...');
        // SQLite'da CURRENT_TIMESTAMP DEFAULT değer olarak ALTER TABLE ile kullanılamaz
        // Önce kolonu ekle, sonra değerleri güncelle
        db.exec(`
            ALTER TABLE wol_profiles ADD COLUMN updated_at DATETIME;
        `);
        // Mevcut kayıtlar için updated_at değerini created_at veya CURRENT_TIMESTAMP olarak ayarla
        db.exec(`
            UPDATE wol_profiles SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL;
        `);
        console.log('✅ Migration 004 tamamlandı: updated_at kolonu eklendi');
    } else {
        console.log('✅ Migration 004: updated_at kolonu zaten mevcut');
    }
    
    db.close();
    console.log('✅ Migration tamamlandı');
    process.exit(0);
} catch (error) {
    if (error.message && error.message.includes('duplicate column')) {
        console.log('⚠️ Migration 004: updated_at kolonu zaten mevcut');
    } else {
        console.error('❌ Migration hatası:', error);
    }
    db.close();
    process.exit(1);
}

