/* Ported from DocumentsPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
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
      chip.addEventListener("click", function () { typeF = t; renderChips(); buildTable(); });
      typeChipRow.appendChild(chip);
    });
    toolbar.appendChild(typeChipRow);
    page.appendChild(toolbar);
    function renderChips() {
      typeChipRow.querySelectorAll(".chip").forEach(function (c, i) { c.classList.toggle("active", TYPES[i] === typeF); });
    }

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);
    function buildTable() {
      var rows = docs.filter(function (x) {
        return (typeF === "All" || x.d.type === typeF) && (x.p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || x.p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      });
      tableContainer.innerHTML = "";
      if (typeF !== "All" || q) tableContainer.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Showing " + rows.length + " of " + docs.length + " documents."));
      tableContainer.appendChild(ui.dataTable({
        columns: ["Document", "Policy", "Insured", { label: "Type", what: "Document class." }, { label: "Version", what: "Regenerated on every material change." }, "Generated", ""],
        rows: rows.map(function (x) {
          var nameSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: "600" } }, [PAS.icon("file-text", { size: 13, color: "var(--primary)" }), document.createTextNode(x.d.name)]);
          var dlSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--primary)", fontSize: "12px", fontWeight: "700" } }, [PAS.icon("download", { size: 12 }), document.createTextNode("PDF")]);
          return [nameSpan, ui.cellId(x.p.id), x.p.holder, x.d.type, ui.pill("gray", "v" + x.d.version), x.d.generatedAt, dlSpan];
        }),
        emptyText: "No matching documents.",
      }));
    }
    searchInput.addEventListener("input", function () { q = searchInput.value; buildTable(); });
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("documents", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
