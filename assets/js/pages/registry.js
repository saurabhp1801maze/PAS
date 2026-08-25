/* Ported from RegistryPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  /* The record's real lifecycle status (7 values: Referred, Bound, Active, Cancelled, Expired,
     Declined, Non-renewed) is what every other screen and rule in this app keys off of — that
     stays untouched. This register just displays a coarser 4-bucket view on top of it: Active
     stays itself; Referred/Bound (still moving through underwriting or awaiting issue, nothing
     decided yet) become "On Hold"; Cancelled/Declined (terminated, whether by request or by
     never being accepted) become "Canceled"; Expired/Non-renewed (the term simply ran out)
     become "Expired". */
  var STATUS_BUCKETS = ["Active", "On Hold", "Expired", "Canceled"];
  var BUCKET_TONE = { Active: "green", "On Hold": "amber", Expired: "gray", Canceled: "red" };
  function statusBucket(status) {
    if (status === "Active") return "Active";
    if (status === "Referred" || status === "Bound") return "On Hold";
    if (status === "Cancelled" || status === "Declined") return "Canceled";
    return "Expired"; /* Expired, Non-renewed */
  }

  var COLUMNS_KEY = "pas.registry.columns.v1";
  function loadVisibleColumns(defaults) {
    try {
      var raw = sessionStorage.getItem(COLUMNS_KEY);
      if (raw) { var parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length) return parsed; }
    } catch (e) { /* ignore */ }
    return defaults.slice();
  }
  function saveVisibleColumns(keys) {
    try { sessionStorage.setItem(COLUMNS_KEY, JSON.stringify(keys)); } catch (e) { /* ignore */ }
  }

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

    /* ---------- column definitions ----------
       `record` and `insured` are locked visible — without an identifying column the table would
       be useless to click into, so they're not offered in the picker at all. Everything else is
       opt-in/out via the Columns control below, backed by sessionStorage so the choice survives
       navigating away and back. */
    var ALL_COLUMNS = [
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
    ];
    var DEFAULT_VISIBLE = ["record", "insured", "product", "status", "premium", "term", "docs"];
    var visibleKeys = loadVisibleColumns(DEFAULT_VISIBLE);
    /* Guard against a stale sessionStorage value referencing a column that no longer exists. */
    visibleKeys = visibleKeys.filter(function (k) { return ALL_COLUMNS.some(function (c) { return c.key === k; }); });
    if (visibleKeys.length === 0) visibleKeys = DEFAULT_VISIBLE.slice();

    var columnsBtnWrap = ui.h("div", { class: "multiselect" });
    var columnsBtn = ui.h("button", { type: "button", class: "field-input select-fixed multiselect-btn" }, "Columns");
    columnsBtnWrap.appendChild(columnsBtn);
    var columnsPanelEl = null;
    function closeColumnsPanel() {
      if (!columnsPanelEl) return;
      columnsPanelEl.remove(); columnsPanelEl = null;
      document.removeEventListener("click", onColumnsDocClick);
    }
    function onColumnsDocClick(e) { if (columnsPanelEl && !columnsPanelEl.contains(e.target) && !columnsBtn.contains(e.target)) closeColumnsPanel(); }
    function openColumnsPanel() {
      columnsPanelEl = ui.h("div", { class: "multiselect-panel" });
      var list = ui.h("div", { class: "multiselect-list" });
      ALL_COLUMNS.forEach(function (c) {
        if (c.locked) return; /* always shown, nothing to toggle */
        list.appendChild(ui.checkboxRow({
          label: c.label, checked: visibleKeys.indexOf(c.key) !== -1,
          onChange: function (checked) {
            if (checked) { if (visibleKeys.indexOf(c.key) === -1) visibleKeys.push(c.key); }
            else { visibleKeys = visibleKeys.filter(function (k) { return k !== c.key; }); }
            saveVisibleColumns(visibleKeys);
            buildTable();
          },
        }));
      });
      columnsPanelEl.appendChild(list);
      columnsBtnWrap.appendChild(columnsPanelEl);
      document.addEventListener("click", onColumnsDocClick);
    }
    columnsBtn.addEventListener("click", function (e) { e.stopPropagation(); if (columnsPanelEl) closeColumnsPanel(); else openColumnsPanel(); });
    toolbar.appendChild(columnsBtnWrap);

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
      return (sf === "All" || statusBucket(p.status) === sf)
        && (pf === "All" || p.product === pf)
        && (stf === "All" || p.state === stf)
        && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    }

    /* Click any sortable header to sort by it, ascending first; click the same header again to
       flip direction. Sorting is on the record's real field value (via each column's own
       sortValue), never on rendered cell text, so it stays correct regardless of formatting.
       Keyed by column key rather than position — toggling a column's visibility can reorder or
       remove entries from the rendered header row, and a positional index would silently start
       sorting by the wrong column (or crash) once that happened. */
    var sortState = null; /* { key: <ALL_COLUMNS key>, dir: "asc"|"desc" } */
    function buildTable() {
      var activeColumns = ALL_COLUMNS.filter(function (c) { return c.locked || visibleKeys.indexOf(c.key) !== -1; });
      var sortCol = sortState && activeColumns.filter(function (c) { return c.key === sortState.key; })[0];
      var rows = policies.filter(match);
      if (sortCol) {
        var dir = sortState.dir;
        rows = rows.slice().sort(function (a, b) {
          var va = sortCol.sortValue(a), vb = sortCol.sortValue(b);
          var cmp = (typeof va === "number" && typeof vb === "number") ? (va - vb) : String(va).localeCompare(String(vb));
          return dir === "asc" ? cmp : -cmp;
        });
      }
      tableContainer.innerHTML = "";
      if (sf !== "All" || pf !== "All" || stf !== "All" || q) {
        tableContainer.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Showing " + rows.length + " of " + policies.length + " records."));
      }
      var columns = activeColumns.map(function (c) { return c.what || c.why ? { label: c.label, what: c.what, why: c.why } : c.label; }).concat([""]);
      var sortable = activeColumns.map(function () { return true; }).concat([false]);
      var sortDisplayState = sortCol ? { col: activeColumns.indexOf(sortCol), dir: sortState.dir } : null;
      tableContainer.appendChild(ui.dataTable({
        columns: columns,
        sortable: sortable,
        sortState: sortDisplayState,
        onSort: function (i) {
          if (i >= activeColumns.length) return; /* the trailing "Open" column isn't sortable */
          var key = activeColumns[i].key;
          if (sortState && sortState.key === key) sortState = { key: key, dir: sortState.dir === "asc" ? "desc" : "asc" };
          else sortState = { key: key, dir: "asc" };
          buildTable();
        },
        rows: rows.map(function (p) { return activeColumns.map(function (c) { return c.cell(p); }).concat([ui.cellOpen("Open")]); }),
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
