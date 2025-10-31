# WebSocket command structure and dynamic GUI
_Exported on 10/31/2025 at 13:57:05 GMT+3 from Cursor (1.7.52)_

---

**User**

websocketten komut atilirken device id ile atilsin.

cunku sanirsam 2 farkli websocket portu acamiyoruz (yanlis biliyorsam uyar.) cihazlar sadece kendi idsi ile atilan websocketlere cevap versin mesela:

"getWolStatus id:esp32_yusuf" bunun gibi olsun. 

ayni zamanda index.html'de bulunan control panel ogeleri dinamik yapalim. esp32 baglanti yapildiginda kendisi relay varsa relay durumunu verecek ve wol varsa wol durumunu verecek ve bizim GUImiz boyle olusturulacak. 

kabataslak ornek

"
RelayCount: 8;
relay:0,
relay:1,
relay:2,
relay:3,
relay:4,
relay:5,
relay:6,
relay:7
wolDevices;
Server= wol:0
B350= wol:1
Main= wol:2
"

kullanici, izinine sahip oldugu espye bir sorgu atacak ve sorgunun sonrasinda gelen bilgilere gore dinamik gui olusacak. 

Komutlar atilirken her esp kendi idsi olan mesaja cevap verecek.

---

**Cursor**

ESP32 ve web arayüzü arasında WebSocket mesaj akışını ve ID tabanlı adreslemeyi anlamak için ilgili yerleri arayıp okuyorum; ardından ESP32 ve frontend tarafında gerekli düzenlemeleri yapacağım.

Şimdi frontend'te röle ve WOL mesajlarının nasıl işlendiğini görmek ve dinamik GUI için nereleri düzenleyeceğimizi belirlemek için ilgili script dosyalarını açıyorum.

Cihaz id'li komut ve dinamik kontrol panelini uygulayabilmek için `index.html` yapısını da açıyorum; ardından hem ESP32 tarafında ID filtrelemesi hem de frontend tarafında dinamik UI üretimini düzenleyeceğim.

