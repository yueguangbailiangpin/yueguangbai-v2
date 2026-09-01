## Purpose

落实 Owner 2026-09-01 同日补充终裁：月光白与 ygbceping 同号归并，月光白AI 独立。

## MODIFIED Requirements

### Requirement: frozen channel routing

The system MUST route a source row by its explicit source folder ID and MUST normalize only the approved aliases: `ido`, `ido-mango`, `idomango`, `dio` to `ido-mango`; `ygb`, `ygc`, `ygcceping`, `yueguangbai` to `ygbceping`; `yueguangbaiai` to `yueguangbaiai`; `yinghua1942`, `yinghua1942ai` to `yinghua1942`; and `queshengai`, `quesheng520ai` to `queshengai`. `yueguangbai` MUST fold into `ygbceping`, and `yueguangbaiai` MUST remain a separate account that no alias ever folds into.

#### Scenario: folder default is authoritative

- **WHEN** a row comes from `dJwldHrckeFY` without an explicit conflicting alias
- **THEN** it is routed to `ido-mango`

#### Scenario: unknown alias is isolated

- **WHEN** a row contains an alias outside the approved map
- **THEN** the row is quarantined with a stable exception code and no master-data row is created

#### Scenario: moonwhite alias aligns under its own family folder

- **WHEN** a row in the `dDUYsBOrYoEk` folder (default `ygbceping`) carries the explicit alias `yueguangbai`
- **THEN** it normalizes to `ygbceping`, matches the folder default, and imports without conflict

#### Scenario: moonwhite alias contradicts the moonwhite-AI folder

- **WHEN** a row in the `dhtkJdpmZEgh` folder (default `yueguangbaiai`) carries the explicit alias `yueguangbai`
- **THEN** it normalizes to `ygbceping`, contradicts the folder default, and quarantines as `FOLDER_CHANNEL_CONFLICT`

#### Scenario: registry carries six channels

- **WHEN** migrations 0001-0041 are applied to an empty database
- **THEN** `seller_channels` contains exactly six ACTIVE rows and no `yueguangbai` channel exists
