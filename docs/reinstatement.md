# Reinstatement — R&D & Implementation Notes

Companion to [common.md](./common.md) and [cancellation.md](./cancellation.md). Covers restoring
a cancelled policy to Active — a conditional, time-boxed, request-then-decide transaction, never
something ops initiates on its own.

## Definition

Reinstatement restores a cancelled policy to force, closing the coverage gap between the
cancellation's effective date and the reinstatement's approval — subject to two hard limits: a
fraud-flagged cancellation is barred from reinstatement permanently, and every other cancellation
has a limited window to request it in.

## Who triggers it, and how

Same shape as every mid-term transaction: a reinstatement request must arrive — from the insured
or a broker, typically after outstanding premium is paid — before the desk shows it at all. The
Reinstatement desk lists two things: pending requests, and cancelled policies with **no** request
yet (nobody has asked, so there is nothing to decide).

## Eligibility

`PAS.reinstatementEligibility(policy)` looks at the policy's most recent Cancellation transaction
and derives:

```
daysSince = daysBetween(cancellation.date, today)
fraud     = cancellation.meta.reason === "Fraud"
eligible  = !fraud  &&  0 ≤ daysSince ≤ REINSTATEMENT_WINDOW_DAYS
```

`REINSTATEMENT_WINDOW_DAYS` is 45. The fraud check is absolute — no window, no exception, ever.

## The decision

The reinstatement decision screen shows:
- The original cancellation: reason, type applied, refund already issued.
- The eligibility verdict, with the reasoning spelled out (`"Cancelled N days ago. Inside the
  45-day window."` or `"...Fraud cancellation — reinstatement permanently barred."` or
  `"...Outside the window — needs new-business underwriting."`).
- The coverage gap in days, which must be disclosed to the policyholder in writing regardless of
  outcome.
- An outstanding-premium figure to collect before cover is restored.

**Approve** is disabled outright when `eligible` is false — this desk *does* enforce its own gate,
unlike Cancellation's notice check (see [cancellation.md](./cancellation.md)). The disabled reason
is specific: "Policies cancelled for fraud are never eligible" versus "Cancelled N days ago —
beyond the 45-day window" are different messages for a different underlying problem.

### Worked example

Divya Krishnan, Comprehensive Auto, cancelled 2026-08-05 for non-payment (refund ₹0), reinstatement
requested 2026-08-19 claiming ₹33,000 outstanding:

```
daysSince = daysBetween(2026-08-05, 2026-08-20) = 15
fraud     = false
eligible  = true            (15 ≤ 45, not fraud)
```

Eligible, inside the window, non-payment reason (not fraud) — this is exactly the shape of request
the window exists to allow: pay what's owed, come back inside 45 days, resume cover.

## What approving actually does

`PAS.decideReinstatement(id, txnId, true, { gapDays, outstanding })`:

1. Flips the transaction to `Completed`.
2. Sets policy `status` back to `Active`.
3. Records the gap in days and the outstanding amount collected on the transaction's `meta`.

It does **not** touch `effectiveDate` or `expirationDate` — the term's dates are left exactly as
they were before cancellation, so the insured effectively pays a full term's premium for a term
now `gapDays` shorter, with no cover ever in force over the gap. That may be the correct
commercial answer, but today it is a silent side effect rather than a choice the underwriter is
shown — see Known gaps.

## What's implemented, and what's a gap

| Capability | Status |
|---|---|
| Fraud permanently bars reinstatement | Implemented, and enforced — Approve is disabled, not just warned. |
| Window eligibility computed and enforced | Implemented — Approve is disabled outside the window. |
| Coverage-gap disclosure requirement surfaced | Implemented as a UI statement; no actual disclosure document is generated. |
| Outstanding premium computed from what's owed | **Not implemented.** The field defaults to `0` and is hand-typed by the operator from "the requester's claimed figure" — the app already knows the refund issued on cancellation, which is most of what should be recollected, and does not compute it. |
| One reinstatement window for every product | **Gap.** `REINSTATEMENT_WINDOW_DAYS = 45` is a single global constant. Real positions vary sharply by product — Term Life typically allows revival for up to 5 years from the first unpaid premium under Section 113(2) of the Insurance Act 1938; Motor generally does not allow reinstatement at all past a lapse (a lapsed motor policy is new business, with a fresh inspection); Group Health usually runs a much shorter grace period. A single 45-day figure is roughly right for none of these. |
| Backdating cover over the gap vs. leaving it uncovered | **Not modelled as a choice.** `decideReinstatement` always restores `Active` without adjusting dates, so there is no explicit option between "the gap stays uncovered and the insured is charged accordingly" and "cover is backdated over the gap and the insured pays for it." |

## Known gaps

- **Outstanding premium should be computed, not typed.** The real figure is: unearned premium
  already refunded on cancellation, plus premium for the lapse period if cover is backdated, plus
  any product-scoped reinstatement fee. All three inputs already exist elsewhere in the app; none
  of them feed this field today.
- **Product-scoped windows**, replacing the single global constant, are the direct prerequisite for
  fixing the Term Life mismatch above.
- **Reversal is cosmetic**, same shared gap as cancellation and renewal — see
  [common.md](./common.md).

## Database tables used

`transactions` (type `Reinstatement`) plus a `reinstatement_details` table for the gap, the
outstanding amount and the disclosure record, per [common.md](./common.md#database-schema).

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/policies?status=cancelled` | Reinstatement candidates. |
| `POST` | `/api/v1/policies/{policyId}/reinstatements` | Validates the window, returns the policy to `Active`. |
| `POST` | `/api/v1/transactions/{txnId}/approve` \| `.../reject` | Commits or declines the held request. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.
