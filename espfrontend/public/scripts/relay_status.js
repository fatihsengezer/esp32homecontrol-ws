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
