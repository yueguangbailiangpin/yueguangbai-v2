# Buyer Acceptance Matrix

| Journey / gate | Unit/runtime | Component | MSW | Playwright |
|---|---|---|---|---|
| Root/login/direct registration | path/DTO/error schema | fields, unavailable, mismatch | feature-disabled/rate/201 Session | direct links, root has no entry, success/unavailable |
| Password and Session | existing controllers | guards/cleanup retry | 401/mismatch/shared roots | login/change/logout |
| Dashboard | priority/dedupe/deadline/keys | partial success, bounded preview | multi-source/cursor/failure | mixed tasks, one source fails |
| Demand list/detail | DTO/cursor/money/date | empty/page/detail | real GET paths | browse/detail/deep link |
| Self-pay/reservation | acceptance/reset/body | unchecked/accessibility/conflict | 201/replay/version/capacity | accept/reserve/cancel |
| Instruction | state/action/deadline/image order | terminal/update/deadline | state/content/read intent | active/expired/images |
| Evidence upload | one-file policy/controller | progress/error/reselection | intent/upload/complete | one screenshot |
| Evidence workflow | DTO/actions/mismatch/money | initial/detail/change/withdraw | create/list/detail/resubmit/withdraw | submit/mismatch/change/withdraw |
| Formal orders | filters/cursor/decimal strings | list/detail/not-found | exact GET/filter paths | filter/deep link |
| Review upload | three-file business limit | selection/progress | upload lifecycle | one-to-three files |
| Review workflow | DTO/actions/due/file refs | all states/reason/action absence | all seven endpoints | submit/change/withdraw/approved |
| Review file read | specialized path/version | viewer/cleanup/error | token/content/replay/conflict | image/PDF view and close |
| Refunds | balance/status/activity validation | list/detail/reversal/overpaid | list/detail/error | due/partial/paid/overpaid history |
| Me | DTO/date/status | review-required/no edits | me/logout | account links/logout |
| Accessibility | formatters/state labels | keyboard/focus/alerts | request ID safe projection | 390, 320, 200%, reduced motion |
| Security | forbidden-key scanners | no hidden action/data | 401/403/404/unsafe details | cross-resource and stale-data absence |

## Planning validation gates

- 10 capabilities, 58 requirements, 116 scenarios, 24 files.
- Target and repository-wide strict OpenSpec validation.
- Static review: only real paths/DTOs/statuses/actions; no backend assumption or forbidden storage authority.
- Baseline `npm ci`, `npm run check`, Wave14A Playwright regression, database counts, no new migration.
- Git diff and status restricted to this Change directory.

## Later implementation acceptance gates

- All new Buyer unit/component/MSW/Playwright tests pass in addition to baseline.
- Production Web build and typecheck pass.
- Browser journeys run against deterministic local/mock infrastructure; no production R2 or real Feishu.
- Security verifier covers identity roots, 401/403/404, path allowlist, action authority, financial formatting, file cleanup, object-key/URL absence, one screenshot, and three review files.
- Formal OpenSpec Verify occurs only after implementation, not in this planning round.
- Ponytail, Integration, main, PR, deployment, production and later modules require separate controller authorization.

## Known acceptance limitation requiring controller disposition

Historical order-evidence file preview lacks a DTO file version required by generic read intent. Planning accepts metadata-only display and treats preview as unavailable. If full historical screenshot viewing is mandatory, the controller must authorize a later Contract/backend change; the frontend must not guess or bypass it.
