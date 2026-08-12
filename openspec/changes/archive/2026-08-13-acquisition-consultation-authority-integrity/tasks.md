# Tasks: Acquisition consultation authority and integrity

## Migration

- [x] M1. Confirm no Schema or Migration change is required; preserve all migration bytes.
- [x] M2. Keep production and remote D1/R2/Cloudflare operations out of scope.

## Governance and contracts

- [x] G1. Read repository authority, OpenSpec governance, current runtime/tests and the local Workers rules.
- [x] G2. Add D-040 after the actual maximum Decision number without rewriting historical Decisions.
- [x] G3. Align the live contracts and create this active Change with five-role, owner-write and audit-only legacy authorization rules.
- [x] G4. Validate this Change strictly before runtime implementation.

## Runtime

- [x] R1. Restrict consultation record/correct to owner plus `ACQUISITION_ADMIN`; preserve scoped operator reads.
- [x] R2. Conceal absent and cross-Marketplace consultation history as `NOT_FOUND`.
- [x] R3. Restore general Audit, final state/version/count assertion and idempotency failure cleanup in the consultation batch.
- [x] R4. Keep Acquisition Prospect/source operator routes and formal Lead duties unchanged.

## Tests and UI

- [x] T1. Add API/D1 record/replay/hash/version, role-denial, no-dirty-fact, Audit/assertion/cleanup and history-scope evidence.
- [x] T2. Add HTTP origin, exact-body, Idempotency-Key and owner-only consultation route evidence.
- [x] T3. Make the canonical daily consultation surface owner-write/acquisition-read-only and update UI/MSW/browser evidence.
- [x] T4. Remove formal Lead permissions from both acquisition E2E fixtures while preserving scoped operator workflow evidence.

## Validation

- [x] V1. Run targeted tests after each implementation phase.
- [x] V2. Run Acquisition, Staff-role, relevant typecheck and browser gates with writable Wrangler temp paths.
- [x] V3. Run target/all strict OpenSpec validation and implementation Verify without fabricating Formal evidence.
- [x] V4. Run `git diff --check` and one final `npm run check`; report all failures without remote or production action.

## Independent security review remediation

- [x] S1. Add the immediate `changes()=1` transaction assertion after consultation mutation while retaining the final state assertion.
- [x] S2. Add deterministic different-key/same-version/same-target competition evidence with no loser event, Audit or COMMITTED claim.
- [x] S3. Preserve unknown batch errors for the existing 503 route boundary after idempotency failure cleanup; reserve 409 for explicit OCC errors.
- [x] S4. Correct live governance authority formulas; keep historical GRANT, Team and Leader inputs audit-only.
- [x] S5. Separate owner read eligibility from `owner + ACQUISITION_ADMIN` UI administration and cover owner Personal DENY.
- [x] S6. Exercise consultation through the real Staff session middleware and D1 recomputation for missing/revoked cookies, DENY, legacy inputs and authorization-version drift.
- [x] S7. Re-run strict Change/all validation, implementation Verify and the ordered repository gates without sync or archive.
