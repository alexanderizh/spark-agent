-- Migration 057: Persist workflow nodes skipped by conditional routing

ALTER TABLE workflow_runs ADD COLUMN skipped_node_ids_json TEXT NOT NULL DEFAULT '[]';
