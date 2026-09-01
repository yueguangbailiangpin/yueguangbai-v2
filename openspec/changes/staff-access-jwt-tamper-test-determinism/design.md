# Design: staff-access-jwt-tamper-test-determinism

## Test-local mutation boundary

The helper remains in `apps/api/src/staff-auth/cloudflare-access.test.ts`; no
production module is imported or changed for mutation. It splits the fixture
into the three existing JWT segments, decodes only the signature segment,
flips one bit in the first signature byte, and base64url-encodes the result.
The header and payload are preserved exactly.

Flipping a decoded byte, rather than replacing trailing encoded characters,
guarantees that the signature bytes differ even when the prior signature ends
in `aa` and avoids relying on non-significant base64url padding bits. The
result remains a three-segment token with a legal base64url signature.

## Security assertion

The existing bad-signature case continues to call
`verifyCloudflareAccessIdentity` with the mutated token and the original public
JWK, and continues to require `UNAUTHENTICATED` with reason `SIGNATURE`. The
new pure regression case uses a deterministic `a.b.aa` token to prove both the
old no-op and the new byte-changing property without generating keys or
touching a network resource.

## Rejected alternatives

- Keep the fixed `aa` suffix: rejected because it can leave a token unchanged.
- Change only the final encoded character: rejected because base64url padding
  bits may not change the decoded signature bytes.
- Alter production JWT verification to accommodate the test: rejected because
  the existing fail-closed Staff Access contract is correct and out of scope.
- Add retries or skip the assertion when mutation is ineffective: rejected
  because that would hide a security regression instead of proving rejection.

## Boundaries and rollback

There is no database, session, authorization, or deployment boundary change.
All evidence is LOCAL. Rollback is limited to the test helper and its
regression test in this Change.
