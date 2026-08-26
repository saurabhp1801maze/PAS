/* Ported from ReinstatementList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getScopedPolicies();
    var pend = PAS.pendingOf(policies, "Reinstatement");
    var cancelled = policies.filter(function (p) { return p.status === "Cancelled" && !pend.some(function (t) { return t.p.id === p.id; }); });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "rotate-ccw", tone: "green", title: "Reinstatement Desk", sub: "A cancelled policy is reinstated only on a request from the insured or broker",
      what: "Cancelled policies with a reinstatement request already submitted.",
      why: "Reinstatement is conditional — it closes permanently after " + PAS.REINSTATEMENT_WINDOW_DAYS + " days, and ops never initiates it unprompted.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Reinstatement requests submitted, not yet decided." },
      { label: "Still eligible", value: pend.filter(function (t) { var e = PAS.reinstatementEligibility(t.p); return e && e.eligible; }).length, tone: "green", tip: "Inside the window and not fraud-cancelled." },
      { label: "Window", value: PAS.REINSTATEMENT_WINDOW_DAYS + " days", tip: "Time allowed after cancellation.", why: "Beyond it, the risk needs new-business underwriting." },
      { label: "Cancelled, no request yet", value: cancelled.length, tip: "Closed out — nobody has asked to reinstate them." },
    ]));

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Cancelled"; }),
      typeLabel: "reinstatement",
      extraFields: function () { return null; },
      onSubmit: function (payload) {
        PAS.raiseRequest(payload.policyId, "Reinstatement", { initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note });
        render();
      },
    }));

    var pendEnriched = pend.map(function (t) { return { t: t, el: PAS.reinstatementEligibility(t.p) }; });
    var q = "", productF = "All", fromDate = "", toDate = "";
    var products = ["All"].concat(Array.from(new Set(pendEnriched.map(function (r) { return r.t.p.product; }).filter(Boolean))).sort());
    function matchAll(r) {
      var needle = q.toLowerCase();
      var cancelledOn = r.el.cancelEv.date || "";
      return (!needle || r.t.p.holder.toLowerCase().indexOf(needle) !== -1 || r.t.p.id.toLowerCase().indexOf(needle) !== -1)
        && (productF === "All" || r.t.p.product === productF)
        && (!fromDate || cancelledOn >= fromDate) && (!toDate || cancelledOn <= toDate);
    }

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
    var fromInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Cancelled on, from" });
    filters.appendChild(fromInput);
    var toInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Cancelled on, to" });
    filters.appendChild(toInput);
    toolbar.appendChild(filters);
    page.appendChild(toolbar);

    var reqHead = ui.h("div", { class: "period-toggle-row" });
    reqHead.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Already-submitted reinstatement requests.", className: "label-11" }));
    var reinstatementTable = ui.sortableTable({
      storageKey: "pas.reinstatement.columns.v1",
      columns: [
        { key: "policy", label: "Policy", locked: true, sortValue: function (r) { return r.t.p.id; }, cell: function (r) { return ui.cellId(r.t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (r) { return (r.t.p.holder || "").toLowerCase(); }, cell: function (r) { return ui.cellName(r.t.p.holder); } },
        { key: "requestedBy", label: "Requested by", sortValue: function (r) { return (r.t.h.meta && r.t.h.meta.initiatedBy) || ""; }, cell: function (r) { return ui.initiatorPill(r.t.h.meta); } },
        { key: "cancelledOn", label: "Cancelled on", what: "Effective date of the original cancellation.", sortValue: function (r) { return r.el.cancelEv.date; }, cell: function (r) { return r.el.cancelEv.date; } },
        { key: "daysSince", label: "Days since", what: "Elapsed days — eligibility is a pure function of this.", sortValue: function (r) { return r.el.daysSince; }, cell: function (r) { return r.el.daysSince + "d"; } },
        { key: "eligibility", label: "Eligibility", what: "Whether reinstatement is still available.", rule: "Fraud cancellations are never eligible.", sortValue: function (r) { return r.el.eligible ? "Eligible" : (r.el.fraud ? "Fraud" : "Window closed"); }, cell: function (r) { return ui.pill(r.el.eligible ? "green" : "red", r.el.eligible ? "Eligible" : (r.el.fraud ? "Fraud — barred" : "Window closed"), r.el.eligible ? "check-circle-2" : "alert-triangle"); } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Review"); } },
      rows: function () { return pendEnriched.filter(matchAll); },
      onRowClick: function (r) { location.href = "reinstatement-decision.html?policy=" + encodeURIComponent(r.t.p.id) + "&txn=" + encodeURIComponent(r.t.h.id); },
      emptyText: "No reinstatement requests match that search.",
    });
    reqHead.appendChild(reinstatementTable.columnsControl);
    page.appendChild(reqHead);

    var noteEl = ui.h("div", { class: "faint-note mb-9" });
    page.appendChild(noteEl);
    page.appendChild(reinstatementTable.tableWrap);

    function refresh() {
      var filtered = pendEnriched.filter(matchAll);
      noteEl.textContent = (q || productF !== "All" || fromDate || toDate) ? "Showing " + filtered.length + " of " + pendEnriched.length + " requests." : "";
      reinstatementTable.rebuild();
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; refresh(); });
    productSelect.addEventListener("change", function () { productF = productSelect.value; refresh(); });
    fromInput.addEventListener("change", function () { fromDate = fromInput.value; refresh(); });
    toInput.addEventListener("change", function () { toDate = toInput.value; refresh(); });

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("reinstatement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
