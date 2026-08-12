# Buyer demand and reservation alignment

## MODIFIED Requirements

### Requirement: Public demand list uses the real paged projection

The Buyer product area at `/buyer/products` SHALL read the existing paged demand projection and display only products with a current Buyer-eligible reservable demand. It SHALL render returned product, store, task type, money, note, remaining quantity, reservation deadline, and order deadline facts without inventing a product or a new summary API. `/buyer/demands` may remain a compatibility route for the same current projection, but the canonical primary entry is `/buyer/products`.

#### Scenario: Current reservable products are returned

- **WHEN** the existing Buyer demand API returns current eligible demand items
- **THEN** the product area renders only those returned eligible products and preserves the existing cursor/pagination semantics.

#### Scenario: A product is no longer reservable

- **WHEN** current eligibility, capacity, marketplace, or demand window removes a product from the reservable projection
- **THEN** the product is not presented as currently reservable and the existing server-side reservation authority remains unchanged.

#### Scenario: Published demands are returned

- **WHEN** the existing API returns a page of published current demand items
- **THEN** the product area renders only returned values, labels JPY units, and preserves the next cursor without inventing quantities.

#### Scenario: No demand or page fails

- **WHEN** the current product projection is empty or a later cursor fails
- **THEN** a genuine empty or page-specific error is shown while previously validated items remain distinguishable from fresh loading.

## ADDED Requirements

### Requirement: Demand and reservation remain one current Buyer journey

The Buyer product journey SHALL preserve the existing product-detail → self-pay confirmation → reservation → approval/rejection → instruction flow. This alignment SHALL not add a Migration, change API behavior, or expose internal scheduling rank/date fields to Buyer pages.

#### Scenario: Buyer reserves from a current product

- **WHEN** the Buyer confirms the current self-pay facts and submits a reservation
- **THEN** the existing version-bound, idempotent reservation contract remains the authority for success or conflict.

#### Scenario: Buyer reads internal scheduling evidence

- **WHEN** a Buyer reads product, reservation, or order pages
- **THEN** internal Staff scheduling rank and planned order date are not exposed as Buyer contract fields.