Cihaz kimliğiyle hedefleme ve dinamik arayüz için hem ESP32 tarafına ID filtresi ve özellik mesajı ekleyeceğim, hem de frontend'te ID’li istek ve dinamik render işlemlerini uygulayacağım. Şimdi gerekli dosyalara düzenlemeleri yapıyorum.

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
//#include "../device_configs/esp32_001.h"  // Ana Kontrol
 #include "../device_configs/esp32_002.h"  // Yatak Odası
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
  for (int i = 0; i < deviceCount; i++) {
    json += "{\"index\":" + String(i) + ",\"name\":\"" + String(devices[i].name) + "\"}";
    if (i < deviceCount - 1) json += ",";
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
      // Bağlantı sonrası yetenekleri bildir
      sendCapabilities();
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
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg.startsWith("getWolStatus")) { // getWolStatus [id:xxx]
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

Önce ESP32 tarafına ID filtreleme ve “capabilities” mesajını ekledim. Şimdi frontend’te ID’li komut gönderimi ve dinamik kontrol paneli için düzenlemeleri yapıyorum.

ESP32 tarafındaki değişiklikleri bitirdim; şimdi frontend'te ID’li komut gönderimi ve dinamik UI için `main.js`, `relay_status.js`, `wol_status.js`, ve `index.html` üzerinde çalışacağım. Ardından seçili cihaza göre `getCapabilities` ve durum isteklerini tetikleyeceğim.

```javascript
// WOL Status fonksiyonları - main.js'deki ws.onmessage'a entegre edildi

function handleWOLStatus(msg) {
  if (msg.startsWith("status:")) {
    // status:DeviceName:STATE formatı
    const parts = msg.split(":");
    if (parts.length === 3) {
      const deviceName = parts[1];
      const state = parts[2]; // RUNNING, OFFLINE, BOOTING

      const wolDevices = document.querySelectorAll(".wol_device");
      wolDevices.forEach(li => {
        const statusEl = li.querySelector(".wol_status");       // Renkli rectangle
        const statustextEl = li.querySelector(".wol_statustext"); // Yazı

        const nameEl = li.querySelector(".wol_name");
        if (nameEl.textContent === deviceName) {
          // Renk ve yazıyı duruma göre ayarla
          switch(state) {
            case "RUNNING":
              statusEl.style.backgroundColor = "#0f0"; 
              statustextEl.textContent = "Running";
              break;
            case "OFFLINE":
              statusEl.style.backgroundColor = "#555"; 
              statustextEl.textContent = "Offline";
              break;
            case "BOOTING":
              statusEl.style.backgroundColor = "#ff0"; 
              statustextEl.textContent = "Booting";
              break;
            default:
              statusEl.style.backgroundColor = "#888"; 
              statustextEl.textContent = state;
          }
        }
      });
    }
  }
}

// WOL buton fonksiyonları
function sendWOL(idx) {
  // Güvenlik anahtarı kontrolü
  if (!currentUser || !currentUser.securityKey) {
    logMessage(`Güvenlik anahtarı bulunamadı! WOL ${idx} gönderilemedi`, "ERROR");
    return;
  }
  
  // Güvenli komut gönder
  const command = {
    type: "secureCommand",
    userId: currentUser.username,
    securityKey: currentUser.securityKey,
    deviceId: selectedDeviceId || "esp32_001",
    command: `wol:${idx} id:${selectedDeviceId || "esp32_001"}`
  };
  
  ws.send(JSON.stringify(command));
  logMessage(`Güvenli WOL ${idx} gönderildi`, "CLIENT");
}

// WOL durumlarını iste
function getWOLStatus() {
  const message = `getWolStatus id:${selectedDeviceId || "esp32_001"}`;
  ws.send(message);
  logMessage(message, "CLIENT");
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
    ws.send(`getRelayStatus id:${selectedDeviceId || "esp32_001"}`);
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
    case "capabilities":
      // Dinamik UI oluşturma: relay ve WOL listelerini yeniden çizeceğiz
      renderDynamicControls(data);
      break;
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
    ws.send(`getRelayStatus id:${selectedDeviceId || "esp32_001"}`);
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
      break;
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
    ws.send(`getRelayStatus id:${selectedDeviceId || "esp32_001"}`);
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
      break;
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

// Dinamik kontrol paneli render
function renderDynamicControls(cap) {
  try {
    // Relay paneli
    const relayContainer = document.getElementById('relaylist');
    if (relayContainer && typeof cap.relayCount === 'number') {
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
// Röle göstergelerini WebSocket mesajlarına göre güncelle
function initRelayStatus(ws) {
  let lastMessage = "";
  let messageCount = 0;
  
  ws.addEventListener("message", (event) => {
    const msg = event.data;

    // Röle durum mesajlarını işle
    if (msg.startsWith("relay:")) {
      // Aynı mesajın tekrarını önle
      if (msg === lastMessage) {
        messageCount++;
        if (messageCount > 1) {
          console.log(`Tekrarlanan mesaj atlandı: ${msg} (${messageCount} kez)`);
          return;
        }
      } else {
        lastMessage = msg;
        messageCount = 1;
      }
      
      // Örnek mesaj: relay:3:on
      const parts = msg.split(":");
      const index = parseInt(parts[1]);
      const state = parts[2];

      // İndikatörü bul
      const indicator = document.getElementById("relay_status_" + index);
      if (indicator) {
        indicator.classList.remove("on", "off");
        indicator.classList.add(state === "on" ? "on" : "off");
      }
    }
  });
}

// WebSocket bağlantısı hazır olduğunda initRelayStatus çağrılacak
// main.js'de ws.onopen içinde çağrılıyor

// Yardımcı fonksiyonlar
function updateRelayStatus(relayId, state) {
  const statusElement = document.getElementById(`relay_status_${relayId}`);
  if (statusElement) {
    // Eski class'ları kaldır
    statusElement.classList.remove('on', 'off');
    
    // Yeni class'ı ekle
    if (state === 'on' || state === true) {
      statusElement.classList.add('on');
    } else {
      statusElement.classList.add('off');
    }
  }
}

function updateAllRelayStatuses(relayStates) {
  relayStates.forEach((state, index) => {
    updateRelayStatus(index, state);
  });
}

// Toggle relay fonksiyonu
function toggleRelay(relayId) {
  const statusElement = document.getElementById(`relay_status_${relayId}`);
  if (statusElement) {
    const isOn = statusElement.classList.contains('on');
    const newState = isOn ? 'off' : 'on';
    
    // Sadece mesajı gönder, UI'yi güncelleme (ESP32'den gelecek)
    sendRelay(relayId, newState);
  }
}

// Relay butonlarına tıklama olayları ekle
document.addEventListener("DOMContentLoaded", () => {
  // Tüm relay butonlarına tıklama olayı ekle
  const relayButtons = document.querySelectorAll('[data-relay]');
  relayButtons.forEach(button => {
    const relayId = parseInt(button.getAttribute('data-relay'));
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRelay(relayId);
    });
  });
});

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
    ws.send(`getRelayStatus id:${selectedDeviceId || "esp32_001"}`);
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
      break;
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

// Dinamik kontrol paneli render
function renderDynamicControls(cap) {
  try {
    // Relay paneli
    const relayContainer = document.getElementById('relaylist');
    if (relayContainer && typeof cap.relayCount === 'number') {
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
      command: `relay:${idx}:${state} id:${selectedDeviceId || "esp32_001"}`
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

- ESP32 tarafına ID filtrelemesi ve “capabilities” JSON’u eklendi. Bağlanınca cihaz `relayCount` ve `wol` listesini gönderiyor. Ayrıca gelen komutlarda `" id:<DEVICE_ID>"` varsa ve eşleşmiyorsa cihaz yok sayıyor.
- Frontend’te komutlar ID’li gönderiliyor: `relay`, `getRelayStatus`, `getWolStatus`, `sendWOL`. Seçili cihaz değişince `getCapabilities/getRelayStatus/getWolStatus` tetikleniyor.
- Frontend’e dinamik render eklendi: gelen `capabilities` ile `relaylist` ve `wol_list` içerikleri oluşturuluyor.

Kısa test yönergesi:
- `index.html` açıldıktan sonra bir cihaz seçin; otomatik `getCapabilities` gönderilir, UI dinamik oluşur.
- Röle tuşları ve WOL butonları, `id:<selectedDeviceId>` ile hedef cihaza gider.
- ESP32 tarafında sadece kendi `DEVICE_ID`’siyle gelen mesajlara yanıt verir; ID’siz mesajlar geriye dönük uyumluluk için kabul edilir.

Yapılan önemli editler:
```182:216:espbackend/src/main.cpp
// Yardımcı: hasIdButNotForThisDevice(...) ve sendCapabilities() eklendi
// WStype_CONNECTED sonrası sendCapabilities()
// Komutlarda id filtrelemesi ve getCapabilities desteği
```

```55:80:espfrontend/public/scripts/wol_status.js
// secureCommand ve getWOLStatus mesajlarına id:<selectedDeviceId> eklendi
```

```24:32:espfrontend/public/scripts/main.js
// İlk isteklerde getRelayStatus mesajına id eklendi
```

```606:644:espfrontend/public/scripts/main.js
// handleJSONMessage içinde \"capabilities\" case’i ve renderDynamicControls(...)
```

```494:531:espfrontend/public/scripts/main.js
// Cihaz seçim değişiminde getCapabilities/getRelayStatus/getWolStatus tetikleniyor
```

```644:706:espfrontend/public/scripts/main.js
// sendRelay komutu id ile gönderiliyor
```

```644:706:espfrontend/public/scripts/main.js
// renderDynamicControls: relay ve WOL UI’ını gelen capabilities’e göre kuruyor
```

- Not: Şu an `index.html`’de başlangıçta statik 8 röle + 3 WOL listesi duruyor; capabilities geldikten sonra dinamik olarak yeniden çiziliyor. İstersen dilersek statik başlangıç bloklarını minimal bir iskelete indirip tamamen dinamik açılış yapabiliriz.

Sonraki adım isteğe bağlı:
- İzin bazlı cihaz seçeneklerini filtrelemek (zaten API filtreliyor).
- JSON tabanlı response’lara cihaz id’si eklemek (UI loglarında netlik için).

```cpp
// Yardımcı: hasIdButNotForThisDevice(...) ve sendCapabilities() eklendi
// WStype_CONNECTED sonrası sendCapabilities()
// Komutlarda id filtrelemesi ve getCapabilities desteği
```

```javascript
// secureCommand ve getWOLStatus mesajlarına id:<selectedDeviceId> eklendi
```

```javascript
// İlk isteklerde getRelayStatus mesajına id eklendi
```

```javascript
// handleJSONMessage içinde \"capabilities\" case’i ve renderDynamicControls(...)
```

```javascript
// Cihaz seçim değişiminde getCapabilities/getRelayStatus/getWolStatus tetikleniyor
```

```javascript
// sendRelay komutu id ile gönderiliyor
```

```javascript
// renderDynamicControls: relay ve WOL UI’ını gelen capabilities’e göre kuruyor
```

---

**User**

index.html'de her seyi ya display: none yapalim ya da farkli bir yerde bu indexi tutalim. kafa karistirici oluyor. indeximiz bos kalsin

---

**Cursor**

Index'i sadeleştirip statik röle/WOL öğelerini kaldıracağım; bölümleri başlangıçta gizleyip capabilities geldikten sonra görünür yapacağım. Ardından dinamik render fonksiyonunda bu bölümleri otomatik olarak göstereceğim.

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@100..900&display=swap" rel="stylesheet">
  <title>FatihDev</title>
  <link rel="icon" type="image/x-icon" href="/img/favicon256.ico">
  <meta name="theme-color" content="#1f1f1f">
  <link rel="stylesheet" href="./css/style.css">
</head>

<body>
    <div id="toast-container" style="position:fixed; right:12px; bottom:12px; z-index:9999; display:flex; flex-direction:column; gap:8px; align-items:flex-end;"></div>
  <div class="main-container">
    <div id="top">
      <div>
        <div>
          <h1>FatihDev</h1>
          <div id="connection-status">Bağlantı Kontrol Ediliyor...</div>
          <button id="reconnect-btn" onclick="manualReconnect()" style="display:none; margin-left: 10px; padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Yeniden Bağlan</button>
        </div>
        <div>
          <span id="user-info">Yükleniyor...</span>
          <span id="username" style="display: none;"></span>
          <span id="userRole" style="display: none;"></span>
          <button id="admin-btn" onclick="goToAdmin()" style="display: none;">Admin</button>
          <button id="logout-btn" onclick="logout()">Çıkış</button>
        </div>
      </div>
    </div>

    <div id="device-selector" style="display:none;">
      <label for="device-select">Cihaz Seçin:</label>
      <select id="device-select">
        <option value="">Cihaz yükleniyor...</option>
      </select>
    </div>

    <div id="controlpanel" style="display:none;">
      <!-- Relayler -->
      <div id="relay_parent" style="display:none;">
        <h2>Relays</h2>
        <div class="relaygroup" id="relaylist"></div>
      </div>

      <!-- WOL -->
      <div id="wol_parent" style="display:none;">
        <h2>Wake-on-LAN</h2>
        <ul id="wol_list"></ul>
      </div>
    </div>

    <div id="log_parent" style="display:none;">
      <div class="log-header">
        <h3>Log</h3>
        <button onclick="clearLog()" class="clear-log-btn">Temizle</button>
      </div>
      <pre id="log"></pre>
    </div>
  </div>

  <!-- Inline JavaScript kaldırıldı - main.js ve wol_status.js'de tanımlandı -->
  
  <script src="./scripts/main.js"></script>
  <script src="./scripts/relay_status.js"></script>
  <script src="./scripts/wol_status.js"></script>
  <script src="./scripts/button.js"></script>


</body>
</html>

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
    
    // Bağlantı durumunu güncelle ve temel bölümleri aç
    updateConnectionStatus(true);
    const deviceSelector = document.getElementById('device-selector');
    if (deviceSelector) deviceSelector.style.display = '';
    const logParent = document.getElementById('log_parent');
    if (logParent) logParent.style.display = '';
  
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
    ws.send(`getRelayStatus id:${selectedDeviceId || "esp32_001"}`);
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
      break;
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
      if (relayParent) relayParent.style.display = '';
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
      command: `relay:${idx}:${state} id:${selectedDeviceId || "esp32_001"}`
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

Hepsini görünmez yaptım; `index.html` artık boş bir iskelet. UI yalnızca capabilities geldikten sonra dinamik oluşturuluyor ve ilgili bölümler görünür oluyor. 

- `index.html`: Statik röle/WOL blokları kaldırıldı, `device-selector`, `controlpanel`, `relay_parent`, `wol_parent`, `log_parent` başlangıçta `display:none`.
- `main.js`: WebSocket bağlanınca üst öğeler açılıyor; `capabilities` alındığında `renderDynamicControls` kontrol panelini, relay ve WOL bölümlerini görünür yapıp içerikleri çiziyor. 

Kısaca: sayfa sade; cihaz bağlanıp `capabilities` gönderince GUI oluşuyor.

---

**User**

sitede surekli "Hata: Cihaz çevrimdışı: esp32_001"

hatasini aliyorum. kodda direkt esp32_001'e baglanmaya calisiyor. bu kodu degistirelim. kullanici hangi cihazi secmisse onla islem yapacak.

---

**Cursor**

Seçili cihaz yokken varsayılan olarak esp32_001’e gitmeyi kaldırıyorum ve istekleri ancak kullanıcı bir cihaz seçtiğinde gönderecek şekilde düzeltiyorum. Ayrıca sunucudaki varsayılan esp32_001 fallback’ını kaldırıp “Önce cihaz seçin” hatası döndüreceğim.

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
    
    // Bağlantı durumunu güncelle ve temel bölümleri aç
    updateConnectionStatus(true);
    const deviceSelector = document.getElementById('device-selector');
    if (deviceSelector) deviceSelector.style.display = '';
    const logParent = document.getElementById('log_parent');
    if (logParent) logParent.style.display = '';
  
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
      break;
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
      if (relayParent) relayParent.style.display = '';
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
// WOL Status fonksiyonları - main.js'deki ws.onmessage'a entegre edildi

function handleWOLStatus(msg) {
  if (msg.startsWith("status:")) {
    // status:DeviceName:STATE formatı
    const parts = msg.split(":");
    if (parts.length === 3) {
      const deviceName = parts[1];
      const state = parts[2]; // RUNNING, OFFLINE, BOOTING

      const wolDevices = document.querySelectorAll(".wol_device");
      wolDevices.forEach(li => {
        const statusEl = li.querySelector(".wol_status");       // Renkli rectangle
        const statustextEl = li.querySelector(".wol_statustext"); // Yazı

        const nameEl = li.querySelector(".wol_name");
        if (nameEl.textContent === deviceName) {
          // Renk ve yazıyı duruma göre ayarla
          switch(state) {
            case "RUNNING":
              statusEl.style.backgroundColor = "#0f0"; 
              statustextEl.textContent = "Running";
              break;
            case "OFFLINE":
              statusEl.style.backgroundColor = "#555"; 
              statustextEl.textContent = "Offline";
              break;
            case "BOOTING":
              statusEl.style.backgroundColor = "#ff0"; 
              statustextEl.textContent = "Booting";
              break;
            default:
              statusEl.style.backgroundColor = "#888"; 
              statustextEl.textContent = state;
          }
        }
      });
    }
  }
}

// WOL buton fonksiyonları
function sendWOL(idx) {
  // Güvenlik anahtarı kontrolü
  if (!currentUser || !currentUser.securityKey) {
    logMessage(`Güvenlik anahtarı bulunamadı! WOL ${idx} gönderilemedi`, "ERROR");
    return;
  }
  
  // Güvenli komut gönder
  if (!selectedDeviceId) {
    showToast('Önce bir cihaz seçin', 'error');
    return;
  }

  const command = {
    type: "secureCommand",
    userId: currentUser.username,
    securityKey: currentUser.securityKey,
    deviceId: selectedDeviceId,
    command: `wol:${idx} id:${selectedDeviceId}`
  };
  
  ws.send(JSON.stringify(command));
  logMessage(`Güvenli WOL ${idx} gönderildi`, "CLIENT");
}

// WOL durumlarını iste
function getWOLStatus() {
  if (!selectedDeviceId) { console.log('Cihaz seçilmedi; WOL status istenmedi'); return; }
  const message = `getWolStatus id:${selectedDeviceId}`;
  ws.send(message);
  logMessage(message, "CLIENT");
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

- Frontend’te varsayılan `esp32_001` fallback’larını kaldırdım. Seçim yoksa istek gönderilmiyor ve “Önce bir cihaz seçin” uyarısı gösteriliyor.
- Sunucuda da varsayılan hedef kaldırıldı; seçili cihaz yoksa `error: 'Önce cihaz seçin'` döndürülüyor.

Kritik değişiklikler:
- `public/scripts/main.js`: ilk açılış ve zamanlamalı istekler, `sendRelay` seçili cihaz zorunlu.
- `public/scripts/wol_status.js`: `sendWOL` ve `getWOLStatus` seçili cihaz yoksa çalışmıyor.
- `server.js`: client mesajlarında `ws.selectedDeviceId` zorunlu; yoksa hata gönderiliyor.

Artık sadece kullanıcı hangi cihazı seçtiyse o cihaza komut ve sorgu gidiyor; “Cihaz çevrimdışı: esp32_001” hatası, seçim yapılmadıkça veya offline cihaz seçilmedikçe gösterilmeyecek.

---

**User**

ana sayfaya elementler gelmiyor. problem var gibi logda bisi yok 

"📄 Sayfa yüklendi, kullanıcı kontrolü yapılıyor...
main.js:220 🍪 Current cookies: 
main.js:221 🍪 Cookie count: 1
main.js:222 🍪 Has sessionId: false
main.js:227 🍪 Extracted sessionId: YOK
main.js:233 🍪 localStorage'dan sessionId alındı: b6b93ba377...
main.js:235 🍪 Cookie localStorage'dan set edildi
main.js:241 🧪 Test endpoint: https://fatihdev.xyz:5130/api/user-simple
main.js:243 🧪 Test response: 200
main.js:245 🧪 Test data: {username: 'test', name: 'Test User', role: 'user'}
main.js:248 🌐 Current origin: https://fatihdev.xyz
main.js:249 🌐 API URL: https://fatihdev.xyz:5130/api/user
main.js:258 👤 User API response: 200
main.js:259 👤 User API response headers: Headers {}
main.js:260 👤 Response content-type: application/json; charset=utf-8
main.js:272 👤 User data: {username: 'yusuf', name: '', role: 'user'}
main.js:279 🔍 Username element: <span id=​"username" style=​"display:​ none;​">​yusuf​</span>​
main.js:280 🔍 UserRole element: <span id=​"userRole" style=​"display:​ none;​">​user​</span>​
main.js:284 ✅ Username set edildi: yusuf
main.js:291 ✅ UserRole set edildi: user
main.js:300 ✅ User info güncellendi
main.js:314 🔑 Güvenlik anahtarı alındı: e66d1303...
main.js:355 📱 Cihazlar yükleniyor...
main.js:366 📱 Cihazlar yüklendi: (2) [{…}, {…}]
main.js:379 ✅ Cihaz seçici güncellendi
main.js:26 WebSocket bağlantısı kuruluyor... (Deneme: 1/5) - wss://fatihdev.xyz:5131/
main.js:49 WebSocket bağlandı: wss://fatihdev.xyz:5131/
main.js:50 WebSocket readyState: 1
main.js:467 Güvenlik anahtarı alındı: 1d640f51...
main.js:80 Cihaz seçilmedi; WOL status isteği gönderilmedi
main.js:89 Cihaz seçilmedi; relay status isteği gönderilmedi"

---

**Cursor**

Cihaz seçici ilk yüklemede sadece HTML’i dolduruyor ama selectedDeviceId ayarlanmıyor; bu yüzden istekler gönderilmiyor. Şimdi `loadDevices()` içinde ilk cihaza otomatik seçim, `selectedDeviceId` set etme ve WS açıkken `deviceSelection/getCapabilities/getRelayStatus/getWolStatus` gönderimini ekleyeceğim.

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
    
    // Bağlantı durumunu güncelle ve temel bölümleri aç
    updateConnectionStatus(true);
    const deviceSelector = document.getElementById('device-selector');
    if (deviceSelector) deviceSelector.style.display = '';
    const logParent = document.getElementById('log_parent');
    if (logParent) logParent.style.display = '';
  
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
      break;
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
      if (relayParent) relayParent.style.display = '';
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

- İlk yüklemede cihaz seçilmediği için istekler gitmiyordu. `loadDevices()` içine cihaz listesi geldikten sonra ilk cihazı otomatik seçip `selectedDeviceId` setledim ve WS açıksa `deviceSelection` + `getCapabilities/getRelayStatus/getWolStatus` gönderttim.
- Artık ana sayfa açılır açılmaz ilk cihazın elementleri görünür hale gelmeli; farklı cihaz seçince yine aynı akış tetiklenir.

---

**User**

📄 Sayfa yüklendi, kullanıcı kontrolü yapılıyor...
main.js:220 🍪 Current cookies: 
main.js:221 🍪 Cookie count: 1
main.js:222 🍪 Has sessionId: false
main.js:227 🍪 Extracted sessionId: YOK
main.js:233 🍪 localStorage'dan sessionId alındı: b6b93ba377...
main.js:235 🍪 Cookie localStorage'dan set edildi
main.js:241 🧪 Test endpoint: https://fatihdev.xyz:5130/api/user-simple
main.js:243 🧪 Test response: 200
main.js:245 🧪 Test data: {username: 'test', name: 'Test User', role: 'user'}
main.js:248 🌐 Current origin: https://fatihdev.xyz
main.js:249 🌐 API URL: https://fatihdev.xyz:5130/api/user
main.js:258 👤 User API response: 200
main.js:259 👤 User API response headers: Headers {}
main.js:260 👤 Response content-type: application/json; charset=utf-8
main.js:272 👤 User data: {username: 'yusuf', name: '', role: 'user'}
main.js:279 🔍 Username element: <span id=​"username" style=​"display:​ none;​">​yusuf​</span>​
main.js:280 🔍 UserRole element: <span id=​"userRole" style=​"display:​ none;​">​user​</span>​
main.js:284 ✅ Username set edildi: yusuf
main.js:291 ✅ UserRole set edildi: user
main.js:300 ✅ User info güncellendi
main.js:314 🔑 Güvenlik anahtarı alındı: 8622f432...
main.js:355 📱 Cihazlar yükleniyor...
main.js:366 📱 Cihazlar yüklendi: (2) [{…}, {…}]
main.js:379 ✅ Cihaz seçici güncellendi
main.js:398 ❌ Cihaz yükleme hatası: ReferenceError: selectedDeviceId is not defined
    at loadDevices (main.js:382:9)
    at async HTMLDocument.<anonymous> (main.js:321:7)
loadDevices @ main.js:398
await in loadDevices
(anonymous) @ main.js:321Understand this error
main.js:26 WebSocket bağlantısı kuruluyor... (Deneme: 1/5) - wss://fatihdev.xyz:5131/
main.js:49 WebSocket bağlandı: wss://fatihdev.xyz:5131/
main.js:50 WebSocket readyState: 1
main.js:480 Güvenlik anahtarı alındı: fd8dcc79...
main.js:80 Cihaz seçilmedi; WOL status isteği gönderilmedi
main.js:89 Cihaz seçilmedi; relay status isteği gönderilmedi


bu fonksiyon cihaz secilmeden once geliyor bu fonksiyonu cihaz secildikten sonra yapalim

---

**Cursor**

Cihaz seçimi yapılmadan önce kullanılan `selectedDeviceId` değişkeni global tanımlı olmadığı için hata alınıyor. Şimdi `main.js` içinde bu değişkenleri dosya seviyesinde en üste taşıyıp, fonksiyon çağrılarını seçim sonrasına koşullandırıyorum. Ardından dosyayı kontrol edeceğim.

- Hatanın nedeni: `loadDevices()` içinde `selectedDeviceId` tanımlı değilken kullanılıyordu. Dosyanın en üstünde global tanımlı hale getirdim ve ilk cihazı seçip WS açıksa `deviceSelection + getCapabilities/getRelayStatus/getWolStatus` gönderiyorum.
- Ayrıca cihaz seçilmeden gelen zamanlamalı istekleri koşulla çalışacak şekilde bıraktım; şimdi ilk cihaz yüklenir yüklenmez otomatik seçim yapılıyor ve UI geliyor.

Lütfen yenileyip dener misin? Eğer yine gelmezse, cihazların `capabilities` mesajını gönderip göndermediğini logda görelim.

---

**User**


﻿
main.js:216 📄 Sayfa yüklendi, kullanıcı kontrolü yapılıyor...
main.js:220 🍪 Current cookies: 
main.js:221 🍪 Cookie count: 1
main.js:222 🍪 Has sessionId: false
main.js:227 🍪 Extracted sessionId: YOK
main.js:233 🍪 localStorage'dan sessionId alındı: b6b93ba377...
main.js:235 🍪 Cookie localStorage'dan set edildi
main.js:241 🧪 Test endpoint: https://fatihdev.xyz:5130/api/user-simple
main.js:243 🧪 Test response: 200
main.js:245 🧪 Test data: 
{username: 'test', name: 'Test User', role: 'user'}
main.js:248 🌐 Current origin: https://fatihdev.xyz
main.js:249 🌐 API URL: https://fatihdev.xyz:5130/api/user
main.js:258 👤 User API response: 200
main.js:259 👤 User API response headers: 
Headers {}
main.js:260 👤 Response content-type: application/json; charset=utf-8
main.js:272 👤 User data: 
{username: 'yusuf', name: '', role: 'user'}
main.js:279 🔍 Username element: 
main.js:280 🔍 UserRole element: 
main.js:284 ✅ Username set edildi: yusuf
main.js:291 ✅ UserRole set edildi: user
main.js:300 ✅ User info güncellendi
main.js:314 🔑 Güvenlik anahtarı alındı: 0bfd0a3d...
main.js:355 📱 Cihazlar yükleniyor...
main.js:366 📱 Cihazlar yüklendi: 
(2) [{…}, {…}]
main.js:379 ✅ Cihaz seçici güncellendi
main.js:398 ❌ Cihaz yükleme hatası: ReferenceError: selectedDeviceId is not defined
    at loadDevices (main.js:382:9)
    at async HTMLDocument.<anonymous> (main.js:321:7)
main.js:26 WebSocket bağlantısı kuruluyor... (Deneme: 1/5) - wss://fatihdev.xyz:5131/
main.js:49 WebSocket bağlandı: wss://fatihdev.xyz:5131/
main.js:50 WebSocket readyState: 1
main.js:480 Güvenlik anahtarı alındı: 1792c574...
main.js:80 Cihaz seçilmedi; WOL status isteği gönderilmedi
main.js:89 Cihaz seçilmedi; relay status isteği gönderilmedi



kullaniciya atadigimiz cihazlar default cihaz olsun. kullanici girdiginde o cihaz secilsin.

---

**Cursor**

Şu an hata, `selectedDeviceId` ve diğer global değişkenlerin `connectWebSocket()` fonksiyonunun içinde tanımlanmasından kaynaklanıyor. Bunları dosya üst seviyesine taşıyıp fonksiyon içindeki kopyayı kaldıracağım. Ardından ilk kullanıcı cihazını otomatik seçme davranışı çalışacak.

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
      break;
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
      if (relayParent) relayParent.style.display = '';
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

Cihaz seçimi yapılmadan kullanılan değişkenlerden kaynaklı hatayı düzelttim ve kullanıcıya atanmış ilk cihazı otomatik seçip gerekli istekleri gönderecek şekilde ayarladım. Şimdi çözümü kayda geçirmek için bir solves notu ekliyorum.

```markdown
*** Begin Patch
*** Add File: C:\Users\b350\Desktop\ESP32HOME_backup\solves\2025-10-25-frontend-selectedDeviceId-init.md
+# Frontend: selectedDeviceId undefined ve varsayılan cihaz seçimi

Tarih: 2025-10-25

Sorun:
- `index.html` sadeleştirmesi sonrası `selectedDeviceId` bazı akışlarda tanımlanmadan kullanıldı ve `ReferenceError: selectedDeviceId is not defined` hatası görüldü.
- Ana sayfada cihaz seçilmediği için `getWolStatus/getRelayStatus` çağrıları gönderilmiyordu; ayrıca varsayılan olarak `esp32_001` fallback istenmiyordu.

Çözüm:
- `public/scripts/main.js` içinde `currentUser`, `availableDevices`, `selectedDeviceId` değişkenleri dosya üstüne taşındı (global).
- `loadDevices()` cihazlar yüklenince kullanıcıya atanmış ilk cihazı otomatik seçiyor, `selectedDeviceId` set ediliyor ve WS açıksa şu istekler gönderiliyor: `deviceSelection`, `getCapabilities`, `getRelayStatus`, `getWolStatus`.
- WS `onopen` içerisindeki zamanlamalı istekler seçili cihaz yoksa gönderilmiyor.
- Sunucuda (server.js) seçili cihaz yoksa varsayılan `esp32_001` kaldırıldı; "Önce cihaz seçin" hatası dönüyor.

Etkisi:
- Sayfa açılır açılmaz kullanıcıya atanmış ilk cihaz otomatik seçilir ve arayüz dinamik olarak oluşur.
- ID tabanlı mesajlaşma korunur; yanlış cihaza komut gitmez.

İlgili dosyalar:
- `espfrontend/public/scripts/main.js`
- `espfrontend/public/scripts/wol_status.js`
- `espfrontend/server.js`
*** End Patch
```

```markdown
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

```

- `selectedDeviceId` artık global; hata giderildi.
- Kullanıcıya atanmış cihazlar `/api/devices` ile yükleniyor ve ilk cihaz otomatik seçiliyor.
- Seçim yapılır yapılmaz şu istekler gidiyor: `deviceSelection`, `getCapabilities`, `getRelayStatus`, `getWolStatus`.
- Seçim yokken hiçbir sorgu/komut gönderilmiyor; varsayılan `esp32_001` kaldırıldı.

Lütfen sayfayı yenileyip dener misin? İstersen varsayılan cihazı kullanıcı bazlı kalıcı tutmak için DB’ye “preferred_device_id” alanı ekleyip, seçim önceliğini oradan yapabiliriz.

- Önemli dosyalar: `espfrontend/public/scripts/main.js`, `espfrontend/public/scripts/wol_status.js`, `espfrontend/server.js`
- Not: Sorun ve çözüm `solves/2025-10-25-frontend-selectedDeviceId-init.md` dosyasına işlendi.

---

**User**

"[4:04:25 PM] Heartbeat: YUSUFESP - Uptime: 44594s
[4:04:25 PM] ESP32: {"type":"heartbeat","deviceId":"esp32_yusuf","deviceName":"YUSUFESP","status":"online","uptime":44594288,"ip_address":"192.168.1.149","mac_address":"30:C9:22:D2:2A:CC","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{"id":7,"state":false}]}
[4:04:25 PM] Cihaz Güncellendi: undefined - OFFLINE
[4:04:25 PM] ESP32: {"type":"deviceUpdated","deviceId":"esp32_yusuf","action":"updated"}
[4:04:25 PM] Heartbeat: FATIHESP - Uptime: 1237s
[4:04:25 PM] ESP32: {"type":"heartbeat","deviceId":"esp32_fatih","deviceName":"FATIHESP","status":"online","uptime":1237983,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{"id":7,"state":false}]}
[4:04:25 PM] Cihaz Güncellendi: undefined - OFFLINE
[4:04:25 PM] ESP32: {"type":"deviceUpdated","deviceId":"esp32_fatih","action":"updated"}
[4:04:21 PM] - YUSUFESP (esp32_yusuf): ONLINE
[4:04:21 PM] - FATIHESP (esp32_fatih): ONLINE
[4:04:21 PM] Cihaz Kayıtları: 2 cihaz bulundu
[4:04:21 PM] ESP32: {"type":"deviceRegistry","devices":[{"deviceId":"esp32_fatih","deviceName":"FATIHESP","isOnline":true,"ipAddress":"192.168.1.125","macAddress":"24:DC:C3:49:DD:30","location":"Otomatik Eklenen","description":"ESP32 cihazı - 25.10.2025 14:43:52","ownerName":"yusuf"},{"deviceId":"esp32_yusuf","deviceName":"YUSUFESP","isOnline":true,"ipAddress":"192.168.1.149","macAddress":"30:C9:22:D2:2A:CC","location":"Otomatik Eklenen","description":"ESP32 cihazı - 25.10.2025 02:41:23","ownerName":"Sahipsiz"}]}
[4:04:20 PM] CLIENT: getWolStatus id:esp32_fatih
[4:04:20 PM] - YUSUFESP (esp32_yusuf): ONLINE
[4:04:20 PM] - FATIHESP (esp32_fatih): ONLINE
[4:04:20 PM] Cihaz Kayıtları: 2 cihaz bulundu
[4:04:20 PM] ESP32: {"type":"deviceRegistry","devices":[{"deviceId":"esp32_fatih","deviceName":"FATIHESP","isOnline":true,"ipAddress":"192.168.1.125","macAddress":"24:DC:C3:49:DD:30","location":"Otomatik Eklenen","description":"ESP32 cihazı - 25.10.2025 14:43:52","ownerName":"yusuf"},{"deviceId":"esp32_yusuf","deviceName":"YUSUFESP","isOnline":true,"ipAddress":"192.168.1.149","macAddress":"30:C9:22:D2:2A:CC","location":"Otomatik Eklenen","description":"ESP32 cihazı - 25.10.2025 02:41:23","ownerName":"Sahipsiz"}]}
[4:04:20 PM] Heartbeat: FATIHESP - Uptime: 1232s
[4:04:20 PM] ESP32: {"type":"heartbeat","deviceId":"esp32_fatih","deviceName":"FATIHESP","status":"online","uptime":1232983,"ip_address":"192.168.1.125","mac_address":"24:DC:C3:49:DD:30","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{"id":7,"state":false}]}
[4:04:20 PM] Cihaz Güncellendi: undefined - OFFLINE
[4:04:20 PM] ESP32: {"type":"deviceUpdated","deviceId":"esp32_fatih","action":"updated"}
[4:04:20 PM] Heartbeat: YUSUFESP - Uptime: 44589s
[4:04:20 PM] ESP32: {"type":"heartbeat","deviceId":"esp32_yusuf","deviceName":"YUSUFESP","status":"online","uptime":44589288,"ip_address":"192.168.1.149","mac_address":"30:C9:22:D2:2A:CC","relayStates":[{"id":0,"state":false},{"id":1,"state":false},{"id":2,"state":false},{"id":3,"state":false},{"id":4,"state":false},{"id":5,"state":false},{"id":6,"state":false},{"id":7,"state":false}]}
[4:04:20 PM] Cihaz Güncellendi: undefined - OFFLINE
[4:04:20 PM] ESP32: {"type":"deviceUpdated","deviceId":"esp32_yusuf","action":"updated"}
[4:04:19 PM] SYSTEM: WebSocket bağlandı! (wss://fatihdev.xyz:5131/)
[4:04:19 PM] SYSTEM: WebSocket bağlantısı kuruluyor... (Deneme: 1/5) - wss://fatihdev.xyz:5131/
[4:04:19 PM] Varsayılan cihaz seçildi: FATIHESP (esp32_fatih)"

"main.js:216 📄 Sayfa yüklendi, kullanıcı kontrolü yapılıyor...
main.js:220 🍪 Current cookies: 
main.js:221 🍪 Cookie count: 1
main.js:222 🍪 Has sessionId: false
main.js:227 🍪 Extracted sessionId: YOK
main.js:233 🍪 localStorage'dan sessionId alındı: b6b93ba377...
main.js:235 🍪 Cookie localStorage'dan set edildi
main.js:241 🧪 Test endpoint: https://fatihdev.xyz:5130/api/user-simple
main.js:243 🧪 Test response: 200
main.js:245 🧪 Test data: {username: 'test', name: 'Test User', role: 'user'}
main.js:248 🌐 Current origin: https://fatihdev.xyz
main.js:249 🌐 API URL: https://fatihdev.xyz:5130/api/user
main.js:258 👤 User API response: 200
main.js:259 👤 User API response headers: Headers {}
main.js:260 👤 Response content-type: application/json; charset=utf-8
main.js:272 👤 User data: {username: 'yusuf', name: '', role: 'user'}
main.js:279 🔍 Username element: <span id=​"username" style=​"display:​ none;​">​yusuf​</span>​
main.js:280 🔍 UserRole element: <span id=​"userRole" style=​"display:​ none;​">​user​</span>​
main.js:284 ✅ Username set edildi: yusuf
main.js:291 ✅ UserRole set edildi: user
main.js:300 ✅ User info güncellendi
main.js:314 🔑 Güvenlik anahtarı alındı: b78a0fa7...
main.js:355 📱 Cihazlar yükleniyor...
main.js:366 📱 Cihazlar yüklendi: (2) [{…}, {…}]
main.js:379 ✅ Cihaz seçici güncellendi
main.js:31 WebSocket bağlantısı kuruluyor... (Deneme: 1/5) - wss://fatihdev.xyz:5131/
main.js:49 WebSocket bağlandı: wss://fatihdev.xyz:5131/
main.js:50 WebSocket readyState: 1
main.js:480 Güvenlik anahtarı alındı: ea61febe..."


halen ana sayfaya elementler gelmiyor.

---

**Cursor**

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
      if (relayParent) relayParent.style.display = '';
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
      if (relayParent) relayParent.style.display = '';
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

- UI, capabilities gelmezse hiç oluşmuyordu. Seçili cihazdan gelen heartbeat’te `relayStates` sayısına göre geçici UI kurup hemen görünür yapıyorum; ardından yine `getCapabilities` ile WOL listesini tamamlıyoruz.
- WebSocket açıldığında eğer cihaz listesi daha önce yüklenmiş ve seçim yapılmışsa hemen `deviceSelection + getCapabilities/getRelayStatus/getWolStatus` gönderiyorum; değilse 800 ms sonra bir kez daha deniyorum.

Şimdi sayfayı yenileyince heartbeat görünür görünmez relay/WOL alanları oluşmalı; birkaç saniye içinde WOL isimleri capabilities ile tamamlanmalı.

---

**User**

yusuf kullanicisi ile giris yaptigimda YUSUFESP secili olsa bile relay kontrolleri cikiyor ve bu relay kontrol FATIHESP'nin relaylarini kontrol ediyor.

---

**Cursor**

Cihaz seçiminden bağımsız yanlış röle güncellenmesini önlemek için iki yer düzeltmesi yapıyorum: 1) ESP32 tarafında tüm 'relay:' çıkışlarına ' id:<DEVICE_ID>' ekliyorum, 2) Frontend'te hem 'relay:' düz metin hem de JSON mesajları sadece seçili cihazla eşleştiğinde UI'yi güncelleyecek. Şimdi bu düzenlemeleri uyguluyorum.

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
  for (int i = 0; i < deviceCount; i++) {
    json += "{\"index\":" + String(i) + ",\"name\":\"" + String(devices[i].name) + "\"}";
    if (i < deviceCount - 1) json += ",";
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
  for (int i = 0; i < deviceCount; i++) {
    sendStatus(devices[i]);
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
      // Bağlantı sonrası yetenekleri bildir
      sendCapabilities();
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
        if (devIndex >= 0 && devIndex < deviceCount) {
          sendWOL(devices[devIndex].mac);
          devices[devIndex].status = WOLDevice::BOOTING;
          devices[devIndex].bootStartTime = millis();
          sendStatus(devices[devIndex]);
          ledFlash();
        }
      }

      // --- 4️⃣ StatusCheck ---
      else if (msg.startsWith("getWolStatus")) { // getWolStatus [id:xxx]
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

```javascript
// Röle göstergelerini WebSocket mesajlarına göre güncelle
function initRelayStatus(ws) {
  let lastMessage = "";
  let messageCount = 0;
  
  ws.addEventListener("message", (event) => {
    const msg = event.data;

    // Röle durum mesajlarını işle
    if (msg.startsWith("relay:")) {
      // Aynı mesajın tekrarını önle
      if (msg === lastMessage) {
        messageCount++;
        if (messageCount > 1) {
          console.log(`Tekrarlanan mesaj atlandı: ${msg} (${messageCount} kez)`);
          return;
        }
      } else {
        lastMessage = msg;
        messageCount = 1;
      }
      
      // Örnek mesaj: relay:3:on
      const parts = msg.split(":");
      const index = parseInt(parts[1]);
      const state = parts[2];
      // opsiyonel id kontrolü: ... id:esp32_xxx
      const idIdx = msg.indexOf(" id:");
      if (idIdx !== -1) {
        const targetId = msg.substring(idIdx + 4).trim();
        if (selectedDeviceId && targetId && targetId !== selectedDeviceId) {
          return; // başka cihaza ait
        }
      }

      // İndikatörü bul
      const indicator = document.getElementById("relay_status_" + index);
      if (indicator) {
        indicator.classList.remove("on", "off");
        indicator.classList.add(state === "on" ? "on" : "off");
      }
    }
  });
}

// WebSocket bağlantısı hazır olduğunda initRelayStatus çağrılacak
// main.js'de ws.onopen içinde çağrılıyor

// Yardımcı fonksiyonlar
function updateRelayStatus(relayId, state) {
  const statusElement = document.getElementById(`relay_status_${relayId}`);
  if (statusElement) {
    // Eski class'ları kaldır
    statusElement.classList.remove('on', 'off');
    
    // Yeni class'ı ekle
    if (state === 'on' || state === true) {
      statusElement.classList.add('on');
    } else {
      statusElement.classList.add('off');
    }
  }
}

function updateAllRelayStatuses(relayStates) {
  relayStates.forEach((state, index) => {
    updateRelayStatus(index, state);
  });
}

// Toggle relay fonksiyonu
function toggleRelay(relayId) {
  const statusElement = document.getElementById(`relay_status_${relayId}`);
  if (statusElement) {
    const isOn = statusElement.classList.contains('on');
    const newState = isOn ? 'off' : 'on';
    
    // Sadece mesajı gönder, UI'yi güncelleme (ESP32'den gelecek)
    sendRelay(relayId, newState);
  }
}

// Relay butonlarına tıklama olayları ekle
document.addEventListener("DOMContentLoaded", () => {
  // Tüm relay butonlarına tıklama olayı ekle
  const relayButtons = document.querySelectorAll('[data-relay]');
  relayButtons.forEach(button => {
    const relayId = parseInt(button.getAttribute('data-relay'));
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRelay(relayId);
    });
  });
});

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
      if (relayParent) relayParent.style.display = '';
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
      if (relayParent) relayParent.style.display = '';
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

