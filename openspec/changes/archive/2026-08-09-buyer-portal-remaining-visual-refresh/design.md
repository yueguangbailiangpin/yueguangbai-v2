# Design: Buyer Portal Remaining Visual Refresh

## 1. Authority and Baseline

The implementation baseline is `origin/main` `fcb78269dc4a3992e2602ec7f5917aa21f88ab16`. Business truth comes from the existing Buyer runtime schemas, DTOs, server actions, Customer Session boundary, protected-file controllers, and archived Module 1/OpenSpec requirements. Visual direction comes from the approved Buyer reference and the merged Buyer login/home/product pilot. The reference governs relative hierarchy, whitespace, card scale, and interaction direction only.

The reproducible build environment is Node `v24.18.1`, npm `11.16.0`, and lockfile SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`. Before implementation, exact `gzip -9` evidence is: initial entry 245,572 raw / 74,271 gzip bytes; CSS 54,644 / 10,182; Buyer route 18,498 / 4,810; Buyer order route 21,756 / 5,865; Buyer after-sales route 15,123 / 4,236. These values remain the comparison baseline even when output hashes change.

`apps/web/src/styles/tokens.css` remains the only token truth. `global.css` may compose existing token values through Buyer-only selectors; it SHALL NOT add a competing palette, spacing scale, typography scale, shadow system, persona theme, framework, font, or runtime dependency.

## 2. Shared Buyer Visual Grammar

All remaining Buyer pages retain the existing `BuyerFrame`, fixed five-item navigation, route ownership, and semantic DOM order. Their shared grammar is:

1. Large brand space supplied by the Buyer shell.
2. Compact four-step explanatory journey with only the current real section highlighted.
3. Page title, current object, and textual status.
4. One prominent summary or next-action surface.
5. Supporting facts/history/files after the primary surface.
6. One dominant primary action; destructive or secondary actions remain visually subordinate and explicitly confirmed.

Existing `Card`, `PageHeader`, `StatusBadge`, `Alert`, `FormField`, `TextInput`, `Checkbox`, `Button`, `Dialog`, and protected-file primitives are reused. A tiny Buyer-only journey component may remove repeated markup; no generic abstraction or new design package is justified.

## 3. Reservation and Instruction

Reservation list cards emphasize product, textual status, applicable time, and one navigation affordance. Reservation detail emphasizes the real status and product snapshot, then the actual next action: view instruction only when `APPROVED`, cancel only when `can_cancel=true`. Cancellation remains secondary/dangerous and keeps the existing confirmation/version/idempotency behavior.

Instruction remains state-first. Terminal/unpublished states receive clear status surfaces and no content or submit action. ACTIVE content emphasizes product/store, current public notes, applicable deadline, image/file controls, and the existing order-material action only when returned booleans allow it. No schedule, rank, expected order date, or additional action is invented.

## 4. Order Materials and Formal Orders

The order-material list visually separates actionable eligible reservations from submitted history. The new form uses a short staged presentation—订单信息, 一张截图, optional note, submit—without changing fields, native input behavior, upload lifecycle, or command body. Detail emphasizes status/change request/price mismatch first, then immutable submitted facts, protected files, allowed resubmit, and subordinate withdraw.

Formal-order list/detail remain read-only. Filters use the existing native fields and exact API parameters. Detail distinguishes platform order facts, Buyer amount facts, and evidence summary without recomputation or exposing internal fields. The immutable `cny_per_jpy_e8` snapshot remains the source fact, but the Buyer formatter uses string/BigInt division by `100_000_000` to display `1 JPY = X CNY`; the internal `e8` label and scaled integer are not rendered. `amazon_order_date` remains date-only; epoch timestamps continue through the Beijing-time formatter.

## 5. Reviews and Refunds

Review list separates eligible actions from submitted history. New/resubmit forms retain one-to-three verified files, exact review type, nullable URL, optional note, current version, and idempotency behavior. Review detail emphasizes textual status and public change reason; an approved review may display the returned `buyer_refund_due` only as `返款金额`.

Refund list/detail are read-only. Buyer-visible terminology is consistently `返款金额`, and the amount represents only the returned商品本金 obligation. Due/net paid/remaining/overpaid and every payment/reversal activity remain visible exactly as returned. The list has no single journey completion state because its records may be mixed; detail highlights `完成` only when the returned status is exactly PAID. DUE, PARTIALLY_PAID, and OVERPAID do not project completion. No payment button, transfer claim, first/last payment summary, or internal update-time field is introduced.

## 6. Me, Password, and Registration

Me is a concise account hub with the published display name, Marketplace, identity-review state, real links, and logout. It does not reintroduce customer number or Session expiry. Change-password stays inside the Buyer shell and preserves forced-password behavior, cleanup recovery, exact fields, and controller flow while matching Buyer card/action hierarchy.

Invitation registration remains direct-link only. Its existing invitation context, fields, safe failures, Session reread, mismatch cleanup, and backend authority remain unchanged. Visual treatment aligns with the Buyer login without adding discovery links, identity switching, marketing copy, or fake verification.

## 7. Chinese, Time, Money, and Status

All user-facing labels added or touched by this Change are Chinese. Existing enums are mapped with existing Buyer label helpers where a Chinese label exists; any new presentation mapping is a static display-only mapping over an already returned value. Epoch times remain `Asia/Shanghai` and visibly include `北京时间`; platform date-only and server business-date facts remain distinct. JPY, CNY, and exchange-rate formatting continues through integer-safe existing helpers without floating point. Refund-facing copy uses `返款金额` and never expands the obligation beyond returned product principal facts.

## 8. Responsive and Accessibility Model

The acceptance matrix is 320x800, 390x844, 768x1024, 1440x900, and 1600x1000. Mobile is single-column with 44px targets, generous but bounded whitespace, break-safe identifiers, and fixed-navigation safe padding. Wide screens may use bounded two-column summary/supporting layouts while preserving source and focus order.

At 200% root text size, all representative list/detail/form/account routes reflow without document-level horizontal overflow or clipped primary controls. Keyboard focus remains visible and above fixed navigation. State and urgency are never color-only. The existing `prefers-reduced-motion` rule remains authoritative. Contrast is verified on text, muted text, status, borders, focus, and primary controls.

## 9. Deterministic Evidence

A dedicated remaining-pages Playwright fixture uses only Contract-valid existing endpoint shapes with fixed UTC timestamps, `zh-CN`, `Asia/Shanghai`, light color scheme, reduced motion, deterministic viewport, and stable filenames. Before/after screenshots cover representative reservation, instruction, order-material list/form/detail, formal-order list/detail, review list/form/detail, refund list/detail, Me, change-password, and registration surfaces across the five widths. The evidence record lists every captured image and its self-review result.

DOM assertions independently verify Chinese labels, `返款金额`, safe dates/amounts/statuses, one dominant action, exact five-item navigation, 44px targets, keyboard focus, reduced motion, 200% reflow, forbidden disclosure absence, and no horizontal overflow. Visual evidence never replaces functional/browser security gates.

## 10. Performance and Isolation

No runtime dependency is added. The existing entry → Buyer route → Buyer order/after-sales route boundaries remain. Cold product routes SHALL not preload order or after-sales chunks; cold order routes SHALL not preload after-sales, Seller, or Staff chunks; cold after-sales routes SHALL not preload order, Seller, or Staff chunks unless an existing shared entry already requires a non-business primitive. Before/after production builds record raw/gzip entry, CSS, Buyer route, Buyer order route, Buyer after-sales route, and every JavaScript chunk at or above the 500 kB gate.

## 11. Rejected Alternatives

- A second design system or broad primitive rewrite: rejected because existing tokens and primitives cover the Change.
- A new UI/component/form framework: rejected because it adds bundle and ownership cost without business value.
- One giant Buyer workflow page: rejected because real routes, direct links, focus, and lazy-loading boundaries must remain.
- Client-derived next state, schedule, amount, permission, or progress: rejected because server DTOs/actions are authoritative.
- Hiding raw facts to simplify the page: rejected where financial, reversal, permission, or recovery facts are required.
- Redesigning Seller/Staff simultaneously: rejected by scope and persona governance.

## 12. Verification and Rollback

Implementation uses focused Web typecheck/build, targeted Vitest/MSW, and the dedicated screenshot/browser fixture during development. After all pages and final screenshots are complete, it runs target/all strict OpenSpec, the full Web/repository checks, full browser gate, dependency-risk verifier, secret scan, `git diff --check`, import/chunk review, and Git scope review once. If a final gate fails, only the affected path is repaired before one final complete confirmation. Rollback is presentation/test-only.
