# Owner-confirmed availability corrections

This bounded local overlay records decisions already made without pretending
to contain a new Tencent Docs export.

- `ido-mango` is a channel, not a seller identity.
- The four Somiso JP rows are one product and use Amazon ASIN `B0GR5C43PG`.
  Exact live row references remain pending; no rows are fabricated here.
- `JP_AMAZON:B0GRMRV64K` keeps only `ido-mango / szgavin68` in available
  supply. Historical `ygbceping / shiguo0317` evidence is retained and
  reported under `excludedSellerOfferings`.
- Rows marked `PAUSED` are excluded from the current whitelist.
- The blank Philips row is abnormal and excluded; it is not assigned an ASIN.

The compressed local fixture predates these source changes. A read-only live
refresh must provide exact row numbers, source locators, and paused-row
annotations before the full manifest counts or hash are re-baselined.

## Owner formal confirmation (2026-08-21)

The business owner formally confirmed the following three rules as applied by
the 2026-08-21 staging import (conversation confirmation, 2026-08-21):

1. **Somiso JP merge** — the four rows are one standard product using ASIN
   `B0GR5C43PG`. CONFIRMED.
2. **`B0GRMRV64K` ownership** — only `ido-mango / szgavin68` counts as current
   available supply; `ygbceping / shiguo0317` remain historical evidence only
   (`excludedSellerOfferings`). CONFIRMED.
3. **Reservation gating** — only products with a matched seller, a valid row
   and a positive-integer total order quantity open for reservation (30 days
   from import time). Products without a matched seller, and rows with blank
   or non-positive-integer order totals, stay in the standard product catalog
   without reservation. Paused rows, rows missing required identifiers, and
   the blank Philips row (no fabricated ASIN) are excluded. CONFIRMED.

These confirmations close the Somiso / `B0GRMRV64K` / unlabeled-product
business-review sub-items of `docs/CURRENT_PRODUCT_SELLER_STAGING_HANDOVER_2026-08-21.md`
§9 item 7. The 29 unresolved historical files remain pending owner claim and
are unaffected by this confirmation.
