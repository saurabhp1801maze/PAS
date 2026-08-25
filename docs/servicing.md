# Servicing — R&D & Implementation Notes

Companion to [common.md](./common.md). Covers the Servicing desk — the deliberately simplest
module in the app, and the one whose whole design rests on a single line drawn between a note and
an endorsement.

## Definition

Servicing logs an operational request against a policy that does **not** change the contract —
an address confirmation call, a duplicate certificate emailed for customs clearance, a billing
query resolved. It is the highest-volume, lowest-consequence transaction type: no premium moves,
no coverage changes, no approval workflow. It writes one row to the ledger and nothing else.

## The line it exists to draw

> "Anything that moves a rating factor must become an endorsement, not stay a note."

This sentence, taken directly from the desk's own copy, is the entire design of this module. Every
other transaction type in this app has a decision step because it changes something material.
Servicing has no decision step because, by definition, it is not allowed to.

`SLA` categories that touch policy data — currently just **Contact update** — trigger a warning
on the log form: the request can still be logged here for the trail, but the underlying change
(e.g. an address that also happens to be a rating factor for the product) must go through
Endorsement to actually take effect.

## Categories and SLA targets

```
SLA = {
  "Document request": 24 hours,
  "Inquiry":            8 hours,
  "Contact update":    24 hours,   ← flagged: may need to escalate to Endorsement
  "Billing":           48 hours,
  "Correspondence":    72 hours,
}
```

Each category carries its own turnaround commitment — they are deliberately not uniform, since a
duplicate document and a billing dispute are not the same kind of promise to the customer.

## What logging a request does

`PAS.logService(id, { category, channel, notes, sla })` appends one `Servicing` transaction with
`status: "Completed"` — there is no Pending state for this module, because there is nothing to
decide. Four channels write to the same ledger: Phone, Email, Portal, Branch.

## What's implemented, and what's a gap

| Capability | Status |
|---|---|
| Logged against any policy in any lifecycle state | Implemented — servicing is the one module available regardless of status. |
| Category-specific SLA target displayed | Implemented. |
| Escalation warning for rating-relevant categories | Implemented as a UI warning only — there is no enforced link from a Servicing entry to a follow-on Endorsement; the operator has to act on the warning themselves. |
| SLA measured against elapsed time | **Not implemented.** The desk's own KPI row hardcodes `"Open SLA breaches": 0` rather than comparing `recordedAt` against the category's target — see the dashboard rebuild for the same class of issue at portfolio level. |
| Aging / queue view of open requests | **Missing.** Every request is logged as immediately `Completed`, so there is no concept of an open servicing request to age at all — a real desk would have some categories that take real time to close out (e.g. a billing dispute pending resolution) rather than being instantaneous. |

## Known gaps

- **No genuine SLA breach detection.** The category → hours map exists and is displayed per
  request, but nothing computes whether a request is currently within or past its target — the
  figure shown on the desk is a literal zero, not a query result.
- **No open/closed state.** Every servicing entry is born `Completed`. A billing dispute or a
  document request that takes days to actually fulfil has no way to be represented as "logged but
  not yet resolved."

## Database tables used

`transactions` (type `Servicing`). No dedicated servicing table exists in
[common.md](./common.md)'s schema — category, channel and SLA target live entirely in `meta`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/service-requests` | The servicing ledger. |
| `POST` | `/api/v1/policies/{policyId}/service-requests` | Logs a request against its SLA. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.
