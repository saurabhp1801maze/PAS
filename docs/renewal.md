# Renewals — R&D & Implementation Notes

See [common.md](./common.md) for the shared PAS lifecycle and patterns this builds on.

## Definition

A renewal creates a **new term on the same policy** — the policy number, holder and history carry
forward; only the term dates, term number and (usually) the premium change. This is what
distinguishes it from Rewrite (a genuinely new policy replacing an old one) in the Guidewire
transaction taxonomy referenced in [common.md](./common.md): renewal is continuity, not a fresh
underwriting relationship.

## Who triggers it, and how

Same request-then-decide shape as endorsement/cancellation/reinstatement (see
[common.md](./common.md)): renewal is **decided against a confirmed request, never started cold
from the desk.** The trigger is always an external confirmation —

| Initiator | What confirms intent |
|---|---|
| Insured | Self-service portal, responding to a renewal notice |
| Broker / Producer | Confirms on the client's behalf ahead of the notice deadline |
| System (automated) | A renewal-reminder job, where the product supports auto-renewal |

— and only then does an underwriter re-price and decide it.

## Process flow (target / real-world)

```
Renewal notice generated (X days before expiry, or auto-renewal reminder)
        │
        ▼
Insured/broker confirms intent to renew  ── (or: no confirmation → chase, eventual non-renewal) ──►
        │
        ▼
Re-underwriting: pull claims/loss history, re-run risk score
        │
        ▼
Re-rating: recompute premium from current rating factors + loss experience + trend/inflation
        │
        ▼
Renewal offer (new premium, same or adjusted terms)
        │
   ┌────┴────┐
   ▼         ▼
Approve   Decline
   │         │
   ▼         ▼
New term  Non-renewal notice served,
created   policy lapses at expiry
(term N+1)
```

## Notice-period practice

- **US state law pattern** (useful as an outside reference point, not what this prototype
  targets): insurers must generally give **30–60 days' advance written notice** of non-renewal
  specifically, stating the actual underwriting reason.
- **IRDAI (India) pattern**, which is what this prototype's `RENEWAL_LEAD_DAYS = 45` and "notice
  window" language are modeling: insurers are expected to *endeavor* to notify ahead of expiry
  rather than being bound to one fixed statutory number across all products; the harder edges are
  around **continuity**, not the notice itself — a grace period lets a lapsed policy be renewed
  without a coverage-continuity break (though cover is not in force during the gap), and motor NCB
  specifically survives a lapse of up to 90 days.
- Either way, the number that matters operationally is a **lead time before expiry**, used to (a)
  flag policies that need a notice chased and (b) flag a compliance exception once a renewal is
  decided *after* that window has already closed.

## Re-underwriting & re-rating factors

The renewal decision is a fresh underwriting decision on an existing risk, not a rubber stamp:

- **Loss ratio** (claims paid ÷ premium earned) is the single biggest factor underwriters weigh —
  a loss ratio that's run persistently high (this prototype's Bharat Steel Works seed record cites
  "140% over two terms") is exactly the kind of thing that pushes a renewal toward decline or a
  large increase rather than a routine roll-forward.
- **Claims frequency/severity** and **endorsement frequency** during the expiring term (frequent
  mid-term changes can itself signal an unstable risk).
- **Market-level rate movement** — carriers also raise renewal rates portfolio-wide when their
  book's loss ratio trends up in a region or line, independent of any one policyholder's own
  history.
- **Updated risk score** — re-run at every renewal, never carried forward from the prior term.

This prototype's `RenewalDecision` screen surfaces exactly this shape: it re-runs `riskScore`,
shows endorsement/cancellation counts from the expiring term as underwriting context, and suggests
a premium (`+12%` if score < 60, `−3%` if score > 85, `+5%` otherwise) that the underwriter can
override — a simplified stand-in for a real rating engine call.

## Non-renewal

Declining a renewal is not a cancellation — the policy simply lapses at its existing expiration
date rather than being cut short. Regulators generally expect the insurer to state the actual
reason and serve it with the same advance notice as a renewal confirmation would need. This
prototype models this correctly: declining sets `status: "Non-renewed"` rather than `"Cancelled"`,
and the transaction detail explicitly records that the non-renewal notice period was served.

## Data model implications

