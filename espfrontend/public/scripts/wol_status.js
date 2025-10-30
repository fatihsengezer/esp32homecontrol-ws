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
