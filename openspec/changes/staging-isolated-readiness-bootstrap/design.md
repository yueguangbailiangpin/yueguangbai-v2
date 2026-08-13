# Design: Staging Isolated Readiness Bootstrap

## Isolation boundary

Staging may share a Cloudflare account with production but must use different Worker, D1, R2, custom domain, Access application/audience, Secrets and identities. The operator preflight validates explicit names/IDs and refuses placeholders, defaults and production-like database names. This is resource isolation, not account-level trust isolation.

## Readiness profiles

Production keeps the published eight-check envelope and requires every check to equal `ok`. Staging uses the same keys so operators and monitors cannot silently omit evidence, but reports Scheduler, Acquisition Maintenance, operational alerts and production recovery as `not_required`. A staging response is ready only when these four statuses are exactly `not_required` and Schema, real object storage, Access configuration and exact release are `ok`. Unknown environments and a staging profile that enables a production-only switch fail closed.

The production health monitor and explicit production probe continue to require all eight `ok` values. They do not accept `not_required`, so staging semantics cannot weaken Production GO.

## First Owner transaction

The operator supplies account ID, exact staging D1 name/ID and a Git-external `0600` JSON file containing display name, normalized email and idempotency key. Authentication comes from Wrangler OAuth or an ephemeral environment token. The script first reads only D1 control-plane identity and rejects name/ID mismatch or production-like names.

The D1 REST adapter sends prepared SQL plus separate parameter arrays. One provider batch asserts Schema 65 and empty Staff authority, then inserts one Staff user, one active Owner role, one active email identity, one authorization event, one immutable Audit, idempotency completion and final exact-count assertions. D1 batch rollback prevents partial Staff/Audit ghosts. Same-key/same-request replay returns only Staff ID/role/status; a changed request conflicts. Emails, tokens and input contents are never printed or stored in command responses/Audit projections.

The bootstrap is an operator CLI, not an HTTP route. Once the first Owner exists, every later Staff account uses the formal Owner-only Staff access management API and every Customer test identity uses formal onboarding/activation/password services.

## Rejected alternatives

- Enabling Cron and acquisition maintenance in staging only to satisfy `/ready` contradicts the frozen release profile and would exercise business mutations before acceptance.
- Reporting disabled production jobs as `ok` hides missing execution evidence.
- Direct `wrangler d1 execute` SQL cannot bind private operator values safely and encourages values in shell history or temporary SQL files.
- A permanent HTTP bootstrap endpoint creates an unnecessary authentication bypass surface.
- Committing a fixed Owner email or test passwords would leak identity material and make environments non-revocable.