- ESP32 artık tüm röle çıkışlarının sonuna cihaz kimliği ekliyor: `relay:i:state id:<DEVICE_ID>`. Böylece hangi cihaza ait olduğu net.
- Frontend’te gelen mesajları sadece seçili cihaz için işler hale getirdim:
  - Düz metin `relay:` mesajlarında `id:` farklıysa UI güncellenmiyor.
  - JSON mesajlarında `data.deviceId` seçili cihazdan farklıysa atlanıyor.
- Bu sayede `YUSUFESP` seçiliyken `FATIHESP`’den gelen röle bildirimleri arayüzü etkilemeyecek.

Deneyip haber ver: Seçili cihazın röleleri dışında bir etki gözlenmemeli.

---

**User**

esp cihazlarinin birinde role hic yok. mesela bu kullanicinin guisinde role cikmamasini nasil yapariz? ayarlarda gui editleme vardi "layout-manager"

---

**Cursor**

Anladım: Rölesiz cihaz seçildiğinde relay paneli hiç görünmesin. Bunu iki katmanda çözelim:

- Otomatik (capabilities tabanlı): `relayCount === 0` ise `relay_parent` görünmesin ve düğmeler üretilmesin.
- Kullanıcı düzeni (layout-manager): Kullanıcı `relay_parent`’ı gizlediyse dinamik render bunu yeniden görünür yapmasın.

