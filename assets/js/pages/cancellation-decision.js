/* Ported from CancellationDecision in the original App.jsx. The effective-date field is live
   (recomputing the derived cancellation type, refund and notice check on every change), so this
   page rebuilds just its decision-layout container rather than the whole page on each edit. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policyId = sp.get("policy");
    var txnId = sp.get("txn");
    var p = PAS.getPolicy(policyId);
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === txnId; })
      || p.history.find(function (x) { return x.type === "Cancellation" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }
    txnId = h.id;

    var reason = (h.meta && h.meta.reason) || "Insured Request";
    var initiatedBy = (h.meta && h.meta.initiatedBy) || "Insured";
    var effDate = h.date || PAS.todayISO();

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Cancellation desk", function () { location.href = "cancellation.html"; }));
    var headContainer = ui.h("div", {});
    var layoutContainer = ui.h("div", {});
    page.appendChild(headContainer);
    page.appendChild(layoutContainer);

    function refreshPolicy() {
      p = PAS.getPolicy(policyId) || p;
      h = p.history.find(function (x) { return x.id === txnId; }) || h;
    }

    function buildContent() {
      refreshPolicy();
      var q = PAS.cancelQuote(p, reason, initiatedBy, effDate);
      var decided = h.status === "Completed" || h.status === "Rejected";
      headContainer.innerHTML = "";
      headContainer.appendChild(ui.recordHead(p, ui.pill(q.spec.tone, q.type)));

      var left = [];
      left.push(ui.requestOrigin(h.meta));
      left.push(ui.tipLabel({ text: "What was requested", what: "Reason and Initiated By came in with the request — neither is chosen here.", why: "Type is derived from both of them plus the effective date, never hand-picked.", className: "label-11 block mb-10" }));
      left.push(ui.kv({ k: "Reason", v: reason, what: "What the requester gave.", rule: "Fraud never auto-completes and permanently blocks any later reinstatement." }));
      left.push(ui.kv({ k: "Initiated by", v: initiatedBy, what: "Who is actually asking for this.", rule: "An insurer-side initiator (Carrier, MGA, System) can never end up with a Short-Rate penalty." }));
      left.push(ui.kv({ k: "Timing", v: q.timing, what: "Immediate if the effective date is today or past, Future/Scheduled otherwise." }));

      var dateInput = ui.h("input", { class: "field-input", type: "date", value: effDate, disabled: decided });
      dateInput.addEventListener("change", function () { effDate = dateInput.value; buildContent(); });
      left.push(ui.field({ label: "Effective date", hint: "Pre-filled from the request; adjust only if the underwriter is confirming a different date." }, dateInput));

      var derivedWrap = ui.h("div", { class: "mt-6" });
      derivedWrap.appendChild(ui.tipLabel({ text: "Derived type", what: "Which of the three cancellation types this maps to — from Reason + Initiated By + whether it lands at inception.", className: "label-11 block mb-9" }));
      var derivedCard = ui.h("div", { class: "cancel-type-card", "data-tone": q.spec.tone, style: { background: "var(--tone-bg)", borderColor: "var(--tone-fg)" } });
      derivedCard.appendChild(ui.pill(q.spec.tone, q.type));
      derivedCard.appendChild(ui.h("div", { style: { fontSize: "12px", color: "var(--text)", marginTop: "8px", lineHeight: "1.5" } }, q.spec.when));
      derivedCard.appendChild(ui.h("div", { style: { fontSize: "11.5px", color: "var(--text-soft)", marginTop: "6px", lineHeight: "1.5" } }, q.spec.rate));
      derivedWrap.appendChild(derivedCard);
      left.push(derivedWrap);

      var noticeWrap = ui.h("div", { class: "mt-13" });
      noticeWrap.appendChild(ui.callout(q.noticeOk ? "good" : "bad", q.noticeOk ? ("Notice satisfied — " + q.noticeRequired + "d required, " + q.noticeProvided + "d given.") : (reason + " requires " + q.noticeRequired + "d notice, only " + q.noticeProvided + "d given. Decide with this in mind.")));
      if (reason === "Fraud") noticeWrap.appendChild(ui.callout("warn", "Fraud-flagged — decide carefully. Approving permanently blocks reinstatement."));
      left.push(noticeWrap);

      var right = [];
      right.push(ui.tipLabel({ text: "Refund calculation", what: "Computed from term dates and the derived type.", why: "Never hand-keyed — this is the number that goes to Billing.", className: "label-11 block mb-10" }));
      right.push(ui.kv({ k: "Policy term", v: q.totalDays + " days", what: "Full length of the term." }));
      right.push(ui.kv({ k: "Earned", v: q.earnedDays + " days", what: "Days the insurer was on risk." }));
      right.push(ui.kv({ k: "Unearned", v: q.remainingDays + " days", what: "Days being returned.", why: "Drives the refund." }));
      right.push(ui.kv({ k: "Basis", v: q.type === "Flat" ? "Full written premium" : "Unearned premium", what: q.type === "Flat" ? "Insurer never went on risk." : "Proportional to unused term." }));
      right.push(ui.kv({ k: "Gross refund", v: PAS.money(q.gross), what: "Before any penalty." }));
      if (q.penalty > 0) right.push(ui.kv({ k: "Short-rate penalty (" + (q.spec.penaltyPct * 100) + "%)", v: "− " + PAS.money(q.penalty), what: "Retained for acquisition and admin cost.", rule: "Only ever applied when Initiated By is Insured or Broker/Producer." }));
      var totalRow = ui.h("div", { class: "refund-total" });
      totalRow.appendChild(ui.h("span", { class: "refund-total-label" }, "Refund due"));
      totalRow.appendChild(ui.h("span", { class: "refund-total-value" }, PAS.money(q.refund)));
      right.push(totalRow);
      var noticePeriodWrap = ui.h("div", { class: "mt-14" });
      noticePeriodWrap.appendChild(ui.tipLabel({ text: "Notice period", what: "Statutory days that must run before the effective date.", className: "label-11 block mb-9" }));
      noticePeriodWrap.appendChild(ui.kv({ k: "Required", v: q.noticeRequired + " days", what: reason + " requires this much notice." }));
      noticePeriodWrap.appendChild(ui.kv({ k: "Provided", v: q.noticeProvided + " days", what: "Between today and the effective date." }));
      right.push(noticePeriodWrap);
      right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, txnId)));

      function flash(action) {
        return { title: action + " recorded", detail: p.id + " · " + txnId, tone: action === "Approve" ? "red" : action === "Decline" ? "amber" : "blue" };
      }
      function decide(approve, comment) {
        var audit = PAS.makeAudit(approve ? "Approve" : "Decline", comment);
        return PAS.api.call("POST", "/api/v1/transactions/" + txnId + "/" + (approve ? "approve" : "reject"),
          { decision: approve ? "approved" : "rejected", effectiveDate: effDate, premiumMethod: q.type, refund: { amount: Math.round(q.refund), currency: "INR" }, note: comment },
          { module: "Cancellation", policyId: p.id, statusCode: 200, label: (approve ? "Approve" : "Decline") + " cancellation — " + p.holder, response: approve ? { txnId: txnId, status: "completed", premiumMethod: q.type, refundAmount: Math.round(q.refund), events: ["policyCancelled"] } : { txnId: txnId, status: "rejected" } })
          .then(function () {
            PAS.decideCancellation(p.id, txnId, approve, effDate, q, audit);
            ui.renderToast(flash(approve ? "Approve" : "Decline"));
            buildContent();
          });
      }
      function hold(action) {
        return function (comment) {
          PAS.recordHeldDecision(p.id, txnId, action, comment, "Cancellation");
          ui.renderToast(flash(action));
          buildContent();
        };
      }

      var actions = decided
        ? [{ label: "Back to cancellation desk", icon: "arrow-left", onRun: function () { location.href = "cancellation.html"; } }]
        : [
          ui.confirmable(p.id, txnId, "Approve", { label: "Approve cancellation", tone: "red", icon: "x-circle", onRun: function (c) { return decide(true, c); } }),
          ui.confirmable(p.id, txnId, "Decline", { label: "Decline request", icon: "ban", onRun: function (c) { return decide(false, c); } }),
          ui.confirmable(p.id, txnId, "Escalate", { label: "Escalate", icon: "arrow-up-right", onRun: hold("Escalate") }),
          ui.confirmable(p.id, txnId, "Request More Information", { label: "Request more information", icon: "corner-up-left", onRun: hold("Request More Information") }),
        ];

      layoutContainer.innerHTML = "";
      layoutContainer.appendChild(ui.decisionLayout(left, right, actions));
    }
    buildContent();

    root.appendChild(ui.screen("cancellation-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
