## Context

See `proposal.md` for the motivation. The current UI contracts are defined by
the Stage 7F portal implementation and the existing visual evidence harness.
The baseline browser run uses the checked-out Vite preview and Playwright
against the local build. The nine failures are all in browser harness
expectations or test response fixtures; no product runtime exception is needed
to explain them.

## Goals / Non-Goals

**Goals:**

- Make the affected tests select the responsive layout before the page is
  created and queried.
- Use current semantic labels and headings without reviving retired links,
  dashboards, or navigation items.
- Make strict test fixtures satisfy the schemas currently consumed by the
  Seller pages.
- Keep the duplicate Staff heading assertion deterministic through a semantic
  content-region scope.
- Record a real, locally generated visual evidence set and manually inspect
  every generated PNG.

**Non-Goals:**

- No Buyer, Seller, or Staff product redesign or source-page behavior change.
- No relaxation, skip, `.first()`, hidden-DOM, or timeout-based workaround for
  a failed assertion.
- No API, permission, financial, migration, dependency, deployment, remote,
  Cloudflare, or production action.
- No change to `BUYER_VISUAL_REVIEW_SCREENSHOT` skip semantics; it will be run
  once with an explicit `/tmp` path for non-skip evidence.

## Decisions

1. **Configure viewport before `goto`.** The portal shells choose their
   responsive navigation during initial render. The affected screenshot tests
   will set their intended viewport before navigation and retain the existing
   capture helper's final viewport assignment. Moving or duplicating this
   setup is safer than selecting a hidden mobile navigation after a desktop
   render.

2. **Align tests to current labels and headings.** Seller uses `订单与沟通`
   in the desktop navigation and the resolved organization name as the home
   heading. Staff home uses the time-sensitive greeting containing the current
   staff display name rather than a duplicate `工作台` page heading. The
   assertions will use the current semantic role and stable name fragment;
   retired labels will not be reintroduced into the application.

3. **Repair only the stale response fields.** The generic Seller identity
   fixture will include its two nullable settlement-account fields. The Stage
   7 members fixture will include `wechat_id: null` for each member. These
   fields satisfy the current strict schemas without changing the data shown
   by the visual scenarios or exposing additional sensitive data.

4. **Scope the duplicate heading by landmark.** The Staff shell intentionally
   renders a shell page title and the customer workspace renders its own
   content title. The Stage 6.6 check will locate the exact heading inside
   `#staff-main-content`, preserving strict uniqueness while expressing the
   intended content boundary. A positional selector would hide future
   duplicate-heading regressions.

5. **Use the existing real-browser evidence path.** Focused and full
   Playwright runs will remain direct-exit checks. The dedicated visual
   harness and Buyer pilot will write to explicit local paths, after which all
   resulting images will be opened for human review. No screenshot is copied,
   synthesized, or accepted solely from a test exit code.

## Risks / Trade-offs

- [Risk] A future page contract may change a current label or strict field
  again. → Keep the fixture and selector changes adjacent to the failing
  harnesses and require the full browser gate plus OpenSpec strict validation.
- [Risk] The generic Buyer shell still intentionally exercises a minimal
  session-only fixture and may show a current data-unavailable state. → The
  test asserts only the shell navigation, while the dedicated Buyer visual
  pilot owns complete Buyer data fixtures and explicit screenshot evidence.
- [Risk] Local PNG evidence is point-in-time and not production acceptance. →
  Record it as LOCAL evidence and retain `PRODUCTION_STATUS=NO-GO`.

## Migration Plan

No migration or deployment is applicable. Apply the harness-only edits, run the
focused reproduction, then the full browser/static/build/release gates. If a
check fails, keep the worktree changes for diagnosis and do not push, deploy,
archive this Change, or alter remote state.

## Open Questions

None.
