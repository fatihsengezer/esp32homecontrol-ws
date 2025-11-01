document.addEventListener('DOMContentLoaded', function() {
  const scanBtn = document.getElementById('scan');
  const saveBtn = document.getElementById('save');
  const ssidSelect = document.getElementById('ssid');
  const passwordInput = document.getElementById('password');
  const statusMsg = document.getElementById('status');

  let networks = [];

  // Status mesajı göster
  function showStatus(message, type = 'info') {
    statusMsg.textContent = message;
    statusMsg.className = 'status-message ' + type;
  }

  // Kaydet butonunu kontrol et
  function checkSaveButton() {
    const hasSelection = ssidSelect.value.length > 0;
    const hasPassword = passwordInput.value.length > 0;
    saveBtn.disabled = !(hasSelection && hasPassword);
  }

  // SSID select ve password input değişikliklerini dinle
  ssidSelect.addEventListener('change', checkSaveButton);
  passwordInput.addEventListener('input', checkSaveButton);

  // Ağları tara
  scanBtn.addEventListener('click', async function() {
    try {
      scanBtn.disabled = true;
      scanBtn.innerHTML = '<span class="loading"></span> Taranıyor...';
      showStatus('🔍 WiFi ağları taranıyor...', 'info');
      
      const response = await fetch('/scan');
      
      if (!response.ok) {
        throw new Error('Tarama başarısız');
      }
      
      const data = await response.json();
      networks = data;
      
      // Select listesini temizle ve yeni ağları ekle
      ssidSelect.innerHTML = '<option value="">Ağ seçin...</option>';
      
      networks.forEach(network => {
        const option = document.createElement('option');
        option.value = network.ssid;
        const signalStrength = network.rssi > -70 ? '📶' : network.rssi > -80 ? '📵' : '📡';
        option.textContent = `${network.ssid} ${signalStrength} (${network.rssi} dBm)`;
        ssidSelect.appendChild(option);
      });
      
      showStatus(`✅ ${networks.length} ağ bulundu`, 'success');
      
    } catch (error) {
      console.error('Tarama hatası:', error);
      showStatus('❌ Tarama başarısız. Lütfen tekrar deneyin.', 'error');
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<span class="icon">📡</span> Ağları Tara';
    }
  });

  // Kaydet ve bağlan
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
      
      // Form data hazırla
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
        // WiFi bilgileri başarıyla kaydedildi
        showStatus('✅ WiFi bilgileri kaydedildi! Cihaz yeniden başlatılıyor...', 'success');
        
        // Cihaz yeniden başlatılırken mesaj göster
        setTimeout(() => {
          showStatus('✅ İşlem tamamlandı! Cihaz WiFi\'ye bağlanmaya çalışıyor. Bu sayfayı kapatabilirsiniz.', 'success');
        }, 2000);
      } else {
        // Gerçek bir hata durumu (örneğin parametre eksik)
        showStatus('❌ Kayıt başarısız: ' + result, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="icon">💾</span> Kaydet ve Bağlan';
      }
      
    } catch (error) {
      // Network hatası - ESP32 yeniden başlatıldığı için normal
      // Bu durumda işlem başarılı sayılmalı
      console.log('Bağlantı kesildi (cihaz yeniden başlatılıyor):', error);
      showStatus('✅ İşlem tamamlandı! WiFi bilgileri kaydedildi. Cihaz yeniden başlatılıyor ve WiFi\'ye bağlanmaya çalışıyor. Bu sayfayı kapatabilirsiniz.', 'success');
      // Butonu tekrar aktif etme - işlem tamamlandı
    }
  });

  // İlk yüklemede kayıtlı WiFi varsa kontrol et
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

  // Sayfa yüklendiğinde kayıtlı WiFi'yi kontrol et
  checkSavedWiFi();
});
