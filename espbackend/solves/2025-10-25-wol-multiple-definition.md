Başlık: ESP32 WOL çoklu tanım (multiple definition) ve makro yeniden tanım uyarıları
Tarih: 2025-10-25

Sorun:
- `wolDevices` ve `wolDeviceCount` birden fazla çeviri biriminde tanımlandığı için link aşamasında "multiple definition" hatası alındı.
- `DEVICE_ID` ve `DEVICE_NAME` makroları `DeviceConfig.h` ve cihaz başlıklarında iki kez tanımlandığı için uyarılar oluştu.

Çözüm:
- WOL dizi/eleman tanımını başlıkta yapmak yerine .cpp dosyasına taşındı.
- Cihaz başlıklarında ham dizi tanımı yerine, veri `WOL_DEVICES_INIT` ve `WOL_DEVICE_COUNT` makroları ile sağlandı.
- `src/DeviceConfig.cpp` içinde:
  - `#include "../device_configs/SelectedDevice.h"` sonra `#include "DeviceConfig.h"`
  - `WOLDevice wolDevices[] = WOL_DEVICES_INIT;`
  - `const int wolDeviceCount = WOL_DEVICE_COUNT;`
- `DeviceConfig.h` içinde `DEVICE_ID/NAME/VERSION` default tanımlar `#ifndef` ile korumalı hale getirildi.
- Cihaz başlıklarında (`esp32_00x.h`) `DEVICE_ID/NAME/VERSION` için önce `#undef` sonra tanım yapıldı.
- Aktif cihaz seçimi `device_configs/SelectedDevice.h` üzerinden tek noktaya alındı.

Kullanım notları:
- Aktif cihaz: `device_configs/SelectedDevice.h` içindeki include değiştir.
- WOL broadcast IP: cihaz başlığında `#undef WOL_BROADCAST_IP` + `#define WOL_BROADCAST_IP "x.y.z.255"` ile özelleştir.

Derleme:
- Temiz derleme ile doğrulandı: `pio run -t clean && pio run -v`





