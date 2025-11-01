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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
:root{--primary-bg:#1a1a1a;--secondary-bg:#2e2e2e;--tertiary-bg:#3b3b3b;--card-bg:rgba(46,46,46,0.85);--border-color:rgba(215,215,215,0.1);--text-primary:#e0e0e0;--text-secondary:#a9a9a9;--accent-primary:#d79333;--success:#28a745;--danger:#dc3545;--warning:#ffc107;--shadow-sm:0 2px 8px rgba(0,0,0,0.2);--shadow-md:0 4px 16px rgba(0,0,0,0.3);--shadow-lg:0 8px 32px rgba(0,0,0,0.4)}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Lexend Deca",-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#1a1a1a 0%,#2d2d2d 100%);background-attachment:fixed;color:var(--text-primary);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}.container{background:var(--card-bg);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:2.5rem;border-radius:1.5rem;box-shadow:var(--shadow-lg);border:1px solid var(--border-color);max-width:480px;width:100%;animation:fadeInUp 0.5s ease-out}@keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}.header{text-align:center;margin-bottom:2rem}.header h1{color:var(--text-primary);font-size:2rem;font-weight:700;margin-bottom:0.5rem;background:linear-gradient(135deg,#d79333 0%,#f5c876 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-shadow:0 2px 10px rgba(215,147,51,0.3);letter-spacing:-0.5px}.subtitle{color:var(--text-secondary);font-size:0.95rem;font-weight:400}.content{margin-bottom:1.5rem}.button-group{margin-bottom:1.5rem;text-align:center}.btn{padding:0.9rem 1.8rem;border:none;border-radius:10rem;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;width:100%;color:white;font-family:"Lexend Deca",sans-serif;position:relative;overflow:hidden;box-shadow:var(--shadow-sm);border:1.5px solid transparent}.btn::before{content:'';position:absolute;top:50%;left:50%;width:0;height:0;border-radius:50%;background:rgba(255,255,255,0.1);transform:translate(-50%,-50%);transition:width 0.6s,height 0.6s}.btn:active::before{width:300px;height:300px}.btn:disabled{opacity:0.5;cursor:not-allowed;transform:none!important}.btn-primary{background:linear-gradient(135deg,#2e2e2e 0%,#3b3b3b 100%);border-color:rgba(215,215,215,0.2)}.btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#3b3b3b 0%,#484848 100%);transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:rgba(215,215,215,0.4)}.btn-success{background:linear-gradient(135deg,#28a745 0%,#218838 100%);border-color:rgba(40,167,69,0.5)}.btn-success:hover:not(:disabled){background:linear-gradient(135deg,#218838 0%,#1e7e34 100%);transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:rgba(40,167,69,0.7)}.icon{font-size:1.2rem}.form-group{margin-bottom:1.5rem}.form-group label{display:block;margin-bottom:0.5rem;color:var(--text-primary);font-weight:600;font-size:0.95rem}.input-text,.input-select{width:100%;padding:0.9rem 1rem;background:rgba(30,30,30,0.6);border:1.5px solid var(--border-color);border-radius:0.75rem;font-size:1rem;color:var(--text-primary);transition:all 0.3s ease;font-family:"Lexend Deca",sans-serif}.input-text:focus,.input-select:focus{outline:none;border-color:var(--accent-primary);background:rgba(30,30,30,0.8);box-shadow:0 0 0 3px rgba(215,147,51,0.1)}.input-text::placeholder{color:var(--text-secondary)}.input-select{cursor:pointer}.input-select option{background:var(--secondary-bg);color:var(--text-primary);padding:0.75rem}.status-message{margin-top:1.5rem;padding:1rem;border-radius:0.75rem;font-size:0.9rem;text-align:center;min-height:1.5rem;transition:all 0.3s ease;font-weight:500;border:1.5px solid transparent;animation:slideIn 0.3s ease-out}@keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}.status-message.success{background:rgba(40,167,69,0.15);color:#4ade80;border-color:rgba(40,167,69,0.3)}.status-message.error{background:rgba(220,53,69,0.15);color:#f87171;border-color:rgba(220,53,69,0.3)}.status-message.info{background:rgba(215,147,51,0.15);color:#fbbf24;border-color:rgba(215,147,51,0.3)}.footer{margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border-color);text-align:center}.footer .info{color:var(--text-secondary);font-size:0.85rem;line-height:1.6}.loading{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#fff;animation:spin 0.8s linear infinite;margin-right:0.5rem}@keyframes spin{to{transform:rotate(360deg)}}@media (max-width:480px){.container{padding:1.5rem;border-radius:1rem}.header h1{font-size:1.5rem}.subtitle{font-size:0.85rem}.btn{padding:0.75rem 1.5rem;font-size:0.95rem}}
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
        <input type="password" id="password" class="input-text" placeholder="WiFi şifresini girin" autocomplete="off">
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
document.addEventListener('DOMContentLoaded',function(){const scanBtn=document.getElementById('scan');const saveBtn=document.getElementById('save');const ssidSelect=document.getElementById('ssid');const passwordInput=document.getElementById('password');const statusMsg=document.getElementById('status');let networks=[];function showStatus(message,type='info'){statusMsg.textContent=message;statusMsg.className='status-message '+type}function checkSaveButton(){const hasSelection=ssidSelect.value.length>0;const hasPassword=passwordInput.value.length>0;saveBtn.disabled=!(hasSelection&&hasPassword)}ssidSelect.addEventListener('change',checkSaveButton);passwordInput.addEventListener('input',checkSaveButton);scanBtn.addEventListener('click',async function(){try{scanBtn.disabled=true;scanBtn.innerHTML='<span class="loading"></span> Taranıyor...';showStatus('🔍 WiFi ağları taranıyor...','info');const response=await fetch('/scan');if(!response.ok){throw new Error('Tarama başarısız')}const data=await response.json();networks=data;ssidSelect.innerHTML='<option value="">Ağ seçin...</option>';networks.forEach(network=>{const option=document.createElement('option');option.value=network.ssid;const signalStrength=network.rssi>-70?'📶':network.rssi>-80?'📵':'📡';option.textContent=`${network.ssid} ${signalStrength} (${network.rssi} dBm)`;ssidSelect.appendChild(option)});showStatus(`✅ ${networks.length} ağ bulundu`,'success')}catch(error){console.error('Tarama hatası:',error);showStatus('❌ Tarama başarısız. Lütfen tekrar deneyin.','error')}finally{scanBtn.disabled=false;scanBtn.innerHTML='<span class="icon">📡</span> Ağları Tara'}});saveBtn.addEventListener('click',async function(){try{const ssid=ssidSelect.value;const password=passwordInput.value;if(!ssid||!password){showStatus('⚠️ Lütfen SSID ve şifre girin','error');return}saveBtn.disabled=true;saveBtn.innerHTML='<span class="loading"></span> Kaydediliyor...';showStatus('💾 WiFi bilgileri kaydediliyor...','info');const formData=new URLSearchParams();formData.append('ssid',ssid);formData.append('password',password);const response=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:formData.toString()});const result=await response.text();if(response.ok){showStatus('✅ WiFi bilgileri kaydedildi! Cihaz yeniden başlatılıyor...','success');setTimeout(()=>{showStatus('✅ İşlem tamamlandı! Cihaz WiFi\'ye bağlanmaya çalışıyor. Bu sayfayı kapatabilirsiniz.','success')},2000)}else{showStatus('❌ Kayıt başarısız: '+result,'error');saveBtn.disabled=false;saveBtn.innerHTML='<span class="icon">💾</span> Kaydet ve Bağlan'}}catch(error){console.log('Bağlantı kesildi (cihaz yeniden başlatılıyor):',error);showStatus('✅ İşlem tamamlandı! WiFi bilgileri kaydedildi. Cihaz yeniden başlatılıyor ve WiFi\'ye bağlanmaya çalışıyor. Bu sayfayı kapatabilirsiniz.','success')}});async function checkSavedWiFi(){try{const response=await fetch('/check');const data=await response.json();if(data.saved){showStatus(`ℹ️ Kayıtlı WiFi: ${data.ssid}`,'info')}}catch(error){console.error('Check hatası:',error)}}checkSavedWiFi()});
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

