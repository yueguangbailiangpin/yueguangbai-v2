# Full Repository Final Review and Optimization

## ADDED Requirements

### Requirement: review baseline is exact and isolated

The review MUST start from local commit `384873ac3c5c6f83d73e6dd8e1788992081b78e7` in a dedicated branch/worktree, MUST preserve the four known untracked main-worktree paths, and MUST stop if the local main, historical-order integration branch, origin tracking ref or remote identity differs from the frozen baseline.

#### Scenario: frozen baseline matches

- **WHEN** the review preflight reads all local refs, remote identity, worktree inventory and main-worktree status
- **THEN** it records the exact expected values before creating the isolated worktree and performs no remote write.

#### Scenario: baseline drifts

- **WHEN** any frozen ref, identity or protected untracked-path condition differs
- **THEN** the review stops without fetching, resetting, overwriting the main worktree or guessing a replacement baseline.

### Requirement: security and authorization remain fail closed

The implementation MUST enforce trusted authentication, unique active Staff role, Personal DENY, Staff Data Scope, Seller Organization and Store ownership, resource projection and anti-enumeration at the server. Client-supplied Staff, role, scope, owner, organization, Store or audience fields MUST NOT become authority.

#### Scenario: cross-scope and Personal DENY are rejected

- **WHEN** a Staff or Seller actor requests a resource outside the current organization/Store/Buyer/Customer scope, or an otherwise granted permission is personally denied
- **THEN** the server rejects or conceals the request under the existing Contract and creates no unauthorized business, audit-success or idempotency-completion fact.

#### Scenario: revocation takes effect dynamically

- **WHEN** a Staff assignment, Seller membership, Store scope, organization, account or permission becomes inactive after prior access
- **THEN** the next protected operation recalculates authority and cannot use stale client or cache scope to retain access.

#### Scenario: unknown customer login has equivalent password cost

- **WHEN** a login identifier has no account row
- **THEN** password verification still uses the single current PBKDF2 work factor and returns the same invalid-credentials surface without exposing account existence through a deliberately cheaper dummy path.

### Requirement: protected files require explicit current audience

Every customer-visible file read MUST follow the governed intent/object/link/explicit-audience/read-intent chain. Read-intent creation and byte consumption MUST both verify current actor, resource scope, link, grant, file version and revocation state, and MUST NOT return storage identifiers or permanent URLs.

#### Scenario: short intent is revoked, expired or replayed

- **WHEN** an intent is consumed twice, expires, belongs to another actor, or its member/Store/link/grant/file authority is revoked
- **THEN** no bytes are returned, no replacement reusable credential is exposed, and another organization cannot infer file existence.

#### Scenario: Seller file authority is current and entity scoped

- **WHEN** a Seller member lacks the business entity's active Store scope, has a role that cannot manage image/message files, or loses that scope after intent creation
- **THEN** both intent creation and byte consumption are concealed, and Seller upload lifecycle operations are available only to OWNER/OPERATIONS under the current actor projection.

### Requirement: migrations 0001 through 0043 are immutable and transactionally governed

The repository MUST keep migrations 0001–0042 byte-identical to baseline commit `384873ac3c5c6f83d73e6dd8e1788992081b78e7` under an automated SHA-256 gate and MUST use append-only versions from 0043 onward. It MUST prove fresh and sequential application of 0001–0043. Its local verifier MUST contain every repeat and skip-predecessor attempt in an explicit transaction, refuse commit on SQL failure or predecessor mismatch, leave the complete schema/data inventory unchanged after rollback, and finish with clean integrity and foreign-key checks. Verification MUST distinguish intrinsic historical-SQL rejection from verifier-enforced rollback and MUST NOT present the local harness as production Wrangler/D1 evidence.

#### Scenario: a historical migration byte changes

- **WHEN** any filename or byte in migration 0001 through 0042 differs from the frozen SHA-256 baseline
- **THEN** the migration guard fails before accepting fresh/sequential results, even if the changed SQL would produce the same final object counts.

#### Scenario: fresh and sequential databases converge

