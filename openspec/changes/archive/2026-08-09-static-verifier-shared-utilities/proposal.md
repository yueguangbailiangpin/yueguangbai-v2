## Why

Static verifiers repeat repository reads, assertions, and active/archive resolution, making archival drift and inconsistent failure semantics more likely. The repeated exact-source-marker style must be reduced carefully without deleting historical reproduction tools or weakening assertions.

## What Changes

- Inventory current verifier scripts, line counts, duplicated helpers, source-marker usage, and command/OpenSpec references.
- Extract a standard-library shared utility for reads, assertions, exact markers, and fail-closed active/archive resolution.
- Adopt it in the release/Staff MCP verifiers and other low-risk exact duplicates supported by focused regression checks.
- Retain historical verifiers unless both current-gate and historical-reproduction independence are proven.
- Add no dependency and weaken no assertion.

## Capabilities

No externally observable capability requirement changes. This is verifier maintainability work, so this Change sets `skip_specs: true`.

## Impact

Local static verifier source, verifier tests, and audit evidence only. No production runtime, API, schema, permission, session, financial, file, or external-system change.
