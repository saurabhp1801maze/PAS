/* Reference / Architecture. Rebuilt from the target architecture in docs/common.md — the layered
   stack with what each layer is responsible for, the side systems, the end-to-end request path
   behind one Approve click, and the write-path guarantees that follow from it. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var LAYERS = [
    ["Browser", "These screens", "gray",
      "Static HTML per page with a shared JS shell. Holds no business rules — every rule it displays lives one layer down in the real system.",
      "A client, not the system. Reset demo data wipes it entirely."],
    ["Policy API", ".NET minimal API", "blue",
      "Request validation, authentication, tenant scoping, ETag and If-Match handling, idempotency keys.",
      "The only door in. Nothing reaches the database without passing through here."],
    ["Application", "Use cases and validators", "indigo",
      "One handler per transaction type — ApproveEndorsement, CreateRenewal, ApproveRenewal, DecideCancellation.",
      "Orchestrates the domain. Contains no business rules of its own."],
    ["Domain", "Aggregates and invariants", "violet",
      "The Policy aggregate enforces the rules: material endorsements never auto-apply, fraud cancellations never reinstate, issue requires every subjectivity met.",
      "The pure functions in this prototype — cancelQuote, riskFactors, underwritingDecision, reinstatementEligibility — belong here."],
    ["EF Core", "Repository", "amber",
      "Maps the aggregate to rows and back. Owns the unit of work that makes the ledger and outbox writes atomic.",
      "One SaveChanges, two rows: the transaction and its outbox event."],
    ["Azure SQL", "System of record", "green",
      "The append-only ledger, the term history, the document metadata and the outbox table.",
      "Everything else in the estate is a projection of this."],
  ];

  var SIDE = [
    ["Camunda 8", "git-branch", "Runs the approval workflow behind every held transaction — material endorsements, fraud cancellations and authority referrals. The workflow decides who reviews and in what order; the domain decides what is legal."],
    ["Service Bus", "zap", "Carries the domain events out of the outbox to Billing, Claims, Documents, Reinsurance and CRM. Topic-per-event-type with a subscription per consumer."],
    ["Blob Storage", "file-check-2", "Holds the generated schedules, certificates and notices. The database keeps only metadata, checksum and retention policy."],
    ["Redis", "activity", "Caches the dashboard aggregates and the renewal pipeline so KPI reads do not recompute on every request."],
  ];

  function render() {
    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "layers", tone: "gray", title: "Architecture",
      sub: "How these screens map onto the production stack",
      what: "The request path behind every action in this app.",
      why: "Each click here stands in for a full trip through the real system — this page is that trip, spelled out.",
    }));

    /* --- the stack --- */
    var layerRow = ui.h("div", { class: "arch-layers" });
    LAYERS.forEach(function (l, i) {
      var wrap = ui.h("div", { class: "arch-layer" });
      var chip = ui.h("span", { class: "arch-layer-chip", "data-tone": l[2] }, document.createTextNode(l[0]));
      chip.appendChild(PAS.icon("info", { size: 10, color: "var(--color-muted)" }));
      wrap.appendChild(ui.tooltip({ what: l[1], why: l[3], rule: l[4], width: 300 }, chip));
      if (i < LAYERS.length - 1) wrap.appendChild(PAS.icon("chevron-down", { size: 13, color: "var(--color-muted)" }));
      layerRow.appendChild(wrap);
    });
    var stackPanel = ui.panel({
      title: "The stack, top to bottom",
      what: "Six layers, each with one responsibility. Hover any of them.",
      why: "Business rules live in exactly one of these. Putting them anywhere else is how a policy system rots.",
    }, []);
    var stackBody = stackPanel.querySelector(".panel-body");
    stackBody.appendChild(layerRow);
    LAYERS.forEach(function (l) {
      stackBody.appendChild(ui.kv({ k: l[0], v: l[1], what: l[3], rule: l[4] }));
    });
    page.appendChild(stackPanel);

    /* --- one Approve click, end to end --- */
    var flowPanel = ui.panel({
      title: "What one Approve click does",
      what: "The five-step chain the API & event lifecycle panel narrates for every action.",
      why: "Steps 3 and 5 are the ones that matter: 3 is atomic, 5 is not, and the gap between them is why consumers must be idempotent.",
    }, []);
    var flowBody = flowPanel.querySelector(".panel-body");
    [
      ["01", "arrow-up-right", "indigo", "User action",
        "An operator clicks Approve on a held transaction. Nothing has changed yet — the policy is still exactly as it was.", null],
      ["02", "arrow-up-right", "blue", "Request leaves the browser",
        "POST /api/v1/transactions/{txnId}/approve, carrying the bearer token, the tenant header, the ETag in If-Match and an idempotency key.", true],
      ["03", "shield-check", "violet", "Domain rules run, atomically",
        "The application layer loads the Policy aggregate, the domain enforces its invariants, and EF Core writes the ledger row AND the outbox row in one database transaction. Either both land or neither does.", null],
      ["04", "arrow-down-left", "green", "Response",
        "200 OK with the updated transaction and aggregate summary, or 412 if someone else wrote first, or 422 if an invariant refused it.", null],
      ["05", "zap", "violet", "Domain event, eventually",
        "A background relay polls the outbox for rows with a null dispatched_at and publishes them to Service Bus. This is outside the transaction, which is the whole point — and the reason delivery is at-least-once.", null],
    ].forEach(function (s, i, arr) {
      flowBody.appendChild(ui.lifecycleStage({
        n: s[0], icon: s[1], tone: s[2], title: s[3], sub: s[4], subMono: s[5] || false, last: i === arr.length - 1,
      }));
    });
    page.appendChild(flowPanel);

    /* --- guarantees --- */
    var guarPanel = ui.panel({
      title: "What the write path guarantees, and what it does not",
      what: "The properties that follow from the design above.",
      why: "Most integration bugs against a policy system come from assuming a guarantee that was never offered.",
      pad: 0,
    }, []);
    guarPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Property", { label: "Holds", what: "Whether the architecture actually provides it." }, "Consequence"],
      rows: [
        ["Ledger row and outbox row commit together", ui.pill("green", "Guaranteed"), "No event is ever published for a write that rolled back."],
        ["Event delivery", ui.pill("amber", "At-least-once"), "A relay can crash after publishing and before marking the row dispatched, so it will republish. Consumers must dedupe on eventId."],
        ["Event ordering across policies", ui.pill("red", "Not guaranteed"), "Only per-aggregate order is meaningful. Do not build a consumer that assumes global sequence."],
        ["Exactly-once processing", ui.pill("red", "Not offered"), "Cannot be, without a distributed transaction. Idempotency is the consumer's job, not the bus's."],
        ["Concurrent write safety", ui.pill("green", "Guaranteed"), "ETag plus If-Match. A second writer gets 412 rather than silently clobbering."],
        ["Reversal restores prior state", ui.pill("red", "Not yet"), "reverseTxn appends a compensating ledger row but does not unwind the premium, term or status. Open gap."],
      ],
      wrapCells: true,
    }));
    page.appendChild(guarPanel);

    /* --- side systems --- */
    var sidePanel = ui.panel({
      title: "Side systems",
      what: "Everything fed from the same write path.",
      why: "None of these is a source of truth. Each is downstream of the ledger.",
    }, []);
    var sideGrid = ui.h("div", { class: "arch-side-grid" });
    SIDE.forEach(function (s) {
      var card = ui.h("div", { class: "arch-side-card" });
      var nameRow = ui.h("div", { class: "arch-side-name" });
      nameRow.appendChild(PAS.icon(s[1], { size: 13 }));
      nameRow.appendChild(document.createTextNode(" " + s[0]));
      card.appendChild(nameRow);
      card.appendChild(ui.h("div", { class: "arch-side-desc" }, s[2]));
      sideGrid.appendChild(card);
    });
    sidePanel.querySelector(".panel-body").appendChild(sideGrid);
    page.appendChild(sidePanel);

    /* --- connected carriers: the modular-architecture piece made concrete --- */
    var policies = PAS.getPolicies();
    var carrierPanel = ui.panel({
      title: "Connected reinsurers",
      what: "Veridex is the MGA — it doesn't carry risk itself. Each product line is placed with the one partner that has appetite for it.",
      why: "This is what \"a modular architecture that consumes data from connected reinsurers\" means concretely: real data segmented by reinsurer (PAS.PRODUCT_CARRIER), not one undifferentiated book.",
      pad: 0,
    }, []);
    carrierPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Reinsurer", { label: "Lines placed", what: "Which products this partner has appetite for." },
        { label: "Policies", what: "Records on their paper." },
        { label: "In-force premium", what: "Sum of active premium placed with them." },
        { label: "Loss ratio", what: "Incurred claims ÷ earned premium, on their book only." }],
      rows: PAS.CARRIERS.map(function (c) {
        var book = policies.filter(function (p) { return p.carrier === c; });
        var active = book.filter(function (p) { return p.status === "Active"; });
        var lines = Array.from(new Set(book.map(function (p) { return p.product; })));
        var premium = active.reduce(function (s, p) { return s + p.premium; }, 0);
        return [c, lines.join(", "), book.length, PAS.moneyShort(premium), Math.round(PAS.lossRatio(active) * 100) + "%"];
      }),
      wrapCells: true,
    }));
    page.appendChild(carrierPanel);

    var composablePanel = ui.panel({
      title: "Composable modules",
      what: "The output of one module already feeds the next — the outbox pattern above is the mechanism, not a new abstraction to build.",
      why: "An endorsement's premium delta becomes Billing's input; a cancellation's refund becomes Billing's input; an issued policy's data becomes Reinsurance's input. Composability here means every module speaks the same domain-event contract, so a new consumer (a new carrier's claims system, a new reporting module) subscribes to the existing bus instead of every producer being rewritten to know about it.",
    }, []);
    var compBody = composablePanel.querySelector(".panel-body");
    compBody.appendChild(ui.h("div", { class: "faint-note" }, "Concretely, from PAS.EVENT_FOR / PAS.CONSUMERS in store.js:"));
    var chain = ui.h("div", { class: "mt-9" });
    [
      ["Endorsement approved", "policyEndorsed", "Billing, Documents"],
      ["Cancellation approved", "policyCancelled", "Billing, Claims, Documents"],
      ["Transfer approved", "policyTransferred", "Billing, Documents, CRM, Reinsurance"],
    ].forEach(function (row) {
      var line = ui.h("div", { class: "effect-row" });
      line.appendChild(PAS.icon("zap", { size: 13 }));
      line.appendChild(ui.h("span", {}, row[0] + " → " + row[1] + " → " + row[2]));
      chain.appendChild(line);
    });
    compBody.appendChild(chain);
    page.appendChild(composablePanel);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("architecture", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
