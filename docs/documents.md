# Documents — R&D & Implementation Notes

Companion to [common.md](./common.md). Covers document generation and versioning — a pattern
shared across several modules rather than a decision desk of its own.

## Definition

Every generated artefact — a policy schedule, a certificate of insurance, a cancellation notice —
is templated, regenerated on the transaction that produces it, and stored with an incrementing
**version** number rather than being overwritten. The Document Library page is a read-only index
across the whole book: every artefact, tied back to the policy and the transaction that produced
it.

## Why versioning, specifically

> "Regulators ask what the customer held on a given date — versioning is how you answer."

A schedule is not a live view of the policy; it is a snapshot as of the moment it was generated.
When a renewal or a material change regenerates it, the old version is not replaced — a new row
is added with `version` incremented. This is what lets the system reconstruct, for any past date,
exactly which document a policyholder was actually holding — the same append-only reasoning behind
the transaction ledger itself (see [common.md](./common.md#patterns-shared-by-every-mid-term-transaction)).

## What generates a document today

`PAS.generateDoc(id, name, type)` and the type-specific calls that produce it:

| Transaction | Documents produced |
|---|---|
| Issue | Policy schedule (v1) + Certificate of insurance (v1) |
| Cancellation, approved | Cancellation notice (v1) |
| Renewal, approved | Policy schedule, version incremented to the new term number |
| Endorsement, approved | **None** — see below |

Version increments **per document name, per policy** — a Policy schedule regenerated on a policy's
third renewal is version 3, independent of how many Certificates or Notices that same policy has
accumulated.

## What's implemented, and what's a gap

| Capability | Status |
|---|---|
| Version increments correctly per document name | Implemented — `generateDoc` counts existing documents of the same `name` and increments. |
| Document library indexes every artefact across the book | Implemented — one flat, filterable table. |
| Regeneration wired to Issue, Cancellation, Renewal | Implemented. |
| Regeneration wired to Endorsement | **Missing.** Real PAS practice regenerates the schedule whenever a material change lands — an approved material endorsement in this app changes the premium but produces no updated schedule, so the document library can silently fall out of step with the actual contract. Already tracked as a gap in [endorsement.md](./endorsement.md). |
| Download | **Cosmetic only.** Each row shows a PDF download affordance; no file exists behind it — the app stores metadata only, by design (see the `blob_uri` field below), and this prototype has no blob backing at all. |

## Known gaps

- **Endorsement approval does not regenerate documents.** This is the single biggest correctness
  gap in this module, and it is the endorsement flow's problem to fix, not this one's — tracked in
  [endorsement.md](./endorsement.md#known-gaps-candidates-for-a-follow-up-pass).
- **No actual file storage.** Every document row is metadata; there is no blob, so "download" is
  decorative. Acceptable for a prototype, but worth being explicit about — a demo should not imply
  a working download.

## Database tables used

`documents`, per [common.md](./common.md#database-schema) — `document_id`, `policy_id` /
`policy_term_id` (nullable, since a cancellation notice is not term-scoped), `name`, `type`,
`version`, `blob_uri` (pointer into Blob Storage; unused in this prototype), `generated_at`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/documents` | Document metadata across the book. |
| `POST` | `/api/v1/policies/{policyId}/documents` | Renders and stores a new document version. |

See [api-reference.html](../api-reference.html) in the app for the generated, always-current
version of this table.
