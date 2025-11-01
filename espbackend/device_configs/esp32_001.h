// ESP32-001 Konfigürasyonu - Ana Kontrol
#ifndef ESP32_001_CONFIG_H
#define ESP32_001_CONFIG_H

#ifdef DEVICE_ID
#undef DEVICE_ID
#endif
#define DEVICE_ID "esp32_fatih"

#ifdef DEVICE_NAME
#undef DEVICE_NAME
#endif
#define DEVICE_NAME "FATIHESP"

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

// WOL verisini .cpp dosyasına makro ile aktar
#define WOL_DEVICES_INIT { \
  {"Server",{0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0}, \
  {"B350",  {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0}, \
  {"Main",  {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0} \
}
#define WOL_DEVICE_COUNT 3

#endif
