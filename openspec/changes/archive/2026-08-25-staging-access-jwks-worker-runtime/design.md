## Context

See `proposal.md`. Staging tail evidence shows that the Worker receives both Access identity headers but rejects bootstrap with `JWKS_FETCH`. The deployed bindings exactly match the managed staging configuration, and the configured public certificate endpoint returns HTTP 200 outside Workers. The current implementation passes `redirect: 'error'`; that mode throws in the deployed runtime before an HTTP response is available.

## Goals / Non-Goals

**Goals:**

- Preserve exact HTTPS team-domain pinning, audience matching, RS256 verification, bounded response size and fail-closed behavior.
- Make the public JWKS GET executable in the deployed Workers runtime.
- Prove the fix first with focused tests, then by an authenticated staging Owner bootstrap at the reviewed and merged SHA.

**Non-Goals:**

- No authentication bypass, header trust fallback, hard-coded key, persistent key copy or role change.
- No production deployment or production resource access.
- No T9 acceptance claim in this blocker Change.

## Decisions

Use `redirect: 'manual'` for the fixed JWKS URL. A direct 2xx response continues through the existing shape, size and signature checks. Any 3xx remains non-OK and therefore fails closed as `JWKS_HTTP`; the Worker never follows a redirect to another origin.

`redirect: 'follow'` was rejected even though it appears in a Cloudflare example, because automatic redirect following is unnecessary for the canonical endpoint and broadens the outbound trust boundary. Removing JWT verification or trusting `Cf-Access-Authenticated-User-Email` was rejected because Access headers alone do not replace signature, issuer and audience validation.

## Risks / Trade-offs

- [The canonical endpoint begins redirecting] -> Authentication fails closed until the configured exact team domain is corrected; no redirect target is trusted automatically.
- [Unit simulation differs from edge runtime] -> Require fixed-SHA staging deployment and an authenticated bootstrap before closing the blocker.

## Migration Plan

No schema migration. Merge the independently reviewed two-file runtime patch, deploy that merged SHA only to the isolated staging Worker, verify Staff bootstrap and session read, and resume T9. Rollback is an ordinary redeploy of the previous staging Worker version; it does not touch D1 or R2 facts.
