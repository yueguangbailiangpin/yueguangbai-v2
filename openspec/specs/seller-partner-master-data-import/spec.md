# seller-partner-master-data-import Specification

## Purpose
TBD - created by archiving change seller-partner-master-data-import. Update Purpose after archive.
## Requirements
### Requirement: frozen channel routing
The system MUST route a source row by its explicit source folder ID and MUST normalize only the approved aliases: `ido`, `ido-mango`, `dio` to `ido-mango`; `ygb`, `ygbceping` to `ygbceping`; `yueguangbai`, `yueguangbaiai` to `yueguangbaiai`; `yinghua1942`, `yinghua1942ai` to `yinghua1942`; and `queshengai`, `quesheng520ai` to `queshengai`.

#### Scenario: folder default is authoritative
- **WHEN** a row comes from `dJwldHrckeFY` without an explicit conflicting alias
- **THEN** it is routed to `ido-mango`

#### Scenario: unknown alias is isolated
- **WHEN** a row contains an alias outside the approved map
- **THEN** the row is quarantined with a stable exception code and no master-data row is created

### Requirement: folder-bounded seller identity
The system MUST group rows by normalized seller WeChat within one folder and MUST NOT merge equal normalized WeChat values across different folders.

#### Scenario: repeated product files in one folder
- **WHEN** two valid rows in one folder have the same normalized WeChat
- **THEN** preview produces one seller group containing both source records

#### Scenario: same WeChat across folders
- **WHEN** equal normalized WeChat values occur in two frozen folders
- **THEN** preview produces two seller groups and commit creates two disabled organizations

### Requirement: standard product and seller supply
The system MUST represent one standard product per `(marketplace, normalized ASIN)` and MUST represent each seller's supply as a separate offering. It MUST NOT copy a seller-specific product truth into a second standard product because another seller supplies the same ASIN.

#### Scenario: duplicate ASIN across sellers
- **WHEN** two seller groups provide the same valid ASIN on the same site
- **THEN** commit creates one standard product and two seller offerings

### Requirement: safe historical import
Historical seller organizations and members MUST default to `DISABLED`; the import MUST NOT create a customer login account, send an invitation, or activate an external integration. A product may receive reservation eligibility only when the source explicitly marks the seller as currently cooperating and the product as currently reservable; eligibility MUST remain separate from a live open reservation.

#### Scenario: historical row
- **WHEN** a valid row is marked historical or not currently reservable
- **THEN** its organization/member/store/offering are disabled or not eligible and no reservation is opened

### Requirement: traceable two-phase import
Preview MUST be read-only and deterministic. Commit MUST be atomic, record source folder/record/locator and manifest hash, isolate invalid rows, and replay an already committed manifest without duplicating rows.

#### Scenario: repeat commit
- **WHEN** the same normalized manifest is committed twice
- **THEN** the second call returns replayed evidence and row counts remain unchanged
