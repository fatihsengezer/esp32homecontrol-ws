const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4, internal değil (localhost değil)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const ip = getLocalIP();
console.log('==========================================');
console.log('ESP32 Ev Otomasyon Server IP Bilgileri');
console.log('==========================================');
console.log(`Server IP: ${ip}`);
console.log(`Web URL: http://${ip}:8080`);
console.log(`WebSocket URL: ws://${ip}:8080/`);
console.log('==========================================');
console.log('ESP32 kodunda bu IP\'yi kullanın:');
console.log(`webSocket.begin("${ip}", 8080, "/");`);
console.log('==========================================');




