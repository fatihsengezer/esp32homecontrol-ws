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
