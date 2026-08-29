# Release configuration alignment Specification

## ADDED Requirements

### Requirement: Archive release switches use one canonical namespace

The repository SHALL use exactly these four environment archive switches in
active core templates and release validators: `ARCHIVE_SELECTOR_ENABLED`,
`ARCHIVE_DRIVE_UPLOAD_ENABLED`, `ARCHIVE_HOT_DELETE_ENABLED`, and
`ARCHIVE_RESTORE_WORKER_ENABLED`. Staging, production, and local core templates
SHALL declare each as the JSON string `"false"`; the retired `DRIVE_ARCHIVE_*`
names SHALL not satisfy any active validator.

#### Scenario: All canonical switches are disabled

- **WHEN** a rendered release configuration contains all four canonical keys as
  strings equal to `"false"` and contains no legacy switch as an active setting
- **THEN** the local release configuration validator accepts the archive switch
  portion without enabling an archive capability

#### Scenario: A canonical switch is missing or unsafe

- **WHEN** a rendered release configuration omits any canonical key, uses a
  boolean/non-string value, or sets any canonical key to `"true"`
- **THEN** the release preflight rejects the configuration before deployment and
  reports a blocking field error without making an external call

#### Scenario: Only retired switches are supplied

- **WHEN** a rendered configuration supplies one or more `DRIVE_ARCHIVE_*` keys
  but omits the corresponding canonical `ARCHIVE_*` keys
- **THEN** the release preflight rejects the configuration and does not treat the
  retired names as aliases

### Requirement: Runtime startup remains fail closed for incomplete archive configuration

The staging and production Worker runtime SHALL refuse to start its release path
when any canonical archive switch is absent or not the string `"false"`; the cold
archive runtime SHALL expose no enabled archive capability in that case. The
Google Drive shadow-copy preflight SHALL use the same canonical names, requiring
selector and upload `"true"`, hot-delete and restore-worker `"false"`, while
retaining the independent D1 controls.

#### Scenario: A production binding omits one archive switch

- **WHEN** a production Worker binding is otherwise valid but lacks any one of
  the four canonical archive switches
- **THEN** runtime resolution returns no release runtime and the Worker responds
  with its existing 503 fail-closed response without entering scheduler, Drive,
  R2, or Queue execution

#### Scenario: Shadow-copy activation uses canonical switches

- **WHEN** an external private activation config sets scheduler, selector and
  drive upload to `"true"`, hot delete and restore worker to `"false"`, and the
  D1 controls to copy=1/proxy=0/delete=0
- **THEN** the Drive preflight returns its local no-go structure-valid result with
  zero external/provider/resource calls

#### Scenario: Shadow-copy config enables a destructive or restore worker switch

- **WHEN** the activation config sets canonical hot-delete or restore-worker to
  `"true"`, or uses a retired switch instead of a canonical field
- **THEN** the Drive preflight blocks activation and preserves the fail-closed
  state
