#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include "password.h"

#include "Buzzer.h"
#include "StatusLED.h"
#include <ESP32Ping.h> // <--- Ping için gerekli

// Sabit IP ayarları
IPAddress local_IP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// Relay pins
const int relayPins[8] = {32, 33, 25, 26, 27, 14, 12, 13};

// WOL device list
struct WOLDevice {
  const char* name;
  byte mac[6];
  IPAddress ip; // Ping için IP ekledik
  enum Status {OFFLINE, BOOTING, RUNNING, FAILED} status;
  unsigned long bootStartTime;
};

WOLDevice devices[] = {
  {"Server", {0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, IPAddress(192,168,1,255), WOLDevice::OFFLINE, 0},
  {"B350",   {0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, IPAddress(192,168,1,255), WOLDevice::OFFLINE, 0},
  {"Main",   {0x00, 0x00, 0x00, 0x00, 0x00, 0x00}, IPAddress(192,168,1,255), WOLDevice::OFFLINE, 0}
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

// ----------------- Ping kontrolü -----------------
void checkDevices() {
  for(int i=0;i<deviceCount;i++) {
    WOLDevice &dev = devices[i];
    if(dev.status == WOLDevice::BOOTING) {
      if(Ping.ping(dev.ip, 1)) {
        dev.status = WOLDevice::RUNNING;
        sendStatus(dev);
      } else if(millis() - dev.bootStartTime > 60000) { // 60 saniye içinde yanıt yoksa
        dev.status = WOLDevice::FAILED;
        sendStatus(dev);
      }
    } else if(dev.status == WOLDevice::RUNNING) {
      if(!Ping.ping(dev.ip, 1)) { // Çalışırken kapanmışsa
        dev.status = WOLDevice::OFFLINE;
        sendStatus(dev);
      }
    }
  }
}

// ----------------- WebSocket olayları -----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED:
      Serial.println("Connected to Serv00 WebSocket (WSS)");
      webSocket.sendTXT("esp32:online");
      ledFlash(); // WS bağlandı LED flash
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Message: " + msg);

      // Relay kontrol
      if (msg.startsWith("relay:")) {
        int idx = msg.substring(6,7).toInt();
        String action = msg.substring(8);
        if (idx >= 0 && idx < 8) {
          digitalWrite(relayPins[idx], (action == "on") ? HIGH : LOW);
          webSocket.sendTXT("relay:" + String(idx) + ":" + action);
          ledFlash();
        }
      } 
      // WOL gönder
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
      // Buzzer çal
      else if (msg.startsWith("buzzer")) {
        buzzerBeep(2000, 500);
        webSocket.sendTXT("buzzer:done");
        ledFlash();
      }
      // Durum LED kontrol
      else if (msg.startsWith("led:on")) {
        ledOn();
        webSocket.sendTXT("led:done");
      }
      else if (msg.startsWith("led:off")) {
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
      ledSlowBlink(1, 200); // WiFi tarama LED
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected!");
      Serial.println(WiFi.localIP());
      ledOn(); // WiFi bağlı LED
      return true;
    }
  }

  Serial.println("No known WiFi found.");
  return false;
}

// ----------------- SETUP -----------------
void setup() {
  Serial.begin(115200);

  // Relay setup
  for (int i = 0; i < 8; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], LOW);
  }

  // Buzzer ve LED setup
  buzzerInit();
  ledInit();

  // Cihaz açılma belirtisi
  ledBlink(300);

  // WiFi bağlantısı
  connectToWiFi();

  // WebSocket başlat
  webSocket.beginSSL("riddleabby.serv00.net", 5136, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ----------------- LOOP -----------------
void loop() {
  webSocket.loop();
  checkDevices(); // <-- Ping ve status kontrolü sürekli çalışacak
}
