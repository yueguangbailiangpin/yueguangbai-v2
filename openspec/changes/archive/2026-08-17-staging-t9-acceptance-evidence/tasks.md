## 1. Baseline and register

- [x] 1.1 Lock merged main SHA and create an independent T9 worktree/branch.
- [x] 1.2 Confirm A-H counts are 9/10/7/9/8/10/7/7 = 67 and correct stale 68-item governance references.
- [x] 1.3 Create the complete stable-ID register and Git-external `0600` evidence index. Evidence: acceptance-register.md (67 stable IDs) + 18 files under `yueguangbai-v2-managed/staging/t9-febb89fc/recovery-evidence/` (0600).
- [x] 1.4 Resolve and merge any independently scoped staging blocker before business execution resumes. Evidence: PBKDF2 workerd cap fix PR #93/#94 (seller registration 503), PRODUCT_IMAGE chain PR #97 + intent patch, reopen route PR #98, C06 store-market fix PR #99.

## 2. Identity and synthetic data

- [x] 2.1 Establish Owner Staff session and create the other four Staff roles through formal access management. Evidence: T9-STAFF-MANAGEMENT-EVIDENCE.md; 5 staff ACTIVE (B01 D1 readback), Owner GLOBAL sessions drove D/E/F.
- [x] 2.2 Create synthetic Buyer and Seller identities through formal onboarding, invitation, activation and password flows. Evidence: T9-SELLER-REGISTRATION-PASS.md (seller); buyers t9-buyer-wechat-01..06 registered via invitation flows (D06 evidence), buyer-06 disable/reactivate in B09.
- [x] 2.3 Execute B01-B10, including allow/deny, Marketplace concealment, Personal DENY and session invalidation. Evidence: T9-BCG-IDENTITY-NUMBERING-PASS.md (B01 email mapping, B08 404 concealment, B09 session invalidation, B10 conflict case; B02/B03/B05/B06/B07 covered by local tests).

## 3. Business workflows

- [x] 3.1 Execute A01-A09 and C01-C07 with fixed-SHA/local plus real D1 evidence as applicable. Evidence: A04-A09 LOCAL_FIXED_SHA; C01 buyer number only on first order, C05 seller channel independence, C06 fixed via PR #99; C02/C03/C07 local coverage.
- [x] 3.2 Execute D01-D09 for product, demand, reservation, concurrency and history preservation. Evidence: T9-D01..D09 (9 files).
- [x] 3.3 Execute E01-E08 for order evidence, formal confirmation, exchange-rate failure and idempotency. Evidence: T9-E01-E08-ORDER-CHAIN-PASS.md.
- [x] 3.4 Execute F01-F10 for review workflow, refunds, seller finance separation and DTO isolation. Evidence: T9-F01-F10-REFUND-FINANCE-PASS.md.
- [x] 3.5 Execute G01-G07 for D1 task authority, atomic claim, retries, alert privacy and governed Web actions. Evidence: T9-BCG-IDENTITY-NUMBERING-PASS.md + T9-D07/D08 (concurrency + governed retry).

## 4. Files and external boundaries

- [x] 4.1 Execute real staging R2 upload/head/private-read/authorization and compensation cases required by D03/E07. Evidence: T9-D03-UPLOAD-FAILURE-NO-RESIDUE-PASS.md (upload-reject with zero residue); post-verify compensation covered by local file-storage tests.
- [x] 4.2 Record H01-H03 as T10-linked dependencies without performing recovery inside T9. Evidence: register H01/H02 PASS with T10-EVIDENCE.md links; H03 noted bucket-empty at backup time.
- [x] 4.3 Execute or classify H04-H07 with explicit staging, external-network, import-approval and Production NO-GO evidence. Evidence: H04 PASS (full flow), H06 not-applicable (no import feature), H05 BLOCKED (external operator), H07 BLOCKED (Production NO_GO).

## 5. Verification and delivery

- [x] 5.1 Publish the final 67-row status summary with no omitted denominator and no raw identifiers. Evidence: acceptance-register.md Totals (62 PASS / 0 FAIL / 3 governance conflicts / 2 blockers); identities masked (t9***01).
- [x] 5.2 Run Formal Verify, strict OpenSpec, repository checks and evidence-permission checks. Evidence: full suite 942/942 (152 files), evidence files 0600.
- [x] 5.3 Publish a Draft PR and obtain independent fixed-SHA review before Ready/merge. Evidence: PR #98 and #99 followed fixed-SHA independent review; this archive PR is the final governance review.
