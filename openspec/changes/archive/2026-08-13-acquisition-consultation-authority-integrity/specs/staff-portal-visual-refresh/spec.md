# Staff five-role Acquisition visual alignment

## MODIFIED Requirements

### Requirement: Staff navigation follows the five-role backend projection

The protected shell SHALL display 总管理员、获客、售前、卖家对接、买家返款 from the trusted Session, SHALL preserve the existing real routes, and SHALL show optional navigation only when current canonical role duties and backend-projected scope authorize the area.

#### Scenario: Five canonical roles open Staff

- **WHEN** owner, acquisition, pre_sales, seller_ops, or buyer_refund enters with one valid ACTIVE role
- **THEN** the shell shows that exact Chinese role, never asks for role selection, and exposes only the role's permitted navigation while direct backend requests remain independently authorized.

#### Scenario: Buyer-refund Staff views navigation

- **WHEN** the current role is buyer_refund, even with stale client state
- **THEN** 客户开发 is absent, no acquisition control renders, and direct acquisition API calls continue to fail closed.

### Requirement: Acquisition remains hybrid, scoped, and bookmarkable

`/staff/acquisition` SHALL remain a stable bookmarkable route. Owner SHALL receive administration and consultation-write controls. Acquisition SHALL receive Marketplace-scoped Prospect/source/read workflows and a read-only daily consultation surface without `ACQUISITION_ADMIN` or formal Buyer/Seller Lead permissions. Other roles SHALL NOT receive the customer-development operator surface.

#### Scenario: Authorized acquisition role opens the route

- **WHEN** acquisition with a current Marketplace scope opens the route with an empty permission array
- **THEN** scoped source, Prospect, funnel and daily-consultation reads and Prospect commands remain available, while consultation-write, channel-admin, machine-admin and formal Lead controls are absent.

#### Scenario: Owner opens the route

- **WHEN** owner opens the route with current backend authority
- **THEN** the existing owner administration and daily consultation record/correct form are available and direct API calls remain independently authorized.

#### Scenario: Owner has Personal DENY for acquisition administration

- **WHEN** a trusted owner session can read the owner surface but its projected permissions omit `ACQUISITION_ADMIN`
- **THEN** the daily-consultation and channel-management tabs remain available as read-only owner surfaces, while consultation/channel write forms and buttons and the machine-administration tab are absent.

#### Scenario: Acquisition is denied

- **WHEN** pre_sales, seller_ops, buyer_refund or an invalid Staff session opens the stable route directly
- **THEN** no customer-development operator/admin control or prior sensitive cached result appears and the backend rejects unauthorized reads/writes.

### Requirement: Five-role visual evidence is deterministic and reviewed

The Change SHALL keep deterministic Staff fixtures for owner, acquisition, pre_sales, seller_ops and buyer_refund and SHALL independently assert role, permission, security, accessibility and disclosure boundaries. Acquisition fixtures SHALL use `permissions=[]` so operator access is not confused with formal Lead or admin permission.

#### Scenario: Evidence matrix is generated

- **WHEN** the Staff role/browser suites run with Contract-valid fixtures, locale, timezone, motion and viewport settings
- **THEN** all five role projections are covered, acquisition retains scoped Prospect workflow, and no acquisition fixture receives `ACQUISITION_BUYER_LEAD` or `ACQUISITION_SELLER_LEAD`.

#### Scenario: Evidence is handed to controller review

- **WHEN** implementation is reported complete
- **THEN** executed checks have explicit PASS/FAIL results and no unexecuted Formal, sync or archive step is reported as passed.
