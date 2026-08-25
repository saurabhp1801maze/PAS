/* Ported from RegistryPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var q = "", sf = "All";

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "list-checks", tone: "indigo", title: "Policy Register", sub: "Every record in the book, in every lifecycle state",
      what: "Submissions and policies alike.", why: "The single source of truth each decision desk reads from.",
    }));
    page.appendChild(ui.kpiRow([
      { label: "Total records", value: policies.length, tip: "Submissions plus policies." },
      { label: "In force", value: policies.filter(function (p) { return p.status === "Active"; }).length, tone: "green", tip: "Issued, not cancelled or expired." },
      { label: "Pre-issue", value: policies.filter(function (p) { return ["Referred", "Bound"].indexOf(p.status) !== -1; }).length, tone: "amber", tip: "Submissions and bound-not-issued." },
      { label: "Closed", value: policies.filter(function (p) { return ["Cancelled", "Expired", "Non-renewed"].indexOf(p.status) !== -1; }).length, tip: "No longer on risk." },
    ]));

    var searchRow = ui.h("div", { class: "search-row" });
    var searchWrap = ui.h("div", { class: "search-input-wrap" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", { class: "field-input", placeholder: "Search insured or policy number" });
    searchWrap.appendChild(searchInput);
    searchRow.appendChild(searchWrap);
    var statusSelect = ui.h("select", { class: "field-input select-fixed" });
    ["All", "Referred", "Bound", "Active", "Cancelled", "Expired", "Non-renewed"].forEach(function (s) { statusSelect.appendChild(ui.h("option", { value: s }, s)); });
    searchRow.appendChild(statusSelect);
    page.appendChild(searchRow);

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);

    function buildTable() {
      var rows = policies.filter(function (p) {
        return (sf === "All" || p.status === sf) && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      });
      tableContainer.innerHTML = "";
      tableContainer.appendChild(ui.dataTable({
        columns: ["Record", "Insured", "Product", { label: "Status", what: "Position in the lifecycle state machine.", why: "Status decides which actions are legal on this record." }, { label: "Premium", what: "Annual written premium." }, { label: "Term", what: "Effective and expiry dates of the current term." }, { label: "Docs", what: "Generated document versions held." }, ""],
        rows: rows.map(function (p) { return [ui.cellId(p.id), ui.cellName(p.holder), p.product, ui.badge(p.status), PAS.money(p.premium), p.effectiveDate + " → " + p.expirationDate, ui.pill((p.documents && p.documents.length) ? "gray" : "amber", String((p.documents && p.documents.length) || 0)), ui.cellOpen("Open")]; }),
        onRowClick: function (i) { location.href = "policy-detail.html?policy=" + encodeURIComponent(rows[i].id); },
        emptyText: "No matching records.",
      }));
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; buildTable(); });
    statusSelect.addEventListener("change", function () { sf = statusSelect.value; buildTable(); });
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("registry", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
