# Tasks: Staging Isolated Readiness Bootstrap

- [x] 1. Freeze D-041, `NO_SCHEMA_CHANGE`, resource-isolation and no-remote-write boundaries.
- [x] 2. Add explicit staging readiness statuses without changing the production eight-`ok` gate.
- [x] 3. Implement parameterized, atomic, idempotent and redacted first-owner bootstrap behavior and negative tests.
- [x] 4. Remove staging Cron, enable observability and align release preflight/tests.
- [x] 5. Document staging resource, migration, identity, fixed-SHA deployment, backup/restore and monitoring order.
- [x] 6. Run target tests, API typecheck, OpenSpec target/all strict, `git diff --check` and one full `npm run check`.
- [x] 7. Verify implementation consistency, self-review migrations/secrets/remote writes, then create a Draft PR without merging.
- [x] 8. Obtain fixed-SHA independent review before any remote staging resource write. Evidence: PR #83 final review plus the PR #85 fixed-head migration compatibility review and ordinary-merge tree proof.
- [x] 9. **T8 — staging basic activation:** under separate explicit operator authorization, create only isolated staging resources, apply migrations 0001–0070, bootstrap the first Owner and synthetic Buyer channel, inject staging-only managed Secrets, deploy the independently reviewed fixed SHA, and record only the baseline `/health`, `/ready`, binding, isolation and disabled-capability evidence. Evidence: `staging-t8-activation-evidence`. The A–H acceptance matrix and recovery evidence remain excluded.
- [ ] 10. **T9 — staging A–H acceptance:** execute and record the 68 currently enumerated real staging acceptance items across sections A–H as a separate evidence change after T8. Give every item a stable ID and keep T10 recovery and Production GO gates out of T9 execution evidence. Do not create resources or alter the T8 deployment contract here.
- [ ] 11. **T10 — isolated recovery:** perform the staging D1/R2 encrypted backup and restore to a new isolated target, then record Schema/ledger, integrity/FK, Manifest/hash, row-count, financial-aggregate and smoke-read comparison as a separate evidence change. Do not fold the A–H matrix into this recovery change.
- [ ] 12. **T11 — CI browser coverage:** add the independent Playwright CI job for the approved local 13-spec suite as a separate code PR; it must not access staging, production, Cloudflare resources or real data.
