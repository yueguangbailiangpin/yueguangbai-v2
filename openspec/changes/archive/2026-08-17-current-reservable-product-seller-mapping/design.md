## Source and projection boundary

The input is a local manifest exported from the two current worksheets plus explicit historical-folder rows. The parser does not fetch Tencent Docs; the live source is queried separately by an operator and the resulting manifest/report is reviewed locally. `工作表1` and `飞利浦产品` are the only current sources. Historical rows are evidence for seller organization, seller WeChat, channel and historical supply, never an implicit current whitelist.

The frozen current source snapshot queried on 2026-08-09 has 91 non-empty data rows in `工作表1` and 23 in `飞利浦产品`, for 114 current rows. It has 109 valid identifier rows: 107 Amazon ASIN rows and two explicit Rakuten identifiers (`R-1`, `S-1`); five rows have no product identifier. The marketplace-aware key `(marketplace_code, platform_product_identifier)` yields 88 unique current products: 86 Amazon ASINs and two Rakuten products. These facts are recorded in the local read-only manifest and are not a production import.

## Identity and routing

Channel routing is an allowlist. Folder IDs resolve to `ido-mango`, `ygbceping`, `yinghua1942`, and `yueguangbaiai`; title aliases are normalized only through the explicit map, including `gyb`, `idomango`, `ido-mago`, `ido-mamgo`, `yuegungbai`, `yinghua1942ai`, and `quesheng520ai`. An alias that normalizes to a different folder default is a conflict. No generic substring or fuzzy title matching is used.

Historical seller keys default to `folderId:normalizedWechat`. The seven owner-confirmed historical file mappings provide the missing WeChat for `缝纫机`, `游戏手柄`, `吸尘器配件`, `风扇`, `采暖产品`, `耳机Skulls_Yu`, and `乐天手机支架`. The two current store mappings for `GoldHorizon Direct` and `Philips Power オフィシャル` explicitly point to one `ygbceping:ls381048211` organization key; they are different store/product contexts, not organizations.

## Deduplication and output

Current rows are first validated, then grouped by `(marketplace_code, platform_product_identifier)`. All source row references survive. A deterministic canonical name is selected by normalized lexical order; differing names or stores are reported as field conflicts. Historical rows are grouped by seller key and joined to current products only by the exact marketplace-aware product key. A join never grants current eligibility to a historical-only product.

The preview returns: normalized current rows, standard-product candidates, mapped seller offerings, multi-seller ASINs, quarantined history, confirmed-without-history rows, field conflicts, unresolved current rows, counts, and a SHA-256 manifest hash. Results are sorted by stable source IDs and keys. No D1 transaction, Audit row, Outbox event, account, invitation, reservation, R2 object, or external API call is part of this Change.

## Migration and rollback

No migration is required. Migration 0040 remains the existing forward-only schema prerequisite for a separately authorized future import; it is not executed or modified here. Local rollback is removal of the feature worktree/change files. A future database import must use the existing 0040 backup/restore runbook and independently reviewed batch rollback; this preview cannot roll back production facts because it creates none.

## Rejected alternatives

- Treating every historical ASIN as current would violate the current whitelist boundary.
- Merging equal WeChat values globally would collapse independent folder organizations.
- Inferring seller identity from similar titles, shop names, or order-detail sheets would create unauthorized mappings.
- Writing a migration or importing the preview now would turn local evidence into an unreviewed production fact.
