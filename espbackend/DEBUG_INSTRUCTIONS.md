# ESP32 Debug Talimatları

## Konfigürasyon
- **Cihaz ID**: `esp32_001`
- **Cihaz Adı**: `Ana Kontrol`
- **WebSocket Server**: `192.168.1.11:8080`

## Debug Logları

### 1. WebSocket Bağlantısı
```
=== WebSocket Bağlandı ===
Server: 192.168.1.11:8080
Cihaz ID: esp32_001
Cihaz Adı: Ana Kontrol
Heartbeat gönderildi: {"type":"heartbeat","deviceId":"esp32_001",...}
```

### 2. Heartbeat Mesajları (Her 5 saniyede)
```
=== Heartbeat Gönderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 12345 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001",...}
```

### 3. Röle Komutları
```
Message: relay:1:on
Röle 1 AÇILIYOR
Röle 1 AÇILDI
relay:1:on
```

## Test Adımları

### 1. ESP32'yi Bağlayın
1. ESP32'yi USB'ye bağlayın
2. Serial Monitor'ü açın (115200 baud)
3. Reset butonuna basın
4. WebSocket bağlantı loglarını kontrol edin

### 2. Server'ı Başlatın
```bash
cd espfrontend
node server.js
```

### 3. Ana Sayfayı Açın
1. `http://192.168.1.11:8080` adresine gidin
2. Login olun (admin/admin)
3. Cihaz seçiciden "Ana Kontrol" seçin
4. Röle komutları gönderin

### 4. Debug Kontrolü
- **ESP32 Serial Monitor**: Heartbeat ve komut logları
- **Server Console**: Cihaz kayıt ve mesaj yönlendirme logları
- **Browser Console**: Frontend mesaj logları

## Beklenen Sonuçlar

### Server Console
```
ESP32 kayıt edildi: Ana Kontrol (ID: esp32_001)
Client seçili cihazı değiştirdi: esp32_001
Komut gönderildi: relay:1:on -> esp32_001
```

### ESP32 Serial Monitor
```
=== WebSocket Bağlandı ===
Server: 192.168.1.11:8080
Cihaz ID: esp32_001
Cihaz Adı: Ana Kontrol
Heartbeat gönderildi: {"type":"heartbeat",...}
Message: relay:1:on
Röle 1 AÇILIYOR
Röle 1 AÇILDI
```

## Sorun Giderme

### 1. WebSocket Bağlanmıyor
- WiFi bağlantısını kontrol edin
- Server IP'sinin doğru olduğunu kontrol edin
- Firewall ayarlarını kontrol edin

### 2. Heartbeat Gönderilmiyor
- ESP32'nin çalıştığını kontrol edin
- Serial Monitor'de hata mesajları arayın

### 3. Komutlar Gitmiyor
- Server'ın çalıştığını kontrol edin
- Browser console'da hata mesajları arayın
- Cihaz seçiminin doğru olduğunu kontrol edin
