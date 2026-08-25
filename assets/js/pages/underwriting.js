/* Ported from UnderwritingList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var q = policies.filter(function (p) { return p.status === "Referred"; });
    var page = ui.deskList({
      icon: "clipboard-check", tone: "violet", title: "Underwriting Desk", sub: "Submissions referred out of automatic authority",
      what: "Submissions already received and scored, waiting for an underwriter to accept, decline or price them.",
      why: "The data arrives on its own — the value you add is the decision.",
      kpis: [
        { label: "In queue", value: q.length, tone: "violet", tip: "Submissions awaiting a decision." },
        { label: "Pipeline premium", value: PAS.moneyShort(q.reduce(function (s, x) { return s + x.premium; }, 0)), tip: "Premium riding on these decisions." },
        { label: "Authority limit", value: PAS.moneyShort(PAS.AUTHORITY_LIMIT), tip: "Premium above this cannot be bound under delegated authority.", why: "One of four independent referral triggers — it gates exposure size, nothing else." },
        { label: "Refer threshold", value: PAS.LOW_SCORE_REFER, tip: "Scores below this auto-refer regardless of premium.", why: "The score measures risk quality only, so this trigger is independent of the authority limit." },
      ],
      columns: ["Submission", "Insured", "Product",
        { label: "Premium", what: "Indicative annual premium from rating.", why: "Compared against delegated authority." },
        { label: "Score", what: "Composite 0–100 risk score, built from claims and change history.", rule: "Below " + PAS.LOW_SCORE_REFER + " refers automatically." },
        { label: "Referred on", what: "Which gate or gates sent this to a senior underwriter.", why: "Score, authority and information are independent — a clean risk can still refer on size alone." },
        { label: "Waiting", what: "Days since it landed in this queue.", why: "SLA is measured on age." }],
      rows: q.map(function (x) {
        var score = PAS.riskScore(x);
        var dec = PAS.underwritingDecision(x, score);
        var gateCell = ui.h("span", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } });
        dec.failed.forEach(function (g) { gateCell.appendChild(ui.pill(g.key === "score" ? "red" : g.key === "authority" ? "amber" : "blue", g.label.replace(" gate", ""))); });
        if (dec.failed.length === 0) gateCell.appendChild(ui.pill("green", "Clear"));
        return [ui.cellId(x.id), ui.cellName(x.holder), x.product, PAS.moneyShort(x.premium),
          ui.pill(score < PAS.LOW_SCORE_REFER ? "red" : "green", String(score)),
          gateCell,
          PAS.daysBetween(x.submittedOn, PAS.todayISO()) + "d"];
      }),
      empty: "Underwriting queue is clear.",
      onOpen: function (i) { location.href = "underwriting-decision.html?policy=" + encodeURIComponent(q[i].id); },
    });
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("uw-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
