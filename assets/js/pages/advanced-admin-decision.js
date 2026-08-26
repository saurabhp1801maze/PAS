(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === sp.get("txn"); });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var spec = PAS.ADVANCED_TXN_TYPES[h.type] || {};
    var req = PAS.getApprovalRequirement(h);
    var auth = PAS.canPasAdminAct(h.type.toLowerCase(), Math.abs((h.meta && h.meta.premiumDelta) || 0));
    var sod = PAS.checkSegregationOfDuties(h);

    var page = ui.h("div", {});
    page.appendChild(ui.queueNav({ deskLabel: "Advanced PAS", deskHome: "advanced-admin.html", policyId: p.id, txnId: h.id }));
    page.appendChild(ui.recordHead(p, ui.txnStatusBadge(h.status)));

    var left = [];
    left.push(ui.kv({ k: "Transaction", v: h.type }));
    left.push(ui.kv({ k: "Description", v: spec.desc || "—" }));
    left.push(ui.kv({ k: "Effective date", v: h.date }));
    left.push(ui.kv({ k: "Recorded", v: (h.recordedAt || "").slice(0, 19), what: "Bitemporal — system date entered." }));
    if (req) left.push(ui.kv({ k: "Approval level", v: req.level + " (" + (req.current + 1) + "/" + req.steps + ")" }));
    if (!auth.allowed) left.push(ui.callout("warn", auth.reason));
    if (!sod) left.push(ui.callout("warn", "Segregation of duties: initiator cannot approve their own request."));

    var right = [];
    right.push(ui.tipLabel({ text: "PAS admin decision", className: "label-11 block mb-10" }));
    right.push(ui.h("div", { class: "faint-note" }, h.detail));

    function decide(approve) {
      if (!auth.allowed && approve) return Promise.resolve();
      if (!sod && approve) return Promise.resolve();
      var ep = "/api/v1/policies/" + p.id + "/" + h.type.toLowerCase() + "s";
      return PAS.api.call("POST", ep, { decision: approve ? "approved" : "rejected" },
        { module: h.type, policyId: p.id, statusCode: 200, label: (approve ? "Approve" : "Decline") + " " + h.type + " — " + p.holder })
        .then(function () {
          if (req && approve && (req.current + 1) < req.steps) PAS.approveTxnStep(p.id, h.id);
          else PAS.decideAdvancedTxn(p.id, h.id, approve);
          location.href = PAS.afterDecisionHref("advanced-admin.html");
        });
    }

    page.appendChild(ui.decisionLayout(left, right, [
      { label: "Approve", tone: "primary", icon: "check-circle-2", onRun: function () { return decide(true); }, disabled: !auth.allowed || !sod },
      { label: "Decline", tone: "red", icon: "ban", onRun: function () { return decide(false); } },
    ]));
    root.appendChild(ui.screen("advanced-detail", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
