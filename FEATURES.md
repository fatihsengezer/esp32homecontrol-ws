## ESP32 Home Control – Özellikler

Bu doküman, `esp32homecontrol-ws` projesinin sunduğu tüm ana özellikleri; ESP32 firmware (backend/cihaz), Node.js sunucu (API + WebSocket), web arayüzü (frontend) ve veritabanı bileşenleriyle birlikte anlaşılır şekilde listeler.

---

## Mimari Genel Bakış
- **ESP32 firmware (PlatformIO/Arduino C++)**: Wi‑Fi kurulum arayüzü (AP/Captive Portal), güvenli WebSocket (WSS) istemcisi, cihaz kimlik doğrulama/token yönetimi, röle kontrolü, WOL profilleri ve durum izleme.
- **Node.js Sunucu**: Express tabanlı API, WebSocket sunucusu, oturum/sessions, yetkilendirme, konfigürasyon kuyruk sistemi, WOL profili senkronizasyonu, port ve layout yönetimi.
- **Web Arayüzü (Frontend)**: Giriş, ana kontrol paneli (röle/WOL/log), admin paneli (kullanıcı/cihaz/konfig/log/analitik/güvenlik/ayarlar/backup), gerçek zamanlı güncellemeler.
- **Veritabanı (SQLite)**: Kullanıcılar, cihazlar, session’lar, konfigürasyonlar, kuyruk, WOL profilleri, tokenlar, geçmiş/loglar ve yardımcı tablolar.

Dizinler:
- `espbackend/` (ESP32 C++ kaynakları ve Wi‑Fi setup GUI dosyaları)
- `espfrontend/` (Node.js sunucu, web arayüzü, veritabanı)
- `solves/` ve `espbackend/solves/`, `espfrontend/solves/` (çözüm günlükleri)
- `pastchats/` (geliştirme süreci diyalog kayıtları)

---

## ESP32 Firmware (espbackend)
- **Wi‑Fi Kurulum Arayüzü (AP/Captive Portal)**
  - Kayıtlı ağa bağlanamazsa AP moduna geçer (Captive Portal).
  - `Preferences` ile SSID/şifre kalıcı depolama.
  - Ağ tarama ve modern, mobil uyumlu HTML arayüz (LittleFS: `data/index.html`, `style.css`, `script.js`).
  - Başarılı giriş sonrası otomatik yeniden başlatma ve ağa bağlanma.

- **Güvenli WebSocket İstemcisi (WSS)**
  - `WebSocketsClient` + `WiFiClientSecure` ile `beginSSL()` bağlantı.
  - Keepalive/heartbeat ve otomatik yeniden bağlanma.
  - Sunucuya JSON heartbeat ve durum iletimi; loglar seri monitörde detaylı.

- **Cihaz Kimlik Doğrulama ve Token Yönetimi**
  - İlk bağlantıda `identify` mesajı; sunucu `pairing_required` dönebilir.
  - Kısa süreli eşleştirme token’ı (pairing) ve 30 gün geçerli kalıcı token (persistent) akışı.
  - Token’lar `Preferences` altında kalıcı saklanır; sonraki bağlantılarda otomatik kullanılır.

- **Dinamik Konfigürasyon Uygulama**
  - Sunucudan gelen `update_config` mesajlarını işler.
  - Parametreler: `wifi_ssid`, `wifi_pass`, `use_dhcp`, `static_ip`, `wol_profiles` (dizi veya JSON string).
  - Uygulama sonrası `config_applied` ACK JSON’u ile IP/MAC ve durum döner.

- **Wake-on-LAN (WOL) Yönetimi**
  - WOL profilleri Preferences’ta saklanır; derleme zamanlı profillerle senkronize olabilir.
  - `sendWOL()` ile magic packet (UDP/Broadcast) gönderir.
  - Profil detaylarını JSON olarak sunucuya iletir; `wol_profiles` mesajı.
  - Durum takibi: `ESP32Ping` ile RUNNING/OFFLINE/BOOTING geçişleri ve periyodik ping.

- **Röle Kontrolü**
  - Tekli ve toplu (`all:on`, `all:off`, `toggle`) röle komutları.
  - Debounce/cooldown (per‑relay) koruması; WebSocket üstünden anlık durum iletimi.
  - `getRelayStatus` ile tüm röle durumlarını raporlar.

