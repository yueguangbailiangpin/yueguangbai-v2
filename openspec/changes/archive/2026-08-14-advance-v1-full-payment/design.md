# Design: Advance V1 Full Payment

## Authoritative amount and request contract

The formal order financial snapshot is the immutable authority for Buyer expected principal. The Payment request carries only occurrence time, payment channel, note and verified proof references. The API reads the snapshot amount before idempotency acquisition and hashes the server-derived amount into the command payload. Unknown or legacy `amount_cny_fen` fields fail strict-body validation.

The order lookup response exposes the authoritative amount only to the existing owner/buyer_refund financial projection. The Staff UI renders it as formatted read-only CNY and never constructs a client-selected amount.

## Full-payment state boundary

One full Payment may exist while its net amount is positive. A second Payment is rejected at the serialized database write boundary. After one full Reversal reduces that Payment to zero, a replacement full Payment is allowed. Review approval continues to settle the one outstanding Payment against the immutable Buyer Refund obligation.

The Reversal request carries only a reason. The API selects the original Payment, derives its full amount and rejects settled/already-reversed records before idempotency. Migration 0067 also rejects direct partial or repeated Reversal inserts. Existing Migration 0061 remains authoritative for Payment source type, same formal order and same Buyer; Migration 0066 remains authoritative for the cumulative upper bound.

## Migration and existing-ledger boundary

Migration 0067 first requires Schema 66. It fails when any Payment amount differs from its formal order financial snapshot, when any Payment has a partial reversal total, when any Payment has more than one Reversal, or when an order has more than one outstanding Payment. No immutable row is repaired or deleted.

New triggers enforce: Payment amount equals the snapshot and no outstanding Payment already exists; Reversal amount equals its original Payment and no prior Reversal exists. Existing source and cumulative guards remain installed. Schema advances only after trigger-presence assertions succeed.

## Transaction, idempotency and audit

Payment/reversal commands retain strict Staff authorization, Marketplace scope, origin guard, idempotency key/request hash, proof authorization, immutable Audit and final idempotency assertion. The server-derived amount is included in response, Audit and idempotency facts. A concurrent losing command fails without appending a second financial, file, Audit or completion fact.

## Rejected alternatives

- Keeping an editable amount and merely comparing it server-side leaves obsolete client authority and needless contract surface.
- Allowing partial reversal recreates a partial outstanding balance and defeats the selected V1 simplification.
- Editing Migration 0055, 0061 or 0066 would rewrite history and is forbidden.
- Deleting settlement/cash infrastructure would conflate product simplification with ledger retirement and is outside this change.

## Verification

Tests cover strict request bodies, snapshot-derived amount, one outstanding Payment, full-only Reversal, replacement after full Reversal, concurrent/direct database attempts, dirty-ledger migration failure, full 0001-0067 migration continuity, cash single-counting, UI read-only rendering, permissions, idempotency, proof files, Audit and strict OpenSpec validation.
