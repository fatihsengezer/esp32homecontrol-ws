#ifndef STATUSLED_H
#define STATUSLED_H

#include <Arduino.h>

#define LED_PIN 23

// LED setup
void ledInit() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
}

// Tek blink (cihaz açılma vb.)
void ledBlink(int duration=200) {
  digitalWrite(LED_PIN, HIGH);
  delay(duration);
  digitalWrite(LED_PIN, LOW);
}

// Hızlı flash (WS mesaj geldiğinde)
void ledFlash(int duration=100) {
  ledBlink(duration);
}

// Yavaş yanıp sön (WiFi tarama)
void ledSlowBlink(int cycles=5, int interval=500) {
  for(int i=0; i<cycles; i++){
    digitalWrite(LED_PIN, HIGH);
    delay(interval);
    digitalWrite(LED_PIN, LOW);
    delay(interval);
  }
}

// Sabit yanar (WiFi bağlandı)
void ledOn() {
  digitalWrite(LED_PIN, HIGH);
}

// Sabit söner
void ledOff() {
  digitalWrite(LED_PIN, LOW);
}

#endif
