# Buyer File Integration Map

## Upload workflows

| Business use | Wave14A workflow | Purpose / visibility | Generic maximum | Module business maximum |
|---|---|---|---:|---:|
| Order screenshot | `buyerOrderEvidence` | ORDER_EVIDENCE / BUYER_VISIBLE | 1 | exactly 1 verified image |
| Review evidence | `buyerReviewEvidence` | REVIEW_EVIDENCE / SELLER_VISIBLE | 10 | 1–3 verified files |

Upload sequence is fixed: purpose-bound intent → per-slot multipart PUT with private upload token → complete with expected intent version → VERIFIED receipts. The business command consumes only safe object IDs, and review also consumes each positive verified file version.

## Read workflows

| Asset | Read-intent source | Required authority | Result handling |
|---|---|---|---|
| Instruction main image | DTO `main_image.read_intent_path` | current Buyer, readable ACTIVE instruction, explicit Buyer grant | Wave14A bounded content read; ephemeral Object URL |
| Instruction keyword image | each ordered DTO `read_intent_path` | same, selected current position | same |
| Review evidence | specialized review/file-link route | current review file link, `version`, CREATE_READ_INTENT action | same |
| Generic Buyer-linked file | `/api/buyer-portal/files/:fileObjectId/read-intents` | safe reference and positive current file version | same |
| Historical order screenshot | generic route would be required | current DTO lacks `file_version` | metadata only until Contract/controller decision; never guess |

## Memory and cleanup

- Upload and read tokens remain in controller-private memory and are available only on first successful intent response.
- Replay does not reissue a token.
- File bytes stay outside TanStack Query and browser persistence.
- Every Object URL is revoked on replace, close, unmount, cancel, reference change, failure, or completion of its viewer lifecycle.
- No DTO or UI displays a storage object key, permanent/signed URL, audience authority, owner authority, or token.

## Error boundaries

- 401 uses existing Customer invalidation and abandons private file authority.
- 403/404 retains the Buyer Session and shows no cross-resource detail.
- 409 file/version/storage conflict requires explicit restart or refetch as defined by the controller.
- 410 expired token/intent abandons expired authority.
- 422 file validation requires safe reselection.
- 429 does not auto-retry and respects the existing explicit retry window.
- 503 ambiguous upload/read behavior preserves only the exact controller-owned retry context; compensation-required is terminal.

## Planning gap

The order-evidence detail Contract has `file_object_id` and verification metadata but no positive file version. Because generic read intent requires `expected_file_version`, reopening an historical screenshot cannot be implemented safely from the current DTO. This Change records the gap and does not invent version 1, use storage URLs, or modify Backend/Contracts in the planning phase.
