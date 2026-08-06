# Buyer Visual Direction

## Quiet Operations for Buyer

The Buyer experience remains 月光白: calm, light, trustworthy, direct, and Chinese-language. Brand blue is the primary action color and Buyer blue is the auxiliary identity color. The UI uses the existing semantic tokens, primitives, typography, focus, status, and spacing foundation.

## Mobile information hierarchy

1. Page title and current business object.
2. Current textual status and next step.
3. Applicable deadline with explicit label.
4. Amounts with adjacent JPY/CNY/basis-point units.
5. One dominant primary action.
6. Secondary history/details and contextual destinations.

At 390px the layout is a single focused column. At 320px and 200% zoom, cards and fields reflow; no page-wide horizontal scroll is permitted. Fixed bottom navigation reserves safe-area/content padding.

## Journey patterns

- Dashboard: prioritized task list, not metrics or totals.
- Demand detail: product/store/task, amount breakdown, prominent unchecked self-pay confirmation, one reserve action.
- Reservation/instruction: status and dates before instructions; main image then ordered keyword images; expired state removes action.
- Evidence/review forms: step sequence of context → files → fields → confirmation/submit; upload progress is real.
- Detail/status pages: server facts first, public reason and allowed action next, history after.
- Refunds: due/paid/remaining/overpaid plus complete payment/reversal activity; no payment button.
- Me: compact account facts and supported destinations, not a settings dashboard.

## Content rules

- Use 月光白 only; no English product brand and no customer-facing V2.
- State names have clear Chinese labels and never rely on color alone.
- PRICE_MISMATCH text is `实际支付金额与参考金额不一致`.
- Initial and change deadlines are explicitly `初始提交期限` and `修改资料期限`.
- Long Amazon order numbers are copyable and wrap with stable digit grouping.
- Error states include safe request ID and a bounded recovery action.
- Skeletons reserve structure and do not flash false “empty,” “expired,” or “success.”

## Prohibited presentation

No fake data/statistics, dashboard metric wall, desktop admin page shrunk to mobile, large gradients, heavy shadows, glass effects, status-only color, permanent image URLs, raw object IDs as customer labels, competing primary buttons, or hidden reversal/overpaid facts.
