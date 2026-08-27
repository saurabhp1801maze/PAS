/* Ported from ReinstatementDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === sp.get("txn"); })
      || p.history.find(function (x) { return x.type === "Reinstatement" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var e = PAS.reinstatementEligibility(p);

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Reinstatement desk", function () { location.href = "reinstatement.html"; }));
    page.appendChild(ui.recordHead(p, ui.pill(e.eligible ? "green" : "red", e.eligible ? "Eligible" : (e.fraud ? "Fraud — barred" : "Window closed"))));

    var left = [];
    left.push(ui.requestOrigin(h.meta));
    left.push(ui.tipLabel({ text: "Cancellation on record", what: "What put this policy out of force.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Cancelled on", v: e.cancelEv.date, what: "Effective date of cancellation." }));
    left.push(ui.kv({ k: "Reason", v: (e.cancelEv.meta && e.cancelEv.meta.reason) || "—", what: "Why it was cancelled.", rule: "Fraud permanently bars reinstatement." }));
    left.push(ui.kv({ k: "Type applied", v: (e.cancelEv.meta && e.cancelEv.meta.cancelType) || "—", what: "Which refund basis was used." }));
    left.push(ui.kv({ k: "Initiated by", v: (e.cancelEv.meta && e.cancelEv.meta.initiatedBy) || "—", what: "Who raised the original cancellation." }));
    left.push(ui.kv({ k: "Timing", v: PAS.cancelTiming(e.cancelEv.date), what: "Whether the original cancellation was immediate or scheduled ahead." }));
    left.push(ui.kv({ k: "Refund issued", v: PAS.money((e.cancelEv.meta && e.cancelEv.meta.refund) || 0), what: "Unearned premium already returned.", why: "Typically recollected on reinstatement." }));
    var calloutWrap = ui.h("div", { class: "mt-13" });
    calloutWrap.appendChild(ui.callout(e.eligible ? "good" : "bad", "Cancelled " + e.daysSince + " days ago. " + (e.fraud ? "Fraud cancellation — reinstatement permanently barred." : e.eligible ? ("Inside the " + PAS.REINSTATEMENT_WINDOW_DAYS + "-day window.") : ("Outside the " + PAS.REINSTATEMENT_WINDOW_DAYS + "-day window — needs new-business underwriting."))));
    left.push(calloutWrap);

    var right = [];
    right.push(ui.tipLabel({ text: "Reinstatement terms", what: "What restoring cover involves.", className: "label-11 block mb-10" }));
    right.push(ui.kv({ k: "Coverage gap", v: e.daysSince + " days", what: "Period with no cover in force.", rule: "The gap must be disclosed to the policyholder in writing." }));
    right.push(ui.kv({ k: "Window remaining", v: Math.max(0, PAS.REINSTATEMENT_WINDOW_DAYS - e.daysSince) + " days", what: "Time left to reinstate." }));
    right.push(ui.kv({ k: "Gap disclosure", v: "Required", what: "Written notice explaining the uninsured period." }));

    var outstandingInput = ui.h("input", { class: "field-input", type: "number", value: String((h.meta && h.meta.outstandingClaimed) || 0) });
    var outWrap = ui.h("div", { class: "mt-13" });
    outWrap.appendChild(ui.field({ label: "Outstanding premium to collect", hint: "The requester's claimed figure — confirm against Billing before approving." }, outstandingInput));
    right.push(outWrap);

    right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, h.id)));

    function flash(action) {
      return { title: action + " recorded", detail: p.id + " · " + h.id, tone: action === "Decline" ? "red" : action === "Approve" ? "green" : "blue" };
    }
    function decide(approve, comment) {
      var outstanding = Number(outstandingInput.value) || 0;
      var audit = PAS.makeAudit(approve ? "Approve" : "Decline", comment);
      return PAS.api.call("POST", "/api/v1/transactions/" + h.id + "/" + (approve ? "approve" : "reject"),
        { decision: approve ? "approved" : "rejected", outstandingPremium: { amount: outstanding, currency: "USD" }, note: comment },
        { module: "Reinstatement", policyId: p.id, statusCode: 200, label: (approve ? "Approve" : "Decline") + " reinstatement — " + p.holder, response: approve ? { txnId: h.id, status: "active", gapDays: e.daysSince, disclosureRequired: true, events: ["policyReinstated"] } : { txnId: h.id, status: "rejected" } })
        .then(function () {
          PAS.decideReinstatement(p.id, h.id, approve, { gapDays: e.daysSince, outstanding: outstanding }, audit);
          ui.flashThenGo("reinstatement.html", flash(approve ? "Approve" : "Decline"));
        });
    }
    function hold(action) {
      return function (result) {
        var comment = result && typeof result === "object" ? result.comment : result;
        var category = (result && typeof result === "object" && result.category) || "";
        PAS.recordHeldDecision(p.id, h.id, action, comment, "Reinstatement", "", category);
        ui.renderToast(flash(action));
        render();
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, h.id, "Approve", { label: "Approve reinstatement", tone: "green", icon: "rotate-ccw", onRun: function (c) { return decide(true, c); }, disabled: !e.eligible, disabledReason: e.fraud ? "Policies cancelled for fraud are never eligible." : ("Cancelled " + e.daysSince + " days ago — beyond the " + PAS.REINSTATEMENT_WINDOW_DAYS + "-day window.") }),
      ui.confirmable(p.id, h.id, "Decline", { label: "Decline request", icon: "ban", onRun: function (c) { return decide(false, c); } }),
      ui.confirmable(p.id, h.id, "Escalate", { label: "Escalate", icon: "arrow-up-right", showCategory: true, onRun: hold("Escalate") }),
      ui.confirmable(p.id, h.id, "Request More Information", { label: "Request more information", icon: "corner-up-left", showCategory: true, onRun: hold("Request More Information") }),
    ]));

    root.appendChild(ui.screen("reinstatement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
