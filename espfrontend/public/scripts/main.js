// Sunucu ve localhost kontrolü
let wsUrl;

if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  wsUrl = "ws://localhost:5136/";
} else {
  wsUrl = "wss://riddleabby.serv00.net:5136/";
}

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  log("WebSocket bağlandı!");
  
  // Client tipi ve IP bilgisini bildir
  fetch('https://api.ipify.org?format=json')
    .then(response => response.json())
    .then(data => {
      const ip = data.ip;
      ws.send(`type:frontend;ip:${ip}`);
    })
    .catch(err => {
      console.error("IP alınamadı", err);
      ws.send("type:frontend;ip:unknown");
    });
};

ws.onmessage = (event) => {
  log("Mesaj: " + event.data);
};

function sendRelay(idx, state) {
  ws.send(`relay:${idx}:${state}`);
}

function sendWOL(idx) {
  ws.send(`wol:${idx}`);
}

function log(msg) {
  const logEl = document.getElementById("log");
  if (logEl) logEl.textContent += msg + "\n";
}
