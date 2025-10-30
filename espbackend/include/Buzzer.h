#pragma once
#include <Arduino.h>

// Buzzer pin
#define BUZZER_PIN 19  // İstersen pin numarasını değiştir

// PWM ayarları
const int buzzerChannel = 0;
const int buzzerResolution = 8; // 8 bit = 0-255 duty
int currentFreq = 0;

void buzzerInit() {
  ledcSetup(buzzerChannel, 1000, buzzerResolution);
  ledcAttachPin(BUZZER_PIN, buzzerChannel);
}

// --- Ses çal ---
void buzzerPlay(int freq, int duration, float volume = 1.0) {
  if (volume < 0) volume = 0;
  if (volume > 1) volume = 1;

  int duty = (int)(255 * volume);
  ledcWriteTone(buzzerChannel, freq);
  ledcWrite(buzzerChannel, duty);

  delay(duration);

  ledcWriteTone(buzzerChannel, 0); // Durdur
  ledcWrite(buzzerChannel, 0);
}

// --- Basit bip (eski fonksiyon uyumu için) ---
void buzzerBeep(int freq = 2000, int duration = 200) {
  buzzerPlay(freq, duration, 1.0);
}
