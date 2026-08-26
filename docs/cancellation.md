# Cancellations — R&D & Implementation Notes

Companion to [common.md](./common.md). Covers the Cancellation desk: the four independent
attributes a cancellation is built from, how Type is derived from the other three rather than
picked, how the refund is actually calculated, and where that calculation still diverges from
market practice.

## Definition

A cancellation ends cover before the term's natural expiry. Unlike expiry, it is an active,
decided event with money attached — a refund of unearned premium, sometimes reduced by a penalty
— and, depending on the reason, a statutory notice period that must run before it can take effect.

## Four attributes, not one reason string

A cancellation is described by four values that each answer a different question and are recorded
independently:

| Attribute | Answers | Values |
|---|---|---|
| **Type** | What happens financially | Flat, Pro-Rata, Short-Rate |
| **Reason** | Why | Insured Request, Non-Payment, Fraud, Underwriting, Sold Vehicle/Business, Other |
| **Initiated By** | Who | Insured, Broker/Producer, MGA, Carrier, System |
| **Timing** | When | Immediate, Future/Scheduled |

This used to be a single "reason" string with the refund basis baked directly into it — four
reason values collapsed onto a basis called "Non-Payment" that was really a reason wearing a
type's clothes, and there was no way to record *who* raised a Carrier-side cancellation versus an
MGA acting on the Carrier's behalf. Splitting them apart is what lets each one carry only the
information it actually owns: Reason carries the notice period, Initiated By carries the
penalty-eligibility check, Timing is a pure function of the effective date.

## Who can request one, and how

