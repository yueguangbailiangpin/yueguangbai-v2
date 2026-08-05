# Buyer Mobile and Accessibility Capability

## ADDED Requirements

### Requirement: Buyer layouts are mobile-first and task-focused
Buyer pages SHALL optimize the primary acceptance width of 390px, support 320px, and present one dominant task per screen. Desktop widths MAY increase whitespace or columns only when reading and action order remain unchanged.

#### Scenario: Buyer uses a 390px viewport
- **WHEN** any primary Buyer journey is opened
- **THEN** its next action, status, deadline, and amount units are immediately understandable without horizontal scrolling.

#### Scenario: Viewport narrows to 320px or zooms to 200 percent
- **WHEN** content reflows under the minimum width or text zoom
- **THEN** controls, long values, images, and bottom navigation remain reachable and no content is obscured.

### Requirement: Status and urgency use more than color
Every reservation, instruction, evidence, review, refund, error, and deadline state SHALL use visible text and, where helpful, an icon or explanation in addition to semantic color. PRICE_MISMATCH SHALL use warning semantics, not failure semantics.

#### Scenario: Status is visually presented
- **WHEN** a workflow card or detail renders
- **THEN** a textual status and relevant next-step explanation accompany its color.

#### Scenario: Color perception or high zoom removes visual distinction
- **WHEN** color alone cannot be perceived
- **THEN** state, urgency, and action remain fully understandable from text and semantics.

### Requirement: Forms and confirmations are keyboard and touch accessible
Inputs SHALL have programmatic labels, descriptions, errors, required state, 44px minimum interactive targets, logical focus order, visible focus, busy state, and error summary/focus behavior. Rule confirmations SHALL use real unchecked checkboxes rather than button wording.

#### Scenario: Buyer completes a form by keyboard or touch
- **WHEN** the user moves through registration, reservation, evidence, or review forms
- **THEN** every control and confirmation is operable with clear focus and no concurrent submission.

#### Scenario: Validation or mutation error occurs
- **WHEN** a field, file, version, or server validation fails
- **THEN** focus and accessible descriptions identify the safe problem without clearing unrelated input or exposing raw diagnostics.

### Requirement: Long values, dates, money, and images remain usable
Amazon order numbers SHALL be copyable and wrap without breaking layout; dates SHALL name `Asia/Shanghai` meaning where ambiguity matters; JPY and CNY units SHALL be adjacent to values; images SHALL have useful alternative text and bounded viewers without exposing URLs.

#### Scenario: Buyer inspects a long or visual fact
- **WHEN** an order number, deadline, amount, or evidence image is displayed
- **THEN** it remains readable/copyable and its semantic unit or alternative text is available.

#### Scenario: Image fails or value overflows
- **WHEN** read intent/content fails or text exceeds the expected width
- **THEN** a safe fallback preserves context without leaking the URL or forcing horizontal page scroll.

### Requirement: Motion, loading, and errors are safe
Buyer UI SHALL respect `prefers-reduced-motion`, use skeletons that do not flash false empty/error/business states, maintain focus through route/loading transitions, and display sanitized request IDs for recoverable API failures.

#### Scenario: Data loads normally
- **WHEN** a route is resolving
- **THEN** reserved layout and accessible loading text appear until validated content replaces them.

#### Scenario: Reduced motion or dependency error applies
- **WHEN** reduced motion is requested or an API fails
- **THEN** nonessential motion is removed and a stable safe recovery state with request ID appears without stale protected content.
