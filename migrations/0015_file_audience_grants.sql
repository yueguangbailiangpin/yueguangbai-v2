PRAGMA foreign_keys = ON;

-- Formal migration 0015: only advances schema_version from 14 to 15.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=14
) THEN 1 ELSE 0 END;

-- Existing links retain their exact visibility behavior. Explicit audiences are
-- opt-in at the link level so the same object may have independent audiences
-- when linked to different business entities.
ALTER TABLE file_entity_links
ADD COLUMN authorization_mode TEXT NOT NULL DEFAULT 'LEGACY_VISIBILITY'
CHECK (authorization_mode IN (
  'LEGACY_VISIBILITY',
  'EXPLICIT_AUDIENCES'
));

ALTER TABLE file_entity_links
ADD COLUMN expires_at INTEGER
CHECK (expires_at IS NULL OR expires_at >= created_at);

ALTER TABLE file_entity_links
ADD COLUMN revoked_at INTEGER
CHECK (revoked_at IS NULL OR revoked_at >= created_at);

-- New read intents bind the exact entity link that authorized them. Historical
-- read intents remain NULL and continue using the legacy first-link behavior.
ALTER TABLE file_read_intents
ADD COLUMN file_entity_link_id TEXT
REFERENCES file_entity_links(id);

CREATE INDEX idx_file_entity_links_authorization
ON file_entity_links (
  authorization_mode,
  file_object_id,
  revoked_at,
  expires_at,
  created_at,
  id
);

