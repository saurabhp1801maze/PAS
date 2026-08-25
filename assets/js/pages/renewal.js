/* Ported from RenewalList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pend = PAS.pendingOf(policies, "Renewal");
    var noRequest = policies.filter(function (p) { return p.status === "Active" && !pend.some(function (t) { return t.p.id === p.id; }); })
      .sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "refresh-cw", tone: "blue", title: "Renewal Desk", sub: "Renewal is decided against a confirmed request, never started from the desk",
      what: "Policies where the insured or broker has already confirmed intent to renew.",
      why: "Renewal is a new term on the same policy — underwriting is re-run, but the trigger is always an external confirmation, not ops.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Renewal confirmations received, not yet decided." },
      { label: "In notice window", value: pend.filter(function (t) { return PAS.renewalCompliance(t.p).status !== "Compliant"; }).length, tone: "red", tip: "Expiring within " + PAS.RENEWAL_LEAD_DAYS + " days." },
      { label: "Premium at renewal", value: PAS.moneyShort(pend.reduce(function (s, t) { return s + t.p.premium; }, 0)), tip: "Premium exposed to these decisions." },
      { label: "No confirmation yet", value: noRequest.length, tip: "Approaching expiry but the insured hasn't confirmed renewal.", why: "These need a renewal notice chased, not a desk action." },
    ]));

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "renewal confirmation",
      extraFields: function () { return null; },
      onSubmit: function (payload) {
        PAS.raiseRequest(payload.policyId, "Renewal", { initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note });
        render();
      },
    }));

    page.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Confirmed renewal intent, ready for re-underwriting and pricing.", className: "label-11 block mb-9" }));
    page.appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Requested by", { label: "Expires", what: "End of the current term." }, { label: "Days left", what: "Time before expiry." }, { label: "Premium", what: "Expiring term premium." }, ""],
      rows: pend.map(function (t) {
        return [ui.cellId(t.p.id), ui.cellName(t.p.holder), ui.initiatorPill(t.h.meta), t.p.expirationDate,
          PAS.daysBetween(PAS.todayISO(), t.p.expirationDate) + "d", PAS.moneyShort(t.p.premium), ui.cellOpen("Review")];
      }),
      emptyText: "No renewal confirmations awaiting decision.",
      onRowClick: function (i) { location.href = "renewal-decision.html?policy=" + encodeURIComponent(pend[i].p.id) + "&txn=" + encodeURIComponent(pend[i].h.id); },
    }));

    if (noRequest.length > 0) {
      var extra = ui.h("div", { class: "mt-18" });
      extra.appendChild(ui.tipLabel({ text: "Approaching expiry, no confirmation yet", what: "Reference only — nothing to decide until the insured responds to the renewal notice.", className: "label-11 block mb-9" }));
      extra.appendChild(ui.dataTable({
        columns: ["Policy", "Insured", "Expires", "Days left", { label: "Notice status", what: "Whether the renewal notice window has been met.", rule: "Notices must go out at least " + PAS.RENEWAL_LEAD_DAYS + " days before expiry." }],
        rows: noRequest.map(function (x) {
          var r = PAS.renewalCompliance(x);
          return [ui.cellId(x.id), ui.cellName(x.holder), x.expirationDate, r.daysToExpiry + "d", ui.pill(r.status === "Compliant" ? "green" : r.status === "Urgent" ? "amber" : "red", r.status)];
        }),
      }));
      page.appendChild(extra);
    }

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("renewal-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
