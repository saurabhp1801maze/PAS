/* Ported from RenewalDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function getParams() {
    var sp = new URLSearchParams(location.search);
    return { policy: sp.get("policy"), txn: sp.get("txn") };
  }

  function render() {
    var params = getParams();
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = params.policy && PAS.getPolicy(params.policy);
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === params.txn; })
      || p.history.find(function (x) { return x.type === "Renewal" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var rc = PAS.renewalCompliance(p);
    var score = PAS.riskScore(p);
    var suggested = Math.round(p.premium * (score < 60 ? 1.12 : score > 85 ? 0.97 : 1.05));

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Renewal desk", function () { location.href = "renewal.html"; }));
    page.appendChild(ui.recordHead(p, ui.pill(rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red", rc.status)));

    var left = [];
    left.push(ui.requestOrigin(h.meta));
    left.push(ui.tipLabel({ text: "Expiring term", what: "The term now coming to an end.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Current term", v: PAS.fmtDate(p.effectiveDate) + " → " + PAS.fmtDate(p.expirationDate), what: "Term being renewed out of." }));
    left.push(ui.kv({ k: "Days to expiry", v: rc.daysToExpiry + " days", what: "Time remaining." }));
    left.push(ui.kv({ k: "Notice requirement", v: PAS.RENEWAL_LEAD_DAYS + " days", what: "Statutory lead time.", rule: "Serving later than this is a compliance exception, not a scheduling slip." }));
    left.push(ui.kv({ k: "Expiring premium", v: PAS.money(p.premium), what: "Premium on the ending term." }));
    left.push(ui.kv({ k: "Term number", v: p.termNumber, what: "How many times this policy has renewed." }));
    var histWrap = ui.h("div", { class: "mt-13" });
    histWrap.appendChild(ui.tipLabel({ text: "Claims & change history", what: "What the re-underwriting decision is based on.", className: "label-11 block mb-9" }));
    histWrap.appendChild(ui.kv({ k: "Endorsements", v: p.history.filter(function (x) { return x.type === "Endorsement"; }).length, what: "Mid-term changes this term.", why: "Frequent changes can signal an unstable risk." }));
    histWrap.appendChild(ui.kv({ k: "Prior cancellations", v: p.history.filter(function (x) { return x.type === "Cancellation"; }).length, what: "Cancellations on record." }));
    left.push(histWrap);

    var right = [];
    right.push(ui.scoreDial(score));
    right.push(ui.tipLabel({ text: "Renewal offer", what: "The new term you are about to create.", why: "A new PolicyTerm on the same policy — number and history carry forward.", className: "label-11 block mb-10" }));
    right.push(ui.kv({ k: "New term", v: PAS.fmtDate(p.expirationDate) + " → " + PAS.fmtDate(PAS.addYears(p.expirationDate, 1)), what: "Dates of the term being created.", why: "Advanced by calendar year, so a term starting in a leap year does not renew a day early." }));
    right.push(ui.kv({ k: "Becomes term", v: p.termNumber + 1, what: "Incremented on renewal." }));

    /* Not an editable field: the renewal premium is what the re-underwriting score produced, not
       a figure typed in on this screen — same reasoning as the reinstatement desk's outstanding-
       premium fix. Highlighted as a callout instead of an input, with an explicit before/after
       (expiring vs renewal) table underneath so the change is visible as a comparison, not just a
       single new number. */
    var premBlock = ui.h("div", { class: "mt-12" });
    premBlock.appendChild(ui.callout("warn", [
      ui.h("strong", {}, "Renewal premium: " + PAS.money(suggested) + ". "),
      document.createTextNode("System-suggested from the re-underwritten risk score — read-only here, not editable on this screen."),
    ]));
    var premDelta = suggested - p.premium;
    var premDeltaSpan = ui.h("span", { style: { color: premDelta >= 0 ? "var(--color-success)" : "var(--color-danger)", fontWeight: "700" } },
      (premDelta >= 0 ? "+" : "") + PAS.money(premDelta) + " (" + (premDelta >= 0 ? "+" : "") + ((suggested / p.premium - 1) * 100).toFixed(1) + "%)");
    premBlock.appendChild(ui.dataTable({
      columns: ["", "Expiring (past)", "Renewal (new)", "Change"],
      rows: [["Premium", PAS.money(p.premium), PAS.money(suggested), premDeltaSpan]],
    }));
    right.push(premBlock);

    right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, h.id)));

    function flash(action) {
      return { title: action + " recorded", detail: p.id + " · " + h.id, tone: action === "Decline" ? "red" : action === "Approve" ? "green" : "blue" };
    }
    function decide(approve, comment) {
      var prem = suggested;
      var audit = PAS.makeAudit(approve ? "Approve" : "Decline", comment);
      var response = approve
        ? { txnId: h.id, newTermNumber: p.termNumber + 1, effectiveDate: p.expirationDate, expirationDate: PAS.addYears(p.expirationDate, 1), events: ["policyRenewed"] }
        : { txnId: h.id, status: "nonRenewed", noticeServedOn: PAS.todayISO() };
      return PAS.api.call("POST", "/api/v1/transactions/" + h.id + "/" + (approve ? "approve" : "reject"),
        approve ? { decision: "approved", newPremium: { amount: prem, currency: "USD" }, termNumber: p.termNumber + 1, note: comment } : { decision: "rejected", reason: "underwritingDecision", note: comment },
        { module: "Renewal", policyId: p.id, statusCode: 200, label: (approve ? "Approve renewal" : "Decline renewal") + " — " + p.holder, response: response })
        .then(function () {
          PAS.decideRenewal(p.id, h.id, approve, prem, audit);
          ui.flashThenGo("renewal.html", flash(approve ? "Approve" : "Decline"));
        });
    }
    function hold(action) {
      return function (result) {
        var comment = result && typeof result === "object" ? result.comment : result;
        var category = (result && typeof result === "object" && result.category) || "";
        PAS.recordHeldDecision(p.id, h.id, action, comment, "Renewal", "", category);
        ui.renderToast(flash(action));
        render();
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, h.id, "Approve", { label: "Approve — renew into term " + (p.termNumber + 1), tone: "primary", icon: "refresh-cw", onRun: function (c) { return decide(true, c); } }),
      ui.confirmable(p.id, h.id, "Escalate/Request more info", { label: "Escalate/Request more info", icon: "arrow-up-right", showCategory: true, onRun: hold("Escalate/Request more info") }),
    ]));

    root.appendChild(ui.screen("renewal-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
