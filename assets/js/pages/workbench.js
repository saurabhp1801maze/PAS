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

    var filterBlock = ui.h("div", { class: "filter-block" });
    var typeChipsWrap = ui.h("div", {});
    typeChipsWrap.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Type"));
    var typeChipRow = ui.h("div", { class: "chip-row" });
    typeChipsWrap.appendChild(typeChipRow);
    var statusChipsWrap = ui.h("div", {});
    statusChipsWrap.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Status"));
    var statusChipRow = ui.h("div", { class: "chip-row" });
    statusChipsWrap.appendChild(statusChipRow);
    filterBlock.appendChild(typeChipsWrap);
    filterBlock.appendChild(statusChipsWrap);
    page.appendChild(filterBlock);

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);

    function renderChips(container, list, active, onPick) {
      container.innerHTML = "";
      list.forEach(function (m) {
        var chip = ui.h("button", { class: "chip" + (active === m ? " active" : "") }, m);
        chip.addEventListener("click", function () { onPick(m); });
        container.appendChild(chip);
      });
    }

    function buildTable() {
      renderChips(typeChipRow, TYPES, typeF, function (m) { typeF = m; buildTable(); });
      renderChips(statusChipRow, STATUSES, statusF, function (m) { statusF = m; buildTable(); });

      var rows = all.filter(function (t) { return (typeF === "All" || t.h.type === typeF) && (statusF === "All" || (t.h.status || "Completed") === statusF); });
      tableContainer.innerHTML = "";
      tableContainer.appendChild(ui.dataTable({
        columns: [{ label: "Seq", what: "Monotonic order within the policy." }, "Policy", { label: "Type", what: "Kind of change." },
          { label: "Status", what: "Draft → Pending → Completed, or Rejected / Reversed.", rule: "Completed rows are never edited — corrections are new reversal rows." },
          { label: "Effective", what: "Business date the change applies from." },
          { label: "Recorded", what: "System date it was entered.", why: "Storing both makes the ledger bitemporal and as-of queryable." },
          "By", { label: "Action", what: "Reverse appends a compensating transaction.", rule: "The ledger is append-only — nothing is deleted." }],
        rows: rows.map(function (t) {
          var seqSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--text-faint)" } }, "#" + t.h.seq);
          var policyBtn = ui.h("button", { class: "btn ghost-link", style: { fontFamily: "var(--mono)", fontSize: "11.5px" } }, t.p.id);
          policyBtn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(t.p.id); });
          var recordedSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11px", color: "var(--text-faint)" } }, (t.h.recordedAt || "").slice(0, 10));
          var actionCell;
          if ((t.h.status || "Completed") === "Completed") {
            var revBtn = ui.h("button", { class: "btn small", style: { color: "var(--violet)" } }, "Reverse");
            revBtn.addEventListener("click", function () {
              PAS.api.call("POST", "/api/v1/transactions/" + t.h.id + "/reverse", { reason: "keyedInError" },
                { module: t.h.type, policyId: t.p.id, statusCode: 201, label: "Reverse txn #" + t.h.seq + " — " + t.p.holder, response: { reversalTxnId: PAS.uid("TXN"), reversesTxnId: t.h.id, status: "completed" } })
                .then(function () { PAS.reverseTxn(t.p.id, t.h.id); render(); });
            });
            actionCell = revBtn;
          } else {
            actionCell = ui.h("span", { style: { fontSize: "11px", color: "var(--text-faint)" } }, "—");
          }
          return [seqSpan, policyBtn, ui.modulePill(t.h.type), ui.txnStatusBadge(t.h.status), t.h.date, recordedSpan, t.h.user, actionCell];
        }),
        emptyText: "No transactions match these filters.",
      }));
    }
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("workbench", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
