# Policy Administration Systems (PAS) — R&D Notes

Common ground for every per-module doc in this folder (see **Per-module documentation** below):
what a PAS is, the lifecycle it manages, the patterns every mid-term transaction shares, and where
this prototype currently sits against real-world practice.

## What a PAS is

A Policy Administration System is the core platform that owns the full life of a policy — product
setup, rating, quoting, binding, issuance, endorsements, renewals, cancellations and reinstatement —
and is the system of record every other insurance system (billing, claims, reinsurance, CRM,
document generation) reads from and writes events to.

## The lifecycle every PAS implements

```
Submission → Underwriting → Bind → Issue → In-force / Servicing
                                                 │
                              ┌──────────────────┼──────────────────┐
                              ▼                  ▼                  ▼
                        Endorsement          Renewal           Cancellation
                        (mid-term)        (new term)          ──► Reinstatement
                                                                  (window-limited)
                                                                       │
                                                                       ▼
                                                                   Expiry / Non-renewal
```

Guidewire PolicyCenter — one of the two or three dominant commercial PAS platforms — names these
the standard **policy transaction types**: Submission, Renewal, Policy Change (Endorsement),
Cancellation, Reinstatement, Rewrite (replace a policy with a new one) and Reissue (correct a
document without changing coverage terms). Every PAS, whatever its vendor, is built around some
variant of this same transaction taxonomy.

## Patterns shared by every mid-term transaction

These four show up in Guidewire, Duck Creek, and the [architecture](../src/App.jsx) this prototype
sketches out under **Platform → Architecture**:

- **Append-only ledger.** A transaction is never edited in place — corrections are new,
  compensating rows. This is what lets a PAS answer "what did the customer's contract say on any
  given date" for a regulator, and it's why this prototype models `policy.history` as an
  append-only array rather than a mutable "current state" blob.
- **Bitemporal dates.** Every transaction carries both an *effective* date (the business date the
  change applies from) and a *recorded* date (the system date it was entered). The two diverge
  routinely — a cancellation can be recorded today with an effective date last week, or an
  endorsement recorded today can take effect next month.
- **Domain events over an outbox.** A state-changing transaction (issue, endorse, cancel, renew,
  reinstate) is written to the database and a domain event is queued in the same transaction, then
  published asynchronously to downstream consumers (Billing, Claims, Documents, Reinsurance, CRM).
  Read-only calls never publish. This prototype's `useApiLog`/`EVENT_FOR`/`CONSUMERS` map is a
  simplified stand-in for that outbox pattern.
- **Document regeneration & versioning.** Schedules, certificates and notices are templated,
  regenerated on any material change, and stored with an incrementing version number so a carrier
  can always prove what the policyholder actually held on a given date.

## Who can trigger a change, and how a PAS decides

