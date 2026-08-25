/* Ported from ReinstatementList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
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

    page.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Already-submitted reinstatement requests.", className: "label-11 block mb-9" }));
    page.appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Requested by", { label: "Cancelled on", what: "Effective date of the original cancellation." }, { label: "Days since", what: "Elapsed days — eligibility is a pure function of this." }, { label: "Eligibility", what: "Whether reinstatement is still available.", rule: "Fraud cancellations are never eligible." }, ""],
      rows: pend.map(function (t) {
        var el = PAS.reinstatementEligibility(t.p);
        return [ui.cellId(t.p.id), ui.cellName(t.p.holder), ui.initiatorPill(t.h.meta), el.cancelEv.date, el.daysSince + "d",
          ui.pill(el.eligible ? "green" : "red", el.eligible ? "Eligible" : (el.fraud ? "Fraud — barred" : "Window closed"), el.eligible ? "check-circle-2" : "alert-triangle"),
          ui.cellOpen("Review")];
      }),
      emptyText: "No reinstatement requests awaiting decision.",
      onRowClick: function (i) { location.href = "reinstatement-decision.html?policy=" + encodeURIComponent(pend[i].p.id) + "&txn=" + encodeURIComponent(pend[i].h.id); },
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("reinstatement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