Same request-then-decide contract as every mid-term transaction in this system (see
[common.md](./common.md#who-can-trigger-a-change-and-how-a-pas-decides)): a request arrives —
from the insured, a broker, an MGA, or the carrier's own review — and is held Pending until a
decision is made. The one exception is a System-initiated Non-Payment cancellation, which the
System completes on its own the moment Billing reports premium still unpaid past the grace
period — see the Cancellation desk's "Auto-cancelled" KPI. Every other cancellation is never
executed the moment it's requested.

## Type: derived, never chosen

**Type is not a field the requester or the operator picks.** Letting an operator hand-pick
"Pro-Rata" on a policyholder-initiated cancellation would let a short-rate penalty be waived by
mistake, so the derivation is fixed in code — `PAS.deriveCancelType(reason, initiatedBy,
atInception)` in `store.js`:

```
atInception?
   │
  yes ──► Flat                              (always wins, regardless of reason/initiator)
   │
   no
   │
   ▼
Reason proposes a default Type
   │
   ▼
Is Initiated By insurer-side (Carrier, MGA, System)
AND the default is Short-Rate?
   │
  yes ──► downgrade to Pro-Rata              (insurer side never pays its own penalty)
   │
   no ──► keep Reason's default
```

The downgrade only ever runs **one direction** — an insurer-side initiator can turn a Short-Rate
default into Pro-Rata, but nothing can turn a no-penalty reason (Non-Payment, Fraud, Underwriting)
into Short-Rate just because the Insured happened to be the one who reported it.

## The three types

| Type | Penalty | Basis | Rule |
|---|---|---|---|
| **Flat** | None | Full written premium | Only valid when the effective date is on or before the policy's inception date — the insurer was never on risk. |
| **Pro-Rata** | None | Unearned, exact proportion | Insurer-side (Carrier, MGA, System) cancellations, and every no-penalty reason, land here. |
| **Short-Rate** | 10% of unearned | Unearned less penalty | Only ever reached by an Insured- or Broker-initiated exit — never an insurer-side one. |

`Non-Payment` used to be a fourth type here. It is not one any more: cancelling for non-payment
returns unearned premium on the same Pro-Rata basis as any other insurer-side exit — what made it
distinct was never the refund math, it was the 15-day notice requirement, which is a property of
the **Reason**, not the Type.

## The six reasons, and what each requires

| Reason | Notice required | Default type |
|---|---|---|
| Insured Request | 0 days | Short-Rate |
| Non-Payment | 15 days | Pro-Rata |
| Fraud | 0 days | Pro-Rata |
| Underwriting | 30 days | Pro-Rata |
| Sold Vehicle/Business | 0 days | Short-Rate |
| Other | 15 days | Short-Rate |

Notice period now lives here instead of on Type, which is what makes it possible for the same
15-day requirement to survive Non-Payment being derived to Pro-Rata rather than living inside a
type called "Non-Payment." The reference table on the Cancellation desk renders this exact table
live from `PAS.CANCEL_REASONS`, so it can't drift out of sync with the code.

## Initiated By, and the insurer-side check

Five values, restricted on the cancellation form specifically (`PAS.CANCEL_INITIATOR_KEYS`) —
narrower than the full `PAS.INITIATORS` directory other modules draw from, since an underwriter's
own portfolio review is a Renewal concept, not a cancellation one:

| Value | Insurer-side? |
|---|---|
| Insured | No |
| Broker/Producer | No |
| MGA | **Yes** |
| Carrier | **Yes** |
| System | **Yes** |

`PAS.CANCEL_INSURER_SIDE` is the lookup `deriveCancelType` checks. MGA and Carrier are new entries
on the shared `PAS.INITIATORS` directory (added, not renamed — nothing else that already used
`Underwriter`, `Broker/Producer`, etc. changed).

## Timing: derived, never stored

`PAS.cancelTiming(effectiveDate)` returns `"Immediate"` when the effective date is today or
earlier, `"Future/Scheduled"` otherwise. It is never written to a transaction's `meta` — computing
it on every read is what guarantees it can't go stale the way a hand-set flag could.

## The refund formula

`PAS.cancelQuote(policy, reason, initiatedBy, effectiveDate)` in `store.js`:

```
type           = deriveCancelType(reason, initiatedBy, atInception)
totalDays      = daysBetween(policy.effectiveDate, policy.expirationDate)
remainingDays  = daysBetween(effectiveDate, policy.expirationDate)
earnedDays     = totalDays − remainingDays

unearned       = policy.premium × (remainingDays / totalDays)
gross          = type === "Flat"  ?  policy.premium  :  unearned
penalty        = gross × penaltyPct        (10% for Short-Rate, 0% otherwise)
refund         = max(0, gross − penalty)

noticeRequired = CANCEL_REASONS[reason].noticeDays     ← from Reason, not Type
noticeProvided = daysBetween(today, effectiveDate)
noticeOk       = noticeProvided ≥ noticeRequired
needsReview    = reason === "Fraud"  ||  !noticeOk
```

### Worked example

Marcus Whitfield, Term Life, premium $2,400, effective 2026-02-01, expiring 2027-02-01, cancellation
requested for reason "Insured Request", Initiated By "Broker/Producer", effective 2026-08-19:

```
Total term       365 days
Remaining         166 days
Unearned    2,400 × 166/365  =  1,092
Penalty (10%)     1,092 × 0.10  =    109
Refund                            =    982
```

Type derives to Short-Rate: the reason's default is Short-Rate, and Broker/Producer is not
insurer-side, so nothing downgrades it. Had this same request come in Initiated By "Carrier"
instead, Type would derive to Pro-Rata and the refund would be the full $1,092 unearned — the
penalty only exists to recover acquisition cost on a voluntary exit, not on one the insurer itself
initiated for the same stated reason.

## Where this diverges from market convention

The 10% penalty is taken **off unearned premium**, not off annual premium and not off a
short-period retention scale. That choice makes the penalty shrink toward zero as the policy runs
out — the opposite of every real US short-rate table, where the *earned* percentage is
front-loaded well beyond straight pro-rata: a standard short-rate table can treat a cancellation
in the first 10 days of a 365-day term as having earned 10% of the annual premium, even though
only about 2.7% of the term has actually elapsed. See the audit's F-04 for the full comparison
table. It has not yet been fixed; it needs a product-scoped rate table (see
[common.md](./common.md)'s "Where this prototype stands today"), not a one-line change.

## What's implemented, and what's a gap

| Capability | Status |
|---|---|
| Type derived from Reason + Initiated By + dates, never hand-picked | Implemented. |
| An insurer-side initiator can only downgrade Short-Rate to Pro-Rata, never the reverse | Implemented and tested — `tests/domain-rules.test.js` checks every Reason × Initiated By combination. |
| Notice period is a property of Reason, not Type | Implemented. |
| Refund computed on read from `cancelQuote`, not stored on the pending transaction | Implemented — a pending cancellation carries no `meta.refund`; the desk and the approvals index compute it live, so they cannot disagree. |
| Fraud flagged with a warning before approval | Implemented — a red callout, but **not** a hard block; the underwriter can still approve it (permanently barring reinstatement is the actual control, downstream — see [reinstatement.md](./reinstatement.md)). |
| Notice-period breach blocks approval | **Not implemented.** `noticeOk` / `needsReview` are computed and shown in a callout, but the Approve button carries no `disabled` state — an operator can approve a Non-Payment cancellation with zero days' notice served. Contrast with the Reinstatement desk, which *does* disable its approve action on a failed condition. |
| Short-rate penalty on annual premium / a short-period scale | **Not implemented.** Currently 10% of unearned premium, flat across every product line. |
| Free-look period | **Missing entirely.** Not one of the six reasons. A day-3 cancellation of a life policy currently derives to Short-Rate and takes a penalty, which is not permitted during a statutory free-look window. |

## Known gaps

- **No grace period or paid-to-date model.** The Non-Payment reason presumes a grace period has
  lapsed, but nothing in the data model tracks premium receipt, so there is no underlying fact
  the System's auto-cancellation is actually checked against — the Billing→System notification the
  desk's tooltip describes is narrated, not backed by a real Billing integration.
- **One flat penalty rate for every product.** `penaltyPct: 0.1` in `CANCEL_TYPES["Short-Rate"]` is
  shared by Commercial Property, Auto, Home Owners, Marine Cargo, Group Health and Term Life alike.
- **Reversal is cosmetic.** Reversing a completed cancellation from the Transaction Workbench flips
  the ledger status but does not restore the policy to `Active` or claw back the refund. Shared gap,
  see [common.md](./common.md).

## Database tables used

`transactions` (type `Cancellation`) plus a `cancellation_details` table for the derived type,
reason, initiated-by, refund breakdown and notice check, per
[common.md](./common.md#database-schema).

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/policies?status=active` | Policies eligible to cancel. |
| `POST` | `/api/v1/policies/{policyId}/cancellations` | Derives type, computes refund, checks notice. |
| `POST` | `/api/v1/transactions/{txnId}/approve` \| `.../reject` | Commits or declines the held request. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.

## Sources

- [IRMI — Short-Rate Cancellation](https://www.irmi.com/term/insurance-definitions/short-rate-cancellation)
- [NAIC — Model Laws, Regulations, Guidelines and Other Resources](https://content.naic.org/sites/default/files/model-law-880.pdf)