Aşağıdaki küçük editleri uygulayın.

1) main.js: gizli bölümleri global saklayın
- En üste ekleyin:
```javascript
let hiddenSections = new Set();
```

2) applyUserLayout(): layout’tan gizli bölümleri kaydedin
- Fonksiyon içinde `hidden` hesaplandığı yerde global’i güncelleyin:
```javascript
// Gizlenecekleri uygula
const hidden = new Set(layout.hidden || []);
hiddenSections = hidden; // <-- ekle
sections.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = hidden.has(id) ? 'none' : '';
});
```

3) renderDynamicControls(): capabilities’e ve layout’a göre göster/gizle
- Relay ve WOL kısımlarını, hiddenSections ve capabilities ile kontrol edin.
```javascript
function renderDynamicControls(cap) {
  try {
    const controlpanel = document.getElementById('controlpanel');
    if (controlpanel) controlpanel.style.display = '';

    // Relay paneli
    const relayParent = document.getElementById('relay_parent');
    const relayContainer = document.getElementById('relaylist');
    const relayCount = typeof cap.relayCount === 'number' ? cap.relayCount : 0;

    if (relayParent) {
      const shouldShowRelay = relayCount > 0 && !hiddenSections.has('relay_parent');
      relayParent.style.display = shouldShowRelay ? '' : 'none';
      if (relayContainer) {
        relayContainer.innerHTML = '';
        if (shouldShowRelay) {
          for (let i = 0; i < relayCount; i++) {
            const div = document.createElement('div');
            div.className = 'relay';
            div.innerHTML = `
              <span class="relay_status" id="relay_status_${i}"></span>
              <button class="button" data-relay="${i}">Relay ${i+1}</button>
            `;
            relayContainer.appendChild(div);
          }
          // Yeni butonlar için eventleri bağla
          relayContainer.querySelectorAll('[data-relay]').forEach(button => {
            const relayId = parseInt(button.getAttribute('data-relay'));
            button.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleRelay(relayId);
            });
          });
        }
      }
    }

    // WOL paneli
    const wolParent = document.getElementById('wol_parent');
    const wolList = document.getElementById('wol_list');
    const wolItems = Array.isArray(cap.wol) ? cap.wol : [];

    if (wolParent) {
      const shouldShowWol = wolItems.length > 0 && !hiddenSections.has('wol_parent');
      wolParent.style.display = shouldShowWol ? '' : 'none';
      if (wolList) {
        wolList.innerHTML = '';
        if (shouldShowWol) {
          wolItems.forEach(w => {
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
      }
    }

    // Kontrol panelini tamamen gizle (ikisi de görünmüyorsa)
    if (controlpanel) {
      const relayVisible = relayParent && relayParent.style.display !== 'none';
      const wolVisible = wolParent && wolParent.style.display !== 'none';
      controlpanel.style.display = (relayVisible || wolVisible) ? '' : 'none';
    }
  } catch (e) {
    console.error('renderDynamicControls error:', e);
  }
}
```

