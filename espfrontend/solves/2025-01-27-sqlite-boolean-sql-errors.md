# SQLite Boolean ve SQL Syntax Hataları

**Tarih:** 2025-01-27  
**Problem:** SQLite boolean bind hatası ve SQL syntax hatası  
**Hata Mesajları:**
1. `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null`
2. `SqliteError: no such column: "pending" - should this be a string literal in single-quotes?`

## Sorun 1: Boolean Bind Hatası

**Hata:**
```
TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
at Object.createSession (/path/to/database.js:284:33)
```

**Neden:** SQLite native boolean tipini desteklemez. `rememberMe` boolean olarak bind edilmeye çalışılıyordu.

**Çözüm:** Boolean'ı 0/1 integer'a çevirdik:

```javascript
// ÖNCE (HATALI):
const result = stmt.run(sessionId, userId, expiresTimestamp, rememberMe);

// SONRA (DOĞRU):
const rememberMeInt = rememberMe ? 1 : 0;
const result = stmt.run(sessionId, userId, expiresTimestamp, rememberMeInt);
```

**Düzeltilen Fonksiyonlar:**
1. `sessionDB.createSession()` - `rememberMe` boolean → 0/1
2. `userDB.updateUser()` - `is_active` boolean → 0/1  
3. `deviceDB.updateDevice()` - `is_active` boolean → 0/1
4. `deviceDB.updateByDeviceId()` - `is_active` boolean → 0/1

**Dosya:** `espfrontend/database.js`

## Sorun 2: SQL String Literal Hatası

**Hata:**
```
SqliteError: no such column: "pending" - should this be a string literal in single-quotes?
```

**Neden:** SQL sorgularında double quote (`"pending"`) yerine single quote (`'pending'`) kullanılmalı. SQLite double quote'u identifier (sütun adı) olarak yorumluyor.

**Çözüm:** Tüm string literal'ları single quote'a çevirdik:

```javascript
// ÖNCE (HATALI):
const rows = db.prepare('SELECT * FROM config_queue WHERE status = "pending" ...').all();

// SONRA (DOĞRU):
const rows = db.prepare("SELECT * FROM config_queue WHERE status = 'pending' ...").all();
```

**Düzeltilen Yerler:**
1. `configQueueDB.getPendingMessages()` - `status = 'pending'`
2. `configQueueDB.cleanupFailedMessages()` - `status = 'failed'`

**Dosya:** `espfrontend/database.js`

## SQLite Best Practices

1. **Boolean Değerler:** Her zaman 0 (false) veya 1 (true) olarak saklayın
2. **String Literals:** Single quote (`'string'`) kullanın
3. **Identifiers:** Double quote (`"column_name"`) sadece identifier'lar için

## Test

Sunucuda test edilmesi gerekenler:
- ✅ Login işlemi (session oluşturma)
- ✅ Session validation (session okuma)
- ✅ Config queue işlemleri (pending mesajlar)
- ✅ Queue worker (pending mesajları işleme)

## Notlar

- SQLite'de `BOOLEAN` tipi INTEGER olarak saklanır (0 veya 1)
- `better-sqlite3` boolean değerleri bind ederken hata verir, integer kullanın
- SQL standartlarına göre string literal'lar single quote ile belirtilir

