# Post-review Fix Addendum

This addendum records the implementation response to the independent fixed-SHA review of `944050267a38c5c031b4fb0c4d35b3412542e57f`. It does not rewrite the earlier verification report and does not claim the revised SHA has passed independent review.

## Review disposition

The review returned `BLOCKED` with one P0 and two P1 findings:

1. Staging release preflight accepted a complete production Worker/domain/D1/R2 target.
2. The D1 REST adapter accepted number/null parameters beyond the published `string[]` contract.
3. The documented synthetic Buyer lifecycle lacked staging registration configuration and a governed Buyer channel.

## Implemented corrections

- Staging preflight now requires the canonical staging Worker and D1 name families, the canonical staging R2 bucket family and a staging hostname token. A full production-target rendering is a negative test. Cloudflare-generated opaque Access audiences are intentionally not interpreted by name; exact separation remains a current-session read-only inventory precondition.
- The D1 REST adapter now accepts only string/number caller values, serializes every number to its canonical decimal string and rejects `null` or other types before the request. The bootstrap Audit uses fixed SQL `NULL` literals, so operator values never require nullable REST parameters.
- A real bootstrap-to-adapter test captures every query and the ten-statement provider batch and asserts that every REST parameter is a string.
- The first-Owner batch now also asserts no Buyer channel exists and atomically creates exactly one deterministic `staging-buyer-channel`; rollback tests assert no Buyer-channel ghost.
- The staging template and preflight require invitation-based Buyer registration to use that channel with human verification disabled only in staging. Buyer registration still requires a Staff-issued invitation token and the formal registration service.
- OpenSpec, D-041, the release contract and the staging runbook were aligned to these corrections.

## Revised local evidence

- `npm run test:staging-governance`: PASS, 5 files and 38 tests.
- API typecheck: PASS.
- OpenSpec target strict: PASS.
- OpenSpec all strict: PASS, 67/67.
- `npm run check`: PASS, 242 test files and 1605 tests plus build, Wrangler dry-run, security, Node safety and governance gates.
- `git diff --check`: PASS.
- Migration changes: none.
- Cloudflare remote writes: 0.
- Production touched: NO.

## Current gate

The revised head still requires a new fixed-SHA independent review. `READY_FOR_REMOTE_STAGING_WRITES=NO`, `READY_FOR_MERGE=NO`, `READY_FOR_ARCHIVE=NO`, `PRODUCTION_GO=NO`.