- **Buzzer ve LED**
  - JSON komutla buzzer frekans/süre/volüm; LED aç/kapat geri dönüş mesajları.

- **Çoklu Cihaz Desteği**
  - `device_configs/*.h` ile cihaz kimliği ve adları (örn. `esp32_001`, `esp32_002`).
  - `SelectedDevice.h` üzerinden tek noktadan cihaz seçimi.
  - Mesajlar `deviceId` ile hedeflenir; sadece ilgili cihaz işler.

- **Ağ Özellikleri**
  - Kayıtlı Wi‑Fi ağına bağlanma; başarısızlıkta AP moduna dönüş.
  - DHCP/Statik IP desteği; yapılandırma mesajlarıyla güncellenebilir.

Referans dosyalar: `src/main.cpp`, `src/wifi_setup.cpp`, `include/wifi_setup.h`, `include/DeviceConfig.h`, `data/*`, `README_WIFI_SETUP.md`, `README_MULTI_DEVICE.md`

---

## Node.js Sunucu (espfrontend)
- **API (Express)**
  - Oturum: `POST /api/login`, `POST /api/logout`, `GET /api/user`
  - Cihazlar (kullanıcıya göre filtreli ve admin için tüm liste)
  - Admin Kullanıcı Yönetimi: listele/görüntüle/ekle/güncelle/sil
  - Admin Cihaz Yönetimi: listele/görüntüle/ekle/güncelle/sil
  - Port Yönetimi: izinli portlar (5130, 5131, 5136) için liste/ata/değiştir/bırak
  - Cihaz Konfig Yönetimi:
    - `POST /api/devices/:deviceId/config` (rate limit ve yetki kontrolü ile)
    - `GET  /api/devices/:deviceId/config`
    - `GET  /api/devices/:deviceId/status`
    - `GET  /api/devices/:deviceId/history`
  - WOL Profilleri:
    - `GET/POST/PUT/DELETE /api/devices/:deviceId/wol-profiles` (CRUD + senkronizasyon)

- **WebSocket Sunucusu**
  - `identify` akışı: pairing/persistent token doğrulama ve oturum kaydı.
  - `secureCommand`: kullanıcı güvenlik anahtarı ve sahiplik kontrolü ile cihazlara güvenli komut iletimi.
  - `config_applied`, `wol_profiles` vb. cihaz mesajlarını işleme ve istemcilere yayın.
  - `deviceRegistry`, `deviceUpdated` gibi frontend bildirimleri.

- **Konfigürasyon Kuyruğu (Offline Destek)**
  - Cihaz çevrimdışı ise `configQueue`’ya ekler; çevrimiçi olduğunda gönderir.
  - Arkaplan işçisi periyodik olarak kuyruğu gönderir, başarısızları işaretler/temizler.

- **Güvenlik ve Erişim**
  - CORS (origin beyaz listesi), HTTPS opsiyonu (sertifika varsa),
  - Rate limiting (kullanıcı başına dakika içinde istek limiti),
  - Oturum yönetimi (cookie tabanlı session),
  - Kullanıcı bazlı yetkilendirme ve cihaz sahipliği kontrolü,
  - Kullanıcıya bağlı kısa ömürlü “security key” üretimi (WS secureCommand için).

- **Diğer**
  - SSL varsa tek sunucuda WSS+HTTPS; yoksa WS+HTTP. API ve WS ayrı portlarda çalışır.
  - Admin paneline statik `admin.html` servis edilir.

Referans dosyalar: `server.js`, `public/*`, `database/*`, `database_better.js`

---

## Web Arayüzü (public)
- **Giriş ve Oturum**
  - `login.html` ve session cookie ile korunan rotalar.
  - Kullanıcı bilgisi yükleme ve admin butonu görünürlüğü rol bazlı.

- **Ana Kontrol Paneli (`index.html`)**
  - Cihaz seçici (sadece kullanıcıya ait cihazlar).
  - Dinamik röle arayüzü (butonlar ve durum göstergeleri).
  - WOL listesi (profil adı, MAC, broadcast IP/port; Wake butonu).
  - Gerçek zamanlı log paneli ve bağlantı durumu.
  - Otomatik yeniden bağlanma ve manuel reconnect.

