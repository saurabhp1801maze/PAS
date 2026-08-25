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
    left.push(ui.kv({ k: "Requested effective", v: p.effectiveDate, what: "Date cover is asked to begin." }));
    left.push(ui.kv({ k: "Producer", v: p.producer, what: "Broker or channel that placed the risk." }));
    left.push(ui.kv({ k: "Received", v: p.submittedOn, what: "Date the submission landed." }));
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
    var recNode = ui.h("div", {});
    recNode.appendChild(ui.h("b", {}, "System recommendation: " + dec.outcome));
    recNode.appendChild(ui.h("br"));
    recNode.appendChild(document.createTextNode(dec.reason));
    right.push(ui.callout(dec.outcome === "Approve" ? "good" : "warn", recNode));
    right.push(ui.kv({ k: "Authority tier", v: dec.tier, what: "Who may bind this risk.", rule: "Premium above " + PAS.money(PAS.AUTHORITY_LIMIT) + " always refers to a senior underwriter." }));
    /* All four gates, always all four, each with its own verdict. They are independent: the
       score measures risk quality, the authority limit gates exposure size, the information
       gate holds a file that is not yet complete enough to price, and the effective date gate
       enforces the one place a human-supplied date enters this system — a request outside the
       system's allowed lead time refers out rather than being silently accepted. */
    var gateWrap = ui.h("div", { class: "mt-13" });
    gateWrap.appendChild(ui.tipLabel({ text: "Referral gates", what: "Every automatic check run against this submission.", why: "Each fails on its own — a clean risk can still refer on size, and a large premium no longer drags the score down with it.", className: "label-11 block mb-9" }));
    dec.gates.forEach(function (g) {
      gateWrap.appendChild(ui.kv({
        k: g.label,
        v: ui.pill(g.passed ? "green" : g.key === "score" ? "red" : g.key === "authority" ? "amber" : "blue", g.passed ? "Passed" : "Referred"),
        what: g.threshold,
        why: g.passed ? undefined : g.failReason,
      }));
    });
    right.push(gateWrap);

    /* The score is now shown as arithmetic rather than asserted. Every line here is a field
       the desk was already displaying; before this they drove nothing. */
    var derivWrap = ui.h("div", { class: "mt-13" });
    derivWrap.appendChild(ui.tipLabel({ text: "How the score was built", what: "The full derivation, line by line.", why: "An underwriter overriding a score should be able to see what it was made of.", className: "label-11 block mb-9" }));
    derivWrap.appendChild(ui.kv({ k: factors.product + " base", v: String(factors.base), what: "Starting point for the product line." }));
    factors.lines.forEach(function (l) {
      var v = ui.h("span", { style: { color: l.value >= 0 ? "var(--green)" : "var(--red)", fontWeight: "600" } }, (l.value > 0 ? "+" : "") + l.value);
      derivWrap.appendChild(ui.kv({ k: l.label, v: v, what: l.note }));
    });
    if (factors.lines.length === 0) derivWrap.appendChild(ui.h("div", { class: "faint-note" }, "No adjustments — the file carries no loss history, no prior cancellations and nothing outstanding."));
    var totalRow = ui.h("div", { class: "refund-total" });
    totalRow.appendChild(ui.h("span", { class: "refund-total-label" }, "Composite score"));
    totalRow.appendChild(ui.h("span", { class: "refund-total-value" }, String(score)));
    derivWrap.appendChild(totalRow);
    right.push(derivWrap);

    var noteArea = ui.h("textarea", { class: "field-input", placeholder: "Rationale for the decision…" });
    var noteWrap = ui.h("div", { class: "mt-14" });
    noteWrap.appendChild(ui.field({ label: "Decision note", hint: "Recorded permanently. Required to decline." }, noteArea));
    right.push(noteWrap);

    function act(outcome) {
      var note = noteArea.value;
      return PAS.api.call("POST", "/api/v1/submissions/" + p.id + "/underwriting-decision",
        { score: score, decision: outcome.toLowerCase(), tier: dec.tier, note: note || undefined },
        { module: "Underwriting", policyId: p.id, statusCode: 200, label: outcome + " — " + p.holder, response: { decisionId: PAS.uid("UWD"), outcome: outcome.toLowerCase(), authorityTier: dec.tier, nextState: outcome === "Approve" ? "bound" : outcome === "Decline" ? "declined" : "referred" } })
        .then(function () { PAS.decide(p.id, outcome, { score: score, tier: dec.tier, note: note }); location.href = "underwriting.html"; });
    }
    function actionsFor(noteVal) {
      return [
        { label: "Approve & bind", tone: "green", icon: "shield-check", onRun: function () { return act("Approve"); } },
        { label: "Decline", tone: "red", icon: "ban", onRun: function () { return act("Decline"); }, disabled: !noteVal.trim(), disabledReason: "A decline must carry a written reason — it is disclosable to the applicant." },
        { label: "Request more info", icon: "corner-up-left", onRun: function () { return act("Refer back"); } },
      ];
    }

    var layoutEl = ui.decisionLayout(left, right, actionsFor(""));
    noteArea.addEventListener("input", function () { layoutEl.actionBar.updateActions(actionsFor(noteArea.value)); });
    page.appendChild(layoutEl);

    root.appendChild(ui.screen("uw-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
