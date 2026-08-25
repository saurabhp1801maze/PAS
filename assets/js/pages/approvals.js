/* Ported from ApprovalsPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pending = PAS.allTxns(policies).filter(function (t) { return t.h.status === "Pending"; });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "inbox", tone: "amber", title: "Pending Approvals", sub: "Every request received, not yet decided — across every desk",
      what: "A cross-type index of every held transaction, wherever it came from.",
      why: "Held means untouched — the policy stays exactly as it was until an underwriter reviews the request's full context and decides.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pending.length, tone: "amber", tip: "Held transactions of all types." },
      { label: "Endorsements", value: pending.filter(function (t) { return t.h.type === "Endorsement"; }).length, tip: "Material changes needing sign-off." },
      { label: "Cancellations", value: pending.filter(function (t) { return t.h.type === "Cancellation"; }).length, tip: "Insured, broker or underwriter initiated." },
      { label: "Renewal / reinstatement", value: pending.filter(function (t) { return t.h.type === "Renewal" || t.h.type === "Reinstatement"; }).length, tip: "Confirmed by the insured or broker, awaiting underwriter pricing." },
    ]));

    page.appendChild(ui.dataTable({
      columns: [{ label: "Seq", what: "Position in the policy ledger." }, "Policy", "Insured", { label: "Type", what: "Which kind of transaction is held." }, "Requested by", { label: "Why it is held", what: "What was submitted, and by whom.", rule: "Material endorsements, fraud cancellations and authority referrals always hold." }, { label: "Effective", what: "Business date it would take effect." }, ""],
      rows: pending.map(function (t) {
        var seqSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--text-faint)" } }, "#" + t.h.seq);
        var idSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--text-soft)" } }, t.p.id);
        var detailSpan = ui.h("span", { style: { fontSize: "12px", color: "var(--text-soft)", whiteSpace: "normal", display: "inline-block", maxWidth: "300px" } }, t.h.detail);
        var reviewBtn = ui.h("button", { class: "btn small tone-primary" }, "Review →");
        reviewBtn.addEventListener("click", function () {
          var desk = PAS.TYPE_TO_DESK[t.h.type];
          location.href = PAS.DETAIL_URL_OF[desk] + "?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id);
        });
        return [seqSpan, idSpan, t.p.holder, ui.modulePill(t.h.type), ui.initiatorPill(t.h.meta), detailSpan, t.h.date, reviewBtn];
      }),
      emptyText: "Nothing awaiting approval.",
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("approvals", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
