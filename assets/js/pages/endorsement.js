/* Ported from EndorsementList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getScopedPolicies();
    var pend = PAS.pendingOf(policies, "Endorsement");
    var done = policies.reduce(function (acc, p) {
      p.history.filter(function (h) { return h.type === "Endorsement" && h.status !== "Pending"; }).forEach(function (h) { acc.push({ p: p, h: h }); });
      return acc;
    }, []);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "edit-3", tone: "amber", title: "Endorsement Desk", sub: "Mid-term change requests — every one decided, none applied on the spot",
      what: "Change requests from the insured, a broker, or logged by ops on their behalf.",
      why: "Material changes carry real risk and financial impact — nothing touches the policy until an underwriter has reviewed the actual request.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
      { label: "Material", value: pend.filter(function (t) { return t.h.meta && t.h.meta.materiality === "Material"; }).length, tone: "red", tip: "Alters the risk — needs real scrutiny before approval.", why: "Adding a driver or raising a limit changes what's insured, not just paperwork." },
      { label: "Premium at stake", value: PAS.moneyShort(pend.reduce(function (s, e) { return s + Math.abs((e.h.meta && e.h.meta.premiumImpact) || 0); }, 0)), tip: "Absolute premium impact of held requests." },
      { label: "Applied to date", value: done.length, tip: "Endorsements already committed to the ledger." },
    ]));

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "endorsement",
      extraFields: function (extra) {
        extra.changeType = "Address change"; extra.materiality = "Minor"; extra.premiumImpact = "";
        var changeSel = ui.h("select", { class: "field-input" });
        ["Address change", "Add/remove driver", "Vehicle change", "Coverage change", "Limit change"].forEach(function (c) { changeSel.appendChild(ui.h("option", { value: c }, c)); });
        changeSel.addEventListener("change", function () { extra.changeType = changeSel.value; });
        var f1 = ui.field({ label: "Change type" }, changeSel);

        var matSel = ui.h("select", { class: "field-input" });
        ["Minor", "Material"].forEach(function (c) { matSel.appendChild(ui.h("option", { value: c }, c)); });
        matSel.addEventListener("change", function () { extra.materiality = matSel.value; });
        var f2 = ui.field({ label: "Materiality", hint: "Whether this alters the underlying risk." }, matSel);

        var impInput = ui.h("input", { class: "field-input", type: "number", placeholder: "0" });
        impInput.addEventListener("input", function () { extra.premiumImpact = impInput.value; });
        var f3 = ui.field({ label: "Premium impact ($)", hint: "Positive for an increase, negative for a decrease." }, impInput);

        extra.effectiveDate = PAS.todayISO();
        var effInput = ui.h("input", { class: "field-input", type: "date", value: PAS.todayISO() });
        effInput.addEventListener("input", function () { extra.effectiveDate = effInput.value; });
        var f4 = ui.field({ label: "Effective date", hint: "Future-dated and out-of-sequence endorsements are flagged automatically." }, effInput);

        return [f1, f2, f3, f4];
      },
      onSubmit: function (payload) {
        PAS.raiseEndorsement(payload.policyId, {
          changeType: payload.extra.changeType || "Address change",
          materiality: payload.extra.materiality || "Minor",
          premiumImpact: Number(payload.extra.premiumImpact) || 0,
          effectiveDate: payload.extra.effectiveDate || PAS.todayISO(),
          initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note,
        });
        render();
      },
    }));

    function endorseFlags(t) {
      var flags = [];
      if (t.h.meta && t.h.meta.futureDated) flags.push(ui.pill("blue", "Future"));
      if (t.h.meta && t.h.meta.outOfSequence) flags.push(ui.pill("red", "OOS"));
      return ui.h("span", {}, flags.length ? flags : [ui.pill("gray", "—")]);
    }
    function submittedOf(t) { return (t.h.meta && t.h.meta.submittedOn) || t.h.date || ""; }
    var q = "", productF = "All", fromDate = "", toDate = "";
    var products = ["All"].concat(Array.from(new Set(pend.map(function (t) { return t.p.product; }).filter(Boolean))).sort());
    function matchSearch(t) {
      var needle = q.toLowerCase();
      return (!needle || t.p.holder.toLowerCase().indexOf(needle) !== -1 || t.p.id.toLowerCase().indexOf(needle) !== -1)
        && (productF === "All" || t.p.product === productF)
        && (!fromDate || submittedOf(t) >= fromDate) && (!toDate || submittedOf(t) <= toDate);
    }

    page.appendChild(ui.tipLabel({ text: "REQUESTS AWAITING DECISION (" + pend.length + ")", what: "Already-submitted change requests, ordered newest first.", className: "label-11 block mb-9" }));

    var toolbar = ui.h("div", { class: "register-toolbar" });
    var searchWrap = ui.h("div", { class: "register-search" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search by insured name or policy number…", autocomplete: "off" });
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);

    var filters = ui.h("div", { class: "register-filters" });
    var productSelect = ui.h("select", { class: "register-select", title: "Line of business" });
    products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All LOBs" : p)); });
    filters.appendChild(productSelect);
    var fromInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Submitted from" });
    filters.appendChild(fromInput);
    var toInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Submitted to" });
    filters.appendChild(toInput);
    toolbar.appendChild(filters);

    var endorsementTable = ui.sortableTable({
      storageKey: "pas.endorsement.columns.v1",
      defaultVisible: ["requestedBy", "change", "effective", "flags", "materiality", "premiumImpact"],
      columns: [
        { key: "policy", label: "Policy", locked: true, sortValue: function (t) { return t.p.id; }, cell: function (t) { return ui.cellId(t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (t) { return (t.p.holder || "").toLowerCase(); }, cell: function (t) { return ui.cellName(t.p.holder); } },
        { key: "requestedBy", label: "Requested by", sortValue: function (t) { return (t.h.meta && t.h.meta.initiatedBy) || ""; }, cell: function (t) { return ui.initiatorPill(t.h.meta); } },
        { key: "change", label: "Change", what: "Category of mid-term change.", sortValue: function (t) { return t.h.meta.changeType || ""; }, cell: function (t) { return t.h.meta.changeType; } },
        { key: "effective", label: "Effective", what: "Business date the change applies from.", sortValue: function (t) { return t.h.meta.effectiveDate || t.h.date; }, cell: function (t) { return t.h.meta.effectiveDate || t.h.date; } },
        { key: "flags", label: "Flags", what: "Future-dated or out-of-sequence.", sortValue: function (t) { return (t.h.meta && t.h.meta.futureDated ? "Future" : "") + (t.h.meta && t.h.meta.outOfSequence ? "OOS" : ""); }, cell: endorseFlags },
        { key: "materiality", label: "Materiality", what: "Whether this alters the underlying risk.", rule: "Material changes require re-underwriting before they can be approved.", sortValue: function (t) { return t.h.meta.materiality || ""; }, cell: function (t) { return ui.pill(t.h.meta.materiality === "Material" ? "red" : "gray", t.h.meta.materiality); } },
        { key: "premiumImpact", label: "Premium impact", what: "Prorated delta from effective date to end of term.", sortValue: function (t) { return (t.h.meta && t.h.meta.premiumImpact) || 0; }, cell: function (t) { var impact = (t.h.meta && t.h.meta.premiumImpact) || 0; return ui.h("span", { style: { color: impact >= 0 ? "var(--green)" : "var(--red)", fontWeight: "700" } }, (impact >= 0 ? "+" : "") + PAS.money(impact)); } },
        { key: "product", label: "Product", sortValue: function (t) { return t.p.product || ""; }, cell: function (t) { return t.p.product || "—"; } },
        { key: "currentPremium", label: "Current premium", what: "The policy's premium before this endorsement applies.", sortValue: function (t) { return t.p.premium || 0; }, cell: function (t) { return PAS.money(t.p.premium); } },
        { key: "newPremium", label: "New premium", what: "Current premium plus this request's impact — what the policy moves to if approved.", sortValue: function (t) { return (t.p.premium || 0) + ((t.h.meta && t.h.meta.premiumImpact) || 0); }, cell: function (t) { return PAS.money((t.p.premium || 0) + ((t.h.meta && t.h.meta.premiumImpact) || 0)); } },
        { key: "broker", label: "Broker", sortValue: function (t) { return t.p.producer || ""; }, cell: function (t) { return t.p.producer || "—"; } },
        { key: "mga", label: "MGA", sortValue: function (t) { return t.p.mga || ""; }, cell: function (t) { return t.p.mga || "—"; } },
        { key: "carrier", label: "Carrier", sortValue: function (t) { return t.p.carrier || ""; }, cell: function (t) { return t.p.carrier || "—"; } },
        { key: "state", label: "State", sortValue: function (t) { return t.p.state || ""; }, cell: function (t) { return t.p.state || "—"; } },
        { key: "channel", label: "Channel", what: "How the request came in.", sortValue: function (t) { return (t.h.meta && t.h.meta.channel) || ""; }, cell: function (t) { return (t.h.meta && t.h.meta.channel) || "—"; } },
        { key: "submitted", label: "Submitted", what: "When the request was logged.", sortValue: function (t) { return (t.h.meta && t.h.meta.submittedOn) || t.h.date || ""; }, cell: function (t) { return (t.h.meta && t.h.meta.submittedOn) || t.h.date || "—"; } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Review"); } },
      rows: function () { return pend.filter(matchSearch); },
      onRowClick: function (t) { location.href = "endorsement-decision.html?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id); },
      emptyText: "No endorsements match that search.",
    });
    toolbar.appendChild(endorsementTable.columnsControl);
    page.appendChild(toolbar);

    var noteEl = ui.h("div", { class: "faint-note mb-9" });
    page.appendChild(noteEl);
    page.appendChild(endorsementTable.tableWrap);

    function refresh() {
      var filtered = pend.filter(matchSearch);
      noteEl.textContent = (q || productF !== "All" || fromDate || toDate) ? "Showing " + filtered.length + " of " + pend.length + " requests." : "";
      endorsementTable.rebuild();
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; refresh(); });
    productSelect.addEventListener("change", function () { productF = productSelect.value; refresh(); });
    fromInput.addEventListener("change", function () { fromDate = fromInput.value; refresh(); });
    toInput.addEventListener("change", function () { toDate = toInput.value; refresh(); });

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("endorsement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
