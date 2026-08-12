# Staff acquisition consultation authority and integrity

## MODIFIED Requirements

### Requirement: Owner controls acquisition channels

Only an authorized system owner with `ACQUISITION_ADMIN` SHALL create, disable or version acquisition channels, configure Staff channel effective periods, and record or correct daily consultation counts. The `acquisition` role SHALL NOT gain these commands from D-034, a historical Personal GRANT, a Team/Leader pack or a client-supplied permission projection.

#### Scenario: Non-owner attempts channel administration

- **WHEN** acquisition, pre_sales, seller_ops, buyer_refund, Buyer or Seller calls a consultation write or channel administration command
- **THEN** the command is denied before idempotency acquisition and without changing consultation, event, Audit or idempotency facts.

### Requirement: Daily consultation is a channel aggregate

The system SHALL store one versioned consultation-person count per channel and `Asia/Shanghai` business date and SHALL preserve every owner correction in immutable domain-event and general Audit history. Immediately after the conditional consultation mutation, the write batch SHALL assert `changes()=1` through `transaction_assertions` before writing event, Audit or idempotency-completion facts, and SHALL retain the final state/version/count assertion as defense in depth. It SHALL mark an acquired idempotency claim failed if any batch statement fails.

The consultation's Buyer or Seller funnel SHALL come from the channel's current single operational audience. Historical `BOTH` channels SHALL NOT accept new consultation writes.

#### Scenario: Owner corrects a daily count

- **WHEN** owner submits a bounded count with the current expected version and an Idempotency-Key
- **THEN** the system commits one current version, one immutable event, one Audit event and a completed idempotency fact, replays an identical request, and rejects a different hash or stale version without extra facts.

#### Scenario: The consultation batch fails

- **WHEN** a conditional mutation or final assertion fails after idempotency acquisition
- **THEN** the batch leaves no consultation, event, Audit or successful idempotency fact and the claim is cleaned to a retry-safe failed state.

#### Scenario: Two corrections share one expected version

- **WHEN** two requests use different Idempotency-Keys but the same consultation, expected version and target count, and one wins during the other's commit window
- **THEN** the winner alone commits its version, event, Audit and idempotency fact, while the stale mutation's immediate assertion fails and no ghost success survives.

#### Scenario: An unknown batch dependency fails

- **WHEN** the consultation batch throws an error that is not an explicit Acquisition OCC error
- **THEN** the claim is cleaned to failed, the unknown error is preserved for the existing route boundary to map to `DEPENDENCY_UNAVAILABLE`, and it is not mislabeled `VERSION_CONFLICT`.

#### Scenario: One person consults more than one channel

- **WHEN** one person consults the same channel repeatedly on one Beijing date and also consults another channel
- **THEN** the person counts once in each consulted channel and is not counted twice within either channel for that date.

### Requirement: Lead registration follows five-role duties

pre_sales SHALL create Buyer leads, seller_ops SHALL create Seller leads, buyer_refund SHALL create neither, owner SHALL administer both within current permissions and scope, and acquisition SHALL operate Marketplace-scoped Prospect/source/read workflows without creating, reading or managing formal Buyer/Seller Leads.

#### Scenario: Staff creates or reads a formal Lead

- **WHEN** the trusted role and requested formal Lead duty do not match, including an acquisition actor with no formal Lead duty
- **THEN** the backend rejects the command or read even if the UI or a historical permission row suggests otherwise.

## ADDED Requirements

### Requirement: Acquisition consultation history is Marketplace concealed

Owner SHALL read consultation history globally. Acquisition SHALL read consultation rows and history only for channels in its current Marketplace scope. An absent or cross-scope consultation id SHALL produce the same concealed `NOT_FOUND` response.

#### Scenario: Acquisition reads same-scope history

- **WHEN** acquisition requests a consultation whose channel Marketplace is in its current scope
- **THEN** the immutable event history is returned in stable order.

#### Scenario: Acquisition probes cross-scope history

- **WHEN** acquisition requests a consultation whose channel Marketplace is outside its current scope
- **THEN** the API returns concealed `NOT_FOUND` and reveals no event or consultation metadata.
