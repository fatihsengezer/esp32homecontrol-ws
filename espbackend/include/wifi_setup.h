#ifndef WIFI_SETUP_H
#define WIFI_SETUP_H

#include <WiFi.h>
#include <Preferences.h>
#include <DNSServer.h>

// WiFi bağlantı durumu takibi
struct WiFiSetupStatus {
  bool isInAPMode = false;
  bool credentialsSaved = false;
  int connectionAttempts = 0;
  const int MAX_ATTEMPTS = 3;
};

// External declarations
extern WiFiSetupStatus wifiSetupStatus;
extern DNSServer dnsServer;

// Fonksiyon prototipleri
void startAPMode();
bool connectToSavedWiFi();
void setupWebServer();
String scanNetworks();

#endif