4) Heartbeat fallback’inde de saygı gösterin
- Daha önce eklediğimiz heartbeat tabanlı geçici UI kurulumunda, `renderDynamicControls({ relayCount, wol: [] })` çağrısı zaten bu kurallara uyacak; rölesiz cihazda `relay_parent` görünmeyecektir.

Bu sayede:
- Rölesiz cihaz seçildiğinde `relay_parent` hiç görünmez.
- Kullanıcı layout-manager ile `relay_parent`’ı gizlemişse, dinamik render tekrar açmaz.
- Röleli cihaz seçildiğinde normal şekilde görünür.

```javascript
let hiddenSections = new Set();
```

```javascript
// Gizlenecekleri uygula
const hidden = new Set(layout.hidden || []);
hiddenSections = hidden; // <-- ekle
sections.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = hidden.has(id) ? 'none' : '';
});
```

```javascript
function renderDynamicControls(cap) {
  try {
    const controlpanel = document.getElementById('controlpanel');
    if (controlpanel) controlpanel.style.display = '';

    // Relay paneli
    const relayParent = document.getElementById('relay_parent');
    const relayContainer = document.getElementById('relaylist');
    const relayCount = typeof cap.relayCount === 'number' ? cap.relayCount : 0;

    if (relayParent) {
      const shouldShowRelay = relayCount > 0 && !hiddenSections.has('relay_parent');
      relayParent.style.display = shouldShowRelay ? '' : 'none';
      if (relayContainer) {
        relayContainer.innerHTML = '';
        if (shouldShowRelay) {
          for (let i = 0; i < relayCount; i++) {
            const div = document.createElement('div');
            div.className = 'relay';
            div.innerHTML = `
              <span class="relay_status" id="relay_status_${i}"></span>
              <button class="button" data-relay="${i}">Relay ${i+1}</button>
            `;
            relayContainer.appendChild(div);
          }
          // Yeni butonlar için eventleri bağla
          relayContainer.querySelectorAll('[data-relay]').forEach(button => {
            const relayId = parseInt(button.getAttribute('data-relay'));
            button.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleRelay(relayId);
            });
          });
        }
      }
    }

    // WOL paneli
    const wolParent = document.getElementById('wol_parent');
    const wolList = document.getElementById('wol_list');
    const wolItems = Array.isArray(cap.wol) ? cap.wol : [];

    if (wolParent) {
      const shouldShowWol = wolItems.length > 0 && !hiddenSections.has('wol_parent');
      wolParent.style.display = shouldShowWol ? '' : 'none';
      if (wolList) {
        wolList.innerHTML = '';
        if (shouldShowWol) {
          wolItems.forEach(w => {
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
      }
    }

    // Kontrol panelini tamamen gizle (ikisi de görünmüyorsa)
    if (controlpanel) {
      const relayVisible = relayParent && relayParent.style.display !== 'none';
      const wolVisible = wolParent && wolParent.style.display !== 'none';
      controlpanel.style.display = (relayVisible || wolVisible) ? '' : 'none';
    }
  } catch (e) {
    console.error('renderDynamicControls error:', e);
  }
}
```