- **Term number increments**, not the policy ID — `POL-2024-00187` stays `POL-2024-00187` across
  every renewal, only `termNumber` climbs.
- **Effective/expiration dates roll forward** — the new term's effective date is the old term's
  expiration date.
- **Premium is replaced, not accumulated** — unlike an endorsement (which adds a delta), a renewal
  substitutes the whole premium for the new term, since it is pricing a full new period, not a
  partial change to the existing one.
- **History is continuous** — the full transaction ledger (all prior terms' endorsements,
  servicing, prior renewals) stays attached to the one policy record; a renewal never starts a new
  ledger.

## What's implemented in this prototype (verified correct — no fix needed)

`RenewalList` → `LogRequestForm` → `raiseRequest("Renewal", …)` creates a `Pending` confirmation.
`RenewalDecision` re-scores the risk, suggests a premium, and on approval `decideRenewal`:

- Increments `termNumber`.
- Rolls `effectiveDate` to the old `expirationDate`, and computes a new `expirationDate`.
- Replaces `premium` with the decided figure.
- Appends the next-version policy schedule document.
- On decline, sets `status: "Non-renewed"` and records that the notice period was served.

This was re-checked specifically during the endorsement bug-fix pass (prompted by an initial code
review that flagged endorsement, not renewal, as broken) and confirmed to already apply all of the
above correctly — no change was made here.

## Database tables used

