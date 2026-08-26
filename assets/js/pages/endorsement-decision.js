/* Ported from EndorsementDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  /* What's actually changing, beyond the free-text note — shape depends on changeType, so this
     dispatches on whichever structured field the request's meta actually carries. Requests without
     one of these (logged before this existed, or a changeType this doesn't cover yet) fall back to
     just the request note above — nothing breaks, there's simply nothing more to show. */
  function changeDetailBlocks(meta) {
    var blocks = [];
    if (meta.vehicles && meta.vehicles.length) {
      blocks.push(ui.tipLabel({ text: "Vehicles in this request (" + meta.vehicles.length + ")", what: "Each unit being added to (or changed on) the fleet under this endorsement.", className: "label-11 block mt-15 mb-9" }));
      blocks.push(ui.dataTable({
        columns: ["Unit", "Type", "Make / Model", "Year", { label: "VIN", what: "Vehicle identification number." }, "Value"],
        rows: meta.vehicles.map(function (v) { return [v.unit, v.type, v.make + " " + v.model, String(v.year), ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11px" } }, v.vin), PAS.money(v.value)]; }),
      }));
    }
    if (meta.drivers && meta.drivers.length) {
      blocks.push(ui.tipLabel({ text: "Drivers in this request (" + meta.drivers.length + ")", what: "Each driver being added to or removed from the policy.", className: "label-11 block mt-15 mb-9" }));
      blocks.push(ui.dataTable({
        columns: ["Action", "Name", "Relationship", { label: "License", what: "License number and issuing state." }, "Years licensed"],
        rows: meta.drivers.map(function (d) {
          return [ui.pill(d.action === "Remove" ? "red" : "green", d.action), d.name, d.relationship || "—", (d.licenseNumber || "—") + " (" + (d.licenseState || "—") + ")", d.yearsLicensed != null ? String(d.yearsLicensed) : "—"];
        }),
      }));
    }
    if (meta.addressChange) {
      blocks.push(ui.tipLabel({ text: "Address change", what: "Registered address on file, before and after.", className: "label-11 block mt-15 mb-9" }));
      blocks.push(ui.dataTable({ columns: ["Field", "Before", "After"], rows: [["Address", meta.addressChange.from, meta.addressChange.to]] }));
    }
    if (meta.limitChange) {
      blocks.push(ui.tipLabel({ text: "Limit change", what: "The specific coverage limit being raised or lowered.", className: "label-11 block mt-15 mb-9" }));
      blocks.push(ui.dataTable({ columns: ["Coverage", "Before", "After"], rows: [[meta.limitChange.coverage, meta.limitChange.from, meta.limitChange.to]] }));
    }
    if (meta.coverageChange) {
      blocks.push(ui.tipLabel({ text: "Coverage change", what: "The new coverage being added to the policy.", className: "label-11 block mt-15 mb-9" }));
      blocks.push(ui.kv({ k: "Coverage", v: meta.coverageChange.coverage }));
      blocks.push(ui.kv({ k: "Action", v: meta.coverageChange.action }));
      if (meta.coverageChange.limit) blocks.push(ui.kv({ k: "Limit", v: meta.coverageChange.limit }));
      if (meta.coverageChange.deductible) blocks.push(ui.kv({ k: "Deductible", v: meta.coverageChange.deductible }));
    }
    return blocks;
  }

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === sp.get("txn"); })
      || p.history.find(function (x) { return x.type === "Endorsement" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }

    var viewPolicyBtn = ui.h("button", { class: "btn small" }, [document.createTextNode("View policy details "), PAS.icon("arrow-right", { size: 12 })]);
    viewPolicyBtn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); });

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Endorsement desk", function () { location.href = "endorsement.html"; }));
    page.appendChild(ui.recordHead(p, [viewPolicyBtn, ui.txnStatusBadge(h.status)]));

    var left = [];
    left.push(ui.requestOrigin(h.meta));
    left.push(ui.tipLabel({ text: "Requested change", what: "What was asked for, mid-term.", className: "label-11 block mb-10" }));
    left.push(ui.kv({ k: "Change type", v: h.meta.changeType, what: "What is being altered." }));
    left.push(ui.kv({ k: "Materiality", v: h.meta.materiality, what: "Material changes alter the risk and need sign-off.", rule: "Material endorsements are never auto-applied." }));
    left.push(ui.kv({ k: "Requested", v: h.date, what: "Business date the change was requested." }));
    left.push(ui.kv({ k: "Transaction", v: "#" + h.seq, mono: true, what: "Position in the policy ledger." }));
    left.push(ui.h("div", { class: "mt-13" }, ui.callout("warn", h.detail)));
    changeDetailBlocks(h.meta).forEach(function (b) { left.push(b); });

    var right = [];
    right.push(ui.tipLabel({ text: "Financial impact", what: "What approving this does to premium and cover — before vs. after, line by line.", className: "label-11 block mb-10" }));
    var impact = h.meta.premiumImpact || 0;
    var impactSpan = ui.h("span", { style: { color: impact >= 0 ? "var(--green)" : "var(--red)", fontWeight: "700" } }, (impact >= 0 ? "+" : "") + PAS.money(impact));
    var beforeCoverage = PAS.coverageBreakdown(p);
    var afterCoverage = PAS.coverageBreakdown({ product: p.product, premium: p.premium + impact });
    var compareRows = [["Premium", PAS.money(p.premium), PAS.money(p.premium + impact), impactSpan]];
    beforeCoverage.forEach(function (c, i) {
      var afterLine = afterCoverage[i] || { premium: c.premium };
      var lineDelta = afterLine.premium - c.premium;
      var deltaSpan = ui.h("span", { style: { color: lineDelta > 0 ? "var(--green)" : lineDelta < 0 ? "var(--red)" : "var(--text-faint)", fontWeight: "700" } }, (lineDelta > 0 ? "+" : "") + PAS.money(lineDelta));
      compareRows.push([c.name, PAS.money(c.premium), PAS.money(afterLine.premium), deltaSpan]);
    });
    right.push(ui.dataTable({
      columns: ["Item", "Before", "After", { label: "Change", what: "What this endorsement moves the figure by, prorated for the remainder of the term.", why: "Published to Billing as an adjustment once approved." }],
      rows: compareRows,
    }));
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
        { module: "Endorsement", policyId: p.id, statusCode: 200, label: (ok ? "Approve" : "Decline") + " endorsement — " + p.holder, response: { txnId: h.id, status: ok ? "completed" : "rejected", premiumDelta: { amount: h.meta.premiumImpact || 0, currency: "USD" }, policyVersion: p.history.length + 1 } })
        .then(function () {
          PAS.decideTxn(p.id, h.id, ok, audit);
          ui.flashThenGo("endorsement.html", flash(ok ? "Approve" : "Decline"));
        });
    }
    function hold(action) {
      return function (result) {
        var comment = result && typeof result === "object" ? result.comment : result;
        var email = (result && typeof result === "object" && result.email) || "";
        PAS.recordHeldDecision(p.id, h.id, action, comment, "Endorsement", email);
        ui.renderToast(email
          ? { title: action + " recorded", detail: "Notification queued via SMTP to " + email, tone: "blue" }
          : flash(action));
        render();
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, h.id, "Approve", { label: "Approve & apply", tone: "green", icon: "check-circle-2", onRun: function (c) { return act(true, c); } }),
      ui.confirmable(p.id, h.id, "Decline", { label: "Decline", tone: "red", icon: "ban", onRun: function (c) { return act(false, c); } }),
      ui.confirmable(p.id, h.id, "Escalate", { label: "Escalate", icon: "arrow-up-right", showEmail: true, emailPlaceholder: "underwriting.supervisor@veridex.com", onRun: hold("Escalate") }),
      ui.confirmable(p.id, h.id, "Request More Information", { label: "Request more information", icon: "corner-up-left", showEmail: true, emailPlaceholder: "broker@example.com", onRun: hold("Request More Information") }),
    ]));

    root.appendChild(ui.screen("endorsement-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
