/* Shared renderer behind the Brokers, MGA and Carrier pages — all three are the same shape
   (a distribution-partner "book": who they are, how much business they carry, drill into any
   one of them to see their real policies), so it's one function fed different config rather
   than three near-identical copies. List and detail are the same HTML file/page key, switched
   on a `?<paramName>=<name>` query param — there's no decision to make on either screen, just
   navigation, so a second static HTML file per entity type would only add file count without
   adding anything a query param doesn't already do simpler. */
(function (global) {
  "use strict";
  var PAS = global.PAS;

  PAS.renderEntityBook = function (opts) {
    var ui = PAS.ui;
    var policies = PAS.getPolicies();
    var params = new URLSearchParams(location.search);
    var selected = params.get(opts.paramName);

    var page = ui.h("div", {});
    if (selected) renderDetail(page, selected);
    else renderList(page);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen(opts.pageKey, page));

    function entityRows() {
      var names = Array.from(new Set(policies.map(function (p) { return p[opts.fieldName]; }).filter(Boolean)));
      return names.map(function (name) {
        var mine = policies.filter(function (p) { return p[opts.fieldName] === name; });
        var active = mine.filter(function (p) { return p.status === "Active"; });
        return {
          name: name, type: opts.typeMap ? (opts.typeMap[name] || "") : "",
          total: mine.length, active: active.length,
          premium: active.reduce(function (s, p) { return s + (p.premium || 0); }, 0),
        };
      });
    }

    function renderList(page) {
      var rows = entityRows();
      var totalPremium = rows.reduce(function (s, r) { return s + r.premium; }, 0);
      page.appendChild(ui.pageHeader({
        icon: opts.icon, tone: opts.tone, title: opts.title, sub: opts.sub,
        what: opts.what, why: opts.why,
      }));
      page.appendChild(ui.kpiRow([
        { label: "Total " + opts.titleLower, value: rows.length, tip: "Distinct " + opts.titleLower + " on the book." },
        { label: "Total policies", value: policies.filter(function (p) { return !!p[opts.fieldName]; }).length, tone: "blue", tip: "Every record placed through " + opts.article + " " + opts.singularLower + " on file." },
        { label: "In-force premium", value: PAS.moneyShort(totalPremium), tone: "green", tip: "Sum of active premium across every " + opts.singularLower + "." },
      ]));

      var columns = [
        { key: "name", label: ui_capitalize(opts.singularLower), locked: true, sortValue: function (r) { return r.name.toLowerCase(); }, cell: function (r) { return ui.cellName(r.name); } },
      ];
      if (opts.typeMap) columns.push({ key: "type", label: "Type", sortValue: function (r) { return r.type; }, cell: function (r) { return r.type ? ui.pill(r.type === "Individual" ? "blue" : r.type === "Direct" ? "gray" : "indigo", r.type) : "—"; } });
      columns.push(
        { key: "total", label: "Policies", what: "Every record with this " + opts.singularLower + ", any status.", sortValue: function (r) { return r.total; }, cell: function (r) { return String(r.total); } },
        { key: "active", label: "Active", what: "In force as of today.", sortValue: function (r) { return r.active; }, cell: function (r) { return String(r.active); } },
        { key: "premium", label: "In-force premium", what: "Sum of annual premium across this " + opts.singularLower + "'s active policies.", sortValue: function (r) { return r.premium; }, cell: function (r) { return PAS.money(r.premium); } }
      );

      var q = "";
      var head = ui.h("div", { class: "period-toggle-row" });
      var labelEl = ui.tipLabel({ text: opts.titleUpper + " (" + rows.length + ")", what: "Click any " + opts.singularLower + " to see every policy placed through them.", className: "label-11" });
      head.appendChild(labelEl);
      var searchInput = null;
      if (opts.searchable) {
        searchInput = ui.h("input", { class: "field-input select-fixed", type: "search", placeholder: "Search by name…", autocomplete: "off" });
      }
      var table = ui.sortableTable({
        storageKey: "pas." + opts.paramName + "s.columns.v1",
        columns: columns,
        trailingColumn: { cell: function () { return ui.cellOpen("View"); } },
        rows: opts.searchable ? function () { return rows.filter(function (r) { return r.name.toLowerCase().indexOf(q.toLowerCase()) !== -1; }); } : rows,
        onRowClick: function (r) { location.href = opts.href + "?" + opts.paramName + "=" + encodeURIComponent(r.name); },
        emptyText: opts.searchable ? "No " + opts.titleLower + " match that search." : "No " + opts.titleLower + " on file.",
      });
      if (searchInput) {
        var rowWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
        rowWrap.appendChild(searchInput);
        rowWrap.appendChild(table.columnsControl);
        head.appendChild(rowWrap);
        searchInput.addEventListener("input", function () { q = searchInput.value; table.rebuild(); });
      } else {
        head.appendChild(table.columnsControl);
      }
      page.appendChild(head);
      page.appendChild(table.tableWrap);
    }

    function renderDetail(page, name) {
      var mine = policies.filter(function (p) { return p[opts.fieldName] === name; });
      var active = mine.filter(function (p) { return p.status === "Active"; });
      var premium = active.reduce(function (s, p) { return s + (p.premium || 0); }, 0);
      var type = opts.typeMap ? (opts.typeMap[name] || "") : "";

      page.appendChild(ui.backLink("All " + opts.titleLower, function () { location.href = opts.href; }));
      page.appendChild(ui.pageHeader({
        icon: opts.icon, tone: opts.tone, title: name,
        sub: (type ? type + " · " : "") + mine.length + " polic" + (mine.length === 1 ? "y" : "ies"),
        what: "Every policy placed through this " + opts.singularLower + ".", why: opts.why,
      }));
      page.appendChild(ui.kpiRow([
        { label: "Policies", value: mine.length, tip: "Every record with this " + opts.singularLower + ", any status." },
        { label: "Active", value: active.length, tone: "green", tip: "In force as of today." },
        { label: "In-force premium", value: PAS.money(premium), tone: "green", tip: "Sum of annual premium across active policies." },
        { label: "Avg premium", value: PAS.money(active.length ? premium / active.length : 0), tip: "Mean annual premium per active policy." },
      ]));

      var head = ui.h("div", { class: "period-toggle-row" });
      head.appendChild(ui.tipLabel({ text: "Policies (" + mine.length + ")", what: "Every record placed through " + name + ".", className: "label-11" }));
      var table = ui.sortableTable({
        storageKey: "pas." + opts.paramName + "-detail.columns.v1",
        defaultVisible: ["record", "insured", "product", "status", "premium", "term"],
        columns: [
          { key: "record", label: "Record", locked: true, sortValue: function (p) { return p.id; }, cell: function (p) { return ui.cellId(p.id); } },
          { key: "insured", label: "Insured", locked: true, sortValue: function (p) { return (p.holder || "").toLowerCase(); }, cell: function (p) { return ui.cellName(p.holder); } },
          { key: "product", label: "Product", sortValue: function (p) { return p.product || ""; }, cell: function (p) { return p.product; } },
          { key: "status", label: "Status", sortValue: function (p) { return p.status || ""; }, cell: function (p) { return ui.badge(p.status); } },
          { key: "premium", label: "Premium", sortValue: function (p) { return p.premium || 0; }, cell: function (p) { return PAS.money(p.premium); } },
          { key: "term", label: "Term", sortValue: function (p) { return p.effectiveDate || ""; }, cell: function (p) { return p.effectiveDate + " → " + p.expirationDate; } },
          { key: "state", label: "State", sortValue: function (p) { return p.state || ""; }, cell: function (p) { return p.state || "—"; } },
        ],
        trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
        rows: mine,
        onRowClick: function (p) { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); },
        emptyText: "No policies on file.",
      });
      head.appendChild(table.columnsControl);
      page.appendChild(head);
      page.appendChild(table.tableWrap);
    }

    function ui_capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  };
})(window);
