# Veridex PAS — Policy Administration Module (Prototype)

**Veridex PAS** is a working prototype of the **Policy Administration** module inside a larger insurance ERP. Its job is to **own and administer the policy record** through its lifecycle — issue, change, renew, cancel, reinstate, transfer — and keep a complete, auditable history of every policy transaction.

PAS does **not** rate risks, underwrite submissions, bill premiums, or adjust claims. Those are separate ERP modules. PAS **receives decisions** from them, **updates the policy of record**, and **notifies** downstream systems when something changes.

---

## Where PAS sits in the insurance ERP

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Rating    │  │ Underwriting│  │   Product   │  │ Distribution│
│   Engine    │  │   Module    │  │   Config    │  │  (Brokers)  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       │    approved / bound business arrives              │
       └────────────────┼────────────────┼────────────────┘
                        ▼
              ┌─────────────────────┐
              │   PAS  (this module) │  ◄── Policy of record
              │  Policy Administration│
              └──────────┬──────────┘
                         │ policy lifecycle events
       ┌─────────────────┼─────────────────┬─────────────────┐
       ▼                 ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Billing   │  │   Claims    │  │  Documents  │  │ Reinsurance │
│   Module    │  │   Module    │  │   Module    │  │   Module    │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

**PAS owns:** policy status, term dates, coverage record, transaction ledger, held change requests, policy documents metadata, policy register.

**Other modules own:** pricing (Rating), risk acceptance (Underwriting), invoices (Billing), losses (Claims), templates/storage (Documents), treaties (Reinsurance), broker relationships (Distribution).

---

## What PAS administers (policy lifecycle)

```
Bound (from UW) → Issue → Active (in-force)
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   Endorsement            Renewal             Cancellation
   (policy change)    (new term)           ──► Reinstatement
         │                    │                    │
         └────────────────────┴────────────────────┘
                         Transfer
                    Non-renewal / Expiry
```

---

## Working PAS features in this prototype

### Policy transactions (admin actions)

| PAS transaction | What the admin can do | End-to-end in demo |
|---|---|---|
| **Issue** | Convert a bound policy to in-force; generate schedule and certificate | Yes — gates checked, auto-issue when ready |
| **Endorsement** | Log a change request, hold it, approve or decline, update policy record | Yes |
| **Cancellation** | Log cancellation request, derive admin attributes (type, effective date, refund basis), approve or decline, update status | Yes |
| **Reinstatement** | Accept reinstatement request within window, check eligibility rules, restore to Active | Yes |
| **Renewal** | Process renewal into next term or record non-renewal | Yes |
| **Transfer** | Change named insured while preserving policy continuity | Yes |
| **Servicing log** | Record a service request against the policy (no financial change) | Yes |
| **Reversal** | Record a compensating ledger entry | Partial — ledger only, policy state not fully unwound |

### Policy record management

| Feature | What it does in the demo |
|---|---|
| **Policy register** | Searchable book of all policies with status, product, state filters |
| **Policy detail** | Single policy view — status, dates, premium, coverage breakdown, full history |
| **Transaction ledger** | Append-only history per policy; workbench view across the whole book |
| **Held transactions** | Pending changes leave the policy untouched until an admin approves or declines |
| **Multi-level approval** | Supervisor/Carrier approval steps on material/high-value transactions |
| **SLA tracking** | Pending queue shows hours until SLA breach |
| **Bulk approve** | Immaterial endorsements approved in one action from Pending approvals |
| **Segregation of duties** | Initiator cannot approve their own request |
| **PAS admin authority** | Role and amount limits enforced on admin actions |
| **Policy status** | Submitted → Referred → Bound → Active → Cancelled / Expired / Non-renewed / Declined |
| **Term management** | Term number increments on renewal; effective and expiration dates roll forward |
| **Document records** | Policy schedules, certificates, notices tracked with version numbers |
| **Global search** | Find any policy by ID, insured name, or broker from any screen |

### PAS business rules (admin-side)

| Rule | Behaviour |
|---|---|
| **Held change pattern** | No mid-term change applies until explicitly approved |
| **Cancellation type derivation** | Admin type (Flat / Pro-Rata / Short-Rate) derived from reason + initiator + dates — not free-text |
| **Cancellation notice check** | Notice period validated before approval |
| **Reinstatement window** | 45-day eligibility; fraud cancellations permanently barred |
| **Renewal term rollover** | Next term starts on prior expiration date (calendar-year logic) |
| **Effective date on renewals** | System-set from prior term — admin does not pick it |
| **Issue gates** | Policy issues only when bound, binder valid, and subjectivities cleared |
| **Transfer continuity** | Same policy ID and term dates preserved; only holder changes |

