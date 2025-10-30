Frontent: selectedDeviceId undefined ve varsayılan cihaz seçimi

Tarih: 2025-10-25

Sorun:
- index.html sadeleştirmesi sonrası selectedDeviceId bazı akışlarda tanımlanmadan kullanıldı ve ReferenceError: selectedDeviceId is not defined hatası görüldü.
- Ana sayfada cihaz seçilmediği için getWolStatus/getRelayStatus çağrıları gönderilmiyordu; ayrıca varsayılan olarak esp32_001 fallback istenmiyordu.

Çözüm:
- public/scripts/main.js içinde currentUser, availableDevices, selectedDeviceId değişkenleri dosya üstüne taşındı (global).
- loadDevices() cihazlar yüklenince kullanıcıya atanmış ilk cihazı otomatik seçiyor, selectedDeviceId set ediliyor ve WS açıksa şu istekler gönderiliyor: deviceSelection, getCapabilities, getRelayStatus, getWolStatus.
- WS onopen içerisindeki zamanlamalı istekler seçili cihaz yoksa gönderilmiyor.
- Sunucuda (server.js) seçili cihaz yoksa varsayılan esp32_001 kaldırıldı; "Önce cihaz seçin" hatası dönüyor.

Etkisi:
- Sayfa açılır açılmaz kullanıcıya atanmış ilk cihaz otomatik seçilir ve arayüz dinamik olarak oluşur.
- ID tabanlı mesajlaşma korunur; yanlış cihaza komut gitmez.

İlgili dosyalar:
- espfrontend/public/scripts/main.js
- espfrontend/public/scripts/wol_status.js
- espfrontend/server.js




