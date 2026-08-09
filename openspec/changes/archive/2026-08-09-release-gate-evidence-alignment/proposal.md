## Why

Current release verifiers contain archived-Change path assumptions, one stale exact requirement-count assertion, and historical candidate claims. A single local release gate is needed to bind evidence to the actual candidate while keeping every external prerequisite truthfully `NO-GO`.

## What Changes

- Resolve governed Change evidence from exactly one active or dated archive location.
- Validate the five critical Staff MCP invariants as a required subset of the current authoritative specification.
- Refresh Production GO evidence and owner checklist wording for archived and merged work.
- Add a release-specific aggregate command covering the main gate and local final-production, Cloudflare, production-readiness, Drive, Feishu, and Staff MCP verifiers/preflights.
- Bind emitted local evidence to the current clean candidate SHA/tree and retain explicit external `NO-GO`.
- Record local-only performance revalidation without claiming production Web Vitals.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `production-go-local-preparation`: Require active/archive-safe evidence resolution, current candidate provenance, aggregate local release verification, and truthful local-performance claims.

## Impact

Release scripts, package commands, acceptance/runbook documents, local tests, and OpenSpec governance. No deployment, production activation, external provider access, Migration, business contract, or runtime application behavior changes.
