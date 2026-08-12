# Frontend routing shell alignment

## REMOVED Requirements

### Requirement: Buyer shell is mobile-first with fixed five-item navigation

The archived five-item Buyer shell requirement is removed from the current canonical frontend requirement set.

## ADDED Requirements

### Requirement: Buyer shell is mobile-first with exactly three canonical items

The Buyer shell SHALL remain mobile-first, shall not use a persistent desktop sidebar, and SHALL expose exactly `产品`, `任务`, and `我的` in that order. The shell SHALL preserve accessible fixed-navigation behavior at narrow widths and 200% zoom without restoring the legacy Dashboard navigation model.

#### Scenario: Buyer shell at mobile width

- **WHEN** an authenticated Buyer opens a Buyer route at 320px or 200% zoom
- **THEN** one focused content column and all three keyboard-operable primary items remain visible without covering the page end.

#### Scenario: Buyer opens a contextual business route

- **WHEN** a Buyer opens a reservation, order-material, formal-order, review, or refund route
- **THEN** the route remains in the Buyer shell and selects one of the three semantic owners without adding a primary item.
