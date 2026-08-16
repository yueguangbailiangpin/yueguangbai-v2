## Why

The deployed staging Worker receives the Cloudflare Access assertion but cannot establish any Staff session because its JWKS subrequest uses a redirect mode rejected by the Workers runtime. T9 role and business acceptance cannot begin until the existing Staff authentication contract works on the real runtime.

## What Changes

- Use a Workers-compatible, fail-closed redirect mode for the exact configured team JWKS endpoint.
- Lock the outbound request contract in the existing Cloudflare Access unit test.
- Redeploy only the ordinarily merged fixed SHA to the isolated staging Worker and verify Owner bootstrap before resuming T9.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing `staff-auth-session` requirement already mandates bounded team JWKS validation; this Change repairs runtime conformance without changing the contract.

## Impact

- Affects only Cloudflare Access JWKS retrieval and its focused test.
- No API, permission, identity, D1, R2, migration, customer session or production behavior is added.
- Production deployment remains `NO_GO`; the only authorized remote validation target is the isolated staging Worker.