CREATE TABLE file_entity_audience_grants (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  file_entity_link_id TEXT NOT NULL
    REFERENCES file_entity_links(id),
  subject_type TEXT NOT NULL
    CHECK (subject_type IN (
      'BUYER',
      'SELLER_ORGANIZATION',
      'STAFF_INTERNAL'
    )),
  buyer_customer_id TEXT
    REFERENCES buyer_customers(id),
  seller_organization_id TEXT
    REFERENCES seller_organizations(id),
  staff_permission_code TEXT
    CHECK (
      staff_permission_code IS NULL
      OR length(staff_permission_code) BETWEEN 1 AND 100
    ),
  staff_scope_type TEXT
    CHECK (staff_scope_type IS NULL OR staff_scope_type IN (
      'GLOBAL',
      'TEAM'
    )),
  staff_team_id TEXT
    REFERENCES staff_teams(id),
  granted_by_actor_type TEXT NOT NULL
    CHECK (granted_by_actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  granted_by_actor_id TEXT NOT NULL
    CHECK (length(granted_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  expires_at INTEGER
    CHECK (expires_at IS NULL OR expires_at > created_at),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (
      subject_type='BUYER'
      AND buyer_customer_id IS NOT NULL
      AND seller_organization_id IS NULL
      AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL
      AND staff_team_id IS NULL
    )
    OR
    (
      subject_type='SELLER_ORGANIZATION'
      AND buyer_customer_id IS NULL
      AND seller_organization_id IS NOT NULL
      AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL
      AND staff_team_id IS NULL
    )
    OR
    (
      subject_type='STAFF_INTERNAL'
      AND buyer_customer_id IS NULL
      AND seller_organization_id IS NULL
      AND staff_permission_code IS NOT NULL
      AND staff_scope_type IS NOT NULL
      AND (
        (staff_scope_type='GLOBAL' AND staff_team_id IS NULL)
        OR
        (staff_scope_type='TEAM' AND staff_team_id IS NOT NULL)
      )
    )
  )
) STRICT;

CREATE UNIQUE INDEX uq_file_audience_grant_subject
ON file_entity_audience_grants (
  file_entity_link_id,
  subject_type,
  ifnull(buyer_customer_id, ''),
  ifnull(seller_organization_id, '')
);

CREATE INDEX idx_file_audience_grants_buyer
ON file_entity_audience_grants (
  buyer_customer_id,
  file_entity_link_id,
  revoked_at,
  expires_at,
  id
)
WHERE subject_type='BUYER';

CREATE INDEX idx_file_audience_grants_seller
ON file_entity_audience_grants (
  seller_organization_id,
  file_entity_link_id,
  revoked_at,
  expires_at,
  id
)
WHERE subject_type='SELLER_ORGANIZATION';

CREATE INDEX idx_file_audience_grants_staff
ON file_entity_audience_grants (
  file_entity_link_id,
  staff_permission_code,
  staff_scope_type,
  staff_team_id,
  revoked_at,
  expires_at,
  id
)
WHERE subject_type='STAFF_INTERNAL';

CREATE TRIGGER trg_file_audience_grant_link_guard
BEFORE INSERT ON file_entity_audience_grants
WHEN NOT EXISTS (
  SELECT 1
  FROM file_entity_links link
  JOIN file_objects object
    ON object.id=link.file_object_id
  JOIN file_upload_intents intent
    ON intent.id=object.upload_intent_id
  WHERE link.id=NEW.file_entity_link_id
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grant_link_not_active');
END;

CREATE TRIGGER trg_file_audience_grants_revoke_only
BEFORE UPDATE ON file_entity_audience_grants
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_entity_link_id IS OLD.file_entity_link_id)
  OR NOT (NEW.subject_type IS OLD.subject_type)
  OR NOT (NEW.buyer_customer_id IS OLD.buyer_customer_id)
  OR NOT (NEW.seller_organization_id IS OLD.seller_organization_id)
  OR NOT (NEW.staff_permission_code IS OLD.staff_permission_code)
  OR NOT (NEW.staff_scope_type IS OLD.staff_scope_type)
  OR NOT (NEW.staff_team_id IS OLD.staff_team_id)
  OR NOT (NEW.granted_by_actor_type IS OLD.granted_by_actor_type)
  OR NOT (NEW.granted_by_actor_id IS OLD.granted_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grant_is_immutable');
END;

CREATE TRIGGER trg_file_audience_grants_no_delete
BEFORE DELETE ON file_entity_audience_grants
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grants_are_immutable');
END;

CREATE TRIGGER trg_explicit_file_link_revoke_only
BEFORE UPDATE ON file_entity_links
WHEN OLD.authorization_mode='EXPLICIT_AUDIENCES' AND (
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.entity_type IS OLD.entity_type)
  OR NOT (NEW.entity_id IS OLD.entity_id)
  OR NOT (NEW.purpose IS OLD.purpose)
  OR NOT (NEW.visibility IS OLD.visibility)
  OR NOT (NEW.linked_by_actor_type IS OLD.linked_by_actor_type)
  OR NOT (NEW.linked_by_actor_id IS OLD.linked_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.authorization_mode IS OLD.authorization_mode)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'explicit_file_link_is_immutable');
END;

CREATE TRIGGER trg_file_read_intent_link_guard
BEFORE INSERT ON file_read_intents
WHEN NEW.file_entity_link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM file_entity_links link
  WHERE link.id=NEW.file_entity_link_id
    AND link.file_object_id=NEW.file_object_id
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
)
BEGIN
  SELECT RAISE(ABORT, 'file_entity_link_not_readable');
END;

CREATE TABLE file_audience_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  file_entity_link_id TEXT NOT NULL
    REFERENCES file_entity_links(id),
  grant_id TEXT
    REFERENCES file_entity_audience_grants(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'EXPLICIT_LINK_CREATED',
      'AUDIENCE_GRANT_CREATED',
      'AUDIENCE_GRANT_REVOKED',
      'EXPLICIT_LINK_REVOKED'
    )),
  file_object_id TEXT NOT NULL
    REFERENCES file_objects(id),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN (
      'PRODUCT_APPLICATION',
      'ORDER',
      'REVIEW',
      'BUYER_REFUND',
      'SELLER_SETTLEMENT',
      'SUPPORT_CASE'
    )),
  entity_id TEXT NOT NULL
    CHECK (length(entity_id) BETWEEN 1 AND 200),
  subject_type TEXT
    CHECK (subject_type IS NULL OR subject_type IN (
      'BUYER',
      'SELLER_ORGANIZATION',
      'STAFF_INTERNAL'
    )),
  subject_authority_id TEXT
    CHECK (
      subject_authority_id IS NULL
      OR length(subject_authority_id) BETWEEN 1 AND 200
    ),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  effective_at INTEGER NOT NULL
    CHECK (effective_at >= 0),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (
    (event_type IN ('EXPLICIT_LINK_CREATED', 'EXPLICIT_LINK_REVOKED')
      AND grant_id IS NULL
      AND subject_type IS NULL
      AND subject_authority_id IS NULL)
    OR
    (event_type IN ('AUDIENCE_GRANT_CREATED', 'AUDIENCE_GRANT_REVOKED')
      AND grant_id IS NOT NULL
      AND subject_type IS NOT NULL
      AND subject_authority_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_file_audience_events_link
ON file_audience_events (
  file_entity_link_id,
  created_at,
  id
);

CREATE TRIGGER trg_file_audience_events_no_update
BEFORE UPDATE ON file_audience_events
BEGIN
  SELECT RAISE(ABORT, 'file_audience_events_are_immutable');
END;

CREATE TRIGGER trg_file_audience_events_no_delete
BEFORE DELETE ON file_audience_events
BEGIN
  SELECT RAISE(ABORT, 'file_audience_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=15,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=14;
