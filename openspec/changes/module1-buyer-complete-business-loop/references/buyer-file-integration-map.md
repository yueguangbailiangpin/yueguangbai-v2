# Buyer File Integration Map

## Upload workflows

| Business use | Wave14A workflow | Purpose / visibility | Generic maximum | Module business maximum |
|---|---|---|---:|---:|
| Order screenshot | `buyerOrderEvidence` | ORDER_EVIDENCE / BUYER_VISIBLE | 1 | exactly 1 verified image |
| Review evidence | `buyerReviewEvidence` | REVIEW_EVIDENCE / SELLER_VISIBLE | 10 | 1–3 verified files |

Upload sequence is fixed: purpose-bound intent → per-slot multipart PUT with private upload token → server-side file verification during Complete with expected intent version → VERIFIED receipts. The frontend sends no HEAD request and makes no client-side HEAD claim. The business command consumes only safe object IDs, and review also consumes each positive verified file version.

## Read workflows

| Asset | Read-intent source | Required authority | Result handling |
|---|---|---|---|
| Instruction main image | `BuyerInstructionImageReadIntentAdapter` | exact current Buyer/reservation/`main` route-pattern match; readable ACTIVE instruction | normalized intent then existing bounded content read; no invented file ID/replay fact |
| Instruction keyword image | same adapter | exact current Buyer/reservation/current positive position route-pattern match | same |
| Review evidence | `BuyerReviewFileReadIntentAdapter` | validated review/link IDs, positive `version`, CREATE_READ_INTENT action | fixed specialized route; existing bounded content read |
| Generic Buyer-linked file | `GenericBuyerFileReadIntentAdapter` | safe reference and positive current file version | fixed generic route; same content lifecycle |
| Order screenshot | `BuyerOrderEvidenceFileReadIntentAdapter` | validated submission/link IDs, positive `version`, CREATE_READ_INTENT action | fixed dedicated route; new authoritative data previews safely |
| Historical/unbackfillable order screenshot | no readable action/link/version | metadata only | never guess a version or construct a read intent |

## Narrow FileRead intent-provider extension

`FileReadIntentProvider` replaces only read-intent creation. `FileReadController` continues to own binary content download, header validation, token lifecycle, 401 invalidation, Object URLs, and retry/restart state, and its public API never accepts an arbitrary path string.

The four fixed providers are:

1. `GenericBuyerFileReadIntentAdapter`
2. `BuyerInstructionImageReadIntentAdapter`
3. `BuyerReviewFileReadIntentAdapter`
4. `BuyerOrderEvidenceFileReadIntentAdapter`

Instruction paths must match the formal route exactly for Buyer domain, current reservation ID, and `main` or the current positive integer position. Any other returned `/api` path fails closed. Review and order-evidence paths are constructed from already validated entity IDs, never forwarded from DTO strings. The provider's normalized result can represent absent `file_object_id`/replay assertions; the instruction adapter uses that state because its response lacks those fields and never fabricates them. Across all adapters, `access_token_available=false` or `access_token=null` means RESTART_REQUIRED.

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

## Order-evidence dedicated target

The target Contract adds `file_entity_link_id`, positive `version`, and `allowed_actions=['CREATE_READ_INTENT']` to a readable `BuyerOrderEvidenceFileDto`. `POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent` accepts only `{ expected_file_version }` and returns the Buyer Review-equivalent safe intent fields. The server verifies Buyer ownership, current visible submission membership, version, and explicit audience/current formal-file authorization; concealed scope miss is 404 and replay never reissues a token. Content still uses `/api/buyer-portal/file-read-intents/:id/content`. Baseline API count remains 38; this single target addition makes 39. No Backend/Contract code is changed in this planning round.
