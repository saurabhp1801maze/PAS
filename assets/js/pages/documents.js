/* Ported from DocumentsPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getScopedPolicies();
    var docs = policies.reduce(function (acc, p) { (p.documents || []).forEach(function (d) { acc.push({ p: p, d: d }); }); return acc; }, []);
    var q = "", typeF = "All";
    var TYPES = ["All", "Schedule", "Certificate", "Notice"];

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "file-check-2", tone: "gray", title: "Document Library", sub: "Every generated artefact, versioned and traceable",
      what: "Documents across the book, tied to the policy that produced them.",
      why: "Regulators ask what the customer held on a given date — versioning is how you answer.",
    }));
    page.appendChild(ui.kpiRow([
      { label: "Documents", value: docs.length, tip: "Total generated artefacts." },
      { label: "Schedules", value: docs.filter(function (x) { return x.d.type === "Schedule"; }).length, tip: "Policy schedules issued." },
      { label: "Certificates", value: docs.filter(function (x) { return x.d.type === "Certificate"; }).length, tip: "Certificates of insurance." },
      { label: "Notices", value: docs.filter(function (x) { return x.d.type === "Notice"; }).length, tip: "Cancellation and renewal notices." },
    ]));

    var toolbar = ui.h("div", { class: "register-toolbar" });
    var searchWrap = ui.h("div", { class: "register-search" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search policy or insured…", autocomplete: "off" });
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);
    var typeChipRow = ui.h("div", { class: "chip-row" });
    TYPES.forEach(function (t) {
      var chip = ui.h("button", { class: "chip" + (typeF === t ? " active" : ""), type: "button" }, t);
      chip.addEventListener("click", function () { typeF = t; pageIndex = 0; renderChips(); buildTable(); });
      typeChipRow.appendChild(chip);
    });
    toolbar.appendChild(typeChipRow);
    page.appendChild(toolbar);
    function renderChips() {
      typeChipRow.querySelectorAll(".chip").forEach(function (c, i) { c.classList.toggle("active", TYPES[i] === typeF); });
    }

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);
    var pageSize = 25, pageIndex = 0;
    function buildTable() {
      var rows = docs.filter(function (x) {
        return (typeF === "All" || x.d.type === typeF) && (x.p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || x.p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      });
      tableContainer.innerHTML = "";
      if (typeF !== "All" || q) tableContainer.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Showing " + rows.length + " of " + docs.length + " documents."));
      var total = rows.length;
      var totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (pageIndex >= totalPages) pageIndex = totalPages - 1;
      if (pageIndex < 0) pageIndex = 0;
      var start = pageIndex * pageSize;
      var pageRows = rows.slice(start, start + pageSize);
      tableContainer.appendChild(ui.dataTable({
        columns: ["Document", "Policy", "Insured", { label: "Type", what: "Document class." }, { label: "Version", what: "Regenerated on every material change." }, "Generated", ""],
        rows: pageRows.map(function (x) {
          var nameSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: "600" } }, [PAS.icon("file-text", { size: 13, color: "var(--color-link)" }), document.createTextNode(x.d.name)]);
          var dlSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--color-link)", fontSize: "12px", fontWeight: "700" } }, [PAS.icon("download", { size: 12 }), document.createTextNode("PDF")]);
          return [nameSpan, ui.cellId(x.p.id), x.p.holder, x.d.type, ui.pill("gray", "v" + x.d.version), PAS.fmtDate(x.d.generatedAt), dlSpan];
        }),
        emptyText: "No matching documents.",
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
    searchInput.addEventListener("input", function () { q = searchInput.value; pageIndex = 0; buildTable(); });
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("documents", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
