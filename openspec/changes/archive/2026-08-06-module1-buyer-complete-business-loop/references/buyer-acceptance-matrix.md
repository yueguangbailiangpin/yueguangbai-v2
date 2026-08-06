# Buyer Acceptance Matrix

| Journey / gate | Unit/runtime | Component | MSW | Playwright |
|---|---|---|---|---|
| Root/login/direct registration | path/DTO/error schema | fields, unavailable, mismatch, no premature auth | feature-disabled/rate/201 then dual-root invalidation and Session reread | direct links, root has no entry, BUYER success/mismatch/unavailable |
| Password and Session | existing controllers | guards/cleanup retry | 401/mismatch/shared roots | login/change/logout |
| Dashboard | priority/dedupe/deadline/keys | partial success, bounded preview | multi-source/cursor/failure | mixed tasks, one source fails |
| Demand list/detail | DTO/cursor/money/date | empty/page/detail | real GET paths | browse/detail/deep link |
| Self-pay/reservation | acceptance/reset/body | unchecked/accessibility/conflict | 201/replay/version/capacity | accept/reserve/cancel |
| Instruction | state/action/deadline/exact adapter path | terminal/update/deadline | state/content/read intent and absent replay/file-ID assertions | active/expired/images/path rejection |
| Evidence upload | one-file policy/controller | progress/error/reselection | intent/upload/complete | one screenshot |
| Evidence workflow | DTO/actions/date/mismatch/money | initial/detail/change/withdraw/date-only | create/list/detail/resubmit/withdraw with `amazon_order_date` | query deep link/refresh/date/submit/mismatch/change/withdraw |
| Evidence file read | link/version/action schemas | viewer/metadata fallback/cleanup | dedicated intent/token/content/replay/404 | new preview and historical metadata-only |
| Formal orders | filters/cursor/decimal strings/date snapshot | list/detail/not-found/unknown history | exact GET/filter paths and date projection | filter/deep link/date snapshot |
| Review upload | three-file business limit | selection/progress | upload lifecycle | one-to-three files |
| Review workflow | DTO/actions/due/file refs/date summary | all states/reason/action absence | all seven baseline endpoints | query deep link/refresh/submit/change/withdraw/approved |
| Review file read | specialized path/version | viewer/cleanup/error | token/content/replay/conflict | image/PDF view and close |
| Refunds | balance/status/activity validation | list/detail/reversal/overpaid | list/detail/error | due/partial/paid/overpaid history |
| Me | DTO/date/status | review-required/no edits | me/logout | account links/logout |
| Accessibility | formatters/state labels | keyboard/focus/alerts | request ID safe projection | 390, 320, 200%, reduced motion |
| Security | forbidden-key scanners | no hidden action/data | 401/403/404/unsafe details | cross-resource and stale-data absence |

## Planning validation gates

- 10 capabilities, 58 requirements, 116 scenarios, 24 files.
- Target and repository-wide strict OpenSpec validation.
- Static review: only real paths/DTOs/statuses/actions; no backend assumption or forbidden storage authority.
- Baseline `npm ci`, `npm run check`, Wave14A Playwright regression, and current database counts; Migration 0028 is planned but not created in this round.
- Git diff and status restricted to this Change directory.

## Later implementation acceptance gates

- All new Buyer unit/component/MSW/Playwright tests pass in addition to baseline.
- Production Web build and typecheck pass.
- Browser journeys run against deterministic local/mock infrastructure; no production R2 or real Feishu.
- Security verifier covers registration dual-root invalidation, identity roots, 401/403/404, fixed adapter/path validation, action authority, date separation, financial formatting, file cleanup, object-key/URL absence, one screenshot, and three review files.
- Formal OpenSpec Verify occurs only after implementation, not in this planning round.
- Ponytail, Integration, main, PR, deployment, production and later modules require separate controller authorization.

## Historical compatibility acceptance

New order-evidence records with target link/version/action facts must pass the dedicated preview journey. A historical record that cannot be authoritatively backfilled must pass a metadata-only journey without a read action or guessed version. Historical NULL `amazon_order_date` displays as unknown and is never substituted; all new evidence versions and formal orders must reject a missing date.

## Final controller remediation evidence

| Controller finding | Implemented authority | Direct acceptance evidence |
|---|---|---|
| Query collisions and cursor replacement | Complete parameter keys, eight roots, cumulative page chains and filter reset | 8/20/100 key separation; three-page retention; later-page error/retry |
| Ad-hoc protected file reads | Trusted provider entry into `FileReadController` | 429/503 same-token retry; invalid provider rejection; provider-change/unmount URL revocation |
| Per-page random mutation keys | One eight-operation idempotency controller | eight endpoint header/body assertions; click coalescing; ambiguous same key/body; success/change/409 key rotation |
| Route-prefix current state | Semantic route ownership | parameterized nested route assertions, exactly one `aria-current=page` |
| Source-string dashboard identity | `taskId` plus `businessObjectKey` | reservation/formal-order cross-source dedupe and ranked winner |
| Generic dashboard failure | Per-source safe recovery | source name, safe copy, request ID and source-only retry count |
| Terminal instruction content leak | ACTIVE-only Content plus strict image schema | all five states, terminal zero Content, path/position/order/duplicate rejection without pageerror |
| Unsigned price mismatch | Signed formatter, direction copy and coherent runtime flag | positive, negative, zero and inconsistent DTO tests plus mobile screenshot |
| Manual-only governance | Archive-aware verifiers and root check integration | active/archive pass; coexist/duplicate/symlink/missing fail; security/migration gates run from root check |

Final counts: Module1 232/232; Web/Wave14A 405/405; repository 1001/1001; Module1 Playwright 88/88; complete Playwright 130/130; screenshots 20/20; Formal Verify COMPLETE=58 and Scenarios=116/116 with zero findings.
