## Specification and implementation

- [x] Record the no-schema-change and privacy boundary.
- [x] Add buyer identity facts to assigned Staff reservation review context.
- [x] Close the successful reservation action locally without refetching completed review facts.
- [x] Surface safe API error code and request ID on mutation failure.
- [x] Require an ACTIVE matching order instruction in the buyer eligible-reservation read model.
- [x] Add and bind the internal staging keyword PNG generator with R2-hosted font and separate secrets.
- [x] Add API and frontend regression coverage.
- [x] Run focused tests and type checks.
- [x] Export and hash the old staging D1 before deletion.
- [x] Recreate staging D1, apply migrations 0001-0070 and restore the test Owner.

## Remote boundary

- [ ] GitHub push or PR (not authorized).
- [x] Deploy the fixed main staging Worker with the rebuilt D1, R2 and private keyword-image service binding.
- [ ] Verify application `/health` and `/ready` through an authenticated Cloudflare Access session; unauthenticated probes redirect to Access by policy.
