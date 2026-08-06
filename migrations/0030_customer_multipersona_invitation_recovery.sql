PRAGMA foreign_keys = ON;

-- Customer multi-persona, invitation, and recovery. This migration may only
-- advance the exact 0029 baseline; applying it twice or out of order fails.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=29
) THEN 1 ELSE 0 END;

-- subject_type is retained only as a legacy creation classification. Persona
-- authority is the relation below, so one subject may now own both relations.
DROP TRIGGER trg_buyer_identity_subject_type_guard;
DROP TRIGGER trg_seller_member_identity_subject_type_guard;

CREATE TABLE customer_account_personas (
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  persona_type TEXT NOT NULL CHECK (persona_type IN ('BUYER','SELLER_MEMBER')),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_member_id TEXT REFERENCES seller_organization_members(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (account_id, persona_type),
  UNIQUE (identity_subject_id, persona_type),
  UNIQUE (buyer_customer_id),
  UNIQUE (seller_member_id),
  CHECK (
    (persona_type='BUYER' AND buyer_customer_id IS NOT NULL
      AND seller_member_id IS NULL)
    OR
    (persona_type='SELLER_MEMBER' AND seller_member_id IS NOT NULL
      AND buyer_customer_id IS NULL)
  )
) STRICT;

CREATE INDEX idx_customer_account_personas_subject
ON customer_account_personas (identity_subject_id, persona_type, account_id);

CREATE TRIGGER trg_customer_account_persona_source_guard
BEFORE INSERT ON customer_account_personas
WHEN NOT EXISTS (
  SELECT 1 FROM customer_login_accounts account
  WHERE account.id=NEW.account_id
    AND account.identity_subject_id=NEW.identity_subject_id
)
OR (
  NEW.persona_type='BUYER' AND NOT EXISTS (
    SELECT 1 FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.identity_subject_id=NEW.identity_subject_id
  )
)
OR (
  NEW.persona_type='SELLER_MEMBER' AND NOT EXISTS (
    SELECT 1 FROM seller_organization_members member
    WHERE member.id=NEW.seller_member_id
      AND member.identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_persona_source_mismatch');
END;

CREATE TRIGGER trg_customer_account_personas_no_update
BEFORE UPDATE ON customer_account_personas
WHEN NOT (
  OLD.persona_type='BUYER'
  AND NEW.account_id=OLD.account_id
  AND NEW.persona_type=OLD.persona_type
  AND NEW.seller_member_id IS NULL
  AND NEW.created_at=OLD.created_at
  AND EXISTS (
    SELECT 1 FROM customer_login_accounts account
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
    WHERE account.id=NEW.account_id
      AND buyer.id=NEW.buyer_customer_id
      AND NEW.identity_subject_id=account.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_personas_are_immutable');
END;

CREATE TRIGGER trg_customer_account_personas_no_delete
BEFORE DELETE ON customer_account_personas
BEGIN
  SELECT RAISE(ABORT, 'customer_account_personas_are_immutable');
END;

INSERT INTO customer_account_personas (
  account_id, identity_subject_id, persona_type,
  buyer_customer_id, seller_member_id, created_at
)
SELECT account.id, account.identity_subject_id, 'BUYER', buyer.id, NULL,
  MAX(account.created_at, buyer.created_at)
FROM customer_login_accounts account
JOIN buyer_customers buyer
  ON buyer.identity_subject_id=account.identity_subject_id
WHERE account.account_type='BUYER';

INSERT INTO customer_account_personas (
  account_id, identity_subject_id, persona_type,
  buyer_customer_id, seller_member_id, created_at
)
SELECT account.id, account.identity_subject_id, 'SELLER_MEMBER', NULL, member.id,
  MAX(account.created_at, member.created_at)
FROM customer_login_accounts account
JOIN seller_organization_members member
  ON member.identity_subject_id=account.identity_subject_id
WHERE account.account_type='SELLER_MEMBER';

-- Keep all current activation paths compatible while making the relation the
-- sole runtime authority. INSERT OR IGNORE is safe because all keys are unique.
CREATE TRIGGER trg_customer_account_persona_after_account_buyer
AFTER INSERT ON customer_login_accounts
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT NEW.id, NEW.identity_subject_id, 'BUYER', buyer.id, NULL, NEW.created_at
  FROM buyer_customers buyer
  WHERE buyer.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_account_seller
AFTER INSERT ON customer_login_accounts
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT NEW.id, NEW.identity_subject_id, 'SELLER_MEMBER', NULL, member.id,
    NEW.created_at
  FROM seller_organization_members member
  WHERE member.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_buyer
AFTER INSERT ON buyer_customers
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT account.id, NEW.identity_subject_id, 'BUYER', NEW.id, NULL, NEW.created_at
  FROM customer_login_accounts account
  WHERE account.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_seller_member
AFTER INSERT ON seller_organization_members
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT account.id, NEW.identity_subject_id, 'SELLER_MEMBER', NULL, NEW.id,
    NEW.created_at
  FROM customer_login_accounts account
  WHERE account.identity_subject_id=NEW.identity_subject_id;
END;

-- The pre-existing owner-only Buyer rebind command remains compatible for a
-- Buyer-only account. A dual-persona or Seller account cannot be rebound by
-- that legacy command because doing so would silently detach the other role.
CREATE TRIGGER trg_customer_account_identity_rebind_guard
BEFORE UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id AND NOT (
  (SELECT COUNT(*) FROM customer_account_personas
    WHERE account_id=OLD.id)=1
  AND EXISTS (
    SELECT 1 FROM customer_account_personas
    WHERE account_id=OLD.id AND persona_type='BUYER'
  )
  AND EXISTS (
    SELECT 1 FROM buyer_customers
    WHERE identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_rebind_requires_owner_conflict_workflow');
END;

CREATE TRIGGER trg_customer_account_identity_rebind_persona_sync
AFTER UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id
BEGIN
  UPDATE customer_account_personas
  SET identity_subject_id=NEW.identity_subject_id,
    buyer_customer_id=(
      SELECT id FROM buyer_customers
      WHERE identity_subject_id=NEW.identity_subject_id
    )
  WHERE account_id=NEW.id AND persona_type='BUYER';
END;

CREATE TABLE customer_buyer_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  wechat_display TEXT NOT NULL CHECK (length(wechat_display) BETWEEN 3 AND 128),
  normalized_wechat TEXT NOT NULL CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  wechat_hash TEXT NOT NULL CHECK (
    length(wechat_hash)=64 AND wechat_hash NOT GLOB '*[^0-9a-f]*'
  ),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at=issued_at+604800000),
  consumed_at INTEGER,
  consumed_by_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at=issued_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_by_account_id IS NULL
      AND revoked_at IS NULL AND revoked_by_staff_id IS NULL)
    OR
    (status='CONSUMED' AND consumed_at IS NOT NULL
      AND consumed_by_account_id IS NOT NULL
      AND revoked_at IS NULL AND revoked_by_staff_id IS NULL)
    OR
    (status='REVOKED' AND consumed_at IS NULL AND consumed_by_account_id IS NULL
      AND revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_customer_buyer_invitations_staff
ON customer_buyer_invitations (issued_by_staff_id, issued_at DESC, id);

CREATE INDEX idx_customer_buyer_invitations_expiry
ON customer_buyer_invitations (status, expires_at, id);

CREATE INDEX idx_customer_buyer_invitations_wechat_marketplace
ON customer_buyer_invitations (wechat_hash, marketplace_code, status, expires_at);

CREATE TRIGGER trg_customer_buyer_invitation_transition_guard
BEFORE UPDATE ON customer_buyer_invitations
WHEN NEW.id<>OLD.id OR NEW.token_hash<>OLD.token_hash
  OR NEW.wechat_display<>OLD.wechat_display
  OR NEW.normalized_wechat<>OLD.normalized_wechat
  OR NEW.wechat_hash<>OLD.wechat_hash
  OR NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.issued_by_staff_id<>OLD.issued_by_staff_id
  OR NEW.issued_at<>OLD.issued_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status<>'ACTIVE' OR NEW.status NOT IN ('CONSUMED','REVOKED')
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_invalid_transition');
END;

CREATE TRIGGER trg_customer_buyer_invitations_no_delete
BEFORE DELETE ON customer_buyer_invitations
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitations_are_immutable');
END;

CREATE TABLE customer_buyer_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  invitation_id TEXT NOT NULL REFERENCES customer_buyer_invitations(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ISSUED','REVOKED','CONSUMED','REJECTED')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  idempotency_key TEXT,
  token_hash TEXT CHECK (
    token_hash IS NULL OR (
      length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_customer_buyer_invitation_events_invitation
ON customer_buyer_invitation_events (invitation_id, created_at, id);

CREATE TRIGGER trg_customer_buyer_invitation_events_no_update
BEFORE UPDATE ON customer_buyer_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_events_are_immutable');
END;

CREATE TRIGGER trg_customer_buyer_invitation_events_no_delete
BEFORE DELETE ON customer_buyer_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_events_are_immutable');
END;

CREATE TABLE customer_password_reset_tokens (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  wechat_hash TEXT NOT NULL CHECK (
    length(wechat_hash)=64 AND wechat_hash NOT GLOB '*[^0-9a-f]*'
  ),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  verification_note TEXT NOT NULL CHECK (length(verification_note) BETWEEN 8 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at=issued_at+1800000),
  consumed_at INTEGER,
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at=issued_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL)
    OR
    (status='CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL)
    OR
    (status='REVOKED' AND consumed_at IS NULL AND revoked_at IS NOT NULL
      AND revoked_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_customer_password_reset_active_account
ON customer_password_reset_tokens (account_id) WHERE status='ACTIVE';

CREATE INDEX idx_customer_password_reset_expiry
ON customer_password_reset_tokens (status, expires_at, id);

CREATE TRIGGER trg_customer_password_reset_source_guard
BEFORE INSERT ON customer_password_reset_tokens
WHEN NOT EXISTS (
  SELECT 1 FROM customer_login_accounts account
  WHERE account.id=NEW.account_id
    AND account.identity_subject_id=NEW.identity_subject_id
)
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_source_mismatch');
END;

CREATE TRIGGER trg_customer_password_reset_transition_guard
BEFORE UPDATE ON customer_password_reset_tokens
WHEN NEW.id<>OLD.id OR NEW.token_hash<>OLD.token_hash
  OR NEW.account_id<>OLD.account_id
  OR NEW.identity_subject_id<>OLD.identity_subject_id
  OR NEW.wechat_hash<>OLD.wechat_hash
  OR NEW.issued_by_staff_id<>OLD.issued_by_staff_id
  OR NEW.verification_note<>OLD.verification_note
  OR NEW.issued_at<>OLD.issued_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status<>'ACTIVE' OR NEW.status NOT IN ('CONSUMED','REVOKED')
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_invalid_transition');
END;

CREATE TRIGGER trg_customer_password_reset_tokens_no_delete
BEFORE DELETE ON customer_password_reset_tokens
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_tokens_are_immutable');
END;

CREATE TABLE customer_password_reset_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  reset_token_id TEXT NOT NULL REFERENCES customer_password_reset_tokens(id),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ISSUED','REVOKED','CONSUMED','REJECTED','SESSIONS_REVOKED')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  idempotency_key TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_customer_password_reset_events_account
ON customer_password_reset_events (account_id, created_at, id);

CREATE TRIGGER trg_customer_password_reset_events_no_update
BEFORE UPDATE ON customer_password_reset_events
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_events_are_immutable');
END;

CREATE TRIGGER trg_customer_password_reset_events_no_delete
BEFORE DELETE ON customer_password_reset_events
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_events_are_immutable');
END;

CREATE TABLE customer_security_rate_limits (
  operation TEXT NOT NULL CHECK (operation IN ('INVITATION','PASSWORD_RESET')),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('NETWORK_SOURCE','DEVICE','TOKEN','WECHAT_ID')
  ),
  scope_hash TEXT NOT NULL CHECK (
    length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL CHECK (window_expires_at > window_started_at),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  blocked_until INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (operation, scope_type, scope_hash, window_started_at),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
) STRICT;

CREATE INDEX idx_customer_security_rate_limits_expiry
ON customer_security_rate_limits (window_expires_at, operation, scope_type);

-- Exact upgrade assertions: every old account has one compatible persona,
-- every relation points to the same identity, and no second seller membership
-- can be represented for a subject.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM customer_account_personas)=
    (SELECT COUNT(*) FROM customer_login_accounts)
  AND NOT EXISTS (
    SELECT 1 FROM customer_account_personas persona
    JOIN customer_login_accounts account ON account.id=persona.account_id
    WHERE account.identity_subject_id<>persona.identity_subject_id
  )
  AND NOT EXISTS (
    SELECT identity_subject_id FROM seller_organization_members
    GROUP BY identity_subject_id HAVING COUNT(*)>1
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=30,
  installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=29;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
