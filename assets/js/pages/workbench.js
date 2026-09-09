/* Ported from WorkbenchPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;
  var ALL_TYPES = ["All", "Submission", "Underwriting", "Bind", "Issuance", "Endorsement", "Cancellation", "Reinstatement", "Renewal", "Transfer", "Servicing", "Rewrite", "Reissue", "Rescind", "Audit", "Lapse", "Split", "Merge"];
  /* The only four things a Broker or MGA can actually raise from a desk (see the four Decision
     desks pages) — Submission, Underwriting, Bind, Issuance and every other internal/ops-only
     transaction type never appears as something they requested, so a scoped role's ledger is
     narrowed to just these instead of surfacing machinery they have no part in. */
  var REQUEST_TYPES = ["Endorsement", "Cancellation", "Reinstatement", "Renewal"];
  var STATUSES = ["All", "Completed", "Pending", "Rejected", "Reversed"];

  function render() {
    var spec = PAS.ROLES[PAS.getRole()] || {};
    var scoped = spec.scope && spec.scope !== "all" && spec.scope !== "none";
    var TYPES = scoped ? ["All"].concat(REQUEST_TYPES) : ALL_TYPES;
    var policies = PAS.getScopedPolicies();
    var all = PAS.allTxns(policies);
    if (scoped) all = all.filter(function (t) { return REQUEST_TYPES.indexOf(t.h.type) !== -1; });
    var typeF = "All", statusF = "All";

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "git-branch", tone: "blue", title: "Transaction Workbench", sub: "The append-only ledger behind every policy",
      what: scoped ? "Every Endorsement, Cancellation, Reinstatement and Renewal request on this book, in sequence — the four request types " + spec.label + " can raise." : "Every transaction of every type, in sequence.",
      why: "Transactions, not modules, are the real unit of work after issue.",
    }));
    page.appendChild(ui.kpiRow([
      { label: "Transactions", value: all.length, tip: "Complete ledger across the book." },
      { label: "Pending", value: all.filter(function (t) { return t.h.status === "Pending"; }).length, tone: "amber", tip: "Held, not applied." },
      { label: "Reversed", value: all.filter(function (t) { return t.h.status === "Reversed"; }).length, tone: "violet", tip: "Superseded by a compensating row." },
      { label: "Policies", value: policies.length, tip: "Aggregates in this ledger." },
    ]));

    /* Type ran up to 18 chip bubbles wide (every internal transaction kind, not just the four a
       scoped role can raise) — a dropdown holds that list without wrapping the filter bar onto
       several lines the way the chip row did. Status stays consistent with it as a dropdown too,
       even though its own list is short, rather than mixing two different filter controls in the
       same row. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    var typeGroup = ui.h("div", {});
    typeGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Type"));
    var typeSelect = ui.h("select", { class: "register-select", title: "Type" });
    TYPES.forEach(function (m) { typeSelect.appendChild(ui.h("option", { value: m }, m === "All" ? "All types" : m)); });
    typeSelect.addEventListener("change", function () { typeF = typeSelect.value; pageIndex = 0; buildTable(); });
    typeGroup.appendChild(typeSelect);
    var statusGroup = ui.h("div", {});
    statusGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Status"));
    var statusSelect = ui.h("select", { class: "register-select", title: "Status" });
    STATUSES.forEach(function (m) { statusSelect.appendChild(ui.h("option", { value: m }, m === "All" ? "All statuses" : m)); });
    statusSelect.addEventListener("change", function () { statusF = statusSelect.value; pageIndex = 0; buildTable(); });
    statusGroup.appendChild(statusSelect);
    filterBlock.appendChild(typeGroup);
    filterBlock.appendChild(statusGroup);
    page.appendChild(filterBlock);

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);

    var pageSize = 25, pageIndex = 0;
    function buildTable() {
      typeSelect.value = typeF;
      statusSelect.value = statusF;

      var rows = all.filter(function (t) { return (typeF === "All" || t.h.type === typeF) && (statusF === "All" || (t.h.status || "Completed") === statusF); });
      var total = rows.length;
      var totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (pageIndex >= totalPages) pageIndex = totalPages - 1;
      if (pageIndex < 0) pageIndex = 0;
      var start = pageIndex * pageSize;
      var pageRows = rows.slice(start, start + pageSize);
      tableContainer.innerHTML = "";
      tableContainer.appendChild(ui.dataTable({
        columns: [{ label: "Seq", what: "Monotonic order within the policy." }, "Policy", { label: "Type", what: "Kind of change." },
          { label: "Status", what: "Draft → Pending → Completed, or Rejected / Reversed.", rule: "Completed rows are never edited — corrections are new reversal rows." },
          { label: "Effective", what: "Business date the change applies from." },
          { label: "Recorded At", what: "System date and time it was entered.", why: "Storing both makes the ledger bitemporal and as-of queryable." },
          "User By", { label: "Action", what: "Reverse appends a compensating transaction.", rule: "The ledger is append-only — nothing is deleted." }],
        rows: pageRows.map(function (t) {
          var seqSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--color-muted)" } }, "#" + t.h.seq);
          var policyBtn = ui.h("button", { class: "btn ghost-link", style: { fontFamily: "var(--mono)", fontSize: "11.5px" } }, t.p.id);
          policyBtn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(t.p.id); });
          /* recordedAt is a full ISO timestamp; PAS.fmtDate only accepts a plain YYYY-MM-DD (it
             appends its own "T00:00:00"), so the date portion has to be sliced off before it goes
             in — PAS.fmtTime parses the full ISO string directly and needs no such slicing. */
          var recordedSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11px", color: "var(--color-muted)" } }, t.h.recordedAt ? PAS.fmtDate(t.h.recordedAt.slice(0, 10)) + ", " + PAS.fmtTime(t.h.recordedAt) : "—");
          var actionCell;
          if ((t.h.status || "Completed") === "Completed") {
            var revBtn = ui.h("button", { class: "btn small", style: { color: "var(--outcome-load)" } }, "Reverse");
            revBtn.addEventListener("click", function () {
              PAS.api.call("POST", "/api/v1/transactions/" + t.h.id + "/reverse", { reason: "keyedInError" },
                { module: t.h.type, policyId: t.p.id, statusCode: 201, label: "Reverse txn #" + t.h.seq + " — " + t.p.holder, response: { reversalTxnId: PAS.uid("TXN"), reversesTxnId: t.h.id, status: "completed" } })
                .then(function () { PAS.reverseTxn(t.p.id, t.h.id); render(); });
            });
            actionCell = revBtn;
          } else {
            actionCell = ui.h("span", { style: { fontSize: "11px", color: "var(--color-muted)" } }, "—");
          }
          return [seqSpan, policyBtn, ui.modulePill(t.h.type), ui.txnStatusBadge(t.h.status, t.h.type, t.h.meta), PAS.fmtDate(t.h.date), recordedSpan, t.h.user, actionCell];
        }),
        emptyText: "No transactions match these filters.",
      }));
      if (total > 0) {
        var pager = ui.h("div", { class: "table-pager" });
        var from = start + 1, to = Math.min(total, start + pageSize);
        pager.appendChild(ui.h("span", { class: "table-pager-meta" }, "Showing " + from + "–" + to + " of " + total));
        var nav = ui.h("div", { class: "table-pager-nav" });
        var prev = ui.h("button", { class: "btn small", type: "button", disabled: pageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (pageIndex > 0) { pageIndex--; buildTable(); } });
        var next = ui.h("button", { class: "btn small", type: "button", disabled: pageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (pageIndex < totalPages - 1) { pageIndex++; buildTable(); } });
        nav.appendChild(prev);
        nav.appendChild(ui.h("span", { class: "table-pager-page" }, "Page " + (pageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        tableContainer.appendChild(pager);
      }
    }
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("workbench", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
