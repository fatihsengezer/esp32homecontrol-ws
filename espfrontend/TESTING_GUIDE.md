# ESP32 Home Automation - Device Config Management Testing Guide

## Test Senaryoları

### 1. Database Migration Testi

```bash
# Migration'ları çalıştır
cd espfrontend/database
node run_migrations.js

# Veritabanını kontrol et
sqlite3 data/esp32home.db ".tables"
sqlite3 data/esp32home.db ".schema device_configs"
```

**Beklenen Sonuç:**
- Yeni tablolar oluşturulmuş olmalı
- Mevcut veriler korunmuş olmalı

### 2. WebSocket Session Tracking Testi

**Test Adımları:**
1. ESP32'yi başlat
2. WebSocket bağlantısını kontrol et
3. Device identify mesajının gönderildiğini doğrula

**Beklenen Sonuç:**
```json
{
  "type": "identify",
  "device_id": "ESP12345",
  "firmware": "v1.0.0",
  "token": "...",
  "capabilities": ["wol", "wifi-config"],
  "timestamp": "..."
}
```

### 3. Config Gönderme Testi

**Test Adımları:**
1. Admin panelinde "Konfigürasyon" sekmesine git
2. Bir cihaz seç
3. WiFi ayarlarını gir
4. "WiFi Ayarlarını Gönder" butonuna tıkla

**Beklenen Sonuç:**
- Config mesajı ESP32'ye gönderilmeli
- ESP32'den ACK mesajı gelmeli
- Admin panelinde "Gönderildi" durumu görünmeli

### 4. Offline Queue Testi

**Test Adımları:**
1. ESP32'yi kapat
2. Admin panelinden config gönder
3. ESP32'yi tekrar aç
4. Kuyruktaki mesajın gönderildiğini kontrol et

**Beklenen Sonuç:**
- Config kuyruğa eklenmeli
- ESP32 açıldığında kuyruktaki mesaj gönderilmeli

### 5. WOL Profil Yönetimi Testi

**Test Adımları:**
1. Admin panelinde WOL profili ekle
2. Profili düzenle
3. Profili sil

**Beklenen Sonuç:**
- Profil başarıyla eklenmeli
- Profil listesinde görünmeli
- Silme işlemi çalışmalı

### 6. Rate Limiting Testi

**Test Adımları:**
1. Hızlıca çok sayıda config gönder
2. Rate limit uyarısını kontrol et

**Beklenen Sonuç:**
- 10 istekten sonra rate limit uyarısı gelmeli

### 7. Token Management Testi

**Test Adımları:**
1. Yeni ESP32 bağlat
2. Pairing token'ın oluşturulduğunu kontrol et
3. Token ile identify işlemini test et

**Beklenen Sonuç:**
- Pairing token oluşturulmalı
- Token ile cihaz tanımlanmalı

## API Test Komutları

### Config Gönderme
```bash
curl -X POST http://localhost:5130/api/devices/ESP12345/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "wifi_ssid": "TestNetwork",
      "wifi_pass": "testpass123",
      "use_dhcp": true
    }
  }'
```

### Cihaz Durumu
```bash
curl http://localhost:5130/api/devices/ESP12345/status
```

### WOL Profil Ekleme
```bash
curl -X POST http://localhost:5130/api/devices/ESP12345/wol-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test PC",
    "mac": "AA:BB:CC:DD:EE:FF",
    "broadcast_ip": "192.168.1.255",
    "port": 9
  }'
```

## Hata Senaryoları

### 1. Geçersiz Token
- ESP32'ye geçersiz token ile config gönder
- Hata mesajının döndüğünü kontrol et

### 2. Cihaz Bulunamadı
- Var olmayan cihaz ID'si ile config gönder
- 404 hatası dönmeli

### 3. Yetki Hatası
- Farklı kullanıcı ile cihaza config gönder
- 403 hatası dönmeli

## Performance Testi

### 1. Çoklu Cihaz Testi
- 10 farklı ESP32 bağlat
- Hepsine aynı anda config gönder
- Tüm işlemlerin başarılı olduğunu kontrol et

### 2. Büyük Config Testi
- Çok büyük WOL profilleri listesi gönder
- Sistemin stabil çalıştığını kontrol et

## Güvenlik Testi

### 1. SQL Injection
- Config alanlarına SQL injection denemeleri yap
- Sistemin güvenli olduğunu kontrol et

### 2. XSS
- Config alanlarına XSS denemeleri yap
- Frontend'in güvenli olduğunu kontrol et

### 3. CSRF
- Farklı domain'den API çağrıları yap
- CSRF korumasının çalıştığını kontrol et



