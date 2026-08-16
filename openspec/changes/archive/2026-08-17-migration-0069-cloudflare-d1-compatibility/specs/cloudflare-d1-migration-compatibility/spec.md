## ADDED Requirements

### Requirement: D1 migrations use bounded compatible transaction checks

Migration SQL SHALL NOT execute whole-database integrity or quick checks inside a Cloudflare D1 migration transaction. Destructive migrations SHALL retain bounded schema-version, stock, FK, object and guarded-update assertions.

#### Scenario: A migration embeds whole-database validation

- **WHEN** repository migration verification scans the ordered SQL files
- **THEN** it fails before any remote application and identifies the incompatible migration file.

#### Scenario: Migration 0069 receives dirty legacy stock

- **WHEN** any individually enumerated legacy table, dependent formal-order table, Audit row, Outbox row or idempotency row is present
- **THEN** the migration aborts, Schema remains 68 and the database snapshot remains unchanged.

#### Scenario: Migration 0069 receives the authorized empty Schema 68 state

- **WHEN** all zero-stock assertions, pre-DDL FK checks and required-object assertions pass
- **THEN** the migration removes only the retired agreement-rate runtime, preserves required dependent objects, passes post-DDL FK checks and advances exactly once to Schema 69.

#### Scenario: A trigger uses CASE to invoke RAISE

- **WHEN** repository migration verification scans a trigger containing `CASE ... THEN RAISE`
- **THEN** it fails before remote application and requires the D1-compatible `SELECT RAISE(...) WHERE ...` equivalent.

#### Scenario: Migration 0070 validates a reminder source

- **WHEN** a reminder references an absent obligation or a different Buyer
- **THEN** the D1-compatible source trigger aborts with the unchanged `buyer_refund_reminder_source_invalid` code.

### Requirement: Full database health is verified outside the D1 transaction

The staging migration procedure SHALL export the D1 database before and after Migration `0069`, reconstruct each dump in native SQLite, and require full integrity success plus zero FK failures.

#### Scenario: Pre-migration export is unhealthy

- **WHEN** the reconstructed Schema 68 export fails integrity, FK, Schema or migration-ledger validation
- **THEN** Migration `0069` is not applied.

#### Scenario: Post-migration export is unhealthy

- **WHEN** the reconstructed Schema 70 export fails integrity, FK, Schema, ledger or legacy-object validation
- **THEN** the result is rejected and no staging acceptance claim is made.

### Requirement: Remote compatibility uses a disposable isolated canary

The compatibility proof SHALL run exact repository migrations `0001`–`0070` on one staging-only D1 canary whose name and ID differ from real staging and production, and SHALL delete that canary after evidence capture.

#### Scenario: Exact migration chain succeeds on D1

- **WHEN** the canary applies `0001`–`0068` and then reviewed `0069`–`0070`
- **THEN** remote Schema is 70, ledger count and maximum are 70, FK violations are zero, retired objects and columns are absent, and the result is recorded against the fixed Git SHA.

#### Scenario: Canary evidence is complete

- **WHEN** all pre/post remote and exported-native checks finish
- **THEN** the exact canary is deleted and a follow-up inventory proves its name and ID are absent.

#### Scenario: A protected target is selected

- **WHEN** a command resolves to the real staging or any production resource ID
- **THEN** the canary workflow stops before mutation.
