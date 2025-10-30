// ESP32-003 Konfigürasyonu - Mutfak
#ifndef ESP32_003_CONFIG_H
#define ESP32_003_CONFIG_H

#ifdef DEVICE_ID
#undef DEVICE_ID
#endif
#define DEVICE_ID "esp32_003"

#ifdef DEVICE_NAME
#undef DEVICE_NAME
#endif
#define DEVICE_NAME "Mutfak ESP32"

#ifdef DEVICE_VERSION
#undef DEVICE_VERSION
#endif
#define DEVICE_VERSION "1.0.0"

// WebSocket Server IP
#define WS_SERVER_IP "192.168.1.11"
#define WS_SERVER_PORT 8080

// Röle Pinleri - DeviceConfig.h'den alınıyor

#include <Arduino.h>
#include "../include/DeviceConfig.h"

// WOL broadcast IP (lokal ağ için örnek)
#undef WOL_BROADCAST_IP
#define WOL_BROADCAST_IP "192.168.1.255"

// WOL verisini .cpp dosyasına makro ile aktar
#define WOL_DEVICES_INIT { \
  {"KitchenPC", {0x00, 0x11, 0x22, 0x33, 0x44, 0x55}, IPAddress(192,168,1,50), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0} \
}
#define WOL_DEVICE_COUNT 1

#endif
