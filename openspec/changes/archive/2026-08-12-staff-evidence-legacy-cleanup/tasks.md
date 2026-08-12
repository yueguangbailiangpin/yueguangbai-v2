## 1. Migration and contract boundaries

- [x] 1.1 Verify the branch baseline and prove the Change adds or edits no Migration.
- [x] 1.2 Inventory the existing Seller Settlement frontend behavior, strict runtime contracts, backend authorization/scope, financial command, proof, audit and outbox boundaries.

## 2. Canonical frontend ownership

- [x] 2.1 Extract one canonical Seller Settlement component with the existing reads, display, mutation authority, refetch and protected-proof behavior.
- [x] 2.2 Mount the component from the Frozen workbench only for authorized Seller Organization context, with view/record/correct client gates that mirror current effective permissions.
- [x] 2.3 Preserve backend request bodies and financial behavior while correcting the legacy role-blind mount and unsupported PDF proof chooser.
- [x] 2.4 Preserve independent request-ID-bearing detail recovery in the canonical workbench while keeping the queue usable.

## 3. Tests and evidence

- [x] 3.1 Add focused Seller Settlement behavior tests for independent principal, fee, payment, allocation, proof, refresh and failed-command behavior.
- [x] 3.2 Add role/permission tests proving authorized visibility and zero settlement requests for wrong roles or missing permissions.
- [x] 3.3 Migrate still-valid queue, concealed-detail, cursor and demand-review scenarios into canonical Frozen workbench tests.
- [x] 3.4 Update package targets and verifiers to reference canonical composition/components/tests and reduce fragile business-DTO source markers.

## 4. Legacy cleanup and governance

- [x] 4.1 Delete the retired Staff workbench implementation/test after proving no runtime, import, verifier, evidence, helper or CSS consumer remains.
- [x] 4.2 Confirm Acquisition and Admin legacy workbenches remain unchanged and Buyer/Seller DTO/API behavior remains isolated.
- [x] 4.3 Add a new verified Decision Register entry without rewriting D-024, D-025, D-034, archived Changes or Migrations.

## 5. Validation and closure

- [x] 5.1 Run the targeted settlement, role/scope and canonical route/composition tests in the requested order.
- [x] 5.2 Run the Staff module/verifier gates and Web typecheck/build once in the requested order.
- [x] 5.3 Run OpenSpec target/all strict validation, Formal Verify, semantic spec sync and archive through the current governance workflow.
- [x] 5.4 Run diff/migration checks and the full repository check once; retain no production, remote Git or deployment side effect.
