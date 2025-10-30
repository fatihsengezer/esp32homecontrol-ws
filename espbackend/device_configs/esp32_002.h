// ESP32-002 Konfigürasyonu - Yatak Odası
#ifndef ESP32_002_CONFIG_H
#define ESP32_002_CONFIG_H

#ifdef DEVICE_ID
#undef DEVICE_ID
#endif
#define DEVICE_ID "esp32_yusuf"

#ifdef DEVICE_NAME
#undef DEVICE_NAME
#endif
#define DEVICE_NAME "YUSUFESP"

#ifdef DEVICE_VERSION
#undef DEVICE_VERSION
#endif
#define DEVICE_VERSION "1.0.0"

// WebSocket Server IP
#define WS_SERVER_IP "fatihdev.xyz"
#define WS_SERVER_PORT 5131

// Röle Pinleri - DeviceConfig.h'den alınıyor

#include <Arduino.h>
#include "../include/DeviceConfig.h"

// WOL broadcast IP (isteğe göre değiştir)
#undef WOL_BROADCAST_IP
#define WOL_BROADCAST_IP "192.168.1.255"

// Cihaz özel WOL listesi (örnek)
// Derleme biriminde tek tanım kalsın diye makro ile .cpp tarafına veri geçilir
#define WOL_DEVICES_INIT { \
  {"PC", {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0} \
}
#define WOL_DEVICE_COUNT 1

#endif
