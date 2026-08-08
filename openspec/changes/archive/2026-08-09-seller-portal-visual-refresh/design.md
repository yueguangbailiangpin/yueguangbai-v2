# Design: Seller Portal Visual Refresh

## 1. Authority and Baseline

The implementation baseline is `origin/main` `e9c76e14eee681f94d80b03b7d02344f1a40d94e`. Business truth comes from the existing Seller runtime schemas, DTOs, server-projected access flags/actions, Customer Session boundary, organization/store authorization, mutations, protected-file controllers, and archived Seller business Changes. The supplied Seller direction governs relative density, context visibility, navigation, restrained green accent, and desktop efficiency only; its depicted fields, filters, amounts, statuses, dates, actions, permissions, and controls are not business authority.

The reproducible build environment is Node `v24.18.1`, npm `11.16.0`, and lockfile SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`. Before implementation, exact `gzip -9` evidence is: initial entry 245,642 raw / 74,310 gzip bytes; CSS 59,641 / 10,781; Seller route 33,697 / 9,060. These values remain the comparison baseline even when output hashes change.

`apps/web/src/styles/tokens.css` remains the only design-token truth. `global.css` may compose those variables through Seller-only selectors; it SHALL NOT introduce a competing palette, spacing scale, typography scale, shadow system, persona theme, framework, font, blur/glass treatment, or runtime dependency.

## 2. Seller Shell and Context

Wide layouts use one semantic Seller shell: a left navigation rail, a compact top context bar, and a bounded high-density content region. The rail contains the existing seven routes only. The context bar uses the returned organization name/code, returned member display name/role, and the existing authorized Store selector; Marketplace/currency labels are derived only from the selected returned Store. No client selection becomes authorization, and selecting “全部授权店铺” remains the existing explicit all-authorized-store query scope.

At narrow widths the rail is removed from layout and the existing seven real routes remain keyboard/touch reachable through a compact fixed navigation. The context reflows above content, all labels wrap safely, and safe bottom padding prevents focus/content obstruction. Route ownership, `aria-current`, deep links, and `CustomerSessionBoundary` remain unchanged.

## 3. Dashboard and Primary Entry

The dashboard keeps the existing order/completion/settlement queries and server-derived values. It presents organization/store context, a compact metric row, and a clear work summary. The existing `提交需求` action is the dominant business entry only when `me.access.can_submit_demand_batches` is true. `提交产品申请` remains a nearby secondary entry only when its existing access flag is true. Unauthorized actions are absent rather than cosmetically disabled.

No status, count, monthly amount, pending task, schedule, filter, or table row is synthesized from the reference. Empty/loading/error states use the existing accessible primitives and remain explicit.

## 4. Catalog, Demand, Order, Review, and Settlement Presentation

Products and applications share one real page but remain distinguishable record types. Demand batches, reviews, formal orders, and payables retain their existing returned collections, statuses, actions, and cursor-bound API requests. Dense desktop surfaces may use semantic tables or compact record rows; mobile surfaces reflow to labeled cards in the same source order. Display-only columns/facts are limited to existing DTO fields.

Product/applications retain Store, product name, platform identifier, status, review reason, application detail route, and allowed withdrawal. Demands retain product, Store, target/held/approved/remaining quantity, task type, returned times, status/reason, and allowed withdrawal. Reviews retain product, Store, review type, submitted/approved times, safe evidence count, service fee accrual when returned, and status without adding Seller file-read authority. Formal orders retain platform identifier, Store, transaction money, Seller principal, Seller service fee, read-only rate/fee snapshots, confirmed Beijing time/business date, and four server-derived completion components. Settlement keeps Seller principal and Seller service fee separate and shows only returned due/paid/outstanding/status facts; no proof, payment, export, or confirmation action is added.

All touched statuses/task types/roles/Marketplace labels are Chinese display-only mappings over returned enums. Unknown values continue to fail runtime validation rather than receive a fabricated label.

## 5. Submission Forms, Account, Login, and Forced Password

Product application and demand submission remain separate forms with their exact existing fields, native controls, upload lifecycle, request bodies, idempotency authority, and recovery behavior. Presentation groups fields for scanning and keeps one dominant submit action. It does not remove required explanations that prevent data loss or clarify immutable history, but avoids internal implementation language.

Seller login keeps only 月光白、账号、密码、登录 plus necessary safe validation/loading/request-ID/cleanup-recovery feedback. It remains path-bound and provides no identity selector or adjacent-persona link. Seller account retains only real actions. Seller forced-password presentation may adopt Seller visual classes but keeps the exact controller, fields, cancellation, mismatch cleanup, Session reread, and recovery flow.

## 6. Chinese, Time, Money, and Copy

All user-facing labels added or touched are Chinese. Epoch timestamps use the existing `Asia/Shanghai` formatter and visibly include `北京时间`; server business-date facts remain date-only. JPY/USD/KRW/CNY and exchange-rate facts use integer/string/BigInt-safe existing helpers and never `parseFloat` or `toFixed` for financial meaning.

The frozen internal copy is absent: duplicate “卖家工作台/卖家首页/卖家” headings, disabled Korea capability notices, server-business-fact explanations, and Staff-controlled settlement explanations. Required business names including 卖家本金 and 卖家服务费 remain. User-recovery and immutable-history explanations remain where removing them would weaken correctness.

## 7. Responsive and Accessibility Model

The acceptance matrix is 320x800, 390x844, 768x1024, 1440x900, and 1600x1000. Mobile uses single-column labeled records, 44px targets, break-safe identifiers, compact context, and fixed-navigation clearance. Desktop prioritizes high information density with bounded line lengths and stable sidebar/context ownership.

At 200% root text size, representative list/detail/form/account routes reflow without document-level horizontal overflow or clipped primary controls. Keyboard focus stays visible and unobscured. Tables preserve captions/headers and have an accessible narrow-screen alternative. State and urgency are not color-only. The existing `prefers-reduced-motion` rule remains authoritative. Contrast is verified on text, muted text, status, borders, focus, and primary actions.

## 8. Deterministic Evidence

A dedicated Seller Playwright fixture uses only Contract-valid existing endpoint shapes with fixed UTC timestamps, `zh-CN`, `Asia/Shanghai`, light color scheme, reduced motion, deterministic viewports, and stable filenames. Before/after screenshots cover login, dashboard, products/applications, application form/detail, demand list/form, formal orders, reviews, settlements, account, and forced-password surfaces. Every representative surface is captured at 390x844 and 1440x900; selected dense/form/context surfaces also cover 320, 768, and 1600.

DOM assertions independently verify Chinese labels, Beijing times, integer-safe amounts, permission-projected entry visibility, exact navigation routes, organization/store context, forbidden-copy/data absence, 44px targets, keyboard focus, 200% reflow, reduced motion, and no horizontal overflow. Existing repository security/browser gates remain the authority for Customer session invalidation, forced password, Personal DENY, cache isolation, and protected file flows.

## 9. Performance and Isolation

No runtime dependency is added. Existing entry → Seller route lazy loading remains. A cold Seller route SHALL not preload Buyer or Staff business route chunks. Before/after production builds record raw/gzip entry, CSS, Seller route, and every JavaScript chunk at or above the 500 kB gate. Seller visual code stays in the Seller route chunk or existing safe shared presentation code and does not import Buyer/Staff business pages.

## 10. Rejected Alternatives

- A second design system or token file: rejected because existing tokens and primitives cover the Change.
- A UI/table/form framework: rejected because it adds bundle and ownership cost without business value.
- Client-derived dashboard facts, filters, workflow status, or finance: rejected because server DTOs/actions are authoritative.
- A Seller financial export/payment control: rejected because it requires a separate Contract, Permission, and OpenSpec Change.
- Enabling Korea or copying the reference's unsupported controls: rejected because capability/behavior is not authorized.
- Simultaneous Buyer/Staff restyling: rejected by sole-writer scope and persona isolation.

## 11. Verification and Rollback

Implementation uses focused Web typecheck/build, targeted Seller browser checks, and screenshot generation during development. After all pages and screenshots are complete, it runs target/all strict OpenSpec validation, implementation-consistency review, full repository check, full browser gate, dependency-risk verification, secret scan, `git diff --check`, import/chunk review, and Git scope review once. A failed final gate receives a scoped repair and targeted rerun; another full confirmation runs only when needed to establish the final report. Rollback is presentation/test/evidence-only.
