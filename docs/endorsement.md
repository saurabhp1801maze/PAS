# Endorsements — R&D & Implementation Notes

See [common.md](./common.md) for the shared PAS lifecycle and patterns this builds on.

## Definition

An endorsement (Guidewire calls it a **Policy Change**) is a mid-term modification to an in-force
policy — anything from a plain address update to adding a named driver, changing a coverage limit,
or altering the insured item itself. It does not create a new term or a new policy number; it
amends the current one, `+`/`−` premium prorated for the remaining time in force.

## Who can request one, and how

Per the request-then-decide pattern in [common.md](./common.md), an endorsement always starts as a
request:

| Initiator | Typical channel |
|---|---|
| Insured | Self-service portal, phone, email |
| Broker / Producer | Broker portal, phone, email |
| Underwriter (internal) | Portfolio review flagging a needed correction |
| Ops on someone else's behalf | Logging a call/email/fax into the same queue — never executing it directly |

Ops logging a request never skips the decision step — it lands in the same Pending queue as a
self-service submission. This prototype's `LogRequestForm` on the Endorsement Desk models exactly
this: it only ever calls `raiseRequest`, never applies anything.

## Materiality: the central design fork

Every endorsement is triaged into one of two buckets, and the bucket decides the workflow:

- **Non-material / minor** — address change, contact detail update, correcting a typo. No risk
  change, often no premium impact, can be close to touchless.
- **Material** — anything that changes the underlying risk: adding/removing a driver, a vehicle
  change, a coverage or limit change. These require underwriting sign-off before they are applied
  — they are never auto-applied, because they change what is actually insured, not just paperwork.

