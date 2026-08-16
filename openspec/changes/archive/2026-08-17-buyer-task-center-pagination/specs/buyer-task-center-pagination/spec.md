## Purpose

Ensure the canonical Buyer task center presents complete task classifications and actionable counts when each existing source is cursor-paginated.

## ADDED Requirements

### Requirement: Buyer task center exhausts required cursor sources

The Buyer task center SHALL follow `next_cursor` sequentially for reservations, eligible order evidence, order evidence, eligible reviews, reviews, and refunds until each source returns `null`. An empty page with a non-null cursor SHALL not terminate that source. The center SHALL classify the combined source records using the current actionable and system-processing semantics of D-033.

#### Scenario: Actionable work occurs after the first source page

- **WHEN** a required source returns more than 50 records and an actionable record is on a later page
- **THEN** the Buyer task center displays that task and includes it in the actionable count

#### Scenario: Processing work occurs after the first source page

- **WHEN** a later source page contains only system-processing records
- **THEN** the Buyer task center displays them as system-processing and does not add them to the actionable count

### Requirement: Buyer task center fails closed for incomplete cursor sources

The Buyer task center SHALL not display an actionable total when any required source fails, repeats a cursor, or exceeds the configured cursor safety limit. Request cancellation caused by unmounting or replacing the task-center query SHALL not be shown as a source error.

#### Scenario: A required source fails after another source succeeds

- **WHEN** any required task source cannot be fully read
- **THEN** the center warns that the task state is incomplete and does not display a numeric actionable total

#### Scenario: A source repeats a cursor

- **WHEN** a required source returns a cursor already returned by that source
- **THEN** the center stops that source and treats the task state as incomplete

### Requirement: Buyer task center does not double-count repeated source resources

The Buyer task center SHALL retain at most one record for a repeated stable resource identifier within the same source pagination chain. This requirement SHALL NOT restore the retired cross-source global task deduplication model.

#### Scenario: A later page repeats a source resource

- **WHEN** a source returns the same resource identifier on two cursor pages
- **THEN** the task center classifies that resource once
