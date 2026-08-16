## Context

The merged redirect repair changed the fixed JWKS request from an unsupported redirect mode to `manual`, but authenticated staging bootstrap continued to fail with `JWKS_FETCH`. The Worker receives the Access assertion and authenticated-email headers, and the same configured JWKS endpoint returns HTTP 200 from an independent public probe. Cloudflare documents that global Worker-to-Worker `fetch()` needs a Service binding or `global_fetch_strictly_public`; without that flag, requests can bypass Cloudflare routing and target a zone origin instead.

## Goals / Non-Goals

**Goals:**

- Make the exact configured Access team JWKS endpoint reachable through Cloudflare's public routing path.
- Preserve exact team-domain pinning, manual redirect rejection, bounded JWKS parsing and complete JWT verification.
- Keep configuration drift fail-closed in both deployable templates and release preflight.

**Non-Goals:**

- No trust in the authenticated-email header without JWT verification.
- No hard-coded key, Access bypass, Service token, new Worker, new D1/R2 resource or production deployment.
- No T9 completion claim until real authenticated staging bootstrap passes.

## Decisions

Enable only `global_fetch_strictly_public` in the staging and production release templates. A Service binding is not available for the account-owned `cloudflareaccess.com` team endpoint, and copying rotating Access keys into repository or D1 state would create a second key authority.

Release preflight and the static release-configuration verifier require the exact one-flag set. This makes accidental removal, fallback to `global_fetch_private_origin` or unrelated compatibility-flag expansion an explicit reviewed contract change.

The production template is updated because it invokes the same Staff Access runtime and would otherwise retain a known-broken deployment contract. This is repository configuration only; production remains `NO_GO` and is not deployed or inspected.

## Risks / Trade-offs

- [Global fetch routing changes] -> The API source audit shows the JWKS request is the only global outbound `fetch()`; other outbound calls use explicit bindings. Preflight pins the exact compatibility set.
- [Public endpoint redirects or returns non-2xx] -> `redirect: 'manual'` plus the existing `response.ok` check fails closed.
- [Local simulation differs from edge] -> Require deployment of the reviewed merge commit only to the existing staging Worker and a real authenticated Owner bootstrap.

## Migration Plan

No schema migration. Merge the independently reviewed configuration contract, update the Git-external staging config to the merge SHA and exact compatibility flag, validate it with release preflight, deploy only the existing staging Worker, and retry authenticated Owner bootstrap. Rollback is an ordinary redeploy of the preceding staging version.
