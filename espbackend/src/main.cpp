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
