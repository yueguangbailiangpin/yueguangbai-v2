## Why

After the reviewed redirect-mode repair was merged and deployed, real staging still failed closed at `JWKS_FETCH`. Cloudflare's current Workers contract states that Worker-to-Worker global `fetch()` requires either a Service binding or the `global_fetch_strictly_public` compatibility flag. The Access team JWKS endpoint is a Cloudflare-hosted public endpoint and has no repository-owned Service binding.

## What Changes

- Require `global_fetch_strictly_public` in the staging and production release templates used by the same Staff Access runtime.
- Make release preflight and the release-configuration verifier fail closed when that exact compatibility contract is absent or drifted.
- Deploy only the ordinarily merged SHA to the existing isolated staging Worker and verify authenticated Owner bootstrap before T9 resumes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The Staff Access contract still requires signature, issuer, audience, time and key validation against the configured team JWKS endpoint. This Change supplies the Workers routing mode required to reach that endpoint.

## Impact

- Changes checked-in staging and production templates plus repository-local release verifiers/tests; production is not deployed or queried.
- Does not change authentication fallbacks, permissions, D1, R2, migrations, secrets or business data.
- Existing binding-based fetches are unaffected; the only global outbound `fetch()` in the API source is the pinned Access JWKS request.
