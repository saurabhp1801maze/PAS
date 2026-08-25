/* Reference / Domain model. Renders the lifecycle, the transaction taxonomy, the request-then-
   decide contract and the four initiator roles — reading them off the live constants in store.js
   wherever it can, so the reference cannot drift away from the code it documents. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  /* Guidewire PolicyCenter's transaction taxonomy, which docs/common.md names as the model this
     platform is built around. `built` is read against what the ledger can actually record. */
  var TAXONOMY = [
    ["Submission", "A new risk arrives and is scored, priced and accepted or declined.", true, "Underwriting desk"],
    ["Policy Change", "A mid-term alteration to an in-force contract — the endorsement.", true, "Endorsement desk"],
    ["Renewal", "A new term on the same policy, re-underwritten and re-priced.", true, "Renewal desk"],
    ["Cancellation", "Cover ends before the term does, on one of three bases.", true, "Cancellation desk"],
    ["Reinstatement", "A cancelled policy is restored, inside a limited window.", true, "Reinstatement desk"],
    ["Rewrite (Transfer)", "A change of named insured — same policy ID, same term, same ledger, only the holder changes.", true, "Transfer desk"],
    ["Reissue", "Correct a document without altering coverage terms.", false, "Not built"],
  ];

  var PATTERNS = [
    ["Append-only ledger", "git-branch",
      "A transaction is never edited in place. Corrections are new, compensating rows, and seq is monotonic per policy.",
      "This is what lets the system answer “what did this contract say on any given date” for a regulator."],
    ["Bitemporal dates", "clock",
      "Every transaction carries an effective date (the business date it applies from) and a recorded date (the system date it was entered).",
      "The two diverge routinely — a cancellation recorded today can be effective last week."],
    ["Domain events over an outbox", "zap",
      "A state-changing write commits the ledger row and an outbox row in one database transaction; a relay publishes asynchronously.",
      "Delivery is at-least-once, not exactly-once, so every consumer must be idempotent on eventId."],
    ["Document versioning", "file-check-2",
      "Schedules, certificates and notices are templated, regenerated on material change, and stored with an incrementing version.",
      "A carrier has to be able to prove what the policyholder actually held on a given date."],
  ];

  function stageRow() {
    var stages = [
      ["Submission", "inbox", "blue"], ["Underwriting", "clipboard-check", "violet"],
      ["Bind", "shield-check", "amber"], ["Issue", "stamp", "indigo"], ["In force", "check-circle-2", "green"],
    ];
    var row = ui.h("div", { class: "arch-layers" });
    stages.forEach(function (s, i) {
      var wrap = ui.h("div", { class: "arch-layer" });
      var chip = ui.h("span", { class: "arch-layer-chip", "data-tone": s[2] });
      chip.appendChild(PAS.icon(s[1], { size: 11 }));
      chip.appendChild(document.createTextNode(" " + s[0]));
      wrap.appendChild(chip);
      if (i < stages.length - 1) wrap.appendChild(PAS.icon("chevron-right", { size: 13, color: "var(--text-faint)" }));
      row.appendChild(wrap);
    });
    return row;
  }

  function render() {
    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "git-branch", tone: "indigo", title: "Domain model",
      sub: "The lifecycle, the transaction taxonomy and the rules every desk shares",
      what: "What a policy is, what can happen to it, and who is allowed to start each thing.",
      why: "Every decision desk in this app is one branch of the model on this page.",
    }));

    /* --- the happy path --- */
    var lifePanel = ui.panel({
      title: "The lifecycle every PAS implements",
      what: "New business runs left to right; everything after issue is a mid-term or new-term transaction.",
      why: "A policy spends almost all of its life in the In-force state, which is why servicing and change volume dwarf new business.",
    }, []);
    var lifeBody = lifePanel.querySelector(".panel-body");
    lifeBody.appendChild(stageRow());
    lifeBody.appendChild(ui.h("div", { class: "faint-note mt-13" },
      "From In force, three things can happen mid-term — an Endorsement changes the contract, a Cancellation ends it early (and may later be Reinstated inside a limited window), and a Renewal opens a new term. Absent any of those, the policy reaches Expiry."));
    page.appendChild(lifePanel);

    /* --- taxonomy --- */
    var taxPanel = ui.panel({
      title: "Policy transaction types",
      what: "The seven types Guidewire PolicyCenter defines, which this platform's design docs adopt.",
      why: "Whatever the vendor, every PAS is built around some variant of this same taxonomy.",
      pad: 0,
    }, []);
    taxPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Type",
        { label: "What it does", what: "The business event the type records." },
        { label: "Status", what: "Whether this app can record the type today.", rule: "Reissue is named in the design docs but was never built." },
        { label: "Where", what: "The desk that owns the decision." }],
      rows: TAXONOMY.map(function (t) {
        return [ui.h("span", { class: "cell-name" }, t[0]), t[1],
          ui.pill(t[2] ? "green" : "red", t[2] ? "Implemented" : "Missing"), t[3]];
      }),
      wrapCells: true,
    }));
    var taxNote = ui.h("div", { class: "mt-13" });
    taxNote.appendChild(ui.callout("warn",
      "Reissue is the remaining gap. Correcting a misspelled name on a schedule currently has to be modelled as an Endorsement, which records a coverage change on a ledger a regulator reads — a cosmetic fix and a material change end up looking identical in the history."));
    taxPanel.querySelector(".panel-body").appendChild(taxNote);
    page.appendChild(taxPanel);

    /* --- request-then-decide --- */
    var flowPanel = ui.panel({
      title: "Request, then decide",
      what: "The shape every mid-term transaction shares in this system.",
      why: "Nothing is self-initiated by operations on the spot. A request arrives from outside, and only then does someone with authority decide it.",
    }, []);
    var flowBody = flowPanel.querySelector(".panel-body");
    [
      ["01", "inbox", "blue", "A request arrives", "From the insured, a broker or producer, an automated system trigger, or an underwriter's own portfolio review."],
      ["02", "clock", "amber", "It is held", "The transaction is written to the ledger with status Pending. The policy itself is untouched — no premium moves, no status changes, no documents are generated."],
      ["03", "clipboard-check", "violet", "Someone with authority reviews it", "The decision screen assembles the full context: who asked, through which channel, what it costs, and which rules apply."],
      ["04", "check-circle-2", "green", "It is approved or declined", "Only now does the policy change. The held row flips to Completed or Rejected and the effect is applied in the same write."],
      ["05", "zap", "violet", "A domain event is published", "From the outbox, to whichever downstream consumers care. Read-only calls publish nothing."],
    ].forEach(function (s, i, arr) {
      flowBody.appendChild(ui.lifecycleStage({ n: s[0], icon: s[1], tone: s[2], title: s[3], sub: s[4], last: i === arr.length - 1 }));
    });
    page.appendChild(flowPanel);

    /* --- initiators, read off the live constant --- */
    var initPanel = ui.panel({
      title: "Who can start a change",
      what: "The four initiator roles, and the channels each one reaches the system through.",
      why: "The initiator is recorded on every transaction because it changes what is permitted — an insurer-initiated cancellation may never carry a short-rate penalty, for one.",
      pad: 0,
    }, []);
    initPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Initiator", { label: "Channels", what: "How a request from this role reaches the system." }],
      rows: Object.keys(PAS.INITIATORS).map(function (k) {
        var v = PAS.INITIATORS[k];
        return [ui.pill(v.tone, v.label, v.icon), v.channels.join(" · ")];
      }),
      wrapCells: true,
    }));
    page.appendChild(initPanel);

    /* --- user & role directory: the honest shape of "user management" this prototype has ---
       No real backend auth exists here — there's one browser session, and the role switcher in
       the topbar changes who you're viewing the platform as. What IS real: a permission model
       (canDecide / canRequest / scope) that every screen actually reads, not a decorative label.
       A production system would put real accounts behind these same five rows. */
    var userPanel = ui.panel({
      title: "User & role directory",
      what: "Every role this platform recognizes, with the permissions each one actually carries.",
      why: "This is the real permission model the role switcher, the nav-hiding and the scoped dashboards all read from — PAS.ROLES in store.js, not a separate mock.",
      pad: 0,
    }, []);
    userPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Role", "Identity",
        { label: "Scope", what: "What slice of the book this role sees.", rule: "\"all\" is portfolio-wide; every other scope is a real filter, not a relabeled full view." },
        { label: "Can decide", what: "Whether this role can approve or decline a held transaction." },
        { label: "Can request", what: "Whether this role can raise a new request (a cancellation, an endorsement, a service request)." }],
      rows: Object.keys(PAS.ROLES).map(function (k) {
        var r = PAS.ROLES[k];
        return [ui.pill(r.tone, r.label, r.icon), r.identity, r.scope,
          r.canDecide ? ui.pill("green", "Yes") : ui.pill("gray", "No"),
          r.canRequest ? ui.pill("green", "Yes") : ui.pill("gray", "No")];
      }),
      wrapCells: true,
    }));
    var authNote = ui.h("div", { class: "mt-13" });
    authNote.appendChild(ui.callout("warn", "No real authentication exists — this is one browser session with a role switcher, not a multi-user system. A production build would put real accounts, SSO and row-level permissions behind these same five roles rather than a client-side sessionStorage flag; see docs/common.md's target architecture for where that layer would sit."));
    userPanel.querySelector(".panel-body").appendChild(authNote);
    page.appendChild(userPanel);

    /* --- shared invariants --- */
    var patPanel = ui.panel({
      title: "Patterns shared by every transaction",
      what: "Four structural rules that hold across all seven types.",
      why: "These are the properties that make a policy system a system of record rather than a database with forms on it.",
    }, []);
    var patGrid = ui.h("div", { class: "arch-side-grid" });
    PATTERNS.forEach(function (p) {
      var card = ui.h("div", { class: "arch-side-card" });
      var nameRow = ui.h("div", { class: "arch-side-name" });
      nameRow.appendChild(PAS.icon(p[1], { size: 13 }));
      nameRow.appendChild(document.createTextNode(" " + p[0]));
      card.appendChild(nameRow);
      card.appendChild(ui.h("div", { class: "arch-side-desc" }, p[2]));
      card.appendChild(ui.h("div", { class: "arch-side-desc", style: { marginTop: "7px", color: "var(--text-faint)" } }, p[3]));
      patGrid.appendChild(card);
    });
    patPanel.querySelector(".panel-body").appendChild(patGrid);
    page.appendChild(patPanel);

    /* --- the rules that are actually enforced in code --- */
    var invPanel = ui.panel({
      title: "Invariants the domain enforces",
      what: "Rules the code will not let you break, and rules it currently only warns about.",
      why: "A rule that is displayed but not enforced is documentation, not a control.",
      pad: 0,
    }, []);
    invPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Rule", { label: "Enforced", what: "Whether the UI actually prevents the action." }, "Where"],
      rows: [
        ["A fraud-flagged cancellation can never be reinstated", ui.pill("green", "Enforced"), "reinstatementEligibility"],
        ["Reinstatement outside the window is blocked", ui.pill("green", "Enforced"), "reinstatement-decision"],
        ["A decline must carry a written reason", ui.pill("green", "Enforced"), "underwriting-decision"],
        ["Cancellation type is derived from reason and dates, never chosen", ui.pill("green", "Enforced"), "cancelQuote"],
        ["An insurer-initiated cancellation carries no short-rate penalty", ui.pill("green", "Enforced"), "CANCEL_TYPES"],
        ["Non-payment cancellation requires 15 days' notice", ui.pill("red", "Warns only"), "cancelQuote → noticeOk"],
        ["A material endorsement must be re-underwritten", ui.pill("red", "Warns only"), "endorsement-decision"],
        ["A held transaction may not be approved by whoever raised it", ui.pill("red", "Not modelled"), "no identity yet"],
      ],
      wrapCells: true,
    }));
    page.appendChild(invPanel);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("domain-model", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
