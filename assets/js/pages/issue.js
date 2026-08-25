/* Ported from IssueList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var q = policies.filter(function (p) { return p.status === "Bound"; });
    var page = ui.deskList({
      icon: "stamp", tone: "amber", title: "Issue Desk", sub: "Bound policies awaiting formal issue and documentation",
      what: "Policies already bound under a binder, waiting to be formally issued.",
      why: "Bind and issue are legally distinct — cover is live, but until issue there is no contract and no document pack.",
      kpis: [
        { label: "Awaiting issue", value: q.length, tone: "amber", tip: "Bound with no formal contract yet." },
        { label: "Blocked", value: q.filter(function (x) { return ((x.binder && x.binder.subjectivities) || []).some(function (s) { return !s.met; }); }).length, tone: "red", tip: "An outstanding subjectivity prevents issue.", why: "Live cover with unmet conditions is the riskiest state in the book." },
        { label: "Premium bound", value: PAS.moneyShort(q.reduce(function (s, x) { return s + x.premium; }, 0)), tip: "Premium on risk under binders." },
        { label: "Ready now", value: q.filter(function (x) { return !((x.binder && x.binder.subjectivities) || []).some(function (s) { return !s.met; }); }).length, tone: "green", tip: "All gates satisfied." },
      ],
      columns: ["Policy", "Insured",
        { label: "Binder", what: "Provisional cover note number.", why: "Legal evidence of cover until issue." },
        { label: "Expires", what: "When provisional cover lapses.", rule: "Issuing after binder expiry is not permitted — the risk must be re-bound." },
        { label: "Premium", what: "Annual premium as bound." },
        { label: "Gates", what: "How many of the five issue preconditions pass." }],
      rows: q.map(function (x) {
        var u = ((x.binder && x.binder.subjectivities) || []).filter(function (s) { return !s.met; }).length;
        return [ui.cellId(x.id), ui.cellName(x.holder), ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px" } }, x.binder.number), x.binder.expiryDate, PAS.moneyShort(x.premium),
          u === 0 ? ui.pill("green", "Ready", "check-circle-2") : ui.pill("red", u + " blocking", "alert-triangle")];
      }),
      empty: "Nothing awaiting issue.",
      onOpen: function (i) { location.href = "issue-decision.html?policy=" + encodeURIComponent(q[i].id); },
    });
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("issue-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
