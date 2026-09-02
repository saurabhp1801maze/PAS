# VeriDex PAS — Policy Administration Module (Prototype)

**VeriDex PAS** is a working prototype of the **Policy Administration** module inside a larger insurance ERP. Its job is to **own and administer the policy record** through its lifecycle — issue, change, renew, cancel, reinstate, transfer — and keep a complete, auditable history of every policy transaction.

PAS does **not** rate risks, underwrite submissions, bill premiums, or adjust claims. Those are separate ERP modules. PAS **receives decisions** from them, **updates the policy of record**, and **notifies** downstream systems when something changes. The UI itself follows the VeriDex platform design framework (design tokens, Phosphor iconography, shared shell/nav across every page).

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

The Rating hand-off is no longer just a diagram: **Integration → Import quote** accepts a real rating-engine quote payload (JSON) and mints an actual Active policy from it — see [Quote-to-policy-to-invoice flow](#quote-to-policy-to-invoice-flow) below.

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
| **Quote import** | Turn a pasted rating-engine quote (JSON) into a real Active policy | Yes — step-progress (Verifying/Generating/Issuing), autofills named insured/producer/effective date/sum insured from the quote |

### Quote-to-policy-to-invoice flow

A rating-engine hand-off is simulated end to end from **Integration → Import quote**:

1. Paste a quote JSON (several real-world payload shapes are recognized) → **Generate policy** mints a real Active policy, seeded with the quote's own per-coverage premium split.
2. The policy's **Documents** tab generates a real itemized **invoice** from that quote's own numbers (line items, taxes/county rate or an itemized-taxes breakdown if the quote provides one), with Print, Download (JSON), and Send-to-accounts actions.
3. Every policy — imported or seeded — also gets a full-detail, printable **policy document** (`policy-document.html`), viewable and exportable to PDF via the browser's print dialog.

### Policy record management

| Feature | What it does in the demo |
|---|---|
| **Policy register** | Searchable book of all policies with status, product, state filters |
| **Policy detail** | Tabbed single-policy view — financial performance, premium-split distribution, per-vehicle drivers, and full lifecycle activity/decisions, across auto, commercial, and personal policies |
| **Policy document** | Full-detail, print/PDF-ready document per policy, generated on issue or import |
| **Invoice** | Itemized invoice generated from the bound quote/policy premium, with Print, Download (JSON), and Send-to-accounts |
| **Transaction ledger** | Append-only history per policy; workbench view across the whole book, scoped to the request types a Broker/MGA role can actually raise |
| **Held transactions** | Pending changes leave the policy untouched until an admin approves or declines |
| **Multi-level approval** | Supervisor/Carrier approval steps on material/high-value transactions |
| **SLA tracking** | Pending queue shows hours until SLA breach |
| **Bulk approve** | Immaterial endorsements approved in one action from Pending approvals |
| **Segregation of duties** | Initiator cannot approve their own request |
| **PAS admin authority** | Role and amount limits enforced on admin actions |
| **Policy status** | Submitted → Referred → Bound → Active → Cancelled / Expired / Non-renewed / Declined |
| **Term management** | Term number increments on renewal; effective and expiration dates roll forward |
| **Document records** | Policy schedules, certificates, notices tracked with version numbers |
| **Global search** | Find any policy, or matching **Customer** (with every policy they hold), by ID, insured name, or broker from any screen |
| **Dirty-state guard** | Unsaved form fields trigger a real leave-page warning |
| **Typed confirmation** | Hard-to-reverse decisions (e.g. cancellation approval) require typing the record ID to confirm |

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
| **Cancellation type override** | A decision-maker can override the derived cancellation type, but only within the same domain rules (e.g. Short-Rate is refused outright for an insurer-side initiator, never silently clamped) |

### Book financials (shown read-only, sourced from Rating/Claims/Billing data)

PAS doesn't own these numbers, but the dashboard and the Broker/MGA/Reinsurer record screens surface them so admins can see the business impact of the policy record:

| Metric | Behaviour |
|---|---|
| **Loss ratio** | Incurred claims ÷ **earned** premium (not written) — computed lifetime, over on-risk policies (Active, Cancelled, Expired, Non-renewed), not just survivors |
| **Combined ratio** | Loss ratio + acquisition expense ratio; the profitability headline — under 100% is a carrier underwriting profit before other operating costs |
| **Net commission** | A real commission model (rate by line, broker share, Direct keeps 100%) — premium itself is never reported as revenue |
| **Underwriting result / waterfall** | Earned premium less claims and commission paid, shown as a "where the premium went" breakdown |
| **Profit & loss by segment** | Ranked worst-combined-ratio-first, switchable by line / state / broker / reinsurer |
| **Period-aware financials** | Dashboard financial KPIs, waterfall, and segment table recompute for Monthly/Quarterly/Yearly/custom-range windows, with an "All" toggle back to the lifetime snapshot |
| **Scoped views** | Broker, MGA, and Reinsurer record screens get their own loss ratio / commission KPIs, computed the same way over their own narrower book |
| **Claims & loss ratio dashboard** | Loss ratio by product/state charts, a "running at a loss" callout, and a paginated claims detail table |

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
| **Dashboard** | Operational view — pending work, renewal pipeline, bound/issue queue, book KPIs, period-aware financial performance, loss ratio/claims charts |
| **Pending approvals** | Single queue of all held policy transactions awaiting admin decision (Underwriting referrals excluded — those are decided from the Underwriting desk itself) |
| **Admin Configuration** | Roles, permissions and invited users — Super Admin/Admin see and manage everything, Broker/MGA/Carrier are scoped to their own book by default, and all are fully editable (plus custom roles). Client-side only: no real auth, server-side enforcement, or email delivery — see the callout on the screen itself. |
| **Decision desks** | Issue, Endorsement, Cancellation, Reinstatement, Renewal, Transfer, Servicing |
| **Transaction workbench** | Full ledger across the book; reversal action |
| **Records** | Policy register (PAS-owned) plus Brokers / MGA / Reinsurers / Customers reference screens, each now with its own loss-ratio/commission view for context — the underlying revenue still isn't a PAS-owned number, see below |
| **Integration hub** | PAS's own API surface as an integration reference; **Import quote** turns a pasted rating-engine quote into a real policy |
| **Invoice / Policy document** | Generated per policy from the Documents tab — itemized invoice and full printable policy document |
| **Reference screens** | Domain model, data model, API contract, architecture (PAS boundaries) |

---

## What is intentionally outside PAS (other ERP modules)

These appear in the demo for **integration context** but are **not PAS responsibilities**:

| Shown in demo | Actual owner module |
|---|---|
| Underwriting desk, risk score, referral gates | **Underwriting module** |
| Premium amounts on policies | **Rating engine** (PAS stores the result) |
| Loss ratio, combined ratio, claims, commission | **Claims / Rating / Billing modules** (PAS displays a read-only feed on the dashboard and on Broker/MGA/Reinsurer record screens) |
| Loyalty tiers | **CRM / Marketing module** |
| Terms & Conditions editor | **Product / Legal module** |
| MGA / Reinsurer portfolio analytics | **Reporting / MGA portal** |
| Broker / Customer portals | **Distribution / Customer portal** |
| Invoice generation, payment collection | **Billing module** (PAS's invoice screen mirrors what Billing would produce, for demo continuity) |

---

## Demo walkthrough (PAS admin perspective)

### Issue a bound policy
1. **Issue desk** → see bound policies waiting  
2. Clear subjectivities (or observe auto-issue) → policy becomes **Active**  
3. Check **Policy detail** → schedule and certificate in documents; issuance in ledger  

### Import a rating quote into a policy
1. **Integration → Import quote** → paste a rating-engine quote JSON  
2. **Generate policy** → step-progress modal (Verifying/Generating/Issuing) → real Active policy created  
3. **Policy detail → Documents** → generate the itemized **invoice** and the printable **policy document**  

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

`serve.json` disables `serve`'s default HTML-redirect behavior, which otherwise strips query strings from `.html` URLs and breaks every `?policy=...` deep link in the app.

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
| [`docs/underwriting.md`](docs/underwriting.md) | Bind decision inputs (referral gates, risk score) |

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
- Actuarial reporting basics: earned-premium loss ratio, combined ratio, commission-based revenue — not written premium mistaken for revenue  
- Rating-engine intake (quote → policy → invoice) as a real, if simplified, integration flow  
- WCAG/ARIA landmarks, focus management, and an i18n seam for localizable strings  

---

## License

Internal R&D prototype. No license specified.
