/* Ported from RegistryPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var STATUS_BUCKETS = PAS.STATUS_BUCKETS, BUCKET_TONE = PAS.BUCKET_TONE, statusBucket = PAS.statusBucket;

  /* Same thresholds the Dashboard's own financial view and every Broker/MGA/Reinsurer record
     screen use, so a loss/combined ratio never reads "healthy" here and "hot" there for the same
     number. */
  function lossToneFor(ratio) { return ratio >= 0.85 ? "red" : ratio >= 0.6 ? "amber" : "green"; }
  function combinedToneFor(ratio) { return ratio >= 1 ? "red" : ratio >= 0.95 ? "amber" : "green"; }
  function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }

  function render() {
    var policies = PAS.getScopedPolicies();
    var params = new URLSearchParams(location.search);
    var statusParam = params.get("status");
    var products = ["All"].concat(Array.from(new Set(policies.map(function (p) { return p.product; }))).sort());
    var states = ["All"].concat(Array.from(new Set(policies.map(function (p) { return p.state; }))).sort());
    var productParam = params.get("product");
    var stateParam = params.get("state");
    var q = "", sf = (statusParam && STATUS_BUCKETS.indexOf(statusParam) !== -1) ? statusParam : "All",
        pf = (productParam && products.indexOf(productParam) !== -1) ? productParam : "All",
        stf = (stateParam && states.indexOf(stateParam) !== -1) ? stateParam : "All";

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "list-checks", tone: "indigo", title: "Policy Register", sub: "Every record in the book, in every lifecycle state",
      what: "Submissions and policies alike.", why: "The single source of truth each decision desk reads from.",
    }));

    /* Same Monthly/Quarterly/Yearly/All-history/Custom control as the Dashboard (PAS.ui.periodToggle
       — see store.js for the shared date math it's built on). Scopes by `submittedOn`, falling back
       to `effectiveDate` when it's missing — the same fallback policy-detail.js's own "Submitted"
       row already uses, since most of this seed book never had submittedOn recorded and would
       otherwise fall out of every real period, leaving only "All history" showing anything. */
    var pt = ui.periodToggle({ defaultPeriod: "all", onChange: function () { refresh(); } });
    page.appendChild(pt.el);
    function inPeriod(p) { return pt.period === "all" || pt.matches(p.submittedOn || p.effectiveDate); }

    var kpiRowWrap = ui.h("div", {});
    page.appendChild(kpiRowWrap);
    var finKpiWrap = ui.h("div", {});
    page.appendChild(finKpiWrap);
    /* KPIs reflect the same records the table below is actually showing — period AND every active
       filter (status/product/state/search) — not just the period, so a filtered view never shows
       summary numbers for a wider set than what's on screen. */
    function buildKpis(filteredPolicies) {
      kpiRowWrap.innerHTML = "";
      var filterSuffix = filtersActive() ? ", matching the current filters" : "";
      kpiRowWrap.appendChild(ui.kpiRow([
        { label: "Total records", value: filteredPolicies.length, tip: "Submissions plus policies, " + pt.noteText() + filterSuffix + "." },
        { label: "In force", value: filteredPolicies.filter(function (p) { return p.status === "Active"; }).length, tone: "green", tip: "Issued, not cancelled or expired." },
        { label: "Pre-issue", value: filteredPolicies.filter(function (p) { return ["Referred", "Bound"].indexOf(p.status) !== -1; }).length, tone: "amber", tip: "Submissions and bound-not-issued." },
        { label: "Closed", value: filteredPolicies.filter(function (p) { return ["Cancelled", "Expired", "Non-renewed", "Declined"].indexOf(p.status) !== -1; }).length, tip: "No longer on risk." },
      ]));

      /* Financial performance for whatever is currently on screen — the same on-risk, earned-basis
         PAS.bookFinancials every Broker/MGA/Reinsurer record screen and the Dashboard itself read
         from, so this can never quote a different loss ratio for the same records. Scoped to
         on-risk records only (Active, Cancelled, Expired, Non-renewed) — a Referred or Bound
         submission hasn't earned a rupee or could have had a claim yet, and including it would
         dilute every ratio with pure zeroes, same reasoning as the Dashboard's own financial view. */
      finKpiWrap.innerHTML = "";
      var onRisk = PAS.onRiskPolicies(filteredPolicies);
      var f = PAS.bookFinancials(onRisk);
      if (f.policies === 0) {
        finKpiWrap.appendChild(ui.h("div", { class: "faint-note", style: { padding: "2px 0 14px" } }, "No on-risk records (Active, Cancelled, Expired, Non-renewed) in this filter."));
        return;
      }
      finKpiWrap.appendChild(ui.kpiSection({
        label: "Financial performance",
        sub: pt.noteText() + filterSuffix + " — on-risk records only, earned basis",
      }, [
        { label: "Annual premium", value: PAS.moneyShort(f.writtenPremium), tone: "gray", tip: "Total written premium across on-risk records in this view." },
        { label: "Earned premium", value: PAS.moneyShort(f.earnedPremium), tone: "blue", tip: "Premium recognized for coverage actually provided so far." },
        { label: "Net commission", value: PAS.moneyShort(f.netCommission), tone: "green", tip: "Southlake revenue after paying the broker's share — not the premium itself." },
        { label: "Incurred claims", value: PAS.moneyShort(f.incurred), tone: "red", tip: "Paid claims plus reserves across " + f.claimCount + " claim" + (f.claimCount === 1 ? "" : "s") + "." },
        { label: "Loss ratio", value: pct(f.lossRatio), tone: lossToneFor(f.lossRatio), tip: "Incurred claims ÷ earned premium (not written) — the standard actuarial basis." },
        { label: "Combined ratio", value: pct(f.combinedRatio), tone: combinedToneFor(f.combinedRatio), tip: "Loss ratio plus acquisition expense ratio. Below 100% indicates a carrier underwriting profit before other operating costs." },
      ]));
    }

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
      statusSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All statuses" : PAS.bucketLabel(s)));
    });
    statusSelect.value = sf;
    filters.appendChild(statusSelect);

    var productSelect = ui.h("select", { class: "register-select", title: "Product" });
    products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All products" : p)); });
    productSelect.value = pf;
    filters.appendChild(productSelect);

    var stateSelect = ui.h("select", { class: "register-select", title: "State" });
    states.forEach(function (s) { stateSelect.appendChild(ui.h("option", { value: s }, s === "All" ? "All states" : s)); });
    stateSelect.value = stf;
    filters.appendChild(stateSelect);
    toolbar.appendChild(filters);

    function match(p) {
      return inPeriod(p)
        && (sf === "All" || statusBucket(p.status) === sf)
        && (pf === "All" || p.product === pf)
        && (stf === "All" || p.state === stf)
        && (p.holder.toLowerCase().indexOf(q.toLowerCase()) !== -1 || p.id.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    }
    function filtersActive() { return sf !== "All" || pf !== "All" || stf !== "All" || !!q; }

    /* `record` and `insured` are locked visible — without an identifying column the table would
       be useless to click into, so they're not offered in the Columns picker at all. */
    var registryTable = ui.sortableTable({
      storageKey: "pas.registry.columns.v1",
      defaultVisible: ["record", "insured", "product", "status", "premium", "term", "docs"],
      columns: [
        { key: "record", label: "Record", locked: true, sortValue: function (p) { return p.id; }, cell: function (p) { return ui.cellId(p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (p) { return (p.holder || "").toLowerCase(); }, cell: function (p) { return ui.cellName(p.holder); } },
        { key: "product", label: "Product", sortValue: function (p) { return p.product || ""; }, cell: function (p) { return p.product; } },
        { key: "status", label: "Status", what: "Position in the lifecycle state machine.", why: "Status decides which actions are legal on this record.", sortValue: function (p) { return statusBucket(p.status); }, cell: function (p) { var b = statusBucket(p.status); return ui.pill(BUCKET_TONE[b], PAS.bucketLabel(b)); } },
        { key: "premium", label: "Premium", what: "Annual written premium.", sortValue: function (p) { return p.premium || 0; }, cell: function (p) { return PAS.money(p.premium); } },
        { key: "term", label: "Term", what: "Effective and expiry dates of the current term.", sortValue: function (p) { return p.effectiveDate || ""; }, cell: function (p) { return PAS.fmtDate(p.effectiveDate) + " → " + PAS.fmtDate(p.expirationDate); } },
        { key: "docs", label: "Docs", what: "Generated document versions held.", sortValue: function (p) { return (p.documents && p.documents.length) || 0; }, cell: function (p) { var n = (p.documents && p.documents.length) || 0; return ui.pill(n ? "gray" : "amber", String(n)); } },
        { key: "broker", label: "Broker", sortValue: function (p) { return p.producer || ""; }, cell: function (p) { return p.producer || "—"; } },
        { key: "mga", label: "MGA", sortValue: function (p) { return p.mga || ""; }, cell: function (p) { return p.mga || "—"; } },
        { key: "carrier", label: "Reinsurer", sortValue: function (p) { return p.carrier || ""; }, cell: function (p) { return p.carrier || "—"; } },
        { key: "state", label: "State", sortValue: function (p) { return p.state || ""; }, cell: function (p) { return p.state || "—"; } },
        { key: "submitted", label: "Submitted", what: "When this record first entered the book.", sortValue: function (p) { return p.submittedOn || ""; }, cell: function (p) { return p.submittedOn ? PAS.fmtDate(p.submittedOn) : "—"; } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Open"); } },
      rows: function () { return policies.filter(match); },
      onRowClick: function (p) { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); },
      emptyText: "No matching records.",
      pageSize: 25,
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
        return [p.id, JSON.stringify(p.holder || ""), JSON.stringify(p.product || ""), PAS.statusLabel(p.status), p.premium, p.effectiveDate, p.expirationDate, JSON.stringify(p.state || "")].join(",");
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
      buildKpis(filtered);
      var extra = [];
      if (sf !== "All") extra.push(sf);
      if (pf !== "All") extra.push(pf);
      if (stf !== "All") extra.push(stf);
      if (q) extra.push("\"" + q + "\"");
      noteEl.textContent = "Showing " + filtered.length + " of " + policies.length + " records, " + pt.noteText() +
        (extra.length ? " — filtered by " + extra.join(", ") : "") + ".";
      registryTable.rebuild();
    }
    function onFilterChange() { registryTable.resetPage(); refresh(); }
    searchInput.addEventListener("input", function () { q = searchInput.value; onFilterChange(); });
    statusSelect.addEventListener("change", function () { sf = statusSelect.value; onFilterChange(); });
    productSelect.addEventListener("change", function () { pf = productSelect.value; onFilterChange(); });
    stateSelect.addEventListener("change", function () { stf = stateSelect.value; onFilterChange(); });
    refresh();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("registry", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
