/* Transfer decision — approve moves the holder, decline leaves the policy exactly as it was. */
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
      || p.history.find(function (x) { return x.type === "Transfer" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var meta = h.meta || {};
    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Transfer desk", function () { location.href = "transfer.html"; }));
    page.appendChild(ui.recordHead(p, ui.txnStatusBadge(h.status)));

    var left = [];
    left.push(ui.requestOrigin(meta));
    left.push(ui.tipLabel({ text: "Transfer requested", what: "Who the policy currently belongs to, and who it's moving to.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Current insured", v: p.holder, what: "Named insured on the policy today." }));
    left.push(ui.kv({ k: "New insured", v: meta.newHolder || "—", what: "Who the policy will belong to if approved." }));
    left.push(ui.kv({ k: "Reason", v: meta.reason || "—", what: "Why the transfer is being requested." }));

    var right = [];
    right.push(ui.tipLabel({ text: "What approval will do", what: "The exact side effects of pressing the button.", why: "Nothing hidden — a transfer is a compound operation, same as issue.", className: "label-11 block mb-10" }));
    [["Named insured → " + (meta.newHolder || "new holder"), "send"], ["Policy ID, term dates and ledger history unchanged", "shield-check"], ["Policy schedule regenerated under the new name", "file-check-2"], ["policyTransferred published to Billing, Documents, CRM, Reinsurance", "zap"]].forEach(function (pair) {
      var row = ui.h("div", { class: "effect-row" });
      row.appendChild(PAS.icon(pair[1], { size: 13 }));
      row.appendChild(ui.h("span", {}, pair[0]));
      right.push(row);
    });
    var noteWrap = ui.h("div", { class: "mt-13" });
    noteWrap.appendChild(ui.callout("info", "Continuity is preserved deliberately: cancelling this policy and writing a new one for \"" + (meta.newHolder || "the new insured") + "\" would break the append-only history a regulator can ask to see. A transfer keeps the same policy ID and the same ledger — this decision is simply appended to it."));
    right.push(noteWrap);

    function decide(approve) {
      return PAS.api.call("POST", "/api/v1/policies/" + p.id + "/transfers", { decision: approve ? "approved" : "rejected", newHolder: meta.newHolder },
        { module: "Transfer", policyId: p.id, statusCode: 200, label: (approve ? "Approve" : "Decline") + " transfer — " + p.holder, response: approve ? { txnId: h.id, status: "completed", previousHolder: p.holder, newHolder: meta.newHolder, events: ["policyTransferred"] } : { txnId: h.id, status: "rejected" } })
        .then(function () { PAS.decideTransfer(p.id, h.id, approve, meta.newHolder); location.href = "transfer.html"; });
    }

    page.appendChild(ui.decisionLayout(left, right, [
      { label: "Approve transfer", tone: "primary", icon: "send", onRun: function () { return decide(true); }, disabled: !meta.newHolder, disabledReason: "No new named insured was given with this request." },
      { label: "Decline", tone: "red", icon: "ban", onRun: function () { return decide(false); } },
    ]));

    root.appendChild(ui.screen("transfer-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
