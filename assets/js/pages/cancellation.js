/* Ported from CancellationList in the original App.jsx. Cancellation is modeled as four
   independent attributes — Type (the refund basis), Reason (why), Initiated By (who) and Timing
   (when) — rather than one reason string with type baked in. Type is still derived, never
   hand-picked (see store.js's deriveCancelType). */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  /* On the Cancellation desk specifically, a Carrier/Reinsurer-initiated request displays as
     "MGA" rather than the shared "Reinsurer" label PAS.INITIATORS uses everywhere else — a
     deliberate choice, so it does read the same as a genuinely MGA-initiated request in this
     desk's own Requested-by column/filter. Kept as a local override (see ui.initiatorPill /
     ui.requestOrigin) rather than a change to PAS.INITIATORS itself, so every other desk that
     shows "Reinsurer" as an initiator keeps its own real distinction. */
  var CANCEL_INITIATOR_LABEL_OVERRIDE = { Carrier: "MGA" };
  function cancelInitiatorLabel(key) { return CANCEL_INITIATOR_LABEL_OVERRIDE[key] || (PAS.INITIATORS[key] || PAS.INITIATORS.Insured).label; }

  function render() {
    var policies = PAS.getScopedPolicies();
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

    /* Types of cancellation: the one reference panel kept on this page — Flat / Pro-Rata /
       Short-Rate, the refund basis, always derived, never hand-picked. The "Terminology" glossary
       and the "Reason, notice & default type" lookup table that used to sit either side of it are
       gone: both were static reference text duplicating what the decision screen's own worked
       refund breakdown now shows for real, per request, with real numbers. */
    var typeGrid = ui.h("div", { class: "cancel-type-grid" });
    Object.keys(PAS.CANCEL_TYPES).forEach(function (name) {
      var t = PAS.CANCEL_TYPES[name];
      var card = ui.h("div", { class: "cancel-type-card" });
      card.appendChild(ui.pill(t.tone, name));
      card.appendChild(ui.h("div", { class: "cancel-type-desc" }, t.when));
      card.appendChild(ui.h("div", { class: "cancel-type-meta" }, t.rate));
      typeGrid.appendChild(ui.tooltip({ what: t.when, why: t.rate, rule: t.rule, width: 300 }, card));
    });
    var typesPanel = ui.panel({
      title: "Types of cancellation",
      what: "The three refund bases a cancellation can derive to — Flat, Pro-Rata, and Short-Rate.",
      why: "Getting Type wrong means refunding money you were entitled to keep, or applying a penalty the insurer side may never charge. See any request's own decision screen for the worked-out, per-day refund math.",
      collapsible: true,
      defaultOpen: false,
    }, [typeGrid]);
    page.appendChild(typesPanel);

    /* Total refunded to date across completed cancellations. Pending requests are excluded
       deliberately: their refund is a live quote, not yet a fact, and mixing a projection into a
       completed total would misstate what's actually been paid out. */
    var completed = hist.filter(function (t) { return t.h.status === "Completed"; });
    var totalRefunded = completed.reduce(function (s, t) { return s + (Number(t.h.meta && t.h.meta.refund) || 0); }, 0);
    page.appendChild(ui.h("div", { class: "label-11 mb-9" },
      "Total refunded to date: " + PAS.money(totalRefunded) + " across " + completed.length + " completed cancellation" + (completed.length === 1 ? "" : "s") + "."));

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
        PAS.raiseRequest(payload.policyId, "Cancellation", { reason: payload.extra.reason || Object.keys(PAS.CANCEL_REASONS)[0], initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note, category: payload.extra.category });
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
    var productF = "All";
    var fromDate = "", toDate = "";
    var products = ["All"].concat(Array.from(new Set(pendEnriched.map(function (r) { return r.t.p.product; }).filter(Boolean))).sort());

    function matchRow(r) {
      var needle = q.toLowerCase();
      var textOk = !needle
        || (r.t.p.holder || "").toLowerCase().indexOf(needle) !== -1
        || (r.t.p.id || "").toLowerCase().indexOf(needle) !== -1
        || (r.reason || "").toLowerCase().indexOf(needle) !== -1;
      var reasonOk = reasonF === "All" || r.reason === reasonF;
      var initiatorOk = initiatorF === "All" || r.initiatedBy === initiatorF;
      var dnocOk = dnocF === "All" || r.dnocBucket === dnocF;
      var productOk = productF === "All" || r.t.p.product === productF;
      var dateOk = (!fromDate || r.submittedOn >= fromDate) && (!toDate || r.submittedOn <= toDate);
      return textOk && reasonOk && initiatorOk && dnocOk && productOk && dateOk;
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
      initiatorSelect.appendChild(ui.h("option", { value: k }, cancelInitiatorLabel(k)));
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

    var productSelect = ui.h("select", { class: "register-select", title: "Line of business" });
    products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All LOBs" : p)); });
    filters.appendChild(productSelect);

    var fromInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Submitted from" });
    filters.appendChild(fromInput);
    var toInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Submitted to" });
    filters.appendChild(toInput);
    toolbar.appendChild(filters);

    var cancellationTable = ui.sortableTable({
      storageKey: "pas.cancellation.columns.v4",
      pageSize: 10,
      defaultVisible: ["requestedBy", "reason", "type", "dnoc", "dnocIssueDate", "dnocExpireDate", "submitted", "premium"],
      columns: [
        { key: "policy", label: "Policy", locked: true, sortValue: function (r) { return r.t.p.id; }, cell: function (r) { return ui.cellId(r.t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (r) { return (r.t.p.holder || "").toLowerCase(); }, cell: function (r) { return ui.cellName(r.t.p.holder); } },
        { key: "requestedBy", label: "Requested by", sortValue: function (r) { return r.meta.initiatedBy || ""; }, cell: function (r) { return ui.initiatorPill(r.meta, CANCEL_INITIATOR_LABEL_OVERRIDE); } },
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
        { key: "submitted", label: "Submitted", what: "When the cancellation request was logged — always before DNOC expire when notice applies.", sortValue: function (r) { return r.submittedOn || ""; }, cell: function (r) { return r.submittedOn ? PAS.fmtDate(r.submittedOn) : "—"; } },
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
      var active = q || reasonF !== "All" || initiatorF !== "All" || dnocF !== "All" || productF !== "All" || fromDate || toDate;
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
    productSelect.addEventListener("change", function () { productF = productSelect.value; onFilterChange(); });
    fromInput.addEventListener("change", function () { fromDate = fromInput.value; onFilterChange(); });
    toInput.addEventListener("change", function () { toDate = toInput.value; onFilterChange(); });

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("cancellation-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
