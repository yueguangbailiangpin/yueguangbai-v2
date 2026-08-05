# Buyer Dashboard Task Priority Model

## Bounded source model

The backend has no dashboard endpoint and list responses have no totals. The dashboard therefore uses independently cached preview queries and never claims global completeness.

| Priority | Source | Selection based only on returned facts | Destination |
|---:|---|---|---|
| 1 | evidence list | status CHANGES_REQUESTED and RESUBMIT action | evidence detail |
| 2 | review list | status CHANGES_REQUESTED and RESUBMIT action | review detail |
| 3 | reservation page + per-item instruction state within a strict small bound | ACTIVE, relevant deadline present, server submit/read state | reservation detail |
| 4 | eligible evidence page | no current evidence, SUBMIT action | evidence new |
| 5 | eligible review page | no current review, SUBMIT action | review new |
| 6 | evidence/review list | pending status; informational, not executable | matching detail |
| 7 | refund page | returned DUE/PARTIALLY_PAID/OVERPAID item, ordered only by that item's `updated_at` where needed | refund detail |
| 8 | demand page | returned currently public demand | demand detail |

## Ordering and de-duplication

- A stable identity is `(domain, aggregate ID)`; the same object from eligibility and list sources appears once at its highest-priority representation.
- Within deadline-bearing groups, earliest applicable server deadline wins; ties use stable ID.
- Without a deadline, returned update/submit time may order newest status information, but it does not create urgency.
- The dashboard displays a short bounded number per group and a 查看全部 link.
- No metric card, total, “all caught up,” or global unread number is shown from a partial page.
- Refund preview never claims a new message, unread state, or detected status change because there is no last-seen/change cursor. PAID remains on the refund history page and is not a default high-priority dashboard task.

## Query limitations

- First-page evidence, review, eligibility, refund, and demand reads can build a useful preview.
- Finding all ACTIVE instructions requires mapping reservations to per-reservation state calls; implementation must cap this to a small returned subset and cancel stale requests.
- Later cursors are loaded only on their owning list pages, not swept by the dashboard.
- Partial source failure keeps other groups usable and presents one source-specific safe error/request ID.
- Freshness is navigation/focus plus precise mutation invalidation; no unbounded polling or synthetic real-time claim.

## Precise invalidation examples

- Reservation create/cancel: demand list/detail, reservation list/detail, dashboard, and affected instruction key.
- Evidence submit/resubmit/withdraw: eligibility, evidence list/detail, affected instruction state/content, affected reservation, dashboard.
- Review submit/resubmit/withdraw: eligible reviews, review list/detail, dashboard; approved review observations may make refund preview stale.
- Logout/real 401: existing shared Customer invalidation only.
- File upload/read alone: no global business invalidation; business command success owns later invalidation.