This prototype encodes the fork directly in the request form (`materiality: "Minor" | "Material"`)
and in copy across the desk ("Material changes require re-underwriting before they can be
approved"), but — see **Gaps** below — doesn't yet *enforce* a different workflow for the two paths
beyond a red pill in the UI.

## Process flow (target / real-world)

```
Request received (insured/broker/UW/ops-logged)
        │
        ▼
Materiality triage  ──(non-material)──► light validation ──► apply ──► document reissue
        │
   (material)
        ▼
Underwriting review (re-assess risk, may re-run rating)
        │
        ▼
Premium proration for remainder of term
        │
        ▼
Approve ──► apply: increment policy version, adjust premium,
            regenerate documents, publish premium delta to Billing,
            publish `policyEndorsed` event
   │
   └─ Decline ──► policy unchanged, requester notified
```

## Pro-rata premium calculation

The industry-standard proration formula, and the one this domain generally follows:

```
pro_rata_factor   = remaining_days_in_term / total_days_in_term
premium_delta     = full_period_rate_delta × pro_rata_factor
```

Insurers price the *delta* using either the rate in effect at the original policy effective date
or the rate in effect at the endorsement's effective date, per their own standard practice — but
always applied only to the **remaining** portion of the term, never the whole annual premium. This
prototype currently takes the operator-entered `premiumImpact` as an already-prorated figure
(entered directly on the request form) rather than computing it from term dates — a reasonable
simplification for a demo, but the first thing a real rating engine integration would replace.

## Data model implications

- **New ledger row, not an edit.** An approved endorsement is a new `Completed` transaction
  appended to `policy.history` — the request row is never mutated into a different kind of record,
  it's marked `Completed`/`Rejected` alongside a fresh detail string.
- **Policy version increment.** Each applied endorsement is logically a new version of the policy
  aggregate (used to answer "what did they hold as of date X").
- **Premium is cumulative, not replaced.** Approving adds `premiumImpact` to the policy's current
  premium — it does not overwrite it (a renewal, by contrast, *does* replace the premium wholesale,
  since it's pricing a whole new term — see [renewal.md](./renewal.md)).

## What's implemented in this prototype, and what was fixed

`EndorsementList` → `LogRequestForm` → `raiseRequest("Endorsement", …)` puts a `Pending`
transaction on the ledger. `EndorsementDecision` shows the requested change, its materiality, and a
computed "premium after" preview, then approving/declining calls `decideTxn`.

**Bug found and fixed:** `decideTxn` used to only flip the transaction's `status` — it never
actually added `premiumImpact` to `policy.premium`, despite the same screen showing a correctly
computed "Premium after" figure. The fix (in `src/App.jsx`, the `decideTxn` function bound to
`PolicyLifecyclePlatform`):

- Adds `held.meta.premiumImpact` to `p.premium` when an endorsement is approved.
- Rewrites the transaction's detail text to state the outcome — falling back to *appending* the
  outcome (`"Approved and applied. Premium adjusted +$240."`) when the original detail doesn't
  contain the literal word `"HELD"`, instead of the previous regex silently no-op'ing for anything
  raised through the live "Log a request" form (which never generates that word).
- Verified end-to-end with a headless-browser run: approving Melissa Shaw's "Add driver" request
  (POL-2025-09112, `premiumImpact: 240`) now moves the policy's stored premium from $2,780 to
  $3,020, visible in the Policy Register, the policy detail ledger, and the dashboard's
  gross-written-premium roll-up.

## Database tables used

Built on the shared schema in [common.md](./common.md#database-schema). An endorsement never gets
its own row anywhere except the ledger — everything else is metadata riding alongside it:

- **`transactions`** — one row per endorsement, `type = 'Endorsement'`. `meta` jsonb carries
  `changeType`, `materiality`, `premiumImpact`, `initiatedBy`, `channel`, `requestNote`.
- **`endorsement_details`** *(optional normalized child, for reporting/joins without parsing
  `meta`)* — `transaction_id` FK, `change_type`, `materiality`, `premium_impact`,
  `applied_at`. Kept in sync with `transactions.meta` at write time; queried when a report needs
  "material endorsements this quarter by change type" without a jsonb scan.
- **`policy_terms.premium`** — updated in place on approval (the endorsement adds a delta to the
  *current* term's premium; it does not create a new term the way a renewal does).
- **`documents`** — a new `Schedule` version should be inserted on approval of a material
  endorsement (see **Known gaps** — not yet wired even in the target design's write path).

## API contracts

Formalizes the endpoints the Endorsement Desk already calls in the prototype
(`src/App.jsx`), plus the one the reference panel implies but the app doesn't yet call.

### `GET /api/v1/endorsements?status=requested`

Change requests awaiting a decision. Backs the "Requests awaiting decision" table on the desk.

```json
// 200 response (excerpt)
[
  {
    "transactionId": "TXN-...",
    "policyId": "POL-2025-09112",
    "holder": "Melissa Shaw",
    "changeType": "Add/remove driver",
    "materiality": "Material",
    "premiumImpact": 240,
    "initiatedBy": "Broker/Producer",
    "channel": "Broker portal",
    "submittedOn": "2026-08-18",
    "requestNote": "Please add Ryan Cole as a named driver from next week."
  }
]
```

### `POST /api/v1/policies/{policyId}/endorsements` — *gap, not yet in the prototype*

Raises a new endorsement request — what the desk's "Log a request" form and a real self-service
portal submission should both call. Today `raiseRequest` in `src/App.jsx` only updates client
state; it never calls an endpoint at all, which is fine for a demo but is the first thing a real
backend integration adds. (Contrast with `renewal-desk`, whose reference panel already documents an
analogous `POST /api/v1/policies/{policyId}/renewals` — endorsement has no documented equivalent
today, which this closes.)

```json
// request
{
  "changeType": "Add/remove driver",
  "materiality": "Material",
  "premiumImpact": 4200,
  "initiatedBy": "Broker/Producer",
  "channel": "Broker portal",
  "requestNote": "Please add Ryan Cole as a named driver from next week."
}
// 201 response
{ "transactionId": "TXN-...", "status": "pending" }
```

### `POST /api/v1/transactions/{txnId}/approve` | `.../reject`

What `EndorsementDecision` in `src/App.jsx` actually calls today. Approving must, per the bug fixed
in this pass, add `premiumImpact` to the policy term's premium as part of the same write — not just
flip the transaction's status.

```json
// request (approve)
{ "decision": "approved" }
// 200 response
{
  "txnId": "TXN-...",
  "status": "completed",
  "premiumDelta": { "amount": 4200, "currency": "INR" },
  "policyVersion": 5
}
```

Publishes `policyEndorsed` → **Billing, Documents** (see the event/consumer map in
[common.md](./common.md#event--consumer-map)) on approval only; a rejection publishes
`transactionRejected` → **CRM** instead, and the policy term is left untouched.

## Known gaps (candidates for a follow-up pass)

- **No enforced re-underwriting step for material endorsements.** The UI labels a change
  "Material" and shows a warning, but any user can still click "Approve & apply" without a distinct
  re-underwriting sub-flow (contrast with `UnderwritingDecision`, which has its own dedicated
  score/authority gate screen).
- **No document regeneration on endorsement approval.** Issuance, cancellation and renewal all
  append a new document row; approving an endorsement currently does not, even though real PAS
  practice regenerates the schedule whenever a material change lands.
- **Reversal doesn't undo the premium.** `reverseTxn` (used from the Transaction Workbench) appends
  a compensating ledger row and marks the original `Reversed`, but does not subtract the
  endorsement's `premiumImpact` back out of `policy.premium` — so "reversing" an approved
  endorsement leaves the premium at its post-endorsement value. This is a shared gap with
  cancellation/renewal reversal, tracked at the platform level in [common.md](./common.md).
- **`premiumImpact` is operator-entered, not rating-engine-derived** (see proration section above)
  — fine for a demo, a real integration point later.

## Sources

- [Guidewire PolicyCenter — Policy Transactions Explained (Policy Change / Endorsement)](https://learnguidewire.com/a-complete-guide-to-policy-transactions-in-guidewire-policycenter/)
- [Guidewire — "Endorse a policy" developer docs](https://docs.guidewire.com/cloud/in/20241/portaldev/PortalDevelopment/topics/c_agent_portal_endorse_policy.html)
- [Insurity — Prorating and Adjustments](https://knowledgecenter.insurity.com/bridgespecialty/latest/doc/content/030-Master%20Covers/Prorating%20and%20Adjustments.htm)
- [RGC — Insurance Endorsement Proration Calculator](https://www.rgcins.com/proration-calculator-for-insurance-policy-endorsements.html)
- [Winsurtech — Insurance Endorsements: Types and Their Impact on Premiums](https://winsurtech.com/blog/insurance-endorsements-types-and-their-impact-on-premiums/)
- [Decerto — Policy Administration System: The Core of Digital Insurance](https://www.decerto.com/us/post/policy-administration-system-the-core-of-digital-insurance)
