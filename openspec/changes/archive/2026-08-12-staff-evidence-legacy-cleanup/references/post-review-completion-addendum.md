# Post-review completion addendum: staff-evidence-legacy-cleanup

## Purpose and historical boundary

The independent Phase 3 review found that the archived `tasks.md` retained two unchecked closure items even though the governed work had subsequently completed. This addendum closes that record gap and adds the review-requested Seller Settlement request-contract evidence.

`references/formal-verify-report.md` remains unchanged. It is the pre-archive Formal Verify snapshot: it correctly described the Change as eligible for the controller-ordered sync/archive and final repository gate, rather than claiming those later actions had already occurred.

## Verified completion chronology

- The implementation task recorded target and all strict OpenSpec validation as PASS, then completed the semantic Staff-spec sync and archived the Change at `openspec/changes/archive/2026-08-12-staff-evidence-legacy-cleanup`.
- The same task recorded the post-archive `npm run check` as PASS: 234 test files and 1,545 tests, with all workspace builds complete. Its final git checks recorded `git diff --check` and migration-zero as PASS; the task made no production, remote Git, deployment, commit, push, or PR operation.
- Current repository state independently confirms the main Staff spec contains the synced requirement, the Change exists only in the dated archive location, and the closure checklist is now 17/17. The current review baseline is `chore/staff-evidence-legacy-cleanup@4efd108e4702f3107fba9b588e1ca40e9f63c938`, with `origin/main` at the same SHA.

## Review-requested Seller Settlement evidence

The canonical MSW suite now captures the actual browser requests issued through `staffApi` and the existing API routes, and its successful mutation cases switch the GET read model only from inside the corresponding mutation handler:

- Record payment: `POST /api/staff/seller-settlements/seller-1/payments` asserts the exact contract body `amount_cny_fen`, runtime `paid_at`, and `proof_file.file_object_id` plus `expected_file_version`, a non-empty `Idempotency-Key`, and all three settlement reads refresh after success. The post-mutation reads expose a new unallocated payment and increase `unallocated_credit_cny_fen` from 3000 to 8000; the UI must display the new `¥50.00 CNY · ... · UNALLOCATED` payment fact. Organization authority is intentionally asserted by the route because the real request body has no `seller_organization_id` field.
- Whole-payment reversal: `POST /api/staff/seller-payments/payment-1/reverse` asserts the exact contract body `expected_version` and `reason`, a non-empty `Idempotency-Key`, and all three settlement reads refresh after success. The post-mutation reads return the same payment as contract-valid `REVERSED`, version 2, with unallocated credit changing from 3000 to 0; the UI must replace the visible `UNALLOCATED` payment with `¥30.00 CNY · ... · REVERSED`. The real contract has no confirmation field; no fictional field was added to the assertion.
- Existing allocation conflict evidence remains the failure-closed proof: a 409 retains a visible request ID and does not display optimistic success.

The request shapes come from the existing `staffApi` client and the stable Seller Settlement contract/routes; this review adds no runtime, API, contract, Decision, Migration, or financial-behavior change.

## Post-review validation

The review fix ran only the requested affected gates once: canonical Seller Settlement MSW/role tests PASS (2 files, 11 tests), Web typecheck PASS, `verify:staff-canonical` PASS, and `openspec validate --all --strict` PASS (64 passed, 0 failed). `git diff --check` and migration-zero follow this addendum update as the final read-only gates. A new Formal Verify is not required: the archived Formal Verify remains the original historical snapshot, and this addendum documents the post-review record/test-only correction without asserting a replacement formal verdict.
