# Change: seller-partner-master-data-import

## Why

The four Tencent Docs folders are read-only historical seller/product sources. The current schema treats a seller WeChat claim as globally unique and treats a product as owned by exactly one seller, so a faithful import cannot safely represent the frozen folder/channel boundary, repeated WeChat identities, or the same ASIN supplied by multiple seller organizations.

## Scope

- Add the five frozen seller channels and alias normalization without changing existing channel prefixes or sequence counters.
- Add a local-only, traceable source manifest parser and two-phase preview/commit importer.
- Group by `(source_folder_id, normalized_wechat)`; never merge the same WeChat across folders.
- Add standard product, seller offering, import source, and reservation eligibility/opening projections.
- Relax only the seller-side WeChat claim conflict through an explicit subject type; buyer WeChat uniqueness remains protected.
- Keep imported organizations/members disabled and create no login account, invitation, external message, provider call, production D1/R2 write, or deployment.

## Non-goals

- Reading or modifying Tencent Docs.
- Importing order information or order-detail sheets.
- Creating or activating seller login accounts.
- Opening a live reservation demand or copying canonical product truth into seller-specific product versions.
- Applying any migration to staging/production.

## Safety boundary

All acceptance evidence is local fixture evidence. `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO` remains the release state until an independently authorized operator reviews source projections, applies the migration in the correct environment, and performs a controlled import.
