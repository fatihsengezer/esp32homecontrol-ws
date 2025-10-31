# Esp32 backend server uyumu
_Exported on 10/31/2025 at 13:57:20 GMT+3 from Cursor (1.7.52)_

---

**User**

backendimizi yani esp32 tarafini bu serverimiza uyumlu yapar misin secure websocket port 5631 olacak

---

**Cursor**

Plan: Önce mevcut ESP32 kodunu ve Node.js server'da websocket uç noktası/mesaj formatını inceleyeceğim. Ardından ESP32’ye WSS (5631) istemcisi ekleyip CA sertifikası/fingerprint desteği, yeniden bağlanma ve mesaj işleme akışını uyumlu hale getireceğim. İlk adım olarak dosyaları okuyorum.

Sunucuda WSS uç noktası ve mesaj formatını bulmak için ilgili dosyaları inceleyeceğim. Ardından ESP32 tarafına WSS istemcisini eklemeye geçeceğim.

Cihazdan (ESP32) beklenen WebSocket mesaj formatını ve kayıt/auth akışını görmek için sunucu tarafındaki `server.js` dosyasının ilgili bölümlerini okuyorum; ardından ESP32’ye WSS istemci kodunu ekleyeceğim.

ESP32 tarafındaki mevcut kodu ve konfigürasyonu inceleyip WSS (5631) istemcisini nereye ve nasıl ekleyeceğimi belirleyeceğim. Ardından gerekli editleri yapacağım.

Mevcut server'ın WSS port ve mesaj akışını çıkardım. Şimdi ESP32'ye WSS (5631) istemcisini eklemek, host'u `fatihdev.xyz` yapmak ve yeniden bağlanma/heartbeat uyumunu sağlamak için gerekli editleri uygulayacağım. Sertifika doğrulaması için geçici olarak insecure bağlanma kullanacağım; isterseniz CA/fingerprint ekleyebiliriz.

ESP32 tarafında WSS 5631'e bağlanmayı başlatıyorum: önce yapılmış analizi tamamlandı sayıyorum, şimdi `esp32_001.h` ve `main.cpp` dosyalarında WSS bağlantısını `fatihdev.xyz:5631` ile kuran editleri uygulayacağım ve keepalive'ı açacağım.

ESP32 tarafına WSS 5631 bağlantısını ekliyorum: `esp32_001.h` içinde host/portu güncelleyeceğim ve `main.cpp` içinde `beginSSL`, heartbeat ve geçici `setInsecure()` ile TLS'i etkinleştireceğim.

```cpp
// ESP32-001 Konfigürasyonu - Ana Kontrol
#ifndef ESP32_001_CONFIG_H
#define ESP32_001_CONFIG_H

#define DEVICE_ID "esp32_001"
#define DEVICE_NAME "Ana Kontrol"
#define DEVICE_VERSION "1.0.0"

// WebSocket Server IP
#define WS_SERVER_IP "fatihdev.xyz"
#define WS_SERVER_PORT 5631

// Röle Pinleri - DeviceConfig.h'den alınıyor

#endif

```

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
#include "DeviceConfig.h"
// Cihaz konfigürasyonunu seçin:
#include "../device_configs/esp32_001.h"  // Ana Kontrol
// #include "../device_configs/esp32_002.h"  // Yatak Odası
// #include "../device_configs/esp32_003.h"  // Mutfak
#include <ESP32Ping.h> // Ping için gerekli

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

// WOL device list
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip;
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

WOLDevice devices[] = {
  {"Server", {0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), WOLDevice::OFFLINE, 0},
  {"B350",   {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), WOLDevice::OFFLINE, 0},
  {"Main",   {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), WOLDevice::OFFLINE, 0}
};

const int deviceCount = sizeof(devices) / sizeof(devices[0]);

WiFiUDP udp;
WebSocketsClient webSocket;

// ----------------- WOL -----------------
void sendWOL(byte* mac) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], mac, 6);

  udp.beginPacket("192.168.1.255", 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
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
  for (int i = 0; i < deviceCount; i++) {
    sendStatus(devices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state);
    Serial.println("relay:" + String(i) + ":" + state);
  }
}

