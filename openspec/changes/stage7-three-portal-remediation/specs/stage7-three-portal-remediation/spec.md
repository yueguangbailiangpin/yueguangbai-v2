# stage7-three-portal-remediation Specification

## ADDED Requirements

### Requirement: Seller runtime schemas match the shared contracts

The Seller web runtime MUST parse the exact `SellerFormalOrderPortalDto` and `OrderCommunicationScreenshotReferenceDto` shapes published in `packages/contracts`. Each parsed `communication_screenshots` entry MUST carry `uploaded_at` (required epoch-millisecond integer), `uploaded_by_staff_id` (required, nullable), and `uploaded_by_staff_name` (optional, nullable). The runtime schemas MUST stay strict: fields the shared contracts do not publish (including `legacy_projection`, `canonical_marketplace_code`, and internal storage metadata such as `object_key`) MUST be rejected, and `.passthrough()` relaxation is forbidden.

#### Scenario: Real backend order list parses

- **WHEN** a seller formal-order list response produced by the real backend read-model (screenshots with `uploaded_at`, `uploaded_by_staff_id`, `uploaded_by_staff_name`) is validated with `sellerFormalOrdersSchema`
- **THEN** validation succeeds and each screenshot exposes the uploader identity fields.

#### Scenario: Internal field is rejected

- **WHEN** a screenshot entry carries an internal-only field such as `object_key` or `drive_file_id`
- **THEN** the strict schema rejects the response.

#### Scenario: Uploader name may be absent

- **WHEN** `uploaded_by_staff_name` is missing or `null` (uploading staff account no longer resolvable)
- **THEN** the schema still parses and the UI shows a neutral placeholder.

### Requirement: Seller order UI renders every communication screenshot

The Seller order pages MUST render the complete `communication_screenshots` array of each formal order. Every entry MUST provide its own view control bound to its own `file_object_id` and `file_version`, plus uploader name (neutral placeholder when unresolvable) and upload time. An empty array MUST show an explicit empty state. The concealed 404 boundary for other seller organizations and the SELLER_VISIBLE visibility rules MUST remain unchanged.

#### Scenario: Two screenshots produce two independent entries

- **WHEN** an order carries two communication screenshots
- **THEN** the page shows two independently operable view entries, each triggering its own read-intent with its own file identity, rather than a single aggregated "uploaded" label.

#### Scenario: Order without screenshots

- **WHEN** an order has an empty `communication_screenshots` array
- **THEN** the page shows the explicit empty state.

### Requirement: Stylesheets stay free of large exact duplicate blocks

Repository CSS files MUST NOT contain exact byte-level duplicate blocks of 256 lines or more. A static verification step MUST fail when such a block is introduced. CSS cleanup MUST preserve the final effective rules and Material 3 presentation of all three portals, verified by regenerated portal screenshots.

#### Scenario: Duplicate stylesheet copy is rejected

- **WHEN** a CSS file in the repository contains two or more byte-identical consecutive regions of at least 256 lines
- **THEN** the static CSS duplicate verification exits non-zero.

#### Scenario: Portal visuals survive deduplication

- **WHEN** the deduplicated stylesheets are built and the three portal screenshots are regenerated
- **THEN** each portal screenshot shows the same Material 3 layout without visual regression.

### Requirement: Buyer end-to-end suites pass without assertion weakening

The buyer Playwright suites (`module1-buyer`, `buyer-visual-pilot`, `buyer-remaining-visual`, `customer-security`) MUST run to completion and pass. Each previously failing case MUST be classified as functional regression, accessibility regression, stale assertion superseded by an approved business change, or fixture drift from the real contract. Deleting tests, skipping tests, weakening assertions, or only extending timeouts is forbidden. Interactive controls MUST retain clearly visible focus-visible styling, and the registration success interaction MUST match the currently approved behavior.

#### Scenario: Focus is visible on buyer interactive controls

- **WHEN** a buyer interactive control receives keyboard focus
- **THEN** a clearly visible focus indicator is rendered.

#### Scenario: Full buyer suite run

- **WHEN** the four buyer Playwright spec files are executed end to end
- **THEN** every test completes with no failures.

### Requirement: Stage 7 handoff records are accurate

The Stage 7 handoff MUST be corrected to state five local commits, real test outcomes (never reporting zero failures unless every executed test passed), CSS cleanup quantities backed by Git diff and file statistics, and MUST NOT claim the seller DTO lacks uploader/time fields. A Stage 7R handoff MUST separate genuine backend contract gaps from frontend gaps fixed in this round and MUST state that this round is not a Staging/Production GO.

#### Scenario: Handoff describes screenshot contract accurately

- **WHEN** a reader checks the Stage 7R handoff for the seller communication-screenshot capability
- **THEN** it records that uploader identity and upload time are already returned by the backend and wired in this round, not listed as a backend gap.
