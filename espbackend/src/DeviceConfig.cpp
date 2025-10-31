#include "../device_configs/SelectedDevice.h"
#include "DeviceConfig.h"

// WOL cihaz tanımlarını tek bir .cpp içinde gerçekleştir
#ifndef WOL_DEVICES_INIT
#define WOL_DEVICES_INIT {}
#endif
#ifndef WOL_DEVICE_COUNT
#define WOL_DEVICE_COUNT 0
#endif

// WOL cihazları için sabit boyutlu array (MAX_WOL_DEVICES)
// Compile-time'da WOL_DEVICES_INIT ile initialize edilebilir
// Runtime'da Preferences'tan yüklendiğinde üzerine yazılır
WOLDevice wolDevices[MAX_WOL_DEVICES] = WOL_DEVICES_INIT;
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
