/* Ported from EndorsementDecision in the original App.jsx. */
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
      || p.history.find(function (x) { return x.type === "Endorsement" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var page = ui.h("div", {});
    page.appendChild(ui.queueNav({ deskLabel: "Endorsement desk", deskHome: "endorsement.html", policyId: p.id, txnId: h.id }));
    page.appendChild(ui.recordHead(p, ui.txnStatusBadge(h.status)));

    var left = [];
    left.push(ui.requestOrigin(h.meta));
    left.push(ui.tipLabel({ text: "Requested change", what: "What was asked for, mid-term.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Change type", v: h.meta.changeType, what: "What is being altered." }));
    left.push(ui.kv({ k: "Materiality", v: h.meta.materiality, what: "Material changes alter the risk and need sign-off.", rule: "Material endorsements are never auto-applied." }));
    left.push(ui.kv({ k: "Requested", v: h.date, what: "Business date the change was requested." }));
    left.push(ui.kv({ k: "Transaction", v: "#" + h.seq, mono: true, what: "Position in the policy ledger." }));
    left.push(ui.h("div", { class: "mt-13" }, ui.callout("warn", h.detail)));

    var right = [];
    right.push(ui.tipLabel({ text: "Financial impact", what: "What approving this does to premium and billing.", className: "label-11 block mb-10" }));
    right.push(ui.kv({ k: "Current premium", v: PAS.money(p.premium), what: "Premium before the change." }));
    var impact = h.meta.premiumImpact || 0;
    var impactSpan = ui.h("span", { style: { color: impact >= 0 ? "var(--green)" : "var(--red)" } }, (impact >= 0 ? "+" : "") + PAS.money(impact));
    right.push(ui.kv({ k: "Premium delta", v: impactSpan, what: "Prorated for the remainder of the term.", why: "Published to Billing as an adjustment once approved." }));
    right.push(ui.kv({ k: "Premium after", v: PAS.money(p.premium + impact), what: "Revised annual premium." }));
    var effWrap = ui.h("div", { class: "mt-15" });
    effWrap.appendChild(ui.tipLabel({ text: "What approval will do", what: "Side effects of committing this change.", className: "label-11 block mb-10" }));
    [["Transaction status → Completed", "check-circle-2"], ["Policy version incremented", "git-branch"], ["Premium delta published to Billing", "trending-up"], ["Endorsement wording regenerated", "file-check-2"], ["policyEndorsed event published", "zap"]].forEach(function (pair) {
      var row = ui.h("div", { class: "effect-row" });
      row.appendChild(PAS.icon(pair[1], { size: 13 }));
      row.appendChild(ui.h("span", {}, pair[0]));
      effWrap.appendChild(row);
    });
    right.push(effWrap);
    right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, h.id)));

    function flash(action) {
      return { title: action + " recorded", detail: p.id + " · " + h.id, tone: action === "Decline" ? "red" : action === "Approve" ? "green" : "blue" };
    }
    function act(ok, comment) {
      var audit = PAS.makeAudit(ok ? "Approve" : "Decline", comment);
      return PAS.api.call("POST", "/api/v1/transactions/" + h.id + "/" + (ok ? "approve" : "reject"), { decision: ok ? "approved" : "rejected", note: comment },
        { module: "Endorsement", policyId: p.id, statusCode: 200, label: (ok ? "Approve" : "Decline") + " endorsement — " + p.holder, response: { txnId: h.id, status: ok ? "completed" : "rejected", premiumDelta: { amount: h.meta.premiumImpact || 0, currency: "INR" }, policyVersion: p.history.length + 1 } })
        .then(function () {
          PAS.decideTxn(p.id, h.id, ok, audit);
          ui.flashThenGo(PAS.afterDecisionHref("endorsement.html"), flash(ok ? "Approve" : "Decline"));
        });
    }
    function hold(action) {
      return function (comment) {
        PAS.recordHeldDecision(p.id, h.id, action, comment, "Endorsement");
        if (PAS.fromApprovalsQueue()) ui.flashThenGo("approvals.html", flash(action));
        else { ui.renderToast(flash(action)); render(); }
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, h.id, "Approve", { label: "Approve & apply", tone: "green", icon: "check-circle-2", onRun: function (c) { return act(true, c); } }),
      ui.confirmable(p.id, h.id, "Decline", { label: "Decline", tone: "red", icon: "ban", onRun: function (c) { return act(false, c); } }),
      ui.confirmable(p.id, h.id, "Escalate", { label: "Escalate", icon: "arrow-up-right", onRun: hold("Escalate") }),
      ui.confirmable(p.id, h.id, "Request More Information", { label: "Request more information", icon: "corner-up-left", onRun: hold("Request More Information") }),
    ]));

    root.appendChild(ui.screen("endorsement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