Built on the shared schema in [common.md](./common.md#database-schema). Renewal is the one flow
that writes a **new row** in `policy_terms` rather than only updating the existing one:

- **`transactions`** — one row per renewal decision, `type = 'Renewal'`, `meta` jsonb carries
  `previousPremium`, `newPremium`, riskScore snapshot, and (on decline) the non-renewal notice date.
- **`renewal_details`** *(optional normalized child)* — `transaction_id` FK, `previous_term_id`,
  `new_term_id`, `previous_premium`, `new_premium`, `risk_score`, `notice_served_on`. Exists for the
  same reason as `endorsement_details`: reporting/joins without parsing jsonb.
- **`policy_terms`** — approval **inserts a new row** (`term_number = old + 1`,
  `effective_date = old.expiration_date`, the new `expiration_date`, the decided `premium`) and
  updates `policies.current_term_id` to point at it. The old term row is never edited — it stays
  exactly as priced, which is what lets the ledger answer "what did term 2 actually cost" after
  term 4 is in force.
- **`policies.current_status`** — set to `Active` (approve) or `Non-renewed` (decline).
- **`documents`** — a new `Schedule` version is inserted, versioned to the new `term_number`.

## API contracts

Formalizes the endpoints the Renewal Desk calls, and flags one inconsistency found while writing
this up: the desk's own "Endpoints on this screen" reference panel (`PAGE_APIS` in `src/App.jsx`)
documents `POST /api/v1/policies/{policyId}/renewals` as the renewal-creating call, but
`RenewalDecision`'s actual code path calls `POST /api/v1/transactions/{txnId}/approve`. Both are
legitimate — they're just two different steps — but the reference panel currently only shows the
*create* endpoint and never the *decide* endpoint the code actually uses. The contracts below
separate the two explicitly so a real backend implements both.

### `GET /api/v1/renewals/upcoming`

Policies inside the notice window (`RENEWAL_LEAD_DAYS`), plus any with a confirmed request already
pending. Backs both tables on the desk (confirmed requests, and "approaching expiry, no
confirmation yet").

```json
// 200 response (excerpt)
[
  {
    "policyId": "POL-2024-00187",
    "holder": "Priya Deshmukh",
    "expirationDate": "2026-08-20",
    "daysToExpiry": 0,
    "hasConfirmedRequest": true,
    "transactionId": "TXN-...",
    "initiatedBy": "Insured",
    "channel": "Self-service portal"
  }
]
```

### `POST /api/v1/policies/{policyId}/renewals`

Raises a confirmed renewal request — the "create" step (per `PAGE_APIS`'s documented intent). Like
endorsement's create endpoint, `raiseRequest` in `src/App.jsx` currently only updates client state
here rather than calling this endpoint; wiring it up is the same category of gap noted in
[endorsement.md](./endorsement.md).

```json
// request
{ "initiatedBy": "Insured", "channel": "Self-service portal", "requestNote": "Please renew my home policy, no changes needed." }
// 201 response
{ "transactionId": "TXN-...", "status": "pending" }
```

### `POST /api/v1/transactions/{txnId}/approve` | `.../reject`

The actual "decide" call `RenewalDecision` makes today.

```json
// request (approve)
{ "decision": "approved", "newPremium": { "amount": 62900, "currency": "INR" }, "termNumber": 3 }
// 200 response
{
  "txnId": "TXN-...",
  "newTermNumber": 3,
  "effectiveDate": "2026-08-20",
  "expirationDate": "2027-08-20",
  "events": ["policyRenewed"]
}
```

```json
// request (decline)
{ "decision": "rejected", "reason": "underwritingDecision" }
// 200 response
{ "txnId": "TXN-...", "status": "nonRenewed", "noticeServedOn": "2026-08-22" }
```

Publishes `policyRenewed` → **Billing, Documents** on approval, or `policyNonRenewed` →
**CRM, Documents** on decline (see [common.md](./common.md#event--consumer-map)).

## Known gaps / follow-ups

- ~~`addDays(expirationDate, 365)` drifts by a day across leap years~~ — **fixed.** `PAS.addYears`
  now advances the calendar year (`y+1, same month/day, clamped to the last day of that month`)
  instead of adding a fixed day count, so a term effective Feb 2028 correctly renews to Feb 2029,
  not Jan 31 2029. Verified in `tests/domain-rules.test.js` against four cases including a Feb 29
  start. `renewal-decision.js` and `decideRenewal` both call `addYears` now.
- **No loss-ratio-driven pricing model** — the renewal premium suggestion is a function of
  `riskScore` alone. `riskScore` itself no longer takes premium as an input (see
  [underwriting.md](./underwriting.md) — it is now built from claims, prior cancellations,
  endorsement frequency and information completeness), so the renewal price is at least driven by
  something real now, but the three-step multiplier below it (`score < 60 ? 1.12 : score > 85 ?
  0.97 : 1.05`) is still a cliff, not a curve, and still ignores loss ratio directly even though
  the desk's own "Claims & change history" panel displays exactly the counts a real re-rating step
  would consume. Also still missing: India Motor's No-Claim Bonus slab, which is now at least
  computable — `claimFreeYears` is tracked per policy — but not yet applied to price.
- **No automatic-renewal path** — every renewal in this prototype requires an explicit confirmed
  request; there's no modeled equivalent of an auto-renewal product where the system itself
  initiates the term rollover absent an opt-out.
- **Reversal doesn't restore the prior term.** Same shared gap as endorsement (see
  [common.md](./common.md) / [endorsement.md](./endorsement.md)): reversing a completed "Renewed
  into term N" transaction from the Transaction Workbench leaves `premium`/`termNumber`/
  `expirationDate` at their post-renewal values instead of restoring the prior term.

## Sources

- [Guidewire PolicyCenter — Policy Transactions Explained (Renewal)](https://learnguidewire.com/a-complete-guide-to-policy-transactions-in-guidewire-policycenter/)
- [Duck Creek — Policy Management Software (renewal automation)](https://www.duckcreek.com/product/policy-management-software/)
- [Select Systems — Insurance Policy Renewal Process](https://www.selectsys.com/blog/insurance-policy-renewal-process)
- [Mercury Insurance — Home Insurance Non-Renewal Notice](https://www.mercuryinsurance.com/resources/home/received-home-insurance-non-renewal-notice-here-is-what-to-do.html)
- [RiskCube — What is Loss Ratio?](https://riskcube.com/glossary/loss-ratio/)
- [Thornburg Insurance Agency — How Loss Ratio Affects Premiums](https://www.thornburgagency.com/blog/how-does-my-insurance-companys-loss-ratio-affect-business-insurance-premiums/)
- [PolicyBazaar — IRDAI Guidelines for Bike Insurance Renewal in India](https://www.policybazaar.com/motor-insurance/two-wheeler-insurance/articles/irdai-rules-for-bike-insurance-renewal-in-india/)
- [Niva Bupa — IRDAI Guidelines Explained](https://www.nivabupa.com/health-insurance-articles/irdai-guidelines-explained-india-insurance-regulations.html)
