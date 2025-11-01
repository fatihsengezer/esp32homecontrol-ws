# Migration 003 - WOL Profiles IP Address

## Sorun
`wol_profiles` tablosunda `ip_address` kolonu eksik.

## Çözüm

### Seçenek 1: Sunucuyu Yeniden Başlat (Önerilen)
Migration otomatik olarak çalışacak:
```bash
pm2 restart fatihdev
```

### Seçenek 2: Manuel Migration Çalıştır
```bash
cd /usr/home/RiddleAbby/domains/fatihdev.xyz/public_nodejs
node run_migration_003.js
```

### Migration Script İçeriği
`run_migration_003.js` dosyası şu komutu çalıştırır:
```sql
ALTER TABLE wol_profiles ADD COLUMN ip_address VARCHAR(45) DEFAULT '0.0.0.0';
UPDATE wol_profiles SET ip_address = '0.0.0.0' WHERE ip_address IS NULL;
```

## Kontrol
Migration'ın başarılı olup olmadığını kontrol etmek için:
```bash
sqlite3 data/esp32home.db "PRAGMA table_info(wol_profiles);"
```

`ip_address` kolonu görünmelidir.

