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
