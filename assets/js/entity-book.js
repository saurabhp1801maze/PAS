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

  /* The two relation columns to show on a detail page are "whichever of Broker/MGA/Carrier
     this page isn't already grouped by" — on the Brokers page that's MGA + Carrier, on the
     Customers page (grouped by holder, not a relation at all) it's all three. */
  var RELATIONS = [
    { key: "broker", field: "producer", label: "Broker" },
    { key: "mga", field: "mga", label: "MGA" },
    { key: "carrier", field: "carrier", label: "Carrier" },
  ];
  var PENDING_TYPES = ["Cancellation", "Renewal", "Endorsement", "Reinstatement"];

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
        var premium = active.reduce(function (s, p) { return s + (p.premium || 0); }, 0);
        var pending = PENDING_TYPES.reduce(function (s, t) { return s + PAS.pendingOf(mine, t).length; }, 0);
        var states = Array.from(new Set(mine.map(function (p) { return p.state; }).filter(Boolean))).length;
        return {
          name: name, type: opts.typeMap ? (opts.typeMap[name] || "") : "",
          total: mine.length, active: active.length, premium: premium,
          avgPremium: active.length ? premium / active.length : 0,
          pending: pending, states: states,
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

      var q = "", tf = "All";
      var columns = [
        { key: "name", label: ui_capitalize(opts.singularLower), locked: true, sortValue: function (r) { return r.name.toLowerCase(); }, cell: function (r) { return ui.cellName(r.name); } },
      ];
      if (opts.typeMap) columns.push({ key: "type", label: "Type", sortValue: function (r) { return r.type; }, cell: function (r) { return r.type ? ui.pill(r.type === "Individual" ? "blue" : r.type === "Direct" ? "gray" : "indigo", r.type) : "—"; } });
      columns.push(
        { key: "total", label: "Policies", what: "Every record with this " + opts.singularLower + ", any status.", sortValue: function (r) { return r.total; }, cell: function (r) { return String(r.total); } },
        { key: "active", label: "Active", what: "In force as of today.", sortValue: function (r) { return r.active; }, cell: function (r) { return String(r.active); } },
        { key: "premium", label: "In-force premium", what: "Sum of annual premium across this " + opts.singularLower + "'s active policies.", sortValue: function (r) { return r.premium; }, cell: function (r) { return PAS.money(r.premium); } },
        { key: "avgPremium", label: "Avg premium", what: "Mean annual premium per active policy — a quick read on book quality, independent of size.", sortValue: function (r) { return r.avgPremium; }, cell: function (r) { return PAS.money(r.avgPremium); } },
        { key: "pending", label: "Pending requests", what: "Open cancellation, renewal, endorsement or reinstatement requests across this " + opts.singularLower + "'s policies.", sortValue: function (r) { return r.pending; }, cell: function (r) { return r.pending ? ui.pill("amber", String(r.pending)) : "—"; } },
        { key: "states", label: "States", what: "Distinct states this " + opts.singularLower + " has business in.", sortValue: function (r) { return r.states; }, cell: function (r) { return String(r.states); } }
      );
      var listDefaultVisible = (opts.typeMap ? ["type"] : []).concat(["total", "active", "premium", "pending"]);

      page.appendChild(ui.tipLabel({ text: opts.titleUpper + " (" + rows.length + ")", what: "Click any " + opts.singularLower + " to see every policy placed through them.", className: "label-11 block mb-9" }));

      var toolbar = ui.h("div", { class: "register-toolbar" });
      var searchWrap = ui.h("div", { class: "register-search" });
      searchWrap.appendChild(PAS.icon("search", { size: 14 }));
      var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search by name…", autocomplete: "off" });
      searchWrap.appendChild(searchInput);
      toolbar.appendChild(searchWrap);

      var filters = ui.h("div", { class: "register-filters" });
      var typeSelect = null;
      if (opts.typeMap) {
        var types = ["All"].concat(Array.from(new Set(rows.map(function (r) { return r.type; }).filter(Boolean))).sort());
        typeSelect = ui.h("select", { class: "register-select", title: "Type" });
        types.forEach(function (t) { typeSelect.appendChild(ui.h("option", { value: t }, t === "All" ? "All types" : t)); });
        filters.appendChild(typeSelect);
      }
      toolbar.appendChild(filters);

      function matchRow(r) {
        return (tf === "All" || r.type === tf) && r.name.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      }
      var table = ui.sortableTable({
        storageKey: "pas." + opts.paramName + "s.columns.v1",
        defaultVisible: listDefaultVisible,
        columns: columns,
        trailingColumn: { cell: function () { return ui.cellOpen("View"); } },
        rows: function () { return rows.filter(matchRow); },
        onRowClick: function (r) { location.href = opts.href + "?" + opts.paramName + "=" + encodeURIComponent(r.name); },
        emptyText: "No " + opts.titleLower + " match that search.",
      });
      toolbar.appendChild(table.columnsControl);
      page.appendChild(toolbar);

      var noteEl = ui.h("div", { class: "faint-note mb-9" });
      page.appendChild(noteEl);
      page.appendChild(table.tableWrap);

      function refresh() {
        var filtered = rows.filter(matchRow);
        noteEl.textContent = (tf !== "All" || q) ? "Showing " + filtered.length + " of " + rows.length + " " + opts.titleLower + "." : "";
        table.rebuild();
      }
      searchInput.addEventListener("input", function () { q = searchInput.value; refresh(); });
      if (typeSelect) typeSelect.addEventListener("change", function () { tf = typeSelect.value; refresh(); });
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

      var relationCols = RELATIONS.filter(function (r) { return r.field !== opts.fieldName; });
      var q = "", sf = "All", pf = "All", stf = "All";
      var products = ["All"].concat(Array.from(new Set(mine.map(function (p) { return p.product; }).filter(Boolean))).sort());
      var states = ["All"].concat(Array.from(new Set(mine.map(function (p) { return p.state; }).filter(Boolean))).sort());

      page.appendChild(ui.tipLabel({ text: "Policies (" + mine.length + ")", what: "Every record placed through " + name + ".", className: "label-11 block mb-9" }));

      var toolbar = ui.h("div", { class: "register-toolbar" });
      var searchWrap = ui.h("div", { class: "register-search" });
      searchWrap.appendChild(PAS.icon("search", { size: 14 }));
      var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search by insured name or policy number…", autocomplete: "off" });
      searchWrap.appendChild(searchInput);
      toolbar.appendChild(searchWrap);

      var filters = ui.h("div", { class: "register-filters" });
      var statusSelect = ui.h("select", { class: "register-select", title: "Status" });
      ["All"].concat(PAS.STATUS_BUCKETS).forEach(function (s) { statusSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All statuses" : s)); });
      filters.appendChild(statusSelect);
      var productSelect = ui.h("select", { class: "register-select", title: "Product" });
      products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All products" : p)); });
      filters.appendChild(productSelect);
      var stateSelect = ui.h("select", { class: "register-select", title: "State" });
      states.forEach(function (s) { stateSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All states" : s)); });
      filters.appendChild(stateSelect);
      toolbar.appendChild(filters);

      function match(p) {
        return (sf === "All" || PAS.statusBucket(p.status) === sf)
          && (pf === "All" || p.product === pf)
          && (stf === "All" || p.state === stf)
          && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      }

      var columns = [
        { key: "record", label: "Record", locked: true, sortValue: function (p) { return p.id; }, cell: function (p) { return ui.cellId(p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (p) { return (p.holder || "").toLowerCase(); }, cell: function (p) { return ui.cellName(p.holder); } },
        { key: "product", label: "Product", sortValue: function (p) { return p.product || ""; }, cell: function (p) { return p.product; } },
        { key: "status", label: "Status", what: "Position in the lifecycle state machine.", sortValue: function (p) { return PAS.statusBucket(p.status); }, cell: function (p) { var b = PAS.statusBucket(p.status); return ui.pill(PAS.BUCKET_TONE[b], b); } },
        { key: "premium", label: "Premium", sortValue: function (p) { return p.premium || 0; }, cell: function (p) { return PAS.money(p.premium); } },
        { key: "term", label: "Term", sortValue: function (p) { return p.effectiveDate || ""; }, cell: function (p) { return p.effectiveDate + " → " + p.expirationDate; } },
      ];
      relationCols.forEach(function (r) {
        columns.push({ key: r.key, label: r.label, sortValue: function (p) { return p[r.field] || ""; }, cell: function (p) { return p[r.field] || "—"; } });
      });
      columns.push(
        { key: "state", label: "State", sortValue: function (p) { return p.state || ""; }, cell: function (p) { return p.state || "—"; } },
        { key: "submitted", label: "Submitted", what: "When this record first entered the book.", sortValue: function (p) { return p.submittedOn || ""; }, cell: function (p) { return p.submittedOn || "—"; } }
      );

      var table = ui.sortableTable({
        storageKey: "pas." + opts.paramName + "-detail.columns.v1",
        defaultVisible: ["product", "status", "premium", "term"].concat(relationCols.map(function (r) { return r.key; })),
        columns: columns,
        trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
        rows: function () { return mine.filter(match); },
        onRowClick: function (p) { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); },
        emptyText: "No policies match that search.",
      });
      toolbar.appendChild(table.columnsControl);
      page.appendChild(toolbar);

      var noteEl = ui.h("div", { class: "faint-note mb-9" });
      page.appendChild(noteEl);
      page.appendChild(table.tableWrap);

      function refresh() {
        var filtered = mine.filter(match);
        noteEl.textContent = (sf !== "All" || pf !== "All" || stf !== "All" || q) ? "Showing " + filtered.length + " of " + mine.length + " policies." : "";
        table.rebuild();
      }
      searchInput.addEventListener("input", function () { q = searchInput.value; refresh(); });
      statusSelect.addEventListener("change", function () { sf = statusSelect.value; refresh(); });
      productSelect.addEventListener("change", function () { pf = productSelect.value; refresh(); });
      stateSelect.addEventListener("change", function () { stf = stateSelect.value; refresh(); });
    }

    function ui_capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  };
})(window);
