-- Migration 003: Add provider_profile_id to sessions
ALTER TABLE sessions ADD COLUMN provider_profile_id TEXT;
