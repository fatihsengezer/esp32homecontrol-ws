# ESP32 Home Automation - Device Config Management Deployment Guide

## Özet

Bu güncelleme, ESP32 cihazlarına dinamik konfigürasyon gönderme özelliği ekler. Artık web panelinden WiFi ayarları, WOL profilleri ve diğer konfigürasyonları cihazlara uzaktan gönderebilirsiniz.

## Yeni Özellikler

### 1. Dinamik Konfigürasyon Yönetimi
- WiFi SSID/şifre gönderme
- WOL profilleri yönetimi
- Statik IP ayarları
- Cihaz durumu takibi

### 2. Güvenlik
- Device token authentication
- Rate limiting
- Audit logging
- Session management

### 3. Offline Support
- Config queue sistemi
- Retry mechanism
- Background worker

## Deployment Adımları

### 1. Database Migration

```bash
# Migration'ları çalıştır
cd espfrontend/database
node simple_migration.js

# Veritabanını kontrol et
node check_tables.js
```

### 2. Server Restart

```bash
# Mevcut server'ı durdur
# (Ctrl+C veya process kill)

# Yeni server'ı başlat
cd espfrontend
npm start
```

### 3. ESP32 Firmware Update

ESP32 kodunu güncelleyin:
- `main.cpp` dosyasındaki yeni fonksiyonları ekleyin
- Token management kodunu ekleyin
- Config handling fonksiyonlarını ekleyin

### 4. Frontend Update

Admin panelinde yeni "Konfigürasyon" sekmesi görünecek:
- Cihaz seçimi
- WiFi ayarları
- WOL profilleri
- Konfigürasyon geçmişi

## API Endpoints

### Yeni Endpoints

```
POST /api/devices/:deviceId/config
GET  /api/devices/:deviceId/config
GET  /api/devices/:deviceId/status
GET  /api/devices/:deviceId/history
GET  /api/devices/:deviceId/wol-profiles
POST /api/devices/:deviceId/wol-profiles
DELETE /api/devices/:deviceId/wol-profiles/:profileId
```

### WebSocket Messages

#### ESP32'den Sunucuya
```json
{
  "type": "identify",
  "device_id": "ESP12345",
  "firmware": "v1.0.0",
  "token": "...",
  "capabilities": ["wol", "wifi-config"]
}
```

#### Sunucudan ESP32'ye
```json
{
  "type": "update_config",
  "device_id": "ESP12345",
  "token": "...",
  "config": {
    "wifi_ssid": "MyNetwork",
    "wifi_pass": "password123",
    "use_dhcp": true,
    "wol_profiles": [...]
  }
}
```

#### ESP32'den Sunucuya (ACK)
```json
{
  "type": "config_applied",
  "device_id": "ESP12345",
  "request_id": "uuid",
  "status": "ok",
  "details": {
    "ip": "192.168.1.100",
    "mac": "AA:BB:CC:DD:EE:FF"
  }
}
```

## Güvenlik

### Rate Limiting
- Kullanıcı başına dakikada maksimum 10 config gönderimi
- IP bazlı rate limiting

### Token Management
- Her cihaz için benzersiz token
- Token rotation desteği
- Pairing token sistemi

### Audit Logging
- Tüm config işlemleri loglanır
- Hata mesajları kaydedilir
- Kullanıcı aktiviteleri takip edilir

## Monitoring

### Queue Status
- Bekleyen mesaj sayısı
- Başarısız mesajlar
- Retry sayıları

### Device Status
- Online/offline durumu
- Son görülme zamanı
- Firmware versiyonu

### Performance Metrics
- Config gönderme süreleri
- Başarı oranları
- Hata oranları

## Troubleshooting

### Yaygın Sorunlar

1. **Config gönderilmiyor**
   - Cihaz online mı kontrol edin
   - Token geçerli mi kontrol edin
   - Rate limit aşılmış mı kontrol edin

2. **ESP32 config almıyor**
   - WebSocket bağlantısı var mı kontrol edin
   - Token doğru mu kontrol edin
   - Firmware güncel mi kontrol edin

3. **Queue mesajları gönderilmiyor**
   - Background worker çalışıyor mu kontrol edin
   - Cihaz online olduğunda mesaj gönderiliyor mu kontrol edin

### Log Kontrolü

```bash
# Server logları
tail -f espfrontend/logs/server.log

# Database kontrolü
sqlite3 espfrontend/data/esp32home.db "SELECT * FROM config_queue WHERE status='pending'"
```

## Rollback

Eğer sorun yaşarsanız:

1. **Database rollback**
   ```bash
   # Yeni tabloları sil
   sqlite3 espfrontend/data/esp32home.db "DROP TABLE device_configs; DROP TABLE config_queue; DROP TABLE wol_profiles; DROP TABLE device_tokens; DROP TABLE config_history;"
   ```

2. **Code rollback**
   ```bash
   # Önceki commit'e dön
   git checkout HEAD~1
   ```

3. **Server restart**
   ```bash
   # Server'ı yeniden başlat
   npm start
   ```

## Test Checklist

- [ ] Database migration başarılı
- [ ] Server başlatıldı
- [ ] ESP32 bağlandı
- [ ] Device identify mesajı geldi
- [ ] Config gönderme çalışıyor
- [ ] ACK mesajı geliyor
- [ ] Offline queue çalışıyor
- [ ] WOL profilleri çalışıyor
- [ ] Rate limiting çalışıyor
- [ ] Audit logging çalışıyor

## Support

Sorun yaşarsanız:
1. Log dosyalarını kontrol edin
2. Database durumunu kontrol edin
3. Network bağlantısını kontrol edin
4. ESP32 firmware'ini kontrol edin



