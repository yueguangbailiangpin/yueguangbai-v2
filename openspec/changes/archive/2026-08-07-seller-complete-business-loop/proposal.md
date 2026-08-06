# Change Proposal: Seller Complete Business Loop

## Why

The baseline already has substantial Seller APIs for catalog, demand, formal orders, reviews and settlement, but the Seller web workspace is still a placeholder. Its public DTOs also retain JP-only fields despite the canonical multi-marketplace foundation, and no Seller-safe response exposes the four-part business-completion truth. This Change closes those real gaps without duplicating existing ledgers or granting Seller write authority over Staff-controlled finance.

## What Changes

- Replace the placeholder Seller shell with a Chinese, mobile-first business workspace and authorized Store context.
- Add platform-neutral formal-order money, identifier and immutable rate/fee fields while retaining JP compatibility fields.
- Add a server-derived four-component completion projection backed by existing review, refund and Seller ledgers.
- Preserve Staff-only settlement proof authorization and all existing Buyer/Staff contracts.

## Scope

- Deliver a Chinese, mobile-first Seller workspace for organization/store context, products, applications, demand batches, formal orders, reviews, settlement and account/session actions.
- Generalize Seller-safe DTOs and projections to active `AMAZON_JP` and `AMAZON_US` Stores while preserving JP legacy fields during compatibility rollout; keep `COUPANG_KR` visible only as disabled capability.
- Expose immutable order currency/rate/fee snapshots and a derived four-component completion projection.
- Keep principal and service fee as separate CNY facts and statuses; retain Staff-only protected settlement-proof authorization, association and audit without exposing internal proof files to Seller.
- Add strict runtime validation, persona-separated Query roots, cursor paging, conflict-safe mutations and complete unit/API/MSW/browser/security verification.

## Non-Goals

- No real payment, bank, deployment, DNS/domain, Feishu, Google Drive/R2 cold archive, MCP, production database or credential operation.
- No Seller financial export, Staff finance mutation UI, rate editing, payment confirmation or audit-field editing.
- No Korea transaction workflow or invented Coupang validation.
- No new Migration: audited schema 0029/0030 already contains the required generic Marketplace, currency, immutable snapshot, persona and ledger facts. Completion is a projection of existing facts, not a mutable column.
- No change to Buyer or Staff endpoint semantics and no removal of JP compatibility fields.

## Security and Privacy

Every Seller request resolves the Seller Persona on the protected Seller route, applies Seller Organization plus Store scope, and conceals cross-scope resources as not found. DTO allowlists exclude Buyer identity, Buyer refund amounts/proofs, Staff identity/notes, internal profit and storage keys. Customer 401 cleanup cancels and clears Buyer and Seller roots together, while normal Seller navigation and caches remain persona-specific.

## Financial and Completion Invariants

Buyer order money remains currency-explicit JPY/USD/KRW minor units. Seller principal and service fee remain independent CNY-fen payables backed by immutable allocation/payment/reversal facts. Seller agreement rate and fee snapshots are read-only and immutable. An order is `COMPLETE` only when review, Buyer refund, Seller principal and Seller service fee are each `COMPLETE` or `NOT_APPLICABLE`; partial, missing, reversed or conflicted facts remain incomplete.

## Rollback

This Change has no schema migration. Before production deployment, rollback is a Worker/Web version rollback because new APIs are additive and legacy JP response fields remain present. Once consumers rely on generic fields, rollback must retain those additive contracts or use a forward compatibility fix. Financial facts are never deleted or reversed by rollback.

## Acceptance

Strict target and repository OpenSpec validation, workspace typecheck/build/tests, local D1 full migration chain, Seller isolation/finance/file/persona/JP-compatibility tests, Formal Verify, secrets scan and deterministic Playwright visual acceptance must all pass. The existing two-high React Router RSC advisory baseline must not worsen.
