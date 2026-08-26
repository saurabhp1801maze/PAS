/* Ported from CancellationList in the original App.jsx. Cancellation is modeled as four
   independent attributes — Type (the refund basis), Reason (why), Initiated By (who) and Timing
   (when) — rather than one reason string with type baked in. Type is still derived, never
   hand-picked (see store.js's deriveCancelType). */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pend = PAS.pendingOf(policies, "Cancellation");
    var hist = policies.reduce(function (acc, x) {
      x.history.filter(function (h) { return h.type === "Cancellation" && h.status !== "Pending"; }).forEach(function (h) { acc.push({ x: x, h: h }); });
      return acc;
    }, []);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "x-circle", tone: "red", title: "Cancellation Desk", sub: "Requests already received — type, refund and notice are all derived from what was submitted",
      what: "Every cancellation begins as a request from the insured, a broker, or the carrier's own review — never something ops invents on the spot.",
      why: "Getting the type wrong means refunding money you were entitled to keep, or breaching a statutory notice rule.",
    }));

    /* Auto-cancelled: the System raised AND completed the cancellation itself, for Non-Payment.
       The real trigger — never modeled as a UI action — is Billing telling the policy system
       that premium is still unpaid once the grace period has run out; the System reacts to that
       notification by cancelling on its own, with nobody in ops clicking anything. */
    var autoCancelled = hist.filter(function (t) { return t.h.status === "Completed" && t.h.meta && t.h.meta.reason === "Non-Payment" && t.h.meta.initiatedBy === "System"; });
    var dnocPending = pend.filter(function (t) {
      var st = PAS.dnocState(t.h.meta || {});
      return st.required && (!st.ready);
    });

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
      { label: "DNOC pending", value: dnocPending.length, tone: "violet", tip: "Insurer-side cancellations waiting on Direct Notice of Cancellation countdown.", why: "System/Carrier/MGA cancellations with a statutory notice period must serve DNOC; pending days count down to zero before cancel can complete." },
      { label: "From insurer side", value: pend.filter(function (t) { return PAS.CANCEL_INSURER_SIDE[t.h.meta.initiatedBy]; }).length, tip: "Initiated by the Carrier, an MGA, or the System — e.g. non-payment, adverse loss ratio." },
      { label: "Auto-cancelled (non-payment)", value: autoCancelled.length, tone: "red", tip: "Cancelled automatically by the System for Non-Payment after DNOC notice ran.", why: "Billing reports unpaid premium past grace; System serves DNOC, waits notice days, then cancels." },
    ]));

    /* Reference accordion: terminology → types → reasons. Collapsed by default so the
       decision queue stays the primary surface; each section opens independently. */
    var termBody = ui.h("div", {});
    termBody.appendChild(ui.h("p", { class: "term-intro" },
      "A cancellation is four independent values — not one reason string. Type is derived from the others; it is never hand-picked."));
    termBody.appendChild(ui.dataTable({
      columns: [
        "Attribute",
        { label: "Answers", what: "The question this attribute owns." },
        { label: "Values", what: "Allowed values recorded on the request." },
      ],
      rows: [
        ["Type", "What happens financially", "Flat · Pro-Rata · Short-Rate"],
        ["Reason", "Why cover is ending", Object.keys(PAS.CANCEL_REASONS).join(" · ")],
        ["Initiated By", "Who raised the request", (PAS.CANCEL_INITIATOR_KEYS || []).join(" · ")],
        ["Timing", "When it takes effect", "Immediate · Future/Scheduled"],
      ],
      wrapCells: true,
    }));

    var typeGrid = ui.h("div", { class: "cancel-type-grid" });
    Object.keys(PAS.CANCEL_TYPES).forEach(function (name) {
      var t = PAS.CANCEL_TYPES[name];
      var card = ui.h("div", { class: "cancel-type-card" });
      card.appendChild(ui.pill(t.tone, name));
      card.appendChild(ui.h("div", { class: "cancel-type-desc" }, t.when));
      card.appendChild(ui.h("div", { class: "cancel-type-meta" }, (t.penaltyPct ? (t.penaltyPct * 100 + "% penalty") : "no penalty") + " · " + t.basis + " basis"));
      typeGrid.appendChild(ui.tooltip({ what: t.when, why: t.rate, rule: t.rule, width: 300 }, card));
    });

    var reasonTable = ui.dataTable({
      columns: ["Reason",
        { label: "Notice required", what: "Days that must run before the effective date." },
        { label: "Default type", what: "What Type this reason recommends, before the Initiated By check applies.", rule: "An insurer-side Initiated By (Carrier, MGA, System) downgrades a Short-Rate default to Pro-Rata — it can never upgrade a no-penalty reason into one." }],
      rows: Object.keys(PAS.CANCEL_REASONS).map(function (r) {
        var spec = PAS.CANCEL_REASONS[r];
        return [r, spec.noticeDays + " days", ui.pill(PAS.CANCEL_TYPES[spec.defaultType].tone, spec.defaultType)];
      }),
      wrapCells: true,
    });

    page.appendChild(ui.accordion({
      sections: [
        {
          title: "Terminology",
          sub: "Type, Reason, Initiated By, and Timing — four attributes, one cancellation",
          what: "How a cancellation is described in this desk.",
          why: "Splitting them keeps notice periods on Reason and penalty rules on Initiated By, instead of baking everything into one string.",
          open: false,
          body: termBody,
        },
        {
          title: "Types of cancellation",
          sub: "Flat, Pro-Rata, and Short-Rate — the refund basis, derived never chosen",
          what: "The three refund bases a cancellation can derive to.",
          why: "Getting Type wrong means refunding money you were entitled to keep, or applying a penalty the insurer side may never charge.",
          open: false,
          body: typeGrid,
        },
        {
          title: "Reason, notice & default type",
          sub: "Every raisable reason, its notice days, and the Type it proposes",
          what: "Every reason a cancellation can be raised for.",
          why: "Notice period is a property of Reason, not Type — Non-Payment needs its statutory days regardless of which refund type it derives to.",
          open: false,
          pad: 0,
          body: reasonTable,
        },
      ],
    }));

    /* Refund-wise breakdown: every completed cancellation already carries its decided type,
       reason and refund on `meta` — this is that history grouped two ways rather than a new
       computation. Pending requests are excluded deliberately: their refund is a live quote, not
       yet a fact, and mixing a projection into a completed total would misstate what's actually
       been paid out. */
    var completed = hist.filter(function (t) { return t.h.status === "Completed"; });
    var totalRefunded = completed.reduce(function (s, t) { return s + (Number(t.h.meta && t.h.meta.refund) || 0); }, 0);
    function groupRefunds(field) {
      var keys = Array.from(new Set(completed.map(function (t) { return (t.h.meta && t.h.meta[field]) || "—"; })));
      return keys.map(function (k) {
        var rows = completed.filter(function (t) { return ((t.h.meta && t.h.meta[field]) || "—") === k; });
        return { k: k, v: rows.reduce(function (s, t) { return s + (Number(t.h.meta && t.h.meta.refund) || 0); }, 0), n: rows.length };
      }).sort(function (a, b) { return b.v - a.v; });
    }
    /* The two panels below only ever show it split by type or by reason — shown plainly here too,
       not just implied by two partial breakdowns or left inside a hover tooltip. */
    page.appendChild(ui.h("div", { class: "label-11 mb-9" },
      "Total refunded to date: " + PAS.money(totalRefunded) + " across " + completed.length + " completed cancellation" + (completed.length === 1 ? "" : "s") + "."));

    var refundGrid = ui.h("div", { class: "two-col-grid" });
    var byTypePanel = ui.panel({ title: "Refunds by type", what: "Total refunded, grouped by the decided cancellation type.", why: "Total refunded to date: " + PAS.money(totalRefunded) + " across " + completed.length + " completed cancellations." }, []);
    var byTypeBody = byTypePanel.querySelector(".panel-body");
    var byType = groupRefunds("cancelType");
    if (byType.length === 0) byTypeBody.appendChild(ui.h("div", { class: "faint-note" }, "No completed cancellations yet."));
    else {
      var maxType = Math.max.apply(null, byType.map(function (r) { return r.v; }).concat([1]));
      byType.forEach(function (r) { byTypeBody.appendChild(ui.hbar({ label: r.k, value: r.v, max: maxType, note: PAS.money(r.v) + " · " + r.n, tone: (PAS.CANCEL_TYPES[r.k] && PAS.CANCEL_TYPES[r.k].tone) || "gray" })); });
    }
    refundGrid.appendChild(byTypePanel);

    var byReasonPanel = ui.panel({ title: "Refunds by reason", what: "Total refunded, grouped by the stated reason.", why: "Where the money is actually going out — not just why a policy was cancelled." }, []);
    var byReasonBody = byReasonPanel.querySelector(".panel-body");
    var byReason = groupRefunds("reason");
    if (byReason.length === 0) byReasonBody.appendChild(ui.h("div", { class: "faint-note" }, "No completed cancellations yet."));
    else {
      var maxReason = Math.max.apply(null, byReason.map(function (r) { return r.v; }).concat([1]));
      byReason.forEach(function (r) { byReasonBody.appendChild(ui.hbar({ label: r.k, value: r.v, max: maxReason, note: PAS.money(r.v) + " · " + r.n, tone: r.v === maxReason ? "indigo" : "blue" })); });
    }
    refundGrid.appendChild(byReasonPanel);
    page.appendChild(refundGrid);

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "cancellation",
      initiatorKeys: PAS.CANCEL_INITIATOR_KEYS,
      extraFields: function (extra) {
        var reasons = Object.keys(PAS.CANCEL_REASONS);
        extra.reason = reasons[0];
        var sel = ui.h("select", { class: "field-input" });
        reasons.forEach(function (r) { sel.appendChild(ui.h("option", { value: r }, r)); });
        sel.addEventListener("change", function () { extra.reason = sel.value; });
        return ui.field({ label: "Reason" }, sel);
      },
      onSubmit: function (payload) {
        PAS.raiseRequest(payload.policyId, "Cancellation", { reason: payload.extra.reason || Object.keys(PAS.CANCEL_REASONS)[0], initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note });
        render();
      },
    }));

    /* Reason/type/refund are derived once per row here (same formulas the decision screen itself
       uses) rather than recomputed separately inside sortValue and cell for every column. */
    var pendEnriched = pend.map(function (t) {
      var meta = t.h.meta || {};
      var reason = meta.reason || "Insured Request";
      var initiatedBy = meta.initiatedBy || "Insured";
      var effDate = t.h.date || PAS.todayISO();
      var atInception = effDate <= t.p.effectiveDate;
      var type = PAS.deriveCancelType(reason, initiatedBy, atInception);
      var quote = PAS.cancelQuote(t.p, reason, initiatedBy, effDate, meta);
      var dnoc = PAS.dnocState(meta);
      var submittedOn = meta.submittedOn || (t.h.recordedAt ? String(t.h.recordedAt).slice(0, 10) : "");
      var dnocIssueDate = meta.dnocServedOn || "";
      /* Expire = notice end. Prefer stored DNOC effective; else planned txn date when DNOC required. */
      var dnocExpireDate = meta.dnocEffectiveDate || (dnoc.required ? (t.h.date || "") : "");
      var dnocBucket = !dnoc.required ? "na" : (!dnoc.served ? "serve" : (!dnoc.ready ? "pending" : "ready"));
      return {
        t: t, meta: meta, reason: reason, initiatedBy: initiatedBy, effDate: effDate, type: type,
        refund: Math.round(quote.refund), dnoc: dnoc, submittedOn: submittedOn,
        dnocIssueDate: dnocIssueDate, dnocExpireDate: dnocExpireDate, dnocBucket: dnocBucket,
      };
    });

    var q = "";
    var reasonF = "All";
    var initiatorF = "All";
    var dnocF = "All";

    function matchRow(r) {
      var needle = q.toLowerCase();
      var textOk = !needle
        || (r.t.p.holder || "").toLowerCase().indexOf(needle) !== -1
        || (r.t.p.id || "").toLowerCase().indexOf(needle) !== -1
        || (r.reason || "").toLowerCase().indexOf(needle) !== -1;
      var reasonOk = reasonF === "All" || r.reason === reasonF;
      var initiatorOk = initiatorF === "All" || r.initiatedBy === initiatorF;
      var dnocOk = dnocF === "All" || r.dnocBucket === dnocF;
      return textOk && reasonOk && initiatorOk && dnocOk;
    }

    function filteredRows() {
      return pendEnriched.filter(matchRow);
    }

    page.appendChild(ui.tipLabel({ text: "REQUESTS AWAITING DECISION (" + pend.length + ")", what: "Already-submitted requests. Search and filters apply before pagination.", className: "label-11 block mb-9" }));

    var toolbar = ui.h("div", { class: "register-toolbar" });
    var searchWrap = ui.h("div", { class: "register-search" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", {
      class: "register-search-input",
      type: "search",
      placeholder: "Search by insured, policy, or reason…",
      autocomplete: "off",
    });
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);

    var filters = ui.h("div", { class: "register-filters" });
    var reasonSelect = ui.h("select", { class: "register-select", title: "Reason" });
    reasonSelect.appendChild(ui.h("option", { value: "All" }, "All reasons"));
    Object.keys(PAS.CANCEL_REASONS).forEach(function (r) {
      reasonSelect.appendChild(ui.h("option", { value: r }, r));
    });
    filters.appendChild(reasonSelect);

    var initiatorSelect = ui.h("select", { class: "register-select", title: "Initiated by" });
    initiatorSelect.appendChild(ui.h("option", { value: "All" }, "All initiators"));
    (PAS.CANCEL_INITIATOR_KEYS || []).forEach(function (k) {
      initiatorSelect.appendChild(ui.h("option", { value: k }, k));
    });
    filters.appendChild(initiatorSelect);

    var dnocSelect = ui.h("select", { class: "register-select", title: "DNOC" });
    [
      ["All", "All DNOC"],
      ["serve", "Serve DNOC"],
      ["pending", "DNOC pending"],
      ["ready", "DNOC ready"],
      ["na", "DNOC N/A"],
    ].forEach(function (opt) {
      dnocSelect.appendChild(ui.h("option", { value: opt[0] }, opt[1]));
    });
    filters.appendChild(dnocSelect);
    toolbar.appendChild(filters);

    var cancellationTable = ui.sortableTable({
      storageKey: "pas.cancellation.columns.v4",
      pageSize: 10,
      defaultVisible: ["requestedBy", "reason", "type", "dnoc", "dnocIssueDate", "dnocExpireDate", "submitted", "premium"],
      columns: [
        { key: "policy", label: "Policy", locked: true, sortValue: function (r) { return r.t.p.id; }, cell: function (r) { return ui.cellId(r.t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (r) { return (r.t.p.holder || "").toLowerCase(); }, cell: function (r) { return ui.cellName(r.t.p.holder); } },
        { key: "requestedBy", label: "Requested by", sortValue: function (r) { return r.meta.initiatedBy || ""; }, cell: function (r) { return ui.initiatorPill(r.meta); } },
        { key: "reason", label: "Reason", what: "What the requester gave as their reason.", why: "Drives the default type and the notice period.", sortValue: function (r) { return r.reason; }, cell: function (r) { return r.reason; } },
        { key: "type", label: "Type", what: "The derived refund basis — Reason plus Initiated By, never hand-picked.", sortValue: function (r) { return r.type; }, cell: function (r) { return ui.pill(PAS.CANCEL_TYPES[r.type].tone, r.type); } },
        { key: "dnoc", label: "DNOC", what: "Direct Notice of Cancellation status for insurer-side cancellations.", why: "Pending days must reach zero before cancel can complete.", sortValue: function (r) { return r.dnoc.required ? r.dnoc.pendingDays : -1; }, cell: function (r) {
          if (!r.dnoc.required) return ui.pill("gray", "N/A");
          if (!r.dnoc.served) return ui.pill("amber", "Serve DNOC");
          if (!r.dnoc.ready) return ui.pill("violet", r.dnoc.pendingDays + "d pending");
          return ui.pill("green", "Ready");
        } },
        { key: "dnocIssueDate", label: "DNOC issue date", what: "Date Direct Notice of Cancellation was served (issued).", why: "Notice countdown starts from this date.", sortValue: function (r) { return r.dnocIssueDate || ""; }, cell: function (r) {
          return r.dnocIssueDate || "—";
        } },
        { key: "dnocExpireDate", label: "DNOC expire date", what: "Date the statutory notice period ends — cancellation may complete on or after this date.", why: "Always after the request was submitted when notice days apply.", sortValue: function (r) { return r.dnocExpireDate || ""; }, cell: function (r) {
          return r.dnocExpireDate || "—";
        } },
        { key: "timing", label: "Timing", what: "Immediate if the effective date is today or past, Future/Scheduled otherwise.", sortValue: function (r) { return PAS.cancelTiming(r.effDate); }, cell: function (r) { return PAS.cancelTiming(r.effDate); } },
        { key: "submitted", label: "Submitted", what: "When the cancellation request was logged — always before DNOC expire when notice applies.", sortValue: function (r) { return r.submittedOn || ""; }, cell: function (r) { return r.submittedOn || "—"; } },
        { key: "premium", label: "Premium", what: "Refund due if this request is approved.", why: "Same live quote shown as Refund due on the decision screen — derived from type, term dates and effective date.", sortValue: function (r) { return r.refund; }, cell: function (r) { return PAS.money(r.refund); } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Review"); } },
      rows: filteredRows,
      onRowClick: function (r) { location.href = "cancellation-decision.html?policy=" + encodeURIComponent(r.t.p.id) + "&txn=" + encodeURIComponent(r.t.h.id); },
      emptyText: "No cancellation requests match the current search or filters.",
      wrapCells: true,
    });
    toolbar.appendChild(cancellationTable.columnsControl);
    page.appendChild(toolbar);

    var filterNote = ui.h("div", { class: "faint-note mb-9" });
    function refreshFilterNote() {
      var n = filteredRows().length;
      var active = q || reasonF !== "All" || initiatorF !== "All" || dnocF !== "All";
      filterNote.textContent = active ? ("Showing " + n + " of " + pendEnriched.length + " pending.") : "";
      filterNote.style.display = active ? "" : "none";
    }
    refreshFilterNote();
    page.appendChild(filterNote);
    page.appendChild(cancellationTable.tableWrap);

    function onFilterChange() {
      cancellationTable.resetPage();
      refreshFilterNote();
      cancellationTable.rebuild();
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; onFilterChange(); });
    reasonSelect.addEventListener("change", function () { reasonF = reasonSelect.value; onFilterChange(); });
    initiatorSelect.addEventListener("change", function () { initiatorF = initiatorSelect.value; onFilterChange(); });
    dnocSelect.addEventListener("change", function () { dnocF = dnocSelect.value; onFilterChange(); });

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("cancellation-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
