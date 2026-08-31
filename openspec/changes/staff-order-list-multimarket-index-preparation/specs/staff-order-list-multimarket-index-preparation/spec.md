# Staff order-list multi-market index preparation Specification

## Purpose

为已确认的未来多市场上线准备 Staff 正式订单列表的 SQLite 访问路径；不改变
当前市场开放、可见性或业务合同。

## ADDED Requirements

### Requirement: Old-schema multi-market regression is recorded before implementation

The Change SHALL contain a reproducible local regression for the actual Staff formal-order
list SQL before the new index is present. The corpus SHALL use legal synthetic source
chains with target-market shares of exactly 1%, 20%, and 80% and SHALL NOT write market
registry or business enablement configuration.

#### Scenario: Old schema falls back under a market-scoped list

- **WHEN** the list query applies a Staff marketplace scope and keyset seek against the
  old-schema equivalent without `idx_formal_orders_market_confirmed_id`
- **THEN** the plan does not use that index and the test records the old market/date
  access path and any top-level `USE TEMP B-TREE FOR ORDER BY` observed by SQLite

### Requirement: The forward index matches the real list order and seek

Schema 37 SHALL add exactly the additive index
`idx_formal_orders_market_confirmed_id` on
`formal_orders (marketplace_code, confirmed_at DESC, id DESC)`. The migration SHALL be
forward-only from Schema 36, transaction-asserted, and SHALL not delete database objects
or change registry/configuration rows.

#### Scenario: Fresh and sequential local migration reaches Schema 37

- **WHEN** the migration verifier applies all migrations to a fresh local SQLite database
  and applies them one by one
- **THEN** Schema 37 exists, the named index has the three required columns and order,
  integrity/foreign-key checks pass, and missing/repeated/out-of-order predecessors fail
  without committing partial state

### Requirement: General market-scoped Staff list uses the prepared index

The real `GET /api/staff/formal-orders` list SQL SHALL preserve existing Staff scope,
keyset pagination, limit+1, and `confirmed_at DESC,id DESC` semantics. For the
market-scoped `seller_ops` query, the plan assertions SHALL require the new index and
absence of a parent/top-level sort temporary B-tree for each 1%, 20%, and 80% corpus.

#### Scenario: Seller operations reads one synthetic market

- **WHEN** an authorized `seller_ops` actor requests a market-scoped list with a seek
  cursor and limit 37
- **THEN** every returned order is in the assigned synthetic market, IDs are ordered by
  `confirmed_at DESC,id DESC`, the response retains the existing cursor/filter echo, and
  the plan searches through `idx_formal_orders_market_confirmed_id` without a top-level
  sort temporary B-tree

### Requirement: The no-market plan remains unchanged

The Change SHALL NOT force the new index onto the Owner/global list path. A list without a
marketplace predicate SHALL continue to use the existing `idx_formal_orders_confirmed_id`
order/seek index, with no API or DTO change.

#### Scenario: Owner reads the global list

- **WHEN** an authorized Owner requests the Staff list without a marketplace filter
- **THEN** the plan uses `idx_formal_orders_confirmed_id`, and the response contract and
  limit+1 behavior remain unchanged

### Requirement: Fixed-assignment and privacy boundaries remain separate

The Change SHALL preserve `buyer_refund` fixed buyer assignment plus seek OR semantics,
all Staff marketplace/data scopes, Seller Organization isolation, Personal DENY, concealed
404, dual lookup, and Buyer/Seller DTO isolation. Any TEMP-BTREE observed in the
`buyer_refund` fixed-assignment plan SHALL remain an explicitly unresolved follow-up, not
an implicit success claim.

#### Scenario: Buyer refund plan is observed without an OR rewrite

- **WHEN** a fixed-assigned `buyer_refund` actor is evaluated with two allowed synthetic
  markets and the existing seek OR
- **THEN** the test records whether SQLite uses the new index, does not require removal
  of every nested/top-level temporary B-tree, and the route's fixed assignment and
  authorization behavior is unchanged

### Requirement: No current market enablement is implied

Synthetic multi-market tests SHALL be local-only and SHALL not change marketplace registry,
market availability, business writes, public visibility, request parameters, or any Buyer
or Seller surface. Production status SHALL remain `NO-GO` until independently authorized
staging and production evidence exists.

#### Scenario: The preparation is reviewed as a pre-go-live Change

- **WHEN** the Change artifacts and local gates are reviewed
- **THEN** they identify 0037 as future multi-market performance preparation only, show
  no registry/configuration writes, and distinguish LOCAL evidence from STAGING,
  REMOTE CI, and PRODUCTION evidence
