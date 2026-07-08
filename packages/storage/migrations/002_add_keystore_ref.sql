-- Migration 002: Add keystore_ref and is_default to provider_profiles
ALTER TABLE provider_profiles ADD COLUMN keystore_ref TEXT;
ALTER TABLE provider_profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
