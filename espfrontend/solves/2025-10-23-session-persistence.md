Başlık: Server restart sonrası "Beni Hatırla" oturumlarının kaybolması

Tarih: 2025-10-23

Özet:
- Sorun: Oturumlar veritabanına kaydediliyor görünse de, sunucu yeniden başlatıldığında tüm oturumlar kayboluyordu.
- Kök Sebep: `sessions.expires_at` değeri milisaniye cinsinden (INTEGER) saklanırken, temizlik (`cleanExpiredSessions`) SQL'i `datetime('now')` ile metinsel karşılaştırma yapıyordu. SQLite metin–sayı karşılaştırmasında tüm kayıtlar yanlışlıkla süresi dolmuş kabul edilip siliniyordu.

Değişiklikler:
- `espfrontend/database.js`
  - `createSession`: `expires_at` milisaniye (timestamp) olarak saklanıyor.
  - `getSession`: Karşılaştırma `new Date().getTime()` ile sayısal yapıldı.
  - `cleanExpiredSessions`: `DELETE FROM sessions WHERE expires_at <= ?` ve parametre olarak `Date.now()` kullanıldı.
  - `CREATE TABLE sessions` içine `remember_me BOOLEAN DEFAULT 0` eklendi.
  - Veritabanı dosya yolunu loglayan çıktı eklendi (debug): `📁 Database file: <path>`.

Test Adımları:
1) Sunucuyu başlat: `node server.js`
2) Login ekranından "Beni Hatırla" ile giriş yap.
3) Sunucuyu durdur ve tekrar başlat.
4) Sayfayı yenile: oturum devam etmeli.
5) İsteğe bağlı: `node check_sessions.js` ile veritabanındaki oturumları doğrula.

Beklenen Davranış:
- Sunucu yeniden başlasa bile oturum verileri silinmez; `validateSession` veritabanından oturumu bulur ve kullanıcı girişli kalır.

Notlar:
- Eski veritabanlarında `remember_me` kolonu yoksa `add_remember_me_column.js` scripti çalıştırılmalıdır.




