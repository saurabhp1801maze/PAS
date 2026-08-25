# Bind & Issue — R&D & Implementation Notes

Companion to [common.md](./common.md) and [underwriting.md](./underwriting.md). Covers the gap
between Approve and a formal, in-force contract — a gap real insurance practice treats as legally
significant, not administrative.

## Definition

**Bind** is the moment cover attaches. The instant an underwriter approves a submission, the
insurer is on risk — but only provisionally, under a **binder**, which is a short-lived promise of
cover pending paperwork. **Issue** is the moment that promise becomes a formal contract: the
policy schedule and certificate are generated, and the binder is superseded.

These are legally distinct events, and the gap between them is exactly where a real PAS earns its
keep — it is the state where cover is live but the contract does not yet exist, so every
outstanding condition on the risk has to be tracked and closed before the paperwork can be
finalised.

## Process flow

```
Underwriting: Approve
      │
      ▼
Bound  ── binder issued (30-day provisional cover) ── subjectivities attached, most unmet
      │
      │  each subjectivity is satisfied (evidence collected, checkbox ticked here)
      ▼
All subjectivities met, binder not expired
      │
      ▼
Issue  ── five gates checked ── schedule + certificate generated ── policy becomes Active
```

A policy can sit in `Bound` for a while — the seed book's four bound policies each carry at least
one unmet subjectivity (a safety certificate, a fleet schedule confirmation, an inspection report)
that has to be evidenced before the desk will let issue proceed.

## Subjectivities

A subjectivity is a condition attached at bind time that must be satisfied before the contract can
be formalised — e.g. "Electrical safety certificate", "Fire safety certificate". Each one is a
`{ label, met }` pair on the binder. `PAS.toggleSubjectivity(id, i)` flips one; in production each
would be evidence-backed (a document upload, a third-party confirmation) rather than a bare
checkbox, which the desk copy says outright.

## The five issue gates

`issue-decision.html` evaluates all five every time the screen renders, and the Issue button is
**disabled**, not merely warned, while any gate fails:

| Gate | Checked against |
|---|---|
| Status is `Bound` | Only a bound risk can be issued — issuing twice, or issuing something never bound, is refused. |
| Binder not expired | `daysBetween(today, binder.expiryDate) ≥ 0`. Binders run 30 days from bind. Past this, the risk must be re-underwritten and re-bound rather than issued on a stale binder. |
| All subjectivities satisfied | Every `{ met: true }` on the binder. |
| Compliance & sanctions clear | Screening check — always passes in this prototype (no real screening exists). |
| Document template available | Always passes in this prototype (no real template registry exists). |

The first three are real, computed gates. The last two are placeholders for integrations that
don't exist yet — see Known gaps.

## What issuing actually does — and who triggers it

Issue is automated: nothing waits on a manual click. The moment all five gates are true — at
bind, if the binder starts with nothing outstanding, or the instant the last subjectivity is
cleared — the system issues the policy on its own. `PAS.issueGatesPass(p)` is the exact five-gate
check the desk renders; `doIssue` is the compound operation it triggers, from two call sites:

- **`PAS.decide`'s Approve branch** — the moment a submission binds, if its binder needs nothing
  further (the seeded default is one subjectivity, "Signed proposal form", already met), the
  policy issues in the same step. Approve → bind → issue can happen with zero manual clicks in
  between.
- **`PAS.toggleSubjectivity`** — clearing the last unmet subjectivity on an already-bound policy
  triggers the same check immediately.

`PAS.issuePolicy(id)` still exists as a manual fallback behind the Issue desk's button, for the
rare case gates were already true but nothing triggered the automatic path. In practice this
means the desk's real job is surfacing the *blocked* policies — a policy with nothing outstanding
generally never sits on this desk waiting for a click.

Either path — automatic or the manual fallback — runs the same compound operation:

1. Moves `status` from `Bound` to `Active`.
2. Appends an `Issuance` transaction to the ledger — titled "Policy issued — automatically" on the
   automatic path, so the ledger itself records which one happened, not just that issue occurred.
3. Generates two documents — a Policy schedule and a Certificate of insurance, both version 1.
4. (In the target architecture) publishes `policyIssued` to Billing, Documents and Reinsurance.

Nothing here is reversible through a simple undo — see the reversal gap in
[common.md](./common.md).

## What's implemented, and what's a placeholder

| Capability | Status |
|---|---|
| Subjectivity gating on issue | Implemented — issue is genuinely blocked, not just warned, while any subjectivity is unmet. |
| Binder expiry gating on issue | Implemented — `daysBetween` check against `binder.expiryDate`. |
| Automatic issuance the moment all gates pass | Implemented — from bind and from the last subjectivity clearing. Tested directly (not just through the UI) in `tests/render.test.js`. |
| Document generation on issue | Implemented — schedule + certificate, versioned, on both the automatic and manual path. |
| Compliance & sanctions screening | **Placeholder.** Always reports clear. No real screening integration exists — this means automatic issuance is currently trusting a gate that does no real work; see Known gaps. |
| Document template resolution | **Placeholder.** Always reports available. No real template registry exists. |
| Re-bind flow for an expired binder | **Missing.** The gate correctly blocks issue once a binder has expired, but there is no screen or action that re-binds the risk — the policy is simply stuck failing that gate. |

## Known gaps

- **Automating issuance raises the stakes on the two placeholder gates.** While a human clicked
  Issue, an always-clear compliance gate was a passive gap. Now that clearing a subjectivity can
  issue a policy with nobody reviewing that specific moment, an unscreened issuance is one click
  further from a human than it was — this is the gap to close before automatic issuance would be
  safe to rely on for real, not just this app's compliance-screening placeholder specifically.
- **No re-bind action.** An expired binder is detected and blocks issue, but nothing in the app
  lets an operator extend or replace it. In practice this would route back through a shortened
  re-underwriting step.
- **Subjectivities are a checkbox, not evidence.** Toggling one records no evidence reference, no
  timestamp beyond the session, and no `met_by` — all three columns already exist in the
  `subjectivities` table in [common.md](./common.md)'s schema and are simply unpopulated here.
- **Compliance/sanctions and template resolution are unconditional passes.** They exist as gate
  rows so the five-gate shape is visible, but neither does real work.

## Database tables used

`binders` and `subjectivities`, per [common.md](./common.md#database-schema). `binder_id` links to
`policy_terms`; each subjectivity carries `label`, `met`, `met_at`, `met_by`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/policies?status=bound` | Bound but not yet issued. |
| `POST` | `/api/v1/policies/{policyId}/issue` | Runs the issue gates, generates the pack. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.
