# Buyer Route Map

| Frontend route | Purpose | Primary API source | Bottom owner |
|---|---|---|---|
| `/` | Exact dedicated-link notice | none | none |
| `/buyer/login` | Existing Buyer login | Customer Auth login/session | none |
| `/buyer/register` | Direct-link Buyer self-registration | Buyer registration | none |
| `/buyer/change-password` | Existing Customer password change | Customer Auth | 我的 |
| `/buyer` | Bounded next-step dashboard | Multiple Buyer preview queries | 首页 |
| `/buyer/tasks` | Public demand list and reservation entry | demands | 任务 |
| `/buyer/tasks/:demandId` | Demand detail/self-pay acceptance | demand detail/create reservation | 任务 |
| `/buyer/reservations` | Reservation history | reservations | 任务 |
| `/buyer/reservations/:reservationId` | Reservation and instruction entry | reservation + instruction state/content | 任务 |
| `/buyer/order-materials` | Evidence list and eligible reservations | evidence list/eligibility | 订单资料 |
| `/buyer/order-materials/new?reservation_id=<id>` | Initial evidence form with authoritative source ID | evidence eligibility/state + create + file upload | 订单资料 |
| `/buyer/order-materials/:submissionId` | Evidence detail/resubmit/withdraw | evidence detail/mutations | 订单资料 |
| `/buyer/orders` | Formal-order list/filter | formal orders | 我的 |
| `/buyer/orders/:formalOrderId` | Formal-order detail | formal-order detail | 我的 |
| `/buyer/reviews` | Reviews and eligible orders | review list/eligibility | 评论 |
| `/buyer/reviews/new?formal_order_id=<id>` | Initial review form with authoritative source ID | review eligibility + create + file upload | 评论 |
| `/buyer/reviews/:reviewCaseId` | Review detail/resubmit/withdraw/files | review detail/mutations/read | 评论 |
| `/buyer/refunds` | Refund list | refunds | 我的 |
| `/buyer/refunds/:refundId` | Refund detail/activity | refund detail | 我的 |
| `/buyer/me` | Profile/account destinations/logout | me + Customer Auth logout | 我的 |

## Navigation decisions

- Five primary navigation items remain exactly 首页、任务、订单资料、评论、我的.
- Formal orders and refunds are account/business-history destinations under 我的; they are not extra bottom items.
- Reservation history is a contextual child of 任务.
- Order-instruction content remains inside reservation detail; it does not add a primary route.
- New-form authority comes only from required query identifiers: `reservation_id` for order materials and `formal_order_id` for reviews. Each must be 1–120 safe identifier characters before any API use.
- Every load, refresh, and direct deep link rereads eligibility. Navigation state is only a non-authoritative display hint; Session storage never restores a source ID.
- Missing/invalid identifiers return to the safe owning list or authenticated NotFound. A stale/ineligible identifier never displays a submit form.
- Unknown `/buyer/**` remains an authenticated Buyer NotFound. A 403/404 business response retains the shell and Session.
