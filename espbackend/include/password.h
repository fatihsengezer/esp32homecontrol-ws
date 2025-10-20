#ifndef PASSWORD_H
#define PASSWORD_H

struct WiFiNetwork {
  const char* ssid;
  const char* password;
};

WiFiNetwork networks[] = {
  {"SSID1", "PW1"},
  {"SSID2", "PW2"}
};

const int networkCount = sizeof(networks) / sizeof(networks[0]);

#endif
