#ifndef PASSWORD_H
#define PASSWORD_H

struct WiFiNetwork {
  const char* ssid;
  const char* password;
};

// ŞABLON: Bu dosyayı password.h adıyla kopyalayın ve SSID/şifreleri doldurun
WiFiNetwork networks[] = {
  // { "MY_WIFI", "MY_WIFI_PASSWORD" },
};

const int networkCount = sizeof(networks) / sizeof(networks[0]);

#endif

