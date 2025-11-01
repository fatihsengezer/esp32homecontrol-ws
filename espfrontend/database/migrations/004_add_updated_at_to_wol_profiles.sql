-- ==================== ADD UPDATED_AT TO WOL PROFILES ====================
-- Migration: 004_add_updated_at_to_wol_profiles.sql
-- Tarih: 2025-11-01
-- Açıklama: wol_profiles tablosuna updated_at kolonu ekle

-- wol_profiles tablosuna updated_at kolonu ekle
ALTER TABLE wol_profiles ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Mevcut kayıtlar için updated_at değerini created_at'e eşitle (eğer created_at varsa)
-- SQLite'da ALTER TABLE ile DEFAULT değer atama sınırlı olduğu için, bu işlem manuel yapılabilir
-- Mevcut kayıtlar için updated_at'i CURRENT_TIMESTAMP olarak ayarla
UPDATE wol_profiles SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;

