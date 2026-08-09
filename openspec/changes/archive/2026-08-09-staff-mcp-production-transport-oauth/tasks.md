# Tasks: Staff MCP Production Transport and OAuth

## 0. Governance and Baseline

- [x] 0.1 Fetch and verify exact `origin/main` SHA and isolated branch/worktree.
- [x] 0.2 Read AGENTS, decisions, AI governance, OpenSpec config, canonical Staff MCP, Production GO evidence, authorization/File Audience/audit/rate/replay and Cloudflare materials.
- [x] 0.3 Use official OpenAI and IETF public documentation only; perform no login, provider request or external write.

## 1. Migration

- [x] 1.1 Record `SCHEMA_CHANGE_REQUIRED` and Migration `0038` ownership.
- [x] 1.2 Implement guarded hashed binding/revocation/replay/rate/control tables and local migration tests.

## 2. Contracts

- [x] 2.1 Freeze HTTPS JSON-RPC, RFC 9728 metadata/challenge and OAuth/JWT/JWKS validation boundaries.
- [x] 2.2 Freeze D1-authoritative Staff mapping, current authorization, File Audience, 404 and Web-confirmation-only behavior.
- [x] 2.3 Update canonical contract/runbooks and add preflight/evidence contracts.

## 3. Implementation

- [x] 3.1 Implement anonymous production OAuth metadata/JWKS/JWT verifier with rotation and fail-closed revocation/binding.
- [x] 3.2 Implement D1 durable replay/rate/kill-switch stores and compose with immutable audit.
- [x] 3.3 Register isolated MCP metadata/resource routes and keep Web/API available when MCP is disabled or invalid.
- [x] 3.4 Add disabled staging/production templates and Secret-name-only zero-network preflight.

## 4. Tests

- [x] 4.1 Test Migration guards and D1 invariants.
- [x] 4.2 Test anonymous HTTP metadata/challenge/JSON-RPC and JWT/JWKS validation/rotation/outage/revocation.
- [x] 4.3 Test durable replay/rate/control/audit and existing Staff/Personal/File isolation regressions.
- [x] 4.4 Run targeted tests, strict OpenSpec, security/dependency/Migration gates, appropriate Chromium and full `npm run check` once after implementation.

## 5. Rollback and Runbook

- [x] 5.1 Document environment and D1 kill-switch rollback that leaves Web healthy.
- [x] 5.2 Document key/issuer/revocation incident handling and prohibit down-migration/data deletion.

## 6. Acceptance and Handoff

- [x] 6.1 Record `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO` with all real provider/OpenAI/Cloudflare truths unverified.
- [x] 6.2 Perform read-only Ponytail review only after complete acceptance and remediate if necessary.
- [x] 6.3 Confirm uncommitted, unpushed, no PR/deploy/archive and zero external-resource writes.

## 7. P1 Remediation

- [x] 7.1 Make screenshot replay metadata-only with explicit safe duplicate behavior and reduce ordinary replay to 256 KiB text-only results.
- [x] 7.2 Add default-off bounded replay/rate/revocation cleanup that never targets bindings, controls or audit.
- [x] 7.3 Construct production application service from D1 and token status from a strict Cloudflare Service Binding without JavaScript object injection.
- [x] 7.4 Add anonymous zero-network, schema, rollback, replay/audit/log and Cloudflare composition tests.
- [x] 7.5 Rerun MCP production, schema/rollback, full check, Chromium, OpenSpec and audit; refresh truthful NO-GO evidence.
