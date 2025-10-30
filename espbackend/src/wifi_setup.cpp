#include <WiFi.h>
#include <Preferences.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include "wifi_setup.h"
#include "StatusLED.h"

AsyncWebServer server(80);
DNSServer dnsServer;
Preferences preferences;

WiFiSetupStatus wifiSetupStatus;

// Yardımcı fonksiyonlar - Captive portal için
bool isIp(String str) {
  for (size_t i = 0; i < str.length(); i++) {
    int c = str.charAt(i);
    if (c != '.' && (c < '0' || c > '9')) {
      return false;
    }
  }
  return true;
}

// Cache'lenmiş WiFi tarama sonuçları
String cachedNetworkList = "[]";

// NFS keys
#define PREFS_NAMESPACE "wificonfig"
#define KEY_SSID "ssid"
#define KEY_PASSWORD "password"
#define KEY_SAVED "saved"

// ==================== WiFi Setup Functions ====================

void startAPMode() {
  Serial.println("\n=== WiFi Setup Mode Başlatılıyor ===");
  
  wifiSetupStatus.isInAPMode = true;
  wifiSetupStatus.connectionAttempts = 0;
  
  // AP başlatılmadan önce WiFi taraması yap ve sonuçları cache'le
  Serial.println("[DEBUG] WiFi taraması başlatılıyor...");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  
  Serial.println("[DEBUG] WiFi.scanNetworks() çağrılıyor...");
  int n = WiFi.scanNetworks();
  Serial.println("[DEBUG] Taranan ağ sayısı: " + String(n));
  
  cachedNetworkList = "[";
  for (int i = 0; i < n; ++i) {
    if (i > 0) cachedNetworkList += ",";
    
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    int encryption = WiFi.encryptionType(i);
    
    cachedNetworkList += "{";
    cachedNetworkList += "\"ssid\":\"" + ssid + "\",";
    cachedNetworkList += "\"rssi\":" + String(rssi) + ",";
    cachedNetworkList += "\"encryption\":" + String(encryption);
    cachedNetworkList += "}";
    
    Serial.println("[DEBUG] Bulunan ağ: " + ssid + " (RSSI: " + String(rssi) + ", Encryption: " + String(encryption) + ")");
  }
  cachedNetworkList += "]";
  
  Serial.println("[DEBUG] Tarama tamamlandı. Toplam " + String(n) + " ağ bulundu.");
  
  // Şimdi AP modunu başlat
  Serial.println("[DEBUG] AP modu başlatılıyor...");
  WiFi.mode(WIFI_AP_STA);
  
  // Captive portal için DNS server IP'si ayarla (kendi IP'miz)
  // Bu Android cihazların otomatik yönlendirmesini tetikler
  IPAddress apIP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  
  // Access Point oluştur
  if (WiFi.softAPConfig(apIP, gateway, subnet)) {
    if (WiFi.softAP("ESP32_Setup", "12345678")) {
      IPAddress IP = WiFi.softAPIP();
      Serial.println("[DEBUG] Access Point başlatıldı!");
      Serial.println("[DEBUG] SSID: ESP32_Setup");
      Serial.println("[DEBUG] IP Address: " + IP.toString());
    
      // DNS Server'ı başlat (captive portal için)
      // Android için kritik: Error reply code NoError olmalı
      dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
      dnsServer.start(53, "*", apIP);
      Serial.println("[DEBUG] DNS Server başlatıldı (Port 53, NoError reply)");
      
      // Web sunucusunu kur
      setupWebServer();
      
    } else {
      Serial.println("[DEBUG] HATA: AP oluşturulamadı!");
    }
  } else {
    Serial.println("[DEBUG] HATA: AP Config başarısız!");
  }
}

