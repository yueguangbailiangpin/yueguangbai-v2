PRAGMA foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN schema_version=32 THEN 1 ELSE 0 END
FROM app_schema_state WHERE singleton_id=1;

CREATE TABLE feishu_workbench_mirrors (
  work_item_id TEXT PRIMARY KEY REFERENCES staff_work_items(id),
  mirror_key TEXT NOT NULL UNIQUE CHECK (length(mirror_key) BETWEEN 1 AND 200),
  mirrored_work_item_version INTEGER NOT NULL CHECK (mirrored_work_item_version>=1),
  adapter_version INTEGER NOT NULL CHECK (adapter_version>=1),
  last_outbox_event_id TEXT NOT NULL CHECK (length(last_outbox_event_id) BETWEEN 1 AND 200),
  last_synced_at INTEGER NOT NULL CHECK (typeof(last_synced_at)='integer' AND last_synced_at>=0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at)
) STRICT;
CREATE INDEX idx_feishu_workbench_mirrors_version
ON feishu_workbench_mirrors(mirrored_work_item_version,updated_at,work_item_id);
CREATE TRIGGER trg_feishu_workbench_mirrors_insert_guard
BEFORE INSERT ON feishu_workbench_mirrors
WHEN NEW.version<>1 OR NEW.updated_at<>NEW.created_at
  OR NOT EXISTS(SELECT 1 FROM staff_work_items item WHERE item.id=NEW.work_item_id AND item.version>=NEW.mirrored_work_item_version)
BEGIN SELECT RAISE(ABORT,'feishu_workbench_mirror_source_mismatch'); END;
CREATE TRIGGER trg_feishu_workbench_mirrors_update_guard
BEFORE UPDATE ON feishu_workbench_mirrors
WHEN NEW.work_item_id IS NOT OLD.work_item_id OR NEW.mirror_key IS NOT OLD.mirror_key
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NEW.mirrored_work_item_version<OLD.mirrored_work_item_version
  OR NOT EXISTS(SELECT 1 FROM staff_work_items item WHERE item.id=NEW.work_item_id AND item.version>=NEW.mirrored_work_item_version)
BEGIN SELECT RAISE(ABORT,'feishu_workbench_mirror_invalid_update'); END;
CREATE TRIGGER trg_feishu_workbench_mirrors_no_delete
BEFORE DELETE ON feishu_workbench_mirrors
BEGIN SELECT RAISE(ABORT,'feishu_workbench_mirrors_are_immutable'); END;

CREATE TABLE feishu_workbench_callback_receipts (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
  nonce_hash TEXT NOT NULL UNIQUE CHECK (length(nonce_hash)=64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','REJECTED')),
  response_json TEXT CHECK (response_json IS NULL OR (json_valid(response_json) AND json_type(response_json)='object')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('FORBIDDEN','NOT_FOUND','VERSION_CONFLICT','DEPENDENCY_UNAVAILABLE')),
  lease_token TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  completed_at INTEGER,
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((status='PROCESSING' AND response_json IS NULL AND failure_code IS NULL AND completed_at IS NULL)
    OR (status='SUCCEEDED' AND response_json IS NOT NULL AND failure_code IS NULL AND lease_token IS NULL AND completed_at IS NOT NULL)
    OR (status='REJECTED' AND response_json IS NULL AND failure_code IS NOT NULL AND lease_token IS NULL AND completed_at IS NOT NULL))
) STRICT;
CREATE INDEX idx_feishu_workbench_callback_receipts_lease
ON feishu_workbench_callback_receipts(lease_expires_at,event_id);
CREATE TRIGGER trg_feishu_workbench_callback_receipts_insert_guard
BEFORE INSERT ON feishu_workbench_callback_receipts
WHEN NEW.status<>'PROCESSING' OR NEW.version<>1 OR NEW.updated_at<>NEW.created_at
  OR NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL
BEGIN SELECT RAISE(ABORT,'feishu_workbench_callback_receipt_invalid_insert'); END;
CREATE TRIGGER trg_feishu_workbench_callback_receipts_update_guard
BEFORE UPDATE ON feishu_workbench_callback_receipts
WHEN NEW.event_id IS NOT OLD.event_id OR NEW.nonce_hash IS NOT OLD.nonce_hash OR NEW.payload_hash IS NOT OLD.payload_hash
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT ((OLD.status='PROCESSING' AND NEW.status IN ('PROCESSING','SUCCEEDED','REJECTED')) OR (OLD.status IN ('SUCCEEDED','REJECTED') AND NEW.status=OLD.status))
BEGIN SELECT RAISE(ABORT,'feishu_workbench_callback_receipt_invalid_transition'); END;
CREATE TRIGGER trg_feishu_workbench_callback_receipts_no_delete
BEFORE DELETE ON feishu_workbench_callback_receipts
BEGIN SELECT RAISE(ABORT,'feishu_workbench_callback_receipts_are_immutable'); END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='feishu_workbench_mirrors')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='feishu_workbench_callback_receipts')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_feishu_workbench_callback_receipts_update_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state SET schema_version=33,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=32;
INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
