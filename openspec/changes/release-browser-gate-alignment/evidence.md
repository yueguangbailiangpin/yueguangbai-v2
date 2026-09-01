# Release Browser Gate Alignment Evidence

## Baseline (LOCAL)

Command:

```text
CI=1 PLAYWRIGHT_PORT=4703 npm run test:browser
```

Direct result: exit `1`; `257 tests`, `9 failed`, `1 skipped`, `247 passed`.
The skip is `buyer-visual-pilot.spec.ts` because
`BUYER_VISUAL_REVIEW_SCREENSHOT` was not set. The nine failures were:

1. `screenshots.spec.ts:211` — Buyer `买家导航` not visible.
2. `screenshots.spec.ts:218` — Seller `业务进度` heading not found.
3. `stage66e.spec.ts:308` — exact `买家客户` heading resolved to the shell and content headings.
4. `screenshots.spec.ts:225` — exact Seller `订单` link timed out.
5. `screenshots.spec.ts:233` — Staff `工作台` heading not found.
6. `stage7-three-portals-screenshots.spec.ts:906` — Seller `2 名成员` not visible.
7. `screenshots.spec.ts:240` — narrow Staff `工作台` heading not found.
8. `stage7-three-portals-screenshots.spec.ts:958` — Seller `田中 太郎` not visible.
9. `stage7-three-portals-screenshots.spec.ts:970` — narrow Seller `田中 太郎` not visible.

## Root-cause boundary

- Items 1, 4, 5, and 7 query a responsive or current page element before the
  test sets the intended viewport, and items 4–7 also contain stale current-UI
  names where applicable.
- Item 2 uses a retired Seller heading and an identity fixture missing the two
  nullable settlement fields required by the current strict schema.
- Item 3 is a selector-scope ambiguity caused by the intentional shell/content
  duplicate heading.
- Items 6, 8, and 9 share one strict Seller member-fixture drift: both members
  omit `wechat_id: null`.

## Focused verification (LOCAL)

Command:

```text
CI=1 PLAYWRIGHT_PORT=4704 npm run test:browser -- screenshots.spec.ts stage66e.spec.ts stage7-three-portals-screenshots.spec.ts
```

Direct result: exit `0`; all `37` focused tests passed.

## Full and visual verification (LOCAL)

```text
CI=1 PLAYWRIGHT_PORT=4705 npm run test:browser
```

Direct result: exit `0`; `257 tests`, `256 passed`, `1 skipped`. The only skip
remains the intentionally environment-gated Buyer visual pilot matrix because
the full-gate invocation does not set `BUYER_VISUAL_REVIEW_SCREENSHOT`.

```text
CI=1 PLAYWRIGHT_PORT=4706 BUYER_VISUAL_REVIEW_SCREENSHOT=/tmp/release-browser-gate-buyer-visual-review-20260831.png npm run test:browser -- buyer-visual-pilot.spec.ts --grep "Buyer home captures the 390 visual review checkpoint"
```

Direct result: exit `0`; the Buyer visual review checkpoint passed `1/1` and
wrote the explicit `/tmp` PNG.

```text
CI=1 PLAYWRIGHT_PORT=4707 STAGE7F_VISUAL_EVIDENCE_DIR=/tmp/release-browser-gate-stage7f-visual-20260831 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts
```

Direct result: exit `0`; all `4/4` visual evidence tests passed and exactly 21
PNG files were generated. The Buyer checkpoint and all 21 Stage 7F files were
opened and manually reviewed as LOCAL evidence:

- `/tmp/release-browser-gate-buyer-visual-review-20260831.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/review-buyer-recovery-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/review-entry-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/review-seller-recovery-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/review-staff-recovery-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-buyer-customers-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-buyer-refunds-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-finance-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-finance-owner-390x844.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-order-detail-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-order-detail-owner-390x844.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-orders-owner-1280x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-orders-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-orders-owner-390x844.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-orders-owner-filter-drawer-390x844.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-products-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-reservation-schedule-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-seller-customers-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-service-channels-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-workbench-owner-1440x900.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-workbench-owner-390x844.png`
- `/tmp/release-browser-gate-stage7f-visual-20260831/staff-workbench-owner-drawer-390x844.png`

Manual review result: PASS for all listed images; no screenshot was copied or
synthetically produced. These files are outside the repository and are not
production acceptance evidence.

## Release candidate verification (LOCAL)

The first direct invocation from the intentionally dirty implementation
worktree exited `1` with `release candidate worktree must be clean`, which is
the verifier's expected provenance guard. A clean local candidate containing
the implementation and Change artifacts then ran:

```text
RELEASE_BROWSER_PORT=4708 npm run release:check
```

Direct result: exit `0`; candidate `495012bc59f421b1e736fb9376c187b85f3f0416`,
local release evidence `COMPLETE`, external evidence `UNVERIFIED`, production
go `NO_GO`, and Moonwhite production readiness probe calls `0`. The candidate
browser gate reported `256 passed`, `1 skipped` for the unset Buyer screenshot
environment gate. One earlier candidate attempt had five existing 5-second
test timeouts; an immediate standalone candidate `npm test` rerun passed
`1897/1897`, followed by the release-check PASS above.

## Final HEAD release:check (LOCAL, 2026-08-31)

```text
RELEASE_BROWSER_PORT=4709 npm run release:check
```

Direct result: exit `0` on the clean worktree at the final commit
`0d0cd948653480e6434b744e3f9c544ae5646272` (tree
`210a88d4ab9619f339d9cd72f8610111b88cdb8c`). The final verifier verdict is
`PASS` with `local_release_evidence: COMPLETE`, `external_evidence:
UNVERIFIED`, `production_go: NO_GO`, and Moonwhite production readiness probe
calls `0`. Inside the gate, the full vitest suite passed `266/266` files and
`1897/1897` tests, and the candidate browser gate reported `256 passed`,
`1 skipped` (the same intentionally unset Buyer screenshot environment gate).
The two Cloudflare release preflight sub-gates exited `0` with local
`BLOCKED_NEEDS_OPERATOR_INPUT` status and zero external calls, matching the
documented LOCAL-only boundary. The full command output was retained
machine-locally at `/tmp/release_check_0d0cd948_20260831.log` and is not
repository evidence.

## Final evidence

The implementation worktree checks are complete: focused browser exit `0`, full
browser exit `0` with `256 passed` and the one intentional unset-environment
skip, Buyer non-skip exit `0`, Stage 7F visual exit `0` with 21/21 PNGs
manually reviewed, `npm run check` exit `0`, current/all OpenSpec strict exit
`0`, Web source/static and CSS guards exit `0`, and `git diff --check` exit `0`.
The final direct `npm run release:check` on the clean committed tree at
`0d0cd948` has since completed with exit `0` (see the section above). All
evidence remains LOCAL; production acceptance is not claimed.
