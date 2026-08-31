# Proposal: staff-access-jwt-tamper-test-determinism

## Why

The Staff Cloudflare Access JWT test currently replaces the final two encoded
signature characters with the fixed value `aa`. When the original signature
already ends in `aa`, the supposed tampered token is byte-for-byte unchanged,
so the bad-signature assertion can pass or fail depending on generated key
material.

## What Changes

- Add a deterministic test-local JWT signature tampering helper.
- Mutate a decoded signature byte and re-encode it as base64url so every
  tampered token changes signature bytes while retaining JWT segment format.
- Keep the existing verifier assertion that rejects the tampered token with
  the `SIGNATURE` reason.
- Add a regression test that locks the old `aa` no-op case and the new byte
  mutation behavior.

## Non-goals

- No change to production Cloudflare Access JWT parsing or verification.
- No change to Staff identity, session, authorization, D1, migration, API,
  browser, Amazon, website, release-check, or business behavior.
- No remote CI, GitHub, Cloudflare, D1 Remote, R2, Queues, Drive, Feishu,
  deployment, package, or lockfile operation.
- No archive or sync of this Change.

## Migration / Security / Privacy

`NO_SCHEMA_CHANGE`. The change is confined to a Staff authentication test
fixture and its regression coverage. It strengthens evidence for the existing
fail-closed invalid-signature contract and adds no credentials, identities,
customer data, or network access.

## Rollback

Revert the single local commit for this Change. Production JWT verification is
not part of the rollback surface.
