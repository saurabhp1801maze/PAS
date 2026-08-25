/* Ported from IssueDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }

    var subs = (p.binder && p.binder.subjectivities) || [];
    var unmet = subs.filter(function (s) { return !s.met; });
    var expired = PAS.daysBetween(PAS.todayISO(), p.binder.expiryDate) < 0;
    var gates = [
      { label: "Status is BOUND", ok: p.status === "Bound", why: "Only a bound risk can be issued." },
      { label: "Binder not expired", ok: !expired, why: "Binder runs to " + p.binder.expiryDate + "." },
      { label: "All subjectivities satisfied", ok: unmet.length === 0, why: unmet.length ? ("Outstanding: " + unmet.map(function (s) { return s.label; }).join(", ")) : "All conditions cleared." },
      { label: "Compliance & sanctions clear", ok: true, why: "Screening returned no hits." },
      { label: "Document template available", ok: true, why: "Schedule and certificate templates resolved for this product." },
    ];
    var canIssue = gates.every(function (g) { return g.ok; });

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Issue desk", function () { location.href = "issue.html"; }));
    page.appendChild(ui.recordHead(p, canIssue ? ui.pill("green", "Ready to issue", "check-circle-2") : ui.pill("red", unmet.length + " blocking", "alert-triangle")));

    var left = [];
    left.push(ui.tipLabel({ text: "Issue gates", what: "All five must pass before a policy can be issued.", rule: "Issue is blocked, not warned — an unmet gate disables the button.", className: "label-11 block mb-10" }));
    gates.forEach(function (g) {
      var row = ui.h("div", { class: "gate-row" });
      var icon = PAS.icon(g.ok ? "check-circle-2" : "x-circle", { size: 15, color: g.ok ? "var(--green)" : "var(--red)" });
      icon.classList.add("gate-icon");
      row.appendChild(icon);
      var body = ui.h("div", {});
      body.appendChild(ui.h("div", { class: "gate-label" + (g.ok ? "" : " fail") }, g.label));
      body.appendChild(ui.h("div", { class: "gate-why" }, g.why));
      row.appendChild(body);
      left.push(row);
    });
    var subWrap = ui.h("div", { class: "mt-15" });
    subWrap.appendChild(ui.tipLabel({ text: "Subjectivities", what: "Conditions the insured must satisfy before the contract can be formalised.", why: "Tick to clear — in production each is evidence-backed, not a checkbox.", className: "label-11 block mb-9" }));
    subs.forEach(function (s, i) {
      subWrap.appendChild(ui.checkboxRow({ checked: s.met, label: s.label, onChange: function () { PAS.toggleSubjectivity(p.id, i); render(); } }));
    });
    left.push(subWrap);

    var right = [];
    right.push(ui.tipLabel({ text: "Binder", what: "The provisional cover currently protecting this insured.", className: "label-11 block mb-10" }));
    right.push(ui.kv({ k: "Binder number", v: p.binder.number, mono: true, what: "Reference for provisional cover." }));
    right.push(ui.kv({ k: "Bound on", v: p.binder.boundOn, what: "Date provisional cover attached." }));
    right.push(ui.kv({ k: "Expires", v: p.binder.expiryDate, what: "Deadline to formalise.", rule: "Past this date the risk must be re-underwritten and re-bound." }));
    right.push(ui.kv({ k: "Days remaining", v: PAS.daysBetween(PAS.todayISO(), p.binder.expiryDate) + " days", what: "Time left on the binder." }));
    var effWrap = ui.h("div", { class: "mt-15" });
    effWrap.appendChild(ui.tipLabel({ text: "What issuing will do", what: "The exact side effects of pressing the button.", why: "Nothing hidden — issue is a compound operation.", className: "label-11 block mb-10" }));
    [["Policy status → ACTIVE", "stamp"], ["Policy schedule generated & stored", "file-check-2"], ["Certificate of insurance generated", "file-check-2"], ["policyIssued published to Billing, Documents, Reinsurance", "zap"], ["Ledger entry appended", "git-branch"]].forEach(function (pair) {
      var row = ui.h("div", { class: "effect-row" });
      row.appendChild(PAS.icon(pair[1], { size: 13 }));
      row.appendChild(ui.h("span", {}, pair[0]));
      effWrap.appendChild(row);
    });
    right.push(effWrap);
    if (!canIssue) right.push(ui.h("div", { class: "mt-12" }, ui.callout("bad", "Issue is blocked. Cover stays provisional under the binder until every gate clears.")));
    right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, null)));

    function flash(action) {
      return { title: action + " recorded", detail: p.id, tone: action === "Issue" ? "green" : "blue" };
    }
    function doIssue(comment) {
      var audit = PAS.makeAudit("Issue", comment);
      return PAS.api.call("POST", "/api/v1/policies/" + p.id + "/issue", { generateDocuments: true, note: comment },
        { module: "Issuance", policyId: p.id, statusCode: 200, label: "Issue policy — " + p.holder, response: { policyNumber: p.id, status: "active", documents: ["policy-schedule-v1.pdf", "certificate-of-insurance-v1.pdf"], events: ["policyIssued"] } })
        .then(function () {
          PAS.issuePolicy(p.id, audit);
          ui.flashThenGo("issue.html", flash("Issue"));
        });
    }
    function hold(action) {
      return function (comment) {
        PAS.recordHeldDecision(p.id, null, action, comment, "Issuance");
        ui.renderToast(flash(action));
        render();
      };
    }

    page.appendChild(ui.decisionLayout(left, right, [
      ui.confirmable(p.id, "—", "Issue", { label: "Issue policy & generate documents", tone: "primary", icon: "file-check-2", onRun: doIssue, disabled: !canIssue, disabledReason: unmet.length ? ("Outstanding subjectivity: " + unmet.map(function (s) { return s.label; }).join(", ")) : "An issue gate has not passed." }),
      ui.confirmable(p.id, "—", "Escalate", { label: "Escalate", icon: "arrow-up-right", onRun: hold("Escalate") }),
      ui.confirmable(p.id, "—", "Request More Information", { label: "Request more information", icon: "corner-up-left", onRun: hold("Request More Information") }),
    ]));

    root.appendChild(ui.screen("issue-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