Endorsement, renewal, cancellation and reinstatement all share the same shape: **a request arrives
from outside operations** (the insured, a broker/producer, an automated system trigger, or an
underwriter's own portfolio review) **and only then does an underwriter decide it.** Nothing is
self-initiated by ops on the spot — this is what this prototype's `RequestOrigin` /
`INITIATORS` / "held transaction" model is encoding. Held (pending) means the policy is
untouched until someone with authority reviews the full context and approves or declines.

## India (IRDAI) regulatory context

This prototype's premium formatting (`₹`), authority-limit language and default dates are India
(IRDAI-regulated) flavored, so a few IRDAI-specific practices are relevant background even where
the exact statutory notice period is left to product design:

- **Grace period at expiry.** A policy terminates at the end of its term but can be renewed within
  a product-specific grace period without a break in continuity of benefits — though coverage is
  *not* in force during the grace period itself.
- **No-Claim Bonus (NCB) continuity (motor).** NCB carries over if renewal happens within 90 days
  of expiry, even though cover itself lapsed.
- **Portability notice window (health).** A policyholder porting to a new insurer must apply at
  least 45 days before, but not more than 60 days before, the renewal date.
- **Renewal notice is a best-effort obligation, not a hard mandate** — insurers are expected to
  "endeavor" to notify, rather than being bound to a fixed statutory lead time the way several
  US states require (30–60 days) for non-renewal specifically.

## Vendor & standards landscape (for reference)

| System | Relevance |
|---|---|
| Guidewire PolicyCenter | Defines the transaction taxonomy referenced above; dominant P&C PAS. |
| Duck Creek Policy | Rules/date-driven renewal automation, straight-through processing for touchless endorsements. |
| Sapiens, Majesco, EIS, Insurity | Other commercial PAS platforms with broadly equivalent lifecycle models. |
| ACORD | Insurance-industry data standards body; defines standard forms and >1200 transaction/data types for carrier↔agency exchange. |

## System architecture

This is the target architecture the prototype's own **Platform → Architecture** screen sketches
(`ArchitecturePage` in `src/App.jsx`) — the React UI is a client for a real backend that doesn't
exist yet; this section makes that backend's shape explicit enough to build against.

```
┌─────────────────────────────────────────────────────────────────────┐
│  React (decision desks)                                             │
│  — the UI in src/App.jsx: dashboard, desks, decision screens        │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ HTTPS / JSON, bearer-token auth, tenant header
┌───────────────────────────────▼───────────────────────────────────────┐
│  Policy API  (.NET minimal API)                                     │
│  — request validation, auth, tenant scoping, ETag/If-Match handling │
└───────────────────────────────┬───────────────────────────────────────┘
┌───────────────────────────────▼───────────────────────────────────────┐
│  Application layer  — use cases / validators                        │
│  — one handler per transaction type (ApproveEndorsement,             │
│    CreateRenewal, ApproveRenewal, ...); orchestrates the domain,      │
│    never contains business rules itself                              │
└───────────────────────────────┬───────────────────────────────────────┘
┌───────────────────────────────▼───────────────────────────────────────┐
│  Domain layer  — aggregates & invariants                             │
│  — Policy aggregate enforces: material endorsements never            │
│    auto-apply, fraud cancellations never reinstate, issue requires   │
│    all subjectivities met, etc. (the rules already encoded in this   │
│    prototype's pure functions — cancelQuote, underwritingDecision,   │
│    reinstatementEligibility — belong here in the real system)        │
└───────────────────────────────┬───────────────────────────────────────┘
┌───────────────────────────────▼───────────────────────────────────────┐
│  EF Core (repository)  →  Azure SQL (system of record)               │
│  — one DB transaction writes the ledger row AND the outbox row       │
│    together (see Database Schema below) — this is what makes the    │
│    "domain rules run" step in the API lifecycle panel atomic         │
└─────────────────────────────────────────────────────────────────────┘

Side systems, all fed from the same write path:
 • Camunda 8      — runs the approval workflow behind every held transaction
                    (material endorsements, fraud cancellations, authority referrals)
 • Service Bus    — outbox dispatcher publishes policyEndorsed / policyRenewed / ...
                    to Billing, Claims, Documents, Reinsurance, CRM (see Consumers table below)
 • Blob Storage   — generated schedules/certificates/notices; DB keeps only metadata
 • Redis          — caches dashboard aggregates & the renewal pipeline so KPI reads
                    don't recompute per request
```

### Request lifecycle (what one "Approve" click does end to end)

This is the exact five-step chain the prototype's `ApiLifecycle` panel narrates for every action —
formalized here as the real request path an "Approve endorsement" or "Approve renewal" click would
take against the architecture above:

1. **User action** — operator clicks Approve on a held transaction.
2. **Request leaves the browser** — `POST /api/v1/transactions/{txnId}/approve` (see per-desk API
   contracts in [endorsement.md](./endorsement.md) and [renewal.md](./renewal.md)).
3. **Domain rules run** — the application layer loads the `Policy` aggregate, the domain enforces
   its invariants (e.g. a material endorsement can't skip re-underwriting; a fraud-flagged
   cancellation can never be approved into a state that permits reinstatement), and EF Core writes
   the transaction row **and** an outbox row in one DB transaction.
4. **Response** — `200 OK` with the updated transaction/aggregate summary.
5. **Domain event** — a background dispatcher reads the outbox and publishes
   (`policyEndorsed` / `policyRenewed` / ...) to Service Bus; consumers must be **idempotent**,
   since the outbox pattern guarantees at-least-once delivery, not exactly-once (a dispatcher crash
   between publish and marking the row dispatched will re-publish on restart).

## Database schema

Core, shared tables every desk reads from or writes to. Endorsement- and renewal-specific detail
tables are documented alongside their API contracts in [endorsement.md](./endorsement.md) and
[renewal.md](./renewal.md) respectively, since they're only ever written by those two flows.

```
parties ──┐
          │ holder_party_id
producers ┼──► policies ──1:N──► policy_terms ──1:1──► binders ──1:N──► subjectivities
          │        │                  │
          │         │ policy_id        │ policy_term_id
          │         ▼                  ▼
          │   transactions (ledger)   documents
          │         │
          │         │ transaction_id
          │         ▼
          │   domain_events (outbox)
          └──────────────────────────────────────────────► [endorsement_details]
                                                             [renewal_details]      (see per-flow docs)
                                                             [cancellation_details]
                                                             [reinstatement_details]
```

**`policies`** — the aggregate identity; stable for the policy's whole life, independent of term.

| Column | Type | Notes |
|---|---|---|
| `policy_id` | PK, e.g. `POL-2026-00311` | Business key, never reused |
| `holder_party_id` | FK → `parties` | Named insured |
| `producer_id` | FK → `producers` | Broker/channel that placed it, nullable for Direct |
| `product_code` | enum | Commercial Property, Comprehensive Auto, Home Owners, Marine Cargo, Group Health, Term Life |
| `current_status` | enum | Referred / Bound / Active / Cancelled / Non-renewed / Expired |
| `current_term_id` | FK → `policy_terms` | Denormalized pointer to the live term, for fast reads |
| `created_at` | timestamptz | |

**`policy_terms`** — one row per term; a renewal inserts a new row here rather than mutating the
old one, so every past term stays queryable exactly as it was priced.

| Column | Type | Notes |
|---|---|---|
| `term_id` | PK | |
| `policy_id` | FK → `policies` | |
| `term_number` | int | 1, 2, 3… increments on renewal |
| `effective_date` / `expiration_date` | date | |
| `premium` | decimal | Annual premium *for this term* |
| `sum_insured` | text/decimal | Kept as entered — some products use a formatted limit string, others a bare IDV |
| `status` | enum | Mirrors `policies.current_status` at the time this was the live term |

**`binders`** / **`subjectivities`** — provisional-cover bridge between Bind and Issue.

| Table | Key columns |
|---|---|
| `binders` | `binder_id` PK, `policy_term_id` FK, `binder_number`, `bound_on`, `expiry_date` |
| `subjectivities` | `subjectivity_id` PK, `binder_id` FK, `label`, `met` (bool), `met_at`, `met_by` |

**`transactions`** — the append-only ledger. This is the busiest table in the schema and the one
every desk's decision screen ultimately writes to.

| Column | Type | Notes |
|---|---|---|
| `transaction_id` | PK | |
| `policy_id` | FK → `policies` | |
| `seq` | int | Monotonic **per policy** — never reused, never resequenced |
| `type` | enum | Submission / Underwriting / Bind / Issuance / Endorsement / Cancellation / Reinstatement / Renewal / Servicing |
| `status` | enum | Pending → Completed \| Rejected \| Reversed |
| `effective_date` | date | Business date the change applies from |
| `recorded_at` | timestamptz | System date it was entered — bitemporal pair with `effective_date` |
| `initiated_by` | enum | Insured / Broker-Producer / Underwriter / System |
| `channel` | text | Self-service portal, Broker portal, Phone, Email, Internal review, ... |
| `submitted_on` | date | When the originating request arrived (may predate `recorded_at`) |
| `title` / `detail` | text | Human-readable summary shown on desks and the ledger |
| `meta` | jsonb | Type-specific payload; normalized detail tables (below, per-flow) exist alongside this for reporting joins, not instead of it |
| `reverses_transaction_id` | FK → `transactions`, nullable | Set on a compensating reversal row |
| `approved_by_user_id` | FK → users, nullable | Who decided it |

**`documents`** — versioned artefacts; metadata only, the bytes live in Blob Storage.

| Column | Type | Notes |
|---|---|---|
| `document_id` | PK | |
| `policy_id` / `policy_term_id` | FK | `policy_term_id` nullable — some documents (e.g. a cancellation notice) aren't term-scoped |
| `name` / `type` | text / enum | Schedule, Certificate, Notice |
| `version` | int | Increments per regeneration of the same `name` |
| `blob_uri` | text | Pointer into Blob Storage |
| `generated_at` | timestamptz | |

**`domain_events`** — the outbox table backing the transactional-outbox pattern used to publish
reliably without a distributed transaction across the database and the message broker.

| Column | Type | Notes |
|---|---|---|
| `event_id` | PK | |
| `transaction_id` | FK → `transactions` | The write that produced this event |
| `event_type` | text | `policyEndorsed`, `policyRenewed`, `transactionApproved`, ... |
| `event_version` | int | Envelope schema version |
| `aggregate_type` / `aggregate_id` | text | `"policy"` / `policy_id` |
| `tenant_id` | uuid | Multi-tenant scoping |
| `payload` | jsonb | The response body the API returned for this write |
| `occurred_at` | timestamptz | |
| `dispatched_at` | timestamptz, nullable | Set once the relay has published it — null rows are what the relay polls for |

### Event → consumer map

Exactly the fan-out this prototype's `CONSUMERS` constant encodes, formalized as the contract a
real Service Bus topic/subscription set would implement:

| Event | Published on | Consumers |
|---|---|---|
| `policyEndorsed` | Endorsement approved | Billing, Documents |
| `policyRenewed` | Renewal approved | Billing, Documents |
| `policyCancelled` | Cancellation approved | Billing, Claims, Documents |
| `policyReinstated` | Reinstatement approved | Billing, Claims |
| `policyNonRenewed` | Renewal declined | CRM, Documents |
| `transactionApproved` / `transactionRejected` | Any held transaction decided | Billing / CRM |
| `documentGenerated` | Any document (re)generated | Documents |

Because the outbox guarantees **at-least-once** delivery (a relay can crash after publishing but
before marking a row dispatched), every consumer above must be idempotent — typically by keying on
`event_id` and ignoring one it's already processed.

## Core shared APIs

Endpoints every desk depends on, independent of transaction type. Endorsement- and renewal-specific
endpoints are in their own docs (linked above) since they carry type-specific request/response
shapes.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/policies?limit=50` | Cursor-paged, tenant-scoped register — backs the Dashboard and Policy Register |
| `GET` | `/api/v1/policies/{policyId}` | Single aggregate, returned with an `ETag` for optimistic concurrency |
| `GET` | `/api/v1/policies/{policyId}/transactions` | That policy's ledger, in `seq` order |
| `GET` | `/api/v1/transactions?status=pending` | Cross-type index behind the Pending Approvals page |
| `POST` | `/api/v1/transactions/{txnId}/reverse` | Appends a compensating reversal row (see the reversal gap noted per-flow — today this does not undo the underlying policy-level effect, only the ledger status) |
| `POST` | `/api/v1/policies/{policyId}/documents` | Renders and stores a new document version |
| `GET` | `/api/v1/documents` | Document metadata across the book |

## Where this prototype stands today

| Capability | Status in `src/App.jsx` |
|---|---|
| Append-only transaction ledger per policy | Implemented (`policy.history`, `Transaction Workbench`) |
| Request-then-decide flow for Endorsement/Cancellation/Renewal/Reinstatement | Implemented (`raiseRequest`, `RequestOrigin`, per-desk decision screens) |
| Simulated API + domain event + consumer fan-out | Implemented (`useApiLog`, `EVENT_FOR`, `CONSUMERS`) |
| Document versioning | Implemented for issue/cancel/renew; not yet wired to endorsement approval |
| Endorsement premium actually applied on approval | **Fixed** (was a no-op; see [endorsement.md](./endorsement.md)) |
| Compensating reversal that undoes the real policy-level effect | **Gap** — `reverseTxn` only appends a ledger marker today, see [endorsement.md](./endorsement.md) |
| Renewal date rollover | **Fixed** — advances by calendar year via `addYears`, not a fixed 365-day add; see [renewal.md](./renewal.md) |
| Underwriting risk score independent of premium, three orthogonal referral gates | **Fixed** — score is now built from claims/change history, not premium; see [underwriting.md](./underwriting.md) |
| Seeded score/refund figures duplicated (and could disagree with) the live formulas | **Fixed** — pending transactions no longer store a score or refund; both are derived on read |

## Per-module documentation

Each decision desk has its own doc covering its formulas, what's implemented, and what's a known
gap, in the same format as this file:

| Module | Doc |
|---|---|
| Underwriting | [underwriting.md](./underwriting.md) |
| Bind & Issue | [issue.md](./issue.md) |
| Endorsements | [endorsement.md](./endorsement.md) |
| Cancellation | [cancellation.md](./cancellation.md) |
| Reinstatement | [reinstatement.md](./reinstatement.md) |
| Renewal | [renewal.md](./renewal.md) |
| Servicing | [servicing.md](./servicing.md) |
| Documents | [documents.md](./documents.md) |

The in-app **Reference** screens (Domain model, Data model, API reference, Architecture) present
the shared, cross-module material from this file as live, generated screens rather than static
markdown — see `domain-model.html`, `data-model.html`, `api-reference.html`, `architecture.html`.

## Sources

- [Policy Administration System (PAS): The Core of Digital Insurance in 2026](https://www.decerto.com/us/post/policy-administration-system-the-core-of-digital-insurance)
- [Guidewire PolicyCenter — Policy Transactions Explained](https://learnguidewire.com/a-complete-guide-to-policy-transactions-in-guidewire-policycenter/)
- [Guidewire — Insurance Policy Administration System (PolicyCenter)](https://www.guidewire.com/products/core-products/insurancesuite/policycenter-insurance-policy-administration)
- [Duck Creek Policy — Policy Management Software](https://www.duckcreek.com/product/policy-management-software/)
- [ACORD Data Standards](https://www.acord.org/standards-architecture/acord-data-standards)
- [IRDAI (Health Insurance) Regulations, 2016](https://www.indiacode.nic.in/ViewFileUploaded?path=AC_CEN_2_33_00044_193804_1523351752525%2Fregulationindividualfile%2F&file=irdai_%28health_insurance%29_regulations%2C_2016.pdf)
- [IRDAI Guidelines Explained: Simplifying India's Insurance Regulations](https://www.nivabupa.com/health-insurance-articles/irdai-guidelines-explained-india-insurance-regulations.html)
- [IRDAI Guidelines for Bike Insurance Renewal in India](https://www.policybazaar.com/motor-insurance/two-wheeler-insurance/articles/irdai-rules-for-bike-insurance-renewal-in-india/)
- [Microservices.io — Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- [AWS Prescriptive Guidance — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Confluent — Designing Event-Driven Microservices: The Transactional Outbox Pattern](https://developer.confluent.io/courses/microservices/the-transactional-outbox-pattern/)
- [draw.io — Entity Relationship Diagrams in the Insurance Industry](https://drawio-app.com/blog/entity-relationship-diagrams-in-the-insurance-industry/)
