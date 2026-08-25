# Underwriting — R&D & Implementation Notes

Companion to [common.md](./common.md). Covers the Underwriting desk: how a submission gets a
risk score, why it referred out of automatic authority, and what an underwriter is actually
deciding when they click Approve, Decline or Refer back.

## Definition

Underwriting is the risk-acceptance gate between Submission and Bind. Every new-business
submission is scored and checked against delegated authority the moment it arrives; most clear
automatically, and the rest land on this desk for a human decision. A submission never binds
without passing this gate — there is no path that skips it.

## Two-stage triage

```
Submission arrives
      │
      ▼
Automatic gate check  ──────►  passes all four  ──►  Approved automatically, moves to Bind
      │
      │ fails one or more
      ▼
Referred to senior underwriter (this desk)
      │
      ▼
Human decision: Approve · Decline · Refer back for more information
```

Nothing about the submission changes at the moment it is referred — referral is a routing
decision, not a risk decision. The underwriter reviewing it sees exactly the same facts the
automatic gate saw, plus their own judgement.

## The four referral gates

A submission is referred if it fails **any one** of four independent checks. They are
independent deliberately — a large, clean risk should be able to refer on size alone without the
score also collapsing, and a small risk with bad claims history should refer on quality alone
regardless of premium.

| Gate | Fails when | What it is protecting against |
|---|---|---|
| **Score gate** | Composite risk score < `LOW_SCORE_REFER` (50) | A risk whose loss history or profile is poor enough that no one should bind it without review, at any premium. |
| **Authority gate** | Premium > `AUTHORITY_LIMIT` ($250,000) | Exposure large enough that it exceeds what any individual is delegated to commit the insurer to. |
| **Information gate** | Underwriting data is still outstanding | A file that cannot be priced responsibly yet — e.g. a new group health scheme awaiting census data. |
| **Effective date gate** | Requested date is backdated, or more than `EFFECTIVE_DATE_MAX_LEAD_DAYS` (60) days after submission | The one place a human-supplied date enters this system — see "Effective date: system-driven" below. |

### Effective date: system-driven, not hand-typed

No screen in this app exposes an editable "policy effective date" field anywhere in the
submission → bind → issue → renew chain. Who/what actually sets it, at each stage:

- **New business** — the date the broker or insured requested at submission (`submittedOn` on the
  ledger). The underwriter never retypes it; the effective date gate above is the enforcement —
  a request outside the system's bounds refers out rather than being silently accepted.
- **Bind** — inherited unchanged from the approved submission. `PAS.decide` never sets a date.
- **Issue** — inherited unchanged from bind. `PAS.issuePolicy`/auto-issue never touch it.
- **Renewal** — the prior term's own `expirationDate`, exactly, computed by `addYears`, never
  chosen — see [renewal.md](./renewal.md).

The one date input that exists anywhere in the app — on the Cancellation desk — sets when a
*cancellation* takes effect, a distinct, legitimately human-adjusted date. It is not the policy's
own inception date and this rule doesn't apply to it.

### Why these have to be independent (and weren't, before a fix)

Composite risk score used to be `92 − round(premium / 90,000) + noise`. Read that again: the
score was a function of **premium**. Since `AUTHORITY_LIMIT` is $250,000, any premium above it
already forced a score below 41 — below the 50 threshold — so the score gate always tripped
before the authority gate could ever be the reason for a referral. The "premium exceeds delegated
authority" message could never actually be returned; it was dead code wearing a live label. The
current model removes premium from the score entirely (see below), which is what makes all four
gates genuinely orthogonal.

## The composite risk score

`PAS.riskFactors(policy)` in `store.js` returns both the score and the full derivation, so the
desk can show an underwriter exactly what it is made of rather than asserting a number.

```
score = clamp(5, 97,  productBase
                     + atFaultClaims   × −11
                     + otherClaims     ×  −4
                     + min(claimFreeYears × 4, 20)
                     + priorCancellations × −8
                     + (nonPayment ? −12 : 0)
                     + max(0, endorsements − 2) × −3
                     + (newBusiness ? −6 : 0)
                     + (infoPending ? −6 : 0))
```

