# frontend-route-performance Specification

## Purpose
TBD - created by archiving change frontend-route-code-splitting-performance. Update Purpose after archive.
## Requirements
### Requirement: Identity portals load independently
The web application SHALL load Buyer, Seller and Staff business pages through independent asynchronous route boundaries so that opening one identity entry does not require downloading the other identities' business page modules.

#### Scenario: Buyer opens the portal on a cold cache
- **WHEN** a Buyer visits `/buyer` or a Buyer deep link with an empty browser cache
- **THEN** the initial route loads without requiring Seller or Staff business page chunks.

#### Scenario: Staff opens the workbench on a cold cache
- **WHEN** an authorized Staff member visits `/staff` or a Staff deep link with an empty browser cache
- **THEN** Buyer and Seller customer page chunks are not prerequisites for rendering the authorized Staff route.

### Requirement: Page modules load on demand
Within each identity portal, page-level modules that are not required for the current route SHALL load on first navigation to that route, using boundaries chosen from measured bundle evidence rather than arbitrary micro-chunks.

#### Scenario: Buyer has not opened review or refund pages
- **WHEN** the Buyer first renders the product page
- **THEN** review and refund page modules are not required before the product page can render.

### Requirement: Lazy loading preserves authorization and privacy
Asynchronous loading SHALL preserve all session, forced-password, permission, Personal DENY, cache invalidation and identity-isolation behavior, and SHALL NOT render protected page content before the applicable authorization boundary succeeds.

#### Scenario: A stale Staff cache is followed by denial
- **WHEN** the Staff session becomes unauthorized while an asynchronous page chunk is loading
- **THEN** the protected page is not rendered, prior private cache is cleared as required, and the established Chinese denial or login state is shown.

#### Scenario: One customer identity opens the other portal
- **WHEN** a Buyer session opens a Seller route or a Seller session opens a Buyer route
- **THEN** no content from either identity cache is exposed during loading or redirect handling.

### Requirement: Loading and failure states are usable in Chinese
Every asynchronous identity or page boundary SHALL provide concise Chinese loading and recoverable failure states, including an accessible status and explicit retry where recovery is safe.

#### Scenario: A route chunk fails to download
- **WHEN** the browser cannot load an asynchronous route module
- **THEN** the user sees a Chinese failure state without a blank screen or infinite reload loop and can retry safely.

### Requirement: Deep links remain functional
Direct navigation and refresh SHALL continue to work for representative Buyer, Seller and Staff deep links after code splitting.

#### Scenario: An authenticated user refreshes a detail URL
- **WHEN** the browser starts directly on a supported nested route
- **THEN** the correct identity boundary and page chunk load without forcing a visit to the portal root.

### Requirement: Performance improvement is measured
The implementation SHALL record reproducible before-and-after production-build chunk sizes and cold-start browser measurements for representative Buyer, Seller and Staff routes using the same environment and declared method.

#### Scenario: The Change is proposed for acceptance
- **WHEN** Implementation Verify is run
- **THEN** evidence includes raw and gzip size per initial/dynamic chunk, cold-start transfer and visible/interactive timing, measurement conditions, at least three-run medians and any remaining budget exceptions.

### Requirement: Warning thresholds cannot substitute for optimization
The implementation SHALL NOT claim success solely by increasing or disabling the bundle warning threshold, disabling source maps or measuring warm-cache navigation.

#### Scenario: A chunk remains above 500 kB
- **WHEN** production build output contains any JavaScript chunk above the default 500 kB budget
- **THEN** the implementation further splits it or records dependency attribution, user impact and an explicit unresolved Production GO blocker.

### Requirement: The Change is isolated and schema-free
This performance Change SHALL begin only after M11–M16 are accepted on current main, SHALL remain separate from those feature scopes, and SHALL introduce no database schema or business-contract change.

#### Scenario: M11 through M16 are still in progress
- **WHEN** the implementation task would otherwise start
- **THEN** only this planning record remains open and no performance implementation is mixed into an active feature branch.