- **Admin Paneli (`admin.html`)**
  - Dashboard ve kartlar (Chart.js ile grafikler).
  - Kullanıcı Yönetimi: CRUD.
  - Cihaz Yönetimi: liste/özellikler.
  - Cihaz Konfig: Wi‑Fi formu, DHCP/Statik IP, WOL profilleri (ekle/düzenle/sil), konfig geçmişi.
  - Loglar, Analitik, Güvenlik (olaylar, başarısız girişler, aktif session’lar),
  - Ayarlar: WebSocket Port Yönetimi, kullanıcı bazlı görünüm düzeni (layout manager).
  - Backup sekmesi: backup liste ve istatistik alanları.

- **İstemci Scriptleri**
  - `scripts/main.js`: WS bağlantısı (yalnızca WSS), kullanıcı & security key yükleme, dinamik UI oluşturma, cihaz listesi, loglama, layout uygulama.
  - `scripts/relay_status.js`, `scripts/wol_status.js`, `scripts/button.js`: bileşen bazlı işlevler.
  - `scripts/admin.js`: admin paneli işlemleri.

---

## Veritabanı (SQLite) – Öne Çıkan Tablolar
- **users, sessions**: kullanıcı ve oturum yönetimi.
- **devices**: ESP32 kayıtları (ID, ad, IP, MAC, sahiplik, durum).
- **device_configs, config_history, config_queue**: cihaz konfigürasyonları, geçmiş ve kuyruk.
- **wol_profiles, relay_states**: WOL ve röle ilişkili veriler.
- **device_tokens**: cihaz token yönetimi (pairing/persistent).
- **layout, ports (uygulamada portDB/layoutDB)**: kullanıcı arayüzü düzeni ve port atama.
- Ek yardımcı tablolar: `system_logs`, `websocket_connections`, `visitor_stats`, `system_settings`, `backup_history`, `security_events`, `scheduled_tasks`, `api_keys`, `notifications`.

Şema ve migration’lar: `espfrontend/database/schema.sql`, `database/migrations/*`.

---

## Dağıtım ve Çalıştırma
- **WebSocket/HTTP Uçları**
  - WS (internet): `wss://fatihdev.xyz:5131/`
  - API: `http://fatihdev.xyz:5130/api/`
- **Native Modül Uyarısı (better-sqlite3)**
  - Sunucuda `npm install` ile yeniden derleyin; `node_modules`’ı kopyalamayın.
  - Ayrıntılar: `espfrontend/DEPLOYMENT_GUIDE.md`.
- **PM2** ile servis yönetimi (restart/start komutları dokümanda mevcut).

---

## Güvenlik
- Kullanıcı oturumu ve rol bazlı yetkilendirme.
- Cihaz sahipliği doğrulaması (admin istisnası).
- Rate limiting (özellikle konfig gönderiminde).
- WebSocket üzerinden güvenli komut iletimi için kısa ömürlü güvenlik anahtarı.
- Cihaz eşleştirme akışı: pairing token → persistent token; token’lar cihazda `Preferences` ile kalıcı.

---

## Sorun Giderme ve Çözüm Kayıtları
- Tüm önemli çözüm günlükleri `solves/` klasörlerinde tutulur:
  - Kök: `solves/*`
  - ESP32: `espbackend/solves/*`
  - Frontend/Server: `espfrontend/solves/*`
- Örnek başlıklar: WSS bağlantısı, session kalıcılığı, frontend seçili cihaz init, API 401, vs.

---

## Notlar ve İpuçları
- ESP32 pin ve bağlantılarını (SPI/I2C/BOOT) düzenlerken dikkatli olun; MAX31856 gibi sensörlerde yönler karışmasın.
- SSR/DAC (ör. XTR111/115, GPIO25 DAC) kullanımında `dacWrite()` tercih edin.
- Cihaz sayısı/kapasitesi dinamik; `DeviceConfig.h` ve firmware mesajlarında `relayCount`/`wol` verileri UI’ı otomatik oluşturur.
- Tolerans/histeresis tabanlı kontrol eklemelerinde ±0.5°C gibi sınırları düşünün (gelecek geliştirmeler için).

---

## Dosya/Doküman Referansları
- ESP32 Wi‑Fi Setup GUI: `espbackend/README_WIFI_SETUP.md`
- Çoklu Cihaz Desteği: `espbackend/README_MULTI_DEVICE.md`
- Dağıtım: `espfrontend/DEPLOYMENT_GUIDE.md`
- Test: `espfrontend/TESTING_GUIDE.md`
- Geçmiş Sohbetler: `pastchats/README.md`