### Integration touchpoints (simulated)

PAS publishes events when the policy record changes. Other ERP modules subscribe:

| PAS event | Downstream module |
|---|---|
| `policyIssued` | Billing, Documents, Reinsurance |
| `policyEndorsed` | Billing, Documents |
| `policyCancelled` | Billing, Claims, Documents |
| `policyRenewed` | Billing, Documents |
| `policyReinstated` | Billing, Claims |
| `policyTransferred` | Billing, Documents, Reinsurance |
| `policyNonRenewed` | Documents, CRM |

The activity feed in the demo shows: **request → response → event → consumers notified**.

### Admin workspace

| Screen | PAS purpose |
|---|---|
| **Dashboard** | Operational view — pending work, renewal pipeline, bound/issue queue, book KPIs |
| **Pending approvals** | Single queue of all held policy transactions awaiting admin decision |
| **Decision desks** | Issue, Endorsement, Cancellation, Reinstatement, Renewal, Transfer, Servicing |
| **Transaction workbench** | Full ledger across the book; reversal action |
| **Documents** | Policy document register with search and filters |
| **Reference screens** | Domain model, data model, API contract, architecture (PAS boundaries) |

---

## What is intentionally outside PAS (other ERP modules)

These appear in the demo for **integration context** but are **not PAS responsibilities**:

| Shown in demo | Actual owner module |
|---|---|
| Underwriting desk, risk score, referral gates | **Underwriting module** |
| Premium amounts on policies | **Rating engine** (PAS stores the result) |
| Loss ratio, claims on policy detail | **Claims module** (PAS displays read-only feed) |
| Loyalty tiers | **CRM / Marketing module** |
| Terms & Conditions editor | **Product / Legal module** |
| MGA / Carrier portfolio analytics | **Reporting / MGA portal** |
| Broker / Customer portals | **Distribution / Customer portal** |
| Commission, invoicing, payment | **Billing module** |

---

## Demo walkthrough (PAS admin perspective)

### Issue a bound policy
1. **Issue desk** → see bound policies waiting  
2. Clear subjectivities (or observe auto-issue) → policy becomes **Active**  
3. Check **Policy detail** → schedule and certificate in documents; issuance in ledger  

### Administer a cancellation
1. **Cancellation desk** → log request (reason, initiator, effective date)  
2. **Pending approvals** → review derived type, refund basis, notice check  
3. Approve → status **Cancelled**, notice document recorded, `policyCancelled` event fired  

### Process a renewal
1. **Renewal desk** → policies in renewal window  
2. Approve → new term created, dates rolled, premium updated on record  
3. Or decline → **Non-renewed** status  

### Audit the policy record
1. **Policy register** → filter and open any policy  
2. **Transaction workbench** → see every admin action across the book  

---

## How to run

```bash
npx --yes serve .
```

Open the URL shown. Use **Reset demo data** in the sidebar to restore the seeded book.

---

## Supporting documentation

| Document | Focus |
|---|---|
| [`docs/common.md`](docs/common.md) | PAS patterns, lifecycle, integration design, target schema |
| [`docs/issue.md`](docs/issue.md) | Bind-to-issue admin flow |
| [`docs/endorsement.md`](docs/endorsement.md) | Policy change administration |
| [`docs/cancellation.md`](docs/cancellation.md) | Cancellation admin rules |
| [`docs/renewal.md`](docs/renewal.md) | Term rollover and non-renewal |
| [`docs/reinstatement.md`](docs/reinstatement.md) | Reinstatement eligibility |
| [`docs/servicing.md`](docs/servicing.md) | Service request logging |
| [`docs/documents.md`](docs/documents.md) | Policy document versioning |

---

## Industry alignment

This prototype demonstrates standard **Policy Administration** capabilities found in Guidewire PolicyCenter, Duck Creek Policy, Sapiens, and Majesco — scoped to the admin module only:

- Policy of record with full lifecycle status management  
- Append-only transaction ledger  
- Held-transaction processing for policy changes  
- Effective-dated admin transactions  
- Term versioning on renewal  
- Policy document generation triggers  
- Event-driven integration with Billing, Claims, Documents, Reinsurance  
- Policy register and inquiry  

---

## License

Internal R&D prototype. No license specified.
