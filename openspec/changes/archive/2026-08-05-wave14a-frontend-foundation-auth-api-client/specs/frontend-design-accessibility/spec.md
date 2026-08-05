# Frontend Design and Accessibility Capability

## ADDED Requirements

### Requirement: Quiet Operations tokens unify the light product

The frontend SHALL implement the documented semantic canvas/surface/border/text/brand/identity/status, shadow, radius, spacing, font, line-height, and z-index tokens. Brand blue SHALL be the universal primary action; Buyer blue, Seller green, and Staff purple SHALL remain sparse identity accents. First release SHALL be light-only.

#### Scenario: Shared component in three shells

- **WHEN** the same Button, state, or surface renders for Buyer, Seller, and Staff
- **THEN** structure/brand/status styling remains shared while only approved identity accents differ.

#### Scenario: Prohibited theme or visual style

- **WHEN** UI introduces dark mode, glass/neon/large gradients, solid-color sidebar, heavy card shadows, marketing illustration, generic admin skin, or crowded ERP styling
- **THEN** visual review fails until it conforms to Quiet Operations.

### Requirement: Shared primitives have complete accessible state contracts

Wave 14A SHALL provide the planned shell/navigation, input/form, content/data, overlay/navigation, feedback, and state primitives with consistent labels, disabled/busy/error behavior, focus style, token usage, and accessible names. Status SHALL not rely on color alone; icon-only controls SHALL have names.

#### Scenario: Primitive normal and async states

- **WHEN** a user operates a Button, field, table/navigation control, or feedback state
- **THEN** semantic role/name/state and visible text/icon cues expose normal, hover/focus, disabled, loading, success, and error behavior as applicable.

#### Scenario: Missing label or color-only state

- **WHEN** a control lacks an accessible label/error relation or a status is conveyed only by color/icon shape
- **THEN** component accessibility tests fail.

### Requirement: Keyboard, focus, and overlay behavior are complete

All interactive behavior SHALL be keyboard-operable with visible focus. Dialog and Drawer SHALL manage initial focus, trap focus while modal, support documented Escape/close behavior, make background content unavailable, and restore focus to the invoker. Radix MAY be used only for primitives requiring this behavior.

#### Scenario: Keyboard overlay lifecycle

- **WHEN** a keyboard user opens, navigates, and closes a Dialog/Drawer
- **THEN** focus stays within the overlay in logical order and returns to the original control on close.

#### Scenario: Focus loss or hidden background access

- **WHEN** route/data change removes the focused item, the overlay closes, or assistive technology can reach modal background
- **THEN** focus moves to the documented safe target and tests fail if it disappears, traps incorrectly, or escapes to inert content.

### Requirement: Responsive and reduced-motion behavior preserves all operations

The UI SHALL remain usable at 320px and 200% zoom, SHALL reserve space for fixed navigation, SHALL preserve logical reading/action order as Seller/Staff layouts collapse, SHALL provide reasonable target sizes, and SHALL honor `prefers-reduced-motion` for nonessential animation.

#### Scenario: Narrow or zoomed layout

- **WHEN** a user uses 320px width or 200% zoom
- **THEN** every essential control/content state remains reachable without overlapping fixed regions or requiring two-dimensional page scrolling for ordinary operation.

#### Scenario: Motion or density obstruction

- **WHEN** reduced motion is requested or dense content causes clipped controls/reordered meaning
- **THEN** nonessential motion is removed and responsive fallback preserves content, focus, and operation sequence.

### Requirement: Content semantics and system states support assistive technology

Pages SHALL use semantic HTML/landmarks/headings; fields SHALL link labels, help, and errors; tables SHALL have captions and header relationships; images SHALL follow meaningful/decorative alt rules; and loading/progress/result changes SHALL use appropriate screen-reader announcements. Loading, Empty, Error, 403, 404, DependencyUnavailable, Skeleton, and request ID states SHALL be available even in dense Staff views.

#### Scenario: Complete page/state semantics

- **WHEN** assistive technology navigates a page or an asynchronous state changes
- **THEN** structure, table relations, labels, progress/result announcements, and request ID support are perceivable without visual inference.

#### Scenario: Missing or noisy semantics

- **WHEN** headings/landmarks/table headers/alt text are absent, errors are unassociated, or live regions announce excessive/incorrect updates
- **THEN** accessibility review/tests fail until the information is accurate and usable.
