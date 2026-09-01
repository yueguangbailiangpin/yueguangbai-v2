## Purpose

按 Owner 2026-09-01 别名终裁修订冻结客服路由的别名集合，并要求运行时通道注册表与之一致。

## MODIFIED Requirements

### Requirement: frozen channel routing

The system MUST route a source row by its explicit source folder ID and MUST normalize only the approved aliases: `ido`, `ido-mango`, `idomango`, `dio` to `ido-mango`; `ygb`, `ygc`, `ygcceping`, `ygbceping` to `ygbceping`; `yueguangbai` to `yueguangbai`; `yueguangbaiai` to `yueguangbaiai`; `yinghua1942`, `yinghua1942ai` to `yinghua1942`; and `queshengai`, `quesheng520ai` to `queshengai`. `yueguangbai` and `yueguangbaiai` MUST remain two distinct accounts and MUST never normalize to one another.

#### Scenario: folder default is authoritative

- **WHEN** a row comes from `dJwldHrckeFY` without an explicit conflicting alias
- **THEN** it is routed to `ido-mango`

#### Scenario: unknown alias is isolated

- **WHEN** a row contains an alias outside the approved map
- **THEN** the row is quarantined with a stable exception code and no master-data row is created

#### Scenario: the two moonwhite accounts each have their own runtime channel

- **WHEN** migrations 0001-0040 are applied to an empty database
- **THEN** `seller_channels` contains seven ACTIVE rows including both `yueguangbai` and `yueguangbaiai`, and a yueguangbai-canonical commit resolves its channel without CHANNEL_NOT_FOUND
