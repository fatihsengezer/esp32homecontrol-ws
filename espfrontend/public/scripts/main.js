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
    if (deviceSelector) deviceSelector.classList.remove('hidden');
    const logParent = document.getElementById('log_parent');
    if (logParent) logParent.classList.remove('hidden');
    
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
    
    const errorMsg = error.message || "Bilinmeyen hata";
    logMessage(`WebSocket hatası: ${errorMsg} (URL: ${ws.url})`, "ERROR");
    
    // Kullanıcıya toast göster
    showToast('WebSocket bağlantı hatası. Yeniden bağlanmaya çalışılıyor...', 'error');
    
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
      showToast('WebSocket bağlantısı kurulamadı. Lütfen manuel olarak yeniden bağlanmayı deneyin.', 'error');
      const reconnectBtn = document.getElementById('reconnect-btn');
      if (reconnectBtn) {
        reconnectBtn.classList.remove('hidden');
      }
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
  const reconnectBtn = document.getElementById('reconnect-btn');
  if (reconnectBtn) reconnectBtn.classList.add('hidden');
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
      
      // 401 hatası - login sayfasına yönlendir
      showToast('Oturum süresi dolmuş. Giriş sayfasına yönlendiriliyorsunuz...', 'error');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
      return; // WebSocket bağlantısını başlatma
    } else {
      console.log('❌ Beklenmeyen response status:', response.status);
      console.log('❌ Response headers:', response.headers);
      showToast('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', 'error');
    }
  } catch (error) {
    console.error('❌ Kullanıcı bilgileri alınamadı:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Network hatası veya diğer hatalar
    if (error.message.includes('fetch') || error.message.includes('network')) {
      showToast('Sunucuya bağlanılamıyor. Lütfen bağlantınızı kontrol edin.', 'error');
    } else {
      showToast('Bir hata oluştu. Giriş sayfasına yönlendiriliyorsunuz...', 'error');
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
      return;
    }
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
        
        if (devices.length === 0) {
          deviceSelect.innerHTML = '<option value="">Cihaz bulunamadı</option>';
          showToast('Henüz cihaz eklenmemiş. Admin panelinden cihaz ekleyebilirsiniz.', 'info');
        } else {
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
      }
    } else if (response.status === 401) {
      console.log('❌ Oturum süresi dolmuş (401) - cihazlar yüklenemedi');
      showToast('Oturum süresi dolmuş. Giriş sayfasına yönlendiriliyorsunuz...', 'error');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } else {
      console.log('❌ Cihazlar yüklenemedi:', response.status);
      showToast('Cihazlar yüklenirken bir hata oluştu.', 'error');
    }
  } catch (error) {
    console.error('❌ Cihaz yükleme hatası:', error);
    showToast('Cihazlar yüklenirken bir hata oluştu: ' + error.message, 'error');
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
        if (user.role === 'admin') {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
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
        if (user.role === 'admin') {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
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
      if (hidden.has(id)) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
      }
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
    if (controlpanel) controlpanel.classList.remove('hidden');

    // Relay paneli
    const relayContainer = document.getElementById('relaylist');
    if (relayContainer && typeof cap.relayCount === 'number') {
      const relayParent = document.getElementById('relay_parent');
      if (relayParent) {
        if (cap.relayCount > 0) {
          relayParent.classList.remove('hidden');
        } else {
          relayParent.classList.add('hidden');
        }
      }
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
      if (wolParent) wolParent.classList.remove('hidden');
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
