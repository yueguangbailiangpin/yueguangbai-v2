# Verification Evidence: Buyer Portal Remaining Visual Refresh

## 1. Reproducible Baseline

- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/buyer-portal-remaining-visual-refresh`
- Branch: `feature/buyer-portal-remaining-visual-refresh`
- Starting `HEAD` and `origin/main`: `fcb78269dc4a3992e2602ec7f5917aa21f88ab16`
- Starting state: clean
- Node: `v24.18.1`; npm: `11.16.0`
- Lockfile SHA-256: `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`
- Dependency restore: `npm ci --cache /tmp/ygb-buyer-remaining-visual-npm-cache`; 225 packages, 0 vulnerabilities; no manifest or lockfile diff.
- Approved visual reference: `/Users/yueguangbai/.codex/generated_images/019fdc86-c749-7d53-9b82-e77dad8bd8a7/exec-8fa38e0a-7a12-4577-8cda-a690dc3290e0.png`
- Change freeze occurred before implementation; target strict validation passed before page edits.

`NO_SCHEMA_CHANGE`. No API, Contract, Domain, Migration, permission model, session, cache, protected-file authority, Seller, Staff, dependency manifest, or `tokens.css` change was made.

## 2. Screenshot Matrix and Review

Deterministic fixture settings are fixed UTC facts, `zh-CN`, `Asia/Shanghai`, light color scheme, reduced motion, stable DTO-valid responses, stable routes, and stable filenames.

- Before: `references/visuals/before` — 40 PNG files.
- After: `references/visuals/after` — 40 PNG files.
- Before aggregate SHA-256 manifest digest: `f15dbde12627cedda930cec1cfdc62d238864c97d4c6c31ef7e4b6ba056bbd0a`.
- After aggregate SHA-256 manifest digest: `4fc04a02118eec0426fa6082b80da4770b5b6572b8ede77d836c47b7f25e0b04`.
- All 16 surfaces were captured at 390x844: reservation list/detail, instruction, order-material list/form/detail, formal-order list/detail, review list/form/detail, refund list/detail, Me, change-password, and registration.
- Six representative detail/form/account surfaces were additionally captured at 320x800, 768x1024, 1440x900, and 1600x1000: reservation detail, instruction, order-material form, review detail, refund detail, and Me.
- Every before/after image was reviewed. Final review found no document-level horizontal overflow, clipped primary control, raw `JP`/`IMAGE`/`WECHAT_PAY` presentation, fake field/action, Seller/Staff visual grammar, glass/blur, or second token system.
- The final images show the approved large whitespace, compact four-step journey, clear current stage, card hierarchy, Chinese status/facts, one dominant action, and fixed five-item Buyer navigation.
- Controller review found that the first refund images incorrectly highlighted `完成` for PARTIALLY_PAID. The refund list plus all five refund-detail after images were regenerated after the fix. Mixed-status list and PARTIALLY_PAID detail now have no current journey step; PAID-only completion is covered by DOM evidence.
- Controller review also found the formal-order detail exposing the internal `e8` rate encoding. Its 390x844 after image was regenerated after replacing that output with `订单汇率` and `1 JPY = ¥0.055 CNY`; the immutable DTO value and rate business date remain the authority.
- Native Gregorian date inputs remain native accessible controls. Their empty browser chrome may render a locale-dependent placeholder in headless Chromium; the app label, help text, stored value, DTO, and assertions remain Chinese/date-only and no custom date parser was introduced.

## 3. Accessibility, Chinese, Time, Money, and Authority

- Dedicated browser assertions passed for 320/390/768/1440/1600, 200% root text, visible keyboard focus, focus clearance above the fixed navigation, reduced motion, 44px controls, and no horizontal overflow.
- Page output uses Chinese display mappings for Marketplace, review type, status, and payment channel while the DTO enums remain unchanged.
- Epoch times continue through the existing `Asia/Shanghai` formatter and visibly include `北京时间`; Amazon order dates remain date-only.
- JPY/CNY values continue through existing integer-safe helpers. Refund surfaces consistently use `返款金额` and explicitly state that it contains only product principal.
- The Buyer rate formatter uses only the Contract decimal string and BigInt scale/remainder operations. It removes trailing fractional zeroes, preserves exact 1.0 and 0.055 values, and never calls `Number`, `parseFloat`, or `toFixed`.
- Payment and reversal activity facts remain visible and read-only. No payment claim, action, schedule, rank, amount, permission, or status is inferred client-side.
- Existing Session enforcement, forced password change, identity mismatch cleanup, `Personal` DENY, account/cache isolation, owner-bound file read intents, verified uploads, resubmit/withdraw authority, idempotency, and confirmation dialogs remain exercised by the unchanged full suites.

## 4. Production Build Comparison

All figures are exact bytes using `gzip -9`; deltas are after minus before.

| Asset boundary | Before raw / gzip | After raw / gzip | Delta raw / gzip |
|---|---:|---:|---:|
| Entry | 245,572 / 74,271 | 245,642 / 74,310 | +70 / +39 |
| CSS | 54,644 / 10,182 | 59,641 / 10,781 | +4,997 / +599 |
| Buyer route | 18,498 / 4,810 | 19,199 / 4,913 | +701 / +103 |
| Buyer order route | 21,756 / 5,865 | 23,287 / 6,145 | +1,531 / +280 |
| Buyer after-sales route | 15,123 / 4,236 | 16,393 / 4,537 | +1,270 / +301 |

The custom Buyer file-picker is a separate 691 raw / 467 gzip byte chunk. No JavaScript chunk exceeds 500 kB. Browser network assertions passed: cold order-material routes did not load Buyer after-sales/Seller/Staff chunks, and cold refund routes did not load Buyer order/Seller/Staff chunks.

## 5. Commands and Final Results

- `npx openspec validate buyer-portal-remaining-visual-refresh --strict`: PASS.
- `npx openspec validate --all --strict`: PASS, 43/43 items.
- Focused Web typecheck/build: PASS.
- Focused status/Buyer layout Vitest: PASS, 2 files / 13 tests.
- Dedicated remaining-pages Playwright: PASS, 4/4 tests.
- Final screenshot regeneration: PASS, 1/1 matrix test, 40 after PNG files.
- `npm run check`: PASS.
  - Secret scan: 1,230 project files, PASS.
  - Dependency risk: 0 info/low/moderate/high/critical vulnerabilities.
  - Customer multi-persona security: 11/11 scenarios, PASS.
  - Web suite: 37 files / 447 tests, PASS.
  - Repository suite: 194 files / 1,273 tests, PASS.
  - Migration verification: schema 37, 165 tables, 311 triggers, integrity `ok`, 0 foreign-key errors.
  - API dry-run and every workspace build: PASS; no deployment occurred.
- First `npm run test:wave14a:browser`: 168 passed, 1 failed, 1 skipped. The failure was the existing contract assertion for heading `可提交评论`; the visual edit had changed it to `现在可提交`.
- First targeted rerun before rebuilding preview output: 1 failed because Playwright previewed the prior `dist`; this was retained as process evidence.
- After restoring the frozen heading and rebuilding, targeted browser rerun: 1/1 PASS.
- Final complete `npm run test:wave14a:browser`: 169 passed, 1 skipped. The skip is the pre-existing opt-in manual Buyer home screenshot checkpoint.
- Controller refund-completion remediation: Web typecheck/build PASS; four affected browser tests PASS (PARTIALLY_PAID/PAID journey projection, refund wording, payment/reversal ledger, and OVERPAID visibility); six affected after images regenerated by the filtered matrix test, then the renamed refund-list image regenerated once more after changing `完成阶段` to `返款阶段`.
- Controller rate-display remediation: Buyer formatter test file PASS, 6/6 tests including trailing-zero, 1.0, and 0.055 cases; Web typecheck/build PASS; two related browser tests PASS; only `formal-order-detail-390x844.png` was regenerated. Detail audit found no other internal storage encoding directly rendered: required identifiers, amounts, percentage, business dates, Beijing timestamps, and evidence snapshot facts remain visible as frozen.
- Per controller instruction, neither isolated remediation reran the 1,273-test repository suite or 169-test browser suite; only the six refund images and later the one formal-order-detail image affected by those fixes were regenerated.
- `git diff --check`: PASS.
- Git scope and manifest review: PASS; changed production files are Buyer presentation/shared display helpers plus the Buyer-specific branch of Customer change-password. No Seller/Staff/API/Contract/Domain/Migration/dependency manifest or lockfile diff.

## 6. Failure History and Residual Risk

Preserved development failures:

1. Initial build could not find `tsc` before the clean dependency restore; the same build passed after `npm ci`.
2. The first 40-image matrix exceeded the default 30-second test timeout; the matrix-only timeout was set to 120 seconds and passed in approximately 34 seconds.
3. The first reduced-motion assertion did not explicitly emulate the media feature; explicit `page.emulateMedia({ reducedMotion: 'reduce' })` fixed the fixture and the final suite passed.
4. The first visual review list fixture used a detail-only `files` field in a summary response and correctly failed the runtime contract; the fixture was corrected to the existing summary DTO.
5. The final full browser gate found the heading regression described above; it was fixed without changing the test or business behavior, then the final full gate passed.

Residual risk is limited to untested real-device browser chrome differences for native date controls and production data diversity. No production Cloudflare/D1/R2, database, Drive, Feishu, OpenAI/ChatGPT MCP, domain/DNS, real secret, deployment, migration, external activation, commit, push, PR, Integration, or archive action occurred.
