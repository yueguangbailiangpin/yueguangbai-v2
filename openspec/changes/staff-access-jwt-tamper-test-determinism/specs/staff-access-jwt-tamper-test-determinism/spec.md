# Staff Access JWT Tamper Test Determinism

## Purpose

Make the Staff Cloudflare Access invalid-signature test prove the existing
fail-closed JWT contract on every run.

## ADDED Requirements

### Requirement: invalid-signature fixtures always change signature bytes

The Staff Cloudflare Access test suite MUST generate a tampered JWT by changing
at least one decoded signature byte, then re-encoding the signature with the
existing legal base64url format. The helper MUST preserve the JWT's three
segments and MUST NOT modify production JWT verification code.

#### Scenario: original signature ends with aa

- **WHEN** a fixture signature ends with the encoded suffix `aa`
- **THEN** the generated tampered token differs from the original and its
  decoded signature bytes differ, while the token remains three legal
  base64url segments

#### Scenario: verifier receives the tampered fixture

- **WHEN** the existing Staff Access verifier receives the generated token and
  the matching original public JWK
- **THEN** verification fails closed with `UNAUTHENTICATED` and reason
  `SIGNATURE`