---

**User**

calismayan kismilar;

1. admin panelindeki sidebar "btn-logout" calismiyor. basildiginda 

"admin:73 Uncaught ReferenceError: logout is not defined
    at HTMLButtonElement.onclick (admin:73:55)
onclick	@	admin:73"

hatasi veriyor.

2. Kullanici yonetiminde kullanici slime fonksiyonu calismiyor. ("<button class="btn-danger" onclick="deleteUser('315')">Sil</button>")

gelen hata 

admin:1 Uncaught ReferenceError: deleteUser is not defined
    at HTMLButtonElement.onclick (admin:1:1)

---

**Cursor**

Admin'deki logout ve deleteUser hatalarını doğrulayıp düzeltmek için `admin.html` ve `public/scripts/admin.js` dosyalarını inceliyorum.

Cıkış ve kullanıcı silme hatalarını gidermek için gerekli fonksiyonları `public/scripts/admin.js` dosyasına ekliyorum; ardından admin panelindeki butonlar çalışacak.

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
        <div class="form-group"><label>Sahibi</label><select id="edit-owner"><option value="">Sahipsiz</option></select></div>
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
      const resp = await fetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ layout }) });
      if (resp.ok) showToast('Layout kaydedildi','success'); else showToast('Layout kaydedilemedi','error');
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


