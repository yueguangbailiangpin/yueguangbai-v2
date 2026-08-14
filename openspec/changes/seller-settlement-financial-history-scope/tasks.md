## 1. Authority and scope

- [x] 1.1 Confirm the current Seller actor, OWNER/FINANCE role gate, assigned-active-Store resolver, settlement read model and Store-selector request behavior.
- [x] 1.2 Record `NO_SCHEMA_CHANGE`, `NO_FORMULA_CHANGE` and the financial-history-only exception boundary.

## 2. Seller Web

- [x] 2.1 Clarify that OWNER sees organization-wide financial history including disabled-Store historical settlement.
- [x] 2.2 Retain FINANCE assigned-Store copy and prove OWNER settlement requests do not change with the current Store selector.

## 3. API behavior evidence

- [x] 3.1 Add migrated-D1 HTTP coverage with active and disabled Store payables: OWNER summary/list includes both while FINANCE includes only its assigned active Store.
- [x] 3.2 Prove OWNER can read organization payments, FINANCE cannot read organization payments or the disabled payable, and the exception does not add the disabled Store to FINANCE's general Store reads.

## 4. Verification and handoff

- [x] 4.1 Run focused Seller Portal API and SellerPages Web tests plus API/Web typecheck.
- [x] 4.2 Run strict OpenSpec validation and fixed-range diff checks.
- [x] 4.3 Keep this Change active without sync/archive; create one local-only commit for Formal Verify and independent review.