// ----------------- Röle kontrol (WebSocket ile) -----------------
void setRelayWithWebSocket(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr);
  
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

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
      else if (msg == "getRelayStatus") {
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg == "getWolStatus") {
        for (int i = 0; i < deviceCount; i++) {
          WOLDevice &dev = devices[i];
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

  buzzerInit();
  ledInit();
  ledBlink(300);

  connectToWiFi();

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Geçici: Sertifika doğrulamasını kapat (CA eklenecek)
  webSocket.setInsecure();
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ----------------- LOOP -----------------
void loop() {
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
#include "DeviceConfig.h"
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
  StaticJsonDocument<512> doc;
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
  StaticJsonDocument<512> doc;
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

WSS istemciyi eklemeyi tamamladım ve heartbeat/keepalive ayarlarını yaptım. Şimdi espbackend altında bir solves kaydı oluşturacağım ve ardından yapılmış işleri işaretleyeceğim.

```markdown
Başlık: ESP32 backend WSS (port 5631) uyumu

Özet
- ESP32, Node.js sunucuya güvenli WebSocket (wss) ile bağlanacak şekilde güncellendi.
- Sunucu host: fatihdev.xyz, port: 5631.
- Heartbeat mesajı server beklentisine göre `type=heartbeat`, `deviceId`, `deviceName`, `ip_address`, `mac_address` alanları ile gönderiliyor.
- Keepalive ve otomatik yeniden bağlanma etkinleştirildi.

Yapılan Değişiklikler
- espbackend/device_configs/esp32_001.h
  - `WS_SERVER_IP` → "fatihdev.xyz"
  - `WS_SERVER_PORT` → 5631
- espbackend/src/main.cpp
  - `webSocket.beginSSL(...)` kullanıldı.
  - Geçici olarak `webSocket.setInsecure()` eklendi (TLS şifreleme aktif, doğrulama kapalı).
  - `webSocket.enableHeartbeat(15000, 3000, 2)` ile ping/pong keepalive etkin.
- espbackend/src/DeviceConfig.cpp
  - Heartbeat mesajına `ip_address` ve `mac_address` eklendi.

Server Beklentileri (server.js)
- İlk bağlantıda `{"type":"heartbeat","deviceId":"..."}` alınca cihazı `connectedDevices` listesine ekliyor ve DB’yi güncelliyor.
- Text komutları (ör: `relay:0:on`, `getRelayStatus`) legacy olarak destekleniyor ve client’lara aynen yayınlanıyor.

TLS Sertifika Doğrulama (Yapılacak)
- Şu an `setInsecure()` ile doğrulama kapalı; TLS şifreleme var.
- Önerilen: sunucu CA/sertifikası cihaz yazılımına gömülerek doğrulama açılmalı.
  - Sunucu sertifikasını almak için: `openssl s_client -showcerts -connect fatihdev.xyz:5631`
  - Çıktıdaki uygun CA sertifikasını PEM olarak kaydedip koda dahil edin ve `webSocket.setCACert(ca_pem)` veya fingerprint kullanın.

Notlar
- Sunucunun gerçek dinlediği portun 5631 olduğundan emin olun (server.js default 5131). Prod’da reverse proxy/port yönlendirme varsa uygun şekilde ayarlayın.

```

- ESP32 tarafını WSS 5631’e uyarladım ve keepalive/yeniden bağlanmayı etkinleştirdim.
- Sunucu host `fatihdev.xyz`, port `5631`; ilk bağlantıda `heartbeat` JSON gönderiliyor. 
- TLS şifreleme aktif, şimdilik doğrulama `setInsecure()` ile kapalı; CA eklemeyi ister misin?

Önemli editler:
- `espbackend/device_configs/esp32_001.h`: host `fatihdev.xyz`, port `5631`.
- `espbackend/src/main.cpp`: `beginSSL`, `setInsecure`, `enableHeartbeat(15000,3000,2)`.
- `espbackend/src/DeviceConfig.cpp`: heartbeat’e `ip_address` ve `mac_address` eklendi.
- `espbackend/solves/2025-10-24-esp32-wss-5631.md` oluşturuldu.

Devam için:
- İstersen CA sertifikasını ekleyip doğrulamayı açayım. Sunucu sertifikasını verebilir misin ya da ben `openssl s_client -showcerts -connect fatihdev.xyz:5631` ile çıkarayım?

---

**User**

[{
	"resource": "/z:/espbackend/src/main.cpp",
	"owner": "cpp",
	"severity": 8,
	"message": "'class WebSocketsClient' has no member named 'setInsecure'",
	"startLineNumber": 347,
	"startColumn": 13,
	"endLineNumber": 347,
	"endColumn": 13
},{
	"resource": "/z:/espbackend/src/main.cpp",
	"owner": "C/C++: IntelliSense",
	"code": "135",
	"severity": 8,
	"message": "class \"WebSocketsClient\" has no member \"setInsecure\"",
	"source": "C/C++",
	"startLineNumber": 347,
	"startColumn": 13,
	"endLineNumber": 347,
	"endColumn": 24,
	"origin": "extHost1"
}]

---

**Cursor**

Hata geldiğini gördüm; `WebSocketsClient` sınıfında `setInsecure()` yok. Bunu kaldırıp WSS bağlantısını `beginSSL` ile sertifika belirtmeden kuracağım (ESP32 tarafında bu, doğrulama olmadan TLS’e bağlanır). Şimdi kodu düzeltiyorum ve kısa bir çözüm notunu root `solves` klasörüne ekliyorum.

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
#include "DeviceConfig.h"
// Cihaz konfigürasyonunu seçin:
#include "../device_configs/esp32_001.h"  // Ana Kontrol
// #include "../device_configs/esp32_002.h"  // Yatak Odası
// #include "../device_configs/esp32_003.h"  // Mutfak
#include <ESP32Ping.h> // Ping için gerekli

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

// WOL device list
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip;
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

WOLDevice devices[] = {
  {"Server", {0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), WOLDevice::OFFLINE, 0},
  {"B350",   {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), WOLDevice::OFFLINE, 0},
  {"Main",   {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), WOLDevice::OFFLINE, 0}
};

const int deviceCount = sizeof(devices) / sizeof(devices[0]);

WiFiUDP udp;
WebSocketsClient webSocket;

// ----------------- WOL -----------------
void sendWOL(byte* mac) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], mac, 6);

  udp.beginPacket("192.168.1.255", 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
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
  for (int i = 0; i < deviceCount; i++) {
    sendStatus(devices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state);
    Serial.println("relay:" + String(i) + ":" + state);
  }
}

// ----------------- Röle kontrol (WebSocket ile) -----------------
void setRelayWithWebSocket(int index, bool state) {
  if (index < 0 || index >= RELAY_COUNT) return;
  
  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr);
  
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

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
      else if (msg == "getRelayStatus") {
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg == "getWolStatus") {
        for (int i = 0; i < deviceCount; i++) {
          WOLDevice &dev = devices[i];
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

  buzzerInit();
  ledInit();
  ledBlink(300);

  connectToWiFi();

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ----------------- LOOP -----------------
void loop() {
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

```markdown
Sorun: `WebSocketsClient` sınıfında `setInsecure()` metodu yok hatası

Neden:
- Kullanılan Links2004/WebSockets kütüphanesinde `setInsecure()` bulunmuyor.

Çözüm:
- `webSocket.beginSSL(host, port, "/")` ile WSS başlatıldı.
- `setInsecure()` satırı kaldırıldı. Sertifika doğrulaması daha sonra `setCACert()` alternatifleri ile ele alınacak (kütüphane desteklerse) veya fingerprint yöntemi kullanılacak.

Not:
- TLS şifreleme etkin; doğrulama için CA ekleme adımı ayrıca yapılacak.

```

- `setInsecure()` satırını kaldırdım; `beginSSL` ile WSS bağlantı devam ediyor.
- Root `solves` altına hata ve çözümü not ettim.

Test et: derle ve bağlanmayı dene. Bağlanamazsa firewall/port 5631, DNS ve server’ın WSS port yönlendirmesini kontrol edelim.

---

**User**

esp32 kodunda bir problem var sanirsam bir yer eko yapiyor. "
2025-10-25 01:20:42:055[Recv<-].
2025-10-25 01:20:42:955[Recv<-].
2025-10-25 01:20:43:855[Recv<-].
2025-10-25 01:20:44:755[Recv<-].
2025-10-25 01:20:45:655[Recv<-].
2025-10-25 01:20:46:055[Recv<-]
WiFi connected!
192.168.1.125
[ 11826][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 11837][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 11 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":11844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:20:51:337[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 16 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":16844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
[ 17041][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 17052][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:20:56:338[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 21 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":21844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
[ 22164][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 22175][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:01:337[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 26 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":26844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:01:779[Recv<-][ 27286][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 27297][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:06:338[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 31 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":31844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:06:998[Recv<-][ 32504][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 32515][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:11:337[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 36 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":36844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:12:119[Recv<-][ 37625][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 37636][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:16:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 41 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":41844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:17:238[Recv<-][ 42744][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 42755][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:21:338[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 46 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":46844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:22:360[Recv<-][ 47867][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 47877][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:26:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 51 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":51844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:27:581[Recv<-][ 53086][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 53097][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:31:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 56 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":56844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:32:702[Recv<-][ 58207][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 58217][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:36:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 61 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":61844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:37:822[Recv<-][ 63327][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 63338][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:41:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 66 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":66844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:43:044[Recv<-][ 68549][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 68559][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:46:339[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 71 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":71844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:48:165[Recv<-][ 73669][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 73680][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:51:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 76 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":76844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:53:285[Recv<-][ 78790][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 78801][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:21:56:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 81 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":81844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:21:58:406[Recv<-][ 83911][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 83921][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:01:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 86 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":86844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:03:525[Recv<-][ 89029][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 89040][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:06:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 91 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":91844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:08:646[Recv<-][ 94150][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 94160][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:11:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 96 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":96844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:13:765[Recv<-][ 99269][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[ 99280][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:16:341[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 101 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":101844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:18:988[Recv<-][104491][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[104502][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:21:340[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 106 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":106844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:24:109[Recv<-][109612][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[109623][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:26:341[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 111 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":111844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:29:229[Recv<-][114732][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[114742][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:31:342[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 116 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":116844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:34:351[Recv<-][119853][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[119864][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:36:341[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 121 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":121844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:39:470[Recv<-][124972][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[124983][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:41:342[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 126 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":126844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:44:592[Recv<-][130093][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[130104][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:46:341[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 131 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":131844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:49:813[Recv<-][135316][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[135326][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:51:342[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 136 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":136844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:22:54:933[Recv<-][140434][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[140445][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:22:56:342[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 141 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":141844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:00:054[Recv<-][145556][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[145566][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:01:343[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 146 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":146844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:05:173[Recv<-][150674][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[150685][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:06:343[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 151 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":151844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:10:396[Recv<-][155897][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[155908][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:11:344[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 156 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":156844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:15:518[Recv<-][161017][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[161027][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:16:343[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 161 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":161844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:20:641[Recv<-][166141][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[166152][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:21:355[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 166 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":166844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:25:859[Recv<-][171360][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[171370][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:26:348[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 171 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":171844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:30:979[Recv<-][176479][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[176490][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:31:345[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 176 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":176844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:36:099[Recv<-][181599][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[181610][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 181 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":181844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:41:220[Recv<-][186719][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[186730][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 186 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":186844,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:46:341[Recv<-][191841][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[191852][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 191 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":191858,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:51:358[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 196 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":196858,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
[197064][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[197075][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:23:56:359[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_001 - Ana Kontrol
Uptime: 201 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":201858,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:23:56:784[Recv<-][202283][E][ssl_client.cpp:129] start_ssl_client(): socket error on fd 48, errno: 104, "Connection reset by peer"
[202294][E][WiFiClientSecure.cpp:144] connect(): start_ssl_client: -1

2025-10-25 01:24:00:803[Recv<-]ets Jul 29 2019 12:21:46

rst:0x1 (POWERON_RESET),boot:0x3 (DOWNLOAD_BOOT(UART0/UART1/SDIO_REI_REO_V2))
waiting for download

2025-10-25 01:25:04:732[Recv<-]ets Jul 29 2019 12:21:46

rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
configsip: 0, SPIWP:0xee
clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00
mode:DIO, clock div:2
load:0x3fff0030,len:1184
load:0x40078000,len:13232
load:0x40080400,len:3028
entry 0x400805e4

2025-10-25 01:25:05:183[Recv<-]=== ESP32 ModÃ¼ler Sistem BaÅŸlatÄ±lÄ±yor ===
Cihaz ID: esp32_001
Cihaz AdÄ±: Ana Kontrol
RÃ¶le SayÄ±sÄ±: 8
Cihaz baÅŸlatma tamamlandÄ±!

2025-10-25 01:25:08:980[Recv<-]Connecting to: Rimer

2025-10-25 01:25:09:492[Recv<-].
2025-10-25 01:25:10:392[Recv<-].
2025-10-25 01:25:11:292[Recv<-].
2025-10-25 01:25:12:192[Recv<-].
2025-10-25 01:25:13:094[Recv<-].
2025-10-25 01:25:13:992[Recv<-].
2025-10-25 01:25:14:892[Recv<-].
2025-10-25 01:25:15:792[Recv<-].
2025-10-25 01:25:16:692[Recv<-].
2025-10-25 01:25:17:099[Recv<-]
WiFi connected!
192.168.1.125

2025-10-25 01:25:18:211[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 13 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":13079,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
=== WebSocket BaÄŸlandÄ± ===
Server: fatihdev.xyz:5131
Cihaz ID: esp32_fatih
Cihaz AdÄ±: Ana Kontrol
Heartbeat gÃ¶nderildi: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":13276,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:25:22:190[Recv<-]Message: getWolStatus

2025-10-25 01:25:23:276[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 18 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":18142,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: getRelayStatus
relay:0:off
relay:1:off
relay:2:off
relay:3:off
relay:4:off
relay:5:off
relay:6:off
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 23 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":23154,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 28 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":28175,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":true},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: getWolStatus

2025-10-25 01:25:37:270[Recv<-]Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: getRelayStatus
relay:0:off
relay:1:off
relay:2:off
relay:3:off
relay:4:off
relay:5:off
relay:6:off
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 33 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":33204,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":true},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 38 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":38210,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":true},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
Message: relay:3:on
RÃ¶le 3 AÃ‡ILIYOR
RÃ¶le 3 AÃ‡ILDI
relay:3:on
ets Jul 29 2019 12:21:46

rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
configsip: 0, SPIWP:0xee
clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00
mode:DIO, clock div:2
load:0x3fff0030,len:1184
load:0x40078000,len:13232
load:0x40080400,len:3028
entry 0x400805e4

2025-10-25 01:25:48:409[Recv<-]=== ESP32 ModÃ¼ler Sistem BaÅŸlatÄ±lÄ±yor ===
Cihaz ID: esp32_001
Cihaz AdÄ±: Ana Kontrol
RÃ¶le SayÄ±sÄ±: 8
Cihaz baÅŸlatma tamamlandÄ±!

2025-10-25 01:25:51:804[Recv<-]Connecting to: Rimer

2025-10-25 01:25:52:317[Recv<-].
2025-10-25 01:25:53:217[Recv<-].
2025-10-25 01:25:54:117[Recv<-].
2025-10-25 01:25:55:017[Recv<-].
2025-10-25 01:25:55:418[Recv<-]
WiFi connected!
192.168.1.125

2025-10-25 01:25:56:506[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 8 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":8148,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
=== WebSocket BaÄŸlandÄ± ===
Server: fatihdev.xyz:5131
Cihaz ID: esp32_fatih
Cihaz AdÄ±: Ana Kontrol
Heartbeat gÃ¶nderildi: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":8248,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:26:01:512[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 13 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":13148,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:26:06:510[Recv<-]=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 18 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":18148,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}

2025-10-25 01:26:10:018[Recv<-]Message: getWolStatus

2025-10-25 01:26:11:087[Recv<-]Message: getRelayStatus
relay:0:off
relay:1:off
relay:2:off
relay:3:off
relay:4:off
relay:5:off
relay:6:off
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 23 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":23166,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 28 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":28184,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
=== Heartbeat GÃ¶nderildi ===
Cihaz: esp32_fatih - Ana Kontrol
Uptime: 33 saniye
Mesaj: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":33209,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{}]}
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
Message: relay:2:off
RÃ¶le 2 KAPATILIYOR
RÃ¶le 2 KAPANDI
relay:2:off
Message: relay:3:off
RÃ¶le 3 KAPATILIYOR
RÃ¶le 3 KAPANDI
relay:3:off
Message: relay:4:off
RÃ¶le 4 KAPATILIYOR
RÃ¶le 4 KAPANDI
relay:4:off
Message: relay:5:off
RÃ¶le 5 KAPATILIYOR
RÃ¶le 5 KAPANDI
relay:5:off
Message: relay:6:off
RÃ¶le 6 KAPATILIYOR
RÃ¶le 6 KAPANDI
relay:6:off
Message: relay:7:off
RÃ¶le 7 KAPATILIYOR
RÃ¶le 7 KAPANDI
relay:7:off
Message: relay:0:off
RÃ¶le 0 KAPATILIYOR
RÃ¶le 0 KAPANDI
relay:0:off
Message: relay:1:off
RÃ¶le 1 KAPATILIYOR
RÃ¶le 1 KAPANDI
relay:1:off
"

restart atinca da ayni

---

**Cursor**

Önce hangi mesajların tekrara düştüğünü ve frontend’in olası tetikleyici döngülerini bulacağım; ardından ESP32 tarafında iki küçük düzeltme yapacağım: 1) heartbeat JSON boyutunu artırmak (son boş {} bug’ını fix), 2) röle durum geri bildirimini ‘relay_state:’ ön ekiyle ayırmak için bir opsiyon eklemek (gerekirse hızlıca açıp kapatabilelim). Bu incelemeyi yapıyorum ve ardından kodu düzenleyeceğim.

Önce tekrarlama/echo’nun kaynağını düzeltip sonra heartbeat JSON’daki boş {} sorunu için buffer’ı büyüteceğim. Sunucu tarafında `connectedDevices.has(ws)` hatasını düzeltecek ve ESP32’yi doğru şekilde işaretleyeceğim; ardından ESP32’de JSON buffer’ını artıracağım.

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
const { initDatabase, userDB, deviceDB, sessionDB, securityKeyDB, layoutDB, portDB } = require('./database');

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

// Güvenlik anahtarı
function generateSecurityKey() {
  return crypto.randomBytes(32).toString('hex');
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
  const { full_name, email, role, is_active } = req.body;
  await userDB.updateUser(req.params.userId, { name: full_name, email, role, is_active });
  res.json({ success:true });
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
    const mapped = rows.map(d => ({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_name:d.owner_name||'Sahipsiz', location:d.location||'Belirtilmemiş', description:d.description||'Açıklama yok' }));
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

wss.on("connection", (ws) => {
  console.log('Client connected');
  console.log('Current ESP32 status:', connectedDevices.size > 0 ? `${connectedDevices.size} cihaz bağlı` : 'Cihaz yok');
  ws.on('message', async (msg) => {
    msg = msg.toString();
    try {
      if (msg.startsWith('{')) {
        const data = JSON.parse(msg);
        if (data.type === 'userAuth') {
          ws.userId = data.userId; // username
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
              // Mevcut cihazı güncelle (son görülme zamanı, durum vb.)
              await deviceDB.updateByDeviceId(data.deviceId, {
                device_name: data.deviceName || existingDevice.device_name,
                ip_address: data.ip_address || existingDevice.ip_address,
                mac_address: data.mac_address || existingDevice.mac_address,
                location: data.location || existingDevice.location,
                description: data.description || existingDevice.description,
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
          const selectedDeviceId = ws.selectedDeviceId || 'esp32_001'; // Varsayılan cihaz
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
  });
});

// Ana sayfa route'u
app.get('/', requireAuth, (req, res) => {
  console.log('🏠 Ana sayfa route çağrıldı, userId:', req.userId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server başlatma
(async () => {
  try {
    await initDatabase();
    console.log('✅ Veritabanı başlatıldı');
    await sessionDB.cleanExpiredSessions();
    console.log('✅ Süresi dolmuş session\'lar temizlendi');
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

```cpp
#include "DeviceConfig.h"
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

- Echo/döngü: Sunucuda bağlantıyı cihaz/client ayrımı için `ws.isDevice` bayrağıyla işaretledim; cihazdan geleni tekrar cihaza yollama olasılığını kestim. Bu, aynı mesajların geri dönüp cihazı tetiklemesini engeller.
- Heartbeat JSON: `StaticJsonDocument` boyutunu 1024’e çıkardım; `relayStates` sonundaki boş `{}` artefaktı bu yüzden oluşuyordu, artık olmamalı.
- TLS reset by peer: İlk bölümde 5631’e WSS bağlanma denemeleri peer reset veriyordu; log’larda bağlandıktan sonra `Server: fatihdev.xyz:5131` görünmüş. Şu an server WSS portu 5131’de çalışıyor. 5631 hedefleniyorsa sunucuda yönlendirme/portu açmak gerekiyor; aksi halde ESP32 `WS_SERVER_PORT` 5131 olmalı.

Lütfen:
- Node.js server’ı yeniden başlatıp test et.
- ESP32 log’da tekrarlayan relay mesajları kesildi mi bak.
- 5631 isteniyorsa sunucuda o portu aktif edelim; yoksa `esp32_001.h` içinde `WS_SERVER_PORT`’u 5131’de bırakabiliriz.

---

**User**

sorun halen ayni. [1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:11 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:10 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:09 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] Heartbeat: Ana Kontrol - Uptime: 41s
[1:37:08 AM] ESP32: {"type":"heartbeat","deviceId":"esp32_001","deviceName":"Ana Kontrol","status":"online","uptime":41693,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":true},{"id":7,"state":false}]}
[1:37:08 AM] Bilinmeyen JSON mesaj: deviceUpdated
[1:37:08 AM] ESP32: {"type":"deviceUpdated","deviceId":"esp32_001","action":"updated"}
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:08 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on
[1:37:07 AM] ESP32: relay:6:on

---

**Cursor**

Cihazdan gelen tekrar eden 'relay:6:on' mesajlarının kaynağını bulmak için frontend `main.js`'de WebSocket onmessage akışını ve komut gönderimini inceliyorum; ayrıca ESP32 kodunda durum mesajı geri bildiriminin tekrar tetikleyici olup olmadığını kontrol edeceğim.

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

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return; // Zaten bağlı
  }
  
  // Sadece WSS kullan
  const currentUrl = wsUrl;
  
  console.log(`WebSocket bağlantısı kuruluyor... (Deneme: ${reconnectAttempts + 1}/${maxReconnectAttempts}) - ${currentUrl}`);
  logMessage(`WebSocket bağlantısı kuruluyor... (Deneme: ${reconnectAttempts + 1}/${maxReconnectAttempts}) - ${currentUrl}`, "SYSTEM");
  
  ws = new WebSocket(currentUrl);

// Global değişkenler
let currentUser = null;
let availableDevices = [];
let selectedDeviceId = null;

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
    
    // Bağlantı durumunu güncelle
    updateConnectionStatus(true);
  
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
    getWOLStatus();
  }, 1000);
  
  // Relay durumlarını iste
  setTimeout(() => {
    ws.send("getRelayStatus");
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
  
  // Cihaz değiştiğinde event listener ekle
  select.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
    log(`Cihaz değiştirildi: ${e.target.selectedOptions[0].textContent}`, "SYSTEM");
    
    // WebSocket'e seçili cihazı bildir
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "deviceSelection",
        deviceId: selectedDeviceId
      }));
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
    case "heartbeat":
      log(`Heartbeat: ${data.deviceName} - Uptime: ${Math.floor(data.uptime/1000)}s`);
      break;
    case "status":
      updateRelayStatesFromJSON(data.relayStates);
      break;
    case "deviceRegistry":
      handleDeviceRegistry(data);
      updateDeviceSelector(data.devices);
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Güvenli komut gönder
    const command = {
      type: "secureCommand",
      userId: currentUser.username,
      securityKey: currentUser.securityKey,
      deviceId: selectedDeviceId || "esp32_001",
      command: `relay:${idx}:${state}`
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
const http = require("http");
const https = require("https");
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');
const { initDatabase, userDB, deviceDB, sessionDB, securityKeyDB, layoutDB, portDB } = require('./database');

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

// Güvenlik anahtarı
function generateSecurityKey() {
  return crypto.randomBytes(32).toString('hex');
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
  const { full_name, email, role, is_active } = req.body;
  await userDB.updateUser(req.params.userId, { name: full_name, email, role, is_active });
  res.json({ success:true });
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
    const mapped = rows.map(d => ({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_name:d.owner_name||'Sahipsiz', location:d.location||'Belirtilmemiş', description:d.description||'Açıklama yok' }));
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

wss.on("connection", (ws) => {
  console.log('Client connected');
  console.log('Current ESP32 status:', connectedDevices.size > 0 ? `${connectedDevices.size} cihaz bağlı` : 'Cihaz yok');
  ws.on('message', async (msg) => {
    msg = msg.toString();
    try {
      if (msg.startsWith('{')) {
        const data = JSON.parse(msg);
        if (data.type === 'userAuth') {
          ws.userId = data.userId; // username
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
              // Mevcut cihazı güncelle (son görülme zamanı, durum vb.)
              await deviceDB.updateByDeviceId(data.deviceId, {
                device_name: data.deviceName || existingDevice.device_name,
                ip_address: data.ip_address || existingDevice.ip_address,
                mac_address: data.mac_address || existingDevice.mac_address,
                location: data.location || existingDevice.location,
                description: data.description || existingDevice.description,
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
          const selectedDeviceId = ws.selectedDeviceId || 'esp32_001'; // Varsayılan cihaz
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
  });
});

// Ana sayfa route'u
app.get('/', requireAuth, (req, res) => {
  console.log('🏠 Ana sayfa route çağrıldı, userId:', req.userId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server başlatma
(async () => {
  try {
    await initDatabase();
    console.log('✅ Veritabanı başlatıldı');
    await sessionDB.cleanExpiredSessions();
    console.log('✅ Süresi dolmuş session\'lar temizlendi');
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

- Frontend tarafında röle mesajlarını iki kez işleme ihtimalini kestim: `main.js` içinde `onmessage` akışında `relay:` mesajlarını artık sadece `relay_status.js` işler; `main.js` bu mesajları loglamıyor ve UI güncellemesi yapmıyor.
- Sunucuda `secureCommand` için 400 ms’lik basit debounce ekledim; aynı komut arka arkaya gelirse tekrarı engelliyor. Ayrıca cihaz/client ayrımını `ws.isDevice` ile netleştirmeye devam ediyoruz.
- ESP32 heartbeat JSON buffer’ı zaten büyütülmüştü; boş `{}` sorunu kalkmış olmalı.

Lütfen server’ı yeniden başlatıp sayfayı yenileyip tekrar dene. Hala aynıysa, `relay_status.js`’de tekil tekrarı atlama eşiğini artırabiliriz veya komut tarafında tek-shot koruması ekleyebiliriz.

---

**User**

esp tarafinda bak lutfen orada bir loopback oluyor galba

---

**Cursor**

ESP32 tarafındaki tekrarları kesmek için iki değişiklik yapıyorum: 1) WebSocket TEXT mesajlarında 'relay:' komutlarına dedup (aynı komut kısa aralıkta gelirse yok say), 2) Röle durumu zaten aynıysa tekrar durum mesajı göndermeyi engelle. Bu, olası loopback/döngüleri pratikte keser. Değişiklikleri şimdi uyguluyorum.

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
#include "DeviceConfig.h"
// Cihaz konfigürasyonunu seçin:
#include "../device_configs/esp32_001.h"  // Ana Kontrol
// #include "../device_configs/esp32_002.h"  // Yatak Odası
// #include "../device_configs/esp32_003.h"  // Mutfak
#include <ESP32Ping.h> // Ping için gerekli

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

// WOL device list
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip;
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

WOLDevice devices[] = {
  {"Server", {0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), WOLDevice::OFFLINE, 0},
  {"B350",   {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), WOLDevice::OFFLINE, 0},
  {"Main",   {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), WOLDevice::OFFLINE, 0}
};

const int deviceCount = sizeof(devices) / sizeof(devices[0]);

WiFiUDP udp;
WebSocketsClient webSocket;

// ----------------- WOL -----------------
void sendWOL(byte* mac) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], mac, 6);

  udp.beginPacket("192.168.1.255", 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
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
  for (int i = 0; i < deviceCount; i++) {
    sendStatus(devices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state);
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

  // Röleyi kontrol et
  digitalWrite(relayPins[index], state ? HIGH : LOW);
  deviceStatus.relays[index].state = state;
  deviceStatus.relays[index].lastChange = millis();
  
  // Durumu WebSocket'e gönder
  String stateStr = state ? "on" : "off";
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr);
  
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
      break;
    }

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

      // Tekrarlayan röle komutlarını filtrele (debounce)
      static String lastRelayCmd = "";
      static unsigned long lastRelayCmdTime = 0;
      if (msg.startsWith("relay:")) {
        unsigned long nowMs = millis();
        if (msg == lastRelayCmd && (nowMs - lastRelayCmdTime) < 300) {
          // Aynı komut kısa süre içinde tekrar geldiyse yok say
          break;
        }
        lastRelayCmd = msg;
        lastRelayCmdTime = nowMs;
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
      else if (msg == "getRelayStatus") {
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg == "getWolStatus") {
        for (int i = 0; i < deviceCount; i++) {
          WOLDevice &dev = devices[i];
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

  buzzerInit();
  ledInit();
  ledBlink(300);

  connectToWiFi();

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ----------------- LOOP -----------------
void loop() {
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

- ESP32’de `setRelayWithWebSocket` artık aynı durumda ise tekrar mesaj üretmiyor.
- `webSocketEvent` içinde `relay:` komutları için 300 ms dedup eklendi; aynı komut kısa arayla gelirse yok sayılıyor.

Test et: relay:6:on spamı kesildi mi? Devam ederse aralığı artırırız veya komut imzasına timestamp kontrolü ekleriz.

---

**User**

role tusuna hizli bir sekilde basinca ayni loopback tekrar yasaniyor.

---

**Cursor**

Hızlı basışta tekrarı kesin kaynaktan bulmak için, admin.js tarafındaki WebSocket onmessage ve röle komut gönderimini de tarayacağım; ayrıca ESP32’de debounce süresini artırıp güvenli bir “busy” penceresi ekleyeceğim. Ardından gerekli küçük editleri uygulayacağım.

```cpp
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include "password.h"
#include "Buzzer.h"
#include "StatusLED.h"
#include "DeviceConfig.h"
// Cihaz konfigürasyonunu seçin:
#include "../device_configs/esp32_001.h"  // Ana Kontrol
// #include "../device_configs/esp32_002.h"  // Yatak Odası
// #include "../device_configs/esp32_003.h"  // Mutfak
#include <ESP32Ping.h> // Ping için gerekli

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins - DeviceConfig.h'den alınıyor

// WOL device list
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip;
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

WOLDevice devices[] = {
  {"Server", {0x94, 0xC6, 0x91, 0x9C, 0x49, 0xA1}, IPAddress(192,168,1,37), WOLDevice::OFFLINE, 0},
  {"B350",   {0x30, 0x9C, 0x23, 0x03, 0xDE, 0xE5}, IPAddress(192,168,1,38), WOLDevice::OFFLINE, 0},
  {"Main",   {0xE8, 0x9C, 0x25, 0xC6, 0xB8, 0x26}, IPAddress(192,168,1,11), WOLDevice::OFFLINE, 0}
};

const int deviceCount = sizeof(devices) / sizeof(devices[0]);

WiFiUDP udp;
WebSocketsClient webSocket;

// Komut debouncing ve relay cooldown kontrolü
static String lastRelayCmd = "";
static unsigned long lastRelayCmdTime = 0;
static unsigned long relayCooldownUntil[RELAY_COUNT] = {0};

// ----------------- WOL -----------------
void sendWOL(byte* mac) {
  byte packet[102];
  for (int i = 0; i < 6; i++) packet[i] = 0xFF;
  for (int i = 1; i <= 16; i++) memcpy(&packet[i * 6], mac, 6);

  udp.beginPacket("192.168.1.255", 9);
  udp.write(packet, sizeof(packet));
  udp.endPacket();
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
  for (int i = 0; i < deviceCount; i++) {
    sendStatus(devices[i]);
  }
}

// ----------------- Röle durumlarını gönder -----------------
void getRelayStatus() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    String state = deviceStatus.relays[i].state ? "on" : "off";
    webSocket.sendTXT("relay:" + String(i) + ":" + state);
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
  webSocket.sendTXT("relay:" + String(index) + ":" + stateStr);
  
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
    for (int i = 0; i < deviceCount; i++) {
      WOLDevice &dev = devices[i];
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
      else if (msg == "getRelayStatus") {
        getRelayStatus();
      }

      // --- 3️⃣ WOL gönder ---
      else if (msg.startsWith("wol:")) {
        int devIndex = msg.substring(4).toInt();
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg == "getWolStatus") {
        for (int i = 0; i < deviceCount; i++) {
          WOLDevice &dev = devices[i];
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

  buzzerInit();
  ledInit();
  ledBlink(300);

  connectToWiFi();

  // WebSocket bağlantısı (WSS) - konfigürasyon dosyasından host/port alınıyor
  webSocket.beginSSL(WS_SERVER_IP, WS_SERVER_PORT, "/");
  // Ping/pong keepalive
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ----------------- LOOP -----------------
void loop() {
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

- ESP32’de her röle için 200 ms “cooldown” penceresi ekledim; bu pencere dolmadan gelen aynı röle komutu yok sayılıyor.
- 300 ms genel komut dedup’ı da yerinde duruyor. Hızlı tıklamalarda döngüyü keser.

Hala tekrarlarsa cooldown’ı 400–500 ms yapalım veya `toggle` çağrılarını da aynı pencereyle koruyalım.

