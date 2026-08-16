## 1. Runtime contract

- [x] 1.1 Record that the merged redirect repair still fails closed at `JWKS_FETCH` on real staging.
- [x] 1.2 Confirm the current Cloudflare Worker-to-Worker global fetch contract and Access JWKS endpoint contract.
- [x] 1.3 Audit API global outbound fetch usage and select the minimum compatibility flag.
- [x] 1.4 Require the exact flag in staging and production templates, release preflight and the static release-configuration verifier.
- [x] 1.5 Add fail-closed tests for missing, private-origin and expanded flag sets.

## 2. Verification and delivery

- [x] 2.1 Run focused preflight tests, strict OpenSpec validation, type/build checks and `git diff --check`.
- [x] 2.2 Run the full repository check and secret scan.
- [ ] 2.3 Publish a Draft PR and obtain an independent fixed-SHA P0/P1 review.
- [ ] 2.4 Convert Ready, ordinarily merge and prove merge tree identity.
- [ ] 2.5 Validate the Git-external staging config, deploy only the merged SHA to the existing staging Worker and prove Owner bootstrap/session.
- [ ] 2.6 Resume the canonical 67-item T9 register; production remains `NO_GO`.