```

- Admin sidebar’daki çıkış ve kullanıcı silme hataları giderildi. `admin.js` içine global `logout()` ve `deleteUser(userId)` fonksiyonlarını ekledim; butonlar artık çalışacak.
- Çıkış, `/api/logout` sonrası doğrudan `/login`’e yönlendiriyor.
- Kullanıcı silme, onay alıp `/api/admin/users/:userId` DELETE çağırıyor; başarılıysa listeyi yeniliyor.

Kısaca:
- `admin.html` üzerindeki `onclick="logout()"` ve `onclick="deleteUser('315')"` artık tanımlı.

---

**User**

admin panelindeki ayarlarda gorunum duzeni kaydetmeye calisildiginda boyle hata veriyr

"admin.js?v=1:487 
 POST https://fatihdev.xyz/api/admin/user-layouts/317 404 (Not Found)
(anonymous)	@	admin.js?v=1:487"

---

**Cursor**

Önce hatayı çoğaltan çağrıyı admin.js içinde bulup, 5130 portlu API helper'ını (apiFetch) kullanacak şekilde düzeltiyorum; böylece istek doğru porta ve credentials ile gidecek. Ardından kaydetme butonu yeniden denemede 404 almamalı.

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
        <div class="form-group"><label>Sahibi</label><select id="edit-owner"><option value="">Sahipsiz</option></select></div>
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


```

- Layout kaydetme doğrudan fetch ile domain köküne gidiyordu, bu yüzden 404 aldı. İsteği `apiFetch` ile gönderecek şekilde düzelttim; böylece `https://fatihdev.xyz:5130/api/admin/user-layouts/:userId` adresine, credentials ile gidecek.
- Tekrar denediğinizde 404 kalkmalı; yine hata olursa sunucu logunda ilgili endpoint’e bakarız.

