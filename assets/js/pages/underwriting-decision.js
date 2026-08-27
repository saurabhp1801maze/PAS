/* Ported from UnderwritingDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }

    var factors = PAS.riskFactors(p);
    var score = factors.score;
    var dec = PAS.underwritingDecision(p, score);

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Underwriting desk", function () { location.href = "underwriting.html"; }));
    page.appendChild(ui.recordHead(p, ui.pill(score < PAS.LOW_SCORE_REFER ? "red" : "green", "Score " + score)));

    var left = [];
    left.push(ui.tipLabel({ text: "Submission", what: "What was received from the producer.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Sum insured", v: p.sumInsured, what: "Total limit of indemnity requested." }));
    left.push(ui.kv({ k: "Annual premium", v: PAS.money(p.premium), what: "Indicative premium from rating.", why: "Final premium is confirmed at bind." }));
    left.push(ui.kv({ k: "Requested effective", v: PAS.fmtDate(p.effectiveDate), what: "Date cover is asked to begin." }));
    left.push(ui.kv({ k: "Producer", v: p.producer, what: "Broker or channel that placed the risk." }));
    left.push(ui.kv({ k: "Received", v: PAS.fmtDate(p.submittedOn), what: "Date the submission landed." }));
    left.push(ui.kv({ k: "Waiting", v: PAS.daysBetween(p.submittedOn, PAS.todayISO()) + " days", what: "Age in the queue.", why: "SLA is measured on age, not volume." }));
    var histWrap = ui.h("div", { class: "mt-14" });
    histWrap.appendChild(ui.tipLabel({ text: "Submission history", what: "Everything recorded against this submission so far.", className: "label-11 block mb-9" }));
    p.history.forEach(function (h) {
      var row = ui.h("div", { class: "history-row" });
      row.appendChild(ui.modulePill(h.type));
      row.appendChild(ui.h("span", { class: "history-detail" }, h.detail));
      row.appendChild(ui.h("span", { class: "history-date" }, h.date));
      histWrap.appendChild(row);
    });
    left.push(histWrap);

    var right = [];
    right.push(ui.scoreDial(score));
    right.push(ui.kv({ k: "Authority tier", v: dec.tier, what: "Who may bind this risk.", rule: "Premium above " + PAS.money(PAS.AUTHORITY_LIMIT) + " always refers to a senior underwriter." }));

    var held = p.history.find(function (x) { return x.type === "Underwriting" && x.status === "Pending"; });
    var txnNo = held ? held.id : "—";

    var trailWrap = ui.decisionTrailSide(PAS.decisionTrailFor(p, held && held.id));
    right.push(trailWrap);

    function flash(action) {
      return { title: action + " recorded", detail: p.id + " · " + txnNo, tone: action === "Decline" ? "red" : action === "Approve" ? "green" : "blue" };
    }
    function act(outcome, comment) {
      var audit = PAS.makeAudit(outcome, comment);
      return PAS.api.call("POST", "/api/v1/submissions/" + p.id + "/underwriting-decision",
        { score: score, decision: outcome.toLowerCase(), tier: dec.tier, note: comment },
        { module: "Underwriting", policyId: p.id, statusCode: 200, label: outcome + " — " + p.holder, response: { decisionId: PAS.uid("UWD"), outcome: outcome.toLowerCase(), authorityTier: dec.tier, nextState: outcome === "Approve" ? "bound" : outcome === "Decline" ? "declined" : "referred" } })
        .then(function () {
          PAS.decide(p.id, outcome, { score: score, tier: dec.tier, note: comment, audit: audit });
          ui.flashThenGo("underwriting.html", flash(outcome));
        });
    }
    function hold(action) {
      return function (result) {
        var comment = result && typeof result === "object" ? result.comment : result;
        var category = (result && typeof result === "object" && result.category) || "";
        PAS.recordHeldDecision(p.id, held && held.id, action, comment, "Underwriting", "", category);
        ui.renderToast(flash(action));
        render();
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, txnNo, "Approve", { label: "Approve & bind", tone: "green", icon: "shield-check", onRun: function (c) { return act("Approve", c); } }),
      ui.confirmable(p.id, txnNo, "Decline", { label: "Decline", tone: "red", icon: "ban", onRun: function (c) { return act("Decline", c); } }),
      ui.confirmable(p.id, txnNo, "Escalate", { label: "Escalate", icon: "arrow-up-right", showCategory: true, onRun: hold("Escalate") }),
      ui.confirmable(p.id, txnNo, "Request More Information", { label: "Request more information", icon: "corner-up-left", showCategory: true, onRun: hold("Request More Information") }),
    ]));

    root.appendChild(ui.screen("uw-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
