# Design: Schema 64 Integration Stabilization

## Runtime Authority

Cloudflare Access verifies a signed email assertion. Moonwhite D1 resolves that email to exactly one ACTIVE Staff account and computes one role, role-default permissions, explicit Marketplace scope and final Personal DENY. The Worker then issues its own opaque revocable Session. No Feishu identity, callback, task mirror or alert sink participates in this chain.

## Feishu Retirement Boundary

Active source, contracts, release templates, package scripts and current runbooks contain no Feishu activation path. Historical migration table names and archived evidence remain unchanged because they are part of the ordered database and audit history; they are inert and unavailable to active services.

## Staff Responsibility

Owner creates Staff accounts directly with email, one role and explicit Marketplace codes. The first ACTIVE `role × Marketplace` holder is PRIMARY and later holders are SUPPORT. Both have the same role/Marketplace visibility; PRIMARY only owns the open queue. Personal DENY remains final. No active GRANT can expand a role default.

## Verification

Verification covers migration byte guards and local application through 0064, Access JWT/issuer/audience/JWKS failures, unknown-email concealment, origin checks, Staff account isolation, duplicate route inventory, acquisition scope, financial invariants, OpenSpec strict, typecheck, full tests/build and browser journeys. All external mutation counters remain zero; the final operation is a normal push of this feature branch only.