bool connectToSavedWiFi() {
  Serial.println("\n=== Kaydedilmiş WiFi'ye Bağlanılıyor ===");
  
  preferences.begin(PREFS_NAMESPACE, false);
  
  // Kaydedilmiş SSID ve password'ü kontrol et
  bool hasSavedCredentials = preferences.getBool(KEY_SAVED, false);
  
  if (!hasSavedCredentials) {
    Serial.println("Kaydedilmiş WiFi bilgisi bulunamadı.");
    preferences.end();
    return false;
  }
  
  String ssid = preferences.getString(KEY_SSID, "");
  String password = preferences.getString(KEY_PASSWORD, "");
  
  Serial.println("Kaydedilmiş WiFi: " + ssid);
  
  if (ssid.length() == 0) {
    preferences.end();
    return false;
  }
  
  preferences.end();
  
  // WiFi Station moduna geç
  WiFi.mode(WIFI_STA);
  
  // TODO: Static IP ayarları Preferences'e eklendikten sonra burada kullanılabilir
  // Şimdilik DHCP kullanılıyor
  
  // WiFi'ye bağlan
  WiFi.begin(ssid.c_str(), password.c_str());
  
  unsigned long startAttempt = millis();
  int attempts = 0;
  
  Serial.println("Bağlantı bekleniyor");
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(500);
    Serial.print(".");
    ledSlowBlink(1, 200);
    attempts++;
    
    if (attempts > 20) break; // Güvenlik
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi'ye bağlandı!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("MAC Address: ");
    Serial.println(WiFi.macAddress());
    ledOn();
    wifiSetupStatus.connectionAttempts = 0;
    return true;
  }
  
  Serial.println("\nWiFi bağlantısı başarısız!");
  wifiSetupStatus.connectionAttempts++;
  
  // 3 başarısız denemeden sonra AP moduna dön
  if (wifiSetupStatus.connectionAttempts >= wifiSetupStatus.MAX_ATTEMPTS) {
    Serial.println("Maksimum deneme sayısına ulaşıldı. AP moduna dönülüyor.");
    startAPMode();
    return false;
  }
  
  return false;
}

String scanNetworks() {
  Serial.println("[DEBUG] /scan endpoint çağrıldı");
  
  // Cache'lenmiş listeyi döndür (zaten startAPMode'da tarama yapıldı)
  Serial.println("[DEBUG] Cache'lenmiş " + String(cachedNetworkList.length()) + " karakterlik liste döndürülüyor");
  return cachedNetworkList;
}

