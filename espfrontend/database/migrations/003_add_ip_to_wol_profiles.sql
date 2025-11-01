-- ==================== ADD IP ADDRESS TO WOL PROFILES ====================
-- Migration: 003_add_ip_to_wol_profiles.sql
-- Tarih: 2025-01-27
-- Açıklama: wol_profiles tablosuna ip_address kolonu ekle

-- wol_profiles tablosuna ip_address kolonu ekle
ALTER TABLE wol_profiles ADD COLUMN ip_address VARCHAR(45) DEFAULT '0.0.0.0';

-- Mevcut kayıtlar için ip_address değerini '0.0.0.0' olarak ayarla (geriye dönük uyumluluk)
UPDATE wol_profiles SET ip_address = '0.0.0.0' WHERE ip_address IS NULL;

