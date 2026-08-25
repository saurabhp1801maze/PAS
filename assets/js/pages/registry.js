/* Ported from RegistryPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var q = "", sf = "All", pf = "All", stf = "All";
    var products = ["All"].concat(Array.from(new Set(policies.map(function (p) { return p.product; }))).sort());
    var states = ["All"].concat(Array.from(new Set(policies.map(function (p) { return p.state; }))).sort());

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

    var toolbar = ui.h("div", { class: "register-toolbar" });

    var searchWrap = ui.h("div", { class: "register-search" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", {
      class: "register-search-input",
      type: "search",
      placeholder: "Search by insured name or policy number…",
      autocomplete: "off",
    });
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);

    var filters = ui.h("div", { class: "register-filters" });
    var statusSelect = ui.h("select", { class: "register-select", title: "Status" });
    ["All", "Referred", "Bound", "Active", "Cancelled", "Expired", "Non-renewed"].forEach(function (s) {
      statusSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All statuses" : s));
    });
    filters.appendChild(statusSelect);

    var productSelect = ui.h("select", { class: "register-select", title: "Product" });
    products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All products" : p)); });
    filters.appendChild(productSelect);

    var stateSelect = ui.h("select", { class: "register-select", title: "State" });
    states.forEach(function (s) { stateSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All states" : s)); });
    filters.appendChild(stateSelect);
    toolbar.appendChild(filters);

    var exportBtn = ui.h("button", { class: "btn register-export", type: "button" }, [
      PAS.icon("download", { size: 13 }),
      document.createTextNode(" Export CSV"),
    ]);
    exportBtn.addEventListener("click", function () {
      var rows = policies.filter(match);
      var header = ["id", "holder", "product", "status", "premium", "effectiveDate", "expirationDate", "state"];
      var lines = [header.join(",")].concat(rows.map(function (p) {
        return [p.id, JSON.stringify(p.holder || ""), JSON.stringify(p.product || ""), p.status, p.premium, p.effectiveDate, p.expirationDate, JSON.stringify(p.state || "")].join(",");
      }));
      var blob = new Blob([lines.join("\n")], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "policy-register.csv";
      a.click();
    });
    toolbar.appendChild(exportBtn);
    page.appendChild(toolbar);

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);

    function match(p) {
      return (sf === "All" || p.status === sf)
        && (pf === "All" || p.product === pf)
        && (stf === "All" || p.state === stf)
        && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    }

    function buildTable() {
      var rows = policies.filter(match);
      tableContainer.innerHTML = "";
      if (sf !== "All" || pf !== "All" || stf !== "All" || q) {
        tableContainer.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Showing " + rows.length + " of " + policies.length + " records."));
      }
      tableContainer.appendChild(ui.dataTable({
        columns: ["Record", "Insured", "Product", { label: "Status", what: "Position in the lifecycle state machine.", why: "Status decides which actions are legal on this record." }, { label: "Premium", what: "Annual written premium." }, { label: "Term", what: "Effective and expiry dates of the current term." }, { label: "Docs", what: "Generated document versions held." }, ""],
        rows: rows.map(function (p) { return [ui.cellId(p.id), ui.cellName(p.holder), p.product, ui.badge(p.status), PAS.money(p.premium), p.effectiveDate + " → " + p.expirationDate, ui.pill((p.documents && p.documents.length) ? "gray" : "amber", String((p.documents && p.documents.length) || 0)), ui.cellOpen("Open")]; }),
        onRowClick: function (i) { location.href = "policy-detail.html?policy=" + encodeURIComponent(rows[i].id); },
        emptyText: "No matching records.",
      }));
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; buildTable(); });
    statusSelect.addEventListener("change", function () { sf = statusSelect.value; buildTable(); });
    productSelect.addEventListener("change", function () { pf = productSelect.value; buildTable(); });
    stateSelect.addEventListener("change", function () { stf = stateSelect.value; buildTable(); });
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("registry", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