**Product base** starts the score before any history is applied, because risk quality varies by
line before a single claim is on file:

| Product | Base |
|---|---|
| Term Life | 84 |
| Home Owners | 80 |
| Comprehensive Auto | 74 |
| Commercial Property | 72 |
| Group Health | 70 |
| Marine Cargo | 68 |

**Prior cancellations** are counted two ways and added together: whatever is disclosed on the
submission (`risk.priorCancellations`) plus completed Cancellation transactions already on this
policy's own ledger — a policy that has been cancelled and reinstated before carries that history
forward automatically, without anyone re-keying it.

**Endorsement frequency** only penalises *excess* change — the first two completed endorsements
are free (`endorsementAllowance: 2`), on the reasoning that a couple of mid-term adjustments is
normal life, not an instability signal.

### Worked example

Kevin Alvarado, Comprehensive Auto, premium $2,150, two at-fault claims and one other claim
in the prior term, new business:

```
Comprehensive Auto base                     74
At-fault claims (2) × −11                  −22
Other claims (1) × −4                       −4
New business, no loss history               −6
                                           ────
Composite score                             42
```

42 is below the 50 refer threshold, so this submission fails the score gate — and *only* the
score gate; its premium is well inside authority and its file is complete. The desk shows this
distinction explicitly, because the fix is different for each: a score failure needs a human
underwriting judgement, an authority failure needs sign-off from someone with a higher limit, and
an information failure needs the file completed, not a risk decision at all.

## The decision

Once on the desk, the underwriter has three actions:

- **Approve & bind** — moves the policy to `Bound` and creates a binder (30-day provisional cover,
  one default subjectivity). See [issue.md](./issue.md) for what happens next.
- **Decline** — the submission is closed out. A written rationale is required; it is disclosable
  to the applicant, so the UI will not let this go through blank.
- **Refer back for more information** — sends the request back without a bind/decline decision,
  for cases where the file itself is incomplete rather than the risk being unacceptable.

## What's implemented, and what changed

| Capability | Status |
|---|---|
| Four independent referral gates | Implemented. Verified with one seeded submission per failure mode plus direct unit tests of the effective-date gate — `tests/render.test.js`. |
| Effective date system-driven, enforced by its own gate | Implemented — see "Effective date: system-driven" above. |
| Score derived from risk factors, not premium | Implemented. `PAS.riskFactors` / `PAS.PRODUCT_BASE` / `PAS.RISK_WEIGHTS` in `store.js`. |
| Decision screen shows the full score derivation | Implemented — every weighted line is rendered, not just the total. |
| Decline requires a written reason | Implemented — the action is disabled until a note is entered. |
| Pending referral duplicating a score in the ledger meta | **Removed.** A pending Underwriting transaction no longer carries its own `meta.score` — the score is always read live from `riskFactors`, so the ledger and the desk cannot disagree. A *completed* decision still records the score at the time it was made, which is a different, intentional thing: a historical fact, not a live computation. |

## Known gaps

- **The weights are hand-picked, not actuarially derived.** `RISK_WEIGHTS` and `PRODUCT_BASE` are
  a reasonable starting shape, not a calibrated rating model. In production these belong in a
  versioned, product-scoped configuration a pricing team owns — see the "Product & rating engine"
  module noted in the audit — not as constants in application code.
- **No external bureau or claims-history feed.** `risk.atFaultClaims` etc. are currently seeded by
  hand per policy. A real system pulls this from a claims system and possibly a credit/insurance
  bureau at submission time.
- **The information gate has no workflow.** Referring back for more information does not create a
  trackable "waiting on applicant" state with its own SLA — it is recorded as a decision outcome
  and nothing more.

## Database tables used

No dedicated `submissions` table exists in the schema in [common.md](./common.md) — a submission
is simply a `policies` row with `current_status = 'Referred'`, whose ledger's first transaction is
type `Submission` and whose second (if referred) is type `Underwriting`, `status = 'Pending'`.
`meta` on that row carries the risk-factor inputs at the time of referral.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/underwriting/queue` | Submissions referred out of automatic authority. |
| `POST` | `/api/v1/submissions/{id}/underwriting-decision` | Records approve, decline or refer back. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.
