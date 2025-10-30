Sorun: `WebSocketsClient` sınıfında `setInsecure()` metodu yok hatası

Neden:
- Kullanılan Links2004/WebSockets kütüphanesinde `setInsecure()` bulunmuyor.

Çözüm:
- `webSocket.beginSSL(host, port, "/")` ile WSS başlatıldı.
- `setInsecure()` satırı kaldırıldı. Sertifika doğrulaması daha sonra `setCACert()` alternatifleri ile ele alınacak (kütüphane desteklerse) veya fingerprint yöntemi kullanılacak.

Not:
- TLS şifreleme etkin; doğrulama için CA ekleme adımı ayrıca yapılacak.




