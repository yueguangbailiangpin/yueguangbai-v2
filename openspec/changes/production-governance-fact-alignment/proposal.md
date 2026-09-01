# Proposal: production-governance-fact-alignment

## Why

Current release-governance documents still contain facts from before the
current local baseline: a resolved GitHub Actions billing block, Schema 72,
and descriptions that present retired Staff MCP/provider capabilities as
production-capable. The parent Stage 7F Change is now complete at 42/42 tasks
but remains unarchived, and the former `app.yueguangbai.net` deployment (and
its `/ready` endpoint) has been cleaned up. Leaving the hourly probe enabled
would create a known-false production signal.

## What Changes

- Align the final Production Gate, Owner actions, current system state, and
  local-preparation evidence with directly verified local facts: Schema 37,
  resolved billing-block wording, retired Staff MCP/Rakuten/TikTok surfaces,
  and the separate Stage 7F completion/archive facts.
- Mark preserved old local-preparation measurements and historical records as
  historical snapshots without deleting their audit meaning.
- Remove the `schedule` trigger from
  `.github/workflows/production-health-monitor.yml` while retaining
  `workflow_dispatch`, the fixed diagnostic script, permissions, concurrency,
  and the existing old endpoint as a manual diagnostic target only.
- Update the local release-governance verifier and regression tests to require
  the paused, manual-only workflow and its Stage 8 reactivation notice.

## Non-goals

- No database migration, schema, API, DTO, permission, business-logic, or
  Amazon index change.
- No Staff MCP, Rakuten, or TikTok capability restoration; no new URL is
  invented and no deployment is performed.
- No GitHub, Cloudflare, D1, R2, Queues, Drive, Feishu, staging, or production
  access or write.
- No archive or sync of this or any existing OpenSpec Change.

## Migration / Security / Privacy

`NO_SCHEMA_CHANGE`. The workflow retains `contents: read` and `issues: write`
only; it cannot deploy or mutate application resources. No customer, order,
financial, file, credential, or personal data is added to documentation or
workflow inputs. Existing manual diagnostics remain bounded by the checked-in
monitor script and fixed low-cardinality reasons.

## Rollback

Revert the local commits for this Change. Reactivation of an hourly schedule
requires a separate, explicitly reviewed change after Stage 8 has formally
deployed and confirmed a production `/ready` URL; it is not a rollback side
effect.
