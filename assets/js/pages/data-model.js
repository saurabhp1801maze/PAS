/* Reference / Data model. The relational schema behind the aggregate: the entity map, then a
   column spec per table. Row counts and the live-shape panel are read from the seeded book, so
   the screen shows the schema next to the data actually sitting in it. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var ERD = [
    "parties ──┐",
    "          │ holder_party_id",
    "producers ┼──► policies ──1:N──► policy_terms ──1:1──► binders ──1:N──► subjectivities",
    "          │        │                  │",
    "          │        │ policy_id        │ policy_term_id",
    "          │        ▼                  ▼",
    "          │  transactions (ledger)   documents",
    "          │        │",
    "          │        │ transaction_id",
    "          │        ▼",
    "          │  domain_events (outbox)",
    "          └──────────────────────────────► [endorsement_details]",
    "                                           [renewal_details]",
    "                                           [cancellation_details]",
    "                                           [reinstatement_details]",
  ].join("\n");

  var TABLES = [
    {
      name: "policies",
      note: "The aggregate identity. Stable for the policy's whole life, independent of term.",
      why: "Renewals must not change this row — that is what policy_terms is for.",
      cols: [
        ["policy_id", "PK", "Business key such as POL-2026-00311. Never reused."],
        ["holder_party_id", "FK → parties", "The named insured."],
        ["producer_id", "FK → producers", "Broker or channel that placed it. Null for Direct."],
        ["product_code", "enum", "Commercial Property, Comprehensive Auto, Home Owners, Marine Cargo, Group Health, Term Life."],
        ["current_status", "enum", "Referred / Bound / Active / Cancelled / Non-renewed / Expired."],
        ["current_term_id", "FK → policy_terms", "Denormalised pointer to the live term, for fast reads."],
        ["created_at", "timestamptz", ""],
      ],
    },
    {
      name: "policy_terms",
      note: "One row per term. A renewal inserts a new row rather than mutating the old one.",
      why: "This is what keeps every past term queryable exactly as it was priced.",
      warn: "The app does not do this yet — decideRenewal overwrites effectiveDate, expirationDate, premium and termNumber on the policy itself, so a prior term's dates are lost and its price survives only as meta.previousPremium on one ledger row.",
      cols: [
        ["term_id", "PK", ""],
        ["policy_id", "FK → policies", ""],
        ["term_number", "int", "1, 2, 3… increments on renewal."],
        ["effective_date", "date", "Start of this term."],
        ["expiration_date", "date", "End of this term."],
        ["premium", "decimal", "Annual premium for this term specifically."],
        ["sum_insured", "text / decimal", "Kept as entered — some products carry a formatted limit, others a bare ACV."],
        ["status", "enum", "Mirrors the policy status at the time this was the live term."],
      ],
    },
    {
      name: "binders / subjectivities",
      note: "The provisional-cover bridge between Bind and Issue.",
      why: "A binder puts cover in force before the contract is formally issued; a subjectivity is a condition that must be met before it can be.",
      cols: [
        ["binder_id", "PK", ""],
        ["policy_term_id", "FK → policy_terms", ""],
        ["binder_number / bound_on / expiry_date", "text, date, date", "Binders typically run 30 days."],
        ["subjectivity_id", "PK", "One row per outstanding condition."],
        ["label / met", "text / bool", "Issue is blocked while any row is unmet."],
        ["met_at / met_by", "timestamptz / FK", "Who satisfied it and when."],
      ],
    },
    {
      name: "transactions",
      note: "The append-only ledger. The busiest table in the schema and the one every decision screen writes to.",
      why: "Never updated in place except to move status along. Corrections are new compensating rows.",
      cols: [
        ["transaction_id", "PK", ""],
        ["policy_id", "FK → policies", ""],
        ["seq", "int", "Monotonic per policy. Never reused, never resequenced."],
        ["type", "enum", "Submission / Underwriting / Bind / Issuance / Endorsement / Cancellation / Reinstatement / Renewal / Servicing."],
        ["status", "enum", "Pending → Completed | Rejected | Reversed."],
        ["effective_date", "date", "Business date the change applies from."],
        ["recorded_at", "timestamptz", "System date it was entered. Bitemporal pair with effective_date."],
        ["initiated_by", "enum", "Insured / Broker-Producer / Underwriter / System."],
        ["channel", "text", "Self-service portal, Broker portal, Phone, Email, Internal review…"],
        ["submitted_on", "date", "When the originating request arrived. May predate recorded_at."],
        ["title / detail", "text", "Human-readable summary shown on desks and the ledger."],
        ["meta", "jsonb", "Type-specific payload. Normalised detail tables exist alongside it for reporting joins, not instead of it."],
        ["reverses_transaction_id", "FK, nullable", "Set on a compensating reversal row."],
        ["approved_by_user_id", "FK → users, nullable", "Who decided it. Has no source today — there is no identity in the app."],
      ],
    },
    {
      name: "documents",
      note: "Versioned artefacts. Metadata only — the bytes live in Blob Storage.",
      why: "Version increments per regeneration of the same document name, so the pack held on any past date is reconstructible.",
      cols: [
        ["document_id", "PK", ""],
        ["policy_id / policy_term_id", "FK", "policy_term_id is nullable — a cancellation notice is not term-scoped."],
        ["name / type", "text / enum", "Schedule, Certificate, Notice."],
        ["version", "int", "Increments per regeneration of the same name."],
        ["blob_uri", "text", "Pointer into Blob Storage."],
        ["generated_at", "timestamptz", ""],
      ],
    },
    {
      name: "domain_events",
      note: "The outbox table backing the transactional-outbox pattern.",
      why: "Lets the system publish reliably without a distributed transaction across the database and the message broker.",
      cols: [
        ["event_id", "PK", "Consumers key their idempotency check on this."],
        ["transaction_id", "FK → transactions", "The write that produced this event."],
        ["event_type", "text", "policyEndorsed, policyRenewed, transactionApproved…"],
        ["event_version", "int", "Envelope schema version."],
        ["aggregate_type / aggregate_id", "text", '"policy" / policy_id.'],
        ["tenant_id", "uuid", "Multi-tenant scoping."],
        ["payload", "jsonb", "The response body the API returned for this write."],
        ["occurred_at", "timestamptz", ""],
        ["dispatched_at", "timestamptz, nullable", "Set once the relay has published. Null rows are what the relay polls for."],
      ],
    },
  ];

  function render() {
    var policies = PAS.getPolicies();
    var txnCount = policies.reduce(function (t, p) { return t + p.history.length; }, 0);
    var docCount = policies.reduce(function (t, p) { return t + (p.documents || []).length; }, 0);
    var termCount = policies.reduce(function (t, p) { return t + p.termNumber; }, 0);
    var binderCount = policies.filter(function (p) { return p.binder; }).length;

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "database", tone: "blue", title: "Data model",
      sub: "The relational schema behind the policy aggregate",
      what: "Seven core tables, plus four per-flow detail tables written only by their own desk.",
      why: "The shape of this schema is what makes the append-only and bitemporal guarantees possible.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Policies", value: policies.length, tip: "Rows in the seeded book." },
      { label: "Terms", value: termCount, tone: "blue", tip: "Sum of termNumber across the book — how many policy_terms rows a correct implementation would hold." },
      { label: "Ledger rows", value: txnCount, tone: "violet", tip: "Transactions across every policy." },
      { label: "Documents", value: docCount, tip: "Versioned artefacts on file." },
      { label: "Binders", value: binderCount, tone: "amber", tip: "Policies currently in provisional cover." },
    ]));

    var erdPanel = ui.panel({
      title: "Entity map",
      what: "How the core tables relate.",
      why: "Everything hangs off policies; the ledger and the outbox are the two append-only branches.",
    }, []);
    erdPanel.querySelector(".panel-body").appendChild(ui.codeBlock(ERD));
    /* codeBlock JSON-stringifies objects; a raw string needs the text set directly. */
    erdPanel.querySelector(".code-block").textContent = ERD;
    page.appendChild(erdPanel);

    TABLES.forEach(function (t) {
      var p = ui.panel({ title: t.name, what: t.note, why: t.why, pad: 0 }, []);
      var body = p.querySelector(".panel-body");
      body.appendChild(ui.dataTable({
        columns: ["Column", { label: "Type", what: "Storage type and any key relationship." }, "Notes"],
        rows: t.cols.map(function (c) {
          return [ui.h("span", { class: "cell-id" }, c[0]), ui.h("span", { class: "mono" }, c[1]), c[2]];
        }),
        wrapCells: true,
      }));
      if (t.warn) {
        var w = ui.h("div", { class: "mt-13" });
        w.appendChild(ui.callout("bad", t.warn));
        body.appendChild(w);
      }
      page.appendChild(p);
    });

    /* --- what the app actually holds in memory, next to the schema above --- */
    var shapePanel = ui.panel({
      title: "The live shape, for comparison",
      what: "One policy from the seeded book, as the browser actually holds it.",
      why: "The prototype flattens policy, current term and risk factors into a single object. The schema above is the target the API and database would present instead.",
    }, []);
    var sample = policies.find(function (p) { return p.binder; }) || policies[0];
    shapePanel.querySelector(".panel-body").appendChild(ui.codeBlock({
      id: sample.id,
      holder: sample.holder,
      product: sample.product,
      status: sample.status,
      effectiveDate: sample.effectiveDate,
      expirationDate: sample.expirationDate,
      premium: sample.premium,
      termNumber: sample.termNumber,
      producer: sample.producer,
      sumInsured: sample.sumInsured,
      risk: sample.risk,
      binder: sample.binder,
      documents: "[" + (sample.documents || []).length + " document rows]",
      history: "[" + sample.history.length + " ledger rows]",
    }));
    page.appendChild(shapePanel);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("data-model", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
