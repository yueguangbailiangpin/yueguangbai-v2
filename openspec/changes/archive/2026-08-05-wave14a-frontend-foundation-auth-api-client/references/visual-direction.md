# Visual Direction: Quiet Operations

## Brand

The formal displayed product name is **月光白**. Customer and Staff interfaces do not display an English product name or `V2`. Internal code, repository identifiers, and version management may retain existing identifiers.

The visual direction is **Quiet Operations**: calm, trustworthy, clear, professional, low-distraction, efficient, light operational SaaS. All three identity areas share typography, spacing, controls, status semantics, content surfaces, and primary brand blue.

## Theme and Identity

The first release implements a light theme only. Semantic token names preserve a future theme layer, but Wave 14A has no dark palette, theme switch, or persistence.

- Universal primary action: brand blue.
- Buyer identity accent: blue.
- Seller identity accent: green.
- Staff identity accent: purple.

Identity colors are limited to shell accents, local icons, current navigation, and sparse emphasis. They do not replace the universal primary button and do not make the three areas look like separate products.

## Candidate Semantic Color Tokens

These values are implementation candidates, not immutable brand Hex values. Text/control pairings must pass automated and manual WCAG contrast checks before acceptance; values change if contrast fails.

| Token | Light candidate | Intended use |
|---|---:|---|
| `color.canvas` | `#F6F7F9` | App background |
| `color.surface` | `#FFFFFF` | Primary surface |
| `color.surface.subtle` | `#F0F3F7` | Quiet grouped surface |
| `color.border` | `#DCE2EA` | Default separation |
| `color.border.strong` | `#B8C2D0` | Active/structural border |
| `color.text` | `#172033` | Primary text |
| `color.text.muted` | `#526176` | Secondary text |
| `color.text.disabled` | `#7D8999` | Disabled text with non-color cues |
| `color.text.inverse` | `#FFFFFF` | Text on strong controls |
| `color.brand` | `#2457D6` | Primary action |
| `color.brand.hover` | `#1D49B7` | Primary hover |
| `color.brand.active` | `#173B96` | Primary active |
| `color.brand.soft` | `#EAF0FF` | Quiet brand surface |
| `color.identity.buyer` | `#2B63D9` | Buyer accent |
| `color.identity.buyer.soft` | `#EAF1FF` | Buyer soft accent |
| `color.identity.seller` | `#237A57` | Seller accent |
| `color.identity.seller.soft` | `#E8F5EF` | Seller soft accent |
| `color.identity.staff` | `#7150B7` | Staff accent |
| `color.identity.staff.soft` | `#F0EBFA` | Staff soft accent |
| `color.status.pending` | `#6B7280` | Pending |
| `color.status.processing` | `#2563B9` | Processing |
| `color.status.success` | `#217A4A` | Success |
| `color.status.warning` | `#9A5B00` | Warning |
| `color.status.danger` | `#B4232D` | Danger |
| `color.status.expired` | `#6B566D` | Expired |
| `color.status.conflict` | `#A04416` | Conflict |

Status tokens define foreground, soft background, border, and icon combinations during implementation. Status never relies on hue alone: label text and/or icon are mandatory.

## Token Architecture

CSS custom properties are the semantic source and Tailwind maps utilities/components to them. Components consume `color.*`, not raw palette utilities. Planned groups are:

- `color.canvas`, `color.surface`, `color.surface.subtle`, `color.border`, `color.border.strong`;
- `color.text`, `color.text.muted`, `color.text.disabled`, `color.text.inverse`;
- `color.brand`, `color.brand.hover`, `color.brand.active`, `color.brand.soft`;
- `color.identity.buyer|seller|staff` and `.soft`;
- `color.status.pending|processing|success|warning|danger|expired|conflict`;
- `shadow.overlay`, `shadow.drawer`, `shadow.dialog`;
- `radius.control`, `radius.card`, `radius.panel`, `radius.pill`;
- `space.0` through a documented compact/comfortable scale;
- `font.family.sans`, `font.size.*`, `font.weight.*`;
- `line-height.*` for labels, body, headings, and dense tables;
- `z-index.base`, `sticky`, `navigation`, `drawer`, `dialog`, `toast`.

Implementation exposes CSS names such as `--color-canvas` while design documentation retains dot notation. Identity scopes override only identity accent variables; brand and statuses stay shared.

## Shape, Border, and Shadow

- Controls: compact radius, candidate 8px.
- Cards: candidate 12px.
- Structural panels/drawers: candidate 14px; nested surfaces avoid repeated rounding.
- Pills/status badges: full pill radius.
- Borders provide most surface separation; large areas do not depend on shadows.
- `shadow.overlay` is subtle, `shadow.drawer` separates the side plane, and `shadow.dialog` is strongest but restrained.
- Repeated data cards do not each receive heavy shadow. Dense Staff panes rely on border and surface tone.

## Typography

Use a Chinese-capable system sans stack for predictable loading. Candidate hierarchy:

- Page title: 28/36 desktop, 24/32 compact, strong weight.
- Section title: 20/28.
- Card/panel title: 16/24, semibold.
- Body: 14/22 default; Buyer primary task copy may use 16/26.
- Dense table/meta: 13/20 minimum when space requires; never shrink critical content to solve density.
- Labels/badges: 12/18 with sufficient weight and spacing.

