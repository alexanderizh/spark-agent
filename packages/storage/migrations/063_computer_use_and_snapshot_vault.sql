-- Computer Use / Application Snapshot durable state and encrypted blob metadata.
-- Raw screenshots and accessibility text are never stored in SQLite.

CREATE TABLE computer_sessions (
  id                   TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL,
  turn_id              TEXT NOT NULL,
  workflow_run_id      TEXT,
  environment          TEXT NOT NULL
                         CHECK (environment IN ('safe_browser', 'safe_desktop', 'my_desktop')),
  status               TEXT NOT NULL
                         CHECK (status IN (
                           'preflighting', 'observing', 'planning', 'waiting_approval',
                           'acting', 'verifying', 'paused', 'handoff_required',
                           'completed', 'failed', 'canceled'
                         )),
  provider_profile_id  TEXT NOT NULL,
  model_id             TEXT NOT NULL,
  task_contract_json   TEXT NOT NULL CHECK (json_valid(task_contract_json)),
  actuator_lease_id    TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  ended_at             TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_computer_sessions_session_created
  ON computer_sessions(session_id, created_at DESC);
CREATE INDEX idx_computer_sessions_status_updated
  ON computer_sessions(status, updated_at DESC);

CREATE TABLE computer_snapshot_blobs (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('image', 'text', 'preview')),
  storage_key       TEXT NOT NULL UNIQUE
                      CHECK (
                        length(storage_key) BETWEEN 1 AND 200
                        AND instr(storage_key, '/') = 0
                        AND instr(storage_key, '\') = 0
                        AND storage_key NOT LIKE '%..%'
                      ),
  byte_length       INTEGER NOT NULL CHECK (byte_length > 0),
  plaintext_sha256  TEXT NOT NULL
                      CHECK (
                        length(plaintext_sha256) = 64
                        AND plaintext_sha256 = lower(plaintext_sha256)
                        AND plaintext_sha256 NOT GLOB '*[^0-9a-f]*'
                      ),
  cipher_sha256     TEXT NOT NULL
                      CHECK (
                        length(cipher_sha256) = 64
                        AND cipher_sha256 = lower(cipher_sha256)
                        AND cipher_sha256 NOT GLOB '*[^0-9a-f]*'
                      ),
  ref_count         INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_computer_snapshot_blobs_unref_created
  ON computer_snapshot_blobs(ref_count, created_at);

CREATE TABLE application_snapshots (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT,
  turn_id               TEXT,
  computer_session_id   TEXT,
  kind                  TEXT NOT NULL
                          CHECK (kind IN (
                            'user_context', 'execution_before', 'execution_after',
                            'verification', 'manual_checkpoint'
                          )),
  app_id                TEXT NOT NULL,
  app_name              TEXT NOT NULL,
  window_id             TEXT NOT NULL,
  window_title          TEXT NOT NULL,
  bounds_json           TEXT NOT NULL CHECK (json_valid(bounds_json)),
  display_json          TEXT NOT NULL CHECK (json_valid(display_json)),
  image_blob_id         TEXT NOT NULL,
  text_blob_id          TEXT,
  preview_blob_id       TEXT,
  image_sha256          TEXT NOT NULL
                          CHECK (
                            length(image_sha256) = 64
                            AND image_sha256 = lower(image_sha256)
                            AND image_sha256 NOT GLOB '*[^0-9a-f]*'
                          ),
  perceptual_hash       TEXT,
  tree_version          TEXT,
  accessible_text_mode  TEXT NOT NULL
                          CHECK (accessible_text_mode IN ('visible_only', 'app_exposed')),
  redaction_json        TEXT NOT NULL CHECK (json_valid(redaction_json)),
  retention_mode        TEXT NOT NULL
                          CHECK (retention_mode IN ('session', 'computer_run', 'ttl', 'manual')),
  expires_at            TEXT,
  created_at            TEXT NOT NULL,
  deleted_at            TEXT,
  CHECK (session_id IS NOT NULL OR (turn_id IS NULL AND computer_session_id IS NULL)),
  CHECK (
    (retention_mode = 'ttl' AND expires_at IS NOT NULL)
    OR (retention_mode != 'ttl' AND expires_at IS NULL)
  ),
  CHECK (retention_mode != 'session' OR session_id IS NOT NULL),
  CHECK (retention_mode != 'computer_run' OR computer_session_id IS NOT NULL),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (image_blob_id) REFERENCES computer_snapshot_blobs(id) ON DELETE RESTRICT,
  FOREIGN KEY (text_blob_id) REFERENCES computer_snapshot_blobs(id) ON DELETE RESTRICT,
  FOREIGN KEY (preview_blob_id) REFERENCES computer_snapshot_blobs(id) ON DELETE RESTRICT
);

CREATE INDEX idx_application_snapshots_session_created
  ON application_snapshots(session_id, created_at DESC);
CREATE INDEX idx_application_snapshots_computer_created
  ON application_snapshots(computer_session_id, created_at DESC);
CREATE INDEX idx_application_snapshots_expiry
  ON application_snapshots(expires_at) WHERE expires_at IS NOT NULL;

CREATE TRIGGER application_snapshots_blob_refs_after_insert
AFTER INSERT ON application_snapshots
BEGIN
  UPDATE computer_snapshot_blobs SET ref_count = ref_count + 1 WHERE id = NEW.image_blob_id;
  UPDATE computer_snapshot_blobs SET ref_count = ref_count + 1 WHERE id = NEW.text_blob_id;
  UPDATE computer_snapshot_blobs SET ref_count = ref_count + 1 WHERE id = NEW.preview_blob_id;
END;

CREATE TRIGGER application_snapshots_blob_refs_after_delete
AFTER DELETE ON application_snapshots
BEGIN
  UPDATE computer_snapshot_blobs SET ref_count = ref_count - 1 WHERE id = OLD.image_blob_id;
  UPDATE computer_snapshot_blobs SET ref_count = ref_count - 1 WHERE id = OLD.text_blob_id;
  UPDATE computer_snapshot_blobs SET ref_count = ref_count - 1 WHERE id = OLD.preview_blob_id;
END;

CREATE TRIGGER application_snapshots_blob_ids_immutable
BEFORE UPDATE OF image_blob_id, text_blob_id, preview_blob_id ON application_snapshots
BEGIN
  SELECT RAISE(ABORT, 'snapshot blob references are immutable');
END;

CREATE TRIGGER application_snapshots_ownership_before_insert
BEFORE INSERT ON application_snapshots
WHEN NEW.computer_session_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM computer_sessions computer_session
    WHERE computer_session.id = NEW.computer_session_id
      AND computer_session.session_id = NEW.session_id
      AND computer_session.turn_id = NEW.turn_id
  )
BEGIN
  SELECT RAISE(ABORT, 'snapshot ownership does not match computer session');
END;

CREATE TRIGGER application_snapshots_ownership_immutable
BEFORE UPDATE OF session_id, turn_id, computer_session_id ON application_snapshots
BEGIN
  SELECT RAISE(ABORT, 'snapshot ownership is immutable');
END;

CREATE TRIGGER computer_snapshot_blobs_referenced_delete_guard
BEFORE DELETE ON computer_snapshot_blobs
WHEN OLD.ref_count != 0
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a referenced snapshot blob');
END;

CREATE TABLE computer_actions (
  id                           TEXT PRIMARY KEY,
  computer_session_id          TEXT NOT NULL,
  step_index                   INTEGER NOT NULL CHECK (step_index >= 0),
  action_json                  TEXT NOT NULL CHECK (json_valid(action_json)),
  intent                       TEXT NOT NULL,
  risk_level                   TEXT NOT NULL CHECK (risk_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  policy_decision              TEXT NOT NULL
                                 CHECK (policy_decision IN ('allow', 'require_approval', 'require_handoff', 'deny')),
  approval_ticket_id           TEXT,
  before_frame_id              TEXT NOT NULL,
  after_frame_id               TEXT,
  expected_postcondition_json  TEXT CHECK (expected_postcondition_json IS NULL OR json_valid(expected_postcondition_json)),
  status                       TEXT NOT NULL
                                 CHECK (status IN ('requested', 'blocked', 'executing', 'executed', 'failed', 'canceled')),
  error_code                   TEXT,
  created_at                   TEXT NOT NULL,
  completed_at                 TEXT,
  UNIQUE (computer_session_id, step_index),
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_computer_actions_session_step
  ON computer_actions(computer_session_id, step_index);
CREATE INDEX idx_computer_actions_status_created
  ON computer_actions(status, created_at);

CREATE TABLE computer_approvals (
  id                    TEXT PRIMARY KEY,
  computer_session_id   TEXT NOT NULL,
  action_id             TEXT NOT NULL,
  risk_level            TEXT NOT NULL CHECK (risk_level IN ('L2', 'L3')),
  action_digest         TEXT NOT NULL
                          CHECK (
                            length(action_digest) = 64
                            AND action_digest = lower(action_digest)
                            AND action_digest NOT GLOB '*[^0-9a-f]*'
                          ),
  target_digest         TEXT NOT NULL
                          CHECK (
                            length(target_digest) = 64
                            AND target_digest = lower(target_digest)
                            AND target_digest NOT GLOB '*[^0-9a-f]*'
                          ),
  data_class_digest     TEXT
                          CHECK (
                            data_class_digest IS NULL
                            OR (
                              length(data_class_digest) = 64
                              AND data_class_digest = lower(data_class_digest)
                              AND data_class_digest NOT GLOB '*[^0-9a-f]*'
                            )
                          ),
  approved_by           TEXT CHECK (approved_by IN ('local_user', 'remote_device')),
  approver_id           TEXT,
  nonce_hash            TEXT
                          CHECK (
                            nonce_hash IS NULL
                            OR (
                              length(nonce_hash) = 64
                              AND nonce_hash = lower(nonce_hash)
                              AND nonce_hash NOT GLOB '*[^0-9a-f]*'
                            )
                          ),
  approved_at           TEXT,
  expires_at            TEXT NOT NULL,
  used_at               TEXT,
  decision              TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'denied', 'expired')),
  created_at            TEXT NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (approved_at IS NULL OR (approved_at >= created_at AND approved_at < expires_at)),
  CHECK (used_at IS NULL OR (approved_at IS NOT NULL AND used_at >= approved_at AND used_at < expires_at)),
  CHECK (approved_by != 'remote_device' OR risk_level = 'L2'),
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES computer_actions(id) ON DELETE CASCADE
);

CREATE INDEX idx_computer_approvals_session_created
  ON computer_approvals(computer_session_id, created_at DESC);
CREATE INDEX idx_computer_approvals_pending_expiry
  ON computer_approvals(decision, expires_at);

CREATE TABLE computer_verifications (
  id                    TEXT PRIMARY KEY,
  computer_session_id   TEXT NOT NULL,
  spec_json             TEXT NOT NULL CHECK (json_valid(spec_json)),
  status                TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'inconclusive')),
  evidence_json         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  confidence            REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  verifier_model_id     TEXT,
  created_at            TEXT NOT NULL,
  completed_at          TEXT,
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_computer_verifications_session_created
  ON computer_verifications(computer_session_id, created_at DESC);

CREATE TABLE computer_actuator_leases (
  id                    TEXT PRIMARY KEY,
  environment_key       TEXT NOT NULL,
  computer_session_id   TEXT NOT NULL,
  operator_id           TEXT NOT NULL,
  acquired_at           TEXT NOT NULL,
  heartbeat_at          TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  released_at           TEXT,
  CHECK (heartbeat_at >= acquired_at),
  CHECK (expires_at > acquired_at),
  CHECK (expires_at > heartbeat_at),
  CHECK (released_at IS NULL OR released_at >= heartbeat_at),
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_computer_actuator_leases_active_environment
  ON computer_actuator_leases(environment_key) WHERE released_at IS NULL;
CREATE INDEX idx_computer_actuator_leases_expiry
  ON computer_actuator_leases(expires_at) WHERE released_at IS NULL;
