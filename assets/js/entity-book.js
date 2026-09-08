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
    { key: "carrier", field: "carrier", label: "Reinsurer" },
  ];
  var PENDING_TYPES = ["Cancellation", "Renewal", "Endorsement", "Reinstatement"];

  /* Extra list-page filters, opted into per page via opts.relationFilters — a customer (unlike a
     broker or MGA) genuinely spans multiple products/states/brokers/MGAs/reinsurers across their
     own policies, so narrowing the directory by any one of those is useful there in a way it isn't
     on the Brokers/MGA/Carrier pages themselves (whichever of these fields IS that page's own
     entity is excluded — see the `field !== opts.fieldName` filter below). */
  var LIST_FILTERS = [
    { field: "product", label: "Product", allLabel: "All products" },
    { field: "state", label: "State", allLabel: "All states" },
    { field: "producer", label: "Broker", allLabel: "All brokers" },
    { field: "mga", label: "MGA", allLabel: "All MGAs" },
    { field: "carrier", label: "Reinsurer", allLabel: "All reinsurers" },
  ];

  /* Same thresholds the dashboard's financial view uses, so a broker never reads "healthy" here
     and "hot" there for the same number. */
  function lossTone(r) { return r >= 0.85 ? "red" : r >= 0.6 ? "amber" : "green"; }
  function combinedTone(r) { return r >= 1 ? "red" : r >= 0.95 ? "amber" : "green"; }
  function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }

  PAS.renderEntityBook = function (opts) {
    var ui = PAS.ui;
    var allPolicies = PAS.getScopedPolicies();
    var params = new URLSearchParams(location.search);
    var selected = params.get(opts.paramName);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var outer = ui.h("div", {});
    root.appendChild(outer);

    /* Same Monthly/Quarterly/Yearly/All-history/Custom control as the Dashboard and the Policy
       register (PAS.ui.periodToggle, see store.js for the shared date math). Scopes by
       `submittedOn`, falling back to `effectiveDate` when missing (most of this seed book never had
       submittedOn recorded — see the matching comment in registry.js). A period change re-renders
       the whole list/detail body below it — rows, KPIs and financials all derive from which
       policies are in scope, so there's no narrower place to patch than rebuilding the body
       wholesale, same as any of this page's other filters changing. */
    var pt = ui.periodToggle({ defaultPeriod: "all", onChange: function () { buildBody(); } });
    outer.appendChild(pt.el);

    var bodyWrap = ui.h("div", {});
    outer.appendChild(bodyWrap);
    outer.appendChild(ui.apiLifecycle(opts.pageKey).el);

    function scopedPolicies() {
      return pt.period === "all" ? allPolicies : allPolicies.filter(function (p) { return pt.matches(p.submittedOn || p.effectiveDate); });
    }

    function buildBody() {
      bodyWrap.innerHTML = "";
      if (selected) renderDetail(bodyWrap, selected);
      else renderList(bodyWrap);
    }
    buildBody();

    function entityRows() {
      var policies = scopedPolicies();
      var names = Array.from(new Set(policies.map(function (p) { return p[opts.fieldName]; }).filter(Boolean)));
      return names.map(function (name) {
        var mine = policies.filter(function (p) { return p[opts.fieldName] === name; });
        var active = mine.filter(function (p) { return p.status === "Active"; });
        var premium = active.reduce(function (s, p) { return s + (p.premium || 0); }, 0);
        var pending = PENDING_TYPES.reduce(function (s, t) { return s + PAS.pendingOf(mine, t).length; }, 0);
        var states = Array.from(new Set(mine.map(function (p) { return p.state; }).filter(Boolean))).length;
        var row = {
          name: name, type: opts.typeMap ? (opts.typeMap[name] || "") : "",
          total: mine.length, active: active.length, premium: premium,
          avgPremium: active.length ? premium / active.length : 0,
          pending: pending, states: states,
        };
        if (opts.relationFilters) {
          LIST_FILTERS.forEach(function (lf) {
            row[lf.field + "List"] = Array.from(new Set(mine.map(function (p) { return p[lf.field]; }).filter(Boolean)));
          });
        }
        if (opts.showFinancials) {
          var f = PAS.bookFinancials(PAS.onRiskPolicies(mine));
          row.lossRatio = f.lossRatio;
          row.claimsIncurred = f.incurred;
          row.claimCount = f.claimCount;
          if (opts.showCommission) row.commissionPaid = f.brokerCommission;
          if (opts.showCession) {
            row.writtenPremium = f.writtenPremium;
            row.netPremiumCeded = f.earnedPremium - f.commission;
            row.underwritingResult = f.underwritingResult;
            row.combinedRatio = f.combinedRatio;
          }
        }
        return row;
      });
    }

    function renderList(page) {
      var policies = scopedPolicies();
      var rows = entityRows();
      page.appendChild(ui.pageHeader({
        icon: opts.icon, tone: opts.tone, title: opts.title, sub: opts.sub,
        what: opts.what, why: opts.why,
      }));

      /* Claims-load index (Reinsurer page only, opts.showCession): share of the WHOLE book's
         claim volume this partner absorbs, divided by its share of the whole book's written
         premium. 1.0× is proportionate; well above it means a partner is taking disproportionately
         more claims than its book size predicts — the kind of imbalance a loss ratio alone doesn't
         surface, since a small book can have a fine loss ratio and still be an outsized share of
         total claims handling. Computed against the full scoped book (`policies`), not the
         search-filtered rows, so the denominator doesn't shift as the viewer filters. */
      var bookWide = opts.showCession ? PAS.bookFinancials(PAS.onRiskPolicies(policies)) : null;
      function claimsLoadIndex(r) {
        if (!bookWide || !bookWide.claimCount || !bookWide.writtenPremium || !r.writtenPremium) return null;
        var premShare = r.writtenPremium / bookWide.writtenPremium;
        return premShare ? (r.claimCount / bookWide.claimCount) / premShare : null;
      }
      function loadTone(idx) { return idx >= 1.5 ? "red" : idx >= 1.1 ? "amber" : "green"; }

      var q = "", tf = "All";
      /* Which of LIST_FILTERS actually applies here — excludes whichever field IS this page's own
         entity (e.g. no "Broker" filter on the Brokers page itself, self-filtering is meaningless). */
      var activeListFilters = opts.relationFilters ? LIST_FILTERS.filter(function (lf) { return lf.field !== opts.fieldName; }) : [];
      var rf = {};
      activeListFilters.forEach(function (lf) { rf[lf.field] = "All"; });
      function relationFiltersActive() { return activeListFilters.some(function (lf) { return rf[lf.field] !== "All"; }); }
      function matchRow(r) {
        return (tf === "All" || r.type === tf)
          && activeListFilters.every(function (lf) { return rf[lf.field] === "All" || r[lf.field + "List"].indexOf(rf[lf.field]) !== -1; })
          && r.name.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      }

      /* KPIs reflect the same entities the table below is actually showing — period AND every
         active filter (search/type/relation) — not just the period, so a filtered view never shows
         summary numbers for a wider set than what's on screen. Same treatment as the Policy
         Register's KPI row. */
      var kpiRowWrap = ui.h("div", {});
      page.appendChild(kpiRowWrap);
      var finKpiWrap = ui.h("div", {});
      page.appendChild(finKpiWrap);
      function buildKpis(filteredRows) {
        kpiRowWrap.innerHTML = "";
        var filteredNames = new Set(filteredRows.map(function (r) { return r.name; }));
        var withField = policies.filter(function (p) { return filteredNames.has(p[opts.fieldName]); });
        var filteredPremium = filteredRows.reduce(function (s, r) { return s + r.premium; }, 0);
        var filterSuffix = (tf !== "All" || q || relationFiltersActive()) ? ", matching the current filters" : "";
        kpiRowWrap.appendChild(ui.kpiRow([
          { label: "Total " + opts.titleLower, value: filteredRows.length, tip: "Distinct " + opts.titleLower + " on the book" + filterSuffix + "." },
          { label: "Total policies", value: withField.length, tone: "blue", tip: "Every record placed through " + opts.article + " " + opts.singularLower + " on file" + filterSuffix + "." },
          { label: "In-force premium", value: PAS.moneyShort(filteredPremium), tone: "green", tip: "Sum of active premium across every " + opts.singularLower + filterSuffix + "." },
        ]));

        /* Full P&L for whatever is currently on screen — same on-risk, earned-basis
           PAS.bookFinancials the Dashboard and the Policy Register's own Financial performance
           section read from, so a broker/MGA/reinsurer's numbers here can never disagree with
           what the Dashboard's "Performance by segment" table shows for the same book. */
        finKpiWrap.innerHTML = "";
        if (!opts.showFinancials) return;
        var fAll = PAS.bookFinancials(PAS.onRiskPolicies(withField));
        if (fAll.policies === 0) {
          finKpiWrap.appendChild(ui.h("div", { class: "faint-note", style: { padding: "2px 0 14px" } }, "No on-risk " + opts.titleLower + " (Active, Cancelled, Expired, Non-renewed) in this filter."));
          return;
        }
        var finKpis = [
          { label: "Annual premium", value: PAS.moneyShort(fAll.writtenPremium), tone: "gray", tip: "Total written premium across on-risk " + opts.titleLower + filterSuffix + "." },
          { label: "Earned premium", value: PAS.moneyShort(fAll.earnedPremium), tone: "blue", tip: "Premium recognized for coverage actually provided so far." },
          { label: "Incurred claims", value: PAS.moneyShort(fAll.incurred), tone: "red", tip: "Paid claims plus reserves across " + fAll.claimCount + " claim" + (fAll.claimCount === 1 ? "" : "s") + "." },
          { label: "Loss ratio", value: pct(fAll.lossRatio), tone: lossTone(fAll.lossRatio), tip: "Incurred claims ÷ earned premium, across every " + opts.singularLower + "'s on-risk business — same earned basis as the dashboard." },
          { label: "Combined ratio", value: pct(fAll.combinedRatio), tone: combinedTone(fAll.combinedRatio), tip: "Loss ratio plus acquisition expense ratio. Below 100% indicates a carrier underwriting profit before other operating costs." },
          { label: "Net commission", value: PAS.moneyShort(fAll.netCommission), tone: "green", tip: "Veridex revenue after paying the broker's share — not the premium itself." },
        ];
        if (opts.showCommission) finKpis.push({ label: "Commission paid", value: PAS.moneyShort(fAll.brokerCommission), tone: "green", tip: "Total " + opts.singularLower + " share of commission earned across the whole book" + filterSuffix + "." });
        if (opts.showCession) {
          var netCededAll = fAll.earnedPremium - fAll.commission;
          finKpis.push({ label: "Net premium ceded", value: PAS.moneyShort(netCededAll), tone: "blue", tip: "Earned premium net of distribution commission — what actually crosses to these reinsurers' paper" + filterSuffix + "." });
          finKpis.push({
            label: "Underwriting result", value: (fAll.underwritingResult >= 0 ? "+" : "") + PAS.moneyShort(fAll.underwritingResult),
            tone: fAll.underwritingResult >= 0 ? "green" : "red",
            tip: "Earned premium minus incurred claims minus commission — what these reinsurers actually keep or lose" + filterSuffix + ".",
          });
        }
        finKpiWrap.appendChild(ui.kpiSection({
          label: "Financial performance",
          sub: "On-risk " + opts.titleLower + " only, earned basis" + filterSuffix,
        }, finKpis));
      }

      /* Two ranked-bar panels (Reinsurer page only) — same hbar component and layout the
         Dashboard's own "Premium by state/broker" panels use, so this reads as the same kind of
         chart a viewer has already seen elsewhere in the app, not a one-off. A claims-load callout
         sits below them, generic over whichever partner (if any) is actually out of proportion —
         nothing here names a specific reinsurer in code, it's computed from whichever rows are on
         screen. */
      var chartsWrap = ui.h("div", {});
      if (opts.showCession) page.appendChild(chartsWrap);
      function buildCharts(filteredRows) {
        if (!opts.showCession) return;
        chartsWrap.innerHTML = "";
        var withClaims = filteredRows.filter(function (r) { return typeof r.netPremiumCeded === "number"; });
        if (withClaims.length === 0) return;

        var cededBody = ui.h("div", {});
        var cededPanel = ui.panel({
          title: "Net premium ceded, by " + opts.singularLower,
          what: "Earned premium net of distribution commission — what actually crosses to each partner's paper.",
        }, [cededBody]);
        var byCeded = withClaims.slice().sort(function (a, b) { return b.netPremiumCeded - a.netPremiumCeded; });
        var maxCeded = Math.max.apply(null, byCeded.map(function (r) { return r.netPremiumCeded; }).concat([1]));
        byCeded.forEach(function (r) {
          cededBody.appendChild(ui.hbar({
            label: r.name, value: r.netPremiumCeded, max: maxCeded,
            note: PAS.moneyShort(r.netPremiumCeded) + " · " + (r.underwritingResult >= 0 ? "+" : "") + PAS.moneyShort(r.underwritingResult) + " result",
            tone: r.underwritingResult >= 0 ? "green" : "red",
            tip: r.name + ": " + PAS.money(r.netPremiumCeded) + " ceded, " + (r.underwritingResult >= 0 ? "a profit of " : "a loss of ") + PAS.money(Math.abs(r.underwritingResult)) + ".",
            onClick: function () { location.href = opts.href + "?" + opts.paramName + "=" + encodeURIComponent(r.name); },
          }));
        });

        var ratioBody = ui.h("div", {});
        var ratioPanel = ui.panel({
          title: "Combined ratio, by " + opts.singularLower,
          what: "Loss ratio + acquisition expense ratio. Above 100% means the partner is paying out more than it collects.",
        }, [ratioBody]);
        var byRatio = withClaims.slice().sort(function (a, b) { return b.combinedRatio - a.combinedRatio; });
        var maxRatio = Math.max.apply(null, byRatio.map(function (r) { return r.combinedRatio * 100; }).concat([100]));
        byRatio.forEach(function (r) {
          ratioBody.appendChild(ui.hbar({
            label: r.name, value: r.combinedRatio * 100, max: maxRatio,
            note: pct(r.combinedRatio) + (r.combinedRatio >= 1 ? " — underwriting loss" : " — underwriting profit"),
            tone: combinedTone(r.combinedRatio),
            tip: r.name + ": " + pct(r.combinedRatio) + " combined ratio.",
            onClick: function () { location.href = opts.href + "?" + opts.paramName + "=" + encodeURIComponent(r.name); },
          }));
        });

        var grid = ui.h("div", { class: "two-col-grid" });
        grid.appendChild(cededPanel);
        grid.appendChild(ratioPanel);
        chartsWrap.appendChild(grid);

        var flagged = withClaims.map(function (r) { return { r: r, idx: claimsLoadIndex(r) }; })
          .filter(function (x) { return x.idx != null && x.idx >= 1.3; })
          .sort(function (a, b) { return b.idx - a.idx; });
        if (flagged.length > 0) {
          chartsWrap.appendChild(ui.callout("bad", [
            ui.h("strong", {}, "Claims-load imbalance — review required: "),
            document.createTextNode(flagged.map(function (x) { return x.r.name + " (" + x.idx.toFixed(1) + "×)"; }).join(", ") +
              " — absorbing far more of the book's claims than " + (flagged.length === 1 ? "its" : "their") + " premium share would predict. A loss ratio alone won't show this."),
          ]));
        }
      }

      var columns = [
        { key: "name", label: ui_capitalize(opts.singularLower), locked: true, sortValue: function (r) { return r.name.toLowerCase(); }, cell: function (r) { return ui.cellName(r.name); } },
      ];
      if (opts.typeMap) columns.push({ key: "type", label: "Type", sortValue: function (r) { return r.type; }, cell: function (r) { return r.type ? ui.pill(r.type === "Individual" ? "blue" : r.type === "Direct" ? "gray" : "indigo", r.type) : "—"; } });
      columns.push(
        { key: "total", label: "Policies", what: "Every record with this " + opts.singularLower + ", any status.", sortValue: function (r) { return r.total; }, cell: function (r) { return String(r.total); } },
        { key: "active", label: "Active", what: "In force as of today.", sortValue: function (r) { return r.active; }, cell: function (r) { return String(r.active); } },
        { key: "premium", label: "In-force premium", what: "Sum of annual premium across this " + opts.singularLower + "'s active policies.", sortValue: function (r) { return r.premium; }, cell: function (r) { return PAS.money(r.premium); } },
        { key: "avgPremium", label: "Avg premium", what: "Mean annual premium per active policy — a quick read on book quality, independent of size.", sortValue: function (r) { return r.avgPremium; }, cell: function (r) { return PAS.money(r.avgPremium); } }
      );
      if (opts.showFinancials) {
        columns.push({ key: "lossRatio", label: "Loss ratio", what: "Incurred claims ÷ earned premium, on this " + opts.singularLower + "'s on-risk book — same earned basis as the dashboard.", sortValue: function (r) { return r.lossRatio; }, cell: function (r) { return ui.pill(lossTone(r.lossRatio), pct(r.lossRatio)); } });
        columns.push({ key: "claimsIncurred", label: "Claims incurred", what: "Total incurred claims (paid + reserved) across every policy this " + opts.singularLower + " placed — same on-risk basis as loss ratio.", sortValue: function (r) { return r.claimsIncurred; }, cell: function (r) { return r.claimCount ? PAS.money(r.claimsIncurred) : "—"; } });
        if (opts.showCommission) columns.push({ key: "commissionPaid", label: "Commission paid", what: "This " + opts.singularLower + "'s actual revenue for placing the business — their share of gross commission earned.", sortValue: function (r) { return r.commissionPaid; }, cell: function (r) { return PAS.money(r.commissionPaid); } });
        if (opts.showCession) {
          columns.push(
            { key: "netPremiumCeded", label: "Net premium ceded", what: "Earned premium net of distribution commission — what actually crosses to this reinsurer's paper.", sortValue: function (r) { return r.netPremiumCeded; }, cell: function (r) { return PAS.money(r.netPremiumCeded); } },
            { key: "underwritingResult", label: "Underwriting result", what: "Earned premium minus incurred claims minus commission — this reinsurer's own dollar result, not just a ratio.", sortValue: function (r) { return r.underwritingResult; }, cell: function (r) { return ui.pill(r.underwritingResult >= 0 ? "green" : "red", (r.underwritingResult >= 0 ? "+" : "") + PAS.moneyShort(r.underwritingResult)); } },
            { key: "claimsLoad", label: "Claims load", what: "Share of the whole book's claim volume ÷ share of the whole book's written premium.", rule: "1.0× is proportionate. Well above it means this reinsurer absorbs more claims than its book size predicts — a loss ratio alone won't show that.", sortValue: function (r) { var idx = claimsLoadIndex(r); return idx == null ? -1 : idx; }, cell: function (r) { var idx = claimsLoadIndex(r); return idx == null ? "—" : ui.pill(loadTone(idx), idx.toFixed(1) + "×"); } }
          );
        }
      }
      columns.push(
        { key: "pending", label: "Pending requests", what: "Open cancellation, renewal, endorsement or reinstatement requests across this " + opts.singularLower + "'s policies.", sortValue: function (r) { return r.pending; }, cell: function (r) { return r.pending ? ui.pill("amber", String(r.pending)) : "—"; } },
        { key: "states", label: "States", what: "Distinct states this " + opts.singularLower + " has business in.", sortValue: function (r) { return r.states; }, cell: function (r) { return String(r.states); } }
      );
      var listDefaultVisible = (opts.typeMap ? ["type"] : []).concat(["total", "active", "premium", "pending"])
        .concat(opts.showFinancials ? ["lossRatio", "claimsIncurred"] : [])
        .concat(opts.showCommission ? ["commissionPaid"] : [])
        .concat(opts.showCession ? ["netPremiumCeded", "underwritingResult", "claimsLoad"] : []);

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
      /* One select per active relation filter (Product/State/Broker/MGA/Reinsurer), options built
         from the real distinct values across every policy currently in scope — not just the ones
         in the filtered rows, so choosing one filter never hides the options for another. */
      var relationSelects = activeListFilters.map(function (lf) {
        var values = ["All"].concat(Array.from(new Set(policies.map(function (p) { return p[lf.field]; }).filter(Boolean))).sort());
        var sel = ui.h("select", { class: "register-select", title: lf.label });
        values.forEach(function (v) { sel.appendChild(ui.h("option", { value: v }, v === "All" ? lf.allLabel : v)); });
        filters.appendChild(sel);
        return sel;
      });
      toolbar.appendChild(filters);

      buildKpis(rows.filter(matchRow));
      buildCharts(rows.filter(matchRow));
      var table = ui.sortableTable({
        storageKey: "pas." + opts.paramName + "s.columns.v1",
        pageSize: 25,
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
        noteEl.textContent = (tf !== "All" || q || relationFiltersActive()) ? "Showing " + filtered.length + " of " + rows.length + " " + opts.titleLower + "." : "";
        buildKpis(filtered);
        buildCharts(filtered);
        table.rebuild();
      }
      function onFilterChange() { table.resetPage(); refresh(); }
      searchInput.addEventListener("input", function () { q = searchInput.value; onFilterChange(); });
      if (typeSelect) typeSelect.addEventListener("change", function () { tf = typeSelect.value; onFilterChange(); });
      relationSelects.forEach(function (sel, i) {
        var field = activeListFilters[i].field;
        sel.addEventListener("change", function () { rf[field] = sel.value; onFilterChange(); });
      });
    }

    /* Scoped to this one entity's on-risk book. Neither a broker nor an MGA facility carries
       underwriting risk, so this isn't framed as their "profit" — loss ratio is the risk quality
       of the business placed through them, and combined ratio is what it costs the carrier to
       keep writing it. Commission paid (a broker's actual revenue) only applies where
       opts.showCommission is set — an MGA facility isn't the party that earns that commission. */
    function renderFinancials(wrap, name, mine) {
      wrap.innerHTML = "";
      var onRisk = PAS.onRiskPolicies(mine);
      var f = PAS.bookFinancials(onRisk);
      if (f.policies === 0) return;
      var bookWideF = PAS.bookFinancials(PAS.onRiskPolicies(scopedPolicies()));
      var bookAvg = bookWideF.lossRatio;

      wrap.appendChild(ui.h("div", { class: "kpi-section-head", style: { marginTop: "18px" } }, [
        ui.h("span", { class: "kpi-section-label" }, "Financial performance"),
        ui.h("span", { class: "kpi-section-sub" }, "On-risk business placed through this " + opts.singularLower + " — earned basis, as of today"),
      ]));
      var finKpis = [
        { label: "Annual premium", value: PAS.moneyShort(f.writtenPremium), tone: "gray", tip: "Total written premium placed through this " + opts.singularLower + "." },
        { label: "Earned premium", value: PAS.moneyShort(f.earnedPremium), tone: "blue", tip: "The portion of placed premium actually on risk to date." },
        { label: "Incurred claims", value: PAS.moneyShort(f.incurred), tone: "red", tip: f.claimCount + " claims, " + f.openClaimCount + " still open." },
        { label: "Loss ratio", value: pct(f.lossRatio), tone: lossTone(f.lossRatio), tip: "Incurred ÷ earned. Book average is " + pct(bookAvg) + "." },
      ];
      if (opts.showCommission) finKpis.push({ label: "Commission paid", value: PAS.moneyShort(f.brokerCommission), tone: "green", tip: "This " + opts.singularLower + "'s actual revenue for placing the business." });
      if (opts.showCession) {
        var netCeded = f.earnedPremium - f.commission;
        finKpis.push({ label: "Net premium ceded", value: PAS.moneyShort(netCeded), tone: "blue", tip: "Earned premium net of distribution commission — what actually crosses to this reinsurer's paper, not the gross written figure." });
      }
      finKpis.push(
        { label: "Combined ratio", value: pct(f.combinedRatio), tone: combinedTone(f.combinedRatio), tip: pct(f.lossRatio) + " loss ratio + " + pct(f.expenseRatio) + " acquisition cost." },
        { label: "Net commission", value: PAS.moneyShort(f.netCommission), tone: "green", tip: "Veridex revenue after paying the broker's share — not the premium itself." }
      );
      if (opts.showCession) {
        finKpis.push({
          label: "Underwriting result", value: (f.underwritingResult >= 0 ? "+" : "") + PAS.moneyShort(f.underwritingResult),
          tone: f.underwritingResult >= 0 ? "green" : "red",
          tip: "Earned premium minus incurred claims minus commission — the dollar result behind the combined ratio above.",
        });
      }
      wrap.appendChild(ui.kpiRow(finKpis, finKpis.length > 4));

      var cooler = f.lossRatio <= bookAvg;
      var diff = pct(Math.abs(f.lossRatio - bookAvg));
      wrap.appendChild(ui.callout(cooler ? "good" : "bad", [
        ui.h("strong", {}, name + " runs " + (cooler ? "cooler" : "hotter") + " than the book average. "),
        document.createTextNode(
          pct(f.lossRatio) + " loss ratio against a " + pct(bookAvg) + " portfolio average (" + diff + " " + (cooler ? "better" : "worse") + "), on " +
          PAS.money(f.earnedPremium) + " of earned premium across " + f.claimCount + " claim" + (f.claimCount === 1 ? "" : "s") + "."
        ),
      ]));

      /* Claims-load index: same "share of claims ÷ share of premium" comparison as the Reinsurer
         list page, but framed for one partner against the whole book — a loss ratio alone can look
         fine on a small book while that book is still absorbing a wildly disproportionate share of
         total claims handling, which is exactly the kind of imbalance worth a second callout for. */
      if (opts.showCession && bookWideF.claimCount && bookWideF.writtenPremium && f.writtenPremium) {
        var premShare = f.writtenPremium / bookWideF.writtenPremium;
        var claimShare = f.claimCount / bookWideF.claimCount;
        var loadIdx = premShare ? claimShare / premShare : null;
        if (loadIdx != null && f.claimCount > 0 && (loadIdx >= 1.3 || loadIdx <= 0.6)) {
          var heavy = loadIdx >= 1.3;
          wrap.appendChild(ui.callout(heavy ? "bad" : "good", [
            ui.h("strong", {}, name + " is carrying " + loadIdx.toFixed(1) + "× its fair share of claims. "),
            document.createTextNode(
              pct(premShare) + " of the book's written premium, but " + pct(claimShare) + " of its claim volume (" + f.claimCount + " of " + bookWideF.claimCount + " claims) — " +
              (heavy ? "worth an underwriting-quality review before placing more business here." : "this book runs lighter on claims than its size alone would predict.")
            ),
          ]));
        }
      }
    }

    function renderDetail(page, name) {
      var mine = scopedPolicies().filter(function (p) { return p[opts.fieldName] === name; });
      var type = opts.typeMap ? (opts.typeMap[name] || "") : "";

      page.appendChild(ui.backLink("All " + opts.titleLower, function () { location.href = opts.href; }));
      page.appendChild(ui.pageHeader({
        icon: opts.icon, tone: opts.tone, title: name,
        sub: (type ? type + " · " : "") + mine.length + " polic" + (mine.length === 1 ? "y" : "ies"),
        what: "Every policy placed through this " + opts.singularLower + ".", why: opts.why,
      }));

      var relationCols = RELATIONS.filter(function (r) { return r.field !== opts.fieldName; });
      var q = "", sf = "All", pf = "All", stf = "All";
      var products = ["All"].concat(Array.from(new Set(mine.map(function (p) { return p.product; }).filter(Boolean))).sort());
      var states = ["All"].concat(Array.from(new Set(mine.map(function (p) { return p.state; }).filter(Boolean))).sort());

      function match(p) {
        return (sf === "All" || PAS.statusBucket(p.status) === sf)
          && (pf === "All" || p.product === pf)
          && (stf === "All" || p.state === stf)
          && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      }

      /* KPIs (and, below, the financial performance section) reflect the same policies the table
         is actually showing — period AND the search/status/product/state filters — not just the
         period. Same treatment as the Policy Register's KPI row. */
      var kpiRowWrap = ui.h("div", {});
      page.appendChild(kpiRowWrap);
      function buildTopKpis(filteredMine) {
        kpiRowWrap.innerHTML = "";
        var active = filteredMine.filter(function (p) { return p.status === "Active"; });
        var premium = active.reduce(function (s, p) { return s + (p.premium || 0); }, 0);
        kpiRowWrap.appendChild(ui.kpiRow([
          { label: "Policies", value: filteredMine.length, tip: "Every record with this " + opts.singularLower + ", any status." },
          { label: "Active", value: active.length, tone: "green", tip: "In force as of today." },
          { label: "In-force premium", value: PAS.money(premium), tone: "green", tip: "Sum of annual premium across active policies." },
          { label: "Avg premium", value: PAS.money(active.length ? premium / active.length : 0), tip: "Mean annual premium per active policy." },
        ]));
      }

      var finWrap = ui.h("div", {});
      if (opts.showFinancials) page.appendChild(finWrap);
      function buildFinancials(filteredMine) { if (opts.showFinancials) renderFinancials(finWrap, name, filteredMine); }

      page.appendChild(ui.tipLabel({ text: "Policies (" + mine.length + ")", what: "Every record placed through " + name + ".", className: "label-11 block mb-9" }));

      var toolbar = ui.h("div", { class: "register-toolbar" });
      var searchWrap = ui.h("div", { class: "register-search" });
      searchWrap.appendChild(PAS.icon("search", { size: 14 }));
      var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search by insured name or policy number…", autocomplete: "off" });
      searchWrap.appendChild(searchInput);
      toolbar.appendChild(searchWrap);

      var filters = ui.h("div", { class: "register-filters" });
      var statusSelect = ui.h("select", { class: "register-select", title: "Status" });
      ["All"].concat(PAS.STATUS_BUCKETS).forEach(function (s) { statusSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All statuses" : PAS.bucketLabel(s))); });
      filters.appendChild(statusSelect);
      var productSelect = ui.h("select", { class: "register-select", title: "Product" });
      products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All products" : p)); });
      filters.appendChild(productSelect);
      var stateSelect = ui.h("select", { class: "register-select", title: "State" });
      states.forEach(function (s) { stateSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All states" : s)); });
      filters.appendChild(stateSelect);
      toolbar.appendChild(filters);

      buildTopKpis(mine.filter(match));
      buildFinancials(mine.filter(match));

      var columns = [
        { key: "record", label: "Record", locked: true, sortValue: function (p) { return p.id; }, cell: function (p) { return ui.cellId(p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (p) { return (p.holder || "").toLowerCase(); }, cell: function (p) { return ui.cellName(p.holder); } },
        { key: "product", label: "Product", sortValue: function (p) { return p.product || ""; }, cell: function (p) { return p.product; } },
        { key: "status", label: "Status", what: "Position in the lifecycle state machine.", sortValue: function (p) { return PAS.statusBucket(p.status); }, cell: function (p) { var b = PAS.statusBucket(p.status); return ui.pill(PAS.BUCKET_TONE[b], PAS.bucketLabel(b)); } },
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
        pageSize: 25,
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
        buildTopKpis(filtered);
        buildFinancials(filtered);
        table.rebuild();
      }
      function onFilterChange() { table.resetPage(); refresh(); }
      searchInput.addEventListener("input", function () { q = searchInput.value; onFilterChange(); });
      statusSelect.addEventListener("change", function () { sf = statusSelect.value; onFilterChange(); });
      productSelect.addEventListener("change", function () { pf = productSelect.value; onFilterChange(); });
      stateSelect.addEventListener("change", function () { stf = stateSelect.value; onFilterChange(); });
    }

    function ui_capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  };
})(window);
