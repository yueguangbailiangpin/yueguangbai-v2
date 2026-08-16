# Formal Verification Report: Staging T8 Activation Evidence

## Scope and verdict

This verification covers only the redacted T8 activation evidence and the linked closure of tasks 8-9 in `staging-isolated-readiness-bootstrap`. It does not verify T9 A-H business acceptance, T10 recovery, T11 browser CI or Production GO.

`IMPLEMENTATION_AND_EVIDENCE=PASS`

`DRAFT_PR_PUBLISHED=YES (#86)`

`READY_FOR_READY_OR_MERGE=NO`

`READY_FOR_ARCHIVE=NO`

The remaining gate is independent fixed-SHA review.

## Release identity

- Reviewed PR head: `b21a826c6832104db1db6265e692c9362ddf0b0c`.
- Ordinary merge/main and staging release: `10624b1066143b7ac57923597a1d877209959a4a`.
- Merge second parent equals the reviewed head.
- Merge tree equals the reviewed-head tree: `d338da4fb1efc1918b04b379a669d36ef75d6a78`.
- Local base and `origin/main` were both the merge SHA at verification time.

## Completeness

- Change planning artifacts are complete.
- T8 execution tasks 1-11 are complete.
- Formal checks passed on the candidate evidence tree.
- Draft PR #86 was published from evidence commit `a843f5cb98ede7780c7b0d5a765b323cf3d95442`.
- Independent fixed-SHA review remains the only incomplete governance gate.

## Correctness evidence

- Managed acceptance summary records Schema 68 to 70, migration ledger 70, migrations 0069/0070 applied, pre/post integrity `ok` and zero foreign-key errors.
- First-Owner aggregate records one Staff user, one active Owner role and one synthetic staging Buyer channel without committing identity values.
- Authenticated `/health` returned 200 with application status `ok`.
- Authenticated `/ready` returned 200 with application status `ready`; schema, object storage, staff access and release were `ok`, while scheduler, outbox delivery, acquisition maintenance, operational alerts and recovery were `not_required`.
- The empty-database object-storage check executes the real R2 binding head probe; no synthetic object was created to manufacture readiness evidence.
- Access evidence records an Allow policy whose five-identity set matches the managed identity file without recording emails or provider IDs.

## Commands and results

- `npm run test:staging-governance`: 5 files, 45 tests passed.
- `npm run db:verify`: PASS, Schema 70, integrity `ok`, foreign-key errors 0.
- `npm run verify:migration-guards`: PASS, 70 sequential steps, 69 wrong-order commits rejected, 70 repeats rejected, 139 failed snapshots unchanged.
- `npm run verify:seller-agreement-rate-retirement`: PASS, 559 runtime files scanned, zero legacy markers and zero compatibility flags.
- `npm run preflight:cloudflare-release -- --environment staging --config <managed-config>`: `LOCAL_CONFIG_VALID`, zero external calls/deployments/resource mutations.
- `npx openspec validate staging-t8-activation-evidence --strict`: PASS.
- `npx openspec validate staging-isolated-readiness-bootstrap --type change --strict`: PASS.
- `npx openspec validate --all --strict`: 74 passed, 0 failed.
- `npm run security:scan`: PASS across 1690 project files.
- Targeted redaction scan: no email, UUID or 32-hex provider/account identifier in changed evidence files.
- `git diff --check`: PASS.
- Git-external JSON evidence: parseable and mode `0600`.

## Coherence and safety

- The proposal, design, delta spec, tasks and evidence index consistently describe a T8-only infrastructure baseline.
- The Change adds no migration or runtime code and does not alter migrations 0001-0070.
- No production-targeted operation was performed. An Access application list incidentally displayed an existing non-staging row; no production details were opened and no production mutation was performed.
- Production remains `NO_GO`.

## Findings

- P0: 0.
- P1: 0.
- P2: 0 in the committed T8 evidence scope.
- Governance pending: independent fixed-SHA review blocks Ready, merge and archive.
