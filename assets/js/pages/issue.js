/* Ported from IssueList in the original App.jsx, then extended: issuance is automated (see
   PAS.decide / PAS.toggleSubjectivity in store.js) — a Bound policy only ever sits here waiting
   because either (a) a subjectivity is still unmet, or (b) it's large enough to require a human
   look even with every gate clear (PAS.requiresManualIssue). The second panel below is the other
   half of that story: proof the automated pipeline actually ran, not just a claim that it would. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function timeAgo(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    return Math.round(mins / 60) + "h ago";
  }

  function render() {
    var policies = PAS.getPolicies();
    var q = policies.filter(function (p) { return p.status === "Bound"; });
    var rows = q.map(function (p) {
      var unmet = ((p.binder && p.binder.subjectivities) || []).filter(function (s) { return !s.met; }).length;
      var highValue = unmet === 0 && PAS.requiresManualIssue(p);
      var reason = unmet > 0 ? "blocked" : highValue ? "review" : "ready";
      return { p: p, unmet: unmet, highValue: highValue, reason: reason };
    });
    var recent = PAS.autoIssuedSince(policies, Date.now() - 24 * 3600000);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "stamp", tone: "amber", title: "Issue Desk", sub: "Bound policies awaiting formal issue and documentation",
      what: "Policies already bound under a binder, waiting to be formally issued.",
      why: "Bind and issue are legally distinct — cover is live, but until issue there is no contract and no document pack.",
    }));
    page.appendChild(ui.kpiRow([
      { label: "Awaiting issue", value: q.length, tone: "amber", tip: "Bound with no formal contract yet." },
      { label: "Blocked", value: rows.filter(function (r) { return r.reason === "blocked"; }).length, tone: "red", tip: "An outstanding subjectivity prevents issue.", why: "Live cover with unmet conditions is the riskiest state in the book." },
      { label: "Needs review", value: rows.filter(function (r) { return r.reason === "review"; }).length, tone: "indigo", tip: "Every gate cleared, but premium is over " + PAS.money(PAS.AUTO_ISSUE_PREMIUM_LIMIT) + " — the pipeline holds it for a human to confirm rather than issuing it unattended." },
      { label: "Premium bound", value: PAS.moneyShort(q.reduce(function (s, x) { return s + x.premium; }, 0)), tip: "Premium on risk under binders." },
    ]));

    var reasonPill = { blocked: ui.pill("red", "Blocked", "alert-triangle"), review: ui.pill("indigo", "High value — review", "clock"), ready: ui.pill("green", "Ready", "check-circle-2") };

    page.appendChild(ui.tipLabel({ text: "AWAITING ISSUE (" + rows.length + ")", what: "Bound policies with no formal contract yet — auto-issues the instant nothing is left blocking it.", className: "label-11 block mb-9" }));
    var awaitingTable = ui.sortableTable({
      storageKey: "pas.issue-desk.columns.v1",
      columns: [
        { key: "record", label: "Policy", locked: true, sortValue: function (r) { return r.p.id; }, cell: function (r) { return ui.cellId(r.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (r) { return (r.p.holder || "").toLowerCase(); }, cell: function (r) { return ui.cellName(r.p.holder); } },
        { key: "binder", label: "Binder", what: "Provisional cover note number.", why: "Legal evidence of cover until issue.", sortValue: function (r) { return r.p.binder.number; }, cell: function (r) { return ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px" } }, r.p.binder.number); } },
        { key: "expires", label: "Expires", what: "When provisional cover lapses.", rule: "Issuing after binder expiry is not permitted — the risk must be re-bound.", sortValue: function (r) { return r.p.binder.expiryDate; }, cell: function (r) { return r.p.binder.expiryDate; } },
        { key: "premium", label: "Premium", what: "Annual premium as bound.", sortValue: function (r) { return r.p.premium || 0; }, cell: function (r) { return PAS.money(r.p.premium); } },
        { key: "gates", label: "Gates", what: "How many of the five issue preconditions pass.", sortValue: function (r) { return r.unmet; }, cell: function (r) { return r.unmet === 0 ? ui.pill("green", "5/5") : ui.pill("red", (5 - r.unmet) + "/5"); } },
        { key: "reason", label: "Status", what: "Why this policy hasn't auto-issued.", sortValue: function (r) { return r.reason; }, cell: function (r) { return reasonPill[r.reason]; } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
      rows: rows,
      onRowClick: function (r) { location.href = "issue-decision.html?policy=" + encodeURIComponent(r.p.id); },
      emptyText: "Nothing awaiting issue.",
    });
    var awaitingHead = ui.h("div", { class: "period-toggle-row" });
    awaitingHead.appendChild(awaitingTable.columnsControl);
    page.appendChild(awaitingHead);
    page.appendChild(awaitingTable.tableWrap);

    page.appendChild(ui.tipLabel({ text: "AUTO-ISSUED IN THE LAST 24 HOURS (" + recent.length + ")", what: "Every policy the pipeline issued on its own in the last day — no manual Issue click, gates cleared and it went straight to Active.", className: "label-11 block mt-18 mb-9" }));
    var recentTable = ui.sortableTable({
      storageKey: "pas.issue-desk-recent.columns.v1",
      columns: [
        { key: "record", label: "Policy", locked: true, sortValue: function (t) { return t.p.id; }, cell: function (t) { return ui.cellId(t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (t) { return (t.p.holder || "").toLowerCase(); }, cell: function (t) { return ui.cellName(t.p.holder); } },
        { key: "premium", label: "Premium", sortValue: function (t) { return t.p.premium || 0; }, cell: function (t) { return PAS.money(t.p.premium); } },
        { key: "issued", label: "Issued", what: "When the automated pipeline ran.", sortValue: function (t) { return t.h.recordedAt; }, cell: function (t) { return timeAgo(t.h.recordedAt); } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
      rows: recent,
      onRowClick: function (t) { location.href = "policy-detail.html?policy=" + encodeURIComponent(t.p.id); },
      emptyText: "Nothing auto-issued yet in the last 24 hours — this fills in the moment the pipeline runs (approve a submission, or clear a policy's last subjectivity).",
    });
    var recentHead = ui.h("div", { class: "period-toggle-row" });
    recentHead.appendChild(recentTable.columnsControl);
    page.appendChild(recentHead);
    page.appendChild(recentTable.tableWrap);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("issue-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
