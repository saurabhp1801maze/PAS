/* Ported from EndorsementList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pend = PAS.pendingOf(policies, "Endorsement");
    var done = policies.reduce(function (acc, p) {
      p.history.filter(function (h) { return h.type === "Endorsement" && h.status !== "Pending"; }).forEach(function (h) { acc.push({ p: p, h: h }); });
      return acc;
    }, []);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "edit-3", tone: "amber", title: "Endorsement Desk", sub: "Mid-term change requests — every one decided, none applied on the spot",
      what: "Change requests from the insured, a broker, or logged by ops on their behalf.",
      why: "Material changes carry real risk and financial impact — nothing touches the policy until an underwriter has reviewed the actual request.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
      { label: "Material", value: pend.filter(function (t) { return t.h.meta && t.h.meta.materiality === "Material"; }).length, tone: "red", tip: "Alters the risk — needs real scrutiny before approval.", why: "Adding a driver or raising a limit changes what's insured, not just paperwork." },
      { label: "Premium at stake", value: PAS.moneyShort(pend.reduce(function (s, e) { return s + Math.abs((e.h.meta && e.h.meta.premiumImpact) || 0); }, 0)), tip: "Absolute premium impact of held requests." },
      { label: "Applied to date", value: done.length, tip: "Endorsements already committed to the ledger." },
    ]));

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "endorsement",
      extraFields: function (extra) {
        extra.changeType = "Address change"; extra.materiality = "Minor"; extra.premiumImpact = "";
        var changeSel = ui.h("select", { class: "field-input" });
        ["Address change", "Add/remove driver", "Vehicle change", "Coverage change", "Limit change"].forEach(function (c) { changeSel.appendChild(ui.h("option", { value: c }, c)); });
        changeSel.addEventListener("change", function () { extra.changeType = changeSel.value; });
        var f1 = ui.field({ label: "Change type" }, changeSel);

        var matSel = ui.h("select", { class: "field-input" });
        ["Minor", "Material"].forEach(function (c) { matSel.appendChild(ui.h("option", { value: c }, c)); });
        matSel.addEventListener("change", function () { extra.materiality = matSel.value; });
        var f2 = ui.field({ label: "Materiality", hint: "Whether this alters the underlying risk." }, matSel);

        var impInput = ui.h("input", { class: "field-input", type: "number", placeholder: "0" });
        impInput.addEventListener("input", function () { extra.premiumImpact = impInput.value; });
        var f3 = ui.field({ label: "Premium impact ($)", hint: "Positive for an increase, negative for a decrease." }, impInput);

        extra.effectiveDate = PAS.todayISO();
        var effInput = ui.h("input", { class: "field-input", type: "date", value: PAS.todayISO() });
        effInput.addEventListener("input", function () { extra.effectiveDate = effInput.value; });
        var f4 = ui.field({ label: "Effective date", hint: "Future-dated and out-of-sequence endorsements are flagged automatically." }, effInput);

        return [f1, f2, f3, f4];
      },
      onSubmit: function (payload) {
        PAS.raiseEndorsement(payload.policyId, {
          changeType: payload.extra.changeType || "Address change",
          materiality: payload.extra.materiality || "Minor",
          premiumImpact: Number(payload.extra.premiumImpact) || 0,
          effectiveDate: payload.extra.effectiveDate || PAS.todayISO(),
          initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note,
        });
        render();
      },
    }));

    page.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Already-submitted change requests, ordered newest first.", className: "label-11 block mb-9" }));
    page.appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Requested by", { label: "Change", what: "Category of mid-term change." }, { label: "Effective", what: "Business date the change applies from." }, { label: "Flags", what: "Future-dated or out-of-sequence." }, { label: "Materiality", what: "Whether this alters the underlying risk.", rule: "Material changes require re-underwriting before they can be approved." }, { label: "Premium impact", what: "Prorated delta from effective date to end of term." }, ""],
      rows: pend.map(function (t) {
        var impact = (t.h.meta && t.h.meta.premiumImpact) || 0;
        var impactSpan = ui.h("span", { style: { color: impact >= 0 ? "var(--green)" : "var(--red)", fontWeight: "700" } }, (impact >= 0 ? "+" : "") + PAS.money(impact));
        var flags = [];
        if (t.h.meta && t.h.meta.futureDated) flags.push(ui.pill("blue", "Future"));
        if (t.h.meta && t.h.meta.outOfSequence) flags.push(ui.pill("red", "OOS"));
        var flagCell = ui.h("span", {}, flags.length ? flags : [ui.pill("gray", "—")]);
        return [ui.cellId(t.p.id), ui.cellName(t.p.holder), ui.initiatorPill(t.h.meta), t.h.meta.changeType, t.h.meta.effectiveDate || t.h.date, flagCell, ui.pill(t.h.meta.materiality === "Material" ? "red" : "gray", t.h.meta.materiality), impactSpan, ui.cellOpen("Review")];
      }),
      emptyText: "No endorsements awaiting decision.",
      onRowClick: function (i) { location.href = "endorsement-decision.html?policy=" + encodeURIComponent(pend[i].p.id) + "&txn=" + encodeURIComponent(pend[i].h.id); },
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("endorsement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
