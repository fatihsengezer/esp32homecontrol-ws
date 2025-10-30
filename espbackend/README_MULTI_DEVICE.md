# ESP32 Çoklu Cihaz Desteği

Bu proje artık birden fazla ESP32 cihazını destekliyor. Her cihaz farklı bir `deviceId` ile tanımlanır ve mesajlar sadece hedef cihaza gönderilir.

## Kurulum

### 1. Cihaz Konfigürasyonu

Her ESP32 için farklı konfigürasyon dosyası kullanın:

```cpp
// main.cpp'de bu satırlardan birini aktif edin:
#include "../device_configs/esp32_001.h"  // Ana Kontrol
#include "../device_configs/esp32_002.h"  // Yatak Odası  
#include "../device_configs/esp32_003.h"  // Mutfak
```

### 2. Cihaz ID'lerini Değiştirme

Her cihaz için farklı ID kullanın:

```cpp
// esp32_001.h
#define DEVICE_ID "esp32_001"
#define DEVICE_NAME "Ana Kontrol"

// esp32_002.h  
#define DEVICE_ID "esp32_002"
#define DEVICE_NAME "Yatak Odası ESP32"

// esp32_003.h
#define DEVICE_ID "esp32_003" 
#define DEVICE_NAME "Mutfak ESP32"
```

### 3. WebSocket Server IP

Tüm cihazlarda aynı server IP'sini kullanın:

```cpp
#define WS_SERVER_IP "192.168.1.38"
#define WS_SERVER_PORT 8080
```

## Çalışma Mantığı

### 1. Cihaz Kaydı
- ESP32 bağlandığında JSON heartbeat mesajı gönderir
- Server cihazı `deviceId` ile kaydeder
- Cihaz otomatik olarak database'e eklenir

### 2. Mesaj Yönlendirme
- **Client → ESP32**: Sadece seçili cihaza gönderilir
- **ESP32 → Client**: Tüm client'lara yayınlanır
- **SecureCommand**: `deviceId` parametresine göre hedef cihaza gönderilir

### 3. Heartbeat Mesajı

```json
{
  "type": "heartbeat",
  "deviceId": "esp32_001",
  "deviceName": "Ana Kontrol", 
  "status": "online",
  "uptime": 47795,
  "relayStates": [
    {"id": 0, "state": false},
    {"id": 1, "state": false},
    {"id": 2, "state": false},
    {"id": 3, "state": false},
    {"id": 4, "state": false},
    {"id": 5, "state": false},
    {"id": 6, "state": false},
    {"id": 7, "state": false}
  ]
}
```

## Test Senaryoları

### 1. Tek Cihaz Testi
1. ESP32'yi bağlayın
2. Ana sayfada cihaz seçin
3. Relay/WOL komutları gönderin

### 2. Çoklu Cihaz Testi
1. İki farklı ESP32'yi farklı `deviceId` ile bağlayın
2. Ana sayfada cihaz seçin
3. Komut gönderin - sadece seçili cihaza gitmeli

### 3. Cihaz Değiştirme
1. Ana sayfada farklı cihaz seçin
2. Komut gönderin - yeni seçili cihaza gitmeli

## Debug Logları

### Server Console
```
ESP32 kayıt edildi: Ana Kontrol (ID: esp32_001)
Client seçili cihazı değiştirdi: esp32_001
Komut gönderildi: relay:1:on -> esp32_001
ESP32 bağlantısı kapandı: esp32_001
```

### ESP32 Serial Monitor
```
Connected to WebSocket Server
Heartbeat sent: {"type":"heartbeat","deviceId":"esp32_001",...}
Message: relay:1:on
Röle 1 AÇILDI
```

## Sorun Giderme

### 1. Cihaz Görünmüyor
- ESP32'nin doğru `deviceId` ile heartbeat gönderdiğini kontrol edin
- Server console'da "ESP32 kayıt edildi" mesajını arayın

### 2. Mesajlar Gitmiyor
- Client'ın doğru cihazı seçtiğini kontrol edin
- Server console'da "Client seçili cihazı değiştirdi" mesajını arayın

### 3. Bağlantı Sorunları
- WebSocket server IP'sinin doğru olduğunu kontrol edin
- ESP32'nin WiFi'ye bağlı olduğunu kontrol edin
