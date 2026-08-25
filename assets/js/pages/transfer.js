/* Policy transfer — a change of named insured with continuity preserved. Same request-then-decide
   shape as every other mid-term transaction: a request arrives, sits Pending, and only a decision
   applies it. See store.js's decideTransfer for what "continuity preserved" actually means. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pend = PAS.pendingOf(policies, "Transfer");
    var hist = policies.reduce(function (acc, x) {
      x.history.filter(function (h) { return h.type === "Transfer" && h.status !== "Pending"; }).forEach(function (h) { acc.push({ x: x, h: h }); });
      return acc;
    }, []);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "send", tone: "indigo", title: "Transfer Desk", sub: "A change of named insured, with the policy's continuity preserved",
      what: "The policy's ledger, term dates and history all stay exactly as they were — only the holder changes.",
      why: "Cancelling and rewriting as new business would break the continuity an append-only ledger exists to prove.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Transfer requests submitted, not yet decided." },
      { label: "Transferred to date", value: hist.filter(function (t) { return t.h.status === "Completed"; }).length, tip: "Completed transfers across the book." },
    ]));

    var reasonPanel = ui.panel({ title: "Transfer reasons", what: "Every reason a transfer can be raised for.", pad: 0 }, []);
    reasonPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Reason"],
      rows: PAS.TRANSFER_REASONS.map(function (r) { return [r]; }),
    }));
    page.appendChild(reasonPanel);

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "transfer",
      extraFields: function (extra) {
        extra.reason = PAS.TRANSFER_REASONS[0];
        var reasonSel = ui.h("select", { class: "field-input" });
        PAS.TRANSFER_REASONS.forEach(function (r) { reasonSel.appendChild(ui.h("option", { value: r }, r)); });
        reasonSel.addEventListener("change", function () { extra.reason = reasonSel.value; });
        var holderInput = ui.h("input", { class: "field-input", type: "text", placeholder: "New named insured" });
        holderInput.addEventListener("input", function () { extra.newHolder = holderInput.value; });
        var wrap = ui.h("div", {});
        wrap.appendChild(ui.field({ label: "Reason" }, reasonSel));
        wrap.appendChild(ui.field({ label: "New named insured", hint: "Who the policy is being transferred to." }, holderInput));
        return wrap;
      },
      onSubmit: function (payload) {
        if (!payload.extra.newHolder || !payload.extra.newHolder.trim()) { window.alert("A transfer needs the new named insured's name."); return; }
        PAS.raiseRequest(payload.policyId, "Transfer", { reason: payload.extra.reason || PAS.TRANSFER_REASONS[0], newHolder: payload.extra.newHolder.trim(), initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note });
        render();
      },
    }));

    page.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Already-submitted transfer requests, newest first.", className: "label-11 block mb-9" }));
    page.appendChild(ui.dataTable({
      columns: ["Policy", "Current insured", "Requested by",
        { label: "Reason", what: "Why the transfer is being requested." },
        { label: "New insured", what: "Who the policy will be held by if approved." },
        { label: "Submitted", what: "When the request arrived." }, ""],
      rows: pend.map(function (t) {
        var meta = t.h.meta || {};
        return [ui.cellId(t.p.id), ui.cellName(t.p.holder), ui.initiatorPill(meta), meta.reason || "—", meta.newHolder || "—", meta.submittedOn || t.h.date, ui.cellOpen("Review")];
      }),
      emptyText: "No transfer requests awaiting decision.",
      wrapCells: true,
      onRowClick: function (i) { location.href = "transfer-decision.html?policy=" + encodeURIComponent(pend[i].p.id) + "&txn=" + encodeURIComponent(pend[i].h.id); },
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("transfer-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
