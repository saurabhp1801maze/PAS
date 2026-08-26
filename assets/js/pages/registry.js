/* Ported from RegistryPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var STATUS_BUCKETS = PAS.STATUS_BUCKETS, BUCKET_TONE = PAS.BUCKET_TONE, statusBucket = PAS.statusBucket;

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
      { label: "Closed", value: policies.filter(function (p) { return ["Cancelled", "Expired", "Non-renewed", "Declined"].indexOf(p.status) !== -1; }).length, tip: "No longer on risk." },
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
    ["All"].concat(STATUS_BUCKETS).forEach(function (s) {
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

    function match(p) {
      return (sf === "All" || statusBucket(p.status) === sf)
        && (pf === "All" || p.product === pf)
        && (stf === "All" || p.state === stf)
        && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    }

    /* `record` and `insured` are locked visible — without an identifying column the table would
       be useless to click into, so they're not offered in the Columns picker at all. */
    var registryTable = ui.sortableTable({
      storageKey: "pas.registry.columns.v1",
      defaultVisible: ["record", "insured", "product", "status", "premium", "term", "docs"],
      columns: [
        { key: "record", label: "Record", locked: true, sortValue: function (p) { return p.id; }, cell: function (p) { return ui.cellId(p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (p) { return (p.holder || "").toLowerCase(); }, cell: function (p) { return ui.cellName(p.holder); } },
        { key: "product", label: "Product", sortValue: function (p) { return p.product || ""; }, cell: function (p) { return p.product; } },
        { key: "status", label: "Status", what: "Position in the lifecycle state machine.", why: "Status decides which actions are legal on this record.", sortValue: function (p) { return statusBucket(p.status); }, cell: function (p) { var b = statusBucket(p.status); return ui.pill(BUCKET_TONE[b], b); } },
        { key: "premium", label: "Premium", what: "Annual written premium.", sortValue: function (p) { return p.premium || 0; }, cell: function (p) { return PAS.money(p.premium); } },
        { key: "term", label: "Term", what: "Effective and expiry dates of the current term.", sortValue: function (p) { return p.effectiveDate || ""; }, cell: function (p) { return p.effectiveDate + " → " + p.expirationDate; } },
        { key: "docs", label: "Docs", what: "Generated document versions held.", sortValue: function (p) { return (p.documents && p.documents.length) || 0; }, cell: function (p) { var n = (p.documents && p.documents.length) || 0; return ui.pill(n ? "gray" : "amber", String(n)); } },
        { key: "broker", label: "Broker", sortValue: function (p) { return p.producer || ""; }, cell: function (p) { return p.producer || "—"; } },
        { key: "mga", label: "MGA", sortValue: function (p) { return p.mga || ""; }, cell: function (p) { return p.mga || "—"; } },
        { key: "carrier", label: "Carrier", sortValue: function (p) { return p.carrier || ""; }, cell: function (p) { return p.carrier || "—"; } },
        { key: "state", label: "State", sortValue: function (p) { return p.state || ""; }, cell: function (p) { return p.state || "—"; } },
        { key: "submitted", label: "Submitted", what: "When this record first entered the book.", sortValue: function (p) { return p.submittedOn || ""; }, cell: function (p) { return p.submittedOn || "—"; } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
      rows: function () { return policies.filter(match); },
      onRowClick: function (p) { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); },
      emptyText: "No matching records.",
    });
    toolbar.appendChild(registryTable.columnsControl);

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

    var noteEl = ui.h("div", { class: "faint-note mb-9" });
    page.appendChild(noteEl);
    page.appendChild(registryTable.tableWrap);

    function refresh() {
      var filtered = policies.filter(match);
      noteEl.textContent = (sf !== "All" || pf !== "All" || stf !== "All" || q)
        ? "Showing " + filtered.length + " of " + policies.length + " records." : "";
      registryTable.rebuild();
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; refresh(); });
    statusSelect.addEventListener("change", function () { sf = statusSelect.value; refresh(); });
    productSelect.addEventListener("change", function () { pf = productSelect.value; refresh(); });
    stateSelect.addEventListener("change", function () { stf = stateSelect.value; refresh(); });
    refresh();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("registry", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