const char wifiSetupHTML[] PROGMEM = R"(
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 WiFi Ayarları</title>
  <style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}.container{background:white;padding:30px;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,0.2);max-width:450px;width:100%}.header{text-align:center;margin-bottom:30px}.header h1{color:#333;font-size:28px;margin-bottom:8px}.subtitle{color:#666;font-size:14px}.content{margin-bottom:20px}.button-group{margin-bottom:20px;text-align:center}.btn{padding:12px 24px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:all 0.3s ease;display:inline-flex;align-items:center;gap:8px;width:100%;justify-content:center}.btn:disabled{opacity:0.5;cursor:not-allowed}.btn-primary{background:#667eea;color:white}.btn-primary:hover:not(:disabled){background:#5568d3;transform:translateY(-2px);box-shadow:0 4px 12px rgba(102,126,234,0.4)}.btn-success{background:#48bb78;color:white}.btn-success:hover:not(:disabled){background:#38a169;transform:translateY(-2px);box-shadow:0 4px 12px rgba(72,187,120,0.4)}.icon{font-size:20px}.form-group{margin-bottom:20px}.form-group label{display:block;margin-bottom:8px;color:#333;font-weight:600;font-size:14px}.input-text,.input-select{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;transition:border-color 0.3s ease}.input-text:focus,.input-select:focus{outline:none;border-color:#667eea}.input-select{cursor:pointer}.status-message{margin-top:20px;padding:12px;border-radius:8px;font-size:14px;text-align:center;min-height:20px;transition:all 0.3s ease}.status-message.success{background:#c6f6d5;color:#22543d;border:1px solid #48bb78}.status-message.error{background:#fed7d7;color:#742a2a;border:1px solid #f56565}.status-message.info{background:#bee3f8;color:#2c5282;border:1px solid #4299e1}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center}.footer .info{color:#666;font-size:12px;line-height:1.5}.loading{display:inline-block;width:16px;height:16px;border:3px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#fff;animation:spin 0.8s linear infinite;margin-right:8px}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📡 ESP32 WiFi Ayarları</h1>
      <p class="subtitle">WiFi ağınızı seçin ve şifrenizi girin</p>
    </div>

    <div class="content">
      <div class="button-group">
        <button id="scan" class="btn btn-primary">
          <span class="icon">📡</span> Ağları Tara
        </button>
      </div>

      <div class="form-group">
        <label for="ssid">WiFi Ağı:</label>
        <select id="ssid" class="input-select">
          <option value="">Ağ seçin...</option>
        </select>
      </div>

      <div class="form-group">
        <label for="password">Şifre:</label>
        <input type="password" id="password" class="input-text" placeholder="WiFi şifresini girin">
      </div>

      <button id="save" class="btn btn-success" disabled>
        <span class="icon">💾</span> Kaydet ve Bağlan
      </button>

      <p id="status" class="status-message"></p>
    </div>

    <div class="footer">
      <p class="info">Not: Cihaz kayıt sonrası otomatik olarak yeniden başlatılacaktır.</p>
    </div>
  </div>
  
  <script>
document.addEventListener('DOMContentLoaded', function() {
  const scanBtn = document.getElementById('scan');
  const saveBtn = document.getElementById('save');
  const ssidSelect = document.getElementById('ssid');
  const passwordInput = document.getElementById('password');
  const statusMsg = document.getElementById('status');

  let networks = [];

  function showStatus(message, type = 'info') {
    statusMsg.textContent = message;
    statusMsg.className = 'status-message ' + type;
  }

  function checkSaveButton() {
    const hasSelection = ssidSelect.value.length > 0;
    const hasPassword = passwordInput.value.length > 0;
    saveBtn.disabled = !(hasSelection && hasPassword);
  }

  ssidSelect.addEventListener('change', checkSaveButton);
  passwordInput.addEventListener('input', checkSaveButton);

  scanBtn.addEventListener('click', async function() {
    try {
      scanBtn.disabled = true;
      showStatus('🔍 WiFi ağları taranıyor...', 'info');
      
      const response = await fetch('/scan');
      
      if (!response.ok) {
        throw new Error('Tarama başarısız');
      }
      
      const data = await response.json();
      networks = data;
      
      ssidSelect.innerHTML = '<option value="">Ağ seçin...</option>';
      
      networks.forEach(network => {
        const option = document.createElement('option');
        option.value = network.ssid;
        option.textContent = `${network.ssid} ${network.rssi > -70 ? '📶' : network.rssi > -80 ? '📵' : ''} (${network.rssi} dBm)`;
        ssidSelect.appendChild(option);
      });
      
      showStatus(`✅ ${networks.length} ağ bulundu`, 'success');
      
    } catch (error) {
      console.error('Tarama hatası:', error);
      showStatus('❌ Tarama başarısız. Lütfen tekrar deneyin.', 'error');
    } finally {
      scanBtn.disabled = false;
    }
  });

  saveBtn.addEventListener('click', async function() {
    try {
      const ssid = ssidSelect.value;
      const password = passwordInput.value;
      
      if (!ssid || !password) {
        showStatus('⚠️ Lütfen SSID ve şifre girin', 'error');
        return;
      }
      
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="loading"></span> Kaydediliyor...';
      showStatus('💾 WiFi bilgileri kaydediliyor...', 'info');
      
      const formData = new URLSearchParams();
      formData.append('ssid', ssid);
      formData.append('password', password);
      
      const response = await fetch('/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });
      
      const result = await response.text();
      
      if (response.ok) {
        showStatus('✅ Kaydedildi! Cihaz yeniden başlatılıyor...', 'success');
        
        setTimeout(() => {
          showStatus('🔄 WiFi\'ye bağlanılıyor, lütfen bekleyin...', 'info');
        }, 3000);
      } else {
        showStatus('❌ Kayıt başarısız: ' + result, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="icon">💾</span> Kaydet ve Bağlan';
      }
      
    } catch (error) {
      console.error('Kayıt hatası:', error);
      showStatus('❌ Kayıt başarısız. Lütfen tekrar deneyin.', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span class="icon">💾</span> Kaydet ve Bağlan';
    }
  });

  async function checkSavedWiFi() {
    try {
      const response = await fetch('/check');
      const data = await response.json();
      
      if (data.saved) {
        showStatus(`ℹ️ Kayıtlı WiFi: ${data.ssid}`, 'info');
      }
    } catch (error) {
      console.error('Check hatası:', error);
    }
  }

  checkSavedWiFi();
});
  </script>
</body>
</html>
)";

void setupWebServer() {
  Serial.println("[DEBUG] Web sunucusu kuruluyor...");
  
  // Ana sayfa - embedded HTML
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] / isteği alındı");
    
    // Captive portal kontrolü - IP değilse redirect et
    String host = request->header("Host");
    Serial.println("[DEBUG] Host header: " + host);
    
    if (!isIp(host)) {
      Serial.println("[DEBUG] Host IP değil, captive portal redirect");
      String redirectUrl = "http://" + WiFi.softAPIP().toString() + "/";
      request->redirect(redirectUrl);
      return;
    }
    
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // Captive Portal detection için özel endpoint'ler
  // Android ve diğer cihazların captive portal algılaması için
  
  // Captive portal endpoint'leri - farklı cihazlar için
  
  // generate_204 - Android captive portal detection
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /generate_204 (Android captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // gen_204 - alternatif Android endpoint
  server.on("/gen_204", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /gen_204 (Android captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // Hotspot-detect.html - iOS captive portal detection
  server.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /hotspot-detect.html (iOS captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // connectivitycheck - Google connectivity check
  server.on("/connectivitycheck", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /connectivitycheck (Google captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // ncsi.txt - Windows captive portal detection
  server.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /ncsi.txt (Windows captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // redirect - Microsoft captive portal
  server.on("/redirect", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /redirect (captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // success.txt - bazı cihazlar bunu arar
  server.on("/success.txt", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /success.txt (captive portal)");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  // API endpoint: SSID listesi tarama
  server.on("/scan", HTTP_GET, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /scan isteği alındı");
    String networks = scanNetworks();
    Serial.println("[DEBUG] /scan cevabı hazırlandı, uzunluk: " + String(networks.length()));
    request->send(200, "application/json", networks);
  });
  
  // API endpoint: WiFi bilgilerini kaydet
  server.on("/save", HTTP_POST, [](AsyncWebServerRequest *request) {
    Serial.println("[DEBUG] /save isteği alındı");
    
    if (request->hasParam("ssid", true) && request->hasParam("password", true)) {
      String ssid = request->getParam("ssid", true)->value();
      String password = request->getParam("password", true)->value();
      
      Serial.println("[DEBUG] WiFi bilgileri kaydediliyor:");
      Serial.println("[DEBUG] SSID: " + ssid);
      
      preferences.begin(PREFS_NAMESPACE, false);
      preferences.putString(KEY_SSID, ssid);
      preferences.putString(KEY_PASSWORD, password);
      preferences.putBool(KEY_SAVED, true);
      preferences.end();
      
      wifiSetupStatus.credentialsSaved = true;
      
      Serial.println("[DEBUG] WiFi bilgileri kaydedildi. Yeniden başlatılıyor...");
      request->send(200, "application/json", "{\"status\":\"success\",\"message\":\"Credentials saved. Rebooting...\"}");
      
      delay(2000);
      ESP.restart();
      
    } else {
      request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing parameters\"}");
    }
  });
  
  // API endpoint: Mevcut kaydedilmiş bilgileri kontrol et
  server.on("/check", HTTP_GET, [](AsyncWebServerRequest *request) {
    preferences.begin(PREFS_NAMESPACE, false);
    bool saved = preferences.getBool(KEY_SAVED, false);
    
    if (saved) {
      String ssid = preferences.getString(KEY_SSID, "");
      request->send(200, "application/json", "{\"saved\":true,\"ssid\":\"" + ssid + "\"}");
    } else {
      request->send(200, "application/json", "{\"saved\":false}");
    }
    
    preferences.end();
  });
  
  // Catch-all endpoint - bilinmeyen tüm istekleri ana sayfaya göster
  // Bu captive portal için kritik - herhangi bir URL'e gidildiğinde setup sayfası gösterilir
  server.onNotFound([](AsyncWebServerRequest *request) {
    String url = String(request->url().c_str());
    Serial.println("[DEBUG] Not Found: " + url);
    
    // Captive portal kontrolü - IP değilse redirect et
    String host = request->header("Host");
    Serial.println("[DEBUG] Host header: " + host);
    
    if (!isIp(host)) {
      Serial.println("[DEBUG] Captive portal - IP'ye redirect ediyorum");
      String redirectUrl = "http://" + WiFi.softAPIP().toString() + "/";
      request->redirect(redirectUrl);
      return;
    }
    
    Serial.println("[DEBUG] Ana sayfayı gösteriyorum");
    request->send(200, "text/html", wifiSetupHTML);
  });
  
  server.begin();
  Serial.println("[DEBUG] HTTP sunucusu başlatıldı");
}