Hierarchy comes from size, weight, spacing, and structure—not low-contrast gray alone.

## Buyer Direction

Buyer is mobile-first with lightweight cards and one dominant next action per screen. Current stage, next step, and deadline are visually primary. A step/progress treatment supports task comprehension. The five fixed bottom items are 首页、任务、订单资料、评论、我的. No persistent desktop sidebar exists. Content includes bottom safe-area/padding so navigation never overlaps it. Upload experiences in later waves inherit progress, cancel, recoverable failure, and retry states from the Wave 14A file client.

## Seller Direction

Seller is desktop-first at medium density: left navigation, top organization/store switch context, page title and primary action, metrics, search/filter bar, and formal data tables. Selecting a row opens a right detail drawer without losing filters, pagination, or scroll. Complex editing goes to an independent detail page. At small widths, tables become accessible cards or an independent detail route; information is not hidden solely to preserve desktop layout.

## Staff Direction

Staff is a desktop high-density workbench: left pending queue, center detail, right review actions. Selection and completed actions preserve queue filter/position. Internal notes are structurally separated from customer-visible content. Financial actions are structurally and visually separated from ordinary review actions. Small screens degrade to queue → detail → review drawer. Staff is not rendered as a wall of ordinary marketing cards.

## Shared Component Direction

Wave 14A plans: AppShell, IdentityShell, PageHeader, Sidebar, BottomNavigation, StatusBadge, Button, IconButton, TextInput, Select, SearchInput, Checkbox, FormField, Card, MetricCard, DataTable base container, Drawer, Dialog, Tabs, Pagination, Breadcrumb, Timeline, Progress, Alert, Toast, EmptyState, LoadingState, ErrorState, PermissionDenied, NotFound, DependencyUnavailable, RequestIdDisplay, and Skeleton.

Controls share height, typography, focus ring, disabled behavior, and feedback timing. Destructive actions are not styled like primary navigation. Toasts supplement, never replace, inline durable error/status content.

## Responsive Rules

- Minimum supported width: 320px with no essential horizontal clipping.
- Buyer: one column by default; wider layouts increase whitespace/content width but keep task focus.
- Seller: desktop sidebar/table/drawer; collapse navigation and use card/detail fallback below documented breakpoints.
- Staff: three panes when adequate; two/one-step navigation when width cannot preserve readable panes.
- 200% zoom must preserve operation order and access to every action.
- Sticky/fixed regions reserve layout space and respect safe-area insets.

## Accessibility

Use semantic landmarks/headings, logical DOM/reading order, keyboard-complete operation, visible high-contrast focus, labeled controls, described errors, focus trap/return for Dialog/Drawer, screen-reader live regions for loading/progress/results, table captions and header associations, alternative text rules, suitable target sizes, and `prefers-reduced-motion`. Loading, empty, error, permission denied, not found, dependency unavailable, and request ID states are first-class visuals. Dense Staff content remains navigable by landmarks, headings, tables/lists, and focus order.

## Prohibited Visual Styles

- Glass effects, neon effects, and large gradients.
- Default generic admin-template appearance or large solid-color sidebars.
- Heavy shadow on every card.
- Marketing-site hero illustrations.
- Crowded legacy ERP presentation.
- Showy animation; motion is short, functional, and reducible.
- Dark mode or a theme switcher in Wave 14A.
- Customer-facing English product branding or `V2`.

Root is a quiet dedicated-link notice, not an identity selector or login surface.

## Final Implemented Tokens and Contrast

Wave 14A final polish retains the candidate canvas, surface, primary text,
brand, Buyer, Seller, and Staff colors. The following candidates were adjusted
before acceptance so every foreground pairing used for text, controls, focus,
and status labels reaches at least WCAG AA normal-text contrast:

| Token | Final value | Adjustment reason |
|---|---:|---|
| `color.text.disabled` | `#687588` | Darkened from `#7D8999`; final white-surface contrast is 4.68:1 while disabled controls also retain opacity, cursor, and native disabled semantics. |
| `color.border.strong` | `#AEB9C8` | Increased structural separation for inputs and dense panes without using shadow. |
| `color.focus` | `#1745B5` | Dedicated focus color provides 8.22:1 against white and remains visibly distinct from borders. |
| `color.status.processing` | `#245AAB` | Final foreground on `#EAF2FF` reaches 5.96:1. |
| `color.status.warning` | `#8A5200` | Darkened from `#9A5B00`; final foreground on `#FFF3D6` reaches 5.79:1. |
| `color.status.danger` | `#AD202B` | Final foreground on `#FFF0F1` reaches 6.29:1. |
| `color.status.conflict` | `#9A3E13` | Darkened from the candidate for stable normal-text contrast on the conflict surface. |

Automated relative-luminance checks produced: primary text 16.27:1 on white,
secondary text 6.31:1 on white and 5.88:1 on canvas, inverse button text
6.16:1 on brand blue, focus 8.22:1 on white, success 4.73:1, warning
5.79:1, danger 6.29:1, processing 5.96:1, Seller 4.69:1, and Staff
5.09:1 on their respective soft surfaces. Statuses also include visible label
text, border, and dot/icon treatment and therefore never rely on color alone.
