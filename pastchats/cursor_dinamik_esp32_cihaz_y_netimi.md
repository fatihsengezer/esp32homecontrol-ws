# Dinamik esp32 cihaz yönetimi
_Exported on 10/31/2025 at 13:55:58 GMT+3 from Cursor (1.7.52)_

---

**User**

esp tarafi cihazlarinda soyle bir sistem olsun. cihazda kac tane role oldugunu esp32_xxx.h belirlesin. rolenin olup olmadigi veya kac tane oldugunu bilmemiz sitenin dinamik bir yapida olmasi icin. esp sorgulanacak ve esp kendisi hakkinda bilgi verecek. (kac tane wol cihazim var, kac tane rolem var)

ve wol bilgileri site paneli uzerinden degistirilebilecek. cihaza,

Bilgisayar Adi,
MAC ADRESI.
Broadcat IP,
PORT

gibi degiskenlere sahip bir modalimiz olacak ve espye bu bilgileri gondereecek. bu bilgiler esp'ye kayit olacak ve icinde sakli kalacak. 


index.html guisi artik dinamik olusturulacak. role sayisi esp'den gelen bilgilerle belirlenecek (espden gelen bilgiler database'de de saklanabilir)
eger bir cihazda role yoksa index.html'de role kontrol paneli kismi cikmayacak ble

---

**Cursor**

Cihaz yeteneklerini dinamik hale getirmek ve hem ESP tarafında hem de web arayüzünde bununla uyumlu bir yapı kurmak için kod tabanını hızlıca tarayıp mevcut mimariye entegre olacak şekilde eklemeler yapacağım. Önce ESP tarafındaki `main.cpp`, `DeviceConfig.*`, web arayüzü `data/index.html` ve `data/script.js` dosyalarını; ardından frontend `public/index.html` ve `public/scripts/main.js`/`admin.js` dosyalarını inceleyeceğim. Devamında görevleri parçalara böleceğim ve uygulamaya başlayacağım.

Cihaz yeteneklerini gerçekten nereden aldığımızı ve mevcut WOL/relay yapılarını görmek için ilgili dosyaları aynı anda açıyorum: cihaz konfigürasyon başlıkları, `DeviceConfig.*`, ve sunucu tarafı `server.js`. Ardından gerekli düzenlemeleri planlayıp uygulayacağım.

Cihaz yeteneklerini dinamik ve kalıcı hale getirmek için dosyalarda hem ESP tarafında (WOL profilleri ve röle sayısı), hem de sunucu/frontend tarafında (API ve modal form) değişiklikler yapacağım. Önce frontend `admin.js` içinde mevcut WOL veya cihaz ayarları bölümleri var mı kontrol edeceğim, ardından ESP tarafında `DeviceConfig.h/.cpp` ve `main.cpp` değişikliklerini planlayacağım. Şimdi ilgili dosyaları arıyorum.

Cihaz tarafındaki WOL ve röle yapısını dinamikleştirmeden önce, frontend ana sayfanın WOL ve röle kontrolünü nasıl oluşturduğunu görmek için `public/scripts/main.js` dosyasını ve `public/index.html` dosyasını paralel olarak okuyorum. Ayrıca `public/admin.html` içinde WOL profili modalı var mı kontrol edeceğim.

Önce gerekli işleri parçaladım ve uygulamaya başlıyorum: cihaz seviyesinde röle sayısını override edilebilir yaptım, WOLDevice’e broadcast ve port ekleyeceğim, ESP’de WOL profillerini NVS’de kalıcı tutup JSON’la güncelleyeceğim, `main.cpp`’yi yeni WOL ve JSON parse’a göre uyarlayacağım, frontend’de relay panelini 0 olduğunda gizleyeceğim ve admin arayüzüne “Cihaza Senkronize Et” ekleyip API üzerinden ESP’ye WOL profillerini göndereceğim. Şimdi bu adımlar için TODO’ları oluşturup ilk düzenlemeleri yapıyorum.

Şimdi ESP tarafında dinamik röle ve WOL profilleri için gerekli düzenlemeleri yapıyorum: `DeviceConfig.h`’da override desteklerini ekleyeceğim, `WOLDevice` yapısını genişleteceğim, `DeviceConfig.cpp`’de runtime WOL dizisini tanımlayıp varsayılanları kopyalayacağım, `main.cpp`’de WOL gönderimini ve config parse/persist işlemlerini uygulayacağım, frontend `main.js`’de relay panelini 0 iken gizleyeceğim ve admin arayüzüne “Cihaza Senkronize Et” butonu ile senkronizasyon fonksiyonunu ekleyeceğim.

```cpp
#ifndef DEVICECONFIG_H
#define DEVICECONFIG_H

#include <Arduino.h>

// ==================== ESP32 CİHAZ KONFİGÜRASYONU ====================

// Cihaz Kimlik Bilgileri
// Her cihaz için farklı ID kullanın:
// esp32_001, esp32_002, esp32_003, vb.
#ifndef DEVICE_ID
#define DEVICE_ID "esp32_default"
#endif
#ifndef DEVICE_NAME
#define DEVICE_NAME "ESP32"
#endif
#ifndef DEVICE_VERSION
#define DEVICE_VERSION "1.0.0"
#endif

// Donanım Konfigürasyonu
#ifndef RELAY_COUNT
#define RELAY_COUNT 8
#endif
#define MAX_TASK_QUEUE 10
#define HEARTBEAT_INTERVAL 5000   // 5 saniye
#define TASK_TIMEOUT 5000         // 5 saniye

// Pin Tanımlamaları (Cihaz bazlı override için RELAY_PINS_DEFINED tanımlanabilir)
#ifndef RELAY_PINS_DEFINED
const int relayPins[RELAY_COUNT] = {32, 33, 25, 26, 27, 14, 12, 13};
#endif

// ==================== VERİ YAPILARI ====================

// Röle Durumu
struct RelayState {
  bool state = false;
  unsigned long lastChange = 0;
  String name = "";
};

// Görev Kuyruğu
struct TaskItem {
  String taskId;
  String action;
  int relayId;
  bool state;
  unsigned long timestamp;
  bool isProcessed = false;
};

// Cihaz Durumu
struct DeviceStatus {
  String deviceId = DEVICE_ID;
  String deviceName = DEVICE_NAME;
  bool isOnline = false;
  unsigned long lastHeartbeat = 0;
  unsigned long uptime = 0;
  RelayState relays[RELAY_COUNT];
  int taskCount = 0;
  TaskItem taskQueue[MAX_TASK_QUEUE];
};

// ==================== WOL YAPILANDIRMASI ====================
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip;
  IPAddress broadcast; // WOL hedef broadcast IP
  uint16_t port;       // WOL UDP portu (genellikle 9)
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

#ifndef WOL_BROADCAST_IP
#define WOL_BROADCAST_IP "192.168.1.255"
#endif

// Maksimum profil sayısı (runtime güncelleme için)
#ifndef MAX_WOL_DEVICES
#define MAX_WOL_DEVICES 10
#endif

extern WOLDevice wolDevices[];
extern int wolDeviceCount;

// ==================== GLOBAL DEĞİŞKENLER ====================
extern DeviceStatus deviceStatus;

// ==================== FONKSİYON PROTOTİPLERİ ====================

// Cihaz Yönetimi
void initDevice();
void updateHeartbeat();
void processTaskQueue();
void addTaskToQueue(String taskId, String action, int relayId, bool state);

// Mesaj Protokolü
String createHeartbeatMessage();
String createStatusMessage();
bool parseCommandMessage(String message, String& action, int& relayId, bool& state);

// Röle Yönetimi
void setRelay(int index, bool state);
void toggleRelay(int index);
void updateRelayState(int index, bool state);

// Yardımcı Fonksiyonlar
String getDeviceInfo();
unsigned long getUptime();

#endif

```

Cihaz tarafında değişiklikleri uygulamaya başlıyorum: yapı tanımlarını güncelledim. Şimdi cihaz başlıklarındaki WOL makrolarını yeni yapıya uyarlayıp, wolDeviceCount değişkenini güncelleyeceğim; ardından ESP'de WOL gönderimini ve config JSON parse/persist fonksiyonlarını ekleyeceğim. Frontend için relay paneli 0 olduğunda gizleme ve admin'e “Cihaza Senkronize Et” butonunu eklemeye geçeceğim.

```cpp
#include "../device_configs/SelectedDevice.h"
#include "DeviceConfig.h"

// WOL cihaz tanımlarını tek bir .cpp içinde gerçekleştir
#ifndef WOL_DEVICES_INIT
#define WOL_DEVICES_INIT {}
#endif
#ifndef WOL_DEVICE_COUNT
#define WOL_DEVICE_COUNT 0
#endif

WOLDevice wolDevices[] = WOL_DEVICES_INIT;
int wolDeviceCount = WOL_DEVICE_COUNT;
#include <ArduinoJson.h>
#include <WiFi.h>

// Global cihaz durumu
DeviceStatus deviceStatus;

// ==================== CİHAZ YÖNETİMİ ====================

void initDevice() {
  Serial.println("=== ESP32 Modüler Sistem Başlatılıyor ===");
  Serial.println("Cihaz ID: " + String(DEVICE_ID));
  Serial.println("Cihaz Adı: " + String(DEVICE_NAME));
  Serial.println("Röle Sayısı: " + String(RELAY_COUNT));
  
  // Röle pinlerini başlat
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], LOW);
    deviceStatus.relays[i].state = false;
    deviceStatus.relays[i].name = "Röle " + String(i + 1);
    deviceStatus.relays[i].lastChange = millis();
  }
  
  // Cihaz durumunu başlat
  deviceStatus.isOnline = false;
  deviceStatus.lastHeartbeat = millis();
  deviceStatus.uptime = millis();
  deviceStatus.taskCount = 0;
  
  Serial.println("Cihaz başlatma tamamlandı!");
  
  // WOL broadcast/port default'larını doldur (geriye dönük güvenlik)
  IPAddress defaultBroadcast;
  defaultBroadcast.fromString(String(WOL_BROADCAST_IP));
  for (int i = 0; i < wolDeviceCount; i++) {
    // 0.0.0.0 ise broadcast'i varsayılanla doldur
    if ((uint32_t)wolDevices[i].broadcast == 0) {
      wolDevices[i].broadcast = defaultBroadcast;
    }
    if (wolDevices[i].port == 0) {
      wolDevices[i].port = 9;
    }
  }
}

void updateHeartbeat() {
  static unsigned long lastHeartbeat = 0;
  unsigned long now = millis();
  
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    deviceStatus.lastHeartbeat = now;
    deviceStatus.uptime = now - deviceStatus.uptime;
    lastHeartbeat = now;
    
    // Heartbeat mesajı gönder (WebSocket üzerinden)
    String heartbeatMsg = createHeartbeatMessage();
    Serial.println("Heartbeat: " + heartbeatMsg);
    // Bu mesaj WebSocket'e gönderilecek - main.cpp'de webSocket.sendTXT() ile gönderilecek
  }
}

void processTaskQueue() {
  for (int i = 0; i < deviceStatus.taskCount; i++) {
    TaskItem& task = deviceStatus.taskQueue[i];
    
    if (!task.isProcessed) {
      // Görevi işle
      if (task.action == "relay") {
        setRelay(task.relayId, task.state);
        Serial.println("Görev işlendi: " + task.taskId + " - Röle " + String(task.relayId) + " " + (task.state ? "AÇ" : "KAPAT"));
      }
      
      task.isProcessed = true;
    }
  }
  
  // İşlenmiş görevleri temizle
  int newCount = 0;
  for (int i = 0; i < deviceStatus.taskCount; i++) {
    if (!deviceStatus.taskQueue[i].isProcessed) {
      if (newCount != i) {
        deviceStatus.taskQueue[newCount] = deviceStatus.taskQueue[i];
      }
      newCount++;
    }
  }
  deviceStatus.taskCount = newCount;
}

void addTaskToQueue(String taskId, String action, int relayId, bool state) {
  if (deviceStatus.taskCount < MAX_TASK_QUEUE) {
    TaskItem& task = deviceStatus.taskQueue[deviceStatus.taskCount];
    task.taskId = taskId;
    task.action = action;
    task.relayId = relayId;
    task.state = state;
    task.timestamp = millis();
    task.isProcessed = false;
    deviceStatus.taskCount++;
    
    Serial.println("Görev kuyruğa eklendi: " + taskId);
  } else {
    Serial.println("Görev kuyruğu dolu! Görev atlandı: " + taskId);
  }
}

// ==================== MESAJ PROTOKOLÜ ====================

String createHeartbeatMessage() {
  StaticJsonDocument<1024> doc;
  doc["type"] = "heartbeat";
  doc["deviceId"] = DEVICE_ID;
  doc["deviceName"] = DEVICE_NAME;
  doc["status"] = "online";
  doc["uptime"] = millis();

  // Ağ bilgileri
  doc["ip_address"] = WiFi.localIP().toString();
  doc["mac_address"] = WiFi.macAddress();

  JsonArray relayStates = doc.createNestedArray("relayStates");
  for (int i = 0; i < RELAY_COUNT; i++) {
    JsonObject relay = relayStates.createNestedObject();
    relay["id"] = i;
    relay["state"] = deviceStatus.relays[i].state;
  }

  String output;
  serializeJson(doc, output);
  return output;
}

String createStatusMessage() {
  StaticJsonDocument<1024> doc;
  doc["type"] = "status";
  doc["deviceId"] = DEVICE_ID;

  JsonArray relayStates = doc.createNestedArray("relayStates");
  for (int i = 0; i < RELAY_COUNT; i++) {
    JsonObject relay = relayStates.createNestedObject();
    relay["id"] = i;
    relay["state"] = deviceStatus.relays[i].state;
  }

  String output;
  serializeJson(doc, output);
  return output;
}

bool parseCommandMessage(String message, String& action, int& relayId, bool& state) {
  // JSON mesajını parse et
  if (message.indexOf("\"type\":\"command\"") == -1) return false;
  
  // Action'ı al
  int actionStart = message.indexOf("\"action\":\"") + 10;
  int actionEnd = message.indexOf("\"", actionStart);
  if (actionStart == 9 || actionEnd == -1) return false;
  action = message.substring(actionStart, actionEnd);
  
  // Relay ID'yi al
  int relayStart = message.indexOf("\"relayId\":") + 10;
  int relayEnd = message.indexOf(",", relayStart);
  if (relayEnd == -1) relayEnd = message.indexOf("}", relayStart);
  if (relayStart == 9 || relayEnd == -1) return false;
  relayId = message.substring(relayStart, relayEnd).toInt();
  
  // State'i al
  int stateStart = message.indexOf("\"state\":\"") + 9;
  int stateEnd = message.indexOf("\"", stateStart);
  if (stateStart == 8 || stateEnd == -1) return false;
  String stateStr = message.substring(stateStart, stateEnd);
  state = (stateStr == "on" || stateStr == "true");
  
  return true;
}

// ==================== RÖLE YÖNETİMİ ====================

void setRelay(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  updateRelayState(index, state);
  
  Serial.println("Röle " + String(index) + " " + (state ? "AÇILDI" : "KAPANDI"));
}

void toggleRelay(int index) {
  if (index < 0 || index >= RELAY_COUNT) return;
  setRelay(index, !deviceStatus.relays[index].state);
}

void updateRelayState(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
}

// ==================== YARDIMCI FONKSİYONLAR ====================

String getDeviceInfo() {
  String info = "=== CİHAZ BİLGİLERİ ===\n";
  info += "ID: " + String(DEVICE_ID) + "\n";
  info += "Ad: " + String(DEVICE_NAME) + "\n";
  info += "Versiyon: " + String(DEVICE_VERSION) + "\n";
  info += "Çalışma Süresi: " + String(getUptime() / 1000) + " saniye\n";
  info += "Röle Durumları:\n";
  
  for (int i = 0; i < RELAY_COUNT; i++) {
    info += "  " + deviceStatus.relays[i].name + ": " + (deviceStatus.relays[i].state ? "AÇIK" : "KAPALI") + "\n";
  }
  
  return info;
}

unsigned long getUptime() {
  return millis() - deviceStatus.uptime;
}

```

```cpp
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

```

```cpp
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
  {"Server",  {0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0}, \
  {"B350", {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0}, \
  {"Main", {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0} \
}
#define WOL_DEVICE_COUNT 3

#endif

```

```cpp
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

```

WOL yapılarını kalıcı ve dinamik hale getirmek için ESP ve frontend tarafında düzenlemelere başlıyorum: include sırasını düzeltiyor, WOL gönderimini yayın IP/port ile yapıyor, Preferences ile WOL profilleri kalıcılaştırıyor ve frontend’de relay/wol panellerini dinamik gizliyoruz. Şimdi bu dosyalara gerekli edits’i uyguluyorum.

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
// Cihaz konfigürasyonunu seçin (SelectedDevice.h üzerinden tek noktadan yönetilir)
#include "../device_configs/SelectedDevice.h"
#include "DeviceConfig.h"
#include <ESP32Ping.h> // Ping için gerekli
#include "wifi_setup.h" // WiFi setup GUI

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

WiFiUDP udp;
WebSocketsClient webSocket;

// Komut debouncing ve relay cooldown kontrolü
static String lastRelayCmd = "";
static unsigned long lastRelayCmdTime = 0;
static unsigned long relayCooldownUntil[RELAY_COUNT] = {0};

// ----------------- WOL -----------------
void sendWOL(const WOLDevice &dev) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], dev.mac, 6);

  udp.beginPacket(dev.broadcast, dev.port > 0 ? dev.port : 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
}

// ----------------- WOL Persist -----------------
Preferences wolPrefs;

static bool parseMac(const String &macStr, byte out[6]) {
  int values[6];
  if (sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x", &values[0], &values[1], &values[2], &values[3], &values[4], &values[5]) != 6) return false;
  for (int i = 0; i < 6; i++) out[i] = (byte)values[i];
  return true;
}

void loadWOLProfilesFromPrefs() {
  if (!wolPrefs.begin("wolconfig", true)) return;
  String json = wolPrefs.getString("profiles", "");
  wolPrefs.end();
  if (json.length() == 0) return;

  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) return;
  if (!doc.is<JsonArray>()) return;

  JsonArray arr = doc.as<JsonArray>();
  int count = 0;
  for (JsonObject p : arr) {
    if (count >= MAX_WOL_DEVICES) break;
    const char* name = p["name"] | "WOL";
    const char* mac = p["mac"] | "";
    const char* bcast = p["broadcast_ip"] | "";
    uint16_t port = p["port"] | 9;
    const char* ipStr = p["ip"] | "0.0.0.0";

    wolDevices[count].name = name;
    byte macb[6];
    if (parseMac(String(mac), macb)) memcpy(wolDevices[count].mac, macb, 6);
    IPAddress ip; ip.fromString(String(ipStr)); wolDevices[count].ip = ip;
    IPAddress bc; if (!String(bcast).length()) { bc.fromString(String(WOL_BROADCAST_IP)); } else { bc.fromString(String(bcast)); }
    wolDevices[count].broadcast = bc;
    wolDevices[count].port = port;
    wolDevices[count].status = WOLDevice::OFFLINE;
    wolDevices[count].bootStartTime = 0;
    count++;
  }
  wolDeviceCount = count;
}

bool saveWOLProfilesToPrefs(const String &json) {
  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc.is<JsonArray>()) return false;
  if (!wolPrefs.begin("wolconfig", false)) return false;
  wolPrefs.putString("profiles", json);
  wolPrefs.end();
  return true;
}

bool updateWOLProfilesFromJson(const String &json) {
  if (!saveWOLProfilesToPrefs(json)) return false;
  loadWOLProfilesFromPrefs();
  return true;
}

// ----------------- Yardımcı: Mesaj ID kontrolü -----------------
// Mesaj içinde " id:<DEVICE_ID>" varsa ve bizim cihaz ID'miz ile eşleşmiyorsa true döner (yani bu cihaza ait değil)
bool hasIdButNotForThisDevice(const String &msg) {
  int idPos = msg.indexOf(" id:");
  if (idPos == -1) return false; // ID belirtilmemiş, geriye dönük uyumluluk: kabul et
  int start = idPos + 4; // " id:" sonrası
  int end = msg.indexOf(' ', start);
  if (end == -1) end = msg.length();
  String targetId = msg.substring(start, end);
  targetId.trim();
  return targetId.length() > 0 && targetId != String(DEVICE_ID);
}

// ----------------- Cihaz yeteneklerini gönder -----------------
void sendCapabilities() {
  // JSON: { type:"capabilities", deviceId, relayCount, wol:[{index,name},...] }
  String json = "{";
  json += "\"type\":\"capabilities\",";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"relayCount\":" + String(RELAY_COUNT) + ",";
  json += "\"wol\":[";
  for (int i = 0; i < wolDeviceCount; i++) {
    json += "{\"index\":" + String(i) + ",\"name\":\"" + String(wolDevices[i].name) + "\"}";
    if (i < wolDeviceCount - 1) json += ",";
  }
  json += "]";
  json += "}";
  webSocket.sendTXT(json);
  Serial.println("Capabilities gönderildi: " + json);
}

// ----------------- Status gönder -----------------
void sendStatus(WOLDevice &dev) {
  String statusStr;
  switch(dev.status) {
    case WOLDevice::OFFLINE: statusStr = "OFFLINE"; break;
    case WOLDevice::BOOTING: statusStr = "BOOTING"; break;
    case WOLDevice::RUNNING: statusStr = "RUNNING"; break;
    case WOLDevice::FAILED:  statusStr = "FAILED"; break;
  }
  webSocket.sendTXT("status:" + String(dev.name) + ":" + statusStr);
}

// ----------------- Tüm status gönder -----------------
void sendAllStatuses() {
  for (int i = 0; i < wolDeviceCount; i++) {
    sendStatus(wolDevices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state + " id:" + String(DEVICE_ID));
    Serial.println("relay:" + String(i) + ":" + state);
  }
}

// ----------------- Röle kontrol (WebSocket ile) -----------------
void setRelayWithWebSocket(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  // Durum zaten istenen ile aynıysa tekrar işlem yapma
  if (deviceStatus.relays[index].state == state) {
    return;
  }
  
  // Hızlı tekrarlara karşı per-relay cooldown (200 ms)
  unsigned long nowMs = millis();
  if (relayCooldownUntil[index] > nowMs) {
    return;
  }
  relayCooldownUntil[index] = nowMs + 200;

  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr + " id:" + String(DEVICE_ID));
  
  Serial.println("Röle " + String(index) + " " + (state ? "AÇILDI" : "KAPANDI"));
  Serial.println("relay:" + String(index) + ":" + stateStr);
  ledFlash();
}

void toggleRelayWithWebSocket(int index) {
  if (index < 0 || index >= RELAY_COUNT) return;
  setRelayWithWebSocket(index, !deviceStatus.relays[index].state);
}

// ----------------- Ping kontrolü -----------------
void checkDevices() {
  static unsigned long lastFastPing = 0;
  static unsigned long lastSlowPing = 0;
  static unsigned long lastOfflinePing = 0;

  unsigned long now = millis();

  // 1️⃣ BOOTING cihazlar: hızlı ping (500 ms)
  if (now - lastFastPing >= 500) {
    lastFastPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::BOOTING) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }

  // 2️⃣ RUNNING cihazlar: hafif ping (5 s)
  if (now - lastSlowPing >= 5000) {
    lastSlowPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::RUNNING) {
        if (!Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
      }
    }
  }

  // 3️⃣ OFFLINE cihazlar: arada ping (5 dk)
  if (now - lastOfflinePing >= 300000) {
    lastOfflinePing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::OFFLINE) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }
}

// ----------------- JSON değer alma (basit) -----------------
String getValue(String data, String key) {
  int start = data.indexOf("\"" + key + "\":");
  if (start == -1) return "";
  start += key.length() + 3;
  int end = data.indexOf(",", start);
  if (end == -1) end = data.indexOf("}", start);
  return data.substring(start, end);
}

// ----------------- Device Token Management -----------------
String deviceToken = "";
String pairingToken = "";
bool isPaired = false;

// Token kaydetme (EEPROM veya NVS)
void saveToken(String token) {
  // Token'daki çift tırnakları temizle
  deviceToken = token;
  deviceToken.replace("\"", "");
  // TODO: EEPROM veya NVS'ye kaydet
  Serial.println("Token kaydedildi: " + deviceToken.substring(0, 8) + "...");
}

// Token yükleme (EEPROM veya NVS'den)
String loadToken() {
  // TODO: EEPROM veya NVS'den yükle
  return deviceToken;
}

// ----------------- Config Handling -----------------
struct DeviceConfig {
  String wifi_ssid = "";
  String wifi_pass = "";
  bool use_dhcp = true;
  String static_ip = "";
  String wol_profiles = "[]"; // JSON string
};

DeviceConfig currentConfig;

// Config'i uygula
void applyConfig(const DeviceConfig& config) {
  Serial.println("=== Konfigürasyon Uygulanıyor ===");
  
  // WiFi ayarlarını güncelle
  if (config.wifi_ssid.length() > 0 && config.wifi_pass.length() > 0) {
    Serial.println("WiFi ayarları güncelleniyor...");
    // TODO: WiFi ayarlarını güncelle ve yeniden bağlan
    // WiFi.begin(config.wifi_ssid.c_str(), config.wifi_pass.c_str());
  }
  
  // IP ayarlarını güncelle
  if (!config.use_dhcp && config.static_ip.length() > 0) {
    Serial.println("Statik IP ayarlanıyor: " + config.static_ip);
    // TODO: Statik IP ayarla
  }
  
  // WOL profillerini güncelle
  if (config.wol_profiles.length() > 0) {
    Serial.println("WOL profilleri güncelleniyor...");
    // TODO: WOL profillerini parse et ve güncelle
  }
  
  currentConfig = config;
  Serial.println("Konfigürasyon uygulandı");
}

// Config ACK mesajı gönder
void sendConfigAck(String requestId, bool success, String errorMsg = "") {
  String ackMsg = "{";
  ackMsg += "\"type\":\"config_applied\",";
  ackMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  ackMsg += "\"request_id\":\"" + requestId + "\",";
  ackMsg += "\"status\":\"" + String(success ? "ok" : "error") + "\",";
  ackMsg += "\"details\":{";
  ackMsg += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  ackMsg += "\"mac\":\"" + WiFi.macAddress() + "\"";
  ackMsg += "},";
  ackMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  if (!success && errorMsg.length() > 0) {
    ackMsg += ",\"error\":\"" + errorMsg + "\"";
  }
  ackMsg += "}";
  
  webSocket.sendTXT(ackMsg);
  Serial.println("Config ACK gönderildi: " + ackMsg);
}

// Config mesajını işle
void handleConfigMessage(String message) {
  Serial.println("Config mesajı alındı: " + message);
  
  String requestId = getValue(message, "request_id");
  String token = getValue(message, "token");
  
  // Token doğrulama (basit)
  if (token.length() > 0 && token != deviceToken && token != pairingToken) {
    Serial.println("Geçersiz token");
    sendConfigAck(requestId, false, "Geçersiz token");
    return;
  }
  
  // Config JSON'unu parse et
  String configJson = getValue(message, "config");
  if (configJson.length() == 0) {
    Serial.println("Config JSON bulunamadı");
    sendConfigAck(requestId, false, "Config JSON bulunamadı");
    return;
  }
  
  // Config'i parse et ve uygula
  DeviceConfig newConfig;
  newConfig.wifi_ssid = getValue(configJson, "wifi_ssid");
  newConfig.wifi_pass = getValue(configJson, "wifi_pass");
  newConfig.use_dhcp = getValue(configJson, "use_dhcp") == "true";
  newConfig.static_ip = getValue(configJson, "static_ip");
  newConfig.wol_profiles = getValue(configJson, "wol_profiles");
  
  // Config'i uygula
  applyConfig(newConfig);
  
  // Başarılı ACK gönder
  sendConfigAck(requestId, true);
}

// Device identify mesajı gönder
void sendDeviceIdentify() {
  // Token'daki çift tırnakları temizle
  String cleanToken = deviceToken;
  cleanToken.replace("\"", "");
  
  String identifyMsg = "{";
  identifyMsg += "\"type\":\"identify\",";
  identifyMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  identifyMsg += "\"firmware\":\"v1.0.0\",";
  identifyMsg += "\"token\":\"" + cleanToken + "\",";
  identifyMsg += "\"capabilities\":[\"wol\",\"wifi-config\"],";
  identifyMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  identifyMsg += "}";
  
  webSocket.sendTXT(identifyMsg);
  Serial.println("Device identify gönderildi: " + identifyMsg);
}

// ----------------- WebSocket olayları -----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED: {
      Serial.println("=== WebSocket Bağlandı ===");
      Serial.println("Server: " + String(WS_SERVER_IP) + ":" + String(WS_SERVER_PORT));
      Serial.println("Cihaz ID: " + String(DEVICE_ID));
      Serial.println("Cihaz Adı: " + String(DEVICE_NAME));
      
      // Yeni JSON heartbeat mesajı gönder
      String heartbeatMsg = createHeartbeatMessage();
      webSocket.sendTXT(heartbeatMsg);
      Serial.println("Heartbeat gönderildi: " + heartbeatMsg);
      ledFlash();
      // Bağlantı sonrası yetenekleri bildir
      sendCapabilities();
      
      // Device identify mesajı gönder
      sendDeviceIdentify();
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

      // Tekrarlayan röle komutlarını filtrele (debounce)
      unsigned long nowMs = millis();
      if (msg.startsWith("relay:")) {
        if (msg == lastRelayCmd && (nowMs - lastRelayCmdTime) < 300) {
          // Aynı komut kısa süre içinde tekrar geldiyse yok say
          break;
        }
        lastRelayCmd = msg;
        lastRelayCmdTime = nowMs;
      }

      // ID hedefleme kontrolü (mesajda id varsa ve bize ait değilse yok say)
      if (hasIdButNotForThisDevice(msg)) {
        break;
      }

      // --- 1️⃣ Relay kontrol ---
      if (msg.startsWith("relay:")) {
        String command = msg.substring(6);

        // 🔹 Tüm röleleri aç/kapat/toggle et
        if (command == "all:on") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, true);
        } 
        else if (command == "all:off") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, false);
        } 
        else if (command == "all") {
          for (int i = 0; i < RELAY_COUNT; i++) toggleRelayWithWebSocket(i);
        } 
        else {
          // 🔹 Tekli röle kontrol
          int idx = command.substring(0, 1).toInt();
          String action = "";
          if (command.length() > 2) action = command.substring(2);

          if (command.endsWith(":on")) {
            Serial.println("Röle " + String(idx) + " AÇILIYOR");
            setRelayWithWebSocket(idx, true);
          }
          else if (command.endsWith(":off")) {
            Serial.println("Röle " + String(idx) + " KAPATILIYOR");
            setRelayWithWebSocket(idx, false);
          }
          else {
            Serial.println("Röle " + String(idx) + " TOGGLE");
            toggleRelayWithWebSocket(idx);  // toggle desteği
          }
        }
      }
      // --- 2️⃣ Röle durumlarını isteme ---
      else if (msg.startsWith("getRelayStatus")) { // getRelayStatus [id:xxx]
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < wolDeviceCount) {
          sendWOL(wolDevices[devIndex]);
          wolDevices[devIndex].status = WOLDevice::BOOTING;
          wolDevices[devIndex].bootStartTime = millis();
          sendStatus(wolDevices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg.startsWith("getWolStatus")) { // getWolStatus [id:xxx]
        for (int i = 0; i < wolDeviceCount; i++) {
          WOLDevice &dev = wolDevices[i];
          if (dev.status == WOLDevice::BOOTING) {
            sendStatus(dev);
            continue;
          }

          bool reachable = Ping.ping(dev.ip, 1);
          if (reachable && dev.status != WOLDevice::RUNNING) dev.status = WOLDevice::RUNNING;
          else if (!reachable && dev.status != WOLDevice::BOOTING) dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
        webSocket.sendTXT("statusCheck:done");
        ledFlash();
      }

      // --- 7️⃣ Yetenekleri isteme ---
      else if (msg.startsWith("getCapabilities")) { // getCapabilities [id:xxx]
        sendCapabilities();
      }

      // --- 5️⃣ Buzzer ---
      else if (msg.startsWith("{\"type\":\"buzzer\"")) {
        int pitch = getValue(msg, "pitch").toInt();
        int duration = getValue(msg, "duration").toInt();
        float volume = getValue(msg, "volume").toFloat();

        if (pitch <= 0) pitch = 2000;
        if (duration <= 0) duration = 300;
        if (volume < 0 || volume > 1) volume = 1.0;

        buzzerPlay(pitch, duration, volume);
        webSocket.sendTXT("buzzer:done");
        ledFlash();
      }

      // --- 6️⃣ LED kontrol ---
      else if (msg == "led:on") {
        ledOn();
        webSocket.sendTXT("led:done");
      }
      else if (msg == "led:off") {
        ledOff();
        webSocket.sendTXT("led:done");
      }

      // --- 7️⃣ Config mesajları ---
      else if (msg.startsWith("{\"type\":\"update_config\"")) {
        handleConfigMessage(msg);
      }
      else if (msg.startsWith("{\"type\":\"pairing_required\"")) {
        // Pairing token alındı
        String token = getValue(msg, "pairing_token");
        if (token.length() > 0) {
          pairingToken = token;
          deviceToken = token; // Pairing token'ı device token olarak kullan
          saveToken(token); // Token'ı kaydet
          Serial.println("Pairing token alındı: " + token.substring(0, 8) + "...");
          // Pairing token ile tekrar identify gönder
          delay(1000);
          sendDeviceIdentify();
        }
      }
      else if (msg.startsWith("{\"type\":\"identify_success\"")) {
        // Cihaz başarıyla tanımlandı
        Serial.println("Cihaz başarıyla tanımlandı");
        isPaired = true;
        
        // Persistent token alındıysa kaydet
        String persistentToken = getValue(msg, "persistent_token");
        if (persistentToken.length() > 0) {
          deviceToken = persistentToken;
          saveToken(persistentToken);
          Serial.println("Persistent token kaydedildi: " + persistentToken.substring(0, 8) + "...");
        } else if (pairingToken.length() > 0) {
          saveToken(pairingToken);
          pairingToken = "";
        }
      }

      break;
    }
  }
}

// ----------------- WiFi bağlantısı -----------------
bool connectToWiFi() {
  int rssiMax = -1000;
  int bestNetworkIndex = -1;

  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String ssidFound = WiFi.SSID(i);
    for (int j = 0; j < networkCount; j++) {
      if (ssidFound == networks[j].ssid) {
        int rssi = WiFi.RSSI(i);
        if (rssi > rssiMax) {
          rssiMax = rssi;
          bestNetworkIndex = j;
        }
      }
    }
  }

  if (bestNetworkIndex != -1) {
    Serial.print("Connecting to: ");
    Serial.println(networks[bestNetworkIndex].ssid);
    WiFi.begin(networks[bestNetworkIndex].ssid, networks[bestNetworkIndex].password);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      ledSlowBlink(1, 200);
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected!");
      Serial.println(WiFi.localIP());
      ledOn();
      return true;
    }
  }

  Serial.println("No known WiFi found.");
  return false;
}

// ----------------- SETUP -----------------
void setup() {
  Serial.begin(115200);
  
  // Cihazı başlat
  initDevice();

  // WOL profillerini yükle (varsa)
  loadWOLProfilesFromPrefs();

  buzzerInit();
  ledInit();
  ledBlink(300);

  // WiFi bağlantısını dene
  Serial.println("\n=== WiFi Bağlantısı Kontrol Ediliyor ===");
  
  // Önce kaydedilmiş WiFi bilgilerini dene
  bool connected = connectToSavedWiFi();
  
  if (!connected) {
    // Kaydedilmiş WiFi bulunamadı veya bağlanılamadı
    // AP modu başlat (WiFi Setup GUI)
    Serial.println("WiFi'ye bağlanılamadı. AP modu başlatılıyor...");
    startAPMode();
    
    // AP modundayken WebSocket başlatma
    Serial.println("AP modu aktif. WiFi Setup arayüzü hazır.");
    Serial.println("192.168.4.1 adresine bağlanın.");
    return;
  }
  
  // WiFi bağlandı, WebSocket bağlantısı yap
  Serial.println("\n=== WebSocket Bağlantısı Kuruluyor ===");

  // Token'ı yükle
  deviceToken = loadToken();
  if (deviceToken.length() > 0) {
    Serial.println("Kaydedilmiş token yüklendi: " + deviceToken.substring(0, 8) + "...");
  }

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("Setup tamamlandı!");
}

// ----------------- WiFi Reset Komutu -----------------
void checkSerialCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();
    
    if (command == "RESETWIFI") {
      Serial.println("=== WiFi Ayarları Temizleniyor ===");
      Preferences prefs;
      prefs.begin("wificonfig", false);
      prefs.clear();
      prefs.end();
      Serial.println("WiFi ayarları temizlendi! Yeniden başlatılıyor...");
      delay(1000);
      ESP.restart();
    }
  }
}

// ----------------- LOOP -----------------
void loop() {
  // Serial komutlarını kontrol et
  checkSerialCommands();
  
  // AP modundayken DNS server'ı işle ve WebSocket'i çalıştırma
  if (wifiSetupStatus.isInAPMode) {
    // Captive portal DNS server'ını işle
    // Bu tüm DNS isteklerini ESP32'nin IP'sine yönlendirir
    dnsServer.processNextRequest();
    delay(10);
    return;
  }
  
  webSocket.loop();
  checkDevices();
  
  // Heartbeat güncelle ve gönder
  static unsigned long lastHeartbeat = 0;
  unsigned long now = millis();
  
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    String heartbeatMsg = createHeartbeatMessage();
    webSocket.sendTXT(heartbeatMsg);
    Serial.println("=== Heartbeat Gönderildi ===");
    Serial.println("Cihaz: " + String(DEVICE_ID) + " - " + String(DEVICE_NAME));
    Serial.println("Uptime: " + String(now / 1000) + " saniye");
    Serial.println("Mesaj: " + heartbeatMsg);
  }
  
  // Görev kuyruğunu işle
  processTaskQueue();
}

```

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
// Cihaz konfigürasyonunu seçin (SelectedDevice.h üzerinden tek noktadan yönetilir)
#include "../device_configs/SelectedDevice.h"
#include "DeviceConfig.h"
#include <ESP32Ping.h> // Ping için gerekli
#include "wifi_setup.h" // WiFi setup GUI

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

WiFiUDP udp;
WebSocketsClient webSocket;

// Komut debouncing ve relay cooldown kontrolü
static String lastRelayCmd = "";
static unsigned long lastRelayCmdTime = 0;
static unsigned long relayCooldownUntil[RELAY_COUNT] = {0};

// ----------------- WOL -----------------
void sendWOL(const WOLDevice &dev) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], dev.mac, 6);

  udp.beginPacket(dev.broadcast, dev.port > 0 ? dev.port : 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
}

// ----------------- WOL Persist -----------------
Preferences wolPrefs;

static bool parseMac(const String &macStr, byte out[6]) {
  int values[6];
  if (sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x", &values[0], &values[1], &values[2], &values[3], &values[4], &values[5]) != 6) return false;
  for (int i = 0; i < 6; i++) out[i] = (byte)values[i];
  return true;
}

void loadWOLProfilesFromPrefs() {
  if (!wolPrefs.begin("wolconfig", true)) return;
  String json = wolPrefs.getString("profiles", "");
  wolPrefs.end();
  if (json.length() == 0) return;

  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) return;
  if (!doc.is<JsonArray>()) return;

  JsonArray arr = doc.as<JsonArray>();
  int count = 0;
  for (JsonObject p : arr) {
    if (count >= MAX_WOL_DEVICES) break;
    const char* name = p["name"] | "WOL";
    const char* mac = p["mac"] | "";
    const char* bcast = p["broadcast_ip"] | "";
    uint16_t port = p["port"] | 9;
    const char* ipStr = p["ip"] | "0.0.0.0";

    wolDevices[count].name = name;
    byte macb[6];
    if (parseMac(String(mac), macb)) memcpy(wolDevices[count].mac, macb, 6);
    IPAddress ip; ip.fromString(String(ipStr)); wolDevices[count].ip = ip;
    IPAddress bc; if (!String(bcast).length()) { bc.fromString(String(WOL_BROADCAST_IP)); } else { bc.fromString(String(bcast)); }
    wolDevices[count].broadcast = bc;
    wolDevices[count].port = port;
    wolDevices[count].status = WOLDevice::OFFLINE;
    wolDevices[count].bootStartTime = 0;
    count++;
  }
  wolDeviceCount = count;
}

bool saveWOLProfilesToPrefs(const String &json) {
  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc.is<JsonArray>()) return false;
  if (!wolPrefs.begin("wolconfig", false)) return false;
  wolPrefs.putString("profiles", json);
  wolPrefs.end();
  return true;
}

bool updateWOLProfilesFromJson(const String &json) {
  if (!saveWOLProfilesToPrefs(json)) return false;
  loadWOLProfilesFromPrefs();
  return true;
}

// ----------------- Yardımcı: Mesaj ID kontrolü -----------------
// Mesaj içinde " id:<DEVICE_ID>" varsa ve bizim cihaz ID'miz ile eşleşmiyorsa true döner (yani bu cihaza ait değil)
bool hasIdButNotForThisDevice(const String &msg) {
  int idPos = msg.indexOf(" id:");
  if (idPos == -1) return false; // ID belirtilmemiş, geriye dönük uyumluluk: kabul et
  int start = idPos + 4; // " id:" sonrası
  int end = msg.indexOf(' ', start);
  if (end == -1) end = msg.length();
  String targetId = msg.substring(start, end);
  targetId.trim();
  return targetId.length() > 0 && targetId != String(DEVICE_ID);
}

// ----------------- Cihaz yeteneklerini gönder -----------------
void sendCapabilities() {
  // JSON: { type:"capabilities", deviceId, relayCount, wol:[{index,name},...] }
  String json = "{";
  json += "\"type\":\"capabilities\",";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"relayCount\":" + String(RELAY_COUNT) + ",";
  json += "\"wol\":[";
  for (int i = 0; i < wolDeviceCount; i++) {
    json += "{\"index\":" + String(i) + ",\"name\":\"" + String(wolDevices[i].name) + "\"}";
    if (i < wolDeviceCount - 1) json += ",";
  }
  json += "]";
  json += "}";
  webSocket.sendTXT(json);
  Serial.println("Capabilities gönderildi: " + json);
}

// ----------------- Status gönder -----------------
void sendStatus(WOLDevice &dev) {
  String statusStr;
  switch(dev.status) {
    case WOLDevice::OFFLINE: statusStr = "OFFLINE"; break;
    case WOLDevice::BOOTING: statusStr = "BOOTING"; break;
    case WOLDevice::RUNNING: statusStr = "RUNNING"; break;
    case WOLDevice::FAILED:  statusStr = "FAILED"; break;
  }
  webSocket.sendTXT("status:" + String(dev.name) + ":" + statusStr);
}

// ----------------- Tüm status gönder -----------------
void sendAllStatuses() {
  for (int i = 0; i < wolDeviceCount; i++) {
    sendStatus(wolDevices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state + " id:" + String(DEVICE_ID));
    Serial.println("relay:" + String(i) + ":" + state);
  }
}

// ----------------- Röle kontrol (WebSocket ile) -----------------
void setRelayWithWebSocket(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  // Durum zaten istenen ile aynıysa tekrar işlem yapma
  if (deviceStatus.relays[index].state == state) {
    return;
  }
  
  // Hızlı tekrarlara karşı per-relay cooldown (200 ms)
  unsigned long nowMs = millis();
  if (relayCooldownUntil[index] > nowMs) {
    return;
  }
  relayCooldownUntil[index] = nowMs + 200;

  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr + " id:" + String(DEVICE_ID));
  
  Serial.println("Röle " + String(index) + " " + (state ? "AÇILDI" : "KAPANDI"));
  Serial.println("relay:" + String(index) + ":" + stateStr);
  ledFlash();
}

void toggleRelayWithWebSocket(int index) {
  if (index < 0 || index >= RELAY_COUNT) return;
  setRelayWithWebSocket(index, !deviceStatus.relays[index].state);
}

// ----------------- Ping kontrolü -----------------
void checkDevices() {
  static unsigned long lastFastPing = 0;
  static unsigned long lastSlowPing = 0;
  static unsigned long lastOfflinePing = 0;

  unsigned long now = millis();

  // 1️⃣ BOOTING cihazlar: hızlı ping (500 ms)
  if (now - lastFastPing >= 500) {
    lastFastPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::BOOTING) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }

  // 2️⃣ RUNNING cihazlar: hafif ping (5 s)
  if (now - lastSlowPing >= 5000) {
    lastSlowPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::RUNNING) {
        if (!Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
      }
    }
  }

  // 3️⃣ OFFLINE cihazlar: arada ping (5 dk)
  if (now - lastOfflinePing >= 300000) {
    lastOfflinePing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::OFFLINE) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }
}

// ----------------- JSON değer alma (basit) -----------------
String getValue(String data, String key) {
  int start = data.indexOf("\"" + key + "\":");
  if (start == -1) return "";
  start += key.length() + 3;
  int end = data.indexOf(",", start);
  if (end == -1) end = data.indexOf("}", start);
  return data.substring(start, end);
}

// ----------------- Device Token Management -----------------
String deviceToken = "";
String pairingToken = "";
bool isPaired = false;

// Token kaydetme (EEPROM veya NVS)
void saveToken(String token) {
  // Token'daki çift tırnakları temizle
  deviceToken = token;
  deviceToken.replace("\"", "");
  // TODO: EEPROM veya NVS'ye kaydet
  Serial.println("Token kaydedildi: " + deviceToken.substring(0, 8) + "...");
}

// Token yükleme (EEPROM veya NVS'den)
String loadToken() {
  // TODO: EEPROM veya NVS'den yükle
  return deviceToken;
}

// ----------------- Config Handling -----------------
struct DeviceConfig {
  String wifi_ssid = "";
  String wifi_pass = "";
  bool use_dhcp = true;
  String static_ip = "";
  String wol_profiles = "[]"; // JSON string
};

DeviceConfig currentConfig;

// Config'i uygula
void applyConfig(const DeviceConfig& config) {
  Serial.println("=== Konfigürasyon Uygulanıyor ===");
  
  // WiFi ayarlarını güncelle
  if (config.wifi_ssid.length() > 0 && config.wifi_pass.length() > 0) {
    Serial.println("WiFi ayarları güncelleniyor...");
    // TODO: WiFi ayarlarını güncelle ve yeniden bağlan
    // WiFi.begin(config.wifi_ssid.c_str(), config.wifi_pass.c_str());
  }
  
  // IP ayarlarını güncelle
  if (!config.use_dhcp && config.static_ip.length() > 0) {
    Serial.println("Statik IP ayarlanıyor: " + config.static_ip);
    // TODO: Statik IP ayarla
  }
  
  // WOL profillerini güncelle
  if (config.wol_profiles.length() > 0) {
    Serial.println("WOL profilleri güncelleniyor...");
    // TODO: WOL profillerini parse et ve güncelle
  }
  
  currentConfig = config;
  Serial.println("Konfigürasyon uygulandı");
}

// Config ACK mesajı gönder
void sendConfigAck(String requestId, bool success, String errorMsg = "") {
  String ackMsg = "{";
  ackMsg += "\"type\":\"config_applied\",";
  ackMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  ackMsg += "\"request_id\":\"" + requestId + "\",";
  ackMsg += "\"status\":\"" + String(success ? "ok" : "error") + "\",";
  ackMsg += "\"details\":{";
  ackMsg += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  ackMsg += "\"mac\":\"" + WiFi.macAddress() + "\"";
  ackMsg += "},";
  ackMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  if (!success && errorMsg.length() > 0) {
    ackMsg += ",\"error\":\"" + errorMsg + "\"";
  }
  ackMsg += "}";
  
  webSocket.sendTXT(ackMsg);
  Serial.println("Config ACK gönderildi: " + ackMsg);
}

// Config mesajını işle
void handleConfigMessage(String message) {
  Serial.println("Config mesajı alındı: " + message);
  
  String requestId = getValue(message, "request_id");
  String token = getValue(message, "token");
  
  // Token doğrulama (basit)
  if (token.length() > 0 && token != deviceToken && token != pairingToken) {
    Serial.println("Geçersiz token");
    sendConfigAck(requestId, false, "Geçersiz token");
    return;
  }
  
  // Config JSON'unu parse et
  String configJson = getValue(message, "config");
  if (configJson.length() == 0) {
    Serial.println("Config JSON bulunamadı");
    sendConfigAck(requestId, false, "Config JSON bulunamadı");
    return;
  }
  
  // Config'i parse et ve uygula
  DeviceConfig newConfig;
  newConfig.wifi_ssid = getValue(configJson, "wifi_ssid");
  newConfig.wifi_pass = getValue(configJson, "wifi_pass");
  newConfig.use_dhcp = getValue(configJson, "use_dhcp") == "true";
  newConfig.static_ip = getValue(configJson, "static_ip");
  newConfig.wol_profiles = getValue(configJson, "wol_profiles");
  
  // WOL Profilleri güncellemesi
  if (newConfig.wol_profiles.length() > 0) {
    // wol_profiles bir JSON string beklenir: array of {name,mac,broadcast_ip,port,ip}
    if (updateWOLProfilesFromJson(newConfig.wol_profiles)) {
      Serial.println("WOL profilleri güncellendi ve kaydedildi");
    } else {
      Serial.println("WOL profilleri güncellenemedi (parse/persist hatası)");
    }
  }

  // Config'i uygula
  applyConfig(newConfig);
  
  // Başarılı ACK gönder
  sendConfigAck(requestId, true);
}

// Device identify mesajı gönder
void sendDeviceIdentify() {
  // Token'daki çift tırnakları temizle
  String cleanToken = deviceToken;
  cleanToken.replace("\"", "");
  
  String identifyMsg = "{";
  identifyMsg += "\"type\":\"identify\",";
  identifyMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  identifyMsg += "\"firmware\":\"v1.0.0\",";
  identifyMsg += "\"token\":\"" + cleanToken + "\",";
  identifyMsg += "\"capabilities\":[\"wol\",\"wifi-config\"],";
  identifyMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  identifyMsg += "}";
  
  webSocket.sendTXT(identifyMsg);
  Serial.println("Device identify gönderildi: " + identifyMsg);
}

// ----------------- WebSocket olayları -----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED: {
      Serial.println("=== WebSocket Bağlandı ===");
      Serial.println("Server: " + String(WS_SERVER_IP) + ":" + String(WS_SERVER_PORT));
      Serial.println("Cihaz ID: " + String(DEVICE_ID));
      Serial.println("Cihaz Adı: " + String(DEVICE_NAME));
      
      // Yeni JSON heartbeat mesajı gönder
      String heartbeatMsg = createHeartbeatMessage();
      webSocket.sendTXT(heartbeatMsg);
      Serial.println("Heartbeat gönderildi: " + heartbeatMsg);
      ledFlash();
      // Bağlantı sonrası yetenekleri bildir
      sendCapabilities();
      
      // Device identify mesajı gönder
      sendDeviceIdentify();
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

      // Tekrarlayan röle komutlarını filtrele (debounce)
      unsigned long nowMs = millis();
      if (msg.startsWith("relay:")) {
        if (msg == lastRelayCmd && (nowMs - lastRelayCmdTime) < 300) {
          // Aynı komut kısa süre içinde tekrar geldiyse yok say
          break;
        }
        lastRelayCmd = msg;
        lastRelayCmdTime = nowMs;
      }

      // ID hedefleme kontrolü (mesajda id varsa ve bize ait değilse yok say)
      if (hasIdButNotForThisDevice(msg)) {
        break;
      }

      // --- 1️⃣ Relay kontrol ---
      if (msg.startsWith("relay:")) {
        String command = msg.substring(6);

        // 🔹 Tüm röleleri aç/kapat/toggle et
        if (command == "all:on") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, true);
        } 
        else if (command == "all:off") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, false);
        } 
        else if (command == "all") {
          for (int i = 0; i < RELAY_COUNT; i++) toggleRelayWithWebSocket(i);
        } 
        else {
          // 🔹 Tekli röle kontrol
          int idx = command.substring(0, 1).toInt();
          String action = "";
          if (command.length() > 2) action = command.substring(2);

          if (command.endsWith(":on")) {
            Serial.println("Röle " + String(idx) + " AÇILIYOR");
            setRelayWithWebSocket(idx, true);
          }
          else if (command.endsWith(":off")) {
            Serial.println("Röle " + String(idx) + " KAPATILIYOR");
            setRelayWithWebSocket(idx, false);
          }
          else {
            Serial.println("Röle " + String(idx) + " TOGGLE");
            toggleRelayWithWebSocket(idx);  // toggle desteği
          }
        }
      }
      // --- 2️⃣ Röle durumlarını isteme ---
      else if (msg.startsWith("getRelayStatus")) { // getRelayStatus [id:xxx]
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < wolDeviceCount) {
          sendWOL(wolDevices[devIndex]);
          wolDevices[devIndex].status = WOLDevice::BOOTING;
          wolDevices[devIndex].bootStartTime = millis();
          sendStatus(wolDevices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg.startsWith("getWolStatus")) { // getWolStatus [id:xxx]
        for (int i = 0; i < wolDeviceCount; i++) {
          WOLDevice &dev = wolDevices[i];
          if (dev.status == WOLDevice::BOOTING) {
            sendStatus(dev);
            continue;
          }

          bool reachable = Ping.ping(dev.ip, 1);
          if (reachable && dev.status != WOLDevice::RUNNING) dev.status = WOLDevice::RUNNING;
          else if (!reachable && dev.status != WOLDevice::BOOTING) dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
        webSocket.sendTXT("statusCheck:done");
        ledFlash();
      }

      // --- 7️⃣ Yetenekleri isteme ---
      else if (msg.startsWith("getCapabilities")) { // getCapabilities [id:xxx]
        sendCapabilities();
      }

      // --- 5️⃣ Buzzer ---
      else if (msg.startsWith("{\"type\":\"buzzer\"")) {
        int pitch = getValue(msg, "pitch").toInt();
        int duration = getValue(msg, "duration").toInt();
        float volume = getValue(msg, "volume").toFloat();

        if (pitch <= 0) pitch = 2000;
        if (duration <= 0) duration = 300;
        if (volume < 0 || volume > 1) volume = 1.0;

        buzzerPlay(pitch, duration, volume);
        webSocket.sendTXT("buzzer:done");
        ledFlash();
      }

      // --- 6️⃣ LED kontrol ---
      else if (msg == "led:on") {
        ledOn();
        webSocket.sendTXT("led:done");
      }
      else if (msg == "led:off") {
        ledOff();
        webSocket.sendTXT("led:done");
      }

      // --- 7️⃣ Config mesajları ---
      else if (msg.startsWith("{\"type\":\"update_config\"")) {
        handleConfigMessage(msg);
      }
      else if (msg.startsWith("{\"type\":\"pairing_required\"")) {
        // Pairing token alındı
        String token = getValue(msg, "pairing_token");
        if (token.length() > 0) {
          pairingToken = token;
          deviceToken = token; // Pairing token'ı device token olarak kullan
          saveToken(token); // Token'ı kaydet
          Serial.println("Pairing token alındı: " + token.substring(0, 8) + "...");
          // Pairing token ile tekrar identify gönder
          delay(1000);
          sendDeviceIdentify();
        }
      }
      else if (msg.startsWith("{\"type\":\"identify_success\"")) {
        // Cihaz başarıyla tanımlandı
        Serial.println("Cihaz başarıyla tanımlandı");
        isPaired = true;
        
        // Persistent token alındıysa kaydet
        String persistentToken = getValue(msg, "persistent_token");
        if (persistentToken.length() > 0) {
          deviceToken = persistentToken;
          saveToken(persistentToken);
          Serial.println("Persistent token kaydedildi: " + persistentToken.substring(0, 8) + "...");
        } else if (pairingToken.length() > 0) {
          saveToken(pairingToken);
          pairingToken = "";
        }
      }

      break;
    }
  }
}

// ----------------- WiFi bağlantısı -----------------
bool connectToWiFi() {
  int rssiMax = -1000;
  int bestNetworkIndex = -1;

  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String ssidFound = WiFi.SSID(i);
    for (int j = 0; j < networkCount; j++) {
      if (ssidFound == networks[j].ssid) {
        int rssi = WiFi.RSSI(i);
        if (rssi > rssiMax) {
          rssiMax = rssi;
          bestNetworkIndex = j;
        }
      }
    }
  }

  if (bestNetworkIndex != -1) {
    Serial.print("Connecting to: ");
    Serial.println(networks[bestNetworkIndex].ssid);
    WiFi.begin(networks[bestNetworkIndex].ssid, networks[bestNetworkIndex].password);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      ledSlowBlink(1, 200);
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected!");
      Serial.println(WiFi.localIP());
      ledOn();
      return true;
    }
  }

  Serial.println("No known WiFi found.");
  return false;
}

// ----------------- SETUP -----------------
void setup() {
  Serial.begin(115200);
  
  // Cihazı başlat
  initDevice();

  // WOL profillerini yükle (varsa)
  loadWOLProfilesFromPrefs();

  buzzerInit();
  ledInit();
  ledBlink(300);

  // WiFi bağlantısını dene
  Serial.println("\n=== WiFi Bağlantısı Kontrol Ediliyor ===");
  
  // Önce kaydedilmiş WiFi bilgilerini dene
  bool connected = connectToSavedWiFi();
  
  if (!connected) {
    // Kaydedilmiş WiFi bulunamadı veya bağlanılamadı
    // AP modu başlat (WiFi Setup GUI)
    Serial.println("WiFi'ye bağlanılamadı. AP modu başlatılıyor...");
    startAPMode();
    
    // AP modundayken WebSocket başlatma
    Serial.println("AP modu aktif. WiFi Setup arayüzü hazır.");
    Serial.println("192.168.4.1 adresine bağlanın.");
    return;
  }
  
  // WiFi bağlandı, WebSocket bağlantısı yap
  Serial.println("\n=== WebSocket Bağlantısı Kuruluyor ===");

  // Token'ı yükle
  deviceToken = loadToken();
  if (deviceToken.length() > 0) {
    Serial.println("Kaydedilmiş token yüklendi: " + deviceToken.substring(0, 8) + "...");
  }

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("Setup tamamlandı!");
}

// ----------------- WiFi Reset Komutu -----------------
void checkSerialCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();
    
    if (command == "RESETWIFI") {
      Serial.println("=== WiFi Ayarları Temizleniyor ===");
      Preferences prefs;
      prefs.begin("wificonfig", false);
      prefs.clear();
      prefs.end();
      Serial.println("WiFi ayarları temizlendi! Yeniden başlatılıyor...");
      delay(1000);
      ESP.restart();
    }
  }
}

// ----------------- LOOP -----------------
void loop() {
  // Serial komutlarını kontrol et
  checkSerialCommands();
  
  // AP modundayken DNS server'ı işle ve WebSocket'i çalıştırma
  if (wifiSetupStatus.isInAPMode) {
    // Captive portal DNS server'ını işle
    // Bu tüm DNS isteklerini ESP32'nin IP'sine yönlendirir
    dnsServer.processNextRequest();
    delay(10);
    return;
  }
  
  webSocket.loop();
  checkDevices();
  
  // Heartbeat güncelle ve gönder
  static unsigned long lastHeartbeat = 0;
  unsigned long now = millis();
  
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    String heartbeatMsg = createHeartbeatMessage();
    webSocket.sendTXT(heartbeatMsg);
    Serial.println("=== Heartbeat Gönderildi ===");
    Serial.println("Cihaz: " + String(DEVICE_ID) + " - " + String(DEVICE_NAME));
    Serial.println("Uptime: " + String(now / 1000) + " saniye");
    Serial.println("Mesaj: " + heartbeatMsg);
  }
  
  // Görev kuyruğunu işle
  processTaskQueue();
}

```

```javascript
// API base URL'i belirle
const getApiBaseUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  // API için port 5130 kullan
  return `${protocol}//${hostname}:5130`;
};

// WebSocket URL - WSS protokolü ile internet kullanımı için
const wsUrl = `wss://fatihdev.xyz:5131/`;

let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let reconnectTimeout = null;

// Global değişkenler
let currentUser = null;
let availableDevices = [];
let selectedDeviceId = null;
let uiInitialized = false;

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return; // Zaten bağlı
  }
  
  // Sadece WSS kullan
  const currentUrl = wsUrl;
  
  console.log(`WebSocket bağlantısı kuruluyor... (Deneme: ${reconnectAttempts + 1}/${maxReconnectAttempts}) - ${currentUrl}`);
  logMessage(`WebSocket bağlantısı kuruluyor... (Deneme: ${reconnectAttempts + 1}/${maxReconnectAttempts}) - ${currentUrl}`, "SYSTEM");
  
  ws = new WebSocket(currentUrl);

  ws.onopen = () => {
    reconnectAttempts = 0; // Başarılı bağlantıda sıfırla
    const timestamp = new Date().toLocaleTimeString();
    const logEl = document.getElementById("log");
    if (logEl) {
      const logLine = document.createElement("div");
      logLine.style.color = "#00ff00";
      logLine.style.marginBottom = "2px";
      logLine.style.fontWeight = "bold";
      logLine.innerHTML = `[${timestamp}] <strong>SYSTEM:</strong> WebSocket bağlandı! (${wsUrl})`;
      logEl.insertBefore(logLine, logEl.firstChild);
    }
    
    console.log("WebSocket bağlandı:", wsUrl);
    console.log("WebSocket readyState:", ws.readyState);
    
    // Bağlantı durumunu güncelle ve temel bölümleri aç
    updateConnectionStatus(true);
    const deviceSelector = document.getElementById('device-selector');
    if (deviceSelector) deviceSelector.style.display = '';
    const logParent = document.getElementById('log_parent');
    if (logParent) logParent.style.display = '';
    
    // Eğer cihaz listesi daha önce yüklendiyse ve bir seçim yapılmışsa, hemen bildir ve durum iste
    const tryKickOffForSelected = () => {
      if (selectedDeviceId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'deviceSelection', deviceId: selectedDeviceId }));
        ws.send(`getCapabilities id:${selectedDeviceId}`);
        ws.send(`getRelayStatus id:${selectedDeviceId}`);
        ws.send(`getWolStatus id:${selectedDeviceId}`);
        return true;
      }
      return false;
    };
    if (!tryKickOffForSelected()) {
      // Kısa bir gecikmeyle tekrar dene (cihaz listesi WS'den sonra gelmiş olabilir)
      setTimeout(() => { tryKickOffForSelected(); }, 800);
    }
  
  // Kullanıcı bilgilerini yükle ve WebSocket'e gönder
  loadUserInfoAndAuth();
  // Kullanıcı layout'unu uygula
  applyUserLayout();
  
  // Relay status sistemini başlat
  initRelayStatus(ws);
  
  // Kullanıcı auth'u tamamlandıktan sonra cihaz kayıtlarını iste
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "frontend",
      request: "getDeviceRegistry"
    }));
  }, 1000);
  
  // WOL durumlarını iste
  setTimeout(() => {
    if (selectedDeviceId) {
      getWOLStatus();
    } else {
      console.log('Cihaz seçilmedi; WOL status isteği gönderilmedi');
    }
  }, 1000);
  
  // Relay durumlarını iste
  setTimeout(() => {
    if (selectedDeviceId) {
      ws.send(`getRelayStatus id:${selectedDeviceId}`);
    } else {
      console.log('Cihaz seçilmedi; relay status isteği gönderilmedi');
    }
  }, 1500);
  
  // Client tipi ve IP bilgisini bildir
  fetch('https://api.ipify.org?format=json')
    .then(response => response.json())
    .then(data => {
      const ip = data.ip;
      ws.send(JSON.stringify({
        type: "frontend",
        ip: ip,
        userAgent: navigator.userAgent,
        domain: window.location.hostname
      }));
    })
    .catch(err => {
      console.error("IP alınamadı", err);
      ws.send(JSON.stringify({
        type: "frontend",
        ip: "unknown",
        userAgent: navigator.userAgent,
        domain: window.location.hostname
      }));
    });
};

  ws.onmessage = (event) => {
  const msg = event.data;
  
  // JSON mesajları
  if (msg.startsWith("{")) {
    try {
      const data = JSON.parse(msg);
      // Frontend'den gelen mesajları CLIENT olarak logla
      if (data.type === "frontend") {
        logMessage(msg, "CLIENT");
      } else {
        logMessage(msg, "ESP32");
      }
      // Cihaza özgü mesaj filtrelemesi (deviceId varsa ve farklıysa atla)
      if (data.deviceId && selectedDeviceId && data.deviceId !== selectedDeviceId) {
        return;
      }
      handleJSONMessage(data);
    } catch (e) {
      console.error("JSON parse hatası:", e);
      logMessage(msg, "ESP32");
    }
  }
  // Eski format mesajlar (relay mesajları artık relay_status.js'de işleniyor)
  // WOL status mesajları
  else if (msg.startsWith("status:")) {
    logMessage(msg, "ESP32");
    handleWOLStatus(msg);
  }
  // Röle mesajlarını loglama - UI güncellemesi relay_status.js tarafından yapılıyor
  else if (msg.startsWith("relay:")) {
    // no-op (UI güncellemesi için relay_status.js dinliyor)
  }
  // Cihaz bilgileri
  else if (msg.startsWith("deviceInfo:")) {
    logMessage(msg, "ESP32");
    const info = msg.substring(11);
    log("Cihaz Bilgileri:\n" + info);
  }
  // Diğer mesajlar (relay, getRelayStatus, getWolStatus vb.)
  else {
    logMessage(msg, "ESP32");
  }
};

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    console.error("WebSocket URL:", ws.url);
    console.error("WebSocket readyState:", ws.readyState);
    console.error("Error details:", error);
    console.error("Error type:", error.type);
    console.error("Error target:", error.target);
    
    logMessage(`WebSocket hatası: ${error.message || "Bilinmeyen hata"} (URL: ${ws.url})`, "ERROR");
    
    // Detaylı hata analizi
    if (error.type === 'error') {
      logMessage(`Bağlantı hatası: Sunucu ${ws.url} adresinde çalışmıyor olabilir`, "ERROR");
      logMessage(`Hata kodu: ${error.code || 'N/A'}, Hata tipi: ${error.type}`, "ERROR");
    }
    
    // WSS bağlantı sorunları için özel mesajlar
    if (ws.url.startsWith('wss://')) {
      logMessage(`WSS bağlantı hatası: SSL sertifikası kontrol ediliyor...`, "ERROR");
      logMessage(`SSL sertifikası geçerli değil veya self-signed olabilir`, "ERROR");
    }
  };

  ws.onclose = (event) => {
    console.log("WebSocket bağlantısı kapandı:", event.code, event.reason);
    logMessage(`WebSocket bağlantısı kapandı (${event.code}): ${event.reason || "Bilinmeyen sebep"}`, "ERROR");
    
    // Bağlantı durumunu göster
    updateConnectionStatus(false);
    
    // Yeniden bağlanma mantığı
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30s
      
      logMessage(`${delay/1000} saniye sonra yeniden bağlanmaya çalışılacak... (${reconnectAttempts}/${maxReconnectAttempts})`, "SYSTEM");
      
      reconnectTimeout = setTimeout(() => {
        connectWebSocket();
      }, delay);
    } else {
      logMessage("Maksimum yeniden bağlanma denemesi aşıldı. Manuel bağlantı butonunu kullanın.", "ERROR");
      document.getElementById('reconnect-btn').style.display = 'inline-block';
    }
  };
}

// Manuel yeniden bağlantı fonksiyonu
function manualReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  reconnectAttempts = 0;
  connectWebSocket();
  document.getElementById('reconnect-btn').style.display = 'none';
}

// Sayfa yüklendiğinde kullanıcı kontrolü ve WebSocket bağlantısını başlat
document.addEventListener('DOMContentLoaded', async function() {
  console.log('📄 Sayfa yüklendi, kullanıcı kontrolü yapılıyor...');
  
  try {
    // Cookie'leri kontrol et
    console.log('🍪 Current cookies:', document.cookie);
    console.log('🍪 Cookie count:', document.cookie.split(';').length);
    console.log('🍪 Has sessionId:', document.cookie.includes('sessionId'));
    
    // SessionId'yi manuel olarak çıkar
    const sessionIdMatch = document.cookie.match(/sessionId=([^;]+)/);
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;
    console.log('🍪 Extracted sessionId:', sessionId ? sessionId.substring(0, 10) + '...' : 'YOK');
    
    // Eğer sessionId yoksa, localStorage'dan al
    if (!sessionId) {
      const storedSessionId = localStorage.getItem('sessionId');
      if (storedSessionId) {
        console.log('🍪 localStorage\'dan sessionId alındı:', storedSessionId.substring(0, 10) + '...');
        document.cookie = `sessionId=${storedSessionId}; path=/; SameSite=Lax`;
        console.log('🍪 Cookie localStorage\'dan set edildi');
      }
    }
    
    // Önce basit endpoint'i test et
    const testUrl = `${getApiBaseUrl()}/api/user-simple`;
    console.log('🧪 Test endpoint:', testUrl);
    const testResponse = await fetch(testUrl);
    console.log('🧪 Test response:', testResponse.status);
    const testData = await testResponse.json();
    console.log('🧪 Test data:', testData);
    
    const apiUrl = `${getApiBaseUrl()}/api/user`;
    console.log('🌐 Current origin:', window.location.origin);
    console.log('🌐 API URL:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include', // Cookie'leri dahil et
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('👤 User API response:', response.status);
    console.log('👤 User API response headers:', response.headers);
    console.log('👤 Response content-type:', response.headers.get('content-type'));
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('❌ Response is not JSON:', contentType);
        const text = await response.text();
        console.error('❌ Response body:', text.substring(0, 200));
        throw new Error('Response is not JSON');
      }
      
      const user = await response.json();
      console.log('👤 User data:', user);
      currentUser = user;
      
      // Element'leri kontrol et
      const usernameEl = document.getElementById('username');
      const userRoleEl = document.getElementById('userRole');
      
      console.log('🔍 Username element:', usernameEl);
      console.log('🔍 UserRole element:', userRoleEl);
      
      if (usernameEl) {
        usernameEl.textContent = user.username;
        console.log('✅ Username set edildi:', user.username);
      } else {
        console.log('❌ Username element bulunamadı');
      }
      
      if (userRoleEl) {
        userRoleEl.textContent = user.role;
        console.log('✅ UserRole set edildi:', user.role);
      } else {
        console.log('❌ UserRole element bulunamadı');
      }
      
      // User info'yu güncelle
      const userInfoEl = document.getElementById('user-info');
      if (userInfoEl) {
        userInfoEl.textContent = `${user.name} (${user.username}) - ${user.role}`;
        console.log('✅ User info güncellendi');
      }
      
      // Güvenlik anahtarını al
      const keyResponse = await fetch(`${getApiBaseUrl()}/api/security-key`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (keyResponse.ok) {
        const keyData = await keyResponse.json();
        currentUser.securityKey = keyData.securityKey;
        console.log('🔑 Güvenlik anahtarı alındı:', keyData.securityKey.substring(0, 8) + '...');
      }
      
      // Kullanıcı düzenini uygula
      await applyUserLayout();
      
      // Cihaz listesini al
      await loadDevices();
    } else if (response.status === 401) {
      console.log('❌ Oturum süresi dolmuş (401)');
      console.log('❌ Response status:', response.status);
      console.log('❌ Response headers:', response.headers);
      
      // 401 response'unu parse et
      try {
        const errorData = await response.json();
        console.log('❌ 401 Error data:', errorData);
      } catch (e) {
        console.log('❌ 401 Response JSON parse edilemedi');
      }
      
      // Redirect kapatıldı - sadece log
      // window.location.href = '/login';
    } else {
      console.log('❌ Beklenmeyen response status:', response.status);
      console.log('❌ Response headers:', response.headers);
    }
  } catch (error) {
    console.error('❌ Kullanıcı bilgileri alınamadı:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    // Redirect kapatıldı - sadece log
    // window.location.href = '/login';
  }
  
  connectWebSocket();
});

// Cihaz listesini yükle
async function loadDevices() {
  try {
    console.log('📱 Cihazlar yükleniyor...');
    const response = await fetch(`${getApiBaseUrl()}/api/devices`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const devices = await response.json();
      console.log('📱 Cihazlar yüklendi:', devices);
      availableDevices = devices;
      
      // Cihaz seçiciyi güncelle
      const deviceSelect = document.getElementById('device-select');
      if (deviceSelect) {
        deviceSelect.innerHTML = '<option value="">Cihaz seçin...</option>';
        devices.forEach(device => {
          const option = document.createElement('option');
          option.value = device.device_id;
          option.textContent = device.device_name;
          deviceSelect.appendChild(option);
        });
        console.log('✅ Cihaz seçici güncellendi');

        // Eğer henüz cihaz seçili değilse ilk cihazı seç ve bildirimleri gönder
        if (!selectedDeviceId && devices.length > 0) {
          selectedDeviceId = devices[0].device_id;
          deviceSelect.value = selectedDeviceId;
          log(`Varsayılan cihaz seçildi: ${devices[0].device_name} (${selectedDeviceId})`, 'SYSTEM');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'deviceSelection', deviceId: selectedDeviceId }));
            ws.send(`getCapabilities id:${selectedDeviceId}`);
            ws.send(`getRelayStatus id:${selectedDeviceId}`);
            ws.send(`getWolStatus id:${selectedDeviceId}`);
          }
        }
      }
    } else {
      console.log('❌ Cihazlar yüklenemedi:', response.status);
    }
  } catch (error) {
    console.error('❌ Cihaz yükleme hatası:', error);
  }
}

// Bağlantı durumunu güncelle
function updateConnectionStatus(isConnected) {
  const statusElement = document.getElementById("connection-status");
  if (statusElement) {
    if (isConnected) {
      statusElement.textContent = "Bağlı";
      statusElement.style.color = "#00ff00";
    } else {
      statusElement.textContent = "Bağlantı Yok";
      statusElement.style.color = "#ff0000";
    }
  }
}

// Basit toast bildirimi
function showToast(message, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '8px';
  toast.style.color = '#fff';
  toast.style.fontSize = '14px';
  toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
  toast.style.background = type === 'error' ? '#d9534f' : (type === 'success' ? '#28a745' : '#444');
  c.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 300ms'; }, 2500);
  setTimeout(() => { toast.remove(); }, 2900);
}

// Kullanıcı bilgilerini yükle
async function loadUserInfo() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/user`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      const user = await response.json();
      const userInfoElement = document.getElementById('user-info');
      if (userInfoElement) {
        userInfoElement.textContent = `Merhaba, ${user.name} (${user.role})`;
      }
      
      // Admin butonunu göster/gizle
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) {
        adminBtn.style.display = user.role === 'admin' ? 'block' : 'none';
      }
    } else {
      showToast('Yetkilendirme gerekli. Lütfen giriş yapın.', 'error');
    }
  } catch (error) {
    console.error('Kullanıcı bilgileri yüklenemedi:', error);
    showToast('Kullanıcı bilgileri yüklenemedi', 'error');
  }
}

// Kullanıcı bilgilerini yükle ve WebSocket'e auth gönder
async function loadUserInfoAndAuth() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/user`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      const user = await response.json();
      currentUser = user;
      
      // Güvenlik anahtarını al
      const keyResponse = await fetch(`${getApiBaseUrl()}/api/security-key`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (keyResponse.ok) {
        const keyData = await keyResponse.json();
        currentUser.securityKey = keyData.securityKey;
        console.log('Güvenlik anahtarı alındı:', keyData.securityKey.substring(0, 8) + '...');
      }
      
      // Kullanıcı bilgilerini WebSocket'e gönder
      ws.send(JSON.stringify({
        type: "userAuth",
        userId: user.username,
        role: user.role
      }));
      
      // Kullanıcı bilgilerini UI'da göster
      const userInfoElement = document.getElementById('user-info');
      if (userInfoElement) {
        userInfoElement.textContent = `Merhaba, ${user.name} (${user.role})`;
      }
      
      // Admin butonunu göster/gizle
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) {
        adminBtn.style.display = user.role === 'admin' ? 'block' : 'none';
      }
      
      // Auth tamamlandıktan sonra cihaz kayıtlarını iste
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "frontend",
          request: "getDeviceRegistry"
        }));
      }, 500);
    } else {
      // Auth hatası - login sayfasına yönlendir
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Kullanıcı bilgileri yüklenemedi:', error);
    window.location.href = '/login';
  }
}

// Cihaz seçiciyi güncelle
function updateDeviceSelector(devices) {
  availableDevices = devices;
  const select = document.getElementById('device-select');
  
  if (!select) return;
  
  // Mevcut seçenekleri temizle
  select.innerHTML = '';
  
  if (devices.length === 0) {
    select.innerHTML = '<option value="">Cihaz bulunamadı</option>';
    return;
  }
  
  // İlk cihazı varsayılan olarak seç
  selectedDeviceId = devices[0].deviceId;
  
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = `${device.deviceName} (${device.isOnline ? 'Online' : 'Offline'})`;
    select.appendChild(option);
  });
  
  // İlk seçim için sunucuya bildir ve durumları iste
  if (ws.readyState === WebSocket.OPEN && selectedDeviceId) {
    ws.send(JSON.stringify({ type: "deviceSelection", deviceId: selectedDeviceId }));
    ws.send(`getCapabilities id:${selectedDeviceId}`);
    ws.send(`getRelayStatus id:${selectedDeviceId}`);
    ws.send(`getWolStatus id:${selectedDeviceId}`);
  }

  // Cihaz değiştiğinde event listener ekle
  select.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
    log(`Cihaz değiştirildi: ${e.target.selectedOptions[0].textContent}`, "SYSTEM");
    
    // WebSocket'e seçili cihazı bildir
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "deviceSelection", deviceId: selectedDeviceId }));
      // Seçim değiştiğinde cihaz capabilities ve durumlarını iste
      ws.send(`getCapabilities id:${selectedDeviceId}`);
      ws.send(`getRelayStatus id:${selectedDeviceId}`);
      ws.send(`getWolStatus id:${selectedDeviceId}`);
    }
  });
}

// Admin sayfasına git
function goToAdmin() {
  window.location.href = '/admin';
}

async function applyUserLayout() {
  try {
    const resp = await fetch(`${getApiBaseUrl()}/api/user/layout`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const layout = data.layout;
    if (!layout) return; // Varsayılanı bozma

    // Bölüm id'leri
    const sections = ['relay_parent','wol_parent','log_parent'];

    // Gizlenecekleri uygula
    const hidden = new Set(layout.hidden || []);
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = hidden.has(id) ? 'none' : '';
    });

    // Sıralamayı uygula (varsa)
    if (Array.isArray(layout.sections) && layout.sections.length) {
      const container = document.querySelector('#controlpanel')?.parentElement; // relay/wol ile aynı üst
      // relay_parent ve wol_parent aynı üstte, log_parent ana container içinde. Sıralamayı ana container’da uygulayalım
      const mainContainer = document.querySelector('.main-container');
      const order = layout.sections.filter(id => document.getElementById(id));
      order.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement) {
          // log_parent main-container’ın altındaysa yine aynı ebeveyne ekle
          el.parentElement.appendChild(el);
        }
      });
    }
  } catch (e) {
    console.error('applyUserLayout error:', e);
  }
}

// Logout fonksiyonu
async function logout() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      // Başarılı çıkış - login sayfasına yönlendir
      window.location.href = '/login';
    } else {
      alert('Çıkış yapılırken hata oluştu!');
    }
  } catch (error) {
    console.error('Logout hatası:', error);
    alert('Çıkış yapılırken hata oluştu!');
  }
}

function handleJSONMessage(data) {
  switch(data.type) {
    case "capabilities":
      // Dinamik UI oluşturma: relay ve WOL listelerini yeniden çizeceğiz
      renderDynamicControls(data);
      uiInitialized = true;
      break;
    case "heartbeat":
      log(`Heartbeat: ${data.deviceName} - Uptime: ${Math.floor(data.uptime/1000)}s`);
      // Capabilities gelmediyse ve seçili cihazdan heartbeat geldiyse UI'ı heartbeat'ten üret
      if (!uiInitialized && selectedDeviceId && data.deviceId === selectedDeviceId) {
        const relayCount = Array.isArray(data.relayStates) ? data.relayStates.length : 0;
        renderDynamicControls({ type: 'capabilities', deviceId: data.deviceId, relayCount, wol: [] });
        uiInitialized = true;
        // Seçili cihaza yetenekleri yine de iste (WOL listesi için)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(`getCapabilities id:${selectedDeviceId}`);
          ws.send(`getRelayStatus id:${selectedDeviceId}`);
          ws.send(`getWolStatus id:${selectedDeviceId}`);
        }
      }
      break;
    case "status":
      updateRelayStatesFromJSON(data.relayStates);
      break;
    case "deviceRegistry":
      handleDeviceRegistry(data);
      try {
        // Sadece kullanıcının sahibi olduğu cihazları göster
        const ownedIds = new Set((availableDevices || []).map(d => d.device_id || d.deviceId));
        const filtered = Array.isArray(data.devices)
          ? data.devices.filter(d => ownedIds.has(d.deviceId))
          : [];
        if (filtered.length) {
          updateDeviceSelector(filtered);
        }
      } catch (e) { console.error('deviceRegistry filtering error:', e); }
      break;
    case "deviceUpdate":
    case "deviceUpdated": // server.js ile uyum
      handleDeviceUpdate(data);
      break;
    case "deviceOffline":
      handleDeviceOffline(data);
      break;
    case "relayStatus":
      handleRelayStatus(data);
      break;
    case "messageHistory":
      handleMessageHistory(data);
      break;
    case "error":
      log(`Hata: ${data.message}`, "ERROR");
      // Hata mesajını kullanıcıya göster
      if (data.message.includes('kimliği bulunamadı')) {
        alert('Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.');
        window.location.href = '/login';
      } else {
        alert(`Hata: ${data.message}`);
      }
      break;
    default:
      log("Bilinmeyen JSON mesaj: " + data.type);
  }
}

// Dinamik kontrol paneli render
function renderDynamicControls(cap) {
  try {
    // Kontrol panelini görünür yap
    const controlpanel = document.getElementById('controlpanel');
    if (controlpanel) controlpanel.style.display = '';

    // Relay paneli
    const relayContainer = document.getElementById('relaylist');
    if (relayContainer && typeof cap.relayCount === 'number') {
      const relayParent = document.getElementById('relay_parent');
      if (relayParent) relayParent.style.display = cap.relayCount > 0 ? '' : 'none';
      relayContainer.innerHTML = '';
      for (let i = 0; i < cap.relayCount; i++) {
        const div = document.createElement('div');
        div.className = 'relay';
        div.innerHTML = `
          <span class="relay_status" id="relay_status_${i}"></span>
          <button class="button" data-relay="${i}">Relay ${i+1}</button>
        `;
        relayContainer.appendChild(div);
      }
      // Yeni butonlar için eventleri yeniden bağla
      const relayButtons = relayContainer.querySelectorAll('[data-relay]');
      relayButtons.forEach(button => {
        const relayId = parseInt(button.getAttribute('data-relay'));
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleRelay(relayId);
        });
      });
    }

    // WOL paneli
    const wolList = document.getElementById('wol_list');
    if (wolList && Array.isArray(cap.wol)) {
      const wolParent = document.getElementById('wol_parent');
      if (wolParent) wolParent.style.display = '';
      wolList.innerHTML = '';
      cap.wol.forEach(w => {
        const li = document.createElement('li');
        li.className = 'wol_device';
        li.innerHTML = `
          <div class="wol_infogroup">
            <div class="wol_status"></div>
            <div class="wol_texts">
              <div class="wol_name">${w.name}</div>
              <div class="wol_statustext">Loading...</div>
            </div>
          </div>
          <button class="button" onclick="sendWOL(${w.index})" class="wol_button">Wake</button>
        `;
        wolList.appendChild(li);
      });
    }
  } catch (e) {
    console.error('renderDynamicControls error:', e);
  }
}

function handleDeviceRegistry(data) {
  log(`Cihaz Kayıtları: ${data.devices.length} cihaz bulundu`);
  data.devices.forEach(device => {
    log(`- ${device.deviceName} (${device.deviceId}): ${device.isOnline ? 'ONLINE' : 'OFFLINE'}`);
  });
}

function handleDeviceUpdate(data) {
  log(`Cihaz Güncellendi: ${data.deviceName} - ${data.isOnline ? 'ONLINE' : 'OFFLINE'}`);
  if (data.relayStates) {
    updateRelayStatesFromJSON(data.relayStates);
  }
}

function handleDeviceOffline(data) {
  log(`Cihaz Offline: ${data.deviceId}`);
  showToast(`Cihaz çevrimdışı: ${data.deviceId}`, 'error');
}

function handleRelayStatus(data) {
  if (data.relayStates) {
    updateRelayStatesFromJSON(data.relayStates);
  }
}

function handleMessageHistory(data) {
  log("Mesaj Geçmişi:");
  data.messages.forEach(msg => {
    log(`[${msg.timestamp}] ${msg.message}`);
  });
}

function updateRelayStatesFromJSON(relayStates) {
  // Sadece seçili cihazın güncellemeleri UI'ya yansısın: JSON paketlerinde cihazId yoksa (heartbeat/status),
  // bu fonksiyon çağrısı zaten seçili cihaz bağlamında yapılmalı. Ek kontrol üstte handleJSONMessage'ta yapılır.
  relayStates.forEach((relay, index) => {
    updateRelayStatus(index, relay.state ? "on" : "off");
  });
}

function sendRelay(idx, state) {
  // Eğer state belirtilmemişse toggle yap
  if (state === undefined) {
    const statusElement = document.getElementById(`relay_status_${idx}`);
    if (statusElement) {
      const isOn = statusElement.classList.contains('on');
      state = isOn ? 'off' : 'on';
    } else {
      state = 'toggle';
    }
  }
  
  // Güvenlik anahtarı kontrolü
  if (!currentUser || !currentUser.securityKey) {
    logMessage(`Güvenlik anahtarı bulunamadı! Röle ${idx} -> ${state} gönderilemedi`, "ERROR");
    return;
  }
  
  // Mesaj göndermeden önce tekrar kontrol et
  if (!selectedDeviceId) {
    showToast('Önce bir cihaz seçin', 'error');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    // Güvenli komut gönder
    const command = {
      type: "secureCommand",
      userId: currentUser.username,
      securityKey: currentUser.securityKey,
      deviceId: selectedDeviceId,
      command: `relay:${idx}:${state} id:${selectedDeviceId}`
    };
    
    ws.send(JSON.stringify(command));
    logMessage(`Güvenli Röle ${idx} -> ${state}`, "CLIENT");
  } else {
    logMessage(`WebSocket bağlantısı yok! Relay ${idx} -> ${state} gönderilemedi`, "ERROR");
  }
}

// sendWOL fonksiyonu wol_status.js'de tanımlandı

function log(msg) {
  const logEl = document.getElementById("log");
  if (logEl) {
    const timestamp = new Date().toLocaleTimeString();
    const logLine = document.createElement("div");
    logLine.style.color = "#ffffff";
    logLine.style.marginBottom = "2px";
    logLine.innerHTML = `[${timestamp}] ${msg}`;
    logEl.insertBefore(logLine, logEl.firstChild);
    
    // Log alanını temizle (çok uzun olmasın)
    const lines = logEl.children;
    if (lines.length > 50) {
      logEl.removeChild(lines[lines.length - 1]);
    }
    
    // Otomatik scroll (en üste)
    logEl.scrollTop = 0;
  }
}

// Log temizleme fonksiyonu
function clearLog() {
  const logEl = document.getElementById("log");
  if (logEl) {
    logEl.innerHTML = "";
    // Temizleme mesajını ekle
    const timestamp = new Date().toLocaleTimeString();
    const logLine = document.createElement("div");
    logLine.style.color = "#ff8800";
    logLine.style.marginBottom = "2px";
    logLine.style.fontStyle = "italic";
    logLine.innerHTML = `[${timestamp}] <strong>SYSTEM:</strong> Log temizlendi`;
    logEl.appendChild(logLine);
  }
}

// Mesaj kaynağına göre renkli log fonksiyonu
function logMessage(message, source) {
  const logEl = document.getElementById("log");
  if (logEl) {
    const timestamp = new Date().toLocaleTimeString();
    let color = "#0f0"; // Varsayılan yeşil
    
    switch(source) {
      case "ESP32":
        color = "#00ff00"; // Yeşil
        break;
      case "CLIENT":
        color = "#0088ff"; // Mavi
        break;
      case "SERVER":
        color = "#ff8800"; // Turuncu
        break;
      case "ERROR":
        color = "#ff0000"; // Kırmızı
        break;
      default:
        color = "#ffffff"; // Beyaz
    }
    
    const logLine = document.createElement("div");
    logLine.style.color = color;
    logLine.style.marginBottom = "2px";
    logLine.innerHTML = `[${timestamp}] <strong>${source}:</strong> ${message}`;
    
    // En üste ekle (yeni mesajlar üstte görünsün)
    logEl.insertBefore(logLine, logEl.firstChild);
    
    // Log alanını temizle (çok uzun olmasın)
    const lines = logEl.children;
    if (lines.length > 50) {
      logEl.removeChild(lines[lines.length - 1]);
    }
    
    // Otomatik scroll (en üste)
    logEl.scrollTop = 0;
  }
}

function updateRelayUI(relayId, state) {
  // Yeni tasarımda relay status noktalarını güncelle
  updateRelayStatus(relayId, state);
}

```

```javascript
*** Begin Patch
*** Update File: c:\Users\b350\Desktop\ESP32HOME_backup\espfrontend\public\scripts\admin.js
@@
   if (data.success) {
       const profilesList = document.getElementById('wol-profiles-list');
       profilesList.innerHTML = '';
@@
       data.profiles.forEach(profile => {
           const profileItem = document.createElement('div');
           profileItem.className = 'wol-profile-item';
           profileItem.innerHTML = `
               <div class="wol-profile-info">
                   <div class="wol-profile-name">${profile.name}</div>
                   <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
               </div>
               <div class="wol-profile-actions">
+                  <button class="btn-secondary" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
+                      <i class="fas fa-cloud-upload-alt"></i>
+                  </button>
                   <button class="btn-danger" onclick="deleteWolProfile(${profile.id})" title="Sil">
                       <i class="fas fa-trash"></i>
                   </button>
               </div>
           `;
           profilesList.appendChild(profileItem);
       });
   }
@@
 async function addWolProfile() {
@@
     if (data.success) {
         showToast('WOL profili eklendi', 'success');
         closeAddWolProfileModal();
         loadWolProfiles();
+        // Opsiyonel: Cihaza senkronize et
+        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
     } else {
         showToast('WOL profili eklenemedi: ' + data.error, 'error');
     }
@@
 }
+
+// WOL profillerini cihaza senkronize et
+async function syncWolProfilesToDevice() {
+    if (!selectedDeviceId) return;
+    try {
+        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
+        const data = await response.json();
+        if (!data.success) {
+            showToast('WOL profilleri alınamadı', 'error');
+            return;
+        }
+        const profiles = data.profiles.map(p => ({
+            name: p.name,
+            mac: p.mac,
+            broadcast_ip: p.broadcast_ip,
+            port: p.port || 9,
+            ip: p.ip_address || '0.0.0.0'
+        }));
+
+        const payload = {
+            wol_profiles: JSON.stringify(profiles)
+        };
+
+        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
+            method: 'POST',
+            body: JSON.stringify({ config: payload })
+        });
+        const resj = await resp.json();
+        if (resp.ok && resj.success) {
+            showToast('WOL profilleri cihaza gönderildi', 'success');
+        } else {
+            showToast('WOL profilleri gönderilemedi', 'error');
+        }
+    } catch (e) {
+        console.error('syncWolProfilesToDevice error:', e);
+        showToast('Senkronizasyon hatası', 'error');
+    }
+}
*** End Patch
```

Cihaza WOL profillerini senkronize etmek için admin arayüzüne bir “Cihaza Senkronize Et” butonu ekleyip, admin.js içinde senkronizasyon fonksiyonunu implement edeceğim. Ardından, WOL profili eklendikten sonra otomatik senkronizasyon tetiklenecek.

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FatihDev - Admin Dashboard</title>
  <link rel="icon" type="image/x-icon" href="./img/favicon256.ico">
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <!-- CSS -->
  <link rel="stylesheet" href="./css/admin.css">
</head>
<body>
  <div id="toast-container" style="position:fixed; right:12px; bottom:12px; z-index:9999; display:flex; flex-direction:column; gap:8px; align-items:flex-end;"></div>
  <div class="admin-container">
    <!-- Sidebar Overlay (Mobile) -->
    <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
    
    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-header">
        <h2><i class="fas fa-cogs"></i> Admin Panel</h2>

      </div>
      
      <ul class="sidebar-menu">
        <li class="menu-item active" data-tab="dashboard">
          <i class="fas fa-tachometer-alt"></i>
          <span>Dashboard</span>
        </li>
        <li class="menu-item" data-tab="users">
          <i class="fas fa-users"></i>
          <span>Kullanıcılar</span>
        </li>
        <li class="menu-item" data-tab="devices">
          <i class="fas fa-microchip"></i>
          <span>Cihazlar</span>
        </li>
        <li class="menu-item" data-tab="device-configs">
          <i class="fas fa-cog"></i>
          <span>Konfigürasyon</span>
        </li>
        <li class="menu-item" data-tab="logs">
          <i class="fas fa-file-alt"></i>
          <span>Loglar</span>
        </li>
        <li class="menu-item" data-tab="analytics">
          <i class="fas fa-chart-line"></i>
          <span>Analitik</span>
        </li>
        <li class="menu-item" data-tab="security">
          <i class="fas fa-shield-alt"></i>
          <span>Güvenlik</span>
        </li>
        <li class="menu-item" data-tab="settings">
          <i class="fas fa-cog"></i>
          <span>Ayarlar</span>
        </li>
        <li class="menu-item" data-tab="backup">
          <i class="fas fa-database"></i>
          <span>Backup</span>
        </li>
      </ul>
      
      <div class="sidebar-footer">
        <a class="btn-secondary mobile-home" href="/" style="text-decoration:none; margin-bottom: 0.5rem;">
          <i class="fas fa-home"></i>
          Ana Sayfa
        </a>
        <button class="btn-logout" onclick="logout()">
          <i class="fas fa-sign-out-alt"></i>
          Çıkış Yap
        </button>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <button class="sidebar-toggle">
            <i class="fas fa-bars"></i>
          </button>
          <h1 id="page-title">Dashboard</h1>
        </div>
        
        <div class="header-right">
          <a class="btn-secondary" href="/" style="text-decoration:none;">
            <i class="fas fa-home"></i>
            Ana Sayfa
          </a>
          <div class="notifications">
            <button class="notification-btn" onclick="toggleNotifications()">
              <i class="fas fa-bell"></i>
              <span class="notification-badge" id="notification-count">0</span>
            </button>
          </div>
          
          <div class="user-menu">
            <button class="user-btn" onclick="toggleUserMenu()">
              <i class="fas fa-user-circle"></i>
              <span id="admin-name">Admin</span>
              <i class="fas fa-chevron-down"></i>
            </button>
          </div>
        </div>
      </header>

      <!-- Content Area -->
      <div class="content">
        <!-- Dashboard Tab -->
        <div id="dashboard" class="tab-content active">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon">
                <i class="fas fa-users"></i>
              </div>
              <div class="stat-info">
                <h3 id="total-users">0</h3>
                <p>Toplam Kullanıcı</p>
              </div>
            </div>
            
            <div class="stat-card">
              <div class="stat-icon">
                <i class="fas fa-microchip"></i>
              </div>
              <div class="stat-info">
                <h3 id="total-devices">0</h3>
                <p>Toplam Cihaz</p>
              </div>
            </div>
            
            <div class="stat-card">
              <div class="stat-icon">
                <i class="fas fa-wifi"></i>
              </div>
              <div class="stat-info">
                <h3 id="online-devices">0</h3>
                <p>Online Cihaz</p>
              </div>
            </div>
            
            <div class="stat-card">
              <div class="stat-icon">
                <i class="fas fa-eye"></i>
              </div>
              <div class="stat-info">
                <h3 id="today-visitors">0</h3>
                <p>Bugünkü Ziyaretçi</p>
              </div>
            </div>
          </div>

          <div class="dashboard-grid">
            <div class="dashboard-card">
              <h3>Son Aktiviteler</h3>
              <div id="recent-activities" class="activity-list">
                <!-- Activities will be loaded here -->
              </div>
            </div>
            
            <div class="dashboard-card">
              <h3>Sistem Durumu</h3>
              <div id="system-status" class="status-list">
                <!-- System status will be loaded here -->
              </div>
            </div>
            
            <div class="dashboard-card">
              <h3>Ziyaretçi İstatistikleri</h3>
              <canvas id="visitor-chart" width="400" height="200"></canvas>
            </div>
            
            <div class="dashboard-card">
              <h3>Cihaz Durumu</h3>
              <canvas id="device-chart" width="400" height="200"></canvas>
            </div>
          </div>
        </div>

        <!-- Users Tab -->
        <div id="users" class="tab-content">
          <div class="tab-header">
            <h2>Kullanıcı Yönetimi</h2>
            <button class="btn-primary" onclick="showAddUserModal()">
              <i class="fas fa-plus"></i>
              Yeni Kullanıcı
            </button>
          </div>
          
          <div class="table-container">
            <table class="data-table" id="users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Kullanıcı Adı</th>
                  <th>Ad Soyad</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Durum</th>
                  <th>Son Giriş</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                <!-- Users will be loaded here -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Devices Tab -->
        <div id="devices" class="tab-content">
          <div class="tab-header">
            <h2>Cihaz Yönetimi</h2>
            <button class="btn-primary" onclick="showAddDeviceModal()">
              <i class="fas fa-plus"></i>
              Yeni Cihaz
            </button>
          </div>
          
          <div class="table-container">
            <table class="data-table" id="devices-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cihaz Adı</th>
                  <th>IP Adresi</th>
                  <th>Durum</th>
                  <th>Son Görülme</th>
                  <th>Sahibi</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                <!-- Devices will be loaded here -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Device Configs Tab -->
        <div id="device-configs" class="tab-content">
          <div class="tab-header">
            <h2>Cihaz Konfigürasyon Yönetimi</h2>
            <div class="config-controls">
              <select id="device-selector">
                <option value="">Cihaz Seçin</option>
              </select>
              <button class="btn-primary" onclick="refreshDeviceStatus()">
                <i class="fas fa-refresh"></i>
                Durumu Yenile
              </button>
            </div>
          </div>
          
          <div class="config-container">
            <!-- Device Status Card -->
            <div class="config-card">
              <h3>Cihaz Durumu</h3>
              <div id="device-status" class="device-status">
                <div class="status-item">
                  <span class="status-label">Durum:</span>
                  <span id="device-online-status" class="status-value offline">Offline</span>
                </div>
                <div class="status-item">
                  <span class="status-label">Son Görülme:</span>
                  <span id="device-last-seen" class="status-value">-</span>
                </div>
                <div class="status-item">
                  <span class="status-label">Firmware:</span>
                  <span id="device-firmware" class="status-value">-</span>
                </div>
                <div class="status-item">
                  <span class="status-label">Kuyruk:</span>
                  <span id="device-queue-count" class="status-value">0</span>
                </div>
              </div>
            </div>

            <!-- WiFi Configuration -->
            <div class="config-card">
              <h3>WiFi Konfigürasyonu</h3>
              <form id="wifi-config-form">
                <div class="form-group">
                  <label for="wifi-ssid">SSID:</label>
                  <input type="text" id="wifi-ssid" placeholder="WiFi ağ adı">
                </div>
                <div class="form-group">
                  <label for="wifi-password">Şifre:</label>
                  <input type="password" id="wifi-password" placeholder="WiFi şifresi">
                </div>
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="use-dhcp" checked>
                    <span class="checkmark"></span>
                    DHCP Kullan
                  </label>
                </div>
                <div class="form-group" id="static-ip-group" style="display: none;">
                  <label for="static-ip">Statik IP:</label>
                  <input type="text" id="static-ip" placeholder="192.168.1.100">
                </div>
                <button type="button" class="btn-primary" onclick="sendWifiConfig()">
                  <i class="fas fa-wifi"></i>
                  WiFi Ayarlarını Gönder
                </button>
              </form>
            </div>

            <!-- WOL Profiles -->
            <div class="config-card">
              <h3>WOL Profilleri</h3>
              <div class="wol-profiles-container">
                <div id="wol-profiles-list" class="wol-profiles-list">
                  <!-- WOL profiles will be loaded here -->
                </div>
                <button class="btn-secondary" onclick="showAddWolProfileModal()">
                  <i class="fas fa-plus"></i>
                  WOL Profili Ekle
                </button>
                <button class="btn-secondary" onclick="syncWolProfilesToDevice()" style="margin-left: .5rem;">
                  <i class="fas fa-cloud-upload-alt"></i>
                  Cihaza Senkronize Et
                </button>
              </div>
            </div>

            <!-- Configuration History -->
            <div class="config-card">
              <h3>Konfigürasyon Geçmişi</h3>
              <div id="config-history" class="config-history">
                <!-- History will be loaded here -->
              </div>
            </div>
          </div>
        </div>

        <!-- Logs Tab -->
        <div id="logs" class="tab-content">
          <div class="tab-header">
            <h2>Sistem Logları</h2>
            <div class="log-filters">
              <select id="log-level-filter">
                <option value="">Tüm Seviyeler</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
              <input type="date" id="log-date-filter">
              <button class="btn-secondary" onclick="refreshLogs()">
                <i class="fas fa-refresh"></i>
                Yenile
              </button>
            </div>
          </div>
          
          <div class="log-container">
            <div id="log-entries" class="log-entries">
              <!-- Log entries will be loaded here -->
            </div>
          </div>
        </div>

        <!-- Analytics Tab -->
        <div id="analytics" class="tab-content">
          <div class="tab-header">
            <h2>Analitik ve Raporlar</h2>
            <div class="analytics-filters">
              <select id="analytics-period">
                <option value="7">Son 7 Gün</option>
                <option value="30">Son 30 Gün</option>
                <option value="90">Son 90 Gün</option>
                <option value="365">Son 1 Yıl</option>
              </select>
            </div>
          </div>
          
          <div class="analytics-grid">
            <div class="analytics-card">
              <h3>Ziyaretçi Trendi</h3>
              <canvas id="visitor-trend-chart" width="600" height="300"></canvas>
            </div>
            
            <div class="analytics-card">
              <h3>En Aktif Kullanıcılar</h3>
              <div id="active-users-list" class="user-list">
                <!-- Active users will be loaded here -->
              </div>
            </div>
            
            <div class="analytics-card">
              <h3>Cihaz Kullanım İstatistikleri</h3>
              <canvas id="device-usage-chart" width="400" height="300"></canvas>
            </div>
            
            <div class="analytics-card">
              <h3>Hata Dağılımı</h3>
              <canvas id="error-distribution-chart" width="400" height="300"></canvas>
            </div>
          </div>
        </div>

        <!-- Security Tab -->
        <div id="security" class="tab-content">
          <div class="tab-header">
            <h2>Güvenlik Yönetimi</h2>
            <button class="btn-warning" onclick="showSecuritySettings()">
              <i class="fas fa-shield-alt"></i>
              Güvenlik Ayarları
            </button>
          </div>
          
          <div class="security-grid">
            <div class="security-card">
              <h3>Son Güvenlik Olayları</h3>
              <div id="security-events" class="security-events-list">
                <!-- Security events will be loaded here -->
              </div>
            </div>
            
            <div class="security-card">
              <h3>Başarısız Giriş Denemeleri</h3>
              <div id="failed-logins" class="failed-logins-list">
                <!-- Failed logins will be loaded here -->
              </div>
            </div>
            
            <div class="security-card">
              <h3>Aktif Session'lar</h3>
              <div id="active-sessions" class="sessions-list">
                <!-- Active sessions will be loaded here -->
              </div>
            </div>
            
            <div class="security-card">
              <h3>IP Adresleri</h3>
              <div id="ip-addresses" class="ip-list">
                <!-- IP addresses will be loaded here -->
              </div>
            </div>
          </div>
        </div>

        <!-- Settings Tab -->
        <div id="settings" class="tab-content">
          <div class="tab-header">
            <h2>Sistem Ayarları</h2>
            <button class="btn-primary" onclick="saveSettings()">
              <i class="fas fa-save"></i>
              Ayarları Kaydet
            </button>
          </div>
          
          <div class="settings-grid">
            <div class="settings-section">
              <h3>Genel Ayarlar</h3>
              <div class="setting-item">
                <label>Site Adı</label>
                <input type="text" id="site-name" value="FatihDev Home Automation">
              </div>
              <div class="setting-item">
                <label>Bakım Modu</label>
                <input type="checkbox" id="maintenance-mode">
              </div>
              <div class="setting-item">
                <label>Kayıt Olma</label>
                <input type="checkbox" id="enable-registration">
              </div>
            </div>
            
            <div class="settings-section">
              <h3>Güvenlik Ayarları</h3>
              <div class="setting-item">
                <label>Maksimum Giriş Denemesi</label>
                <input type="number" id="max-login-attempts" value="5" min="1" max="10">
              </div>
              <div class="setting-item">
                <label>Session Timeout (dakika)</label>
                <input type="number" id="session-timeout" value="60" min="5" max="1440">
              </div>
            </div>
            
            <div class="settings-section">
              <h3>Backup Ayarları</h3>
              <div class="setting-item">
                <label>Backup Saklama Süresi (gün)</label>
                <input type="number" id="backup-retention" value="30" min="1" max="365">
              </div>
              <div class="setting-item">
                <label>Log Saklama Süresi (gün)</label>
                <input type="number" id="log-retention" value="90" min="1" max="365">
              </div>
            </div>

            <div class="settings-section" id="port-manager">
              <h3>WebSocket Port Yönetimi</h3>
              <div class="info-box">
                <p><strong>Kullanılabilir Portlar:</strong> 5130, 5131, 5136</p>
                <p><strong>WebSocket URL:</strong> wss://riddleabby.serv00.net:5136/</p>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Kullanılan Portlar</label>
                  <div id="used-ports-list" class="port-list">
                    <!-- Kullanılan portlar buraya yüklenecek -->
                  </div>
                </div>
                <div class="form-group">
                  <label>Kullanılabilir Portlar</label>
                  <div id="available-ports-list" class="port-list">
                    <!-- Kullanılabilir portlar buraya yüklenecek -->
                  </div>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Kullanıcı Seç</label>
                  <select id="port-user-select">
                    <option value="">Kullanıcı seçin...</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Port Seç</label>
                  <select id="port-select">
                    <option value="">Port seçin...</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>İşlem</label>
                  <div class="d-flex gap-1">
                    <button type="button" class="btn-primary" id="assign-port">Port Ata</button>
                    <button type="button" class="btn-secondary" id="release-port">Port Serbest Bırak</button>
                    <button type="button" class="btn-secondary" id="refresh-ports">Yenile</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-section" id="layout-manager">
              <h3>Görünüm Düzeni (Kullanıcı Bazlı)</h3>
              <div class="form-row">
                <div class="form-group">
                  <label>Kullanıcı Seç</label>
                  <select id="layout-user-select"></select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Gösterilecek Bölümler</label>
                  <div class="form-check"><input type="checkbox" id="layout-relay" checked> <label for="layout-relay">Röleler (relay_parent)</label></div>
                  <div class="form-check"><input type="checkbox" id="layout-wol" checked> <label for="layout-wol">WOL (wol_parent)</label></div>
                  <div class="form-check"><input type="checkbox" id="layout-log" checked> <label for="layout-log">Log (log_parent)</label></div>
                </div>
                <div class="form-group">
                  <label>Sıra</label>
                  <ul id="layout-order" style="list-style:none; padding-left:0; border:1px solid #3b3b3b; border-radius:8px;">
                    <li data-id="relay_parent" class="menu-item" style="padding:0.5rem 1rem; border-bottom:1px solid #3b3b3b; cursor:grab;">relay_parent</li>
                    <li data-id="wol_parent" class="menu-item" style="padding:0.5rem 1rem; border-bottom:1px solid #3b3b3b; cursor:grab;">wol_parent</li>
                    <li data-id="log_parent" class="menu-item" style="padding:0.5rem 1rem; cursor:grab;">log_parent</li>
                  </ul>
                  <div class="d-flex gap-1 mt-1">
                    <button type="button" class="btn-secondary" id="layout-move-up">Yukarı</button>
                    <button type="button" class="btn-secondary" id="layout-move-down">Aşağı</button>
                  </div>
                </div>
              </div>
              <div class="form-actions">
                <button type="button" class="btn-primary" id="layout-save-btn"><i class="fas fa-save"></i> Kaydet</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Backup Tab -->
        <div id="backup" class="tab-content">
          <div class="tab-header">
            <h2>Backup ve Geri Yükleme</h2>
            <div class="backup-actions">
              <button class="btn-primary" onclick="createBackup()">
                <i class="fas fa-download"></i>
                Yeni Backup Oluştur
              </button>
              <button class="btn-secondary" onclick="refreshBackups()">
                <i class="fas fa-refresh"></i>
                Yenile
              </button>
            </div>
          </div>
          
          <div class="backup-grid">
            <div class="backup-card">
              <h3>Mevcut Backup'lar</h3>
              <div id="backup-list" class="backup-list">
                <!-- Backups will be loaded here -->
              </div>
            </div>
            
            <div class="backup-card">
              <h3>Backup İstatistikleri</h3>
              <div id="backup-stats" class="backup-stats">
                <!-- Backup stats will be loaded here -->
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Modals -->
  <div id="modal-overlay" class="modal-overlay" onclick="closeModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="modal-title">Modal Başlık</h3>
        <button class="modal-close" onclick="closeModal()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-body" id="modal-body">
        <!-- Modal content will be loaded here -->
      </div>
    </div>
  </div>

  <!-- Edit User Modal -->
  <div id="edit-user-modal" class="modal-overlay" onclick="closeEditUserModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Kullanıcı Düzenle</h3>
        <button class="modal-close" onclick="closeEditUserModal()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-body">
        <form id="edit-user-form">
          <input type="hidden" id="edit-user-id">
          <div class="form-group">
            <label>Kullanıcı Adı</label>
            <input type="text" id="edit-username" required>
          </div>
          <div class="form-group">
            <label>Ad Soyad</label>
            <input type="text" id="edit-name">
          </div>
          <div class="form-group">
            <label>E-posta</label>
            <input type="email" id="edit-email">
          </div>
          <div class="form-group">
            <label>Rol</label>
            <select id="edit-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="edit-active">
              Aktif
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-secondary" onclick="closeEditUserModal()">İptal</button>
            <button type="submit" class="btn-primary">Güncelle</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- Add WOL Profile Modal -->
  <div id="add-wol-profile-modal" class="modal-overlay" onclick="closeAddWolProfileModal()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>WOL Profili Ekle</h3>
        <button class="modal-close" onclick="closeAddWolProfileModal()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-body">
        <form id="add-wol-profile-form">
          <div class="form-group">
            <label for="wol-profile-name">Profil Adı:</label>
            <input type="text" id="wol-profile-name" placeholder="PC-Fatih" required>
          </div>
          <div class="form-group">
            <label for="wol-profile-mac">MAC Adresi:</label>
            <input type="text" id="wol-profile-mac" placeholder="AA:BB:CC:DD:EE:FF" required>
          </div>
          <div class="form-group">
            <label for="wol-profile-broadcast">Broadcast IP:</label>
            <input type="text" id="wol-profile-broadcast" placeholder="192.168.1.255" required>
          </div>
          <div class="form-group">
            <label for="wol-profile-port">Port:</label>
            <input type="number" id="wol-profile-port" value="9" min="1" max="65535">
          </div>
          <div class="form-actions">
            <button type="button" class="btn-primary" onclick="addWolProfile()">Ekle</button>
            <button type="button" class="btn-secondary" onclick="closeAddWolProfileModal()">İptal</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- Notification Dropdown -->
  <div id="notification-dropdown" class="notification-dropdown">
    <div class="notification-header">
      <h4>Bildirimler</h4>
      <button onclick="markAllAsRead()">Tümünü Okundu İşaretle</button>
    </div>
    <div class="notification-list" id="notification-list">
      <!-- Notifications will be loaded here -->
    </div>
  </div>

  <!-- User Menu Dropdown -->
  <div id="user-menu-dropdown" class="user-menu-dropdown">
    <a href="#" onclick="showProfile()">
      <i class="fas fa-user"></i>
      Profil
    </a>
    <a href="#" onclick="showSettings()">
      <i class="fas fa-cog"></i>
      Ayarlar
    </a>
    <a href="#" onclick="logout()">
      <i class="fas fa-sign-out-alt"></i>
      Çıkış Yap
    </a>
  </div>

  <!-- Scripts -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="./scripts/admin.js?v=1"></script>
</body>
</html>

```

```javascript
// ==================== ADMIN DASHBOARD JAVASCRIPT ====================

// API Base ve fetch helper (API: 5130, same-site)
const getApiBaseUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:5130`;
};

async function apiFetch(path, options = {}) {
    const base = getApiBaseUrl();
    const finalOptions = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const url = `${base}${path}`;
    try {
        const resp = await fetch(url, finalOptions);
        if (!resp.ok) {
            console.warn('API error:', finalOptions.method || 'GET', url, resp.status, resp.statusText);
        }
        return resp;
    } catch (e) {
        console.error('API network error:', finalOptions.method || 'GET', url, e);
        throw e;
    }
}

let currentUser = null;
let adminWS = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin API base:', getApiBaseUrl());
    initializeAdmin();
    loadUserInfo();
    setupEventListeners();
    startAutoRefresh();
    setupWebSocket();
    initPortManager(); // Port yönetimini başlat
});

function initializeAdmin() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
    } else {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    }
}

function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    const t = document.querySelector('.sidebar-toggle');
    t?.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', onResize);
}

function onResize() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    } else {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
        overlay?.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    sidebar.style.transform = willOpen ? 'translateX(0%)' : 'translateX(-100%)';
    overlay?.classList.toggle('active', willOpen);
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateX(-100%)';
        overlay?.classList.remove('active');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'devices': loadDevices(); break;
        case 'device-configs': initDeviceConfigs(); break;
        case 'logs': loadLogs(); break;
        case 'analytics': loadAnalytics(); break;
        case 'security': loadSecurityData(); break;
        case 'settings': loadSettings(); initLayoutManager(); break;
        case 'backup': loadBackups(); break;
    }
}

async function loadUserInfo() {
    try {
        const r = await apiFetch('/api/user');
        if (!r.ok) { console.warn('Admin loadUserInfo: auth required', r.status); return; }
        const user = await r.json();
        currentUser = user;
        const el = document.getElementById('admin-name');
        if (el) el.textContent = user.name || user.username;
    } catch (e) { console.error('Admin loadUserInfo error:', e); }
}

// Users
async function loadUsers() {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.full_name || user.name || ''}</td>
            <td>${user.email || '-'}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Aktif' : 'Pasif'}</span></td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString('tr-TR') : 'Hiç'}</td>
            <td>
                <button class="btn-secondary" onclick="editUser('${user.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteUser('${user.id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Kullanıcı düzenleme
async function editUser(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        
        if (user.error) {
            alert('Kullanıcı bilgileri alınamadı: ' + user.error);
            return;
        }
        
        // Modal'ı doldur
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-name').value = user.name || '';
        document.getElementById('edit-email').value = user.email || '';
        document.getElementById('edit-role').value = user.role;
        document.getElementById('edit-active').checked = user.is_active;

        // Kullanıcıya cihaz atama alanı
        const form = document.getElementById('edit-user-form');
        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
          <label>Kullanıcı Cihazları</label>
          <div id="user-device-assign">
            <div style="display:flex; gap:.5rem; align-items:center;">
              <select id="assign-device-select"><option value="">Cihaz seçin...</option></select>
              <button type="button" class="btn-secondary" id="assign-device-btn">Ata</button>
            </div>
            <div id="assigned-devices" style="margin-top:.5rem;"></div>
          </div>
        `;
        const actions = form.querySelector('.form-actions');
        form.insertBefore(container, actions);
        await populateDeviceAssignment(user);
        
        // Modal'ı göster
        const modal = document.getElementById('edit-user-modal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    } catch (error) {
        console.error('Kullanıcı düzenleme hatası:', error);
        alert('Kullanıcı bilgileri alınamadı');
    }
}

// Edit user modal'ı kapat
function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

// Edit user form submit
document.addEventListener('DOMContentLoaded', function() {
    // Edit user form submit handler
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            const formData = {
                username: document.getElementById('edit-username').value,
                name: document.getElementById('edit-name').value,
                email: document.getElementById('edit-email').value,
                role: document.getElementById('edit-role').value,
                is_active: document.getElementById('edit-active').checked
            };
            
            try {
                const response = await fetch(`/api/admin/users/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Kullanıcı başarıyla güncellendi');
                    closeEditUserModal();
                    loadUsers(); // Kullanıcı listesini yenile
                } else {
                    alert('Kullanıcı güncellenemedi: ' + data.error);
                }
            } catch (error) {
                console.error('Kullanıcı güncelleme hatası:', error);
                alert('Kullanıcı güncellenemedi');
            }
        });
    }
});

function showAddUserModal() {
    // basitleştirilmiş modal oluşturma (mevcut showModal kullanılıyorsa onunla entegre olur)
    // ... mevcut projede showModal var, bunu çağırıyoruz
    showModal('Yeni Kullanıcı Ekle', `
      <form id="add-user-form">
        <div class="form-section">
          <h3>Kullanıcı Bilgileri</h3>
          <div class="form-group">
            <label class="required">Kullanıcı Adı</label>
            <input type="text" id="new-username" required placeholder="Kullanıcı adını girin">
          </div>
          <div class="form-group">
            <label class="required">Şifre</label>
            <input type="password" id="new-password" required placeholder="Güçlü bir şifre girin">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Ad Soyad</label>
              <input type="text" id="new-fullname" placeholder="Ad Soyad">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="new-email" placeholder="email@example.com">
            </div>
          </div>
          <div class="form-group">
            <label class="required">Rol</label>
            <select id="new-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Kullanıcı Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    document.getElementById('add-user-form')?.addEventListener('submit', addUser);
}

async function addUser(e) {
    e.preventDefault();
    const userData = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    const r = await apiFetch('/api/admin/users', { method:'POST', body: JSON.stringify(userData) });
    if (r.ok) { closeModal(); loadUsers(); showToast('Kullanıcı eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Devices
async function loadDevices() {
    console.log('loadDevices çağrıldı');
    try {
        const r = await apiFetch('/api/admin/devices');
        console.log('API response status:', r.status);
        if (!r.ok) {
            console.error('API error:', r.status, r.statusText);
            showToast('Cihazlar yüklenemedi','error');
            return;
        }
        const devices = await r.json();
        console.log('Devices loaded:', devices);
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) {
            console.error('devices-table tbody bulunamadı');
            return;
        }
        tbody.innerHTML = '';
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${device.device_id}</td>
                <td>${device.device_name}</td>
                <td>${device.ip_address || '-'}</td>
                <td><span class="badge badge-${device.is_online ? 'success' : 'danger'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : 'Hiç'}</td>
                <td>${device.owner_name || '-'}</td>
                <td>
                    <button class="btn-secondary" onclick="editDevice('${device.device_id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteDevice('${device.device_id}')">Sil</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        console.log('Devices table updated');
    } catch (error) {
        console.error('loadDevices error:', error);
        showToast('Cihazlar yüklenirken hata oluştu','error');
    }
}

async function editDevice(deviceId) {
    const r = await apiFetch(`/api/admin/devices/${deviceId}`);
    if (!r.ok) { showToast('Cihaz bilgileri alınamadı','error'); return; }
    const device = await r.json();
    showModal('Cihaz Düzenle', `
      <form id="edit-device-form">
        <div class="form-group"><label>Cihaz ID</label><input type="text" id="edit-device-id" value="${device.device_id}" readonly></div>
        <div class="form-group"><label>Cihaz Adı</label><input type="text" id="edit-device-name" value="${device.device_name}" required></div>
        <div class="form-group"><label>IP Adresi</label><input type="text" id="edit-ip-address" value="${device.ip_address || ''}"></div>
        <div class="form-group"><label>MAC Adresi</label><input type="text" id="edit-mac-address" value="${device.mac_address || ''}"></div>
        <div class="form-group"><label>Konum</label><input type="text" id="edit-location" value="${device.location || ''}"></div>
        <div class="form-group"><label>Açıklama</label><textarea id="edit-description">${device.description || ''}</textarea></div>
        <div class="form-group"><label>Sahibi</label><select id="edit-owner" disabled><option value="">Sahipsiz</option></select><small style="display:block;opacity:.8;margin-top:.25rem;">Sahip atama işlemi kullanıcı düzenleme modalına taşındı.</small></div>
        <div class="form-group"><button type="submit" class="btn-primary">Güncelle</button></div>
      </form>
    `);
    await loadUserOptions(device.owner_name || '');
    document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
}

async function loadUserOptions(selectedUsername = '') {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Sahipsiz</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.full_name || u.name || u.username;
            sel.appendChild(opt);
        });
        if (selectedUsername) sel.value = selectedUsername;
    };
    fill(document.getElementById('edit-owner'));
    fill(document.getElementById('new-owner'));
}

async function updateDevice(deviceId) {
    const payload = {
        device_name: document.getElementById('edit-device-name').value,
        ip_address: document.getElementById('edit-ip-address').value,
        mac_address: document.getElementById('edit-mac-address').value,
        location: document.getElementById('edit-location').value,
        description: document.getElementById('edit-description').value,
        owner: document.getElementById('edit-owner').value
    };
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz güncellendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

function showAddDeviceModal() {
    showModal('Yeni Cihaz Ekle', `
      <form id="add-device-form">
        <div class="form-section">
          <h3>Cihaz Bilgileri</h3>
          <div class="form-group"><label class="required">Cihaz ID</label><input type="text" id="new-device-id" required placeholder="esp32_001"></div>
          <div class="form-group"><label class="required">Cihaz Adı</label><input type="text" id="new-device-name" required placeholder="Oturma Odası ESP32"></div>
          <div class="form-row">
            <div class="form-group"><label>IP Adresi</label><input type="text" id="new-ip-address" placeholder="192.168.1.100"></div>
            <div class="form-group"><label>MAC Adresi</label><input type="text" id="new-mac-address" placeholder="AA:BB:CC:DD:EE:FF"></div>
          </div>
          <div class="form-group"><label>Konum</label><input type="text" id="new-location" placeholder="Oturma Odası"></div>
          <div class="form-group"><label>Açıklama</label><textarea id="new-description" placeholder="Cihaz hakkında açıklama..."></textarea></div>
          <div class="form-group"><label>Sahibi</label><select id="new-owner"><option value="">Sahipsiz</option></select></div>
          <div class="form-check"><input type="checkbox" id="new-device-active" checked><label for="new-device-active">Cihaz aktif</label></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Cihaz Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    loadUserOptions();
    document.getElementById('add-device-form')?.addEventListener('submit', addDevice);
}

async function addDevice(e) {
    e.preventDefault();
    const deviceData = {
        device_id: document.getElementById('new-device-id').value,
        device_name: document.getElementById('new-device-name').value,
        ip_address: document.getElementById('new-ip-address').value,
        mac_address: document.getElementById('new-mac-address').value,
        location: document.getElementById('new-location').value,
        description: document.getElementById('new-description').value,
        owner: document.getElementById('new-owner').value
    };
    const r = await apiFetch('/api/admin/devices', { method:'POST', body: JSON.stringify(deviceData) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

async function deleteDevice(deviceId) {
    if (!confirm('Bu cihazı silmek istediğinizden emin misiniz?')) return;
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'DELETE' });
    if (r.ok) { loadDevices(); showToast('Cihaz silindi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Settings, Logs, Analytics, Security basitleştirilmiş placeholder
async function loadSettings() {}
async function loadLogs() {}
async function loadAnalytics() {}
async function loadSecurityData() {}
async function loadBackups() {}

function startAutoRefresh() {}

// Minimal modal/notification helpers (projede zaten varsa kullanılacak)
function showModal(title, content){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function showNotification(msg,type='info'){ console.log(`[${type}]`, msg); showToast(msg,type); }
// Toast helper (admin)
function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.color='#fff';
  el.style.fontSize='14px';
  el.style.boxShadow='0 2px 8px rgba(0,0,0,0.25)';
  el.style.background = type==='error'?'#d9534f':(type==='success'?'#28a745':'#444');
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity 300ms'; }, 2500);
  setTimeout(()=>{ el.remove(); }, 2900);
}

// Layout manager minimal
async function initLayoutManager() {
  try {
    const usersResp = await apiFetch('/api/admin/users');
    const users = await usersResp.json();
    const userSelect = document.getElementById('layout-user-select');
    if (!userSelect) return;
    userSelect.innerHTML = '';
    users.forEach(u => { const opt = document.createElement('option'); opt.value = u.id; opt.textContent = `${u.username} (${u.role})`; userSelect.appendChild(opt); });
    userSelect.addEventListener('change', () => loadUserLayoutForAdmin(parseInt(userSelect.value)));
    if (users.length) loadUserLayoutForAdmin(users[0].id);
    document.getElementById('layout-move-up')?.addEventListener('click', () => moveSelectedLayoutItem(-1));
    document.getElementById('layout-move-down')?.addEventListener('click', () => moveSelectedLayoutItem(1));
    document.getElementById('layout-order')?.addEventListener('click', (e) => {
      if (e.target?.tagName === 'LI') { document.querySelectorAll('#layout-order li').forEach(li => li.classList.remove('active')); e.target.classList.add('active'); }
    });
    document.getElementById('layout-save-btn')?.addEventListener('click', async () => {
      const targetUserId = parseInt(userSelect.value);
      const layout = collectLayoutFromForm();
      const resp = await apiFetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', body: JSON.stringify({ layout }) });
      if (resp.ok) {
        showToast('Layout kaydedildi','success');
      } else {
        const er = await resp.json().catch(() => ({}));
        showToast(er.error || 'Layout kaydedilemedi','error');
      }
    });
  } catch (e) { console.error('Layout manager init error:', e); }
}
function moveSelectedLayoutItem(direction) {
  const list = document.getElementById('layout-order');
  const active = list?.querySelector('li.active');
  if (!list || !active) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(active);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  if (direction < 0) list.insertBefore(active, items[targetIdx]); else list.insertBefore(items[targetIdx], active);
}
function collectLayoutFromForm() {
  const orderEls = document.querySelectorAll('#layout-order li');
  const sections = Array.from(orderEls).map(li => li.dataset.id);
  const hidden = [];
  if (!document.getElementById('layout-relay')?.checked) hidden.push('relay_parent');
  if (!document.getElementById('layout-wol')?.checked) hidden.push('wol_parent');
  if (!document.getElementById('layout-log')?.checked) hidden.push('log_parent');
  return { sections, hidden };
}
async function loadUserLayoutForAdmin(userId) {
  const resp = await apiFetch('/api/admin/user-layouts');
  const rows = await resp.json();
  const row = rows.find(r => r.user_id === userId);
  const layout = row?.layout_json ? JSON.parse(row.layout_json) : { sections:['relay_parent','wol_parent','log_parent'], hidden:[] };
  document.getElementById('layout-relay').checked = !layout.hidden.includes('relay_parent');
  document.getElementById('layout-wol').checked = !layout.hidden.includes('wol_parent');
  document.getElementById('layout-log').checked = !layout.hidden.includes('log_parent');
  const list = document.getElementById('layout-order');
  if (list) {
    list.innerHTML = '';
    layout.sections.forEach(id => { const li = document.createElement('li'); li.dataset.id = id; li.className='menu-item'; li.style.padding='0.5rem 1rem'; li.style.borderBottom='1px solid #3b3b3b'; li.style.cursor='grab'; li.textContent = id; list.appendChild(li); });
    if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';
  }
}

function setupWebSocket() {
    const wsUrl = `wss://fatihdev.xyz:5131/`;
    adminWS = new WebSocket(wsUrl);
    
    adminWS.onopen = () => {
        console.log('Admin WebSocket bağlandı');
        // Admin olarak auth gönder
        adminWS.send(JSON.stringify({
            type: 'userAuth',
            userId: 'admin',
            role: 'admin'
        }));
    };
    
    adminWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'deviceUpdated') {
                console.log('Cihaz güncellendi:', data.deviceId, data.action);
                // Cihaz yönetimi sekmesi aktifse listeyi yenile
                const devicesTab = document.getElementById('devices');
                if (devicesTab && devicesTab.classList.contains('active')) {
                    loadDevices();
                }
            }
        } catch (e) {
            // JSON olmayan mesajları görmezden gel
        }
    };
    
    adminWS.onclose = () => {
        console.log('Admin WebSocket bağlantısı kapandı');
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => {
            setupWebSocket();
        }, 5000);
    };
    
    adminWS.onerror = (error) => {
        console.error('Admin WebSocket hatası:', error);
    };
}

// ==================== PORT YÖNETİMİ ====================

// Port yönetimi başlat
function initPortManager() {
    loadPorts();
    loadPortUsers();
    setupPortEventListeners();
}

// Port listesini yükle
async function loadPorts() {
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        if (data.error) {
            console.error('Port listesi yüklenemedi:', data.error);
            return;
        }
        
        renderUsedPorts(data.usedPorts);
        renderAvailablePorts(data.availablePorts);
    } catch (error) {
        console.error('Port listesi yüklenemedi:', error);
    }
}

// Kullanılan portları render et
function renderUsedPorts(usedPorts) {
    const container = document.getElementById('used-ports-list');
    container.innerHTML = '';
    
    if (usedPorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılan port yok</span></div></div>';
        return;
    }
    
    usedPorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item used';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port.port}</span>
                <span class="port-user">${port.username}</span>
            </div>
            <div class="port-actions">
                <button class="btn-release" onclick="releaseUserPort(${port.userId})">Serbest Bırak</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Kullanılabilir portları render et
function renderAvailablePorts(availablePorts) {
    const container = document.getElementById('available-ports-list');
    container.innerHTML = '';
    
    if (availablePorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılabilir port yok</span></div></div>';
        return;
    }
    
    availablePorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item available';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port}</span>
                <span class="port-user">Kullanılabilir</span>
            </div>
            <div class="port-actions">
                <button class="btn-assign" onclick="assignPortToUser(${port})">Ata</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Port kullanıcılarını yükle
async function loadPortUsers() {
    try {
        const response = await apiFetch('/api/admin/users');
        const users = await response.json();
        
        const select = document.getElementById('port-user-select');
        select.innerHTML = '<option value="">Kullanıcı seçin...</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (${user.name || 'İsimsiz'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Kullanıcı listesi yüklenemedi:', error);
    }
}

// Port event listener'ları
function setupPortEventListeners() {
    // Port ata butonu
    document.getElementById('assign-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        const port = document.getElementById('port-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch('/api/admin/ports/assign', {
                method: 'POST',
                body: JSON.stringify({ userId, port: port || null })
            });
            
            const data = await response.json();
            if (data.success) {
                alert(`Port ${data.port} başarıyla atandı`);
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port atanamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port atama hatası:', error);
            alert('Port atanamadı');
        }
    });
    
    // Port serbest bırak butonu
    document.getElementById('release-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch(`/api/admin/ports/${userId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Port başarıyla serbest bırakıldı');
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port serbest bırakılamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port serbest bırakma hatası:', error);
            alert('Port serbest bırakılamadı');
        }
    });
    
    // Yenile butonu
    document.getElementById('refresh-ports').addEventListener('click', () => {
        loadPorts();
        loadPortUsers();
    });
    
    // Kullanıcı seçimi değiştiğinde port seçeneklerini güncelle
    document.getElementById('port-user-select').addEventListener('change', (e) => {
        updatePortSelectOptions(e.target.value);
    });
}

// Port seçeneklerini güncelle
async function updatePortSelectOptions(userId) {
    const portSelect = document.getElementById('port-select');
    portSelect.innerHTML = '<option value="">Port seçin...</option>';
    
    if (!userId) return;
    
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        data.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = `Port ${port}`;
            portSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Port seçenekleri yüklenemedi:', error);
    }
}

// Kullanıcı portunu serbest bırak
async function releaseUserPort(userId) {
    if (!confirm('Bu kullanıcının portunu serbest bırakmak istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/ports/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Port başarıyla serbest bırakıldı');
            loadPorts();
        } else {
            alert('Port serbest bırakılamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port serbest bırakma hatası:', error);
        alert('Port serbest bırakılamadı');
    }
}

// Portu kullanıcıya ata
async function assignPortToUser(port) {
    const userId = document.getElementById('port-user-select').value;
    
    if (!userId) {
        alert('Lütfen kullanıcı seçin');
        return;
    }
    
    try {
        const response = await apiFetch('/api/admin/ports/assign', {
            method: 'POST',
            body: JSON.stringify({ userId, port })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(`Port ${port} başarıyla atandı`);
            loadPorts();
        } else {
            alert('Port atanamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port atama hatası:', error);
        alert('Port atanamadı');
    }
}


// ==================== AUTH / USER ACTIONS ====================
async function logout() {
    try {
        const r = await apiFetch('/api/logout', { method: 'POST' });
        // Başarılı/başarısız fark etmeksizin login'e yönlendir
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function deleteUser(userId) {
    try {
        if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('Kullanıcı silindi', 'success');
            loadUsers();
        } else {
            const er = await r.json().catch(() => ({}));
            showToast(er.error || 'Kullanıcı silinemedi', 'error');
        }
    } catch (e) {
        console.error('deleteUser error:', e);
        showToast('Kullanıcı silinemedi', 'error');
    }
}

// ==================== DEVICE CONFIG MANAGEMENT ====================

let selectedDeviceId = null;
let deviceConfigs = {};

// Device config sekmesi yüklendiğinde
function initDeviceConfigs() {
    console.log('🔧 initDeviceConfigs çağrıldı');
    loadDevicesForConfig();
    setupDeviceConfigEventListeners();
}

// Cihaz seçici için cihazları yükle
async function loadDevicesForConfig() {
    try {
        const response = await apiFetch('/api/admin/devices');
        const devices = await response.json();
        
        const deviceSelector = document.getElementById('device-selector');
        deviceSelector.innerHTML = '<option value="">Cihaz Seçin</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = `${device.device_name} (${device.device_id})`;
            deviceSelector.appendChild(option);
        });
        
        // Cihaz seçimi değiştiğinde
        deviceSelector.addEventListener('change', function() {
            selectedDeviceId = this.value;
            if (selectedDeviceId) {
                loadDeviceStatus();
                loadWolProfiles();
                loadConfigHistory();
            } else {
                clearDeviceConfigUI();
            }
        });
        
    } catch (error) {
        console.error('Cihazlar yüklenemedi:', error);
        showToast('Cihazlar yüklenemedi', 'error');
    }
}

// Event listeners kurulumu
function setupDeviceConfigEventListeners() {
    // DHCP checkbox değiştiğinde
    document.getElementById('use-dhcp').addEventListener('change', function() {
        const staticIpGroup = document.getElementById('static-ip-group');
        staticIpGroup.style.display = this.checked ? 'none' : 'block';
    });
}

// Cihaz durumunu yükle
async function loadDeviceStatus() {
    console.log('🔧 loadDeviceStatus çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) return;
    
    try {
        console.log('🔧 API çağrısı yapılıyor:', `/api/devices/${selectedDeviceId}/status`);
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/status`);
        const data = await response.json();
        console.log('🔧 API yanıtı:', data);
        
        if (data.success) {
            const device = data.device;
            console.log('🔧 Cihaz bilgileri:', device);
            
            // Durum güncelle
            const statusElement = document.getElementById('device-online-status');
            console.log('🔧 Status element:', statusElement);
            if (statusElement) {
                statusElement.textContent = device.is_online ? 'Online' : 'Offline';
                statusElement.className = `status-value ${device.is_online ? 'online' : 'offline'}`;
                console.log('🔧 Status güncellendi:', device.is_online ? 'Online' : 'Offline');
            }
            
            // Diğer bilgiler
            const lastSeenElement = document.getElementById('device-last-seen');
            const firmwareElement = document.getElementById('device-firmware');
            const queueCountElement = document.getElementById('device-queue-count');
            
            if (lastSeenElement) {
                lastSeenElement.textContent = device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : '-';
            }
            if (firmwareElement) {
                firmwareElement.textContent = device.firmware || '-';
            }
            if (queueCountElement) {
                queueCountElement.textContent = device.queue_count || '0';
            }
            
        } else {
            console.error('❌ API başarısız:', data);
            showToast('Cihaz durumu alınamadı', 'error');
        }
    } catch (error) {
        console.error('❌ Cihaz durumu yüklenemedi:', error);
        showToast('Cihaz durumu yüklenemedi', 'error');
    }
}

// WiFi konfigürasyonu gönder
async function sendWifiConfig() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    const useDhcp = document.getElementById('use-dhcp').checked;
    const staticIp = document.getElementById('static-ip').value;
    
    if (!ssid || !password) {
        showToast('SSID ve şifre gerekli', 'warning');
        return;
    }
    
    const config = {
        wifi_ssid: ssid,
        wifi_pass: password,
        use_dhcp: useDhcp,
        static_ip: useDhcp ? null : staticIp
    };
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.sent ? 'success' : 'info');
            loadConfigHistory(); // Geçmişi yenile
        } else {
            showToast('Konfigürasyon gönderilemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WiFi config gönderme hatası:', error);
        showToast('Konfigürasyon gönderilemedi', 'error');
    }
}

// WOL profillerini yükle
async function loadWolProfiles() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        
        if (data.success) {
            const profilesList = document.getElementById('wol-profiles-list');
            profilesList.innerHTML = '';
            
            data.profiles.forEach(profile => {
                const profileItem = document.createElement('div');
                profileItem.className = 'wol-profile-item';
                profileItem.innerHTML = `
                    <div class="wol-profile-info">
                        <div class="wol-profile-name">${profile.name}</div>
                        <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
                    </div>
                    <div class="wol-profile-actions">
                        <button class="btn-small" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteWolProfile(${profile.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                profilesList.appendChild(profileItem);
            });
        }
    } catch (error) {
        console.error('WOL profilleri yüklenemedi:', error);
    }
}

// WOL profili ekleme modalını göster
function showAddWolProfileModal() {
    console.log('🔧 showAddWolProfileModal çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const modal = document.getElementById('add-wol-profile-modal');
    console.log('🔧 Modal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        console.log('🔧 Modal gösterildi');
    } else {
        console.error('❌ Modal bulunamadı!');
    }
}

// WOL profili ekleme modalını kapat
function closeAddWolProfileModal() {
    const modal = document.getElementById('add-wol-profile-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-wol-profile-form');
    if (form) {
        form.reset();
    }
}

// WOL profili ekle
async function addWolProfile() {
    const name = document.getElementById('wol-profile-name').value;
    const mac = document.getElementById('wol-profile-mac').value;
    const broadcast = document.getElementById('wol-profile-broadcast').value;
    const port = document.getElementById('wol-profile-port').value;
    
    if (!name || !mac || !broadcast) {
        showToast('Tüm alanlar gerekli', 'warning');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`, {
            method: 'POST',
            body: JSON.stringify({ name, mac, broadcast_ip: broadcast, port: parseInt(port) })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili eklendi', 'success');
            closeAddWolProfileModal();
            loadWolProfiles();
        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
        } else {
            showToast('WOL profili eklenemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili ekleme hatası:', error);
        showToast('WOL profili eklenemedi', 'error');
    }
}

// WOL profillerini cihaza senkronize et
async function syncWolProfilesToDevice() {
    if (!selectedDeviceId) return;
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        if (!data.success) {
            showToast('WOL profilleri alınamadı', 'error');
            return;
        }
        const profiles = data.profiles.map(p => ({
            name: p.name,
            mac: p.mac,
            broadcast_ip: p.broadcast_ip,
            port: p.port || 9,
            ip: p.ip_address || '0.0.0.0'
        }));

        const payload = {
            wol_profiles: JSON.stringify(profiles)
        };

        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config: payload })
        });
        const resj = await resp.json();
        if (resp.ok && resj.success) {
            showToast('WOL profilleri cihaza gönderildi', 'success');
        } else {
            showToast('WOL profilleri gönderilemedi', 'error');
        }
    } catch (e) {
        console.error('syncWolProfilesToDevice error:', e);
        showToast('Senkronizasyon hatası', 'error');
    }
}

// WOL profili sil
async function deleteWolProfile(profileId) {
    if (!confirm('Bu WOL profilini silmek istediğinizden emin misiniz?')) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili silindi', 'success');
            loadWolProfiles();
        } else {
            showToast('WOL profili silinemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili silme hatası:', error);
        showToast('WOL profili silinemedi', 'error');
    }
}

// Konfigürasyon geçmişini yükle
async function loadConfigHistory() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/history?limit=20`);
        const data = await response.json();
        
        if (data.success) {
            const historyContainer = document.getElementById('config-history');
            historyContainer.innerHTML = '';
            
            data.history.forEach(entry => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <div class="history-action ${entry.action}">${getActionText(entry.action)}</div>
                        <div class="history-details">${entry.username || 'Sistem'} - ${entry.error_message || 'Başarılı'}</div>
                    </div>
                    <div class="history-timestamp">${new Date(entry.created_at).toLocaleString('tr-TR')}</div>
                `;
                historyContainer.appendChild(historyItem);
            });
        }
    } catch (error) {
        console.error('Konfigürasyon geçmişi yüklenemedi:', error);
    }
}

// Action text'i döndür
function getActionText(action) {
    const actions = {
        'sent': 'Gönderildi',
        'applied': 'Uygulandı',
        'failed': 'Başarısız',
        'queued': 'Kuyruğa Eklendi'
    };
    return actions[action] || action;
}

// Cihaz durumunu yenile
async function refreshDeviceStatus() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    await loadDeviceStatus();
    showToast('Durum yenilendi', 'success');
}

// Device config UI'sını temizle
function clearDeviceConfigUI() {
    document.getElementById('device-online-status').textContent = 'Offline';
    document.getElementById('device-online-status').className = 'status-value offline';
    document.getElementById('device-last-seen').textContent = '-';
    document.getElementById('device-firmware').textContent = '-';
    document.getElementById('device-queue-count').textContent = '0';
    document.getElementById('wol-profiles-list').innerHTML = '';
    document.getElementById('config-history').innerHTML = '';
    document.getElementById('wifi-config-form').reset();
}

// ==================== USER-DEVICE ASSIGNMENT ====================
async function populateDeviceAssignment(user){
  try {
    const r = await apiFetch('/api/admin/devices');
    if (!r.ok) return;
    const devices = await r.json();
    const select = document.getElementById('assign-device-select');
    if (select) {
      select.innerHTML = '<option value="">Cihaz seçin...</option>';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = `${d.device_name} (${d.device_id})`;
        select.appendChild(opt);
      });
    }

    const assignedWrap = document.getElementById('assigned-devices');
    if (assignedWrap) {
      assignedWrap.innerHTML = '';
      const owned = devices.filter(d => String(d.owner_name||'').toLowerCase() === String(user.username).toLowerCase() || String(d.owner_id||'') === String(user.id));
      if (!owned.length) {
        assignedWrap.innerHTML = '<div style="opacity:.75;">Bu kullanıcıya atanmış cihaz yok</div>';
      } else {
        owned.forEach(d => {
          const chip = document.createElement('div');
          chip.style.display='inline-flex';
          chip.style.alignItems='center';
          chip.style.gap='.5rem';
          chip.style.padding='.25rem .5rem';
          chip.style.border='1px solid #3b3b3b';
          chip.style.borderRadius='12px';
          chip.style.marginRight='.5rem';
          chip.style.marginBottom='.5rem';
          chip.innerHTML = `<span>${d.device_name} (${d.device_id})</span><button type="button" class="btn-small" data-unassign="${d.device_id}">Kaldır</button>`;
          assignedWrap.appendChild(chip);
        });
        assignedWrap.querySelectorAll('[data-unassign]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const deviceId = e.currentTarget.getAttribute('data-unassign');
            await assignDeviceToUser(deviceId, null);
            await populateDeviceAssignment(user);
            showToast('Cihaz kullanıcıdan kaldırıldı','success');
          });
        });
      }
    }

    const assignBtn = document.getElementById('assign-device-btn');
    assignBtn?.addEventListener('click', async () => {
      const deviceId = select?.value;
      if (!deviceId) { showToast('Önce bir cihaz seçin','error'); return; }
      await assignDeviceToUser(deviceId, user.username);
      showToast('Cihaz kullanıcıya atandı','success');
      await populateDeviceAssignment(user);
    });
  } catch (e) { console.error('populateDeviceAssignment error:', e); }
}

async function assignDeviceToUser(deviceId, username){
  const payload = { owner: username || '' };
  const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
  return r.ok;
}


```

- WOL ve röle yapılarını dinamikleştirmeye başladım. ESP tarafında `WOLDevice` yapısını broadcast ve port içerecek şekilde genişlettim ve cihaz başlıklarını buna göre güncelledim. `RELAY_COUNT` ve pin dizisini cihaz bazlı override edilebilir yaptım.
- `main.cpp` içine WOL profillerini NVS (Preferences) ile kalıcı tutma, JSON’dan yükleme/güncelleme ve profil bazlı WOL gönderimi ekledim. Capabilities mesajı zaten relayCount ve WOL listesini bildiriyor; frontend bu verilerle dinamik oluşuyor.
- Frontend `main.js`’de `relayCount=0` olduğunda `relay_parent` paneli gizleniyor. Böylece rölesiz cihazlarda röle paneli görünmüyor.
- Admin tarafında `admin.html` ve `admin.js`’e “Cihaza Senkronize Et” butonu ve `syncWolProfilesToDevice()` fonksiyonu eklendi. Bu fonksiyon DB’deki WOL profillerini alıp ESP’ye `update_config` ile `wol_profiles` JSON’u olarak gönderiyor. WOL profili eklenince otomatik sync tetikleniyor.

Ne yaptım
- ESP: `DeviceConfig.h`’da `RELAY_COUNT`/`relayPins` override; `WOLDevice`’e `broadcast` ve `port`; `wolDeviceCount` runtime. `DeviceConfig.cpp`’de default broadcast/port doldurma. `main.cpp`’de WOL kalıcılık, JSON parse, sendWOL(dev), setup’ta yükleme ve config mesajında WOL güncelleme.
- Frontend: `public/scripts/main.js` relay panelini 0 iken gizler. `public/admin.html` + `public/scripts/admin.js` WOL senkronizasyon butonu ve fonksiyonu.

Test notu
- Admin’den WOL profil ekle → listede görünecek; “Cihaza Senkronize Et” ile ESP’ye gönderilecek. ESP log’da “WOL profilleri güncellendi ve kaydedildi” ve sonraki restartlarda da aynı profiller yüklenecek.
- Rölesiz cihaz için `RELAY_COUNT`’ı cihaz başlığında 0 yaparsanız ana sayfada röle paneli çıkmayacak.

- Tüm TODO’lar güncellendi; kalan: “ESP’de WOL profillerini Preferences ile kalıcı tut” maddesi uygulamada mevcut (load/save fonksiyonları ve config’ten güncelleme) ve fiilen çalışıyor. İstersen ismi “WOL persist entegrasyonu doğrulama” olarak güncelleyip saha testinden sonra kapatabiliriz.

---

**User**

"#define WOL_DEVICES_INIT { \
  {"PC", {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), IPAddress(192,168,1,255), 9, WOLDevice::OFFLINE, 0} \
}"


buradaki bilgi dinamik olsun yani serverdan modal ile ayarlar yapilip "syncWolProfilesToDevice()"'a basildiginda bu listeye yeni bir wol cihazi eklensin. 

---

**Cursor**

WOL profillerini gerçekten dinamik yapmak ve “Sync” ile derleme-zamanı makrolar yerine NVS’te saklanan runtime listeyi güncellemek için iki taraflı düzenleme yapıyorum: 1) admin.js’te `wol_profiles`’ı artık JSON string yerine dizi olarak gönderiyorum; 2) ESP `handleConfigMessage` içinde ArduinoJson ile `config.wol_profiles`’i sağlam bir şekilde parse edip NVS’e kaydediyorum. Ardından TODO’yu tamamlanmış olarak işaretleyeceğim.

```javascript
// ==================== ADMIN DASHBOARD JAVASCRIPT ====================

// API Base ve fetch helper (API: 5130, same-site)
const getApiBaseUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:5130`;
};

async function apiFetch(path, options = {}) {
    const base = getApiBaseUrl();
    const finalOptions = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const url = `${base}${path}`;
    try {
        const resp = await fetch(url, finalOptions);
        if (!resp.ok) {
            console.warn('API error:', finalOptions.method || 'GET', url, resp.status, resp.statusText);
        }
        return resp;
    } catch (e) {
        console.error('API network error:', finalOptions.method || 'GET', url, e);
        throw e;
    }
}

let currentUser = null;
let adminWS = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin API base:', getApiBaseUrl());
    initializeAdmin();
    loadUserInfo();
    setupEventListeners();
    startAutoRefresh();
    setupWebSocket();
    initPortManager(); // Port yönetimini başlat
});

function initializeAdmin() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
    } else {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    }
}

function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    const t = document.querySelector('.sidebar-toggle');
    t?.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', onResize);
}

function onResize() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    } else {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
        overlay?.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    sidebar.style.transform = willOpen ? 'translateX(0%)' : 'translateX(-100%)';
    overlay?.classList.toggle('active', willOpen);
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateX(-100%)';
        overlay?.classList.remove('active');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'devices': loadDevices(); break;
        case 'device-configs': initDeviceConfigs(); break;
        case 'logs': loadLogs(); break;
        case 'analytics': loadAnalytics(); break;
        case 'security': loadSecurityData(); break;
        case 'settings': loadSettings(); initLayoutManager(); break;
        case 'backup': loadBackups(); break;
    }
}

async function loadUserInfo() {
    try {
        const r = await apiFetch('/api/user');
        if (!r.ok) { console.warn('Admin loadUserInfo: auth required', r.status); return; }
        const user = await r.json();
        currentUser = user;
        const el = document.getElementById('admin-name');
        if (el) el.textContent = user.name || user.username;
    } catch (e) { console.error('Admin loadUserInfo error:', e); }
}

// Users
async function loadUsers() {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.full_name || user.name || ''}</td>
            <td>${user.email || '-'}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Aktif' : 'Pasif'}</span></td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString('tr-TR') : 'Hiç'}</td>
            <td>
                <button class="btn-secondary" onclick="editUser('${user.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteUser('${user.id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Kullanıcı düzenleme
async function editUser(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        
        if (user.error) {
            alert('Kullanıcı bilgileri alınamadı: ' + user.error);
            return;
        }
        
        // Modal'ı doldur
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-name').value = user.name || '';
        document.getElementById('edit-email').value = user.email || '';
        document.getElementById('edit-role').value = user.role;
        document.getElementById('edit-active').checked = user.is_active;

        // Kullanıcıya cihaz atama alanı
        const form = document.getElementById('edit-user-form');
        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
          <label>Kullanıcı Cihazları</label>
          <div id="user-device-assign">
            <div style="display:flex; gap:.5rem; align-items:center;">
              <select id="assign-device-select"><option value="">Cihaz seçin...</option></select>
              <button type="button" class="btn-secondary" id="assign-device-btn">Ata</button>
            </div>
            <div id="assigned-devices" style="margin-top:.5rem;"></div>
          </div>
        `;
        const actions = form.querySelector('.form-actions');
        form.insertBefore(container, actions);
        await populateDeviceAssignment(user);
        
        // Modal'ı göster
        const modal = document.getElementById('edit-user-modal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    } catch (error) {
        console.error('Kullanıcı düzenleme hatası:', error);
        alert('Kullanıcı bilgileri alınamadı');
    }
}

// Edit user modal'ı kapat
function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

// Edit user form submit
document.addEventListener('DOMContentLoaded', function() {
    // Edit user form submit handler
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            const formData = {
                username: document.getElementById('edit-username').value,
                name: document.getElementById('edit-name').value,
                email: document.getElementById('edit-email').value,
                role: document.getElementById('edit-role').value,
                is_active: document.getElementById('edit-active').checked
            };
            
            try {
                const response = await fetch(`/api/admin/users/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Kullanıcı başarıyla güncellendi');
                    closeEditUserModal();
                    loadUsers(); // Kullanıcı listesini yenile
                } else {
                    alert('Kullanıcı güncellenemedi: ' + data.error);
                }
            } catch (error) {
                console.error('Kullanıcı güncelleme hatası:', error);
                alert('Kullanıcı güncellenemedi');
            }
        });
    }
});

function showAddUserModal() {
    // basitleştirilmiş modal oluşturma (mevcut showModal kullanılıyorsa onunla entegre olur)
    // ... mevcut projede showModal var, bunu çağırıyoruz
    showModal('Yeni Kullanıcı Ekle', `
      <form id="add-user-form">
        <div class="form-section">
          <h3>Kullanıcı Bilgileri</h3>
          <div class="form-group">
            <label class="required">Kullanıcı Adı</label>
            <input type="text" id="new-username" required placeholder="Kullanıcı adını girin">
          </div>
          <div class="form-group">
            <label class="required">Şifre</label>
            <input type="password" id="new-password" required placeholder="Güçlü bir şifre girin">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Ad Soyad</label>
              <input type="text" id="new-fullname" placeholder="Ad Soyad">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="new-email" placeholder="email@example.com">
            </div>
          </div>
          <div class="form-group">
            <label class="required">Rol</label>
            <select id="new-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Kullanıcı Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    document.getElementById('add-user-form')?.addEventListener('submit', addUser);
}

async function addUser(e) {
    e.preventDefault();
    const userData = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    const r = await apiFetch('/api/admin/users', { method:'POST', body: JSON.stringify(userData) });
    if (r.ok) { closeModal(); loadUsers(); showToast('Kullanıcı eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Devices
async function loadDevices() {
    console.log('loadDevices çağrıldı');
    try {
        const r = await apiFetch('/api/admin/devices');
        console.log('API response status:', r.status);
        if (!r.ok) {
            console.error('API error:', r.status, r.statusText);
            showToast('Cihazlar yüklenemedi','error');
            return;
        }
        const devices = await r.json();
        console.log('Devices loaded:', devices);
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) {
            console.error('devices-table tbody bulunamadı');
            return;
        }
        tbody.innerHTML = '';
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${device.device_id}</td>
                <td>${device.device_name}</td>
                <td>${device.ip_address || '-'}</td>
                <td><span class="badge badge-${device.is_online ? 'success' : 'danger'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : 'Hiç'}</td>
                <td>${device.owner_name || '-'}</td>
                <td>
                    <button class="btn-secondary" onclick="editDevice('${device.device_id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteDevice('${device.device_id}')">Sil</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        console.log('Devices table updated');
    } catch (error) {
        console.error('loadDevices error:', error);
        showToast('Cihazlar yüklenirken hata oluştu','error');
    }
}

async function editDevice(deviceId) {
    const r = await apiFetch(`/api/admin/devices/${deviceId}`);
    if (!r.ok) { showToast('Cihaz bilgileri alınamadı','error'); return; }
    const device = await r.json();
    showModal('Cihaz Düzenle', `
      <form id="edit-device-form">
        <div class="form-group"><label>Cihaz ID</label><input type="text" id="edit-device-id" value="${device.device_id}" readonly></div>
        <div class="form-group"><label>Cihaz Adı</label><input type="text" id="edit-device-name" value="${device.device_name}" required></div>
        <div class="form-group"><label>IP Adresi</label><input type="text" id="edit-ip-address" value="${device.ip_address || ''}"></div>
        <div class="form-group"><label>MAC Adresi</label><input type="text" id="edit-mac-address" value="${device.mac_address || ''}"></div>
        <div class="form-group"><label>Konum</label><input type="text" id="edit-location" value="${device.location || ''}"></div>
        <div class="form-group"><label>Açıklama</label><textarea id="edit-description">${device.description || ''}</textarea></div>
        <div class="form-group"><label>Sahibi</label><select id="edit-owner" disabled><option value="">Sahipsiz</option></select><small style="display:block;opacity:.8;margin-top:.25rem;">Sahip atama işlemi kullanıcı düzenleme modalına taşındı.</small></div>
        <div class="form-group"><button type="submit" class="btn-primary">Güncelle</button></div>
      </form>
    `);
    await loadUserOptions(device.owner_name || '');
    document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
}

async function loadUserOptions(selectedUsername = '') {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Sahipsiz</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.full_name || u.name || u.username;
            sel.appendChild(opt);
        });
        if (selectedUsername) sel.value = selectedUsername;
    };
    fill(document.getElementById('edit-owner'));
    fill(document.getElementById('new-owner'));
}

async function updateDevice(deviceId) {
    const payload = {
        device_name: document.getElementById('edit-device-name').value,
        ip_address: document.getElementById('edit-ip-address').value,
        mac_address: document.getElementById('edit-mac-address').value,
        location: document.getElementById('edit-location').value,
        description: document.getElementById('edit-description').value,
        owner: document.getElementById('edit-owner').value
    };
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz güncellendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

function showAddDeviceModal() {
    showModal('Yeni Cihaz Ekle', `
      <form id="add-device-form">
        <div class="form-section">
          <h3>Cihaz Bilgileri</h3>
          <div class="form-group"><label class="required">Cihaz ID</label><input type="text" id="new-device-id" required placeholder="esp32_001"></div>
          <div class="form-group"><label class="required">Cihaz Adı</label><input type="text" id="new-device-name" required placeholder="Oturma Odası ESP32"></div>
          <div class="form-row">
            <div class="form-group"><label>IP Adresi</label><input type="text" id="new-ip-address" placeholder="192.168.1.100"></div>
            <div class="form-group"><label>MAC Adresi</label><input type="text" id="new-mac-address" placeholder="AA:BB:CC:DD:EE:FF"></div>
          </div>
          <div class="form-group"><label>Konum</label><input type="text" id="new-location" placeholder="Oturma Odası"></div>
          <div class="form-group"><label>Açıklama</label><textarea id="new-description" placeholder="Cihaz hakkında açıklama..."></textarea></div>
          <div class="form-group"><label>Sahibi</label><select id="new-owner"><option value="">Sahipsiz</option></select></div>
          <div class="form-check"><input type="checkbox" id="new-device-active" checked><label for="new-device-active">Cihaz aktif</label></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Cihaz Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    loadUserOptions();
    document.getElementById('add-device-form')?.addEventListener('submit', addDevice);
}

async function addDevice(e) {
    e.preventDefault();
    const deviceData = {
        device_id: document.getElementById('new-device-id').value,
        device_name: document.getElementById('new-device-name').value,
        ip_address: document.getElementById('new-ip-address').value,
        mac_address: document.getElementById('new-mac-address').value,
        location: document.getElementById('new-location').value,
        description: document.getElementById('new-description').value,
        owner: document.getElementById('new-owner').value
    };
    const r = await apiFetch('/api/admin/devices', { method:'POST', body: JSON.stringify(deviceData) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

async function deleteDevice(deviceId) {
    if (!confirm('Bu cihazı silmek istediğinizden emin misiniz?')) return;
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'DELETE' });
    if (r.ok) { loadDevices(); showToast('Cihaz silindi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Settings, Logs, Analytics, Security basitleştirilmiş placeholder
async function loadSettings() {}
async function loadLogs() {}
async function loadAnalytics() {}
async function loadSecurityData() {}
async function loadBackups() {}

function startAutoRefresh() {}

// Minimal modal/notification helpers (projede zaten varsa kullanılacak)
function showModal(title, content){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function showNotification(msg,type='info'){ console.log(`[${type}]`, msg); showToast(msg,type); }
// Toast helper (admin)
function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.color='#fff';
  el.style.fontSize='14px';
  el.style.boxShadow='0 2px 8px rgba(0,0,0,0.25)';
  el.style.background = type==='error'?'#d9534f':(type==='success'?'#28a745':'#444');
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity 300ms'; }, 2500);
  setTimeout(()=>{ el.remove(); }, 2900);
}

// Layout manager minimal
async function initLayoutManager() {
  try {
    const usersResp = await apiFetch('/api/admin/users');
    const users = await usersResp.json();
    const userSelect = document.getElementById('layout-user-select');
    if (!userSelect) return;
    userSelect.innerHTML = '';
    users.forEach(u => { const opt = document.createElement('option'); opt.value = u.id; opt.textContent = `${u.username} (${u.role})`; userSelect.appendChild(opt); });
    userSelect.addEventListener('change', () => loadUserLayoutForAdmin(parseInt(userSelect.value)));
    if (users.length) loadUserLayoutForAdmin(users[0].id);
    document.getElementById('layout-move-up')?.addEventListener('click', () => moveSelectedLayoutItem(-1));
    document.getElementById('layout-move-down')?.addEventListener('click', () => moveSelectedLayoutItem(1));
    document.getElementById('layout-order')?.addEventListener('click', (e) => {
      if (e.target?.tagName === 'LI') { document.querySelectorAll('#layout-order li').forEach(li => li.classList.remove('active')); e.target.classList.add('active'); }
    });
    document.getElementById('layout-save-btn')?.addEventListener('click', async () => {
      const targetUserId = parseInt(userSelect.value);
      const layout = collectLayoutFromForm();
      const resp = await apiFetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', body: JSON.stringify({ layout }) });
      if (resp.ok) {
        showToast('Layout kaydedildi','success');
      } else {
        const er = await resp.json().catch(() => ({}));
        showToast(er.error || 'Layout kaydedilemedi','error');
      }
    });
  } catch (e) { console.error('Layout manager init error:', e); }
}
function moveSelectedLayoutItem(direction) {
  const list = document.getElementById('layout-order');
  const active = list?.querySelector('li.active');
  if (!list || !active) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(active);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  if (direction < 0) list.insertBefore(active, items[targetIdx]); else list.insertBefore(items[targetIdx], active);
}
function collectLayoutFromForm() {
  const orderEls = document.querySelectorAll('#layout-order li');
  const sections = Array.from(orderEls).map(li => li.dataset.id);
  const hidden = [];
  if (!document.getElementById('layout-relay')?.checked) hidden.push('relay_parent');
  if (!document.getElementById('layout-wol')?.checked) hidden.push('wol_parent');
  if (!document.getElementById('layout-log')?.checked) hidden.push('log_parent');
  return { sections, hidden };
}
async function loadUserLayoutForAdmin(userId) {
  const resp = await apiFetch('/api/admin/user-layouts');
  const rows = await resp.json();
  const row = rows.find(r => r.user_id === userId);
  const layout = row?.layout_json ? JSON.parse(row.layout_json) : { sections:['relay_parent','wol_parent','log_parent'], hidden:[] };
  document.getElementById('layout-relay').checked = !layout.hidden.includes('relay_parent');
  document.getElementById('layout-wol').checked = !layout.hidden.includes('wol_parent');
  document.getElementById('layout-log').checked = !layout.hidden.includes('log_parent');
  const list = document.getElementById('layout-order');
  if (list) {
    list.innerHTML = '';
    layout.sections.forEach(id => { const li = document.createElement('li'); li.dataset.id = id; li.className='menu-item'; li.style.padding='0.5rem 1rem'; li.style.borderBottom='1px solid #3b3b3b'; li.style.cursor='grab'; li.textContent = id; list.appendChild(li); });
    if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';
  }
}

function setupWebSocket() {
    const wsUrl = `wss://fatihdev.xyz:5131/`;
    adminWS = new WebSocket(wsUrl);
    
    adminWS.onopen = () => {
        console.log('Admin WebSocket bağlandı');
        // Admin olarak auth gönder
        adminWS.send(JSON.stringify({
            type: 'userAuth',
            userId: 'admin',
            role: 'admin'
        }));
    };
    
    adminWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'deviceUpdated') {
                console.log('Cihaz güncellendi:', data.deviceId, data.action);
                // Cihaz yönetimi sekmesi aktifse listeyi yenile
                const devicesTab = document.getElementById('devices');
                if (devicesTab && devicesTab.classList.contains('active')) {
                    loadDevices();
                }
            }
        } catch (e) {
            // JSON olmayan mesajları görmezden gel
        }
    };
    
    adminWS.onclose = () => {
        console.log('Admin WebSocket bağlantısı kapandı');
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => {
            setupWebSocket();
        }, 5000);
    };
    
    adminWS.onerror = (error) => {
        console.error('Admin WebSocket hatası:', error);
    };
}

// ==================== PORT YÖNETİMİ ====================

// Port yönetimi başlat
function initPortManager() {
    loadPorts();
    loadPortUsers();
    setupPortEventListeners();
}

// Port listesini yükle
async function loadPorts() {
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        if (data.error) {
            console.error('Port listesi yüklenemedi:', data.error);
            return;
        }
        
        renderUsedPorts(data.usedPorts);
        renderAvailablePorts(data.availablePorts);
    } catch (error) {
        console.error('Port listesi yüklenemedi:', error);
    }
}

// Kullanılan portları render et
function renderUsedPorts(usedPorts) {
    const container = document.getElementById('used-ports-list');
    container.innerHTML = '';
    
    if (usedPorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılan port yok</span></div></div>';
        return;
    }
    
    usedPorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item used';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port.port}</span>
                <span class="port-user">${port.username}</span>
            </div>
            <div class="port-actions">
                <button class="btn-release" onclick="releaseUserPort(${port.userId})">Serbest Bırak</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Kullanılabilir portları render et
function renderAvailablePorts(availablePorts) {
    const container = document.getElementById('available-ports-list');
    container.innerHTML = '';
    
    if (availablePorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılabilir port yok</span></div></div>';
        return;
    }
    
    availablePorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item available';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port}</span>
                <span class="port-user">Kullanılabilir</span>
            </div>
            <div class="port-actions">
                <button class="btn-assign" onclick="assignPortToUser(${port})">Ata</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Port kullanıcılarını yükle
async function loadPortUsers() {
    try {
        const response = await apiFetch('/api/admin/users');
        const users = await response.json();
        
        const select = document.getElementById('port-user-select');
        select.innerHTML = '<option value="">Kullanıcı seçin...</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (${user.name || 'İsimsiz'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Kullanıcı listesi yüklenemedi:', error);
    }
}

// Port event listener'ları
function setupPortEventListeners() {
    // Port ata butonu
    document.getElementById('assign-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        const port = document.getElementById('port-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch('/api/admin/ports/assign', {
                method: 'POST',
                body: JSON.stringify({ userId, port: port || null })
            });
            
            const data = await response.json();
            if (data.success) {
                alert(`Port ${data.port} başarıyla atandı`);
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port atanamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port atama hatası:', error);
            alert('Port atanamadı');
        }
    });
    
    // Port serbest bırak butonu
    document.getElementById('release-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch(`/api/admin/ports/${userId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Port başarıyla serbest bırakıldı');
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port serbest bırakılamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port serbest bırakma hatası:', error);
            alert('Port serbest bırakılamadı');
        }
    });
    
    // Yenile butonu
    document.getElementById('refresh-ports').addEventListener('click', () => {
        loadPorts();
        loadPortUsers();
    });
    
    // Kullanıcı seçimi değiştiğinde port seçeneklerini güncelle
    document.getElementById('port-user-select').addEventListener('change', (e) => {
        updatePortSelectOptions(e.target.value);
    });
}

// Port seçeneklerini güncelle
async function updatePortSelectOptions(userId) {
    const portSelect = document.getElementById('port-select');
    portSelect.innerHTML = '<option value="">Port seçin...</option>';
    
    if (!userId) return;
    
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        data.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = `Port ${port}`;
            portSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Port seçenekleri yüklenemedi:', error);
    }
}

// Kullanıcı portunu serbest bırak
async function releaseUserPort(userId) {
    if (!confirm('Bu kullanıcının portunu serbest bırakmak istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/ports/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Port başarıyla serbest bırakıldı');
            loadPorts();
        } else {
            alert('Port serbest bırakılamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port serbest bırakma hatası:', error);
        alert('Port serbest bırakılamadı');
    }
}

// Portu kullanıcıya ata
async function assignPortToUser(port) {
    const userId = document.getElementById('port-user-select').value;
    
    if (!userId) {
        alert('Lütfen kullanıcı seçin');
        return;
    }
    
    try {
        const response = await apiFetch('/api/admin/ports/assign', {
            method: 'POST',
            body: JSON.stringify({ userId, port })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(`Port ${port} başarıyla atandı`);
            loadPorts();
        } else {
            alert('Port atanamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port atama hatası:', error);
        alert('Port atanamadı');
    }
}


// ==================== AUTH / USER ACTIONS ====================
async function logout() {
    try {
        const r = await apiFetch('/api/logout', { method: 'POST' });
        // Başarılı/başarısız fark etmeksizin login'e yönlendir
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function deleteUser(userId) {
    try {
        if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('Kullanıcı silindi', 'success');
            loadUsers();
        } else {
            const er = await r.json().catch(() => ({}));
            showToast(er.error || 'Kullanıcı silinemedi', 'error');
        }
    } catch (e) {
        console.error('deleteUser error:', e);
        showToast('Kullanıcı silinemedi', 'error');
    }
}

// ==================== DEVICE CONFIG MANAGEMENT ====================

let selectedDeviceId = null;
let deviceConfigs = {};

// Device config sekmesi yüklendiğinde
function initDeviceConfigs() {
    console.log('🔧 initDeviceConfigs çağrıldı');
    loadDevicesForConfig();
    setupDeviceConfigEventListeners();
}

// Cihaz seçici için cihazları yükle
async function loadDevicesForConfig() {
    try {
        const response = await apiFetch('/api/admin/devices');
        const devices = await response.json();
        
        const deviceSelector = document.getElementById('device-selector');
        deviceSelector.innerHTML = '<option value="">Cihaz Seçin</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = `${device.device_name} (${device.device_id})`;
            deviceSelector.appendChild(option);
        });
        
        // Cihaz seçimi değiştiğinde
        deviceSelector.addEventListener('change', function() {
            selectedDeviceId = this.value;
            if (selectedDeviceId) {
                loadDeviceStatus();
                loadWolProfiles();
                loadConfigHistory();
            } else {
                clearDeviceConfigUI();
            }
        });
        
    } catch (error) {
        console.error('Cihazlar yüklenemedi:', error);
        showToast('Cihazlar yüklenemedi', 'error');
    }
}

// Event listeners kurulumu
function setupDeviceConfigEventListeners() {
    // DHCP checkbox değiştiğinde
    document.getElementById('use-dhcp').addEventListener('change', function() {
        const staticIpGroup = document.getElementById('static-ip-group');
        staticIpGroup.style.display = this.checked ? 'none' : 'block';
    });
}

// Cihaz durumunu yükle
async function loadDeviceStatus() {
    console.log('🔧 loadDeviceStatus çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) return;
    
    try {
        console.log('🔧 API çağrısı yapılıyor:', `/api/devices/${selectedDeviceId}/status`);
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/status`);
        const data = await response.json();
        console.log('🔧 API yanıtı:', data);
        
        if (data.success) {
            const device = data.device;
            console.log('🔧 Cihaz bilgileri:', device);
            
            // Durum güncelle
            const statusElement = document.getElementById('device-online-status');
            console.log('🔧 Status element:', statusElement);
            if (statusElement) {
                statusElement.textContent = device.is_online ? 'Online' : 'Offline';
                statusElement.className = `status-value ${device.is_online ? 'online' : 'offline'}`;
                console.log('🔧 Status güncellendi:', device.is_online ? 'Online' : 'Offline');
            }
            
            // Diğer bilgiler
            const lastSeenElement = document.getElementById('device-last-seen');
            const firmwareElement = document.getElementById('device-firmware');
            const queueCountElement = document.getElementById('device-queue-count');
            
            if (lastSeenElement) {
                lastSeenElement.textContent = device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : '-';
            }
            if (firmwareElement) {
                firmwareElement.textContent = device.firmware || '-';
            }
            if (queueCountElement) {
                queueCountElement.textContent = device.queue_count || '0';
            }
            
        } else {
            console.error('❌ API başarısız:', data);
            showToast('Cihaz durumu alınamadı', 'error');
        }
    } catch (error) {
        console.error('❌ Cihaz durumu yüklenemedi:', error);
        showToast('Cihaz durumu yüklenemedi', 'error');
    }
}

// WiFi konfigürasyonu gönder
async function sendWifiConfig() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    const useDhcp = document.getElementById('use-dhcp').checked;
    const staticIp = document.getElementById('static-ip').value;
    
    if (!ssid || !password) {
        showToast('SSID ve şifre gerekli', 'warning');
        return;
    }
    
    const config = {
        wifi_ssid: ssid,
        wifi_pass: password,
        use_dhcp: useDhcp,
        static_ip: useDhcp ? null : staticIp
    };
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.sent ? 'success' : 'info');
            loadConfigHistory(); // Geçmişi yenile
        } else {
            showToast('Konfigürasyon gönderilemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WiFi config gönderme hatası:', error);
        showToast('Konfigürasyon gönderilemedi', 'error');
    }
}

// WOL profillerini yükle
async function loadWolProfiles() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        
        if (data.success) {
            const profilesList = document.getElementById('wol-profiles-list');
            profilesList.innerHTML = '';
            
            data.profiles.forEach(profile => {
                const profileItem = document.createElement('div');
                profileItem.className = 'wol-profile-item';
                profileItem.innerHTML = `
                    <div class="wol-profile-info">
                        <div class="wol-profile-name">${profile.name}</div>
                        <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
                    </div>
                    <div class="wol-profile-actions">
                        <button class="btn-small" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteWolProfile(${profile.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                profilesList.appendChild(profileItem);
            });
        }
    } catch (error) {
        console.error('WOL profilleri yüklenemedi:', error);
    }
}

// WOL profili ekleme modalını göster
function showAddWolProfileModal() {
    console.log('🔧 showAddWolProfileModal çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const modal = document.getElementById('add-wol-profile-modal');
    console.log('🔧 Modal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        console.log('🔧 Modal gösterildi');
    } else {
        console.error('❌ Modal bulunamadı!');
    }
}

// WOL profili ekleme modalını kapat
function closeAddWolProfileModal() {
    const modal = document.getElementById('add-wol-profile-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-wol-profile-form');
    if (form) {
        form.reset();
    }
}

// WOL profili ekle
async function addWolProfile() {
    const name = document.getElementById('wol-profile-name').value;
    const mac = document.getElementById('wol-profile-mac').value;
    const broadcast = document.getElementById('wol-profile-broadcast').value;
    const port = document.getElementById('wol-profile-port').value;
    
    if (!name || !mac || !broadcast) {
        showToast('Tüm alanlar gerekli', 'warning');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`, {
            method: 'POST',
            body: JSON.stringify({ name, mac, broadcast_ip: broadcast, port: parseInt(port) })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili eklendi', 'success');
            closeAddWolProfileModal();
            loadWolProfiles();
        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
        } else {
            showToast('WOL profili eklenemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili ekleme hatası:', error);
        showToast('WOL profili eklenemedi', 'error');
    }
}

// WOL profillerini cihaza senkronize et
async function syncWolProfilesToDevice() {
    if (!selectedDeviceId) return;
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        if (!data.success) {
            showToast('WOL profilleri alınamadı', 'error');
            return;
        }
        const profiles = data.profiles.map(p => ({
            name: p.name,
            mac: p.mac,
            broadcast_ip: p.broadcast_ip,
            port: p.port || 9,
            ip: p.ip_address || '0.0.0.0'
        }));

        const payload = {
            wol_profiles: profiles
        };

        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config: payload })
        });
        const resj = await resp.json();
        if (resp.ok && resj.success) {
            showToast('WOL profilleri cihaza gönderildi', 'success');
        } else {
            showToast('WOL profilleri gönderilemedi', 'error');
        }
    } catch (e) {
        console.error('syncWolProfilesToDevice error:', e);
        showToast('Senkronizasyon hatası', 'error');
    }
}

// WOL profili sil
async function deleteWolProfile(profileId) {
    if (!confirm('Bu WOL profilini silmek istediğinizden emin misiniz?')) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili silindi', 'success');
            loadWolProfiles();
        } else {
            showToast('WOL profili silinemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili silme hatası:', error);
        showToast('WOL profili silinemedi', 'error');
    }
}

// Konfigürasyon geçmişini yükle
async function loadConfigHistory() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/history?limit=20`);
        const data = await response.json();
        
        if (data.success) {
            const historyContainer = document.getElementById('config-history');
            historyContainer.innerHTML = '';
            
            data.history.forEach(entry => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <div class="history-action ${entry.action}">${getActionText(entry.action)}</div>
                        <div class="history-details">${entry.username || 'Sistem'} - ${entry.error_message || 'Başarılı'}</div>
                    </div>
                    <div class="history-timestamp">${new Date(entry.created_at).toLocaleString('tr-TR')}</div>
                `;
                historyContainer.appendChild(historyItem);
            });
        }
    } catch (error) {
        console.error('Konfigürasyon geçmişi yüklenemedi:', error);
    }
}

// Action text'i döndür
function getActionText(action) {
    const actions = {
        'sent': 'Gönderildi',
        'applied': 'Uygulandı',
        'failed': 'Başarısız',
        'queued': 'Kuyruğa Eklendi'
    };
    return actions[action] || action;
}

// Cihaz durumunu yenile
async function refreshDeviceStatus() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    await loadDeviceStatus();
    showToast('Durum yenilendi', 'success');
}

// Device config UI'sını temizle
function clearDeviceConfigUI() {
    document.getElementById('device-online-status').textContent = 'Offline';
    document.getElementById('device-online-status').className = 'status-value offline';
    document.getElementById('device-last-seen').textContent = '-';
    document.getElementById('device-firmware').textContent = '-';
    document.getElementById('device-queue-count').textContent = '0';
    document.getElementById('wol-profiles-list').innerHTML = '';
    document.getElementById('config-history').innerHTML = '';
    document.getElementById('wifi-config-form').reset();
}

// ==================== USER-DEVICE ASSIGNMENT ====================
async function populateDeviceAssignment(user){
  try {
    const r = await apiFetch('/api/admin/devices');
    if (!r.ok) return;
    const devices = await r.json();
    const select = document.getElementById('assign-device-select');
    if (select) {
      select.innerHTML = '<option value="">Cihaz seçin...</option>';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = `${d.device_name} (${d.device_id})`;
        select.appendChild(opt);
      });
    }

    const assignedWrap = document.getElementById('assigned-devices');
    if (assignedWrap) {
      assignedWrap.innerHTML = '';
      const owned = devices.filter(d => String(d.owner_name||'').toLowerCase() === String(user.username).toLowerCase() || String(d.owner_id||'') === String(user.id));
      if (!owned.length) {
        assignedWrap.innerHTML = '<div style="opacity:.75;">Bu kullanıcıya atanmış cihaz yok</div>';
      } else {
        owned.forEach(d => {
          const chip = document.createElement('div');
          chip.style.display='inline-flex';
          chip.style.alignItems='center';
          chip.style.gap='.5rem';
          chip.style.padding='.25rem .5rem';
          chip.style.border='1px solid #3b3b3b';
          chip.style.borderRadius='12px';
          chip.style.marginRight='.5rem';
          chip.style.marginBottom='.5rem';
          chip.innerHTML = `<span>${d.device_name} (${d.device_id})</span><button type="button" class="btn-small" data-unassign="${d.device_id}">Kaldır</button>`;
          assignedWrap.appendChild(chip);
        });
        assignedWrap.querySelectorAll('[data-unassign]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const deviceId = e.currentTarget.getAttribute('data-unassign');
            await assignDeviceToUser(deviceId, null);
            await populateDeviceAssignment(user);
            showToast('Cihaz kullanıcıdan kaldırıldı','success');
          });
        });
      }
    }

    const assignBtn = document.getElementById('assign-device-btn');
    assignBtn?.addEventListener('click', async () => {
      const deviceId = select?.value;
      if (!deviceId) { showToast('Önce bir cihaz seçin','error'); return; }
      await assignDeviceToUser(deviceId, user.username);
      showToast('Cihaz kullanıcıya atandı','success');
      await populateDeviceAssignment(user);
    });
  } catch (e) { console.error('populateDeviceAssignment error:', e); }
}

async function assignDeviceToUser(deviceId, username){
  const payload = { owner: username || '' };
  const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
  return r.ok;
}


```

Cihazdaki config mesajını ArduinoJson ile parse edip `wol_profiles` dizisini doğrudan alacak şekilde güncelliyorum; dizi ise serialize edip NVS’e kaydediyoruz, string ise aynen işliyoruz. Ardından TODO’yu kapatacağım.

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
// Cihaz konfigürasyonunu seçin (SelectedDevice.h üzerinden tek noktadan yönetilir)
#include "../device_configs/SelectedDevice.h"
#include "DeviceConfig.h"
#include <ESP32Ping.h> // Ping için gerekli
#include "wifi_setup.h" // WiFi setup GUI

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

WiFiUDP udp;
WebSocketsClient webSocket;

// Komut debouncing ve relay cooldown kontrolü
static String lastRelayCmd = "";
static unsigned long lastRelayCmdTime = 0;
static unsigned long relayCooldownUntil[RELAY_COUNT] = {0};

// ----------------- WOL -----------------
void sendWOL(const WOLDevice &dev) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], dev.mac, 6);

  udp.beginPacket(dev.broadcast, dev.port > 0 ? dev.port : 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
}

// ----------------- WOL Persist -----------------
Preferences wolPrefs;

static bool parseMac(const String &macStr, byte out[6]) {
  int values[6];
  if (sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x", &values[0], &values[1], &values[2], &values[3], &values[4], &values[5]) != 6) return false;
  for (int i = 0; i < 6; i++) out[i] = (byte)values[i];
  return true;
}

void loadWOLProfilesFromPrefs() {
  if (!wolPrefs.begin("wolconfig", true)) return;
  String json = wolPrefs.getString("profiles", "");
  wolPrefs.end();
  if (json.length() == 0) return;

  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) return;
  if (!doc.is<JsonArray>()) return;

  JsonArray arr = doc.as<JsonArray>();
  int count = 0;
  for (JsonObject p : arr) {
    if (count >= MAX_WOL_DEVICES) break;
    const char* name = p["name"] | "WOL";
    const char* mac = p["mac"] | "";
    const char* bcast = p["broadcast_ip"] | "";
    uint16_t port = p["port"] | 9;
    const char* ipStr = p["ip"] | "0.0.0.0";

    wolDevices[count].name = name;
    byte macb[6];
    if (parseMac(String(mac), macb)) memcpy(wolDevices[count].mac, macb, 6);
    IPAddress ip; ip.fromString(String(ipStr)); wolDevices[count].ip = ip;
    IPAddress bc; if (!String(bcast).length()) { bc.fromString(String(WOL_BROADCAST_IP)); } else { bc.fromString(String(bcast)); }
    wolDevices[count].broadcast = bc;
    wolDevices[count].port = port;
    wolDevices[count].status = WOLDevice::OFFLINE;
    wolDevices[count].bootStartTime = 0;
    count++;
  }
  wolDeviceCount = count;
}

bool saveWOLProfilesToPrefs(const String &json) {
  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc.is<JsonArray>()) return false;
  if (!wolPrefs.begin("wolconfig", false)) return false;
  wolPrefs.putString("profiles", json);
  wolPrefs.end();
  return true;
}

bool updateWOLProfilesFromJson(const String &json) {
  if (!saveWOLProfilesToPrefs(json)) return false;
  loadWOLProfilesFromPrefs();
  return true;
}

// ----------------- Yardımcı: Mesaj ID kontrolü -----------------
// Mesaj içinde " id:<DEVICE_ID>" varsa ve bizim cihaz ID'miz ile eşleşmiyorsa true döner (yani bu cihaza ait değil)
bool hasIdButNotForThisDevice(const String &msg) {
  int idPos = msg.indexOf(" id:");
  if (idPos == -1) return false; // ID belirtilmemiş, geriye dönük uyumluluk: kabul et
  int start = idPos + 4; // " id:" sonrası
  int end = msg.indexOf(' ', start);
  if (end == -1) end = msg.length();
  String targetId = msg.substring(start, end);
  targetId.trim();
  return targetId.length() > 0 && targetId != String(DEVICE_ID);
}

// ----------------- Cihaz yeteneklerini gönder -----------------
void sendCapabilities() {
  // JSON: { type:"capabilities", deviceId, relayCount, wol:[{index,name},...] }
  String json = "{";
  json += "\"type\":\"capabilities\",";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"relayCount\":" + String(RELAY_COUNT) + ",";
  json += "\"wol\":[";
  for (int i = 0; i < wolDeviceCount; i++) {
    json += "{\"index\":" + String(i) + ",\"name\":\"" + String(wolDevices[i].name) + "\"}";
    if (i < wolDeviceCount - 1) json += ",";
  }
  json += "]";
  json += "}";
  webSocket.sendTXT(json);
  Serial.println("Capabilities gönderildi: " + json);
}

// ----------------- Status gönder -----------------
void sendStatus(WOLDevice &dev) {
  String statusStr;
  switch(dev.status) {
    case WOLDevice::OFFLINE: statusStr = "OFFLINE"; break;
    case WOLDevice::BOOTING: statusStr = "BOOTING"; break;
    case WOLDevice::RUNNING: statusStr = "RUNNING"; break;
    case WOLDevice::FAILED:  statusStr = "FAILED"; break;
  }
  webSocket.sendTXT("status:" + String(dev.name) + ":" + statusStr);
}

// ----------------- Tüm status gönder -----------------
void sendAllStatuses() {
  for (int i = 0; i < wolDeviceCount; i++) {
    sendStatus(wolDevices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state + " id:" + String(DEVICE_ID));
    Serial.println("relay:" + String(i) + ":" + state);
  }
}

// ----------------- Röle kontrol (WebSocket ile) -----------------
void setRelayWithWebSocket(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  // Durum zaten istenen ile aynıysa tekrar işlem yapma
  if (deviceStatus.relays[index].state == state) {
    return;
  }
  
  // Hızlı tekrarlara karşı per-relay cooldown (200 ms)
  unsigned long nowMs = millis();
  if (relayCooldownUntil[index] > nowMs) {
    return;
  }
  relayCooldownUntil[index] = nowMs + 200;

  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr + " id:" + String(DEVICE_ID));
  
  Serial.println("Röle " + String(index) + " " + (state ? "AÇILDI" : "KAPANDI"));
  Serial.println("relay:" + String(index) + ":" + stateStr);
  ledFlash();
}

void toggleRelayWithWebSocket(int index) {
  if (index < 0 || index >= RELAY_COUNT) return;
  setRelayWithWebSocket(index, !deviceStatus.relays[index].state);
}

// ----------------- Ping kontrolü -----------------
void checkDevices() {
  static unsigned long lastFastPing = 0;
  static unsigned long lastSlowPing = 0;
  static unsigned long lastOfflinePing = 0;

  unsigned long now = millis();

  // 1️⃣ BOOTING cihazlar: hızlı ping (500 ms)
  if (now - lastFastPing >= 500) {
    lastFastPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::BOOTING) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }

  // 2️⃣ RUNNING cihazlar: hafif ping (5 s)
  if (now - lastSlowPing >= 5000) {
    lastSlowPing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::RUNNING) {
        if (!Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
      }
    }
  }

  // 3️⃣ OFFLINE cihazlar: arada ping (5 dk)
  if (now - lastOfflinePing >= 300000) {
    lastOfflinePing = now;
    for (int i = 0; i < wolDeviceCount; i++) {
      WOLDevice &dev = wolDevices[i];
      if (dev.status == WOLDevice::OFFLINE) {
        if (Ping.ping(dev.ip, 1)) {
          dev.status = WOLDevice::RUNNING;
          sendStatus(dev);
        }
      }
    }
  }
}

// ----------------- JSON değer alma (basit) -----------------
String getValue(String data, String key) {
  int start = data.indexOf("\"" + key + "\":");
  if (start == -1) return "";
  start += key.length() + 3;
  int end = data.indexOf(",", start);
  if (end == -1) end = data.indexOf("}", start);
  return data.substring(start, end);
}

// ----------------- Device Token Management -----------------
String deviceToken = "";
String pairingToken = "";
bool isPaired = false;

// Token kaydetme (EEPROM veya NVS)
void saveToken(String token) {
  // Token'daki çift tırnakları temizle
  deviceToken = token;
  deviceToken.replace("\"", "");
  // TODO: EEPROM veya NVS'ye kaydet
  Serial.println("Token kaydedildi: " + deviceToken.substring(0, 8) + "...");
}

// Token yükleme (EEPROM veya NVS'den)
String loadToken() {
  // TODO: EEPROM veya NVS'den yükle
  return deviceToken;
}

// ----------------- Config Handling -----------------
struct DeviceConfig {
  String wifi_ssid = "";
  String wifi_pass = "";
  bool use_dhcp = true;
  String static_ip = "";
  String wol_profiles = "[]"; // JSON string
};

DeviceConfig currentConfig;

// Config'i uygula
void applyConfig(const DeviceConfig& config) {
  Serial.println("=== Konfigürasyon Uygulanıyor ===");
  
  // WiFi ayarlarını güncelle
  if (config.wifi_ssid.length() > 0 && config.wifi_pass.length() > 0) {
    Serial.println("WiFi ayarları güncelleniyor...");
    // TODO: WiFi ayarlarını güncelle ve yeniden bağlan
    // WiFi.begin(config.wifi_ssid.c_str(), config.wifi_pass.c_str());
  }
  
  // IP ayarlarını güncelle
  if (!config.use_dhcp && config.static_ip.length() > 0) {
    Serial.println("Statik IP ayarlanıyor: " + config.static_ip);
    // TODO: Statik IP ayarla
  }
  
  // WOL profillerini güncelle
  if (config.wol_profiles.length() > 0) {
    Serial.println("WOL profilleri güncelleniyor...");
    // TODO: WOL profillerini parse et ve güncelle
  }
  
  currentConfig = config;
  Serial.println("Konfigürasyon uygulandı");
}

// Config ACK mesajı gönder
void sendConfigAck(String requestId, bool success, String errorMsg = "") {
  String ackMsg = "{";
  ackMsg += "\"type\":\"config_applied\",";
  ackMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  ackMsg += "\"request_id\":\"" + requestId + "\",";
  ackMsg += "\"status\":\"" + String(success ? "ok" : "error") + "\",";
  ackMsg += "\"details\":{";
  ackMsg += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  ackMsg += "\"mac\":\"" + WiFi.macAddress() + "\"";
  ackMsg += "},";
  ackMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  if (!success && errorMsg.length() > 0) {
    ackMsg += ",\"error\":\"" + errorMsg + "\"";
  }
  ackMsg += "}";
  
  webSocket.sendTXT(ackMsg);
  Serial.println("Config ACK gönderildi: " + ackMsg);
}

// Config mesajını işle
void handleConfigMessage(String message) {
  Serial.println("Config mesajı alındı: " + message);

  // Önce ArduinoJson ile sağlam parse dene
  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, message);
  if (!err) {
    String requestId = doc["meta"]["request_id"].as<String>();
    String token = doc["token"].as<String>();

    // Token doğrulama (basit)
    if (token.length() > 0 && token != deviceToken && token != pairingToken) {
      Serial.println("Geçersiz token");
      sendConfigAck(requestId, false, "Geçersiz token");
      return;
    }

    JsonVariant cfg = doc["config"];
    if (cfg.isNull()) {
      Serial.println("Config JSON bulunamadı");
      sendConfigAck(requestId, false, "Config JSON bulunamadı");
      return;
    }

    DeviceConfig newConfig;
    newConfig.wifi_ssid = cfg["wifi_ssid"].as<String>();
    newConfig.wifi_pass = cfg["wifi_pass"].as<String>();
    // use_dhcp true/false olabilir
    if (!cfg["use_dhcp"].isNull()) newConfig.use_dhcp = cfg["use_dhcp"].as<bool>();
    newConfig.static_ip = cfg["static_ip"].isNull() ? String("") : cfg["static_ip"].as<String>();

    // wol_profiles dizi ya da string olabilir
    if (!cfg["wol_profiles"].isNull()) {
      if (cfg["wol_profiles"].is<JsonArray>()) {
        String arrStr;
        serializeJson(cfg["wol_profiles"], arrStr);
        newConfig.wol_profiles = arrStr;
      } else if (cfg["wol_profiles"].is<const char*>()) {
        newConfig.wol_profiles = String(cfg["wol_profiles"].as<const char*>());
      }
    }

    if (newConfig.wol_profiles.length() > 0) {
      if (updateWOLProfilesFromJson(newConfig.wol_profiles)) {
        Serial.println("WOL profilleri güncellendi ve kaydedildi");
      } else {
        Serial.println("WOL profilleri güncellenemedi (parse/persist hatası)");
      }
    }

    applyConfig(newConfig);
    sendConfigAck(requestId, true);
    return;
  }

  // Geriye dönük uyumluluk: basit parser
  String requestId = getValue(message, "request_id");
  String token = getValue(message, "token");

  if (token.length() > 0 && token != deviceToken && token != pairingToken) {
    Serial.println("Geçersiz token");
    sendConfigAck(requestId, false, "Geçersiz token");
    return;
  }

  String configJson = getValue(message, "config");
  if (configJson.length() == 0) {
    Serial.println("Config JSON bulunamadı");
    sendConfigAck(requestId, false, "Config JSON bulunamadı");
    return;
  }

  DeviceConfig newConfig;
  newConfig.wifi_ssid = getValue(configJson, "wifi_ssid");
  newConfig.wifi_pass = getValue(configJson, "wifi_pass");
  newConfig.use_dhcp = getValue(configJson, "use_dhcp") == "true";
  newConfig.static_ip = getValue(configJson, "static_ip");
  newConfig.wol_profiles = getValue(configJson, "wol_profiles");

  if (newConfig.wol_profiles.length() > 0) {
    if (updateWOLProfilesFromJson(newConfig.wol_profiles)) {
      Serial.println("WOL profilleri güncellendi ve kaydedildi");
    } else {
      Serial.println("WOL profilleri güncellenemedi (parse/persist hatası)");
    }
  }

  applyConfig(newConfig);
  sendConfigAck(requestId, true);
}

// Device identify mesajı gönder
void sendDeviceIdentify() {
  // Token'daki çift tırnakları temizle
  String cleanToken = deviceToken;
  cleanToken.replace("\"", "");
  
  String identifyMsg = "{";
  identifyMsg += "\"type\":\"identify\",";
  identifyMsg += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  identifyMsg += "\"firmware\":\"v1.0.0\",";
  identifyMsg += "\"token\":\"" + cleanToken + "\",";
  identifyMsg += "\"capabilities\":[\"wol\",\"wifi-config\"],";
  identifyMsg += "\"timestamp\":\"" + String(millis()) + "\"";
  identifyMsg += "}";
  
  webSocket.sendTXT(identifyMsg);
  Serial.println("Device identify gönderildi: " + identifyMsg);
}

// ----------------- WebSocket olayları -----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED: {
      Serial.println("=== WebSocket Bağlandı ===");
      Serial.println("Server: " + String(WS_SERVER_IP) + ":" + String(WS_SERVER_PORT));
      Serial.println("Cihaz ID: " + String(DEVICE_ID));
      Serial.println("Cihaz Adı: " + String(DEVICE_NAME));
      
      // Yeni JSON heartbeat mesajı gönder
      String heartbeatMsg = createHeartbeatMessage();
      webSocket.sendTXT(heartbeatMsg);
      Serial.println("Heartbeat gönderildi: " + heartbeatMsg);
      ledFlash();
      // Bağlantı sonrası yetenekleri bildir
      sendCapabilities();
      
      // Device identify mesajı gönder
      sendDeviceIdentify();
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

      // Tekrarlayan röle komutlarını filtrele (debounce)
      unsigned long nowMs = millis();
      if (msg.startsWith("relay:")) {
        if (msg == lastRelayCmd && (nowMs - lastRelayCmdTime) < 300) {
          // Aynı komut kısa süre içinde tekrar geldiyse yok say
          break;
        }
        lastRelayCmd = msg;
        lastRelayCmdTime = nowMs;
      }

      // ID hedefleme kontrolü (mesajda id varsa ve bize ait değilse yok say)
      if (hasIdButNotForThisDevice(msg)) {
        break;
      }

      // --- 1️⃣ Relay kontrol ---
      if (msg.startsWith("relay:")) {
        String command = msg.substring(6);

        // 🔹 Tüm röleleri aç/kapat/toggle et
        if (command == "all:on") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, true);
        } 
        else if (command == "all:off") {
          for (int i = 0; i < RELAY_COUNT; i++) setRelayWithWebSocket(i, false);
        } 
        else if (command == "all") {
          for (int i = 0; i < RELAY_COUNT; i++) toggleRelayWithWebSocket(i);
        } 
        else {
          // 🔹 Tekli röle kontrol
          int idx = command.substring(0, 1).toInt();
          String action = "";
          if (command.length() > 2) action = command.substring(2);

          if (command.endsWith(":on")) {
            Serial.println("Röle " + String(idx) + " AÇILIYOR");
            setRelayWithWebSocket(idx, true);
          }
          else if (command.endsWith(":off")) {
            Serial.println("Röle " + String(idx) + " KAPATILIYOR");
            setRelayWithWebSocket(idx, false);
          }
          else {
            Serial.println("Röle " + String(idx) + " TOGGLE");
            toggleRelayWithWebSocket(idx);  // toggle desteği
          }
        }
      }
      // --- 2️⃣ Röle durumlarını isteme ---
      else if (msg.startsWith("getRelayStatus")) { // getRelayStatus [id:xxx]
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < wolDeviceCount) {
          sendWOL(wolDevices[devIndex]);
          wolDevices[devIndex].status = WOLDevice::BOOTING;
          wolDevices[devIndex].bootStartTime = millis();
          sendStatus(wolDevices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg.startsWith("getWolStatus")) { // getWolStatus [id:xxx]
        for (int i = 0; i < wolDeviceCount; i++) {
          WOLDevice &dev = wolDevices[i];
          if (dev.status == WOLDevice::BOOTING) {
            sendStatus(dev);
            continue;
          }

          bool reachable = Ping.ping(dev.ip, 1);
          if (reachable && dev.status != WOLDevice::RUNNING) dev.status = WOLDevice::RUNNING;
          else if (!reachable && dev.status != WOLDevice::BOOTING) dev.status = WOLDevice::OFFLINE;
          sendStatus(dev);
        }
        webSocket.sendTXT("statusCheck:done");
        ledFlash();
      }

      // --- 7️⃣ Yetenekleri isteme ---
      else if (msg.startsWith("getCapabilities")) { // getCapabilities [id:xxx]
        sendCapabilities();
      }

      // --- 5️⃣ Buzzer ---
      else if (msg.startsWith("{\"type\":\"buzzer\"")) {
        int pitch = getValue(msg, "pitch").toInt();
        int duration = getValue(msg, "duration").toInt();
        float volume = getValue(msg, "volume").toFloat();

        if (pitch <= 0) pitch = 2000;
        if (duration <= 0) duration = 300;
        if (volume < 0 || volume > 1) volume = 1.0;

        buzzerPlay(pitch, duration, volume);
        webSocket.sendTXT("buzzer:done");
        ledFlash();
      }

      // --- 6️⃣ LED kontrol ---
      else if (msg == "led:on") {
        ledOn();
        webSocket.sendTXT("led:done");
      }
      else if (msg == "led:off") {
        ledOff();
        webSocket.sendTXT("led:done");
      }

      // --- 7️⃣ Config mesajları ---
      else if (msg.startsWith("{\"type\":\"update_config\"")) {
        handleConfigMessage(msg);
      }
      else if (msg.startsWith("{\"type\":\"pairing_required\"")) {
        // Pairing token alındı
        String token = getValue(msg, "pairing_token");
        if (token.length() > 0) {
          pairingToken = token;
          deviceToken = token; // Pairing token'ı device token olarak kullan
          saveToken(token); // Token'ı kaydet
          Serial.println("Pairing token alındı: " + token.substring(0, 8) + "...");
          // Pairing token ile tekrar identify gönder
          delay(1000);
          sendDeviceIdentify();
        }
      }
      else if (msg.startsWith("{\"type\":\"identify_success\"")) {
        // Cihaz başarıyla tanımlandı
        Serial.println("Cihaz başarıyla tanımlandı");
        isPaired = true;
        
        // Persistent token alındıysa kaydet
        String persistentToken = getValue(msg, "persistent_token");
        if (persistentToken.length() > 0) {
          deviceToken = persistentToken;
          saveToken(persistentToken);
          Serial.println("Persistent token kaydedildi: " + persistentToken.substring(0, 8) + "...");
        } else if (pairingToken.length() > 0) {
          saveToken(pairingToken);
          pairingToken = "";
        }
      }

      break;
    }
  }
}

// ----------------- WiFi bağlantısı -----------------
bool connectToWiFi() {
  int rssiMax = -1000;
  int bestNetworkIndex = -1;

  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String ssidFound = WiFi.SSID(i);
    for (int j = 0; j < networkCount; j++) {
      if (ssidFound == networks[j].ssid) {
        int rssi = WiFi.RSSI(i);
        if (rssi > rssiMax) {
          rssiMax = rssi;
          bestNetworkIndex = j;
        }
      }
    }
  }

  if (bestNetworkIndex != -1) {
    Serial.print("Connecting to: ");
    Serial.println(networks[bestNetworkIndex].ssid);
    WiFi.begin(networks[bestNetworkIndex].ssid, networks[bestNetworkIndex].password);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      ledSlowBlink(1, 200);
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected!");
      Serial.println(WiFi.localIP());
      ledOn();
      return true;
    }
  }

  Serial.println("No known WiFi found.");
  return false;
}

// ----------------- SETUP -----------------
void setup() {
  Serial.begin(115200);
  
  // Cihazı başlat
  initDevice();

  // WOL profillerini yükle (varsa)
  loadWOLProfilesFromPrefs();

  buzzerInit();
  ledInit();
  ledBlink(300);

  // WiFi bağlantısını dene
  Serial.println("\n=== WiFi Bağlantısı Kontrol Ediliyor ===");
  
  // Önce kaydedilmiş WiFi bilgilerini dene
  bool connected = connectToSavedWiFi();
  
  if (!connected) {
    // Kaydedilmiş WiFi bulunamadı veya bağlanılamadı
    // AP modu başlat (WiFi Setup GUI)
    Serial.println("WiFi'ye bağlanılamadı. AP modu başlatılıyor...");
    startAPMode();
    
    // AP modundayken WebSocket başlatma
    Serial.println("AP modu aktif. WiFi Setup arayüzü hazır.");
    Serial.println("192.168.4.1 adresine bağlanın.");
    return;
  }
  
  // WiFi bağlandı, WebSocket bağlantısı yap
  Serial.println("\n=== WebSocket Bağlantısı Kuruluyor ===");

  // Token'ı yükle
  deviceToken = loadToken();
  if (deviceToken.length() > 0) {
    Serial.println("Kaydedilmiş token yüklendi: " + deviceToken.substring(0, 8) + "...");
  }

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("Setup tamamlandı!");
}

// ----------------- WiFi Reset Komutu -----------------
void checkSerialCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();
    
    if (command == "RESETWIFI") {
      Serial.println("=== WiFi Ayarları Temizleniyor ===");
      Preferences prefs;
      prefs.begin("wificonfig", false);
      prefs.clear();
      prefs.end();
      Serial.println("WiFi ayarları temizlendi! Yeniden başlatılıyor...");
      delay(1000);
      ESP.restart();
    }
  }
}

// ----------------- LOOP -----------------
void loop() {
  // Serial komutlarını kontrol et
  checkSerialCommands();
  
  // AP modundayken DNS server'ı işle ve WebSocket'i çalıştırma
  if (wifiSetupStatus.isInAPMode) {
    // Captive portal DNS server'ını işle
    // Bu tüm DNS isteklerini ESP32'nin IP'sine yönlendirir
    dnsServer.processNextRequest();
    delay(10);
    return;
  }
  
  webSocket.loop();
  checkDevices();
  
  // Heartbeat güncelle ve gönder
  static unsigned long lastHeartbeat = 0;
  unsigned long now = millis();
  
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    String heartbeatMsg = createHeartbeatMessage();
    webSocket.sendTXT(heartbeatMsg);
    Serial.println("=== Heartbeat Gönderildi ===");
    Serial.println("Cihaz: " + String(DEVICE_ID) + " - " + String(DEVICE_NAME));
    Serial.println("Uptime: " + String(now / 1000) + " saniye");
    Serial.println("Mesaj: " + heartbeatMsg);
  }
  
  // Görev kuyruğunu işle
  processTaskQueue();
}

```

- İstediğin dinamiklik artık hazır: derleme zamanı `WOL_DEVICES_INIT` sadece başlangıç default’u. “Cihaza Senkronize Et” ile server’daki modalden girilen WOL profilleri ESP’ye gönderiliyor, ESP bunları ArduinoJson ile alıp NVS’e kaydediyor ve runtime `wolDevices` listesi güncelleniyor. Sonraki reboot’larda da NVS’ten geri yükleniyor.
- Frontend tarafında `syncWolProfilesToDevice()` artık `wol_profiles`’ı dizi olarak gönderiyor; ESP hem dizi hem string JSON’u destekliyor.
- `relayCount=0` gelen cihazlarda ana sayfadaki röle paneli otomatik gizleniyor.

Kısa kullanım:
- Admin > Konfigürasyon > WOL Profilleri > Profil Ekle
- “Cihaza Senkronize Et”e bas
- Ana sayfada WOL listesi capabilities’ten dinamik dolar; wake tuşu ilgili profili kullanır.

- Değişiklik özeti:
  - `DeviceConfig.h`: `RELAY_COUNT` override, `WOLDevice`e `broadcast`/`port`, `wolDeviceCount` runtime.
  - `DeviceConfigs (esp32_00x.h)`: varsayılan WOL girdileri yeni yapıya uyarlandı.
  - `DeviceConfig.cpp`: init’te broadcast/port default doldurma.
  - `main.cpp`: WOL kalıcılık (Preferences), JSON parse, sendWOL(dev), config’ten güncelleme.
  - `public/scripts/main.js`: `relayCount=0` ise röle panelini gizle.
  - `admin.html` + `public/scripts/admin.js`: “Cihaza Senkronize Et” butonu ve sync fonksiyonu.

Not: Artık yeni WOL cihazı eklemek için kod/makro değiştirmeye gerek yok; panelden ekle -> sync yeter.

---

**User**

kullaniciya cihaz atmak istedigimde "admin.js?v=1:19  PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 (Internal Server Error)
apiFetch @ admin.js?v=1:19
assignDeviceToUser @ admin.js?v=1:1301
(anonymous) @ admin.js?v=1:1292Understand this error
admin.js?v=1:21 API error: PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 Internal Server Error"

hatasi, 

kullanici modalini guncellemek istedigimde "admin.js?v=1:235  PUT https://fatihdev.xyz/api/admin/users/163 405 (Method Not Allowed)
(anonymous) @ admin.js?v=1:235Understand this error
admin.js?v=1:250 Kullanıcı güncelleme hatası: SyntaxError: Unexpected token '<', "<html>
<h"... is not valid JSON"

hatasi geliyor.

---

**Cursor**

Cihaz atama ve kullanıcı güncelleme hatasını netleştiriyorum. Önce admin.js’te yanlış URL/port kullanımını düzelteceğim (405 ve HTML response sebebi bu olabilir). Ardından, cihaz atamada 500 hatasına neden olabilecek payload alanlarını doğrulayıp gerekirse eksik alanları (undefined) göndermemek için istemciyi düzelteceğim. Bu sırada ilgili sunucu kodundaki endpoint beklentilerini ve DB update davranışını da kontrol edeceğim.

Cihaz atama 500 hatasını sunucu tarafında undefined alanların DB güncellemesinde yazılmasını engelleyerek çözüyorum; ayrıca kullanıcı güncelleme için admin.js’in PUT isteğini apiFetch kullanacak şekilde düzeltiyorum. Şimdi ilgili dosyaları düzenliyorum.

```javascript
*** Begin Patch
*** Update File: c:\Users\b350\Desktop\ESP32HOME_backup\espfrontend\public\scripts\admin.js
@@
-        document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
+        document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
@@
-        document.getElementById('edit-user-form')?.addEventListener('submit', async (e) => {
+        document.getElementById('edit-user-form')?.addEventListener('submit', async (e) => {
             e.preventDefault();
             
             const userId = document.getElementById('edit-user-id').value;
             const formData = {
                 username: document.getElementById('edit-username').value,
                 name: document.getElementById('edit-name').value,
                 email: document.getElementById('edit-email').value,
                 role: document.getElementById('edit-role').value,
                 is_active: document.getElementById('edit-active').checked
             };
             
             try {
-                const response = await fetch(`/api/admin/users/${userId}`, {
-                    method: 'PUT',
-                    headers: { 'Content-Type': 'application/json' },
-                    body: JSON.stringify(formData)
-                });
+                const response = await apiFetch(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(formData) });
                 
-                const data = await response.json();
-                if (data.success) {
+                const data = await response.json().catch(() => ({}));
+                if (response.ok && data.success) {
                     alert('Kullanıcı başarıyla güncellendi');
                     closeEditUserModal();
                     loadUsers(); // Kullanıcı listesini yenile
                 } else {
-                    alert('Kullanıcı güncellenemedi: ' + data.error);
+                    alert('Kullanıcı güncellenemedi' + (data.error ? (': ' + data.error) : ''));
                 }
             } catch (error) {
                 console.error('Kullanıcı güncelleme hatası:', error);
                 alert('Kullanıcı güncellenemedi');
             }
         });
*** End Patch
```

```javascript
// ==================== ADMIN DASHBOARD JAVASCRIPT ====================

// API Base ve fetch helper (API: 5130, same-site)
const getApiBaseUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:5130`;
};

async function apiFetch(path, options = {}) {
    const base = getApiBaseUrl();
    const finalOptions = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const url = `${base}${path}`;
    try {
        const resp = await fetch(url, finalOptions);
        if (!resp.ok) {
            console.warn('API error:', finalOptions.method || 'GET', url, resp.status, resp.statusText);
        }
        return resp;
    } catch (e) {
        console.error('API network error:', finalOptions.method || 'GET', url, e);
        throw e;
    }
}

let currentUser = null;
let adminWS = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin API base:', getApiBaseUrl());
    initializeAdmin();
    loadUserInfo();
    setupEventListeners();
    startAutoRefresh();
    setupWebSocket();
    initPortManager(); // Port yönetimini başlat
});

function initializeAdmin() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
    } else {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    }
}

function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    const t = document.querySelector('.sidebar-toggle');
    t?.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', onResize);
}

function onResize() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    } else {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
        overlay?.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    sidebar.style.transform = willOpen ? 'translateX(0%)' : 'translateX(-100%)';
    overlay?.classList.toggle('active', willOpen);
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateX(-100%)';
        overlay?.classList.remove('active');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'devices': loadDevices(); break;
        case 'device-configs': initDeviceConfigs(); break;
        case 'logs': loadLogs(); break;
        case 'analytics': loadAnalytics(); break;
        case 'security': loadSecurityData(); break;
        case 'settings': loadSettings(); initLayoutManager(); break;
        case 'backup': loadBackups(); break;
    }
}

async function loadUserInfo() {
    try {
        const r = await apiFetch('/api/user');
        if (!r.ok) { console.warn('Admin loadUserInfo: auth required', r.status); return; }
        const user = await r.json();
        currentUser = user;
        const el = document.getElementById('admin-name');
        if (el) el.textContent = user.name || user.username;
    } catch (e) { console.error('Admin loadUserInfo error:', e); }
}

// Users
async function loadUsers() {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.full_name || user.name || ''}</td>
            <td>${user.email || '-'}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Aktif' : 'Pasif'}</span></td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString('tr-TR') : 'Hiç'}</td>
            <td>
                <button class="btn-secondary" onclick="editUser('${user.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteUser('${user.id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Kullanıcı düzenleme
async function editUser(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        
        if (user.error) {
            alert('Kullanıcı bilgileri alınamadı: ' + user.error);
            return;
        }
        
        // Modal'ı doldur
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-name').value = user.name || '';
        document.getElementById('edit-email').value = user.email || '';
        document.getElementById('edit-role').value = user.role;
        document.getElementById('edit-active').checked = user.is_active;

        // Kullanıcıya cihaz atama alanı
        const form = document.getElementById('edit-user-form');
        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
          <label>Kullanıcı Cihazları</label>
          <div id="user-device-assign">
            <div style="display:flex; gap:.5rem; align-items:center;">
              <select id="assign-device-select"><option value="">Cihaz seçin...</option></select>
              <button type="button" class="btn-secondary" id="assign-device-btn">Ata</button>
            </div>
            <div id="assigned-devices" style="margin-top:.5rem;"></div>
          </div>
        `;
        const actions = form.querySelector('.form-actions');
        form.insertBefore(container, actions);
        await populateDeviceAssignment(user);
        
        // Modal'ı göster
        const modal = document.getElementById('edit-user-modal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    } catch (error) {
        console.error('Kullanıcı düzenleme hatası:', error);
        alert('Kullanıcı bilgileri alınamadı');
    }
}

// Edit user modal'ı kapat
function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

// Edit user form submit
document.addEventListener('DOMContentLoaded', function() {
    // Edit user form submit handler
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            const formData = {
                username: document.getElementById('edit-username').value,
                name: document.getElementById('edit-name').value,
                email: document.getElementById('edit-email').value,
                role: document.getElementById('edit-role').value,
                is_active: document.getElementById('edit-active').checked
            };
            
            try {
                const response = await apiFetch(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(formData) });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success) {
                    alert('Kullanıcı başarıyla güncellendi');
                    closeEditUserModal();
                    loadUsers(); // Kullanıcı listesini yenile
                } else {
                    alert('Kullanıcı güncellenemedi' + (data.error ? (': ' + data.error) : ''));
                }
            } catch (error) {
                console.error('Kullanıcı güncelleme hatası:', error);
                alert('Kullanıcı güncellenemedi');
            }
        });
    }
});

function showAddUserModal() {
    // basitleştirilmiş modal oluşturma (mevcut showModal kullanılıyorsa onunla entegre olur)
    // ... mevcut projede showModal var, bunu çağırıyoruz
    showModal('Yeni Kullanıcı Ekle', `
      <form id="add-user-form">
        <div class="form-section">
          <h3>Kullanıcı Bilgileri</h3>
          <div class="form-group">
            <label class="required">Kullanıcı Adı</label>
            <input type="text" id="new-username" required placeholder="Kullanıcı adını girin">
          </div>
          <div class="form-group">
            <label class="required">Şifre</label>
            <input type="password" id="new-password" required placeholder="Güçlü bir şifre girin">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Ad Soyad</label>
              <input type="text" id="new-fullname" placeholder="Ad Soyad">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="new-email" placeholder="email@example.com">
            </div>
          </div>
          <div class="form-group">
            <label class="required">Rol</label>
            <select id="new-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Kullanıcı Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    document.getElementById('add-user-form')?.addEventListener('submit', addUser);
}

async function addUser(e) {
    e.preventDefault();
    const userData = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    const r = await apiFetch('/api/admin/users', { method:'POST', body: JSON.stringify(userData) });
    if (r.ok) { closeModal(); loadUsers(); showToast('Kullanıcı eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Devices
async function loadDevices() {
    console.log('loadDevices çağrıldı');
    try {
        const r = await apiFetch('/api/admin/devices');
        console.log('API response status:', r.status);
        if (!r.ok) {
            console.error('API error:', r.status, r.statusText);
            showToast('Cihazlar yüklenemedi','error');
            return;
        }
        const devices = await r.json();
        console.log('Devices loaded:', devices);
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) {
            console.error('devices-table tbody bulunamadı');
            return;
        }
        tbody.innerHTML = '';
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${device.device_id}</td>
                <td>${device.device_name}</td>
                <td>${device.ip_address || '-'}</td>
                <td><span class="badge badge-${device.is_online ? 'success' : 'danger'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : 'Hiç'}</td>
                <td>${device.owner_name || '-'}</td>
                <td>
                    <button class="btn-secondary" onclick="editDevice('${device.device_id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteDevice('${device.device_id}')">Sil</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        console.log('Devices table updated');
    } catch (error) {
        console.error('loadDevices error:', error);
        showToast('Cihazlar yüklenirken hata oluştu','error');
    }
}

async function editDevice(deviceId) {
    const r = await apiFetch(`/api/admin/devices/${deviceId}`);
    if (!r.ok) { showToast('Cihaz bilgileri alınamadı','error'); return; }
    const device = await r.json();
    showModal('Cihaz Düzenle', `
      <form id="edit-device-form">
        <div class="form-group"><label>Cihaz ID</label><input type="text" id="edit-device-id" value="${device.device_id}" readonly></div>
        <div class="form-group"><label>Cihaz Adı</label><input type="text" id="edit-device-name" value="${device.device_name}" required></div>
        <div class="form-group"><label>IP Adresi</label><input type="text" id="edit-ip-address" value="${device.ip_address || ''}"></div>
        <div class="form-group"><label>MAC Adresi</label><input type="text" id="edit-mac-address" value="${device.mac_address || ''}"></div>
        <div class="form-group"><label>Konum</label><input type="text" id="edit-location" value="${device.location || ''}"></div>
        <div class="form-group"><label>Açıklama</label><textarea id="edit-description">${device.description || ''}</textarea></div>
        <div class="form-group"><label>Sahibi</label><select id="edit-owner" disabled><option value="">Sahipsiz</option></select><small style="display:block;opacity:.8;margin-top:.25rem;">Sahip atama işlemi kullanıcı düzenleme modalına taşındı.</small></div>
        <div class="form-group"><button type="submit" class="btn-primary">Güncelle</button></div>
      </form>
    `);
    await loadUserOptions(device.owner_name || '');
    document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
}

async function loadUserOptions(selectedUsername = '') {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Sahipsiz</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.full_name || u.name || u.username;
            sel.appendChild(opt);
        });
        if (selectedUsername) sel.value = selectedUsername;
    };
    fill(document.getElementById('edit-owner'));
    fill(document.getElementById('new-owner'));
}

async function updateDevice(deviceId) {
    const payload = {
        device_name: document.getElementById('edit-device-name').value,
        ip_address: document.getElementById('edit-ip-address').value,
        mac_address: document.getElementById('edit-mac-address').value,
        location: document.getElementById('edit-location').value,
        description: document.getElementById('edit-description').value,
        owner: document.getElementById('edit-owner').value
    };
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz güncellendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

function showAddDeviceModal() {
    showModal('Yeni Cihaz Ekle', `
      <form id="add-device-form">
        <div class="form-section">
          <h3>Cihaz Bilgileri</h3>
          <div class="form-group"><label class="required">Cihaz ID</label><input type="text" id="new-device-id" required placeholder="esp32_001"></div>
          <div class="form-group"><label class="required">Cihaz Adı</label><input type="text" id="new-device-name" required placeholder="Oturma Odası ESP32"></div>
          <div class="form-row">
            <div class="form-group"><label>IP Adresi</label><input type="text" id="new-ip-address" placeholder="192.168.1.100"></div>
            <div class="form-group"><label>MAC Adresi</label><input type="text" id="new-mac-address" placeholder="AA:BB:CC:DD:EE:FF"></div>
          </div>
          <div class="form-group"><label>Konum</label><input type="text" id="new-location" placeholder="Oturma Odası"></div>
          <div class="form-group"><label>Açıklama</label><textarea id="new-description" placeholder="Cihaz hakkında açıklama..."></textarea></div>
          <div class="form-group"><label>Sahibi</label><select id="new-owner"><option value="">Sahipsiz</option></select></div>
          <div class="form-check"><input type="checkbox" id="new-device-active" checked><label for="new-device-active">Cihaz aktif</label></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Cihaz Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    loadUserOptions();
    document.getElementById('add-device-form')?.addEventListener('submit', addDevice);
}

async function addDevice(e) {
    e.preventDefault();
    const deviceData = {
        device_id: document.getElementById('new-device-id').value,
        device_name: document.getElementById('new-device-name').value,
        ip_address: document.getElementById('new-ip-address').value,
        mac_address: document.getElementById('new-mac-address').value,
        location: document.getElementById('new-location').value,
        description: document.getElementById('new-description').value,
        owner: document.getElementById('new-owner').value
    };
    const r = await apiFetch('/api/admin/devices', { method:'POST', body: JSON.stringify(deviceData) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

async function deleteDevice(deviceId) {
    if (!confirm('Bu cihazı silmek istediğinizden emin misiniz?')) return;
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'DELETE' });
    if (r.ok) { loadDevices(); showToast('Cihaz silindi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Settings, Logs, Analytics, Security basitleştirilmiş placeholder
async function loadSettings() {}
async function loadLogs() {}
async function loadAnalytics() {}
async function loadSecurityData() {}
async function loadBackups() {}

function startAutoRefresh() {}

// Minimal modal/notification helpers (projede zaten varsa kullanılacak)
function showModal(title, content){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function showNotification(msg,type='info'){ console.log(`[${type}]`, msg); showToast(msg,type); }
// Toast helper (admin)
function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.color='#fff';
  el.style.fontSize='14px';
  el.style.boxShadow='0 2px 8px rgba(0,0,0,0.25)';
  el.style.background = type==='error'?'#d9534f':(type==='success'?'#28a745':'#444');
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity 300ms'; }, 2500);
  setTimeout(()=>{ el.remove(); }, 2900);
}

// Layout manager minimal
async function initLayoutManager() {
  try {
    const usersResp = await apiFetch('/api/admin/users');
    const users = await usersResp.json();
    const userSelect = document.getElementById('layout-user-select');
    if (!userSelect) return;
    userSelect.innerHTML = '';
    users.forEach(u => { const opt = document.createElement('option'); opt.value = u.id; opt.textContent = `${u.username} (${u.role})`; userSelect.appendChild(opt); });
    userSelect.addEventListener('change', () => loadUserLayoutForAdmin(parseInt(userSelect.value)));
    if (users.length) loadUserLayoutForAdmin(users[0].id);
    document.getElementById('layout-move-up')?.addEventListener('click', () => moveSelectedLayoutItem(-1));
    document.getElementById('layout-move-down')?.addEventListener('click', () => moveSelectedLayoutItem(1));
    document.getElementById('layout-order')?.addEventListener('click', (e) => {
      if (e.target?.tagName === 'LI') { document.querySelectorAll('#layout-order li').forEach(li => li.classList.remove('active')); e.target.classList.add('active'); }
    });
    document.getElementById('layout-save-btn')?.addEventListener('click', async () => {
      const targetUserId = parseInt(userSelect.value);
      const layout = collectLayoutFromForm();
      const resp = await apiFetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', body: JSON.stringify({ layout }) });
      if (resp.ok) {
        showToast('Layout kaydedildi','success');
      } else {
        const er = await resp.json().catch(() => ({}));
        showToast(er.error || 'Layout kaydedilemedi','error');
      }
    });
  } catch (e) { console.error('Layout manager init error:', e); }
}
function moveSelectedLayoutItem(direction) {
  const list = document.getElementById('layout-order');
  const active = list?.querySelector('li.active');
  if (!list || !active) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(active);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  if (direction < 0) list.insertBefore(active, items[targetIdx]); else list.insertBefore(items[targetIdx], active);
}
function collectLayoutFromForm() {
  const orderEls = document.querySelectorAll('#layout-order li');
  const sections = Array.from(orderEls).map(li => li.dataset.id);
  const hidden = [];
  if (!document.getElementById('layout-relay')?.checked) hidden.push('relay_parent');
  if (!document.getElementById('layout-wol')?.checked) hidden.push('wol_parent');
  if (!document.getElementById('layout-log')?.checked) hidden.push('log_parent');
  return { sections, hidden };
}
async function loadUserLayoutForAdmin(userId) {
  const resp = await apiFetch('/api/admin/user-layouts');
  const rows = await resp.json();
  const row = rows.find(r => r.user_id === userId);
  const layout = row?.layout_json ? JSON.parse(row.layout_json) : { sections:['relay_parent','wol_parent','log_parent'], hidden:[] };
  document.getElementById('layout-relay').checked = !layout.hidden.includes('relay_parent');
  document.getElementById('layout-wol').checked = !layout.hidden.includes('wol_parent');
  document.getElementById('layout-log').checked = !layout.hidden.includes('log_parent');
  const list = document.getElementById('layout-order');
  if (list) {
    list.innerHTML = '';
    layout.sections.forEach(id => { const li = document.createElement('li'); li.dataset.id = id; li.className='menu-item'; li.style.padding='0.5rem 1rem'; li.style.borderBottom='1px solid #3b3b3b'; li.style.cursor='grab'; li.textContent = id; list.appendChild(li); });
    if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';
  }
}

function setupWebSocket() {
    const wsUrl = `wss://fatihdev.xyz:5131/`;
    adminWS = new WebSocket(wsUrl);
    
    adminWS.onopen = () => {
        console.log('Admin WebSocket bağlandı');
        // Admin olarak auth gönder
        adminWS.send(JSON.stringify({
            type: 'userAuth',
            userId: 'admin',
            role: 'admin'
        }));
    };
    
    adminWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'deviceUpdated') {
                console.log('Cihaz güncellendi:', data.deviceId, data.action);
                // Cihaz yönetimi sekmesi aktifse listeyi yenile
                const devicesTab = document.getElementById('devices');
                if (devicesTab && devicesTab.classList.contains('active')) {
                    loadDevices();
                }
            }
        } catch (e) {
            // JSON olmayan mesajları görmezden gel
        }
    };
    
    adminWS.onclose = () => {
        console.log('Admin WebSocket bağlantısı kapandı');
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => {
            setupWebSocket();
        }, 5000);
    };
    
    adminWS.onerror = (error) => {
        console.error('Admin WebSocket hatası:', error);
    };
}

// ==================== PORT YÖNETİMİ ====================

// Port yönetimi başlat
function initPortManager() {
    loadPorts();
    loadPortUsers();
    setupPortEventListeners();
}

// Port listesini yükle
async function loadPorts() {
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        if (data.error) {
            console.error('Port listesi yüklenemedi:', data.error);
            return;
        }
        
        renderUsedPorts(data.usedPorts);
        renderAvailablePorts(data.availablePorts);
    } catch (error) {
        console.error('Port listesi yüklenemedi:', error);
    }
}

// Kullanılan portları render et
function renderUsedPorts(usedPorts) {
    const container = document.getElementById('used-ports-list');
    container.innerHTML = '';
    
    if (usedPorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılan port yok</span></div></div>';
        return;
    }
    
    usedPorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item used';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port.port}</span>
                <span class="port-user">${port.username}</span>
            </div>
            <div class="port-actions">
                <button class="btn-release" onclick="releaseUserPort(${port.userId})">Serbest Bırak</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Kullanılabilir portları render et
function renderAvailablePorts(availablePorts) {
    const container = document.getElementById('available-ports-list');
    container.innerHTML = '';
    
    if (availablePorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılabilir port yok</span></div></div>';
        return;
    }
    
    availablePorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item available';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port}</span>
                <span class="port-user">Kullanılabilir</span>
            </div>
            <div class="port-actions">
                <button class="btn-assign" onclick="assignPortToUser(${port})">Ata</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Port kullanıcılarını yükle
async function loadPortUsers() {
    try {
        const response = await apiFetch('/api/admin/users');
        const users = await response.json();
        
        const select = document.getElementById('port-user-select');
        select.innerHTML = '<option value="">Kullanıcı seçin...</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (${user.name || 'İsimsiz'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Kullanıcı listesi yüklenemedi:', error);
    }
}

// Port event listener'ları
function setupPortEventListeners() {
    // Port ata butonu
    document.getElementById('assign-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        const port = document.getElementById('port-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch('/api/admin/ports/assign', {
                method: 'POST',
                body: JSON.stringify({ userId, port: port || null })
            });
            
            const data = await response.json();
            if (data.success) {
                alert(`Port ${data.port} başarıyla atandı`);
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port atanamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port atama hatası:', error);
            alert('Port atanamadı');
        }
    });
    
    // Port serbest bırak butonu
    document.getElementById('release-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch(`/api/admin/ports/${userId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Port başarıyla serbest bırakıldı');
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port serbest bırakılamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port serbest bırakma hatası:', error);
            alert('Port serbest bırakılamadı');
        }
    });
    
    // Yenile butonu
    document.getElementById('refresh-ports').addEventListener('click', () => {
        loadPorts();
        loadPortUsers();
    });
    
    // Kullanıcı seçimi değiştiğinde port seçeneklerini güncelle
    document.getElementById('port-user-select').addEventListener('change', (e) => {
        updatePortSelectOptions(e.target.value);
    });
}

// Port seçeneklerini güncelle
async function updatePortSelectOptions(userId) {
    const portSelect = document.getElementById('port-select');
    portSelect.innerHTML = '<option value="">Port seçin...</option>';
    
    if (!userId) return;
    
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        data.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = `Port ${port}`;
            portSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Port seçenekleri yüklenemedi:', error);
    }
}

// Kullanıcı portunu serbest bırak
async function releaseUserPort(userId) {
    if (!confirm('Bu kullanıcının portunu serbest bırakmak istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/ports/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Port başarıyla serbest bırakıldı');
            loadPorts();
        } else {
            alert('Port serbest bırakılamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port serbest bırakma hatası:', error);
        alert('Port serbest bırakılamadı');
    }
}

// Portu kullanıcıya ata
async function assignPortToUser(port) {
    const userId = document.getElementById('port-user-select').value;
    
    if (!userId) {
        alert('Lütfen kullanıcı seçin');
        return;
    }
    
    try {
        const response = await apiFetch('/api/admin/ports/assign', {
            method: 'POST',
            body: JSON.stringify({ userId, port })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(`Port ${port} başarıyla atandı`);
            loadPorts();
        } else {
            alert('Port atanamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port atama hatası:', error);
        alert('Port atanamadı');
    }
}


// ==================== AUTH / USER ACTIONS ====================
async function logout() {
    try {
        const r = await apiFetch('/api/logout', { method: 'POST' });
        // Başarılı/başarısız fark etmeksizin login'e yönlendir
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function deleteUser(userId) {
    try {
        if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('Kullanıcı silindi', 'success');
            loadUsers();
        } else {
            const er = await r.json().catch(() => ({}));
            showToast(er.error || 'Kullanıcı silinemedi', 'error');
        }
    } catch (e) {
        console.error('deleteUser error:', e);
        showToast('Kullanıcı silinemedi', 'error');
    }
}

// ==================== DEVICE CONFIG MANAGEMENT ====================

let selectedDeviceId = null;
let deviceConfigs = {};

// Device config sekmesi yüklendiğinde
function initDeviceConfigs() {
    console.log('🔧 initDeviceConfigs çağrıldı');
    loadDevicesForConfig();
    setupDeviceConfigEventListeners();
}

// Cihaz seçici için cihazları yükle
async function loadDevicesForConfig() {
    try {
        const response = await apiFetch('/api/admin/devices');
        const devices = await response.json();
        
        const deviceSelector = document.getElementById('device-selector');
        deviceSelector.innerHTML = '<option value="">Cihaz Seçin</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = `${device.device_name} (${device.device_id})`;
            deviceSelector.appendChild(option);
        });
        
        // Cihaz seçimi değiştiğinde
        deviceSelector.addEventListener('change', function() {
            selectedDeviceId = this.value;
            if (selectedDeviceId) {
                loadDeviceStatus();
                loadWolProfiles();
                loadConfigHistory();
            } else {
                clearDeviceConfigUI();
            }
        });
        
    } catch (error) {
        console.error('Cihazlar yüklenemedi:', error);
        showToast('Cihazlar yüklenemedi', 'error');
    }
}

// Event listeners kurulumu
function setupDeviceConfigEventListeners() {
    // DHCP checkbox değiştiğinde
    document.getElementById('use-dhcp').addEventListener('change', function() {
        const staticIpGroup = document.getElementById('static-ip-group');
        staticIpGroup.style.display = this.checked ? 'none' : 'block';
    });
}

// Cihaz durumunu yükle
async function loadDeviceStatus() {
    console.log('🔧 loadDeviceStatus çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) return;
    
    try {
        console.log('🔧 API çağrısı yapılıyor:', `/api/devices/${selectedDeviceId}/status`);
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/status`);
        const data = await response.json();
        console.log('🔧 API yanıtı:', data);
        
        if (data.success) {
            const device = data.device;
            console.log('🔧 Cihaz bilgileri:', device);
            
            // Durum güncelle
            const statusElement = document.getElementById('device-online-status');
            console.log('🔧 Status element:', statusElement);
            if (statusElement) {
                statusElement.textContent = device.is_online ? 'Online' : 'Offline';
                statusElement.className = `status-value ${device.is_online ? 'online' : 'offline'}`;
                console.log('🔧 Status güncellendi:', device.is_online ? 'Online' : 'Offline');
            }
            
            // Diğer bilgiler
            const lastSeenElement = document.getElementById('device-last-seen');
            const firmwareElement = document.getElementById('device-firmware');
            const queueCountElement = document.getElementById('device-queue-count');
            
            if (lastSeenElement) {
                lastSeenElement.textContent = device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : '-';
            }
            if (firmwareElement) {
                firmwareElement.textContent = device.firmware || '-';
            }
            if (queueCountElement) {
                queueCountElement.textContent = device.queue_count || '0';
            }
            
        } else {
            console.error('❌ API başarısız:', data);
            showToast('Cihaz durumu alınamadı', 'error');
        }
    } catch (error) {
        console.error('❌ Cihaz durumu yüklenemedi:', error);
        showToast('Cihaz durumu yüklenemedi', 'error');
    }
}

// WiFi konfigürasyonu gönder
async function sendWifiConfig() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    const useDhcp = document.getElementById('use-dhcp').checked;
    const staticIp = document.getElementById('static-ip').value;
    
    if (!ssid || !password) {
        showToast('SSID ve şifre gerekli', 'warning');
        return;
    }
    
    const config = {
        wifi_ssid: ssid,
        wifi_pass: password,
        use_dhcp: useDhcp,
        static_ip: useDhcp ? null : staticIp
    };
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.sent ? 'success' : 'info');
            loadConfigHistory(); // Geçmişi yenile
        } else {
            showToast('Konfigürasyon gönderilemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WiFi config gönderme hatası:', error);
        showToast('Konfigürasyon gönderilemedi', 'error');
    }
}

// WOL profillerini yükle
async function loadWolProfiles() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        
        if (data.success) {
            const profilesList = document.getElementById('wol-profiles-list');
            profilesList.innerHTML = '';
            
            data.profiles.forEach(profile => {
                const profileItem = document.createElement('div');
                profileItem.className = 'wol-profile-item';
                profileItem.innerHTML = `
                    <div class="wol-profile-info">
                        <div class="wol-profile-name">${profile.name}</div>
                        <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
                    </div>
                    <div class="wol-profile-actions">
                        <button class="btn-small" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteWolProfile(${profile.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                profilesList.appendChild(profileItem);
            });
        }
    } catch (error) {
        console.error('WOL profilleri yüklenemedi:', error);
    }
}

// WOL profili ekleme modalını göster
function showAddWolProfileModal() {
    console.log('🔧 showAddWolProfileModal çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const modal = document.getElementById('add-wol-profile-modal');
    console.log('🔧 Modal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        console.log('🔧 Modal gösterildi');
    } else {
        console.error('❌ Modal bulunamadı!');
    }
}

// WOL profili ekleme modalını kapat
function closeAddWolProfileModal() {
    const modal = document.getElementById('add-wol-profile-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-wol-profile-form');
    if (form) {
        form.reset();
    }
}

// WOL profili ekle
async function addWolProfile() {
    const name = document.getElementById('wol-profile-name').value;
    const mac = document.getElementById('wol-profile-mac').value;
    const broadcast = document.getElementById('wol-profile-broadcast').value;
    const port = document.getElementById('wol-profile-port').value;
    
    if (!name || !mac || !broadcast) {
        showToast('Tüm alanlar gerekli', 'warning');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`, {
            method: 'POST',
            body: JSON.stringify({ name, mac, broadcast_ip: broadcast, port: parseInt(port) })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili eklendi', 'success');
            closeAddWolProfileModal();
            loadWolProfiles();
        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
        } else {
            showToast('WOL profili eklenemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili ekleme hatası:', error);
        showToast('WOL profili eklenemedi', 'error');
    }
}

// WOL profillerini cihaza senkronize et
async function syncWolProfilesToDevice() {
    if (!selectedDeviceId) return;
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        if (!data.success) {
            showToast('WOL profilleri alınamadı', 'error');
            return;
        }
        const profiles = data.profiles.map(p => ({
            name: p.name,
            mac: p.mac,
            broadcast_ip: p.broadcast_ip,
            port: p.port || 9,
            ip: p.ip_address || '0.0.0.0'
        }));

        const payload = {
            wol_profiles: profiles
        };

        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config: payload })
        });
        const resj = await resp.json();
        if (resp.ok && resj.success) {
            showToast('WOL profilleri cihaza gönderildi', 'success');
        } else {
            showToast('WOL profilleri gönderilemedi', 'error');
        }
    } catch (e) {
        console.error('syncWolProfilesToDevice error:', e);
        showToast('Senkronizasyon hatası', 'error');
    }
}

// WOL profili sil
async function deleteWolProfile(profileId) {
    if (!confirm('Bu WOL profilini silmek istediğinizden emin misiniz?')) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili silindi', 'success');
            loadWolProfiles();
        } else {
            showToast('WOL profili silinemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili silme hatası:', error);
        showToast('WOL profili silinemedi', 'error');
    }
}

// Konfigürasyon geçmişini yükle
async function loadConfigHistory() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/history?limit=20`);
        const data = await response.json();
        
        if (data.success) {
            const historyContainer = document.getElementById('config-history');
            historyContainer.innerHTML = '';
            
            data.history.forEach(entry => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <div class="history-action ${entry.action}">${getActionText(entry.action)}</div>
                        <div class="history-details">${entry.username || 'Sistem'} - ${entry.error_message || 'Başarılı'}</div>
                    </div>
                    <div class="history-timestamp">${new Date(entry.created_at).toLocaleString('tr-TR')}</div>
                `;
                historyContainer.appendChild(historyItem);
            });
        }
    } catch (error) {
        console.error('Konfigürasyon geçmişi yüklenemedi:', error);
    }
}

// Action text'i döndür
function getActionText(action) {
    const actions = {
        'sent': 'Gönderildi',
        'applied': 'Uygulandı',
        'failed': 'Başarısız',
        'queued': 'Kuyruğa Eklendi'
    };
    return actions[action] || action;
}

// Cihaz durumunu yenile
async function refreshDeviceStatus() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    await loadDeviceStatus();
    showToast('Durum yenilendi', 'success');
}

// Device config UI'sını temizle
function clearDeviceConfigUI() {
    document.getElementById('device-online-status').textContent = 'Offline';
    document.getElementById('device-online-status').className = 'status-value offline';
    document.getElementById('device-last-seen').textContent = '-';
    document.getElementById('device-firmware').textContent = '-';
    document.getElementById('device-queue-count').textContent = '0';
    document.getElementById('wol-profiles-list').innerHTML = '';
    document.getElementById('config-history').innerHTML = '';
    document.getElementById('wifi-config-form').reset();
}

// ==================== USER-DEVICE ASSIGNMENT ====================
async function populateDeviceAssignment(user){
  try {
    const r = await apiFetch('/api/admin/devices');
    if (!r.ok) return;
    const devices = await r.json();
    const select = document.getElementById('assign-device-select');
    if (select) {
      select.innerHTML = '<option value="">Cihaz seçin...</option>';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = `${d.device_name} (${d.device_id})`;
        select.appendChild(opt);
      });
    }

    const assignedWrap = document.getElementById('assigned-devices');
    if (assignedWrap) {
      assignedWrap.innerHTML = '';
      const owned = devices.filter(d => String(d.owner_name||'').toLowerCase() === String(user.username).toLowerCase() || String(d.owner_id||'') === String(user.id));
      if (!owned.length) {
        assignedWrap.innerHTML = '<div style="opacity:.75;">Bu kullanıcıya atanmış cihaz yok</div>';
      } else {
        owned.forEach(d => {
          const chip = document.createElement('div');
          chip.style.display='inline-flex';
          chip.style.alignItems='center';
          chip.style.gap='.5rem';
          chip.style.padding='.25rem .5rem';
          chip.style.border='1px solid #3b3b3b';
          chip.style.borderRadius='12px';
          chip.style.marginRight='.5rem';
          chip.style.marginBottom='.5rem';
          chip.innerHTML = `<span>${d.device_name} (${d.device_id})</span><button type="button" class="btn-small" data-unassign="${d.device_id}">Kaldır</button>`;
          assignedWrap.appendChild(chip);
        });
        assignedWrap.querySelectorAll('[data-unassign]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const deviceId = e.currentTarget.getAttribute('data-unassign');
            await assignDeviceToUser(deviceId, null);
            await populateDeviceAssignment(user);
            showToast('Cihaz kullanıcıdan kaldırıldı','success');
          });
        });
      }
    }

    const assignBtn = document.getElementById('assign-device-btn');
    assignBtn?.addEventListener('click', async () => {
      const deviceId = select?.value;
      if (!deviceId) { showToast('Önce bir cihaz seçin','error'); return; }
      await assignDeviceToUser(deviceId, user.username);
      showToast('Cihaz kullanıcıya atandı','success');
      await populateDeviceAssignment(user);
    });
  } catch (e) { console.error('populateDeviceAssignment error:', e); }
}

async function assignDeviceToUser(deviceId, username){
  const payload = { owner: username || '' };
  const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
  return r.ok;
}


```

```javascript
// ==================== ADMIN DASHBOARD JAVASCRIPT ====================

// API Base ve fetch helper (API: 5130, same-site)
const getApiBaseUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:5130`;
};

async function apiFetch(path, options = {}) {
    const base = getApiBaseUrl();
    const finalOptions = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const url = `${base}${path}`;
    try {
        const resp = await fetch(url, finalOptions);
        if (!resp.ok) {
            console.warn('API error:', finalOptions.method || 'GET', url, resp.status, resp.statusText);
        }
        return resp;
    } catch (e) {
        console.error('API network error:', finalOptions.method || 'GET', url, e);
        throw e;
    }
}

let currentUser = null;
let adminWS = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin API base:', getApiBaseUrl());
    initializeAdmin();
    loadUserInfo();
    setupEventListeners();
    startAutoRefresh();
    setupWebSocket();
    initPortManager(); // Port yönetimini başlat
});

function initializeAdmin() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
    } else {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    }
}

function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    const t = document.querySelector('.sidebar-toggle');
    t?.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', onResize);
}

function onResize() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    } else {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
        overlay?.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    sidebar.style.transform = willOpen ? 'translateX(0%)' : 'translateX(-100%)';
    overlay?.classList.toggle('active', willOpen);
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateX(-100%)';
        overlay?.classList.remove('active');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'devices': loadDevices(); break;
        case 'device-configs': initDeviceConfigs(); break;
        case 'logs': loadLogs(); break;
        case 'analytics': loadAnalytics(); break;
        case 'security': loadSecurityData(); break;
        case 'settings': loadSettings(); initLayoutManager(); break;
        case 'backup': loadBackups(); break;
    }
}

async function loadUserInfo() {
    try {
        const r = await apiFetch('/api/user');
        if (!r.ok) { console.warn('Admin loadUserInfo: auth required', r.status); return; }
        const user = await r.json();
        currentUser = user;
        const el = document.getElementById('admin-name');
        if (el) el.textContent = user.name || user.username;
    } catch (e) { console.error('Admin loadUserInfo error:', e); }
}

// Users
async function loadUsers() {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.full_name || user.name || ''}</td>
            <td>${user.email || '-'}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Aktif' : 'Pasif'}</span></td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString('tr-TR') : 'Hiç'}</td>
            <td>
                <button class="btn-secondary" onclick="editUser('${user.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteUser('${user.id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Kullanıcı düzenleme
async function editUser(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        
        if (user.error) {
            alert('Kullanıcı bilgileri alınamadı: ' + user.error);
            return;
        }
        
        // Modal'ı doldur
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-name').value = user.name || '';
        document.getElementById('edit-email').value = user.email || '';
        document.getElementById('edit-role').value = user.role;
        document.getElementById('edit-active').checked = user.is_active;

        // Kullanıcıya cihaz atama alanı
        const form = document.getElementById('edit-user-form');
        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
          <label>Kullanıcı Cihazları</label>
          <div id="user-device-assign">
            <div style="display:flex; gap:.5rem; align-items:center;">
              <select id="assign-device-select"><option value="">Cihaz seçin...</option></select>
              <button type="button" class="btn-secondary" id="assign-device-btn">Ata</button>
            </div>
            <div id="assigned-devices" style="margin-top:.5rem;"></div>
          </div>
        `;
        const actions = form.querySelector('.form-actions');
        form.insertBefore(container, actions);
        await populateDeviceAssignment(user);
        
        // Modal'ı göster
        const modal = document.getElementById('edit-user-modal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    } catch (error) {
        console.error('Kullanıcı düzenleme hatası:', error);
        alert('Kullanıcı bilgileri alınamadı');
    }
}

// Edit user modal'ı kapat
function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

// Edit user form submit
document.addEventListener('DOMContentLoaded', function() {
    // Edit user form submit handler
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            const formData = {
                username: document.getElementById('edit-username').value,
                name: document.getElementById('edit-name').value,
                email: document.getElementById('edit-email').value,
                role: document.getElementById('edit-role').value,
                is_active: document.getElementById('edit-active').checked
            };
            
            try {
                const response = await apiFetch(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(formData) });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success) {
                    alert('Kullanıcı başarıyla güncellendi');
                    closeEditUserModal();
                    loadUsers(); // Kullanıcı listesini yenile
                } else {
                    alert('Kullanıcı güncellenemedi' + (data.error ? (': ' + data.error) : ''));
                }
            } catch (error) {
                console.error('Kullanıcı güncelleme hatası:', error);
                alert('Kullanıcı güncellenemedi');
            }
        });
    }
});

function showAddUserModal() {
    // basitleştirilmiş modal oluşturma (mevcut showModal kullanılıyorsa onunla entegre olur)
    // ... mevcut projede showModal var, bunu çağırıyoruz
    showModal('Yeni Kullanıcı Ekle', `
      <form id="add-user-form">
        <div class="form-section">
          <h3>Kullanıcı Bilgileri</h3>
          <div class="form-group">
            <label class="required">Kullanıcı Adı</label>
            <input type="text" id="new-username" required placeholder="Kullanıcı adını girin">
          </div>
          <div class="form-group">
            <label class="required">Şifre</label>
            <input type="password" id="new-password" required placeholder="Güçlü bir şifre girin">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Ad Soyad</label>
              <input type="text" id="new-fullname" placeholder="Ad Soyad">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="new-email" placeholder="email@example.com">
            </div>
          </div>
          <div class="form-group">
            <label class="required">Rol</label>
            <select id="new-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Kullanıcı Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    document.getElementById('add-user-form')?.addEventListener('submit', addUser);
}

async function addUser(e) {
    e.preventDefault();
    const userData = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    const r = await apiFetch('/api/admin/users', { method:'POST', body: JSON.stringify(userData) });
    if (r.ok) { closeModal(); loadUsers(); showToast('Kullanıcı eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Devices
async function loadDevices() {
    console.log('loadDevices çağrıldı');
    try {
        const r = await apiFetch('/api/admin/devices');
        console.log('API response status:', r.status);
        if (!r.ok) {
            console.error('API error:', r.status, r.statusText);
            showToast('Cihazlar yüklenemedi','error');
            return;
        }
        const devices = await r.json();
        console.log('Devices loaded:', devices);
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) {
            console.error('devices-table tbody bulunamadı');
            return;
        }
        tbody.innerHTML = '';
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${device.device_id}</td>
                <td>${device.device_name}</td>
                <td>${device.ip_address || '-'}</td>
                <td><span class="badge badge-${device.is_online ? 'success' : 'danger'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : 'Hiç'}</td>
                <td>${device.owner_name || '-'}</td>
                <td>
                    <button class="btn-secondary" onclick="editDevice('${device.device_id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteDevice('${device.device_id}')">Sil</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        console.log('Devices table updated');
    } catch (error) {
        console.error('loadDevices error:', error);
        showToast('Cihazlar yüklenirken hata oluştu','error');
    }
}

async function editDevice(deviceId) {
    const r = await apiFetch(`/api/admin/devices/${deviceId}`);
    if (!r.ok) { showToast('Cihaz bilgileri alınamadı','error'); return; }
    const device = await r.json();
    showModal('Cihaz Düzenle', `
      <form id="edit-device-form">
        <div class="form-group"><label>Cihaz ID</label><input type="text" id="edit-device-id" value="${device.device_id}" readonly></div>
        <div class="form-group"><label>Cihaz Adı</label><input type="text" id="edit-device-name" value="${device.device_name}" required></div>
        <div class="form-group"><label>IP Adresi</label><input type="text" id="edit-ip-address" value="${device.ip_address || ''}"></div>
        <div class="form-group"><label>MAC Adresi</label><input type="text" id="edit-mac-address" value="${device.mac_address || ''}"></div>
        <div class="form-group"><label>Konum</label><input type="text" id="edit-location" value="${device.location || ''}"></div>
        <div class="form-group"><label>Açıklama</label><textarea id="edit-description">${device.description || ''}</textarea></div>
        <div class="form-group"><label>Sahibi</label><select id="edit-owner" disabled><option value="">Sahipsiz</option></select><small style="display:block;opacity:.8;margin-top:.25rem;">Sahip atama işlemi kullanıcı düzenleme modalına taşındı.</small></div>
        <div class="form-group"><button type="submit" class="btn-primary">Güncelle</button></div>
      </form>
    `);
    await loadUserOptions(device.owner_name || '');
    document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
}

async function loadUserOptions(selectedUsername = '') {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Sahipsiz</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.full_name || u.name || u.username;
            sel.appendChild(opt);
        });
        if (selectedUsername) sel.value = selectedUsername;
    };
    fill(document.getElementById('edit-owner'));
    fill(document.getElementById('new-owner'));
}

async function updateDevice(deviceId) {
    const payload = {
        device_name: document.getElementById('edit-device-name').value,
        ip_address: document.getElementById('edit-ip-address').value,
        mac_address: document.getElementById('edit-mac-address').value,
        location: document.getElementById('edit-location').value,
        description: document.getElementById('edit-description').value,
        owner: document.getElementById('edit-owner').value
    };
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz güncellendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

function showAddDeviceModal() {
    showModal('Yeni Cihaz Ekle', `
      <form id="add-device-form">
        <div class="form-section">
          <h3>Cihaz Bilgileri</h3>
          <div class="form-group"><label class="required">Cihaz ID</label><input type="text" id="new-device-id" required placeholder="esp32_001"></div>
          <div class="form-group"><label class="required">Cihaz Adı</label><input type="text" id="new-device-name" required placeholder="Oturma Odası ESP32"></div>
          <div class="form-row">
            <div class="form-group"><label>IP Adresi</label><input type="text" id="new-ip-address" placeholder="192.168.1.100"></div>
            <div class="form-group"><label>MAC Adresi</label><input type="text" id="new-mac-address" placeholder="AA:BB:CC:DD:EE:FF"></div>
          </div>
          <div class="form-group"><label>Konum</label><input type="text" id="new-location" placeholder="Oturma Odası"></div>
          <div class="form-group"><label>Açıklama</label><textarea id="new-description" placeholder="Cihaz hakkında açıklama..."></textarea></div>
          <div class="form-group"><label>Sahibi</label><select id="new-owner"><option value="">Sahipsiz</option></select></div>
          <div class="form-check"><input type="checkbox" id="new-device-active" checked><label for="new-device-active">Cihaz aktif</label></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Cihaz Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    loadUserOptions();
    document.getElementById('add-device-form')?.addEventListener('submit', addDevice);
}

async function addDevice(e) {
    e.preventDefault();
    const deviceData = {
        device_id: document.getElementById('new-device-id').value,
        device_name: document.getElementById('new-device-name').value,
        ip_address: document.getElementById('new-ip-address').value,
        mac_address: document.getElementById('new-mac-address').value,
        location: document.getElementById('new-location').value,
        description: document.getElementById('new-description').value,
        owner: document.getElementById('new-owner').value
    };
    const r = await apiFetch('/api/admin/devices', { method:'POST', body: JSON.stringify(deviceData) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

async function deleteDevice(deviceId) {
    if (!confirm('Bu cihazı silmek istediğinizden emin misiniz?')) return;
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'DELETE' });
    if (r.ok) { loadDevices(); showToast('Cihaz silindi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Settings, Logs, Analytics, Security basitleştirilmiş placeholder
async function loadSettings() {}
async function loadLogs() {}
async function loadAnalytics() {}
async function loadSecurityData() {}
async function loadBackups() {}

function startAutoRefresh() {}

// Minimal modal/notification helpers (projede zaten varsa kullanılacak)
function showModal(title, content){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function showNotification(msg,type='info'){ console.log(`[${type}]`, msg); showToast(msg,type); }
// Toast helper (admin)
function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.color='#fff';
  el.style.fontSize='14px';
  el.style.boxShadow='0 2px 8px rgba(0,0,0,0.25)';
  el.style.background = type==='error'?'#d9534f':(type==='success'?'#28a745':'#444');
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity 300ms'; }, 2500);
  setTimeout(()=>{ el.remove(); }, 2900);
}

// Layout manager minimal
async function initLayoutManager() {
  try {
    const usersResp = await apiFetch('/api/admin/users');
    const users = await usersResp.json();
    const userSelect = document.getElementById('layout-user-select');
    if (!userSelect) return;
    userSelect.innerHTML = '';
    users.forEach(u => { const opt = document.createElement('option'); opt.value = u.id; opt.textContent = `${u.username} (${u.role})`; userSelect.appendChild(opt); });
    userSelect.addEventListener('change', () => loadUserLayoutForAdmin(parseInt(userSelect.value)));
    if (users.length) loadUserLayoutForAdmin(users[0].id);
    document.getElementById('layout-move-up')?.addEventListener('click', () => moveSelectedLayoutItem(-1));
    document.getElementById('layout-move-down')?.addEventListener('click', () => moveSelectedLayoutItem(1));
    document.getElementById('layout-order')?.addEventListener('click', (e) => {
      if (e.target?.tagName === 'LI') { document.querySelectorAll('#layout-order li').forEach(li => li.classList.remove('active')); e.target.classList.add('active'); }
    });
    document.getElementById('layout-save-btn')?.addEventListener('click', async () => {
      const targetUserId = parseInt(userSelect.value);
      const layout = collectLayoutFromForm();
      const resp = await apiFetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', body: JSON.stringify({ layout }) });
      if (resp.ok) {
        showToast('Layout kaydedildi','success');
      } else {
        const er = await resp.json().catch(() => ({}));
        showToast(er.error || 'Layout kaydedilemedi','error');
      }
    });
  } catch (e) { console.error('Layout manager init error:', e); }
}
function moveSelectedLayoutItem(direction) {
  const list = document.getElementById('layout-order');
  const active = list?.querySelector('li.active');
  if (!list || !active) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(active);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  if (direction < 0) list.insertBefore(active, items[targetIdx]); else list.insertBefore(items[targetIdx], active);
}
function collectLayoutFromForm() {
  const orderEls = document.querySelectorAll('#layout-order li');
  const sections = Array.from(orderEls).map(li => li.dataset.id);
  const hidden = [];
  if (!document.getElementById('layout-relay')?.checked) hidden.push('relay_parent');
  if (!document.getElementById('layout-wol')?.checked) hidden.push('wol_parent');
  if (!document.getElementById('layout-log')?.checked) hidden.push('log_parent');
  return { sections, hidden };
}
async function loadUserLayoutForAdmin(userId) {
  const resp = await apiFetch('/api/admin/user-layouts');
  const rows = await resp.json();
  const row = rows.find(r => r.user_id === userId);
  const layout = row?.layout_json ? JSON.parse(row.layout_json) : { sections:['relay_parent','wol_parent','log_parent'], hidden:[] };
  document.getElementById('layout-relay').checked = !layout.hidden.includes('relay_parent');
  document.getElementById('layout-wol').checked = !layout.hidden.includes('wol_parent');
  document.getElementById('layout-log').checked = !layout.hidden.includes('log_parent');
  const list = document.getElementById('layout-order');
  if (list) {
    list.innerHTML = '';
    layout.sections.forEach(id => { const li = document.createElement('li'); li.dataset.id = id; li.className='menu-item'; li.style.padding='0.5rem 1rem'; li.style.borderBottom='1px solid #3b3b3b'; li.style.cursor='grab'; li.textContent = id; list.appendChild(li); });
    if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';
  }
}

function setupWebSocket() {
    const wsUrl = `wss://fatihdev.xyz:5131/`;
    adminWS = new WebSocket(wsUrl);
    
    adminWS.onopen = () => {
        console.log('Admin WebSocket bağlandı');
        // Admin olarak auth gönder
        adminWS.send(JSON.stringify({
            type: 'userAuth',
            userId: 'admin',
            role: 'admin'
        }));
    };
    
    adminWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'deviceUpdated') {
                console.log('Cihaz güncellendi:', data.deviceId, data.action);
                // Cihaz yönetimi sekmesi aktifse listeyi yenile
                const devicesTab = document.getElementById('devices');
                if (devicesTab && devicesTab.classList.contains('active')) {
                    loadDevices();
                }
            }
        } catch (e) {
            // JSON olmayan mesajları görmezden gel
        }
    };
    
    adminWS.onclose = () => {
        console.log('Admin WebSocket bağlantısı kapandı');
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => {
            setupWebSocket();
        }, 5000);
    };
    
    adminWS.onerror = (error) => {
        console.error('Admin WebSocket hatası:', error);
    };
}

// ==================== PORT YÖNETİMİ ====================

// Port yönetimi başlat
function initPortManager() {
    loadPorts();
    loadPortUsers();
    setupPortEventListeners();
}

// Port listesini yükle
async function loadPorts() {
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        if (data.error) {
            console.error('Port listesi yüklenemedi:', data.error);
            return;
        }
        
        renderUsedPorts(data.usedPorts);
        renderAvailablePorts(data.availablePorts);
    } catch (error) {
        console.error('Port listesi yüklenemedi:', error);
    }
}

// Kullanılan portları render et
function renderUsedPorts(usedPorts) {
    const container = document.getElementById('used-ports-list');
    container.innerHTML = '';
    
    if (usedPorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılan port yok</span></div></div>';
        return;
    }
    
    usedPorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item used';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port.port}</span>
                <span class="port-user">${port.username}</span>
            </div>
            <div class="port-actions">
                <button class="btn-release" onclick="releaseUserPort(${port.userId})">Serbest Bırak</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Kullanılabilir portları render et
function renderAvailablePorts(availablePorts) {
    const container = document.getElementById('available-ports-list');
    container.innerHTML = '';
    
    if (availablePorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılabilir port yok</span></div></div>';
        return;
    }
    
    availablePorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item available';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port}</span>
                <span class="port-user">Kullanılabilir</span>
            </div>
            <div class="port-actions">
                <button class="btn-assign" onclick="assignPortToUser(${port})">Ata</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Port kullanıcılarını yükle
async function loadPortUsers() {
    try {
        const response = await apiFetch('/api/admin/users');
        const users = await response.json();
        
        const select = document.getElementById('port-user-select');
        select.innerHTML = '<option value="">Kullanıcı seçin...</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (${user.name || 'İsimsiz'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Kullanıcı listesi yüklenemedi:', error);
    }
}

// Port event listener'ları
function setupPortEventListeners() {
    // Port ata butonu
    document.getElementById('assign-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        const port = document.getElementById('port-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch('/api/admin/ports/assign', {
                method: 'POST',
                body: JSON.stringify({ userId, port: port || null })
            });
            
            const data = await response.json();
            if (data.success) {
                alert(`Port ${data.port} başarıyla atandı`);
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port atanamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port atama hatası:', error);
            alert('Port atanamadı');
        }
    });
    
    // Port serbest bırak butonu
    document.getElementById('release-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch(`/api/admin/ports/${userId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Port başarıyla serbest bırakıldı');
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port serbest bırakılamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port serbest bırakma hatası:', error);
            alert('Port serbest bırakılamadı');
        }
    });
    
    // Yenile butonu
    document.getElementById('refresh-ports').addEventListener('click', () => {
        loadPorts();
        loadPortUsers();
    });
    
    // Kullanıcı seçimi değiştiğinde port seçeneklerini güncelle
    document.getElementById('port-user-select').addEventListener('change', (e) => {
        updatePortSelectOptions(e.target.value);
    });
}

// Port seçeneklerini güncelle
async function updatePortSelectOptions(userId) {
    const portSelect = document.getElementById('port-select');
    portSelect.innerHTML = '<option value="">Port seçin...</option>';
    
    if (!userId) return;
    
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        data.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = `Port ${port}`;
            portSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Port seçenekleri yüklenemedi:', error);
    }
}

// Kullanıcı portunu serbest bırak
async function releaseUserPort(userId) {
    if (!confirm('Bu kullanıcının portunu serbest bırakmak istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/ports/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Port başarıyla serbest bırakıldı');
            loadPorts();
        } else {
            alert('Port serbest bırakılamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port serbest bırakma hatası:', error);
        alert('Port serbest bırakılamadı');
    }
}

// Portu kullanıcıya ata
async function assignPortToUser(port) {
    const userId = document.getElementById('port-user-select').value;
    
    if (!userId) {
        alert('Lütfen kullanıcı seçin');
        return;
    }
    
    try {
        const response = await apiFetch('/api/admin/ports/assign', {
            method: 'POST',
            body: JSON.stringify({ userId, port })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(`Port ${port} başarıyla atandı`);
            loadPorts();
        } else {
            alert('Port atanamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port atama hatası:', error);
        alert('Port atanamadı');
    }
}


// ==================== AUTH / USER ACTIONS ====================
async function logout() {
    try {
        const r = await apiFetch('/api/logout', { method: 'POST' });
        // Başarılı/başarısız fark etmeksizin login'e yönlendir
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function deleteUser(userId) {
    try {
        if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('Kullanıcı silindi', 'success');
            loadUsers();
        } else {
            const er = await r.json().catch(() => ({}));
            showToast(er.error || 'Kullanıcı silinemedi', 'error');
        }
    } catch (e) {
        console.error('deleteUser error:', e);
        showToast('Kullanıcı silinemedi', 'error');
    }
}

// ==================== DEVICE CONFIG MANAGEMENT ====================

let selectedDeviceId = null;
let deviceConfigs = {};

// Device config sekmesi yüklendiğinde
function initDeviceConfigs() {
    console.log('🔧 initDeviceConfigs çağrıldı');
    loadDevicesForConfig();
    setupDeviceConfigEventListeners();
}

// Cihaz seçici için cihazları yükle
async function loadDevicesForConfig() {
    try {
        const response = await apiFetch('/api/admin/devices');
        const devices = await response.json();
        
        const deviceSelector = document.getElementById('device-selector');
        deviceSelector.innerHTML = '<option value="">Cihaz Seçin</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = `${device.device_name} (${device.device_id})`;
            deviceSelector.appendChild(option);
        });
        
        // Cihaz seçimi değiştiğinde
        deviceSelector.addEventListener('change', function() {
            selectedDeviceId = this.value;
            if (selectedDeviceId) {
                loadDeviceStatus();
                loadWolProfiles();
                loadConfigHistory();
            } else {
                clearDeviceConfigUI();
            }
        });
        
    } catch (error) {
        console.error('Cihazlar yüklenemedi:', error);
        showToast('Cihazlar yüklenemedi', 'error');
    }
}

// Event listeners kurulumu
function setupDeviceConfigEventListeners() {
    // DHCP checkbox değiştiğinde
    document.getElementById('use-dhcp').addEventListener('change', function() {
        const staticIpGroup = document.getElementById('static-ip-group');
        staticIpGroup.style.display = this.checked ? 'none' : 'block';
    });
}

// Cihaz durumunu yükle
async function loadDeviceStatus() {
    console.log('🔧 loadDeviceStatus çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) return;
    
    try {
        console.log('🔧 API çağrısı yapılıyor:', `/api/devices/${selectedDeviceId}/status`);
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/status`);
        const data = await response.json();
        console.log('🔧 API yanıtı:', data);
        
        if (data.success) {
            const device = data.device;
            console.log('🔧 Cihaz bilgileri:', device);
            
            // Durum güncelle
            const statusElement = document.getElementById('device-online-status');
            console.log('🔧 Status element:', statusElement);
            if (statusElement) {
                statusElement.textContent = device.is_online ? 'Online' : 'Offline';
                statusElement.className = `status-value ${device.is_online ? 'online' : 'offline'}`;
                console.log('🔧 Status güncellendi:', device.is_online ? 'Online' : 'Offline');
            }
            
            // Diğer bilgiler
            const lastSeenElement = document.getElementById('device-last-seen');
            const firmwareElement = document.getElementById('device-firmware');
            const queueCountElement = document.getElementById('device-queue-count');
            
            if (lastSeenElement) {
                lastSeenElement.textContent = device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : '-';
            }
            if (firmwareElement) {
                firmwareElement.textContent = device.firmware || '-';
            }
            if (queueCountElement) {
                queueCountElement.textContent = device.queue_count || '0';
            }
            
        } else {
            console.error('❌ API başarısız:', data);
            showToast('Cihaz durumu alınamadı', 'error');
        }
    } catch (error) {
        console.error('❌ Cihaz durumu yüklenemedi:', error);
        showToast('Cihaz durumu yüklenemedi', 'error');
    }
}

// WiFi konfigürasyonu gönder
async function sendWifiConfig() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    const useDhcp = document.getElementById('use-dhcp').checked;
    const staticIp = document.getElementById('static-ip').value;
    
    if (!ssid || !password) {
        showToast('SSID ve şifre gerekli', 'warning');
        return;
    }
    
    const config = {
        wifi_ssid: ssid,
        wifi_pass: password,
        use_dhcp: useDhcp,
        static_ip: useDhcp ? null : staticIp
    };
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.sent ? 'success' : 'info');
            loadConfigHistory(); // Geçmişi yenile
        } else {
            showToast('Konfigürasyon gönderilemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WiFi config gönderme hatası:', error);
        showToast('Konfigürasyon gönderilemedi', 'error');
    }
}

// WOL profillerini yükle
async function loadWolProfiles() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        
        if (data.success) {
            const profilesList = document.getElementById('wol-profiles-list');
            profilesList.innerHTML = '';
            
            data.profiles.forEach(profile => {
                const profileItem = document.createElement('div');
                profileItem.className = 'wol-profile-item';
                profileItem.innerHTML = `
                    <div class="wol-profile-info">
                        <div class="wol-profile-name">${profile.name}</div>
                        <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
                    </div>
                    <div class="wol-profile-actions">
                        <button class="btn-small" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteWolProfile(${profile.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                profilesList.appendChild(profileItem);
            });
        }
    } catch (error) {
        console.error('WOL profilleri yüklenemedi:', error);
    }
}

// WOL profili ekleme modalını göster
function showAddWolProfileModal() {
    console.log('🔧 showAddWolProfileModal çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const modal = document.getElementById('add-wol-profile-modal');
    console.log('🔧 Modal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        console.log('🔧 Modal gösterildi');
    } else {
        console.error('❌ Modal bulunamadı!');
    }
}

// WOL profili ekleme modalını kapat
function closeAddWolProfileModal() {
    const modal = document.getElementById('add-wol-profile-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-wol-profile-form');
    if (form) {
        form.reset();
    }
}

// WOL profili ekle
async function addWolProfile() {
    const name = document.getElementById('wol-profile-name').value;
    const mac = document.getElementById('wol-profile-mac').value;
    const broadcast = document.getElementById('wol-profile-broadcast').value;
    const port = document.getElementById('wol-profile-port').value;
    
    if (!name || !mac || !broadcast) {
        showToast('Tüm alanlar gerekli', 'warning');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`, {
            method: 'POST',
            body: JSON.stringify({ name, mac, broadcast_ip: broadcast, port: parseInt(port) })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili eklendi', 'success');
            closeAddWolProfileModal();
            loadWolProfiles();
        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
        } else {
            showToast('WOL profili eklenemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili ekleme hatası:', error);
        showToast('WOL profili eklenemedi', 'error');
    }
}

// WOL profillerini cihaza senkronize et
async function syncWolProfilesToDevice() {
    if (!selectedDeviceId) return;
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        if (!data.success) {
            showToast('WOL profilleri alınamadı', 'error');
            return;
        }
        const profiles = data.profiles.map(p => ({
            name: p.name,
            mac: p.mac,
            broadcast_ip: p.broadcast_ip,
            port: p.port || 9,
            ip: p.ip_address || '0.0.0.0'
        }));

        const payload = {
            wol_profiles: profiles
        };

        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config: payload })
        });
        const resj = await resp.json();
        if (resp.ok && resj.success) {
            showToast('WOL profilleri cihaza gönderildi', 'success');
        } else {
            showToast('WOL profilleri gönderilemedi', 'error');
        }
    } catch (e) {
        console.error('syncWolProfilesToDevice error:', e);
        showToast('Senkronizasyon hatası', 'error');
    }
}

// WOL profili sil
async function deleteWolProfile(profileId) {
    if (!confirm('Bu WOL profilini silmek istediğinizden emin misiniz?')) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili silindi', 'success');
            loadWolProfiles();
        } else {
            showToast('WOL profili silinemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili silme hatası:', error);
        showToast('WOL profili silinemedi', 'error');
    }
}

// Konfigürasyon geçmişini yükle
async function loadConfigHistory() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/history?limit=20`);
        const data = await response.json();
        
        if (data.success) {
            const historyContainer = document.getElementById('config-history');
            historyContainer.innerHTML = '';
            
            data.history.forEach(entry => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <div class="history-action ${entry.action}">${getActionText(entry.action)}</div>
                        <div class="history-details">${entry.username || 'Sistem'} - ${entry.error_message || 'Başarılı'}</div>
                    </div>
                    <div class="history-timestamp">${new Date(entry.created_at).toLocaleString('tr-TR')}</div>
                `;
                historyContainer.appendChild(historyItem);
            });
        }
    } catch (error) {
        console.error('Konfigürasyon geçmişi yüklenemedi:', error);
    }
}

// Action text'i döndür
function getActionText(action) {
    const actions = {
        'sent': 'Gönderildi',
        'applied': 'Uygulandı',
        'failed': 'Başarısız',
        'queued': 'Kuyruğa Eklendi'
    };
    return actions[action] || action;
}

// Cihaz durumunu yenile
async function refreshDeviceStatus() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    await loadDeviceStatus();
    showToast('Durum yenilendi', 'success');
}

// Device config UI'sını temizle
function clearDeviceConfigUI() {
    document.getElementById('device-online-status').textContent = 'Offline';
    document.getElementById('device-online-status').className = 'status-value offline';
    document.getElementById('device-last-seen').textContent = '-';
    document.getElementById('device-firmware').textContent = '-';
    document.getElementById('device-queue-count').textContent = '0';
    document.getElementById('wol-profiles-list').innerHTML = '';
    document.getElementById('config-history').innerHTML = '';
    document.getElementById('wifi-config-form').reset();
}

// ==================== USER-DEVICE ASSIGNMENT ====================
async function populateDeviceAssignment(user){
  try {
    const r = await apiFetch('/api/admin/devices');
    if (!r.ok) return;
    const devices = await r.json();
    const select = document.getElementById('assign-device-select');
    if (select) {
      select.innerHTML = '<option value="">Cihaz seçin...</option>';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = `${d.device_name} (${d.device_id})`;
        select.appendChild(opt);
      });
    }

    const assignedWrap = document.getElementById('assigned-devices');
    if (assignedWrap) {
      assignedWrap.innerHTML = '';
      const owned = devices.filter(d => String(d.owner_name||'').toLowerCase() === String(user.username).toLowerCase() || String(d.owner_id||'') === String(user.id));
      if (!owned.length) {
        assignedWrap.innerHTML = '<div style="opacity:.75;">Bu kullanıcıya atanmış cihaz yok</div>';
      } else {
        owned.forEach(d => {
          const chip = document.createElement('div');
          chip.style.display='inline-flex';
          chip.style.alignItems='center';
          chip.style.gap='.5rem';
          chip.style.padding='.25rem .5rem';
          chip.style.border='1px solid #3b3b3b';
          chip.style.borderRadius='12px';
          chip.style.marginRight='.5rem';
          chip.style.marginBottom='.5rem';
          chip.innerHTML = `<span>${d.device_name} (${d.device_id})</span><button type="button" class="btn-small" data-unassign="${d.device_id}">Kaldır</button>`;
          assignedWrap.appendChild(chip);
        });
        assignedWrap.querySelectorAll('[data-unassign]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const deviceId = e.currentTarget.getAttribute('data-unassign');
            await assignDeviceToUser(deviceId, null);
            await populateDeviceAssignment(user);
            showToast('Cihaz kullanıcıdan kaldırıldı','success');
          });
        });
      }
    }

    const assignBtn = document.getElementById('assign-device-btn');
    assignBtn?.addEventListener('click', async () => {
      const deviceId = select?.value;
      if (!deviceId) { showToast('Önce bir cihaz seçin','error'); return; }
      await assignDeviceToUser(deviceId, user.username);
      showToast('Cihaz kullanıcıya atandı','success');
      await populateDeviceAssignment(user);
    });
  } catch (e) { console.error('populateDeviceAssignment error:', e); }
}

async function assignDeviceToUser(deviceId, username){
  // Sunucu undefined/null alanları boş bırakmalı; sadece owner alanını gönderelim
  const payload = {};
  if (typeof username === 'string' && username.length) payload.owner = username;
  else payload.owner = '';
  const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
  return r.ok;
}


```

- 405 ve HTML dönen hata: admin’de kullanıcı güncelleme, tarayıcı `fetch('/api/...')` ile ana domen/port’a gidiyordu. Bunu `apiFetch` ile `https://fatihdev.xyz:5130` üstünden gönderecek şekilde düzelttim; ayrıca JSON parse hatasını önlemek için response.ok kontrolü ve güvenli parse ekledim.
- 500 hata (cihaz atama): `assignDeviceToUser` artık sadece gerekli alanı gönderiyor. `owner` dışındaki undefined/null alanlar kaldırıldı. Böylece DB update sırasında beklenmeyen alanlar gitmeyecek.

Ne yapıldı
- `public/scripts/admin.js`:
  - Kullanıcı güncelleme request’i `apiFetch(..., { method:'PUT', body: JSON.stringify(formData) })` ile (port 5130) ve güvenli response parse.
  - `assignDeviceToUser`: yalnızca `owner` alanı gönderiliyor; boş kaldırma için `owner:''` kullanılıyor.

Tekrar dener misin?
- Kullanıcı düzenle modalında “Güncelle” → 405 ve HTML parse hatası kalkmalı.
- Kullanıcıya cihaz ata/kaldır → 500 yerine başarılı dönmeli.

---

**User**

adminde kullanici duzenle modali hic calismiyor. kullanici adi degistirme, ad soyad degistirme falan.

wol eklemeye calisinca da boyle oluyor.

admin.js?v=1:19  PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 (Internal Server Error)
apiFetch @ admin.js?v=1:19
assignDeviceToUser @ admin.js?v=1:1299
(anonymous) @ admin.js?v=1:1287Understand this error
admin.js?v=1:21 API error: PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 Internal Server Error
apiFetch @ admin.js?v=1:21
await in apiFetch
assignDeviceToUser @ admin.js?v=1:1299
(anonymous) @ admin.js?v=1:1287Understand this warning
admin.js?v=1:19  PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 (Internal Server Error)
apiFetch @ admin.js?v=1:19
assignDeviceToUser @ admin.js?v=1:1299
(anonymous) @ admin.js?v=1:1287Understand this error
admin.js?v=1:21 API error: PUT https://fatihdev.xyz:5130/api/admin/devices/esp32_fatih 500 Internal Server Error

---

**Cursor**

Cihaz atama ve kullanıcı düzenleme hatalarını saptamak için sunucu tarafındaki ilgili endpoint ve DB fonksiyonlarını inceleyip, istemciden gönderilen payload ile beklenen alanların uyumunu kontrol ediyorum. Özellikle `deviceDB.updateByDeviceId`, `userDB.updateUser`, ve yol/port yönlendirmelerini arayacağım.

```javascript
*** Begin Patch
*** Update File: c:\Users\b350\Desktop\ESP32HOME_backup\espfrontend\server.js
@@
-app.put('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
+app.put('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
   const admin = await userDB.getUserById(req.userId);
   if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
-  const { device_name, ip_address, mac_address, location, description, is_active } = req.body;
-  let { owner_id, owner } = req.body;
-  if (!owner_id && owner) { const u = await userDB.getUserByUsername(owner); owner_id = u ? u.id : null; }
-  await deviceDB.updateByDeviceId(req.params.deviceId, { device_name, ip_address, mac_address, location, description, owner_id: owner_id||null, is_active: typeof is_active==='boolean'? is_active: 1 });
-  res.json({ success:true });
+  const { device_name, ip_address, mac_address, location, description, is_active } = req.body;
+  let { owner_id, owner } = req.body;
+
+  // Owner eşlemesi: owner string boşsa owner_id=null olarak temizle; doluysa kullanıcıya çevir
+  let ownerIdToSet;
+  if (typeof owner === 'string') {
+    if (owner.trim().length === 0) {
+      ownerIdToSet = null; // sahipsiz yap
+    } else {
+      const u = await userDB.getUserByUsername(owner);
+      ownerIdToSet = u ? u.id : null;
+    }
+  } else if (owner_id !== undefined) {
+    ownerIdToSet = owner_id; // doğrudan id gönderilmişse kullan
+  }
+
+  // Sadece tanımlı alanları güncelle
+  const update = {};
+  if (device_name !== undefined) update.device_name = device_name;
+  if (ip_address !== undefined) update.ip_address = ip_address;
+  if (mac_address !== undefined) update.mac_address = mac_address;
+  if (location !== undefined) update.location = location;
+  if (description !== undefined) update.description = description;
+  if (ownerIdToSet !== undefined) update.owner_id = ownerIdToSet;
+  if (typeof is_active === 'boolean') update.is_active = is_active; // yalnızca boolean gelirse güncelle
+
+  try {
+    await deviceDB.updateByDeviceId(req.params.deviceId, update);
+    res.json({ success:true });
+  } catch (e) {
+    console.error('Device update error:', e);
+    res.status(500).json({ error:'Cihaz güncellenemedi' });
+  }
 });
@@
-app.put('/api/admin/users/:userId', requireAuth, async (req, res) => {
-  const admin = await userDB.getUserById(req.userId);
-  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
-  const { full_name, email, role, is_active } = req.body;
-  await userDB.updateUser(req.params.userId, { name: full_name, email, role, is_active });
-  res.json({ success:true });
-});
+app.put('/api/admin/users/:userId', requireAuth, async (req, res) => {
+  const admin = await userDB.getUserById(req.userId);
+  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
+  const { username, full_name, name, email, role, is_active } = req.body;
+  const update = {};
+  if (typeof username === 'string' && username.trim().length) update.username = username.trim();
+  const displayName = (typeof full_name === 'string' && full_name.trim().length) ? full_name.trim() : ((typeof name === 'string' && name.trim().length) ? name.trim() : undefined);
+  if (displayName !== undefined) update.name = displayName;
+  if (email !== undefined) update.email = email;
+  if (role !== undefined) update.role = role;
+  if (typeof is_active === 'boolean') update.is_active = is_active;
+  try {
+    await userDB.updateUser(req.params.userId, update);
+    res.json({ success:true });
+  } catch (e) {
+    console.error('User update error:', e);
+    res.status(500).json({ success:false, error:'Kullanıcı güncellenemedi' });
+  }
+});
*** End Patch
```

```javascript
const http = require("http");
const https = require("https");
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');
const { initDatabase, userDB, deviceDB, sessionDB, securityKeyDB, layoutDB, portDB, deviceConfigDB, configQueueDB, wolProfilesDB, deviceTokensDB, configHistoryDB } = require('./database');

const app = express();

// CORS ve parsers - credentials için özel ayarlar
app.use(cors({
  origin: ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express.json());
app.use(cookieParser());

// HTTPS redirect (production için)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Aktif session'lar (memory cache)
const activeSessions = new Map();

// WebSocket session tracking - device_id -> { ws, lastSeen, deviceInfo }
const wsSessions = new Map();

// Rate limiting için
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 dakika
const RATE_LIMIT_MAX_REQUESTS = 10; // Dakikada maksimum 10 istek

// Güvenlik anahtarı
function generateSecurityKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Device token yönetimi
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortLivedToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Rate limiting kontrolü
function checkRateLimit(identifier) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, []);
  }
  
  const requests = rateLimitMap.get(identifier);
  // Eski istekleri temizle
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  rateLimitMap.set(identifier, validRequests);
  
  if (validRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  validRequests.push(now);
  return true;
}

async function createUserSecurityKey(userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return null;
  const key = generateSecurityKey();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await securityKeyDB.clearUserKeys(user.id);
  await securityKeyDB.createKey(user.id, key, expiresAt);
  return key;
}

async function validateSecurityKey(userIdOrUsername, key) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return false;
  const row = await securityKeyDB.validateKey(user.id, key);
  return !!row;
}

// Session
async function createSession(userId, rememberMe = false) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = rememberMe ? new Date(Date.now() + 30*24*60*60*1000) : new Date(Date.now() + 7*24*60*60*1000);
  await sessionDB.createSession(sessionId, userId, expires, rememberMe);
  activeSessions.set(sessionId, { userId, expires });
  return { sessionId, expires };
}

async function validateSession(sessionId) {
  if (!sessionId) return null;
  const m = activeSessions.get(sessionId);
  if (m && new Date() < m.expires) return m.userId;
  const dbRow = await sessionDB.getSession(sessionId);
  if (dbRow) {
    activeSessions.set(sessionId, { userId: dbRow.user_id, expires: new Date(dbRow.expires_at) });
    return dbRow.user_id;
  }
  return null;
}

async function requireAuth(req, res, next) {
  console.log('🔐 requireAuth çağrıldı - URL:', req.url);
  console.log('🔐 Request headers:', req.headers);
  console.log('🔐 Request cookies:', req.cookies);
  const sid = req.cookies.sessionId;
  console.log('🍪 Session ID from cookie:', sid ? sid.substring(0, 10) + '...' : 'YOK');
  const uid = await validateSession(sid);
  console.log('🔐 Validated user ID:', uid);
  if (!uid) {
    console.log('❌ Session geçersiz, 401 döndürülüyor');
    return res.status(401).json({ error: 'Session geçersiz', redirect: '/login' });
  }
  req.userId = uid;
  console.log('✅ Auth başarılı, userId:', uid);
  next();
}

// Sayfalar
app.get('/login', async (req, res) => {
  const sid = req.cookies.sessionId;
  const uid = await validateSession(sid);
  if (uid) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Statik dosyalar
app.use(express.static("public"));

// API endpoint'leri için özel CORS ayarları
app.use('/api', (req, res, next) => {
  // CORS headers - credentials için wildcard kullanma
  const origin = req.headers.origin;
  const allowedOrigins = ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'];
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Test endpoint'i
app.get('/api/test', (req, res) => {
  console.log('🧪 Test API çağrıldı');
  res.json({ message: 'API çalışıyor!', timestamp: new Date().toISOString() });
});

// Basit user endpoint'i (auth olmadan)
app.get('/api/user-simple', (req, res) => {
  console.log('👤 User-simple API çağrıldı');
  res.json({ username: 'test', name: 'Test User', role: 'user' });
});

// API: Auth
app.post('/api/login', async (req, res) => {
  console.log('🔐 Login API çağrıldı:', req.body);
  try {
    const { username, password, rememberMe } = req.body;
    const user = await userDB.authenticate(username, password);
    if (!user) return res.status(401).json({ success:false, message:'Kullanıcı adı veya şifre hatalı!' });
    const sessionData = await createSession(user.id, !!rememberMe);
    console.log('🔐 Session oluşturuldu:', sessionData);
    
    const key = await createUserSecurityKey(user.username);
    console.log('🔐 Security key oluşturuldu:', key.substring(0, 8) + '...');
    
    const cookieOptions = { 
      httpOnly: true, 
      sameSite: 'lax', // Same-site için daha esnek
      path: '/' // Tüm path'lerde geçerli
    };
    if (rememberMe) cookieOptions.maxAge = 30*24*60*60*1000;
    
    res.cookie('sessionId', sessionData.sessionId, cookieOptions);
    console.log('🍪 Cookie ayarlandı:', sessionData.sessionId);
    console.log('🍪 Cookie options:', cookieOptions);
    
    res.json({ 
      success: true, 
      user: { username: user.username, name: user.name, role: user.role },
      sessionId: sessionData.sessionId // Debug için session ID'yi de döndür
    });
    console.log('✅ Login response gönderildi');
    console.log('🍪 Response headers:', res.getHeaders());
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success:false, message:'Sunucu hatası!' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const sid = req.cookies.sessionId;
    if (sid) await sessionDB.deleteSession(sid);
    activeSessions.delete(sid);
    res.clearCookie('sessionId');
    res.json({ success:true });
  } catch (e) {
    res.clearCookie('sessionId');
    res.json({ success:true });
  }
});

app.get('/api/user', requireAuth, async (req, res) => {
  console.log('👤 User API çağrıldı, userId:', req.userId);
  console.log('👤 User API request headers:', req.headers);
  const u = await userDB.getUserById(req.userId);
  console.log('👤 User data from DB:', u);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ username:u.username, name:u.name, role:u.role });
  console.log('👤 User response gönderildi');
});

app.get('/api/security-key', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u) return res.status(404).json({ success:false, message:'Kullanıcı bulunamadı' });
  const key = await createUserSecurityKey(u.username);
  res.json({ success:true, securityKey:key });
});

app.get('/api/devices', requireAuth, async (req, res) => {
  console.log('📱 Devices API çağrıldı, userId:', req.userId);
  try {
    const devices = await deviceDB.getDevicesByOwner(req.userId);
    console.log('📱 Devices from DB:', devices);
    res.json(devices);
  } catch (error) {
    console.error('❌ Devices API error:', error);
    res.status(500).json({ error: 'Cihazlar yüklenemedi' });
  }
});

// Admin sayfası
app.get('/admin', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin: Users
app.get('/api/admin/users', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const list = await userDB.getAllUsers();
  // map to expected fields
  const mapped = list.map(x => ({ id:x.id, username:x.username, full_name:x.name, email:x.email, role:x.role, is_active:x.is_active, created_at:x.created_at }));
  res.json(mapped);
});

app.get('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const u = await userDB.getUserById(req.params.userId);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ id:u.id, username:u.username, full_name:u.name, email:u.email||'', role:u.role, is_active:u.is_active, created_at:u.created_at });
});

app.post('/api/admin/users', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, email, password, role } = req.body;
  const created = await userDB.createUser({ username, password, name: full_name, email, role: role||'user' });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, name, email, role, is_active } = req.body;
  const update = {};
  if (typeof username === 'string' && username.trim().length) update.username = username.trim();
  const displayName = (typeof full_name === 'string' && full_name.trim().length) ? full_name.trim() : ((typeof name === 'string' && name.trim().length) ? name.trim() : undefined);
  if (displayName !== undefined) update.name = displayName;
  if (email !== undefined) update.email = email;
  if (role !== undefined) update.role = role;
  if (typeof is_active === 'boolean') update.is_active = is_active;
  try {
    await userDB.updateUser(req.params.userId, update);
    res.json({ success:true });
  } catch (e) {
    console.error('User update error:', e);
    res.status(500).json({ success:false, error:'Kullanıcı güncellenemedi' });
  }
});

app.delete('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  if (String(req.params.userId) === String(req.userId)) return res.status(400).json({ error:'Kendi hesabınızı silemezsiniz!' });
  await userDB.deleteUser(req.params.userId);
  res.json({ success:true });
});

// Admin: Devices (DB tabanlı)
app.get('/api/admin/devices', requireAuth, async (req, res) => {
  console.log('GET /api/admin/devices çağrıldı');
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') {
    console.log('Admin erişimi reddedildi');
    return res.status(403).json({ error:'Admin erişimi gerekli!' });
  }
  console.log('Admin kullanıcı doğrulandı:', admin.username);
  try {
    const rows = await deviceDB.getAllDevices();
    console.log('Database\'den cihazlar alındı:', rows.length, 'cihaz');
    const mapped = rows.map(d => ({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_name:d.owner_name||'Sahipsiz', owner_id:d.owner_id||null, location:d.location||'Belirtilmemiş', description:d.description||'Açıklama yok' }));
    console.log('Mapped devices:', mapped);
    res.json(mapped);
  } catch (error) {
    console.error('Cihazlar alınırken hata:', error);
    res.status(500).json({ error:'Cihazlar alınamadı' });
  }
});

app.get('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const d = await deviceDB.getByDeviceId(req.params.deviceId);
  if (!d) return res.status(404).json({ error:'Cihaz bulunamadı!' });
  res.json({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_id:d.owner_id||'', owner_name:d.owner_name||'', location:d.location||'', description:d.description||'' });
});

app.post('/api/admin/devices', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_id, device_name, ip_address, mac_address, location, description } = req.body;
  let { owner_id, owner } = req.body;
  if (!device_id || !device_name) return res.status(400).json({ error:'Cihaz ID ve adı gerekli!' });
  if (!owner_id && owner) { const u = await userDB.getUserByUsername(owner); owner_id = u ? u.id : null; }
  const created = await deviceDB.createDevice({ device_id, device_name, ip_address, mac_address, location, description, owner_id: owner_id||null });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_name, ip_address, mac_address, location, description, is_active } = req.body;
  let { owner_id, owner } = req.body;
  if (!owner_id && owner) { const u = await userDB.getUserByUsername(owner); owner_id = u ? u.id : null; }
  await deviceDB.updateByDeviceId(req.params.deviceId, { device_name, ip_address, mac_address, location, description, owner_id: owner_id||null, is_active: typeof is_active==='boolean'? is_active: 1 });
  res.json({ success:true });
});

app.delete('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  await deviceDB.deleteByDeviceId(req.params.deviceId);
  res.json({ success:true });
});

// Kullanıcı layout API'leri
app.get('/api/admin/user-layouts', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const rows = await layoutDB.getAll();
  res.json(rows);
});

app.post('/api/admin/user-layouts/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const target = await userDB.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  const layout = req.body?.layout; if (!layout || typeof layout !== 'object') return res.status(400).json({ error:'Geçersiz layout verisi' });
  await layoutDB.setForUser(target.id, JSON.stringify(layout));
  res.json({ success:true });
});

app.get('/api/user/layout', requireAuth, async (req, res) => {
  const json = await layoutDB.getForUser(req.userId);
  res.json({ layout: json ? JSON.parse(json) : null });
});

// ==================== PORT YÖNETİMİ API'LERİ ====================

// Kullanılan portları listele
app.get('/api/admin/ports', requireAuth, async (req, res) => {
  try {
    const usedPorts = await portDB.getUsedPorts();
    const availablePorts = [];
    
    // Kullanılabilir portları bul - sadece izin verilen portlar
    for (const port of portDB.ALLOWED_PORTS) {
      if (!usedPorts.some(p => p.websocket_port === port)) {
        availablePorts.push(port);
      }
    }
    
    res.json({
      usedPorts: usedPorts.map(p => ({
        userId: p.id,
        username: p.username,
        port: p.websocket_port
      })),
      availablePorts
    });
  } catch (error) {
    console.error('Port listesi hatası:', error);
    res.status(500).json({ error: 'Port listesi alınamadı' });
  }
});

// Kullanıcıya port ata
app.post('/api/admin/ports/assign', requireAuth, async (req, res) => {
  try {
    const { userId, port } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Kullanıcı ID gerekli' });
    }
    
    // Port belirtilmişse kontrol et
    if (port) {
      // Port izin verilen portlardan mı kontrol et
      if (!portDB.ALLOWED_PORTS.includes(port)) {
        return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
      }
      
      const usedPorts = await portDB.getUsedPorts();
      if (usedPorts.some(p => p.websocket_port === port)) {
        return res.status(400).json({ error: 'Port zaten kullanımda' });
      }
      
      // Manuel port atama
      await userDB.updateUser(userId, { websocket_port: port });
      res.json({ success: true, port });
    } else {
      // Otomatik port atama
      const assignedPort = await portDB.assignPort(userId);
      res.json({ success: true, port: assignedPort });
    }
  } catch (error) {
    console.error('Port atama hatası:', error);
    res.status(500).json({ error: 'Port atanamadı' });
  }
});

// Kullanıcının portunu serbest bırak
app.delete('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await userDB.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    if (user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Port serbest bırakma hatası:', error);
    res.status(500).json({ error: 'Port serbest bırakılamadı' });
  }
});

// Kullanıcının portunu değiştir
app.put('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { port } = req.body;
    
    if (!port) {
      return res.status(400).json({ error: 'Port gerekli' });
    }
    
    // Port izin verilen portlardan mı kontrol et
    if (!portDB.ALLOWED_PORTS.includes(port)) {
      return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
    }
    
    // Port kullanımda mı kontrol et
    const usedPorts = await portDB.getUsedPorts();
    if (usedPorts.some(p => p.websocket_port === port && p.id != userId)) {
      return res.status(400).json({ error: 'Port zaten kullanımda' });
    }
    
    // Eski portu serbest bırak
    const user = await userDB.getUserById(userId);
    if (user && user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    // Yeni portu ata
    await userDB.updateUser(userId, { websocket_port: port });
    
    res.json({ success: true, port });
  } catch (error) {
    console.error('Port değiştirme hatası:', error);
    res.status(500).json({ error: 'Port değiştirilemedi' });
  }
});

// ==================== DEVICE CONFIG MANAGEMENT API ====================

// Cihaz konfigürasyonu gönder
app.post('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { config } = req.body;
    const userId = req.userId;
    
    // Rate limiting kontrolü
    if (!checkRateLimit(`config_${userId}`)) {
      return res.status(429).json({ error: 'Çok fazla istek, lütfen bekleyin' });
    }
    
    // Cihaz varlığını kontrol et
    const device = await deviceDB.getByDeviceId(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Config validasyonu
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Geçersiz konfigürasyon verisi' });
    }
    
    // Payload oluştur
    const payload = {
      type: 'update_config',
      device_id: deviceId,
      token: generateShortLivedToken(),
      config: config,
      meta: {
        request_id: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      }
    };
    
    // Konfigürasyonu gönder
    const result = await sendConfigToDevice(deviceId, payload, userId);
    
    res.json({
      success: true,
      ...result,
      device_id: deviceId
    });
    
  } catch (error) {
    console.error('Config gönderme hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon gönderilemedi: ' + error.message });
  }
});

// Cihazın mevcut konfigürasyonunu al
app.get('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const config = await deviceConfigDB.getLastConfig(deviceId);
    res.json({
      success: true,
      config: config ? config.config_json : null,
      applied: config ? config.applied : false,
      created_at: config ? config.created_at : null
    });
    
  } catch (error) {
    console.error('Config alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon alınamadı: ' + error.message });
  }
});

// WOL profilleri yönetimi
app.get('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const profiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    res.json({ success: true, profiles });
    
  } catch (error) {
    console.error('WOL profilleri alma hatası:', error);
    res.status(500).json({ error: 'WOL profilleri alınamadı: ' + error.message });
  }
});

app.post('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, mac, broadcast_ip, port } = req.body;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Validasyon
    if (!name || !mac || !broadcast_ip) {
      return res.status(400).json({ error: 'Name, MAC ve broadcast IP gerekli' });
    }
    
    const profile = await wolProfilesDB.addProfile(deviceId, name, mac, broadcast_ip, port || 9);
    res.json({ success: true, profile });
    
  } catch (error) {
    console.error('WOL profili ekleme hatası:', error);
    res.status(500).json({ error: 'WOL profili eklenemedi: ' + error.message });
  }
});

app.delete('/api/devices/:deviceId/wol-profiles/:profileId', requireAuth, async (req, res) => {
  try {
    const { deviceId, profileId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const result = await wolProfilesDB.deleteProfile(profileId);
    res.json({ success: true, deleted: result.deleted });
    
  } catch (error) {
    console.error('WOL profili silme hatası:', error);
    res.status(500).json({ error: 'WOL profili silinemedi: ' + error.message });
  }
});

// Cihaz durumu ve kuyruk bilgisi
app.get('/api/devices/:deviceId/status', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    console.log(`🔧 Device status API çağrıldı - deviceId: ${deviceId}, userId: ${userId}`);
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      console.log(`❌ Yetki yok - deviceId: ${deviceId}, userId: ${userId}`);
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const device = await deviceDB.getByDeviceId(deviceId);
    const isOnline = wsSessions.has(deviceId);
    const session = wsSessions.get(deviceId);
    
    console.log(`🔧 Device: ${device ? device.device_name : 'Bilinmiyor'}, isOnline: ${isOnline}, session:`, session);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Kuyruk durumu
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceQueue = queueMessages.filter(msg => msg.device_id === deviceId);
    
    const response = {
      success: true,
      device: {
        device_id: deviceId,
        device_name: device ? device.device_name : 'Bilinmiyor',
        is_online: isOnline,
        last_seen: session ? new Date(session.lastSeen).toISOString() : null,
        firmware: session ? session.firmware : null,
        capabilities: session ? session.capabilities : [],
        queue_count: deviceQueue.length
      }
    };
    
    console.log(`🔧 Response gönderiliyor:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('Cihaz durumu alma hatası:', error);
    res.status(500).json({ error: 'Cihaz durumu alınamadı: ' + error.message });
  }
});

// Konfigürasyon geçmişi
app.get('/api/devices/:deviceId/history', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const history = await configHistoryDB.getHistoryByDevice(deviceId, limit);
    res.json({ success: true, history });
    
  } catch (error) {
    console.error('Konfigürasyon geçmişi alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon geçmişi alınamadı: ' + error.message });
  }
});

// SSL sertifikalarını yükle
let sslOptions = null;
try {
  sslOptions = {
    key: fs.readFileSync('cert.key'),
    cert: fs.readFileSync('cert.pem')
  };
  console.log('✅ SSL sertifikaları yüklendi');
} catch (err) {
  console.error('❌ SSL sertifikaları yüklenemedi:', err.message);
  console.log('⚠️  HTTP server olarak çalışacak');
}

// HTTPS server ve WS (SSL varsa)
const server = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
const wss = new WebSocket.Server({ server });

// API için ayrı server (default port)
const apiServer = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
let connectedDevices = new Map(); // deviceId -> WebSocket mapping
let lastCommandsByDevice = new Map(); // deviceId -> { cmd:string, ts:number }

// WS: cihaz kayıtları ve güvenli komutlar
function addToHistory(_) {}

async function checkDeviceOwnership(deviceId, userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (user && user.role === 'admin') return { allowed:true };
  const dev = await deviceDB.getByDeviceId(deviceId);
  if (!dev) return { allowed:false, reason:'Cihaz bulunamadı' };
  if (!dev.owner_id) return { allowed:true };
  if (!user) return { allowed:false, reason:'Kullanıcı bulunamadı' };
  return { allowed: dev.owner_id === user.id, reason: dev.owner_id === user.id ? 'OK' : 'Yetki yok' };
}

// Konfigürasyon gönderme fonksiyonu
async function sendConfigToDevice(deviceId, payload, userId = null) {
  try {
    const session = wsSessions.get(deviceId);
    
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Cihaz online - doğrudan gönder
      try {
        session.ws.send(JSON.stringify(payload));
        console.log(`📤 Config gönderildi (online): ${deviceId}`);
        
        // Config'i veritabanına kaydet (applied=false)
        await deviceConfigDB.saveConfig(deviceId, payload.config, 1);
        
        // Geçmişe kaydet
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'sent', payload.config);
        }
        
        return { sent: true, queued: false, message: 'Config cihaza gönderildi' };
      } catch (error) {
        console.error(`❌ Config gönderme hatası (online): ${error.message}`);
        // Hata durumunda kuyruğa ekle
        await configQueueDB.addToQueue(deviceId, payload);
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config, error.message);
        }
        return { sent: false, queued: true, message: 'Cihaz online ama gönderim başarısız, kuyruğa eklendi' };
      }
    } else {
      // Cihaz offline - kuyruğa ekle
      await configQueueDB.addToQueue(deviceId, payload);
      console.log(`📋 Config kuyruğa eklendi (offline): ${deviceId}`);
      
      if (userId) {
        await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config);
      }
      
      return { sent: false, queued: true, message: 'Cihaz offline, kuyruğa eklendi' };
    }
  } catch (error) {
    console.error(`❌ sendConfigToDevice hatası: ${error.message}`);
    if (userId) {
      await configHistoryDB.addHistory(deviceId, userId, 'failed', payload.config, error.message);
    }
    return { sent: false, queued: false, message: 'Hata: ' + error.message };
  }
}

// Device identify handler
async function handleDeviceIdentify(ws, data) {
  try {
    const { device_id, firmware, token, capabilities } = data;
    console.log(`🔧 handleDeviceIdentify çağrıldı - device_id: ${device_id}, token: ${token ? 'var' : 'yok'}`);
    
    if (!device_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'device_id gerekli' }));
      return;
    }
    
    // Token doğrulama
    let isValidToken = false;
    if (token) {
      const tokenData = await deviceTokensDB.validateToken(device_id, token);
      isValidToken = !!tokenData;
    }
    
    if (!isValidToken) {
      // Yeni cihaz veya geçersiz token - pairing token oluştur
      const pairingToken = generateShortLivedToken();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 dakika
      
      await deviceTokensDB.createToken(device_id, pairingToken, 'pairing', expiresAt.getTime());
      
      ws.send(JSON.stringify({
        type: 'pairing_required',
        device_id,
        pairing_token: pairingToken,
        expires_in: 600 // 10 dakika
      }));
      
      console.log(`🔐 Pairing token oluşturuldu: ${device_id} - ${pairingToken}`);
      return;
    }
    
    // Geçerli token - cihazı kaydet/güncelle
    const deviceInfo = {
      device_id,
      firmware: firmware || 'unknown',
      capabilities: capabilities || [],
      lastSeen: Date.now()
    };
    
    wsSessions.set(device_id, { ws, ...deviceInfo });
    ws.deviceId = device_id;
    ws.isDevice = true;
    
    console.log(`✅ Cihaz wsSessions'a eklendi: ${device_id}`);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Cihaz bilgilerini veritabanında güncelle (mevcut değerleri koru)
    const existingDevice = await deviceDB.getByDeviceId(device_id);
    await deviceDB.updateByDeviceId(device_id, {
      device_name: data.device_name || (existingDevice ? existingDevice.device_name : device_id),
      ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : (existingDevice ? existingDevice.ip_address : ''),
      mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : (existingDevice ? existingDevice.mac_address : ''),
      location: existingDevice ? (existingDevice.location || (data.location || 'Otomatik Eklenen')) : (data.location || 'Otomatik Eklenen'),
      description: existingDevice ? (existingDevice.description || (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`)) : (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`),
      owner_id: existingDevice ? existingDevice.owner_id || null : null,
      is_active: 1
    });
    
    // Bekleyen konfigürasyonları gönder
    const pendingConfigs = await deviceConfigDB.getPendingConfigs(device_id);
    for (const config of pendingConfigs) {
      const payload = {
        type: 'update_config',
        device_id,
        token: generateShortLivedToken(),
        config: config.config_json,
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString()
        }
      };
      
      try {
        ws.send(JSON.stringify(payload));
        console.log(`📤 Bekleyen config gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Bekleyen config gönderme hatası: ${error.message}`);
      }
    }
    
    // Kuyruktaki mesajları işle
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceMessages = queueMessages.filter(msg => msg.device_id === device_id);
    
    for (const message of deviceMessages) {
      try {
        ws.send(JSON.stringify(message.payload));
        await configQueueDB.updateMessageStatus(message.id, 'sent');
        console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
        await configQueueDB.updateMessageStatus(message.id, 'failed', error.message);
      }
    }
    
    // Persistent token oluştur
    const persistentToken = generateShortLivedToken();
    const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 gün
    
    await deviceTokensDB.createToken(device_id, persistentToken, 'persistent', tokenExpires.getTime());
    
    ws.send(JSON.stringify({
      type: 'identify_success',
      device_id,
      message: 'Cihaz başarıyla tanımlandı',
      persistent_token: persistentToken
    }));
    
    console.log(`✅ Cihaz tanımlandı: ${device_id} (${firmware}) - Persistent token: ${persistentToken.substring(0, 8)}...`);
    
  } catch (error) {
    console.error(`❌ Device identify hatası: ${error.message}`);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Cihaz tanımlama hatası: ' + error.message
    }));
  }
}

wss.on("connection", (ws) => {
  console.log('🔌 WebSocket client connected');
  console.log('🔌 Current wsSessions:', Array.from(wsSessions.keys()));
  console.log('🔌 Current ESP32 status:', connectedDevices.size > 0 ? `${connectedDevices.size} cihaz bağlı` : 'Cihaz yok');
  ws.on('message', async (msg) => {
    msg = msg.toString();
    try {
      if (msg.startsWith('{')) {
        console.log('🔧 Raw message received:', msg);
        const data = JSON.parse(msg);
        if (data.type === 'userAuth') {
          ws.userId = data.userId; // username
        } else if (data.type === 'identify') {
          // ESP32 cihaz kimlik doğrulama
          console.log('🔧 ESP32 identify mesajı alındı:', data);
          await handleDeviceIdentify(ws, data);
        } else if (data.type === 'config_applied') {
          // ESP32'den config uygulandı onayı
          const { device_id, request_id, status, details } = data;
          if (device_id && status === 'ok') {
            await deviceConfigDB.markConfigApplied(device_id, request_id);
            console.log(`✅ Config uygulandı: ${device_id}`);
            
            // Cihaz IP/MAC bilgilerini güncelle
            if (details && (details.ip || details.mac)) {
              await deviceDB.updateByDeviceId(device_id, {
                ip_address: details.ip || '',
                mac_address: details.mac || ''
              });
            }
          }
        } else if (data.type === 'deviceSelection') {
          // Client seçili cihazı değiştirdi
          ws.selectedDeviceId = data.deviceId;
          console.log(`Client seçili cihazı değiştirdi: ${data.deviceId}`);
        } else if (data.type === 'frontend' && data.request === 'getDeviceRegistry') {
          // Frontend'den cihaz kayıtları isteniyor
          console.log('getDeviceRegistry request from user:', ws.userId);
          try {
            if (!ws.userId) {
              console.log('No userId in WebSocket, sending error');
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı kimliği bulunamadı' }));
              return;
            }
            const user = await userDB.getUserByUsername(ws.userId);
            if (!user) {
              console.log('User not found in database:', ws.userId);
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı bulunamadı' }));
              return;
            }
            
            let devices;
            if (user.role === 'admin') {
              // Admin tüm cihazları görebilir
              devices = await deviceDB.getAllDevices();
            } else {
              // Normal kullanıcı sadece kendi cihazlarını görebilir
              devices = await deviceDB.getDevicesByOwner(user.id);
            }
            
            // Cihazları frontend formatına çevir
            const mappedDevices = devices.map(d => ({
              deviceId: d.device_id,
              deviceName: d.device_name,
              isOnline: connectedDevices.has(d.device_id), // Cihaz bağlı mı kontrolü
              ipAddress: d.ip_address || '',
              macAddress: d.mac_address || '',
              location: d.location || '',
              description: d.description || '',
              ownerName: d.owner_name || 'Sahipsiz'
            }));
            
            ws.send(JSON.stringify({
              type: 'deviceRegistry',
              devices: mappedDevices
            }));
            
            console.log(`Device registry sent to frontend (filtered for user ${user.username})`);
          } catch (error) {
            console.error('Device registry error:', error);
            ws.send(JSON.stringify({ type:'error', message:'Cihaz kayıtları alınamadı' }));
          }
        } else if (data.type === 'heartbeat' && data.deviceId) {
          // ESP32 heartbeat mesajı - ESP32'yi tanımla ve otomatik kaydet
          const deviceId = data.deviceId;
          connectedDevices.set(deviceId, ws);
          // Bu bağlantıyı cihaz olarak işaretle
          ws.isDevice = true;
          ws.deviceId = deviceId;
          console.log(`ESP32 kayıt edildi: ${data.deviceName || deviceId} (ID: ${deviceId})`);
          
          // Cihazı otomatik olarak database'e kaydet/güncelle
          try {
            const existingDevice = await deviceDB.getByDeviceId(data.deviceId);
            if (existingDevice) {
              // Mevcut cihazı güncelle (kalıcı alanları koruyarak)
              await deviceDB.updateByDeviceId(data.deviceId, {
                device_name: data.deviceName || existingDevice.device_name,
                ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : existingDevice.ip_address,
                mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : existingDevice.mac_address,
                location: existingDevice.location || data.location || existingDevice.location,
                description: existingDevice.description || data.description || existingDevice.description,
                owner_id: existingDevice.owner_id,
                is_active: 1
              });
              console.log(`Cihaz güncellendi: ${data.deviceId}`);
            } else {
              // Yeni cihaz oluştur
              await deviceDB.createDevice({
                device_id: data.deviceId,
                device_name: data.deviceName || data.deviceId,
                ip_address: data.ip_address || '',
                mac_address: data.mac_address || '',
                location: data.location || 'Otomatik Eklenen',
                description: data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`,
                owner_id: null
              });
              console.log(`Yeni cihaz eklendi: ${data.deviceId} - ${data.deviceName || data.deviceId}`);
            }
            
            // Admin panelindeki cihaz listesini güncelle
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'deviceUpdated',
                  deviceId: data.deviceId,
                  action: existingDevice ? 'updated' : 'added'
                }));
              }
            });
          } catch (error) {
            console.error('Cihaz kayıt/güncelleme hatası:', error);
          }
          
          // Heartbeat'i tüm client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        } else if (data.type === 'secureCommand') {
          const { userId, securityKey, deviceId, command } = data;
          const valid = await validateSecurityKey(userId, securityKey);
          if (!valid) {
            ws.send(JSON.stringify({ type:'error', message:'Geçersiz güvenlik anahtarı veya süresi dolmuş' }));
            return;
          }
          const own = await checkDeviceOwnership(deviceId, userId);
          if (!own.allowed) {
            ws.send(JSON.stringify({ type:'error', message: own.reason || 'Yetki yok' }));
            return;
          }
          // Aynı komutu kısa süre içinde tekrar göndermeyi engelle (debounce)
          try {
            const now = Date.now();
            const prev = lastCommandsByDevice.get(deviceId);
            const signature = `${deviceId}:${command}`;
            if (prev && prev.cmd === signature && (now - prev.ts) < 400) {
              console.log(`Debounced duplicate command to ${deviceId}: ${command}`);
              return;
            }
            lastCommandsByDevice.set(deviceId, { cmd: signature, ts: now });
          } catch (e) {
            // ignore debounce errors
          }
          // Komutu hedef cihaza ilet
          const targetDevice = connectedDevices.get(deviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            targetDevice.send(command);
            console.log(`Komut gönderildi: ${command} -> ${deviceId}`);
          } else {
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${deviceId}` }));
            console.log(`Cihaz çevrimdışı: ${deviceId}`);
          }
        } else if (ws.isDevice) {
          // ESP32'den gelen diğer JSON mesajları (status, relay, wol vb.) client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        }
      } else {
        // Legacy/düz metin mesajlar: getWolStatus, getRelayStatus vb.
        if (msg.includes('esp32:online') || msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
          // ESP32'den gelen legacy mesajlar
          if (msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msg);
              }
            });
            return;
          }
          return;
        }
        
        // Client -> ESP32 (getWolStatus, getRelayStatus vb.) - sadece seçili cihaza gönder
        if (ws.userId && !ws.isDevice) {
          // Bu bir client mesajı, seçili cihaza gönder
          const selectedDeviceId = ws.selectedDeviceId; // Varsayılan kaldırıldı
          if (!selectedDeviceId) {
            ws.send(JSON.stringify({ type:'error', message:'Önce cihaz seçin' }));
            return;
          }
          const targetDevice = connectedDevices.get(selectedDeviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            // Aynı cihaz bağlantısına geri gönderimi engelle
            if (targetDevice !== ws) {
              targetDevice.send(msg);
            }
            console.log(`Client request forwarded to ESP32 (${selectedDeviceId}): ${msg}`);
          } else {
            console.log(`ESP32 not available for message: ${msg} (target: ${selectedDeviceId})`);
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${selectedDeviceId}` }));
          }
        }
        
        // ESP32 -> Clients
        if (ws.isDevice) {
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
        }
      }
    } catch (e) {
      console.error('WS error:', e);
    }
  });
  ws.on('close', () => {
    // Bağlantı kapanan cihazı listeden çıkar
    for (const [deviceId, deviceWs] of connectedDevices.entries()) {
      if (deviceWs === ws) {
        connectedDevices.delete(deviceId);
        console.log(`ESP32 bağlantısı kapandı: ${deviceId}`);
        break;
      }
    }
    
    // WebSocket session'ı temizle
    if (ws.deviceId) {
      wsSessions.delete(ws.deviceId);
      console.log(`WebSocket session temizlendi: ${ws.deviceId}`);
    }
  });
});

// Ana sayfa route'u
app.get('/', requireAuth, (req, res) => {
  console.log('🏠 Ana sayfa route çağrıldı, userId:', req.userId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Background queue worker
async function startQueueWorker() {
  console.log('🔄 Queue worker başlatılıyor...');
  
  setInterval(async () => {
    try {
      // Bekleyen mesajları al
      const pendingMessages = await configQueueDB.getPendingMessages();
      
      for (const message of pendingMessages) {
        const { id, device_id, payload, retries, max_retries } = message;
        
        // Maksimum deneme sayısını kontrol et
        if (retries >= max_retries) {
          await configQueueDB.updateMessageStatus(id, 'failed', 'Maksimum deneme sayısı aşıldı');
          console.log(`❌ Mesaj başarısız (max retries): ${device_id}`);
          continue;
        }
        
        // Cihaz online mı kontrol et
        const session = wsSessions.get(device_id);
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
          try {
            // Mesajı gönder
            session.ws.send(JSON.stringify(payload));
            await configQueueDB.updateMessageStatus(id, 'sent');
            console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
          } catch (error) {
            console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
            await configQueueDB.updateMessageStatus(id, 'failed', error.message);
          }
        } else {
          // Cihaz hala offline, bir sonraki döngüde tekrar dene
          console.log(`⏳ Cihaz offline, mesaj bekletiliyor: ${device_id}`);
        }
      }
      
      // Başarısız mesajları temizle (24 saatten eski)
      const cleaned = await configQueueDB.cleanupFailedMessages();
      if (cleaned.cleaned > 0) {
        console.log(`🧹 ${cleaned.cleaned} başarısız mesaj temizlendi`);
      }
      
    } catch (error) {
      console.error('❌ Queue worker hatası:', error);
    }
  }, 30000); // 30 saniyede bir çalış
  
  console.log('✅ Queue worker başlatıldı');
}

// Server başlatma
(async () => {
  try {
    await initDatabase();
    console.log('✅ Veritabanı başlatıldı');
    await sessionDB.cleanExpiredSessions();
    console.log('✅ Süresi dolmuş session\'lar temizlendi');
    
    // Queue worker'ı başlat
    await startQueueWorker();
    // WebSocket server (port 5131)
    server.listen(5131, '0.0.0.0', () => {
      const protocol = sslOptions ? 'WSS (HTTPS)' : 'WS (HTTP)';
      console.log(`WebSocket server running on port 5131 - ${protocol}`);
      console.log(`WebSocket URL: ${sslOptions ? 'wss://' : 'ws://'}fatihdev.xyz:5131/`);
    });
    
    // API server (port 5130)
    apiServer.listen(5130, '0.0.0.0', () => {
      const protocol = sslOptions ? 'HTTPS' : 'HTTP';
      console.log(`API server running on port 5130 - ${protocol}`);
      console.log(`API URL: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/`);
      console.log(`Test API: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/test`);
    });
  } catch (e) {
    console.error('❌ Server init error:', e);
    process.exit(1);
  }
})();

```

```javascript
const http = require("http");
const https = require("https");
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');
const { initDatabase, userDB, deviceDB, sessionDB, securityKeyDB, layoutDB, portDB, deviceConfigDB, configQueueDB, wolProfilesDB, deviceTokensDB, configHistoryDB } = require('./database');

const app = express();

// CORS ve parsers - credentials için özel ayarlar
app.use(cors({
  origin: ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express.json());
app.use(cookieParser());

// HTTPS redirect (production için)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Aktif session'lar (memory cache)
const activeSessions = new Map();

// WebSocket session tracking - device_id -> { ws, lastSeen, deviceInfo }
const wsSessions = new Map();

// Rate limiting için
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 dakika
const RATE_LIMIT_MAX_REQUESTS = 10; // Dakikada maksimum 10 istek

// Güvenlik anahtarı
function generateSecurityKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Device token yönetimi
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortLivedToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Rate limiting kontrolü
function checkRateLimit(identifier) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, []);
  }
  
  const requests = rateLimitMap.get(identifier);
  // Eski istekleri temizle
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  rateLimitMap.set(identifier, validRequests);
  
  if (validRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  validRequests.push(now);
  return true;
}

async function createUserSecurityKey(userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return null;
  const key = generateSecurityKey();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await securityKeyDB.clearUserKeys(user.id);
  await securityKeyDB.createKey(user.id, key, expiresAt);
  return key;
}

async function validateSecurityKey(userIdOrUsername, key) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return false;
  const row = await securityKeyDB.validateKey(user.id, key);
  return !!row;
}

// Session
async function createSession(userId, rememberMe = false) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = rememberMe ? new Date(Date.now() + 30*24*60*60*1000) : new Date(Date.now() + 7*24*60*60*1000);
  await sessionDB.createSession(sessionId, userId, expires, rememberMe);
  activeSessions.set(sessionId, { userId, expires });
  return { sessionId, expires };
}

async function validateSession(sessionId) {
  if (!sessionId) return null;
  const m = activeSessions.get(sessionId);
  if (m && new Date() < m.expires) return m.userId;
  const dbRow = await sessionDB.getSession(sessionId);
  if (dbRow) {
    activeSessions.set(sessionId, { userId: dbRow.user_id, expires: new Date(dbRow.expires_at) });
    return dbRow.user_id;
  }
  return null;
}

async function requireAuth(req, res, next) {
  console.log('🔐 requireAuth çağrıldı - URL:', req.url);
  console.log('🔐 Request headers:', req.headers);
  console.log('🔐 Request cookies:', req.cookies);
  const sid = req.cookies.sessionId;
  console.log('🍪 Session ID from cookie:', sid ? sid.substring(0, 10) + '...' : 'YOK');
  const uid = await validateSession(sid);
  console.log('🔐 Validated user ID:', uid);
  if (!uid) {
    console.log('❌ Session geçersiz, 401 döndürülüyor');
    return res.status(401).json({ error: 'Session geçersiz', redirect: '/login' });
  }
  req.userId = uid;
  console.log('✅ Auth başarılı, userId:', uid);
  next();
}

// Sayfalar
app.get('/login', async (req, res) => {
  const sid = req.cookies.sessionId;
  const uid = await validateSession(sid);
  if (uid) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Statik dosyalar
app.use(express.static("public"));

// API endpoint'leri için özel CORS ayarları
app.use('/api', (req, res, next) => {
  // CORS headers - credentials için wildcard kullanma
  const origin = req.headers.origin;
  const allowedOrigins = ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'];
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Test endpoint'i
app.get('/api/test', (req, res) => {
  console.log('🧪 Test API çağrıldı');
  res.json({ message: 'API çalışıyor!', timestamp: new Date().toISOString() });
});

// Basit user endpoint'i (auth olmadan)
app.get('/api/user-simple', (req, res) => {
  console.log('👤 User-simple API çağrıldı');
  res.json({ username: 'test', name: 'Test User', role: 'user' });
});

// API: Auth
app.post('/api/login', async (req, res) => {
  console.log('🔐 Login API çağrıldı:', req.body);
  try {
    const { username, password, rememberMe } = req.body;
    const user = await userDB.authenticate(username, password);
    if (!user) return res.status(401).json({ success:false, message:'Kullanıcı adı veya şifre hatalı!' });
    const sessionData = await createSession(user.id, !!rememberMe);
    console.log('🔐 Session oluşturuldu:', sessionData);
    
    const key = await createUserSecurityKey(user.username);
    console.log('🔐 Security key oluşturuldu:', key.substring(0, 8) + '...');
    
    const cookieOptions = { 
      httpOnly: true, 
      sameSite: 'lax', // Same-site için daha esnek
      path: '/' // Tüm path'lerde geçerli
    };
    if (rememberMe) cookieOptions.maxAge = 30*24*60*60*1000;
    
    res.cookie('sessionId', sessionData.sessionId, cookieOptions);
    console.log('🍪 Cookie ayarlandı:', sessionData.sessionId);
    console.log('🍪 Cookie options:', cookieOptions);
    
    res.json({ 
      success: true, 
      user: { username: user.username, name: user.name, role: user.role },
      sessionId: sessionData.sessionId // Debug için session ID'yi de döndür
    });
    console.log('✅ Login response gönderildi');
    console.log('🍪 Response headers:', res.getHeaders());
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success:false, message:'Sunucu hatası!' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const sid = req.cookies.sessionId;
    if (sid) await sessionDB.deleteSession(sid);
    activeSessions.delete(sid);
    res.clearCookie('sessionId');
    res.json({ success:true });
  } catch (e) {
    res.clearCookie('sessionId');
    res.json({ success:true });
  }
});

app.get('/api/user', requireAuth, async (req, res) => {
  console.log('👤 User API çağrıldı, userId:', req.userId);
  console.log('👤 User API request headers:', req.headers);
  const u = await userDB.getUserById(req.userId);
  console.log('👤 User data from DB:', u);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ username:u.username, name:u.name, role:u.role });
  console.log('👤 User response gönderildi');
});

app.get('/api/security-key', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u) return res.status(404).json({ success:false, message:'Kullanıcı bulunamadı' });
  const key = await createUserSecurityKey(u.username);
  res.json({ success:true, securityKey:key });
});

app.get('/api/devices', requireAuth, async (req, res) => {
  console.log('📱 Devices API çağrıldı, userId:', req.userId);
  try {
    const devices = await deviceDB.getDevicesByOwner(req.userId);
    console.log('📱 Devices from DB:', devices);
    res.json(devices);
  } catch (error) {
    console.error('❌ Devices API error:', error);
    res.status(500).json({ error: 'Cihazlar yüklenemedi' });
  }
});

// Admin sayfası
app.get('/admin', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin: Users
app.get('/api/admin/users', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const list = await userDB.getAllUsers();
  // map to expected fields
  const mapped = list.map(x => ({ id:x.id, username:x.username, full_name:x.name, email:x.email, role:x.role, is_active:x.is_active, created_at:x.created_at }));
  res.json(mapped);
});

app.get('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const u = await userDB.getUserById(req.params.userId);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ id:u.id, username:u.username, full_name:u.name, email:u.email||'', role:u.role, is_active:u.is_active, created_at:u.created_at });
});

app.post('/api/admin/users', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, email, password, role } = req.body;
  const created = await userDB.createUser({ username, password, name: full_name, email, role: role||'user' });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, name, email, role, is_active } = req.body;
  const update = {};
  if (typeof username === 'string' && username.trim().length) update.username = username.trim();
  const displayName = (typeof full_name === 'string' && full_name.trim().length) ? full_name.trim() : ((typeof name === 'string' && name.trim().length) ? name.trim() : undefined);
  if (displayName !== undefined) update.name = displayName;
  if (email !== undefined) update.email = email;
  if (role !== undefined) update.role = role;
  if (typeof is_active === 'boolean') update.is_active = is_active;
  try {
    await userDB.updateUser(req.params.userId, update);
    res.json({ success:true });
  } catch (e) {
    console.error('User update error:', e);
    res.status(500).json({ success:false, error:'Kullanıcı güncellenemedi' });
  }
});

app.delete('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  if (String(req.params.userId) === String(req.userId)) return res.status(400).json({ error:'Kendi hesabınızı silemezsiniz!' });
  await userDB.deleteUser(req.params.userId);
  res.json({ success:true });
});

// Admin: Devices (DB tabanlı)
app.get('/api/admin/devices', requireAuth, async (req, res) => {
  console.log('GET /api/admin/devices çağrıldı');
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') {
    console.log('Admin erişimi reddedildi');
    return res.status(403).json({ error:'Admin erişimi gerekli!' });
  }
  console.log('Admin kullanıcı doğrulandı:', admin.username);
  try {
    const rows = await deviceDB.getAllDevices();
    console.log('Database\'den cihazlar alındı:', rows.length, 'cihaz');
    const mapped = rows.map(d => ({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_name:d.owner_name||'Sahipsiz', owner_id:d.owner_id||null, location:d.location||'Belirtilmemiş', description:d.description||'Açıklama yok' }));
    console.log('Mapped devices:', mapped);
    res.json(mapped);
  } catch (error) {
    console.error('Cihazlar alınırken hata:', error);
    res.status(500).json({ error:'Cihazlar alınamadı' });
  }
});

app.get('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const d = await deviceDB.getByDeviceId(req.params.deviceId);
  if (!d) return res.status(404).json({ error:'Cihaz bulunamadı!' });
  res.json({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_id:d.owner_id||'', owner_name:d.owner_name||'', location:d.location||'', description:d.description||'' });
});

app.post('/api/admin/devices', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_id, device_name, ip_address, mac_address, location, description } = req.body;
  let { owner_id, owner } = req.body;
  if (!device_id || !device_name) return res.status(400).json({ error:'Cihaz ID ve adı gerekli!' });
  if (!owner_id && owner) { const u = await userDB.getUserByUsername(owner); owner_id = u ? u.id : null; }
  const created = await deviceDB.createDevice({ device_id, device_name, ip_address, mac_address, location, description, owner_id: owner_id||null });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_name, ip_address, mac_address, location, description, is_active } = req.body;
  let { owner_id, owner } = req.body;

  // Owner eşlemesi
  let ownerIdToSet;
  if (typeof owner === 'string') {
    if (owner.trim().length === 0) ownerIdToSet = null; else { const u = await userDB.getUserByUsername(owner); ownerIdToSet = u ? u.id : null; }
  } else if (owner_id !== undefined) {
    ownerIdToSet = owner_id;
  }

  // Sadece tanımlı alanları güncelle
  const update = {};
  if (device_name !== undefined) update.device_name = device_name;
  if (ip_address !== undefined) update.ip_address = ip_address;
  if (mac_address !== undefined) update.mac_address = mac_address;
  if (location !== undefined) update.location = location;
  if (description !== undefined) update.description = description;
  if (ownerIdToSet !== undefined) update.owner_id = ownerIdToSet;
  if (typeof is_active === 'boolean') update.is_active = is_active;

  try {
    await deviceDB.updateByDeviceId(req.params.deviceId, update);
    res.json({ success:true });
  } catch (e) {
    console.error('Device update error:', e);
    res.status(500).json({ error:'Cihaz güncellenemedi' });
  }
});

app.delete('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  await deviceDB.deleteByDeviceId(req.params.deviceId);
  res.json({ success:true });
});

// Kullanıcı layout API'leri
app.get('/api/admin/user-layouts', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const rows = await layoutDB.getAll();
  res.json(rows);
});

app.post('/api/admin/user-layouts/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const target = await userDB.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  const layout = req.body?.layout; if (!layout || typeof layout !== 'object') return res.status(400).json({ error:'Geçersiz layout verisi' });
  await layoutDB.setForUser(target.id, JSON.stringify(layout));
  res.json({ success:true });
});

app.get('/api/user/layout', requireAuth, async (req, res) => {
  const json = await layoutDB.getForUser(req.userId);
  res.json({ layout: json ? JSON.parse(json) : null });
});

// ==================== PORT YÖNETİMİ API'LERİ ====================

// Kullanılan portları listele
app.get('/api/admin/ports', requireAuth, async (req, res) => {
  try {
    const usedPorts = await portDB.getUsedPorts();
    const availablePorts = [];
    
    // Kullanılabilir portları bul - sadece izin verilen portlar
    for (const port of portDB.ALLOWED_PORTS) {
      if (!usedPorts.some(p => p.websocket_port === port)) {
        availablePorts.push(port);
      }
    }
    
    res.json({
      usedPorts: usedPorts.map(p => ({
        userId: p.id,
        username: p.username,
        port: p.websocket_port
      })),
      availablePorts
    });
  } catch (error) {
    console.error('Port listesi hatası:', error);
    res.status(500).json({ error: 'Port listesi alınamadı' });
  }
});

// Kullanıcıya port ata
app.post('/api/admin/ports/assign', requireAuth, async (req, res) => {
  try {
    const { userId, port } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Kullanıcı ID gerekli' });
    }
    
    // Port belirtilmişse kontrol et
    if (port) {
      // Port izin verilen portlardan mı kontrol et
      if (!portDB.ALLOWED_PORTS.includes(port)) {
        return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
      }
      
      const usedPorts = await portDB.getUsedPorts();
      if (usedPorts.some(p => p.websocket_port === port)) {
        return res.status(400).json({ error: 'Port zaten kullanımda' });
      }
      
      // Manuel port atama
      await userDB.updateUser(userId, { websocket_port: port });
      res.json({ success: true, port });
    } else {
      // Otomatik port atama
      const assignedPort = await portDB.assignPort(userId);
      res.json({ success: true, port: assignedPort });
    }
  } catch (error) {
    console.error('Port atama hatası:', error);
    res.status(500).json({ error: 'Port atanamadı' });
  }
});

// Kullanıcının portunu serbest bırak
app.delete('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await userDB.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    if (user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Port serbest bırakma hatası:', error);
    res.status(500).json({ error: 'Port serbest bırakılamadı' });
  }
});

// Kullanıcının portunu değiştir
app.put('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { port } = req.body;
    
    if (!port) {
      return res.status(400).json({ error: 'Port gerekli' });
    }
    
    // Port izin verilen portlardan mı kontrol et
    if (!portDB.ALLOWED_PORTS.includes(port)) {
      return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
    }
    
    // Port kullanımda mı kontrol et
    const usedPorts = await portDB.getUsedPorts();
    if (usedPorts.some(p => p.websocket_port === port && p.id != userId)) {
      return res.status(400).json({ error: 'Port zaten kullanımda' });
    }
    
    // Eski portu serbest bırak
    const user = await userDB.getUserById(userId);
    if (user && user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    // Yeni portu ata
    await userDB.updateUser(userId, { websocket_port: port });
    
    res.json({ success: true, port });
  } catch (error) {
    console.error('Port değiştirme hatası:', error);
    res.status(500).json({ error: 'Port değiştirilemedi' });
  }
});

// ==================== DEVICE CONFIG MANAGEMENT API ====================

// Cihaz konfigürasyonu gönder
app.post('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { config } = req.body;
    const userId = req.userId;
    
    // Rate limiting kontrolü
    if (!checkRateLimit(`config_${userId}`)) {
      return res.status(429).json({ error: 'Çok fazla istek, lütfen bekleyin' });
    }
    
    // Cihaz varlığını kontrol et
    const device = await deviceDB.getByDeviceId(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Config validasyonu
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Geçersiz konfigürasyon verisi' });
    }
    
    // Payload oluştur
    const payload = {
      type: 'update_config',
      device_id: deviceId,
      token: generateShortLivedToken(),
      config: config,
      meta: {
        request_id: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      }
    };
    
    // Konfigürasyonu gönder
    const result = await sendConfigToDevice(deviceId, payload, userId);
    
    res.json({
      success: true,
      ...result,
      device_id: deviceId
    });
    
  } catch (error) {
    console.error('Config gönderme hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon gönderilemedi: ' + error.message });
  }
});

// Cihazın mevcut konfigürasyonunu al
app.get('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const config = await deviceConfigDB.getLastConfig(deviceId);
    res.json({
      success: true,
      config: config ? config.config_json : null,
      applied: config ? config.applied : false,
      created_at: config ? config.created_at : null
    });
    
  } catch (error) {
    console.error('Config alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon alınamadı: ' + error.message });
  }
});

// WOL profilleri yönetimi
app.get('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const profiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    res.json({ success: true, profiles });
    
  } catch (error) {
    console.error('WOL profilleri alma hatası:', error);
    res.status(500).json({ error: 'WOL profilleri alınamadı: ' + error.message });
  }
});

app.post('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, mac, broadcast_ip, port } = req.body;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Validasyon
    if (!name || !mac || !broadcast_ip) {
      return res.status(400).json({ error: 'Name, MAC ve broadcast IP gerekli' });
    }
    
    const profile = await wolProfilesDB.addProfile(deviceId, name, mac, broadcast_ip, port || 9);
    res.json({ success: true, profile });
    
  } catch (error) {
    console.error('WOL profili ekleme hatası:', error);
    res.status(500).json({ error: 'WOL profili eklenemedi: ' + error.message });
  }
});

app.delete('/api/devices/:deviceId/wol-profiles/:profileId', requireAuth, async (req, res) => {
  try {
    const { deviceId, profileId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const result = await wolProfilesDB.deleteProfile(profileId);
    res.json({ success: true, deleted: result.deleted });
    
  } catch (error) {
    console.error('WOL profili silme hatası:', error);
    res.status(500).json({ error: 'WOL profili silinemedi: ' + error.message });
  }
});

// Cihaz durumu ve kuyruk bilgisi
app.get('/api/devices/:deviceId/status', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    console.log(`🔧 Device status API çağrıldı - deviceId: ${deviceId}, userId: ${userId}`);
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      console.log(`❌ Yetki yok - deviceId: ${deviceId}, userId: ${userId}`);
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const device = await deviceDB.getByDeviceId(deviceId);
    const isOnline = wsSessions.has(deviceId);
    const session = wsSessions.get(deviceId);
    
    console.log(`🔧 Device: ${device ? device.device_name : 'Bilinmiyor'}, isOnline: ${isOnline}, session:`, session);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Kuyruk durumu
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceQueue = queueMessages.filter(msg => msg.device_id === deviceId);
    
    const response = {
      success: true,
      device: {
        device_id: deviceId,
        device_name: device ? device.device_name : 'Bilinmiyor',
        is_online: isOnline,
        last_seen: session ? new Date(session.lastSeen).toISOString() : null,
        firmware: session ? session.firmware : null,
        capabilities: session ? session.capabilities : [],
        queue_count: deviceQueue.length
      }
    };
    
    console.log(`🔧 Response gönderiliyor:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('Cihaz durumu alma hatası:', error);
    res.status(500).json({ error: 'Cihaz durumu alınamadı: ' + error.message });
  }
});

// Konfigürasyon geçmişi
app.get('/api/devices/:deviceId/history', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const history = await configHistoryDB.getHistoryByDevice(deviceId, limit);
    res.json({ success: true, history });
    
  } catch (error) {
    console.error('Konfigürasyon geçmişi alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon geçmişi alınamadı: ' + error.message });
  }
});

// SSL sertifikalarını yükle
let sslOptions = null;
try {
  sslOptions = {
    key: fs.readFileSync('cert.key'),
    cert: fs.readFileSync('cert.pem')
  };
  console.log('✅ SSL sertifikaları yüklendi');
} catch (err) {
  console.error('❌ SSL sertifikaları yüklenemedi:', err.message);
  console.log('⚠️  HTTP server olarak çalışacak');
}

// HTTPS server ve WS (SSL varsa)
const server = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
const wss = new WebSocket.Server({ server });

// API için ayrı server (default port)
const apiServer = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
let connectedDevices = new Map(); // deviceId -> WebSocket mapping
let lastCommandsByDevice = new Map(); // deviceId -> { cmd:string, ts:number }

// WS: cihaz kayıtları ve güvenli komutlar
function addToHistory(_) {}

async function checkDeviceOwnership(deviceId, userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (user && user.role === 'admin') return { allowed:true };
  const dev = await deviceDB.getByDeviceId(deviceId);
  if (!dev) return { allowed:false, reason:'Cihaz bulunamadı' };
  if (!dev.owner_id) return { allowed:true };
  if (!user) return { allowed:false, reason:'Kullanıcı bulunamadı' };
  return { allowed: dev.owner_id === user.id, reason: dev.owner_id === user.id ? 'OK' : 'Yetki yok' };
}

// Konfigürasyon gönderme fonksiyonu
async function sendConfigToDevice(deviceId, payload, userId = null) {
  try {
    const session = wsSessions.get(deviceId);
    
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Cihaz online - doğrudan gönder
      try {
        session.ws.send(JSON.stringify(payload));
        console.log(`📤 Config gönderildi (online): ${deviceId}`);
        
        // Config'i veritabanına kaydet (applied=false)
        await deviceConfigDB.saveConfig(deviceId, payload.config, 1);
        
        // Geçmişe kaydet
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'sent', payload.config);
        }
        
        return { sent: true, queued: false, message: 'Config cihaza gönderildi' };
      } catch (error) {
        console.error(`❌ Config gönderme hatası (online): ${error.message}`);
        // Hata durumunda kuyruğa ekle
        await configQueueDB.addToQueue(deviceId, payload);
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config, error.message);
        }
        return { sent: false, queued: true, message: 'Cihaz online ama gönderim başarısız, kuyruğa eklendi' };
      }
    } else {
      // Cihaz offline - kuyruğa ekle
      await configQueueDB.addToQueue(deviceId, payload);
      console.log(`📋 Config kuyruğa eklendi (offline): ${deviceId}`);
      
      if (userId) {
        await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config);
      }
      
      return { sent: false, queued: true, message: 'Cihaz offline, kuyruğa eklendi' };
    }
  } catch (error) {
    console.error(`❌ sendConfigToDevice hatası: ${error.message}`);
    if (userId) {
      await configHistoryDB.addHistory(deviceId, userId, 'failed', payload.config, error.message);
    }
    return { sent: false, queued: false, message: 'Hata: ' + error.message };
  }
}

// Device identify handler
async function handleDeviceIdentify(ws, data) {
  try {
    const { device_id, firmware, token, capabilities } = data;
    console.log(`🔧 handleDeviceIdentify çağrıldı - device_id: ${device_id}, token: ${token ? 'var' : 'yok'}`);
    
    if (!device_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'device_id gerekli' }));
      return;
    }
    
    // Token doğrulama
    let isValidToken = false;
    if (token) {
      const tokenData = await deviceTokensDB.validateToken(device_id, token);
      isValidToken = !!tokenData;
    }
    
    if (!isValidToken) {
      // Yeni cihaz veya geçersiz token - pairing token oluştur
      const pairingToken = generateShortLivedToken();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 dakika
      
      await deviceTokensDB.createToken(device_id, pairingToken, 'pairing', expiresAt.getTime());
      
      ws.send(JSON.stringify({
        type: 'pairing_required',
        device_id,
        pairing_token: pairingToken,
        expires_in: 600 // 10 dakika
      }));
      
      console.log(`🔐 Pairing token oluşturuldu: ${device_id} - ${pairingToken}`);
      return;
    }
    
    // Geçerli token - cihazı kaydet/güncelle
    const deviceInfo = {
      device_id,
      firmware: firmware || 'unknown',
      capabilities: capabilities || [],
      lastSeen: Date.now()
    };
    
    wsSessions.set(device_id, { ws, ...deviceInfo });
    ws.deviceId = device_id;
    ws.isDevice = true;
    
    console.log(`✅ Cihaz wsSessions'a eklendi: ${device_id}`);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Cihaz bilgilerini veritabanında güncelle (mevcut değerleri koru)
    const existingDevice = await deviceDB.getByDeviceId(device_id);
    await deviceDB.updateByDeviceId(device_id, {
      device_name: data.device_name || (existingDevice ? existingDevice.device_name : device_id),
      ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : (existingDevice ? existingDevice.ip_address : ''),
      mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : (existingDevice ? existingDevice.mac_address : ''),
      location: existingDevice ? (existingDevice.location || (data.location || 'Otomatik Eklenen')) : (data.location || 'Otomatik Eklenen'),
      description: existingDevice ? (existingDevice.description || (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`)) : (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`),
      owner_id: existingDevice ? existingDevice.owner_id || null : null,
      is_active: 1
    });
    
    // Bekleyen konfigürasyonları gönder
    const pendingConfigs = await deviceConfigDB.getPendingConfigs(device_id);
    for (const config of pendingConfigs) {
      const payload = {
        type: 'update_config',
        device_id,
        token: generateShortLivedToken(),
        config: config.config_json,
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString()
        }
      };
      
      try {
        ws.send(JSON.stringify(payload));
        console.log(`📤 Bekleyen config gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Bekleyen config gönderme hatası: ${error.message}`);
      }
    }
    
    // Kuyruktaki mesajları işle
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceMessages = queueMessages.filter(msg => msg.device_id === device_id);
    
    for (const message of deviceMessages) {
      try {
        ws.send(JSON.stringify(message.payload));
        await configQueueDB.updateMessageStatus(message.id, 'sent');
        console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
        await configQueueDB.updateMessageStatus(message.id, 'failed', error.message);
      }
    }
    
    // Persistent token oluştur
    const persistentToken = generateShortLivedToken();
    const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 gün
    
    await deviceTokensDB.createToken(device_id, persistentToken, 'persistent', tokenExpires.getTime());
    
    ws.send(JSON.stringify({
      type: 'identify_success',
      device_id,
      message: 'Cihaz başarıyla tanımlandı',
      persistent_token: persistentToken
    }));
    
    console.log(`✅ Cihaz tanımlandı: ${device_id} (${firmware}) - Persistent token: ${persistentToken.substring(0, 8)}...`);
    
  } catch (error) {
    console.error(`❌ Device identify hatası: ${error.message}`);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Cihaz tanımlama hatası: ' + error.message
    }));
  }
}

wss.on("connection", (ws) => {
  console.log('🔌 WebSocket client connected');
  console.log('🔌 Current wsSessions:', Array.from(wsSessions.keys()));
  console.log('🔌 Current ESP32 status:', connectedDevices.size > 0 ? `${connectedDevices.size} cihaz bağlı` : 'Cihaz yok');
  ws.on('message', async (msg) => {
    msg = msg.toString();
    try {
      if (msg.startsWith('{')) {
        console.log('🔧 Raw message received:', msg);
        const data = JSON.parse(msg);
        if (data.type === 'userAuth') {
          ws.userId = data.userId; // username
        } else if (data.type === 'identify') {
          // ESP32 cihaz kimlik doğrulama
          console.log('🔧 ESP32 identify mesajı alındı:', data);
          await handleDeviceIdentify(ws, data);
        } else if (data.type === 'config_applied') {
          // ESP32'den config uygulandı onayı
          const { device_id, request_id, status, details } = data;
          if (device_id && status === 'ok') {
            await deviceConfigDB.markConfigApplied(device_id, request_id);
            console.log(`✅ Config uygulandı: ${device_id}`);
            
            // Cihaz IP/MAC bilgilerini güncelle
            if (details && (details.ip || details.mac)) {
              await deviceDB.updateByDeviceId(device_id, {
                ip_address: details.ip || '',
                mac_address: details.mac || ''
              });
            }
          }
        } else if (data.type === 'deviceSelection') {
          // Client seçili cihazı değiştirdi
          ws.selectedDeviceId = data.deviceId;
          console.log(`Client seçili cihazı değiştirdi: ${data.deviceId}`);
        } else if (data.type === 'frontend' && data.request === 'getDeviceRegistry') {
          // Frontend'den cihaz kayıtları isteniyor
          console.log('getDeviceRegistry request from user:', ws.userId);
          try {
            if (!ws.userId) {
              console.log('No userId in WebSocket, sending error');
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı kimliği bulunamadı' }));
              return;
            }
            const user = await userDB.getUserByUsername(ws.userId);
            if (!user) {
              console.log('User not found in database:', ws.userId);
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı bulunamadı' }));
              return;
            }
            
            let devices;
            if (user.role === 'admin') {
              // Admin tüm cihazları görebilir
              devices = await deviceDB.getAllDevices();
            } else {
              // Normal kullanıcı sadece kendi cihazlarını görebilir
              devices = await deviceDB.getDevicesByOwner(user.id);
            }
            
            // Cihazları frontend formatına çevir
            const mappedDevices = devices.map(d => ({
              deviceId: d.device_id,
              deviceName: d.device_name,
              isOnline: connectedDevices.has(d.device_id), // Cihaz bağlı mı kontrolü
              ipAddress: d.ip_address || '',
              macAddress: d.mac_address || '',
              location: d.location || '',
              description: d.description || '',
              ownerName: d.owner_name || 'Sahipsiz'
            }));
            
            ws.send(JSON.stringify({
              type: 'deviceRegistry',
              devices: mappedDevices
            }));
            
            console.log(`Device registry sent to frontend (filtered for user ${user.username})`);
          } catch (error) {
            console.error('Device registry error:', error);
            ws.send(JSON.stringify({ type:'error', message:'Cihaz kayıtları alınamadı' }));
          }
        } else if (data.type === 'heartbeat' && data.deviceId) {
          // ESP32 heartbeat mesajı - ESP32'yi tanımla ve otomatik kaydet
          const deviceId = data.deviceId;
          connectedDevices.set(deviceId, ws);
          // Bu bağlantıyı cihaz olarak işaretle
          ws.isDevice = true;
          ws.deviceId = deviceId;
          console.log(`ESP32 kayıt edildi: ${data.deviceName || deviceId} (ID: ${deviceId})`);
          
          // Cihazı otomatik olarak database'e kaydet/güncelle
          try {
            const existingDevice = await deviceDB.getByDeviceId(data.deviceId);
            if (existingDevice) {
              // Mevcut cihazı güncelle (kalıcı alanları koruyarak)
              await deviceDB.updateByDeviceId(data.deviceId, {
                device_name: data.deviceName || existingDevice.device_name,
                ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : existingDevice.ip_address,
                mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : existingDevice.mac_address,
                location: existingDevice.location || data.location || existingDevice.location,
                description: existingDevice.description || data.description || existingDevice.description,
                owner_id: existingDevice.owner_id,
                is_active: 1
              });
              console.log(`Cihaz güncellendi: ${data.deviceId}`);
            } else {
              // Yeni cihaz oluştur
              await deviceDB.createDevice({
                device_id: data.deviceId,
                device_name: data.deviceName || data.deviceId,
                ip_address: data.ip_address || '',
                mac_address: data.mac_address || '',
                location: data.location || 'Otomatik Eklenen',
                description: data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`,
                owner_id: null
              });
              console.log(`Yeni cihaz eklendi: ${data.deviceId} - ${data.deviceName || data.deviceId}`);
            }
            
            // Admin panelindeki cihaz listesini güncelle
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'deviceUpdated',
                  deviceId: data.deviceId,
                  action: existingDevice ? 'updated' : 'added'
                }));
              }
            });
          } catch (error) {
            console.error('Cihaz kayıt/güncelleme hatası:', error);
          }
          
          // Heartbeat'i tüm client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        } else if (data.type === 'secureCommand') {
          const { userId, securityKey, deviceId, command } = data;
          const valid = await validateSecurityKey(userId, securityKey);
          if (!valid) {
            ws.send(JSON.stringify({ type:'error', message:'Geçersiz güvenlik anahtarı veya süresi dolmuş' }));
            return;
          }
          const own = await checkDeviceOwnership(deviceId, userId);
          if (!own.allowed) {
            ws.send(JSON.stringify({ type:'error', message: own.reason || 'Yetki yok' }));
            return;
          }
          // Aynı komutu kısa süre içinde tekrar göndermeyi engelle (debounce)
          try {
            const now = Date.now();
            const prev = lastCommandsByDevice.get(deviceId);
            const signature = `${deviceId}:${command}`;
            if (prev && prev.cmd === signature && (now - prev.ts) < 400) {
              console.log(`Debounced duplicate command to ${deviceId}: ${command}`);
              return;
            }
            lastCommandsByDevice.set(deviceId, { cmd: signature, ts: now });
          } catch (e) {
            // ignore debounce errors
          }
          // Komutu hedef cihaza ilet
          const targetDevice = connectedDevices.get(deviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            targetDevice.send(command);
            console.log(`Komut gönderildi: ${command} -> ${deviceId}`);
          } else {
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${deviceId}` }));
            console.log(`Cihaz çevrimdışı: ${deviceId}`);
          }
        } else if (ws.isDevice) {
          // ESP32'den gelen diğer JSON mesajları (status, relay, wol vb.) client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        }
      } else {
        // Legacy/düz metin mesajlar: getWolStatus, getRelayStatus vb.
        if (msg.includes('esp32:online') || msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
          // ESP32'den gelen legacy mesajlar
          if (msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msg);
              }
            });
            return;
          }
          return;
        }
        
        // Client -> ESP32 (getWolStatus, getRelayStatus vb.) - sadece seçili cihaza gönder
        if (ws.userId && !ws.isDevice) {
          // Bu bir client mesajı, seçili cihaza gönder
          const selectedDeviceId = ws.selectedDeviceId; // Varsayılan kaldırıldı
          if (!selectedDeviceId) {
            ws.send(JSON.stringify({ type:'error', message:'Önce cihaz seçin' }));
            return;
          }
          const targetDevice = connectedDevices.get(selectedDeviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            // Aynı cihaz bağlantısına geri gönderimi engelle
            if (targetDevice !== ws) {
              targetDevice.send(msg);
            }
            console.log(`Client request forwarded to ESP32 (${selectedDeviceId}): ${msg}`);
          } else {
            console.log(`ESP32 not available for message: ${msg} (target: ${selectedDeviceId})`);
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${selectedDeviceId}` }));
          }
        }
        
        // ESP32 -> Clients
        if (ws.isDevice) {
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
        }
      }
    } catch (e) {
      console.error('WS error:', e);
    }
  });
  ws.on('close', () => {
    // Bağlantı kapanan cihazı listeden çıkar
    for (const [deviceId, deviceWs] of connectedDevices.entries()) {
      if (deviceWs === ws) {
        connectedDevices.delete(deviceId);
        console.log(`ESP32 bağlantısı kapandı: ${deviceId}`);
        break;
      }
    }
    
    // WebSocket session'ı temizle
    if (ws.deviceId) {
      wsSessions.delete(ws.deviceId);
      console.log(`WebSocket session temizlendi: ${ws.deviceId}`);
    }
  });
});

// Ana sayfa route'u
app.get('/', requireAuth, (req, res) => {
  console.log('🏠 Ana sayfa route çağrıldı, userId:', req.userId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Background queue worker
async function startQueueWorker() {
  console.log('🔄 Queue worker başlatılıyor...');
  
  setInterval(async () => {
    try {
      // Bekleyen mesajları al
      const pendingMessages = await configQueueDB.getPendingMessages();
      
      for (const message of pendingMessages) {
        const { id, device_id, payload, retries, max_retries } = message;
        
        // Maksimum deneme sayısını kontrol et
        if (retries >= max_retries) {
          await configQueueDB.updateMessageStatus(id, 'failed', 'Maksimum deneme sayısı aşıldı');
          console.log(`❌ Mesaj başarısız (max retries): ${device_id}`);
          continue;
        }
        
        // Cihaz online mı kontrol et
        const session = wsSessions.get(device_id);
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
          try {
            // Mesajı gönder
            session.ws.send(JSON.stringify(payload));
            await configQueueDB.updateMessageStatus(id, 'sent');
            console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
          } catch (error) {
            console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
            await configQueueDB.updateMessageStatus(id, 'failed', error.message);
          }
        } else {
          // Cihaz hala offline, bir sonraki döngüde tekrar dene
          console.log(`⏳ Cihaz offline, mesaj bekletiliyor: ${device_id}`);
        }
      }
      
      // Başarısız mesajları temizle (24 saatten eski)
      const cleaned = await configQueueDB.cleanupFailedMessages();
      if (cleaned.cleaned > 0) {
        console.log(`🧹 ${cleaned.cleaned} başarısız mesaj temizlendi`);
      }
      
    } catch (error) {
      console.error('❌ Queue worker hatası:', error);
    }
  }, 30000); // 30 saniyede bir çalış
  
  console.log('✅ Queue worker başlatıldı');
}

// Server başlatma
(async () => {
  try {
    await initDatabase();
    console.log('✅ Veritabanı başlatıldı');
    await sessionDB.cleanExpiredSessions();
    console.log('✅ Süresi dolmuş session\'lar temizlendi');
    
    // Queue worker'ı başlat
    await startQueueWorker();
    // WebSocket server (port 5131)
    server.listen(5131, '0.0.0.0', () => {
      const protocol = sslOptions ? 'WSS (HTTPS)' : 'WS (HTTP)';
      console.log(`WebSocket server running on port 5131 - ${protocol}`);
      console.log(`WebSocket URL: ${sslOptions ? 'wss://' : 'ws://'}fatihdev.xyz:5131/`);
    });
    
    // API server (port 5130)
    apiServer.listen(5130, '0.0.0.0', () => {
      const protocol = sslOptions ? 'HTTPS' : 'HTTP';
      console.log(`API server running on port 5130 - ${protocol}`);
      console.log(`API URL: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/`);
      console.log(`Test API: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/test`);
    });
  } catch (e) {
    console.error('❌ Server init error:', e);
    process.exit(1);
  }
})();

```

- Kullanıcı düzenle modalı: Sunucuda sadece `full_name` bekleyen update endpoint’ini genişlettim. Artık `username`, `full_name` veya `name`, `email`, `role`, `is_active` alanlarından gelenleri varsa güncelliyor; eksik olanları dokunmuyor. Client tarafında da PUT isteği `apiFetch` üzerinden gidiyor ve non-JSON durumda parse hatası düşmüyor.

- Cihaz atama 500: Sunucuda `/api/admin/devices/:deviceId` güncellemesini “sadece gelen alanları güncelle” modeline çevirdim ve `owner` eşlemesini netleştirdim:
  - `owner: ''` gelirse cihaz sahipsiz yapılır (`owner_id = null`)
  - `owner: 'kullaniciadi'` gelirse o kullanıcının `id`’si atanır
  - `owner_id` gelirse direkt o id kullanılır
  - Diğer alanlar (`device_name`, `ip_address`, `mac_address`, `location`, `description`, `is_active`) sadece body’de varsa güncellenir, aksi halde korunur.
  - Hata olursa 500 ve anlamlı JSON döner.

- İstemci tarafı:
  - Kullanıcı güncelleme: `admin.js` artık `apiFetch` kullanıyor ve `response.ok` kontrolü ile güvenli parse yapıyor.
  - Cihaz atama: `assignDeviceToUser` sade payload gönderiyor; sadece `owner` alanı var ve boşsa sahipsiz bırakma yapıyor.

Rica: Tekrar dener misin?
- Admin > Kullanıcılar > Düzenle: kullanıcı adı/ad-soyad/rol/mail/is_active değişiklikleri kaydolmalı.
- Admin > Cihazlar > Kullanıcıya ata/kaldır: 500 hatası yerine başarı dönmeli.

