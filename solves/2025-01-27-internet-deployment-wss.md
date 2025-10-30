# Internet Deployment - WSS Protocol ve Port Kısıtlamaları

**Tarih:** 2025-01-27  
**Proje:** ESP32HOME Frontend  
**Sorun:** Frontend'i internette kullanmak için WSS protokolü ve port kısıtlamaları gerekli

## Yapılan Değişiklikler

### 1. WebSocket Protokolü WSS'e Çevrildi
- **Dosya:** `espfrontend/public/scripts/main.js`
- **Değişiklik:** `ws://` → `wss://riddleabby.serv00.net:5136/`
- **Sebep:** Internet üzerinden güvenli bağlantı için SSL/TLS gerekli

### 2. Admin Panel WebSocket URL'i Güncellendi
- **Dosya:** `espfrontend/public/scripts/admin.js`
- **Değişiklik:** `ws://` → `wss://riddleabby.serv00.net:5136/`
- **Sebep:** Admin paneli de aynı güvenli bağlantıyı kullanmalı

### 3. Port Kısıtlamaları Uygulandı
- **Dosya:** `espfrontend/database.js`
- **Değişiklik:** Sadece 5130, 5131, 5136 portlarına izin verildi
- **Sebep:** Servis limiti nedeniyle sadece belirli portlar kullanılabilir

### 4. Server Port'u Değiştirildi
- **Dosya:** `espfrontend/server.js`
- **Değişiklik:** Port 8080 → 5136
- **Sebep:** WebSocket server'ı 5136 portunda çalışacak

### 5. Port Yönetimi API'leri Güncellendi
- **Dosya:** `espfrontend/server.js`
- **Değişiklik:** Port atama ve kontrol işlemlerinde sadece izin verilen portlar kontrol ediliyor
- **Sebep:** Kullanıcılar sadece belirlenen portları kullanabilmeli

### 6. Admin Panel UI Güncellemeleri
- **Dosya:** `espfrontend/public/admin.html`
- **Değişiklik:** Port yönetimi bölümüne bilgi kutusu eklendi
- **Sebep:** Kullanıcılara hangi portların kullanılabilir olduğunu göstermek

### 7. CSS Stilleri Eklendi
- **Dosya:** `espfrontend/public/css/admin.css`
- **Değişiklik:** `.info-box` stili eklendi
- **Sebep:** Port bilgilerini güzel göstermek için

## Kullanılabilir Portlar
- **5130** - Kullanıcı portu
- **5131** - Kullanıcı portu  
- **5136** - WebSocket server portu (WSS)

## WebSocket URL
```
wss://riddleabby.serv00.net:5136/
```

## Deploy Notları
1. Server 5136 portunda çalışacak
2. WSS protokolü kullanılacak (SSL sertifikası gerekli)
3. Sadece belirlenen portlar kullanılabilir
4. Frontend otomatik olarak doğru URL'ye bağlanacak

## Test Edilmesi Gerekenler
- [ ] WSS bağlantısı çalışıyor mu?
- [ ] Port kısıtlamaları doğru çalışıyor mu?
- [ ] Admin paneli port yönetimi çalışıyor mu?
- [ ] SSL sertifikası doğru yapılandırılmış mı?