- **WHEN** isolated local databases apply the chain fresh and by governed sequential upgrade
- **THEN** both reach schema 43 with the expected tables, triggers, indexes, registry rows and immutable/authorization guards, with `integrity_check=ok` and zero foreign-key errors.

#### Scenario: repeat or wrong order cannot commit partial schema

- **WHEN** the local verifier repeats any migration or attempts any migration from 0002 through 0043 while its direct predecessor is absent
- **THEN** native SQL failure or the verifier's pre-commit predecessor check aborts the explicit outer transaction, the complete pre-attempt schema/data inventory remains unchanged, and the report separately identifies historical SQL that did not self-reject.

#### Scenario: forward integrity repair encounters incompatible data

- **WHEN** 0043 encounters an existing duplicate/misattributed policy event, non-future confirmed policy, late principal snapshot or amount divergence
- **THEN** it fails before adding constraints or advancing the ledger, performs no deletion/backfill/recalculation, and leaves schema 42 fully unchanged for explicit operator review.

### Requirement: historical dry-run conserves every source and image fact

The historical-order dry-run MUST verify the frozen workbook SHA, emit exactly 16,304 records, conserve candidate plus quarantine counts, preserve marketplace-aware duplicate order lines and exact-duplicate isolation, conserve H/K image anchors, and report zero external/database/R2/image-byte/Migration/deployment writes.

#### Scenario: complete source dry-run is reproducible

- **WHEN** the full frozen workbook dry-run runs
- **THEN** it reproduces the governed manifest SHA and all order, product, refund, duplicate and image conservation totals without extracting image bytes or changing the workbook.

#### Scenario: local dry-run artifacts contain raw source fields

- **WHEN** the generator creates its manifest and summary output
- **THEN** a newly created POSIX output directory is owner-only and every newly created or overwritten manifest/summary file is mode `0600`, while manifest bytes and the governed SHA remain unchanged.

#### Scenario: source or mapping authority is insufficient

- **WHEN** source SHA/headers drift, a seller mapping is unresolved/multi-seller, or a marketplace/financial import authority is absent
- **THEN** the row or run fails closed and is not promoted to production-import eligibility.

### Requirement: cross-platform facts remain platform neutral and compatible

Amazon, Coupang, Rakuten and TikTok contracts MUST preserve marketplace-scoped identities. Rakuten/TikTok MUST NOT populate Amazon-only order/ASIN fields, unavailable providers MUST remain unavailable, and formal order/evidence/chat-file facts MUST retain exact Seller Organization and Store scope.

#### Scenario: equal identifiers on different platforms do not collide

- **WHEN** the same bounded identifier exists under two marketplace codes
- **THEN** the platform-neutral identity boundary keeps them distinct while rejecting a duplicate inside one marketplace.

#### Scenario: unavailable non-Amazon projection is honest

- **WHEN** a Rakuten/TikTok formal-order DTO lacks an authorized finance or Amazon legacy fact
- **THEN** Contract, runtime schema and Chinese UI preserve canonical platform identifiers and render the missing projection as null/unavailable without inventing an Amazon or financial value.

### Requirement: seller principal is exact, immutable and historical-safe

New enforced Amazon confirmations MUST use the exact platform order-date base rate plus the selected absolute markup, prefer a Seller Organization override including explicit zero, calculate with integer BigInt HALF_UP, and persist an immutable snapshot. Existing orders and financial facts MUST NOT be recalculated.

#### Scenario: exact-date explicit-zero override is selected

- **WHEN** an organization has an effective zero override and the exact order date has a confirmed base rate
- **THEN** the snapshot records that organization policy, uses zero markup and computes the principal with the governed integer HALF_UP formula.

#### Scenario: missing authority fails without financial facts

- **WHEN** the exact-date base rate or effective policy is missing while enforcement is enabled
- **THEN** confirmation returns the stable fail-closed error and writes no formal order, payable or seller-principal snapshot.

#### Scenario: history is immutable

