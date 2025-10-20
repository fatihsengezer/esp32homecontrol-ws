#ifndef BUZZER_H
#define BUZZER_H

#include <Arduino.h>

#define BUZZER_PIN 19
#define BUZZER_CHANNEL 0

// Buzzer setup
void buzzerInit() {
  pinMode(BUZZER_PIN, OUTPUT);
  ledcSetup(BUZZER_CHANNEL, 2000, 8); // 2 kHz, 8-bit
  ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
}

// Tekli bip
void buzzerBeep(int freq = 2000, int duration = 500) {
  ledcWriteTone(BUZZER_CHANNEL, freq);
  delay(duration);
  ledcWriteTone(BUZZER_CHANNEL, 0);
}

// White noise tarzı cızırtı
void buzzerNoise(int duration_ms) {
  unsigned long endTime = millis() + duration_ms;
  while (millis() < endTime) {
    int f = random(1000, 4000); // 1-4 kHz rastgele frekans
    ledcWriteTone(BUZZER_CHANNEL, f);
    delay(1);
  }
  ledcWriteTone(BUZZER_CHANNEL, 0);
}

#endif
