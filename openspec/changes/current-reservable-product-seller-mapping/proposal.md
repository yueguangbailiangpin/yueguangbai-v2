## Why

Migration 0040 provides safe product and seller-offering projections, but it does not decide which rows in the current Tencent Docs summary are the live reservation whitelist or how the remaining historical files map to seller organizations. The current whitelist and the four historical folders therefore need a deterministic, reviewable local projection before any future import can be considered.

## What Changes

- Add a local-only parser for the two current-whitelist worksheets and the four frozen historical-folder projections.
- Add an explicit channel-alias map and explicit seller mappings for the nine owner-confirmed cases.
- Normalize products by `(marketplace_code, platform_product_identifier)`, validating Amazon ASINs and preserving explicit Rakuten `R-1`/`S-1` identities, while preserving every distinct seller offering and seller-source reference.
- Mark missing seller identity, malformed ASINs, excluded `自发货-店铺评论`, unknown channels, and source conflicts as quarantined/anomalous instead of guessing.
- Produce deterministic preview counts and anomaly sections for current products, mapped supply, multi-seller ASINs, quarantined history, confirmed sellers without history, and field conflicts.
- Keep the implementation local-only: no Tencent Docs write, no D1/R2 write, no accounts, invitations, provider calls, migration execution, deployment, or remote branch write.

## Capabilities

### New Capabilities

- `current-reservable-product-seller-mapping`: Deterministic local parsing and preview of the current reservation whitelist and its seller-supply mappings.

### Modified Capabilities

- None. The existing seller-partner master-data import contract remains unchanged; this Change supplies a narrower pre-import projection.

## Impact

- Adds local API-domain parsing/types/tests, a local dry-run entry point, OpenSpec evidence, and a read-only source snapshot report.
- No API route, Contract, migration, production configuration, secret, or external resource is changed.
- The output is an input for later Staff-reviewed import work; it does not itself create or activate product, seller, login, or reservation facts.