- **WHEN** a later rate or policy version changes or direct SQL attempts to rewrite a prior snapshot
- **THEN** the historical snapshot/payable remains unchanged and the database rejects mutation.

#### Scenario: policy audit and principal snapshots remain cross-table consistent

- **WHEN** direct SQL attempts a duplicate policy event, an event with mismatched actor/time/reason, a confirmation whose effective time is not future, a principal snapshot outside order confirmation time, or an amount different from the existing formal-order financial snapshot
- **THEN** schema 43 rejects the write without changing the policy, snapshot, payable or audit trail.

### Requirement: contracts, runtime schemas, API and UI agree

Shared Contracts, registered routes, API projections, runtime validation and UI rendering MUST agree on discriminators, nullability, stable errors, Chinese labels and `Asia/Shanghai` display. The browser MUST NOT compute authoritative permission or finance facts.

#### Scenario: null and unavailable states survive every layer

- **WHEN** an older or non-Amazon row has unavailable fields
- **THEN** the API returns the governed null/discriminator, runtime validation accepts only that shape, and the UI shows an explicit Chinese unavailable state without a fabricated fallback.

### Requirement: pagination, caching and lazy loading conserve authority

Growing lists MUST use stable opaque keyset cursors. Mixed legacy/platform formal orders MUST traverse in global `(confirmed_at DESC, formal_order_id DESC)` order with no omissions or duplicates. Protected images MUST remain lazy, and Customer/Staff cache roots MUST remain identity-separated and revoke safely.

#### Scenario: mixed pagination exhausts exactly once

- **WHEN** a caller follows every returned cursor across interleaved equal-timestamp legacy and platform rows
- **THEN** every authorized order appears exactly once in global order and no unauthorized row enters a page.

#### Scenario: list does not prefetch protected bytes

- **WHEN** a Seller opens an order list without expanding a screenshot
- **THEN** no read intent or image byte request occurs; only the selected authorized item loads after explicit expansion.

### Requirement: repairs and simplifications are evidence bounded

The review MUST directly implement only deterministic, semantics-preserving, fail-closed fixes. Dead or duplicate code MAY be removed only after reference analysis and regression proof. Security, Migration, immutable finance, Audit, Outbox, idempotency, authorization, data-loss and accessibility controls MUST NOT be weakened.

#### Scenario: a safe local defect is proven

- **WHEN** code/SQL and a failing or missing focused test demonstrate one behavior under existing authority documents
- **THEN** the smallest local fix, regression test, OpenSpec task update and rollback note are added and the relevant gates are rerun.

#### Scenario: a rule or external fact is required

- **WHEN** a proposed fix needs a new business decision, production data, Secret, provider, deployment, remote Migration or external write
- **THEN** that item is not implemented and is reported as requiring separate owner authorization.

### Requirement: final gates and reports are truthful

The review MUST run focused tests, the historical-order migration tests and full dry-run, database and migration verifiers, strict OpenSpec, complete repository check and diff validation. It MUST distinguish PASS, FAIL and SKIP, report actual test counts and external-write counters, and stop uncommitted at total-control review.

#### Scenario: static verifier text drifts from runtime truth

- **WHEN** a count, inventory or expected tail is changed without the corresponding runtime/schema behavior
- **THEN** at least one semantic verifier or dynamic test fails rather than accepting the text-only update.

#### Scenario: all local evidence is collected

- **WHEN** every required command has completed
- **THEN** the final report includes actual diff, test numbers, migration/recovery, data conservation, permission negatives, performance evidence and `REMOTE_WRITES=0`, without claiming production completion.

### Requirement: complexity review remains read only and post-gate

Ponytail whole-repository complexity review MUST run only after tests and OpenSpec consistency pass, MUST remain read only, and MUST NOT automatically modify or delete code.

#### Scenario: a complexity suggestion is considered

- **WHEN** Ponytail identifies dead code, duplication, a one-use abstraction or a native replacement
- **THEN** the finding records path, behavior risk, estimated reduction and required regression tests; adoption still requires independent reference evidence and another full verification cycle.
