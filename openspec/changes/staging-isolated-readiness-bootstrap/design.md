# Design: Staging Isolated Readiness Bootstrap

## Isolation boundary

Staging may share a Cloudflare account with production but must use different Worker, D1, R2, custom domain, Access application/audience, Secrets and identities. The local preflight validates explicit operator-named resources and refuses placeholders, defaults and production-like names. Cloudflare generates Access audience tags as opaque values, so audience separation is proved by current-session read-only Access inventory and exact inequality with the production audience, never by guessing meaning from the tag text. This is resource isolation, not account-level trust isolation.

## Readiness profiles

Production keeps its published readiness gates and does not accept staging-only `not_required` evidence as Production GO. Staging uses the same keys so operators and monitors cannot silently omit evidence, but reports Scheduler, Outbox Delivery, Acquisition Maintenance, operational alerts and production recovery as `not_required`. A staging response is ready only when these five statuses are exactly `not_required` and Schema 70, real object storage, Access configuration and exact release are `ok`. Unknown environments and a staging profile that enables a production-only switch fail closed.

The production health monitor and explicit production probe continue to enforce the production contract. They do not accept staging semantics as production evidence, so staging cannot weaken Production GO.

## First Owner transaction

The operator supplies account ID, exact staging D1 name/ID and a Git-external `0600` JSON file containing display name, normalized email and idempotency key. Authentication comes from Wrangler OAuth or an ephemeral environment token. The script first reads only D1 control-plane identity and rejects name/ID mismatch or production-like names.

The D1 REST adapter sends prepared SQL plus separate parameter arrays containing only strings, matching the published REST contract; numeric values use canonical decimal strings and SQL `NULL` stays in fixed source rather than operator input. One provider batch asserts Schema 70, empty Staff authority and no Buyer channel, then inserts one Staff user, one active Owner role, one active email identity, one synthetic staging Buyer channel, one authorization event, one immutable Audit, idempotency completion and final exact-count assertions. D1 batch rollback prevents partial Staff/Audit/foundation ghosts. Same-key/same-request replay returns only Staff ID/role/status; a changed request conflicts. Emails, tokens and input contents are never printed or stored in command responses/Audit projections.

The bootstrap is an operator CLI, not an HTTP route. The staging release profile explicitly enables invitation-based Buyer registration against the deterministic synthetic Buyer channel. Once the first Owner exists, every later Staff account uses the formal Owner-only Staff access management API and every Customer test identity uses formal onboarding/activation/password services.

## Rejected alternatives

- Enabling Cron and acquisition maintenance in staging only to satisfy `/ready` contradicts the frozen release profile and would exercise business mutations before acceptance.
- Reporting disabled production jobs as `ok` hides missing execution evidence.
- Direct `wrangler d1 execute` SQL cannot bind private operator values safely and encourages values in shell history or temporary SQL files.
- A permanent HTTP bootstrap endpoint creates an unnecessary authentication bypass surface.
- Committing a fixed Owner email or test passwords would leak identity material and make environments non-revocable.
