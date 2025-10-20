const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();

// Public dizini sun
app.use(express.static("public"));

// HTTP server oluştur
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

let esp32 = null;

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (msg) => {
    msg = msg.toString();
    console.log("Received:", msg);

    // ESP32 online bildirimi
    if (msg.includes("esp32:online")) {
      esp32 = ws;
      console.log("ESP32 bağlandı");
    }

    // Browser → ESP32
    if (esp32 && ws !== esp32) {
      esp32.send(msg);
    }

    // ESP32 → Browser
    wss.clients.forEach(client => {
      if (client !== esp32 && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });

  ws.on("close", () => console.log("Client disconnected"));
});

// Heartbeat log
setInterval(() => {
  console.log("Server alive:", new Date().toISOString());
}, 5000);

// Server'ı başlat (8080 portu)
server.listen(8080, () => {
  console.log("WebSocket server running on port 8080");
});
