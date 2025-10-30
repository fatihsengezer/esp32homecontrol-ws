# 📡 ESP32 WiFi Setup GUI

Bu proje, ESP32 cihazları için Wi-Fi kurulum arayüzü sağlar. Cihaz ilk açıldığında veya kayıtlı WiFi ağına bağlanamadığında, kendi erişim noktasını (AP) başlatır ve kullanıcının WiFi bilgilerini girmesine olanak tanıyan bir web arayüzü sunar.

## 🎯 Özellikler

- ✅ Otomatik WiFi bağlantı denemesi
- ✅ Access Point (AP) modu desteği
- ✅ Modern, mobil uyumlu web arayüzü
- ✅ WiFi ağ tarama özelliği
- ✅ Preferences API ile kalıcı WiFi bilgisi saklama
- ✅ Otomatik yeniden başlatma
- ✅ Türkçe arayüz

## 🏗️ Sistem Mimarisi

### Başlangıç Akışı
```
ESP32 Boot
    ↓
WiFi Bağlantısı Dene (Preferences'den)
    ↓
Bağlantı Başarılı mı?
    ├─ ✅ Evet → Normal Çalışma (WebSocket)
    └─ ❌ Hayır → AP Modu (192.168.4.1)
           ↓
        Web Arayüzü
           ↓
        Kullanıcı WiFi Bilgileri Girer
           ↓
        ESP32 Restart
           ↓
        WiFi'ye Otomatik Bağlan
```

## 📁 Dosya Yapısı

```
espbackend/
├── src/
│   ├── main.cpp           # Ana ESP32 kodu
│   ├── wifi_setup.cpp     # WiFi Setup implementasyonu
│   └── DeviceConfig.cpp   # Cihaz yapılandırması
├── include/
│   ├── wifi_setup.h       # WiFi Setup başlık dosyası
│   ├── DeviceConfig.h     # Cihaz yapılandırma
│   └── StatusLED.h        # LED kontrol
├── data/                  # LittleFS dosyaları
│   ├── index.html         # WiFi Setup arayüzü
│   ├── style.css          # Stil dosyası
│   └── script.js          # JavaScript mantığı
├── platformio.ini        # PlatformIO yapılandırması
└── README_WIFI_SETUP.md  # Bu dosya
```

## 🔧 Kurulum

### 1. Bağımlılıklar

PlatformIO'nun otomatik olarak yüklediği kütüphaneler:
- `ESPAsyncWebServer` (v3.0.0)
- `AsyncTCP` (v1.1.1)
- `LittleFS_esp32` (v1.0.6)
- `WiFi` (ESP32 Built-in)
- `Preferences` (ESP32 Built-in)

### 2. LittleFS Dosyalarını Yükle

LittleFS dosya sistemini cihaza yüklemek için:

```bash
# Terminal'de proje kök dizininde
pio run --target uploadfs
```

VEYA PlatformIO IDE'de:
1. PlatformIO menüsünde "Run Task" seçin
2. "Upload File System image" seçin

### 3. Firmware'i Yükle

```bash
pio run --target upload
```

### 4. Serial Monitor'ü Başlat

```bash
pio device monitor
```

## 🚀 Kullanım

### İlk Kurulum

1. ESP32'yi takın ve boot yapın
2. Serial monitor'de AP moduna geçtiğini görün
3. WiFi ayarlarınızdan "ESP32_Setup" ağına bağlanın
4. Tarayıcıda `192.168.4.1` adresine gidin
5. "Ağları Tara" butonuna tıklayın
6. WiFi ağınızı seçin
7. Şifrenizi girin
8. "Kaydet ve Bağlan" butonuna tıklayın
9. Cihaz otomatik olarak yeniden başlayacak ve WiFi'ye bağlanacaktır

### WiFi Bilgilerini Sıfırlama

WiFi bilgilerini sıfırlamak için birkaç yöntem:

**Yöntem 1: Preferences Silelim (Kod)**
```cpp
preferences.begin("wificonfig", false);
preferences.clear(); // Tüm namespace'i temizle
preferences.end();
```

**Yöntem 2: Tam Fabrika Ayarları**
```bash
# Flash'ı tamamen sil ve yeniden yükle
esptool.py --chip esp32 --port COM13 erase_flash
pio run --target upload
```

## 📊 API Endpoints

### `GET /scan`
WiFi ağlarını tarar ve JSON döndürür.

**Response:**
```json
[
  {"ssid": "Rimer", "rssi": -45, "encryption": 4},
  {"ssid": "WiFi-5GHz", "rssi": -67, "encryption": 4}
]
```

### `POST /save`
WiFi bilgilerini kaydeder ve cihazı yeniden başlatır.

**Request Body:**
```
ssid=WiFi_Ismi&password=Sifre123
```

**Response:**
```json
{"status":"success","message":"Credentials saved. Rebooting..."}
```

### `GET /check`
Kayıtlı WiFi bilgisini kontrol eder.

**Response:**
```json
{"saved":true,"ssid":"Rimer"}
```

## 🔍 Debug ve Sorun Giderme

### AP Modu Başlamıyor

**Sorun:** LittleFS mount edilemiyor
**Çözüm:** 
```bash
pio run --target uploadfs
```

### WiFi'ye Bağlanamıyor

**Kontrol listesi:**
1. SSID doğru mu?
2. Şifre doğru mu?
3. Ağ sinyali yeterince güçlü mü?
4. Serial monitor'de hata mesajı var mı?

### Preferences Çalışmıyor

Preferences API ESP32'nin non-volatile storage (NVS) kullanır. Bir hata oluşursa:

```cpp
preferences.begin("wificonfig", false);
// Test yazma
preferences.putString("test", "test");
String result = preferences.getString("test", "");
Serial.println("Test: " + result);
preferences.end();
```

## 🎨 Arayüz Özelleştirme

`data/` klasöründeki dosyalar:
- `index.html` - HTML yapısı
- `style.css` - Görsel stiller
- `script.js` - JavaScript mantığı

Değişiklik yaptıktan sonra tekrar yükleyin:
```bash
pio run --target uploadfs
```

## 🔐 Güvenlik Notları

1. **AP Şifresi:** Varsayılan `12345678` - güvenlik için değiştirin (`wifi_setup.cpp`)
2. **HTTP:** Şu an HTTP kullanılıyor (güvensiz). Production'da HTTPS ekleyin.
3. **WiFi Şifresi:** Plaintext olarak Preferences'de saklanıyor.

## 📝 Geliştirme Notları

### Preferences Namespace
- Namespace: `wificonfig`
- Keys: `ssid`, `password`, `saved`

### AP Mode IP
- Default: `192.168.4.1`
- SSID: `ESP32_Setup`
- Password: `12345678`

### Bağlantı Parametreleri
- Deneme süresi: 10 saniye
- Maksimum deneme: 3 kez
- Başarısız olursa: AP moduna dön

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push yapın (`git push origin feature/amazing-feature`)
5. Pull Request açın

## 📄 Lisans

Bu proje özel kullanım içindir.

## 📞 Destek

Sorun yaşıyorsanız:
- Serial monitor çıktısını kontrol edin
- GitHub issues açın
- Debug mode'da çalıştırın

---

**Geliştirici:** Erhan
**Tarih:** 2025-01-27
**Versiyon:** 1.0.0


