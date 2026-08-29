/* Portfolio dashboard. Every figure is computed live from the seeded book for the selected
   period — nothing is hardcoded. Two audit fixes carried over from the previous version:
     - The old single "Awaiting decision" tile added pending.length + bound.length together —
       never + referred.length on top of that, since a referred submission already carries its
       own Pending Underwriting transaction inside `pending` (double-counting it). That combined
       tile is gone: it linked to Pending Approvals as if its number matched, but Pending
       Approvals only ever lists held *transactions* — a Bound policy has none, it auto-issues
       once nothing is left outstanding, so it could never appear there no matter what. Split
       into "Pending transactions" (pending.length, excluding Underwriting — those are decided
       from the Underwriting desk, not Pending Approvals — and its number is exactly what that
       linked page shows) and "Bound, awaiting issue" (bound.length, its own unlinked queue).
       A referred submission still shows up in the status funnel's own "Referred" figure further
       down the page.
     - No fabricated trend numbers. This prototype has no period-bucketed snapshots, only ledger
       transaction dates — so every period-scoped figure below is a real count of transactions
       whose own `date` falls in the selected month or year, not an invented delta.
   Monthly defaults to the current calendar month (matches PAS.todayISO()); Yearly to the current
   calendar year. Total policies, Active policies, Pending transactions and Bound-awaiting-issue
   are snapshot metrics — the book has no history of "active as of a past month" to show, so they
   stay constant across the
   toggle and say so in their tooltip, rather than fake a period-scoped number. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function sum(list, fn) { return list.reduce(function (s, x) { return s + fn(x); }, 0); }
  function txnsOfType(policies, type, status) {
    var out = [];
    policies.forEach(function (p) { p.history.forEach(function (h) { if (h.type === type && h.status === status) out.push({ p: p, h: h }); }); });
    return out;
  }
  function inMonth(dateStr, ym) { return !!dateStr && dateStr.slice(0, 7) === ym; }
  function inYear(dateStr, y) { return !!dateStr && dateStr.slice(0, 4) === String(y); }
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* Trailing N month keys ("YYYY-MM"), oldest first, ending at the given month offset from today
     (0 = current month, -1 = last month, ...). Built off a real Date object (not string math) so
     a window that crosses a year boundary rolls correctly. */
  function trailingMonths(n, endOffset) {
    var off = endOffset || 0;
    var today = new Date(PAS.todayISO() + "T00:00:00Z");
    var y = today.getUTCFullYear(), m = today.getUTCMonth() + off;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(y, m - i, 1));
      out.push(d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"));
    }
    return out;
  }
  function monthKeyOffset(offset) { return trailingMonths(1, offset)[0]; }
  function trailingYears(n, endOffset) {
    var curY = Number(PAS.todayISO().slice(0, 4)) + (endOffset || 0);
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(curY - i);
    return out;
  }
  function yearOffset(offset) { return Number(PAS.todayISO().slice(0, 4)) + (offset || 0); }

  /* Quarter keys are "YYYY-Qn". Built off the real UTC month, same reasoning as trailingMonths —
     a window that crosses a year boundary (Q4 -> Q1) has to roll the year too. */
  function quarterKeyOf(y, monthIdx0) { return y + "-Q" + (Math.floor(monthIdx0 / 3) + 1); }
  function inQuarter(dateStr, qKey) {
    if (!dateStr) return false;
    var d = new Date(dateStr + "T00:00:00Z");
    return quarterKeyOf(d.getUTCFullYear(), d.getUTCMonth()) === qKey;
  }
  /* Quarter index arithmetic (year*4 + quarter0) so offsets roll cleanly across year boundaries
     in both directions, including negative modulo when stepping back past Q1. */
  function quarterIndexOffset(offset) {
    var today = new Date(PAS.todayISO() + "T00:00:00Z");
    return today.getUTCFullYear() * 4 + Math.floor(today.getUTCMonth() / 3) + (offset || 0);
  }
  function quarterKeyOffset(offset) {
    var idx = quarterIndexOffset(offset);
    var y = Math.floor(idx / 4), q = ((idx % 4) + 4) % 4;
    return y + "-Q" + (q + 1);
  }
  function trailingQuarters(n, endOffset) {
    var qIndex = quarterIndexOffset(endOffset);
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var idx = qIndex - i, y = Math.floor(idx / 4), q = ((idx % 4) + 4) % 4;
      out.push(y + "-Q" + (q + 1));
    }
    return out;
  }

  var TREND_SERIES = [
    { type: "Renewal", label: "Renewed", tone: "blue" },
    { type: "Cancellation", label: "Cancelled", tone: "red" },
    { type: "Reinstatement", label: "Reinstated", tone: "green" },
  ];
  var ISSUANCE_SERIES = [
    { type: "Issuance", label: "New business issued", tone: "indigo" },
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  /* Line/area trend graph — shared by the full operational dashboard and the scoped MGA/Broker
     dashboard, both period-toggled (month / quarter / year / custom range) — both just hand it
     pre-bucketed rows and a label function, so the SVG drawing itself only has to exist once.
     Mark spec: 2px line, round join/cap; >=8px (r=4)
     markers with a surface-color ring; a soft ~10% area wash under the line; hairline recessive
     gridlines. Every point carries a native hover tooltip; only the most recent point gets a
     permanent value label, per "never a number on every point". */
  function drawTrendGraph(container, seriesList, data, periodLabelFn, noteText) {
    var maxVal = Math.max.apply(null, data.reduce(function (acc, row) { seriesList.forEach(function (s) { acc.push(row[s.type]); }); return acc; }, [1]));
    var niceMax = Math.max(1, maxVal);
    var n = data.length;

    container.innerHTML = "";
    container.appendChild(ui.h("div", { class: "faint-note", style: { marginBottom: "10px" } }, noteText));

    var W = 640, H = 172, padL = 12, padR = 44, padT = 20, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function xAt(i) { return n > 1 ? padL + (i / (n - 1)) * plotW : padL + plotW / 2; }
    function yAt(v) { return padT + plotH - (v / niceMax) * plotH; }

    /* Height tracks width via CSS aspect-ratio (not a fixed pixel height) so the line stays at
       its designed proportions in any container — a full-width panel (the scoped Broker/MGA
       dashboard has no second column to share with) no longer stretches the same 172px tall into
       a much wider box than the chart was drawn for. */
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", class: "trend-graph", style: "width:100%;aspect-ratio:" + W + "/" + H + ";" });

    [0, 1].forEach(function (frac) {
      var y = padT + plotH * frac;
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "trend-grid-line" }));
    });

    data.forEach(function (row, i) {
      svg.appendChild(Object.assign(svgEl("text", { x: xAt(i), y: H - 8, "text-anchor": "middle", class: "trend-axis-label-svg" }), { textContent: periodLabelFn(row.key) }));
    });

    seriesList.forEach(function (s) {
      var pts = data.map(function (row, i) { return [xAt(i), yAt(row[s.type])]; });
      var lineD = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");

      var areaD = lineD + " L" + pts[n - 1][0].toFixed(1) + "," + (padT + plotH).toFixed(1) + " L" + pts[0][0].toFixed(1) + "," + (padT + plotH).toFixed(1) + " Z";
      svg.appendChild(svgEl("path", { d: areaD, class: "trend-area", style: "fill: var(--" + s.tone + ")" }));
      svg.appendChild(svgEl("path", { d: lineD, class: "trend-line", style: "stroke: var(--" + s.tone + ")" }));

      pts.forEach(function (p, i) {
        var v = data[i][s.type];
        var dot = svgEl("circle", { cx: p[0], cy: p[1], r: 4, class: "trend-dot", style: "fill: var(--" + s.tone + ")" });
        dot.appendChild(Object.assign(svgEl("title"), { textContent: s.label + " — " + periodLabelFn(data[i].key) + ": " + v }));
        svg.appendChild(dot);
        if (i === n - 1) {
          svg.appendChild(Object.assign(svgEl("text", { x: p[0] + 8, y: p[1] + 3.5, class: "trend-val-label" }), { textContent: String(v) }));
        }
      });
    });

    container.appendChild(svg);
  }
  function monthKeyLabel(key) { return MONTH_NAMES[Number(key.slice(5, 7)) - 1] + " '" + key.slice(2, 4); }

  /* The dashboard is the one screen every role lands on. Full-access roles (Super Admin, Admin)
     get the operational view below unchanged; any role scoped to less than the whole book (MGA,
     Broker, or a future custom role) gets the shared scoped analytics view instead
     (renderScopedDashboard) — same layout for every scoped role, real data per role's own book. */
  function renderUnderwriterDashboard(page, allPolicies) {
    var period = "month"; /* default: current month, per the toggle's spec */
    /* How many periods back from today the selected month/quarter/year is — 0 = current,
       -1 = last, -2 = two back, etc. Navigated with the ◀/▶ arrows next to the toggle; reset to
       0 whenever the period *type* changes, since an offset from one type doesn't mean anything
       in another. Custom range is a separate control (see rangeRow below), not a fifth offset. */
    var periodOffset = 0;
    /* Custom range defaults to the trailing 30 days so switching into it isn't an empty page. */
    var customFrom = PAS.addDays(PAS.todayISO(), -30);
    var customTo = PAS.todayISO();

    /* Multi-select filters: an empty array means "All" (no restriction) — same convention the
       button label in ui.multiSelect uses, so an untouched filter and an explicitly-cleared one
       look and behave identically. Product doubles as this app's line-of-business dimension —
       there's no separate lineOfBusiness field, the MGA/Carrier dashboard's own "LOB" panels
       already group by `product` directly. Broker/MGA/Carrier are three genuinely independent
       policy attributes (who placed it, which wholesale facility bound it, whose paper it's
       written on) — replacing the old single "touched by" User filter, which mixed together
       every transaction actor regardless of role. */
    var lobFilter = [], stateFilter = [], brokerFilter = [], mgaFilter = [], carrierFilter = [];
    var lobOptions = Array.from(new Set(allPolicies.map(function (p) { return p.product; }))).sort();
    var stateOptions = Array.from(new Set(allPolicies.map(function (p) { return p.state; }).filter(Boolean))).sort();
    /* Broker and MGA options carry their type (Individual vs Organization — "Direct" isn't a
       producer at all, so it gets no type suffix) alongside the plain name, so the filter panel
       shows which kind of entity each one is. `value` stays the plain name so matching against
       `p.producer`/`p.mga` (both plain strings) needs no other changes. */
    function typedLabel(name, typeMap) {
      var t = typeMap[name];
      return (t && t !== "Direct") ? name + " (" + t + ")" : name;
    }
    var brokerOptions = Array.from(new Set(allPolicies.map(function (p) { return p.producer; }).filter(Boolean))).sort()
      .map(function (name) { return { value: name, label: typedLabel(name, PAS.BROKER_TYPE) }; });
    var mgaOptions = Array.from(new Set(allPolicies.map(function (p) { return p.mga; }).filter(Boolean))).sort()
      .map(function (name) { return { value: name, label: typedLabel(name, PAS.MGA_TYPE) }; });
    var carrierOptions = Array.from(new Set(allPolicies.map(function (p) { return p.carrier; }).filter(Boolean))).sort();

    function matchesMulti(selected, value) { return selected.length === 0 || selected.indexOf(value) !== -1; }
    function filterNote() {
      var parts = [];
      if (lobFilter.length) parts.push(lobFilter.join("/"));
      if (stateFilter.length) parts.push(stateFilter.join("/"));
      if (brokerFilter.length) parts.push("broker " + brokerFilter.join("/"));
      if (mgaFilter.length) parts.push("MGA " + mgaFilter.join("/"));
      if (carrierFilter.length) parts.push("carrier " + carrierFilter.join("/"));
      return parts.length ? " (" + parts.join("; ") + ")" : "";
    }
    /* Every filter here — product, state, broker, MGA, carrier — is a real attribute already on
       the policy record, so scoping is a plain field match, no transaction-history walk needed. */
    function scopedPolicies() {
      return allPolicies.filter(function (p) {
        return matchesMulti(lobFilter, p.product) && matchesMulti(stateFilter, p.state)
          && matchesMulti(brokerFilter, p.producer) && matchesMulti(mgaFilter, p.mga) && matchesMulti(carrierFilter, p.carrier);
      });
    }
    /* Single source of truth for "is this ledger date inside the selected period" — used by the
       KPI cards and both trend charts so they can never disagree. */
    function periodMatches(dateStr) {
      if (period === "month") return inMonth(dateStr, monthKeyOffset(periodOffset));
      if (period === "quarter") return inQuarter(dateStr, quarterKeyOffset(periodOffset));
      if (period === "year") return inYear(dateStr, yearOffset(periodOffset));
      return !!dateStr && dateStr >= customFrom && dateStr <= customTo; /* custom range, inclusive */
    }
    function periodNoteText() {
      if (period === "month") { var mk = monthKeyOffset(periodOffset); return "in " + MONTH_NAMES[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4); }
      if (period === "quarter") return "in " + quarterKeyOffset(periodOffset);
      if (period === "year") return "in " + yearOffset(periodOffset);
      return "from " + customFrom + " to " + customTo;
    }

    page.appendChild(ui.pageHeader({
      icon: "layout-dashboard", tone: "indigo", title: "Portfolio Dashboard",
      sub: "Live position of the book, filtered by period, line of business, state and user",
      what: "Portfolio KPIs computed live from the book for the selected period and scope.", why: "A PAS is judged on what it tells you to do next.",
    }));

    /* One wrapping row, every filter a same-shaped group (label above control) — the pattern
       already used by the register/workbench filter bars, so the dashboard doesn't invent its
       own layout. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    page.appendChild(filterBlock);

    var lobGroup = ui.h("div", {});
    lobGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Line of business"));
    lobGroup.appendChild(ui.multiSelect({ options: lobOptions, selected: lobFilter, allLabel: "All lines", onChange: function (sel) { lobFilter = sel; buildAll(); } }));
    filterBlock.appendChild(lobGroup);

    var stateGroup = ui.h("div", {});
    stateGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "State"));
    stateGroup.appendChild(ui.multiSelect({ options: stateOptions, selected: stateFilter, allLabel: "All states", onChange: function (sel) { stateFilter = sel; buildAll(); } }));
    filterBlock.appendChild(stateGroup);

    var brokerGroup = ui.h("div", {});
    brokerGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Broker"));
    brokerGroup.appendChild(ui.multiSelect({ options: brokerOptions, selected: brokerFilter, allLabel: "All brokers", onChange: function (sel) { brokerFilter = sel; buildAll(); } }));
    filterBlock.appendChild(brokerGroup);

    var mgaGroup = ui.h("div", {});
    mgaGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "MGA"));
    mgaGroup.appendChild(ui.multiSelect({ options: mgaOptions, selected: mgaFilter, allLabel: "All MGAs", onChange: function (sel) { mgaFilter = sel; buildAll(); } }));
    filterBlock.appendChild(mgaGroup);

    var carrierGroup = ui.h("div", {});
    carrierGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Reinsurer"));
    carrierGroup.appendChild(ui.multiSelect({ options: carrierOptions, selected: carrierFilter, allLabel: "All reinsurers", onChange: function (sel) { carrierFilter = sel; buildAll(); } }));
    filterBlock.appendChild(carrierGroup);

    var toggleRow = ui.h("div", { class: "period-toggle-row" });
    toggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Portfolio KPIs"));
    var toggleAndNav = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } });
    var toggle = ui.h("div", { class: "period-toggle" });
    toggleAndNav.appendChild(toggle);
    /* ◀ current-period-label ▶ — steps periodOffset back/forward one unit of whatever period is
       selected (a month, a quarter, a year). Forward is disabled at offset 0: this book has no
       data past today, so "next" would only ever land on an empty period. Hidden entirely in
       custom-range mode, where the date pair below is the only control. */
    var navWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    var prevBtn = ui.h("button", { class: "btn ghost-link", title: "Previous period" }, "◀");
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = ui.h("button", { class: "btn ghost-link", title: "Next period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    prevBtn.addEventListener("click", function () { periodOffset -= 1; buildAll(); });
    nextBtn.addEventListener("click", function () { if (periodOffset < 0) { periodOffset += 1; buildAll(); } });
    page.appendChild(toggleRow);

    /* Custom range is a deliberately separate control, not a fifth chip in the toggle above —
       switching it on replaces the Monthly/Quarterly/Yearly selection entirely rather than
       sitting alongside it as another option of the same kind. */
    var customToggleRow = ui.h("div", { class: "period-toggle-row" });
    customToggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Or a custom range"));
    var customBtn = ui.h("button", { class: "chip" }, "Custom range");
    customToggleRow.appendChild(customBtn);
    customBtn.addEventListener("click", function () { period = period === "custom" ? "month" : "custom"; periodOffset = 0; buildAll(); });
    page.appendChild(customToggleRow);

    /* Only visible when period === "custom" — a plain date pair, inclusive on both ends. */
    var rangeRow = ui.h("div", { class: "period-toggle-row" });
    rangeRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Date range"));
    var rangeWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    var fromInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customFrom });
    var toInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customTo });
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--color-muted)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    page.appendChild(rangeRow);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; buildAll(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; buildAll(); });

    /* ================= financial performance =================
       This sits above the operational counts deliberately. Someone running this business opens
       the dashboard to find out whether it is making money; "how many endorsements are pending"
       is a real question but it is the second one, not the first. Every figure below comes from
       PAS.bookFinancials, so the KPI row, the waterfall and the segment table are structurally
       incapable of quoting different numbers for the same thing. */
    var finKpiContainer = ui.h("div", {});
    page.appendChild(finKpiContainer);
    var finVerdictWrap = ui.h("div", {});
    page.appendChild(finVerdictWrap);

    var finGrid = ui.h("div", { class: "two-col-grid" });
    var waterfallPanel = ui.panel({
      title: "Where the premium went",
      what: "Earned premium, less incurred claims, less the commission paid to place the business — what is left is the underwriting result.",
      why: "A ratio tells you the shape of the problem; this tells you the size of it in actual money.",
    }, []);
    var waterfallBody = waterfallPanel.querySelector(".panel-body");
    finGrid.appendChild(waterfallPanel);
    var revenuePanel = ui.panel({
      title: "Revenue — what Veridex actually earns",
      what: "Veridex is an MGA: the premium belongs to the insurer whose paper the risk is written on. Veridex earns commission for placing and servicing it, and passes the larger share of that to the producing broker.",
      why: "Reporting premium as revenue would overstate what this business earns by roughly seven times.",
    }, []);
    var revenueBody = revenuePanel.querySelector(".panel-body");
    finGrid.appendChild(revenuePanel);
    page.appendChild(finGrid);

    /* The panel that answers "which is loss, where profit" directly. Ranked worst-first by
       combined ratio, because the loss-making segments are the ones anyone actually needs to act
       on — a table sorted alphabetically buries them. */
    var SEGMENT_DIMS = [
      { key: "product", label: "Line of business" },
      { key: "state", label: "State" },
      { key: "producer", label: "Broker" },
      { key: "carrier", label: "Reinsurer" },
    ];
    var segmentDim = "product";
    var segmentPanel = ui.panel({
      title: "Profit & loss by segment",
      what: "Every segment's earned premium, incurred claims, loss ratio, expense ratio and combined ratio, worst combined ratio first.",
      why: "Combined ratio under 100% means the segment made an underwriting profit; over 100% means it lost money. This is the table that answers which business to write more of and which to fix or drop.",
      right: (function () {
        var chipRow = ui.h("div", { class: "chip-row" });
        SEGMENT_DIMS.forEach(function (d) {
          var chip = ui.h("button", { class: "chip" + (segmentDim === d.key ? " active" : ""), type: "button" }, d.label);
          chip.addEventListener("click", function () { segmentDim = d.key; buildFinancials(); });
          chipRow.appendChild(chip);
        });
        return chipRow;
      })(),
      pad: 0,
    }, []);
    var segmentBody = segmentPanel.querySelector(".panel-body");
    page.appendChild(segmentPanel);

    page.appendChild(ui.h("div", { class: "kpi-section-head", style: { marginTop: "26px" } }, [
      ui.h("span", { class: "kpi-section-label" }, "Operations"),
      ui.h("span", { class: "kpi-section-sub" }, "Volume and workload — what is moving through the desks"),
    ]));

    var kpiContainer = ui.h("div", {});
    page.appendChild(kpiContainer);

    var chartGrid = ui.h("div", { class: "two-col-grid" });
    var chartPanel = ui.panel({ title: "Renewal, cancellation & reinstatement activity", what: "Completed transactions per period, same three series as the KPI cards above.", why: "A count alone doesn't show whether it's rising or falling — the trend does." }, []);
    var chartBody = chartPanel.querySelector(".panel-body");
    chartGrid.appendChild(chartPanel);
    var issuancePanel = ui.panel({ title: "New business issued", what: "Policies formally issued per period.", why: "The activity chart on the left covers what happens to existing business — this is what's coming in behind it." }, []);
    var issuanceBody = issuancePanel.querySelector(".panel-body");
    chartGrid.appendChild(issuancePanel);
    page.appendChild(chartGrid);

    function renderToggle() {
      toggle.innerHTML = "";
      [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"]].forEach(function (opt) {
        var btn = ui.h("button", { class: "chip" + (period === opt[0] ? " active" : "") }, opt[1]);
        btn.addEventListener("click", function () { if (period !== opt[0]) { period = opt[0]; periodOffset = 0; buildAll(); } });
        toggle.appendChild(btn);
      });
      customBtn.className = "chip" + (period === "custom" ? " active" : "");
      navWrap.style.display = period === "custom" ? "none" : "flex";
      rangeRow.style.display = period === "custom" ? "" : "none";
      if (period !== "custom") {
        navLabel.textContent = periodNoteText().replace(/^in /, "");
        nextBtn.disabled = periodOffset >= 0;
      }
    }

    function buildKpis() {
      var policies = scopedPolicies();
      var active = policies.filter(function (p) { return p.status === "Active"; });
      var bound = policies.filter(function (p) { return p.status === "Bound"; });
      var pending = PAS.allTxns(policies).map(function (t) { return t.h; }).filter(function (h) { return h.status === "Pending" && h.type !== "Underwriting"; });

      function countTxns(type, status) {
        return txnsOfType(policies, type, status).filter(function (x) {
          return periodMatches(x.h.date);
        }).length;
      }
      var renewed = countTxns("Renewal", "Completed");
      var cancelled = countTxns("Cancellation", "Completed");
      var reinstated = countTxns("Reinstatement", "Completed");
      var expiring = active.filter(function (p) { return periodMatches(p.expirationDate); }).length;
      var periodNote = periodNoteText();
      /* Not period-scoped, same reasoning as Pending transactions below — it's the live count of
         requests sitting in the Endorsement desk's queue right now, not a completed-this-period
         figure. */
      var endorsementPending = PAS.pendingOf(policies, "Endorsement").length;

      kpiContainer.innerHTML = "";
      kpiContainer.appendChild(ui.kpiRow([
        { label: "Total policies", value: policies.length, href: "registry.html", tip: "Every record in the register" + filterNote() + ".", why: "Portfolio size — not period-scoped, the book has no past-state snapshots to filter this against." },
        { label: "Active policies", value: active.length, tone: "green", href: "registry.html?status=Active", tip: "In force as of today.", why: "A snapshot count, same reason as Total policies." },
        { label: "Renewed", value: renewed, tone: "blue", href: "renewal.html", tip: "Renewals completed " + periodNote + "." },
        { label: "Expiring soon", value: expiring, tone: expiring > 0 ? "amber" : "gray", href: "renewal.html", tip: "Active policies whose term ends " + periodNote + "." },
        { label: "Endorsement requests", value: endorsementPending, tone: endorsementPending > 0 ? "amber" : "gray", href: "endorsement.html", tip: "Endorsement requests awaiting decision, right now.", why: "Operational queue, not period-scoped — same reasoning as Pending transactions." },
        { label: "Reinstated", value: reinstated, tone: reinstated > 0 ? "green" : "gray", href: "reinstatement.html", tip: "Reinstatements completed " + periodNote + "." },
        { label: "Cancelled", value: cancelled, tone: cancelled > 0 ? "red" : "gray", href: "cancellation.html", tip: "Cancellations completed " + periodNote + "." },
        { label: "Pending transactions", value: pending.length, tone: "red", href: "approvals.html", tip: "Held transactions of every type except Underwriting, exactly what Pending Approvals lists.", why: "Operational queue, not period-scoped: it's what needs action right now, regardless of which period you're viewing." },
        { label: "Bound, awaiting issue", value: bound.length, tone: bound.length > 0 ? "amber" : "gray", tip: "Bound policies with nothing left to review — they issue automatically once no subjectivity remains outstanding, not from a manual decision here.", why: "A different queue from Pending transactions: nobody decides these, the system auto-issues once nothing is blocking." },
      ], true));
    }

    /* Shared period-bucketing: both the left chart and the right graph read the same trailing
       window and the same real ledger dates, so they can never disagree with each other or with
       the KPI cards above. */
    function bucketData(seriesList) {
      var policies = scopedPolicies();
      var keys = period === "month" ? trailingMonths(6, periodOffset) : period === "quarter" ? trailingQuarters(6, periodOffset)
        : period === "year" ? trailingYears(4, periodOffset) : ["custom"]; /* one bucket: the selected range itself */
      var matches = period === "month" ? inMonth : period === "quarter" ? inQuarter
        : period === "year" ? inYear : function (dateStr) { return periodMatches(dateStr); };
      return keys.map(function (key) {
        var row = { key: key };
        seriesList.forEach(function (s) {
          row[s.type] = txnsOfType(policies, s.type, "Completed").filter(function (x) {
            return matches(x.h.date, key);
          }).length;
        });
        return row;
      });
    }
    function periodLabel(key) {
      if (period === "month") return MONTH_NAMES[Number(key.slice(5, 7)) - 1] + " '" + key.slice(2, 4);
      if (period === "quarter") return "Q" + key.slice(6) + " '" + key.slice(2, 4);
      if (period === "year") return key;
      return customFrom + " – " + customTo;
    }
    function windowNote() {
      if (period === "month") return "Trailing 6 months, completed transactions by their effective date.";
      if (period === "quarter") return "Trailing 6 quarters, completed transactions by their effective date.";
      if (period === "year") return "Trailing 4 years, completed transactions by their effective date.";
      return "From " + customFrom + " to " + customTo + ", completed transactions by their effective date.";
    }

    /* Left panel — a bar chart, for comparing the three series against each other within the same
       period. Direct-labeled (every bar carries its value): with only 3 short series and a small
       count range, a full value label is legible and more useful here than sparse endpoint-only
       labels would be. Always carries a legend — this app's red/green tone pair fails CVD
       separation, so identity never rests on color alone. */
    function renderTrendChart(container, seriesList) {
      var data = bucketData(seriesList);
      var maxVal = Math.max.apply(null, data.reduce(function (acc, row) { seriesList.forEach(function (s) { acc.push(row[s.type]); }); return acc; }, [1]));

      container.innerHTML = "";
      container.appendChild(ui.h("div", { class: "faint-note", style: { marginBottom: "10px" } }, windowNote()));

      var chart = ui.h("div", { class: "trend-bar-chart" });
      data.forEach(function (row) {
        var cluster = ui.h("div", { class: "trend-cluster" });
        var bars = ui.h("div", { class: "trend-bars" });
        seriesList.forEach(function (s) {
          var v = row[s.type];
          var pct = maxVal ? Math.max(v > 0 ? 4 : 0, (v / maxVal) * 100) : 0;
          var col = ui.h("div", { class: "trend-bar-col", title: s.label + ": " + v });
          if (v > 0) col.appendChild(ui.h("span", { class: "trend-bar-val" }, String(v)));
          col.appendChild(ui.h("div", { class: "trend-bar-fill", style: { height: pct + "%", background: "var(--" + s.tone + ")" } }));
          bars.appendChild(col);
        });
        cluster.appendChild(bars);
        cluster.appendChild(ui.h("div", { class: "trend-axis-label" }, periodLabel(row.key)));
        chart.appendChild(cluster);
      });
      container.appendChild(chart);

      var legend = ui.h("div", { class: "trend-legend" });
      seriesList.forEach(function (s) {
        var item = ui.h("div", { class: "trend-legend-item" });
        item.appendChild(ui.h("span", { class: "trend-legend-swatch", style: { background: "var(--" + s.tone + ")" } }));
        item.appendChild(document.createTextNode(s.label));
        legend.appendChild(item);
      });
      container.appendChild(legend);
    }

    /* Right panel — an actual line/area graph, for reading one series' trend rather than comparing
       several — a single series needs no legend box, the panel title names it. Drawing itself
       lives in the module-level `drawTrendGraph`, shared with the scoped MGA/Broker dashboard's
       own issuance graph. */
    function renderTrendGraph(container, seriesList) {
      drawTrendGraph(container, seriesList, bucketData(seriesList), periodLabel, windowNote());
    }

    function buildChart() {
      renderTrendChart(chartBody, TREND_SERIES);
      renderTrendGraph(issuanceBody, ISSUANCE_SERIES);
    }

    function openLink(href, text) {
      var a = ui.h("button", { class: "btn ghost-link" }, text + " →");
      a.addEventListener("click", function () { location.href = href; });
      return a;
    }

    /* ---------- snapshot panels: skeletons built once, bodies rebuilt whenever a filter changes.
       Not period-scoped, same reasoning as the KPI header comment. ---------- */
    var twoCol = ui.h("div", { class: "two-col-grid" });
    var prodPanel = ui.panel({ title: "Written premium by product", what: "In-force premium per product line, largest first.", why: "Concentration in one line is a portfolio risk an underwriting manager watches." }, []);
    var prodBody = prodPanel.querySelector(".panel-body");
    twoCol.appendChild(prodPanel);
    var compPanel = ui.panel({ title: "Policy composition", what: "Every record by lifecycle status.", why: "Bound-not-issued and cancelled are the two counts that signal operational drag." }, []);
    var compBody = compPanel.querySelector(".panel-body");
    twoCol.appendChild(compPanel);
    page.appendChild(twoCol);

    /* Claims & loss ratio: the panel this dashboard didn't have before (MOM 2026-08-26) — real
       claim records (PAS.CLAIMS_BY_ID), not an asserted number, broken out by product and state so
       "which is loss, where profit" is a chart read, not a spreadsheet exercise. Loss ratio =
       incurred claims ÷ earned premium, the standard industry figure underwriting appetite and
       renewal-pricing decisions actually turn on. */
    var claimsGrid = ui.h("div", { class: "two-col-grid" });
    var lossByProductPanel = ui.panel({ title: "Loss ratio by product", what: "Incurred claims ÷ earned premium, per product line, across all on-risk business.", why: "Which lines are profitable and which are running hot — the number underwriting appetite decisions actually turn on." }, []);
    var lossByProductBody = lossByProductPanel.querySelector(".panel-body");
    claimsGrid.appendChild(lossByProductPanel);
    var lossByStatePanel = ui.panel({ title: "Loss ratio by state", what: "Incurred claims ÷ earned premium, per state with claim activity, top 8 worst.", why: "Geographic concentration of loss, separate from geographic concentration of premium." }, []);
    var lossByStateBody = lossByStatePanel.querySelector(".panel-body");
    claimsGrid.appendChild(lossByStatePanel);
    page.appendChild(claimsGrid);

    var claimsCalloutWrap = ui.h("div", {});
    page.appendChild(claimsCalloutWrap);

    var claimsDetailPanel = ui.panel({ title: "Claims detail", what: "Every claim on file, filtered the same as everything else on this dashboard.", why: "The line-item data behind the loss ratio above — open exposure and closed cost, not just a summary number.", pad: 0 }, []);
    var claimsDetailBody = claimsDetailPanel.querySelector(".panel-body");
    page.appendChild(claimsDetailPanel);

    /* Rankings on the left, work queues on the right — side by side so both are readable
       without scrolling one past the other. Appended to the page here so the pair lands in the
       same position the old six cards occupied. */
    var summaryGrid = ui.h("div", { class: "two-col-grid" });
    page.appendChild(summaryGrid);

    /* ---- Top performers: one panel, switchable dimension ----
       This was three fixed side-by-side cards (brokers / MGAs / insurers). One panel with a
       dropdown asks the same ranking question of any dimension, and makes room for Underwriters —
       which has no directory page of its own, so under the old layout it could never have had a
       card without inventing one. The row cap rises from 3 to 5 now that the panel has the full
       page width rather than a third of it. */
    var TOP_ENTITY_ROWS = 5;
    var TOP_DIMS = [
      { key: "producer", label: "Top brokers", note: "Premium in force per broker, largest first — which producers the book actually depends on.", href: "brokers.html" },
      { key: "mga", label: "Top MGAs", note: "Premium in force per MGA facility, largest first — which wholesale facilities carry the most bound risk.", href: "mgas.html" },
      { key: "carrier", label: "Top Insurers", note: "Premium in force per insurer, largest first — concentration on one insurer's paper is a placement risk.", href: "carriers.html" },
      /* Read from each policy's own completed underwriting decision (PAS.underwriterOf), not from
         `producer` — the broker who introduced the risk and the underwriter who accepted it are
         different parties, and conflating them is exactly what the MOM asked us to stop doing. */
      { key: "underwriter", label: "Top underwriters", note: "Premium in force per underwriter, read from each policy's own completed underwriting decision — who holds the authority on this book, not who introduced it.", href: null },
    ];
    var topDim = TOP_DIMS[0].key;
    var topSelect = ui.h("select", { class: "register-select", title: "Rank by", "aria-label": "Rank top performers by" });
    TOP_DIMS.forEach(function (d) { topSelect.appendChild(ui.h("option", { value: d.key }, d.label)); });
    var topLinkWrap = ui.h("span", {});
    var topRight = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    topRight.appendChild(topSelect);
    topRight.appendChild(topLinkWrap);
    var topPanel = ui.panel({
      title: "Top performers",
      what: "Ranked by premium in force. Switch the dimension with the dropdown.",
      why: "Concentration is the risk this panel exists to surface — whichever party the book leans on hardest is the one whose loss would hurt most.",
      right: topRight,
    }, []);
    var topBody = topPanel.querySelector(".panel-body");
    summaryGrid.appendChild(topPanel);
    topSelect.addEventListener("change", function () { topDim = topSelect.value; buildTopEntities(); });

    /* ---- Open work queues: one panel, switchable queue ----
       Same consolidation, and the same gain: Reinstatement had no card before (there were only
       three columns) even though it is a real desk with real pending requests. Each queue stays
       capped and sorted by what makes it most actionable, so the cap drops the least urgent
       items, never the most. */
    var QUEUE_ROWS = 5;
    var QUEUES = [
      { key: "renewal", label: "Renewal pipeline", href: "renewal.html", note: "In-force policies by closeness to expiry, " + QUEUE_ROWS + " most urgent. Notices must be served " + PAS.RENEWAL_LEAD_DAYS + " days ahead." },
      { key: "cancellation", label: "Cancelled policy requests", href: "cancellation.html", note: "Open cancellation requests awaiting decision, top " + QUEUE_ROWS + " by refund amount — the biggest refund exposure still undecided." },
      { key: "reinstatement", label: "Reinstatement requests", href: "reinstatement.html", note: "Open reinstatement requests, soonest to fall outside the " + PAS.REINSTATEMENT_WINDOW_DAYS + "-day window first — eligibility expires, so these are time-critical." },
      { key: "endorsement", label: "Endorsement requests", href: "endorsement.html", note: "Open endorsement requests that increase premium, top " + QUEUE_ROWS + " by increase." },
    ];
    var queueKey = QUEUES[0].key;
    var queueSelect = ui.h("select", { class: "register-select", title: "Queue", "aria-label": "Choose work queue" });
    QUEUES.forEach(function (q) { queueSelect.appendChild(ui.h("option", { value: q.key }, q.label)); });
    var queueLinkWrap = ui.h("span", {});
    var queueRight = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    queueRight.appendChild(queueSelect);
    queueRight.appendChild(queueLinkWrap);
    var queuePanel = ui.panel({
      title: "Open work queues",
      what: "Requests and pipelines awaiting action, one desk at a time. Switch desks with the dropdown.",
      why: "Every one of these is work that stops if nobody picks it up — they belong together, not scattered across the page.",
      right: queueRight,
    }, []);
    var queueBody = queuePanel.querySelector(".panel-body");
    summaryGrid.appendChild(queuePanel);
    queueSelect.addEventListener("change", function () { queueKey = queueSelect.value; buildQueues(); });

    function buildSnapshotPanels() {
      var policies = scopedPolicies();
      var active = policies.filter(function (p) { return p.status === "Active"; });
      var bound = policies.filter(function (p) { return p.status === "Bound"; });
      var cancelled = policies.filter(function (p) { return p.status === "Cancelled"; });
      var referred = policies.filter(function (p) { return p.status === "Referred"; });

      var products = Array.from(new Set(policies.map(function (p) { return p.product; })));
      var byProduct = products.map(function (pr) {
        return {
          pr: pr,
          v: sum(policies.filter(function (p) { return p.product === pr && p.status === "Active"; }), function (p) { return p.premium; }),
          n: policies.filter(function (p) { return p.product === pr; }).length,
        };
      }).sort(function (a, b) { return b.v - a.v; });
      var maxP = Math.max.apply(null, byProduct.map(function (x) { return x.v; }).concat([1]));
      prodBody.innerHTML = "";
      byProduct.forEach(function (x) { prodBody.appendChild(ui.hbar({ label: x.pr, value: x.v, max: maxP, note: PAS.moneyShort(x.v) + " · " + x.n + " pol", tone: x.v === maxP ? "indigo" : "blue", onClick: function () { location.href = "registry.html?product=" + encodeURIComponent(x.pr); } })); });

      compBody.innerHTML = "";
      /* Every one of the seven real statuses a policy can carry, not just the five most common —
         the donut's arcs are sized against `total`, so leaving any status out understates every
         slice by however many records the missing status holds. */
      var declined = policies.filter(function (p) { return p.status === "Declined"; });
      var nonRenewed = policies.filter(function (p) { return p.status === "Non-renewed"; });
      compBody.appendChild(ui.donut({
        total: policies.length, centerValue: policies.length, centerLabel: "records", segments: [
          { label: "Active", value: active.length, tone: "green" },
          { label: "Bound", value: bound.length, tone: "amber" },
          { label: "Referred", value: referred.length, tone: "violet" },
          { label: "Cancelled", value: cancelled.length, tone: "red" },
          { label: "Expired", value: policies.filter(function (p) { return p.status === "Expired"; }).length, tone: "gray" },
          { label: "Declined", value: declined.length, tone: "blue" },
          { label: "Non-renewed", value: nonRenewed.length, tone: "indigo" },
        ],
      }));

    }

    /* All four desk queues, one at a time. Each is its own small builder so the queue picker
       only ever has to choose between them — adding a fifth desk later means adding one entry
       to QUEUES and one builder here, not another column to a grid that has run out of room. */
    function buildQueues() {
      var policies = scopedPolicies();
      var active = policies.filter(function (p) { return p.status === "Active"; });
      var spec = QUEUES.filter(function (q) { return q.key === queueKey; })[0] || QUEUES[0];

      queueSelect.value = spec.key;
      queueLinkWrap.innerHTML = "";
      queueLinkWrap.appendChild(openLink(spec.href, "Open"));
      queueBody.innerHTML = "";
      queueBody.appendChild(ui.h("div", { class: "faint-note mb-9" }, spec.note));

      /* Every queue renders the same way: a ranked bar list, then a "showing N of M" note and a
         View more link when the real list is longer than the cap. */
      function renderQueue(rows, emptyText, moreText) {
        if (rows.length === 0) { queueBody.appendChild(ui.h("div", { class: "faint-note" }, emptyText)); return; }
        rows.slice(0, QUEUE_ROWS).forEach(function (r) { queueBody.appendChild(ui.hbar(r)); });
        if (rows.length > QUEUE_ROWS) {
          queueBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing " + QUEUE_ROWS + " of " + rows.length + " " + moreText + "."));
          queueBody.appendChild(openLink(spec.href, "View more"));
        }
      }

      if (spec.key === "renewal") {
        var renewalSorted = active.slice().sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });
        renderQueue(renewalSorted.map(function (p) {
          var rc = PAS.renewalCompliance(p);
          return { label: p.holder, value: Math.max(0, 365 - rc.daysToExpiry), max: 365, note: rc.daysToExpiry + "d left", tone: rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red" };
        }), "No in-force policies approaching expiry.", "in force, closest to expiry first");

      } else if (spec.key === "cancellation") {
        /* Ranked by refund amount — biggest exposure first. Same live quote (reason +
           initiatedBy + effective date -> cancelQuote) the Cancellation desk itself shows for
           these same rows, so the two screens can never disagree. */
        var pendingCx = PAS.pendingOf(policies, "Cancellation").map(function (t) {
          var meta = t.h.meta || {};
          var reason = meta.reason || "Insured Request";
          var initiatedBy = meta.initiatedBy || "Insured";
          var effDate = t.h.date || PAS.todayISO();
          return { p: t.p, reason: reason, refund: Math.round(PAS.cancelQuote(t.p, reason, initiatedBy, effDate).refund) };
        }).sort(function (a, b) { return b.refund - a.refund; });
        var maxRefund = Math.max.apply(null, pendingCx.map(function (x) { return x.refund; }).concat([1]));
        renderQueue(pendingCx.map(function (x) {
          return { label: x.p.holder, value: x.refund, max: maxRefund, note: PAS.money(x.refund) + " · " + x.reason, tone: x.refund === maxRefund ? "red" : "amber" };
        }), "No open cancellation requests.", "open requests");

      } else if (spec.key === "reinstatement") {
        /* Sorted by days already elapsed since cancellation, longest first: eligibility expires
           at REINSTATEMENT_WINDOW_DAYS, so the oldest request is the one about to run out of
           time. Ineligible ones (fraud, or past the window) still show, flagged — they need a
           decline rather than being quietly hidden from the desk. */
        var pendingRe = PAS.pendingOf(policies, "Reinstatement").map(function (t) {
          return { p: t.p, el: PAS.reinstatementEligibility(t.p) };
        }).filter(function (x) { return x.el; }).sort(function (a, b) { return b.el.daysSince - a.el.daysSince; });
        renderQueue(pendingRe.map(function (x) {
          var left = PAS.REINSTATEMENT_WINDOW_DAYS - x.el.daysSince;
          return {
            label: x.p.holder,
            value: Math.max(0, Math.min(PAS.REINSTATEMENT_WINDOW_DAYS, x.el.daysSince)),
            max: PAS.REINSTATEMENT_WINDOW_DAYS,
            note: x.el.fraud ? "Fraud · barred" : (x.el.eligible ? left + "d left to decide" : "Window closed"),
            tone: x.el.eligible ? (left <= 10 ? "amber" : "green") : "red",
          };
        }), "No open reinstatement requests.", "open requests");

      } else {
        /* Only real premium INCREASES: a decrease or a no-impact change (a plain address update)
           is not what this queue is for. */
        var pendingEn = PAS.pendingOf(policies, "Endorsement").map(function (t) {
          return { p: t.p, impact: Math.round((t.h.meta && t.h.meta.premiumImpact) || 0) };
        }).filter(function (x) { return x.impact > 0; }).sort(function (a, b) { return b.impact - a.impact; });
        var maxImpact = Math.max.apply(null, pendingEn.map(function (x) { return x.impact; }).concat([1]));
        renderQueue(pendingEn.map(function (x) {
          return { label: x.p.holder, value: x.impact, max: maxImpact, note: "+" + PAS.money(x.impact), tone: x.impact === maxImpact ? "red" : "amber" };
        }), "No open endorsement requests increasing premium.", "open requests increasing premium");
      }
    }

    function lossToneFor(ratio) { return ratio >= 0.85 ? "red" : ratio >= 0.6 ? "amber" : "green"; }
    /* 100% is the break-even line for a combined ratio, so it is the only threshold that carries
       real meaning here — 97% and 103% are a different business, 60% and 80% are not. */
    function combinedToneFor(ratio) { return ratio >= 1 ? "red" : ratio >= 0.95 ? "amber" : "green"; }
    function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }

    function buildFinancials() {
      /* Financial views run over on-risk business only — see PAS.onRiskPolicies. Cancelled and
         expired policies stay IN (they earned premium and had claims); referred, declined and
         not-yet-incepted business stays out. */
      var onRisk = PAS.onRiskPolicies(scopedPolicies());
      var f = PAS.bookFinancials(onRisk);

      finKpiContainer.innerHTML = "";
      finKpiContainer.appendChild(ui.kpiSection({
        label: "Financial performance",
        sub: "On-risk business" + filterNote() + " — earned basis, as of today",
      }, [
        {
          /* Deliberately NOT labelled "Gross written premium". GWP conventionally means premium
             written within a stated period; this is the annual premium across every policy that
             has been on risk, which is a different quantity. An audit finding on this dashboard
             was specifically about a mislabelled GWP figure, so the label says exactly what the
             number is and the tooltip spells out the basis. */
          label: "Written premium", value: PAS.moneyShort(f.writtenPremium), tone: "gray",
          tip: "Annual premium across all " + f.policies + " on-risk policies" + filterNote() + " — not a period figure.",
          why: "Volume placed, not income. The premium belongs to the insurer whose paper the risk sits on, not to Veridex.",
        },
        {
          label: "Earned premium", value: PAS.moneyShort(f.earnedPremium), tone: "blue",
          tip: "The portion of that premium the insurer has actually been on risk for, " + pct(f.earnedPremium / (f.writtenPremium || 1)) + " of written.",
          why: "Every ratio below divides by this, not by written premium. A policy bound last week has its full annual premium written but has earned almost none of it — dividing claims by written premium would halve the apparent loss ratio.",
        },
        {
          label: "Commission revenue", value: PAS.moneyShort(f.netCommission), tone: "green",
          tip: PAS.money(f.commission) + " gross commission earned, less " + PAS.money(f.brokerCommission) + " passed to producing brokers.",
          why: "This is Veridex's actual revenue line — what it keeps after the broker's share. Business written Direct has no broker share, so it retains all of its commission.",
        },
        {
          label: "Incurred claims", value: PAS.moneyShort(f.incurred), tone: "red",
          tip: PAS.money(f.paid) + " paid plus " + PAS.money(f.reserved) + " reserved, across " + f.claimCount + " claims (" + f.openClaimCount + " still open).",
          why: "Incurred, not paid — an open claim's reserve is money already committed, and leaving it out would understate the cost of the business.",
        },
        {
          label: "Loss ratio", value: pct(f.lossRatio), tone: lossToneFor(f.lossRatio),
          tip: PAS.money(f.incurred) + " incurred ÷ " + PAS.money(f.earnedPremium) + " earned.",
          why: "The core measure of whether the risk was priced correctly. Paid-only would read " + pct(f.paidLossRatio) + "; the gap between the two is open reserves.",
        },
        {
          label: "Combined ratio", value: pct(f.combinedRatio), tone: combinedToneFor(f.combinedRatio),
          tip: pct(f.lossRatio) + " loss ratio + " + pct(f.expenseRatio) + " expense ratio.",
          why: "The industry's profitability test: under 100% the book makes an underwriting profit, over 100% it loses money. Expense here is acquisition commission only — the insurer's own overhead is not in this system, so the true combined ratio is higher than this figure.",
        },
      ]));

      /* A plain-language verdict, because a business owner should not have to remember which
         side of 100% is the good side. */
      finVerdictWrap.innerHTML = "";
      var profitable = f.combinedRatio < 1;
      var margin = Math.abs(1 - f.combinedRatio);
      finVerdictWrap.appendChild(ui.callout(profitable ? "good" : "bad", [
        ui.h("strong", {}, profitable ? "This book is making an underwriting profit. " : "This book is losing money on underwriting. "),
        document.createTextNode(
          "Combined ratio " + pct(f.combinedRatio) + " — " + pct(margin) + (profitable ? " below" : " above") +
          " break-even, an underwriting " + (profitable ? "profit" : "loss") + " of " + PAS.money(Math.abs(f.underwritingResult)) +
          " on " + PAS.money(f.earnedPremium) + " of earned premium. Acquisition commission is the only expense included, so the real margin is thinner than this."
        ),
      ]));

      /* Waterfall: earned premium is the bar everything else is measured against, so each
         component is drawn to the same scale rather than each to its own maximum. */
      waterfallBody.innerHTML = "";
      var scale = f.earnedPremium || 1;
      [
        { label: "Earned premium", value: f.earnedPremium, tone: "blue", note: PAS.money(f.earnedPremium) },
        { label: "Less: incurred claims", value: f.incurred, tone: "red", note: "− " + PAS.money(f.incurred) + " · " + pct(f.lossRatio) },
        { label: "Less: acquisition commission", value: f.commission, tone: "amber", note: "− " + PAS.money(f.commission) + " · " + pct(f.expenseRatio) },
        { label: "= Underwriting result", value: Math.abs(f.underwritingResult), tone: f.underwritingResult >= 0 ? "green" : "red", note: (f.underwritingResult >= 0 ? "" : "− ") + PAS.money(Math.abs(f.underwritingResult)) + " · " + pct(Math.abs(1 - f.combinedRatio)) },
      ].forEach(function (row) {
        waterfallBody.appendChild(ui.hbar({ label: row.label, value: row.value, max: scale, note: row.note, tone: row.tone }));
      });

      revenueBody.innerHTML = "";
      revenueBody.appendChild(ui.kv({
        k: "Gross commission earned", v: PAS.money(f.commission),
        what: "Earned on the same accrual basis as the premium — commission is recognised as the premium earns, not banked in full at inception.",
        why: "Rates run " + Math.round(PAS.COMMISSION_RATES["Group Health"] * 100) + "–" + Math.round(PAS.COMMISSION_RATES["Term Life"] * 100) + "% depending on the line.",
      }));
      revenueBody.appendChild(ui.kv({
        k: "Less: broker commission", v: "− " + PAS.money(f.brokerCommission),
        what: "The producing broker's share, " + Math.round(PAS.BROKER_COMMISSION_SHARE * 100) + "% of commission on brokered business.",
        why: "Business written Direct has no broker to pay, so it keeps all of its commission — which is why Direct is materially more profitable per premium dollar.",
      }));
      revenueBody.appendChild(ui.kv({
        k: "Net revenue to Veridex", v: PAS.money(f.netCommission),
        what: "What this business actually earns the MGA.",
        why: "Against " + PAS.money(f.writtenPremium) + " of premium placed — roughly " + pct(f.netCommission / (f.writtenPremium || 1)) + " of the volume it handles.",
      }));
      revenueBody.appendChild(ui.kv({
        k: "Unearned premium", v: PAS.money(f.unearnedPremium),
        what: "Written but not yet earned — the insurer is still on risk for it, and it would be refundable on a pro-rata cancellation today.",
        why: "This is the part of written premium that has not become revenue yet, and the reason written premium overstates performance.",
      }));

      /* ---- profit & loss by segment ---- */
      var dimLabel = SEGMENT_DIMS.filter(function (d) { return d.key === segmentDim; })[0].label;
      segmentPanel.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("active", c.textContent === dimLabel);
      });

      var keys = Array.from(new Set(onRisk.map(function (p) { return p[segmentDim]; }).filter(Boolean)));
      var segments = keys.map(function (k) {
        var seg = onRisk.filter(function (p) { return p[segmentDim] === k; });
        var sf = PAS.bookFinancials(seg);
        return { k: k, f: sf, n: seg.length };
      }).filter(function (s) { return s.f.earnedPremium > 0; })
        .sort(function (a, b) { return b.f.combinedRatio - a.f.combinedRatio; });

      segmentBody.innerHTML = "";
      if (segments.length === 0) {
        segmentBody.appendChild(ui.h("div", { class: "faint-note", style: { padding: "14px 15px" } }, "No on-risk business in this filter."));
        return;
      }
      var losing = segments.filter(function (s) { return s.f.combinedRatio >= 1; });
      segmentBody.appendChild(ui.h("div", { class: "faint-note", style: { padding: "13px 15px 0" } },
        losing.length === 0
          ? "Every " + dimLabel.toLowerCase() + " in this filter is running at an underwriting profit."
          : losing.length + " of " + segments.length + " " + dimLabel.toLowerCase() + " segments are running at a combined ratio of 100% or worse — listed first."));

      segmentBody.appendChild(ui.dataTable({
        columns: [
          dimLabel,
          { label: "Policies", what: "On-risk policies in this segment." },
          { label: "Earned premium", what: "The exposure base every ratio in this row divides by." },
          { label: "Incurred", what: "Paid plus reserved claims." },
          { label: "Loss ratio", what: "Incurred ÷ earned premium." },
          { label: "Expense ratio", what: "Acquisition commission ÷ earned premium." },
          { label: "Combined", what: "Loss ratio + expense ratio.", rule: "Under 100% is an underwriting profit; 100% or over is a loss." },
          { label: "U/W result", what: "Earned premium less claims less commission — the money answer." },
        ],
        rows: segments.map(function (s) {
          return [
            s.k,
            s.n,
            PAS.moneyShort(s.f.earnedPremium),
            PAS.moneyShort(s.f.incurred),
            ui.pill(lossToneFor(s.f.lossRatio), pct(s.f.lossRatio)),
            pct(s.f.expenseRatio),
            ui.pill(combinedToneFor(s.f.combinedRatio), pct(s.f.combinedRatio)),
            (s.f.underwritingResult >= 0 ? "" : "− ") + PAS.moneyShort(Math.abs(s.f.underwritingResult)),
          ];
        }),
        wrapCells: true,
      }));
    }

    function buildClaims() {
      var policies = scopedPolicies();
      /* On-risk, not Active-only. Measuring loss ratio across surviving policies alone is
         survivorship bias: the business that went bad is precisely the business that got
         cancelled, so excluding it reports the survivors' loss ratio and labels it the book's.
         Earned premium (not written) is the denominator, matching PAS.bookFinancials exactly. */
      var onRisk = PAS.onRiskPolicies(policies);
      var claims = PAS.allClaims(onRisk);

      function byField(field) {
        var keys = Array.from(new Set(onRisk.map(function (p) { return p[field]; }).filter(Boolean)));
        return keys.map(function (k) {
          var forKey = onRisk.filter(function (p) { return p[field] === k; });
          var sf = PAS.bookFinancials(forKey);
          return { k: k, premium: sf.earnedPremium, incurred: sf.incurred, ratio: sf.lossRatio, claimN: sf.claimCount };
        });
      }

      var byProduct = byField("product").sort(function (a, b) { return b.ratio - a.ratio; });
      lossByProductBody.innerHTML = "";
      if (byProduct.length === 0) lossByProductBody.appendChild(ui.h("div", { class: "faint-note" }, "No on-risk business in this filter."));
      else {
        var maxProductRatio = Math.max.apply(null, byProduct.map(function (x) { return x.ratio * 100; }).concat([100]));
        byProduct.forEach(function (x) {
          var pct = Math.round(x.ratio * 1000) / 10;
          lossByProductBody.appendChild(ui.hbar({
            label: x.k, value: pct, max: maxProductRatio, note: pct + "% · " + PAS.moneyShort(x.incurred) + " incurred", tone: lossToneFor(x.ratio),
            onClick: function () { location.href = "registry.html?product=" + encodeURIComponent(x.k); },
          }));
        });
      }

      var byState = byField("state").filter(function (x) { return x.incurred > 0; }).sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 8);
      lossByStateBody.innerHTML = "";
      if (byState.length === 0) lossByStateBody.appendChild(ui.h("div", { class: "faint-note" }, "No claims on file in this filter."));
      else {
        var maxStateRatio = Math.max.apply(null, byState.map(function (x) { return x.ratio * 100; }).concat([100]));
        byState.forEach(function (x) {
          var pct = Math.round(x.ratio * 1000) / 10;
          lossByStateBody.appendChild(ui.hbar({ label: x.k, value: pct, max: maxStateRatio, note: pct + "% · " + x.claimN + " claim" + (x.claimN === 1 ? "" : "s"), tone: lossToneFor(x.ratio) }));
        });
      }

      claimsCalloutWrap.innerHTML = "";
      var lossSegments = byProduct.filter(function (x) { return x.ratio >= 0.85 && x.incurred > 0; });
      if (lossSegments.length > 0) {
        claimsCalloutWrap.appendChild(ui.callout("bad", [
          ui.h("strong", {}, "Running at a loss: "),
          document.createTextNode(lossSegments.map(function (x) { return x.k + " (" + Math.round(x.ratio * 100) + "%)"; }).join(", ") + " — incurred claims are at or above 85% of premium in this filter."),
        ]));
      } else if (byProduct.some(function (x) { return x.incurred > 0; })) {
        claimsCalloutWrap.appendChild(ui.callout("good", [
          ui.h("strong", {}, "No line is running at a loss "),
          document.createTextNode("in this filter — every product's incurred claims stay under 85% of its premium."),
        ]));
      }

      var sortedClaims = claims.slice().sort(function (a, b) { return b.c.incurred - a.c.incurred; });
      claimsDetailBody.innerHTML = "";
      if (sortedClaims.length === 0) {
        claimsDetailBody.appendChild(ui.h("div", { class: "faint-note", style: { padding: "14px 15px" } }, "No claims on file in this filter."));
      } else {
        var totalIncurred = sortedClaims.reduce(function (s, x) { return s + x.c.incurred; }, 0);
        var cf = PAS.bookFinancials(onRisk);
        var summary = ui.h("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap", padding: "13px 15px 4px" } });
        summary.appendChild(ui.kv({ k: "Claims (this filter)", v: sortedClaims.length, what: sortedClaims.filter(function (x) { return x.c.status === "Open"; }).length + " open, " + sortedClaims.filter(function (x) { return x.c.status === "Closed"; }).length + " closed." }));
        summary.appendChild(ui.kv({ k: "Total incurred", v: PAS.money(totalIncurred), what: "Paid plus reserved, across every claim in this filter." }));
        summary.appendChild(ui.kv({ k: "Open reserves", v: PAS.money(cf.reserved), what: "Held against open claims, this filter." }));
        summary.appendChild(ui.kv({ k: "Loss ratio", v: pct(cf.lossRatio), what: PAS.money(cf.incurred) + " incurred ÷ " + PAS.money(cf.earnedPremium) + " earned premium, this filter.", why: "Earned, not written — see the Financial performance row at the top of this page." }));
        claimsDetailBody.appendChild(summary);
        var claimsTable = ui.sortableTable({
          storageKey: "pas.dashboard.claims.columns.v1",
          pageSize: 10,
          wrapCells: true,
          columns: [
            { key: "policy", label: "Policy", locked: true, sortValue: function (x) { return x.p.id; }, cell: function (x) { return ui.cellId(x.p.id); } },
            { key: "product", label: "Product", sortValue: function (x) { return x.p.product; }, cell: function (x) { return x.p.product; } },
            { key: "state", label: "State", sortValue: function (x) { return x.p.state; }, cell: function (x) { return x.p.state; } },
            { key: "type", label: "Type", what: "Peril / claim cause.", sortValue: function (x) { return x.c.type; }, cell: function (x) { return x.c.type; } },
            { key: "status", label: "Status", what: "Open claims still carry a reserve; closed claims are fully paid.", sortValue: function (x) { return x.c.status; }, cell: function (x) { return ui.pill(x.c.status === "Open" ? "amber" : "green", x.c.status); } },
            { key: "incurred", label: "Incurred", what: "Paid plus reserved — the total cost estimate.", sortValue: function (x) { return x.c.incurred; }, cell: function (x) { return PAS.money(x.c.incurred); } },
            { key: "reserved", label: "Reserved", sortValue: function (x) { return x.c.reserved || 0; }, cell: function (x) { return x.c.reserved ? PAS.money(x.c.reserved) : "—"; } },
          ],
          rows: function () { return sortedClaims; },
          onRowClick: function (x) { location.href = "policy-detail.html?policy=" + encodeURIComponent(x.p.id); },
          emptyText: "No claims on file in this filter.",
        });
        claimsDetailBody.appendChild(claimsTable.tableWrap);
      }
    }

    /* Expand/collapse state is kept per dimension, outside buildTopEntities, so switching from
       Brokers to MGAs and back does not silently reset what you had expanded — and so a filter
       change or period switch does not either. */
    var topExpanded = {};
    TOP_DIMS.forEach(function (d) { topExpanded[d.key] = false; });

    /* `accessor` rather than a plain field name, because Underwriter is not a property on the
       policy — it has to be read out of the ledger (PAS.underwriterOf). Everything else about the
       ranking is identical, so the difference stays confined to one function argument. */
    function valueOf(p, dim) { return dim === "underwriter" ? PAS.underwriterOf(p) : p[dim]; }

    function buildTopEntities() {
      var list = scopedPolicies();
      var spec = TOP_DIMS.filter(function (d) { return d.key === topDim; })[0] || TOP_DIMS[0];
      topSelect.value = spec.key;

      topLinkWrap.innerHTML = "";
      /* Underwriters have no directory page to open — no link rather than a dead one. */
      if (spec.href) topLinkWrap.appendChild(openLink(spec.href, "Open"));

      var keys = Array.from(new Set(list.map(function (p) { return valueOf(p, spec.key); }).filter(Boolean)));
      var rows = keys.map(function (k) {
        var mine = list.filter(function (p) { return valueOf(p, spec.key) === k; });
        return {
          k: k,
          v: sum(mine.filter(function (p) { return p.status === "Active"; }), function (p) { return p.premium; }),
          n: mine.length,
        };
      }).sort(function (a, b) { return b.v - a.v; });

      topBody.innerHTML = "";
      topBody.appendChild(ui.h("div", { class: "faint-note mb-9" }, spec.note));
      if (rows.length === 0) { topBody.appendChild(ui.h("div", { class: "faint-note" }, "No records in this filter.")); return; }

      var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
      var expanded = topExpanded[spec.key];
      (expanded ? rows : rows.slice(0, TOP_ENTITY_ROWS)).forEach(function (r) {
        topBody.appendChild(ui.hbar({ label: r.k, value: r.v, max: max, note: PAS.moneyShort(r.v) + " · " + r.n + " pol", tone: r.v === max ? "indigo" : "blue" }));
      });
      if (rows.length > TOP_ENTITY_ROWS) {
        var btn = ui.h("button", { class: "btn ghost-link mt-6", type: "button" }, expanded ? "Show top " + TOP_ENTITY_ROWS + " only" : "See " + (rows.length - TOP_ENTITY_ROWS) + " others");
        btn.addEventListener("click", function () { topExpanded[spec.key] = !expanded; buildTopEntities(); });
        topBody.appendChild(btn);
      }
    }

    function buildAll() { renderToggle(); buildFinancials(); buildKpis(); buildChart(); buildSnapshotPanels(); buildQueues(); buildClaims(); buildTopEntities(); }
    buildAll();
  }

  /* The shared "own book" analytics view for every scoped, mostly-read-only role — MGA and Broker
     today, and any future read-only/request-only custom role an admin creates (written generically
     off `role`/`PAS.ROLES[role]`, never a hardcoded role name). Same layout for both so switching
     between them reads as "the same dashboard, different data," not two unrelated screens — only
     the second breakdown panel's dimension and the header copy adapt to what's actually meaningful
     for that role's scope. Claims and Reserves are real (PAS.CLAIMS_BY_ID / PAS.lossRatio /
     PAS.reservesTotal in store.js) — six seeded claims across the active book, including one
     deliberately consistent with the "adverse loss ratio... 140%" narrative already on Bharat
     Steel Works' cancellation record, so the two screens agree instead of one silently
     contradicting the other. */
  function renderScopedDashboard(page, allPolicies, role) {
    var spec = PAS.ROLES[role];
    /* Genuinely scoped to this role's own book (PAS.scopePolicies) — a real filter, not the same
       book with a different label. */
    var identity = PAS.getActingIdentity();
    var policies = PAS.scopePolicies(allPolicies, role);
    var active = policies.filter(function (p) { return p.status === "Active"; });
    var inForcePremium = sum(active, function (p) { return p.premium; });

    page.appendChild(ui.pageHeader({
      icon: spec.icon, tone: spec.tone, title: spec.label + " Dashboard",
      sub: "The business placed through " + identity + " — premium, loss activity and reserves",
      what: spec.desc,
      why: spec.canRequest ? "Scoped to " + identity + "'s own book — can raise a request here, but not decide one." : "Read-only: " + spec.label + " sees its own book; decisions stay with an admin.",
    }));

    /* Loss ratio and combined ratio go in the headline row for scoped roles too. Those two mean
       the same thing no matter who is reading them, so unlike the MGA's commission-revenue panel
       (which would be wrong for a Broker, whose revenue is its own share, and for a Carrier,
       to whom commission is a cost rather than income) they can be shown to every role as-is.
       Computed from the same PAS.bookFinancials over the same on-risk population as the full
       operational dashboard — a scoped role sees a narrower book, never a different formula. */
    var scopedFin = PAS.bookFinancials(PAS.onRiskPolicies(policies));
    function pctOf(x) { return (Math.round(x * 1000) / 10) + "%"; }
    function lossToneForScoped(r) { return r >= 0.85 ? "red" : r >= 0.6 ? "amber" : "green"; }
    page.appendChild(ui.kpiRow([
      { label: "In-force premium", value: PAS.moneyShort(inForcePremium), tone: "green", tip: "Sum of annual premium across in-force policies, as of today." },
      {
        label: "Earned premium", value: PAS.moneyShort(scopedFin.earnedPremium), tone: "blue",
        tip: "Premium actually earned to date across this book's on-risk policies, including cancelled and expired ones.",
        why: "The exposure base both ratios below divide by — written premium would flatter them, because a policy part-way through its term has not earned all of it.",
      },
      { label: "Active policies", value: active.length, tip: "In force as of today, of " + policies.length + " total records." },
      {
        label: "Loss ratio", value: pctOf(scopedFin.lossRatio), tone: lossToneForScoped(scopedFin.lossRatio),
        tip: PAS.money(scopedFin.incurred) + " incurred ÷ " + PAS.money(scopedFin.earnedPremium) + " earned, across " + scopedFin.claimCount + " claims.",
        why: "Whether the risk on this book was priced correctly.",
      },
      {
        label: "Combined ratio", value: pctOf(scopedFin.combinedRatio), tone: scopedFin.combinedRatio >= 1 ? "red" : scopedFin.combinedRatio >= 0.95 ? "amber" : "green",
        tip: pctOf(scopedFin.lossRatio) + " loss + " + pctOf(scopedFin.expenseRatio) + " acquisition commission.",
        why: "Under 100% this book made an underwriting profit; over 100% it lost money. Acquisition commission is the only expense included, so the real figure is higher.",
      },
      { label: "Product lines", value: Array.from(new Set(policies.map(function (p) { return p.product; }))).length, tip: "Distinct LOBs written." },
      { label: "States", value: Array.from(new Set(policies.map(function (p) { return p.state; }))).length, tip: "Distinct states with business on the books." },
    ], true));

    /* Filters: state, LOB, the counterpart distribution entity, and carrier, all multi-select
       (empty selection = "All"), plus a period toggle (Monthly/Quarterly/Yearly/custom range) —
       applied to every chart below, not just decoration: `refresh()` rebuilds every panel body
       against the filtered/period-scoped set. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    page.appendChild(filterBlock);

    /* The second breakdown panel is whichever distribution-chain dimension this role's own scope
       ISN'T — a Broker (scoped by producer, i.e. themselves) sees premium by MGA facility instead
       of premium by broker, which would otherwise be one bar, always themselves. A Reinsurer sees
       both layers underneath it (MGA and, per the MOM 2026-08-26 feedback, Broker too) since both
       are "relevant entities" from a carrier's own view — everyone else sees the traditional
       broker breakdown. */
    var isCarrierScope = spec.scope === "carrier";
    var secondDim = spec.scope === "producer" ? "mga" : isCarrierScope ? "mga" : "producer";
    var secondLabel = spec.scope === "producer" || isCarrierScope ? "MGA" : "Broker";
    var secondTitle = spec.scope === "producer" || isCarrierScope ? "Premium by MGA" : "Premium by broker";
    var secondWhat = spec.scope === "producer" || isCarrierScope ? "In-force premium per MGA facility this book is placed through." : "In-force premium per placing broker, Direct included.";
    var secondWhy = spec.scope === "producer" || isCarrierScope ? "Shows which wholesale facilities this book actually depends on." : "Shows which distribution channel the book actually depends on.";
    var thirdDim = "producer", thirdLabel = "Broker", thirdTitle = "Premium by broker",
      thirdWhat = "In-force premium per placing broker, Direct included.",
      thirdWhy = "Shows which distribution channel ultimately sources this reinsurer's book.";

    /* stateGrid/lobGrid/issuancePanel are built now (their bodies are wired into renderCharts
       below) but not appended to `page` yet — they're added further down, after the period
       toggle, so the toggle reads at the top of the page (same position it has on the
       Super Admin/Admin dashboard) rather than buried beneath the panels it doesn't even
       control. */
    var stateGrid = ui.h("div", { class: isCarrierScope ? "three-col-grid" : "two-col-grid" });
    var stateTopOnly = spec.scope === "producer";
    var statePanel = ui.panel({ title: stateTopOnly ? "Premium by state (top 5)" : "Premium by state", what: stateTopOnly ? "Top 5 states by in-force premium, largest first." : "In-force premium per state, largest first.", why: "State-level concentration matters for regulatory exposure and catastrophe accumulation." }, []);
    var stateBody = statePanel.querySelector(".panel-body");
    stateGrid.appendChild(statePanel);
    var brokerPanel = ui.panel({ title: secondTitle, what: secondWhat, why: secondWhy }, []);
    var brokerBody = brokerPanel.querySelector(".panel-body");
    stateGrid.appendChild(brokerPanel);
    var thirdPanel = null, thirdBody = null;
    if (isCarrierScope) {
      thirdPanel = ui.panel({ title: thirdTitle, what: thirdWhat, why: thirdWhy }, []);
      thirdBody = thirdPanel.querySelector(".panel-body");
      stateGrid.appendChild(thirdPanel);
    }

    var lobGrid = ui.h("div", { class: "two-col-grid" });
    var lobPanel = ui.panel({ title: "Written premium by product", what: "In-force premium per product line, largest first.", why: "Concentration in one line is a portfolio risk this book's own concentration watches too." }, []);
    var lobBody = lobPanel.querySelector(".panel-body");
    lobGrid.appendChild(lobPanel);
    var claimsPanel = ui.panel({ title: "Claims & reserves", what: "Every claim on file, incurred/paid/reserved, filtered the same as the charts above.", why: "The two numbers a carrier partner asks for first — loss ratio and open exposure — computed from real claim records, not asserted." }, []);
    var claimsBody = claimsPanel.querySelector(".panel-body");
    lobGrid.appendChild(claimsPanel);

    /* This dashboard has no second chart to pair it with in a two-col-grid the way the other
       panels are — left full width, the line graph (drawn to a fixed 640x172 design) reads as
       stretched thin across the whole page. Capped to the same ~640px a two-col-grid's own
       column would give it, so it renders at the size it was actually designed for. */
    var issuancePanel = ui.panel({ title: "New business issued", what: "Policies formally issued, trailing periods.", why: "What's coming into this book, not just what's already on it." }, []);
    issuancePanel.style.maxWidth = "660px";
    var issuanceBody = issuancePanel.querySelector(".panel-body");

    var filterState = [], filterProduct = [], filterSecondDim = [], filterCarrier = [], filterThirdDim = [];
    function matchesMulti(selected, value) { return selected.length === 0 || selected.indexOf(value) !== -1; }

    /* Period toggle — same Monthly/Quarterly/Yearly + custom-range mechanism as the full
       operational dashboard, reusing its module-level helpers, but scoped down to the one place
       it's meaningful here: how many trailing periods the "New business issued" trend covers. The
       other panels (state/second-dim/LOB, claims) stay as-of-today snapshots, same reasoning as
       Total/Active policies on the operational dashboard's own KPI row. */
    var period = "month";
    var periodOffset = 0;
    var customFrom = PAS.addDays(PAS.todayISO(), -30);
    var customTo = PAS.todayISO();

    function renderCharts() {
      var scoped = policies.filter(function (p) {
        return matchesMulti(filterState, p.state) && matchesMulti(filterProduct, p.product)
          && matchesMulti(filterSecondDim, p[secondDim]) && matchesMulti(filterCarrier, p.carrier)
          && matchesMulti(filterThirdDim, p[thirdDim]);
      });
      var scopedActive = scoped.filter(function (p) { return p.status === "Active"; });

      /* Written business, not the whole filtered scope: a policy counts here — premium AND count
         — only once it's Active, matching the "In-force premium" convention this whole dashboard
         already uses. A submission still in underwriting hasn't earned anyone commission yet. */
      function byField(field) {
        var keys = Array.from(new Set(scopedActive.map(function (p) { return p[field]; })));
        return keys.map(function (k) {
          var forKey = scopedActive.filter(function (p) { return p[field] === k; });
          return { k: k, v: sum(forKey, function (p) { return p.premium; }), n: forKey.length };
        }).sort(function (a, b) { return b.v - a.v; });
      }
      function fillPanel(body, rows, onClickField) {
        body.innerHTML = "";
        var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
        if (rows.length === 0 || max === 1 && rows.every(function (r) { return r.v === 0; })) { body.appendChild(ui.h("div", { class: "faint-note" }, "No in-force premium in this filter.")); return; }
        rows.forEach(function (r) {
          body.appendChild(ui.hbar({
            label: r.k, value: r.v, max: max, note: PAS.moneyShort(r.v) + " · " + r.n + " pol", tone: r.v === max ? "indigo" : "blue",
            onClick: onClickField ? function () { location.href = "registry.html?" + onClickField + "=" + encodeURIComponent(r.k); } : undefined,
          }));
        });
      }
      fillPanel(stateBody, stateTopOnly ? byField("state").slice(0, 5) : byField("state"));
      fillPanel(brokerBody, byField(secondDim));
      if (isCarrierScope) fillPanel(thirdBody, byField(thirdDim));
      fillPanel(lobBody, byField("product"), "product");

      var issuanceKeys = period === "month" ? trailingMonths(6, periodOffset) : period === "quarter" ? trailingQuarters(6, periodOffset)
        : period === "year" ? trailingYears(4, periodOffset) : ["custom"];
      var issuanceMatches = period === "month" ? inMonth : period === "quarter" ? inQuarter
        : period === "year" ? inYear : function (dateStr) { return !!dateStr && dateStr >= customFrom && dateStr <= customTo; };
      var issuanceData = issuanceKeys.map(function (key) {
        var row = { key: key };
        ISSUANCE_SERIES.forEach(function (s) { row[s.type] = txnsOfType(scoped, s.type, "Completed").filter(function (x) { return issuanceMatches(x.h.date, key); }).length; });
        return row;
      });
      function issuanceLabel(key) {
        if (period === "month") return monthKeyLabel(key);
        if (period === "quarter") return "Q" + key.slice(6) + " '" + key.slice(2, 4);
        if (period === "year") return key;
        return customFrom + " – " + customTo;
      }
      var issuanceNote = period === "month" ? "Trailing 6 months, completed transactions by their effective date."
        : period === "quarter" ? "Trailing 6 quarters, completed transactions by their effective date."
        : period === "year" ? "Trailing 4 years, completed transactions by their effective date."
        : "From " + customFrom + " to " + customTo + ", completed transactions by their effective date.";
      drawTrendGraph(issuanceBody, ISSUANCE_SERIES, issuanceData, issuanceLabel, issuanceNote);

      claimsBody.innerHTML = "";
      /* Same on-risk, earned-premium basis as the full operational dashboard, read from the same
         PAS.bookFinancials — so a Broker or MGA viewing their own book never sees a loss ratio
         computed a different way from the one an admin sees for the same policies. */
      var scopedOnRisk = PAS.onRiskPolicies(scoped);
      var scopedClaims = PAS.allClaims(scopedOnRisk);
      if (scopedClaims.length === 0) {
        claimsBody.appendChild(ui.h("div", { class: "faint-note" }, "No claims on file in this filter."));
      } else {
        var sfin = PAS.bookFinancials(scopedOnRisk);
        var summary = ui.h("div", { class: "mt-6" });
        summary.appendChild(ui.kv({
          k: "Loss ratio (this filter)", v: (Math.round(sfin.lossRatio * 1000) / 10) + "%",
          what: PAS.money(sfin.incurred) + " incurred ÷ " + PAS.money(sfin.earnedPremium) + " earned premium.",
          why: "Earned, not written — a policy only part-way through its term has not earned its full annual premium, and dividing by written premium would understate this ratio.",
        }));
        summary.appendChild(ui.kv({
          k: "Combined ratio (this filter)", v: (Math.round(sfin.combinedRatio * 1000) / 10) + "%",
          what: (Math.round(sfin.lossRatio * 1000) / 10) + "% loss + " + (Math.round(sfin.expenseRatio * 1000) / 10) + "% acquisition commission.",
          why: "Under 100% this book made an underwriting profit; over 100% it lost money.",
        }));
        summary.appendChild(ui.kv({ k: "Open reserves (this filter)", v: PAS.money(sfin.reserved), what: sfin.openClaimCount + " open of " + sfin.claimCount + " total claims." }));
        claimsBody.appendChild(summary);
        claimsBody.appendChild(ui.dataTable({
          columns: ["Policy", "Type", "State", { label: "Status", what: "Open claims still carry a reserve; closed claims are fully paid." }, { label: "Incurred", what: "Paid plus reserved — the total cost estimate." }, "Reserved"],
          rows: scopedClaims.map(function (x) {
            return [ui.cellId(x.p.id), x.c.type, x.p.state, ui.pill(x.c.status === "Open" ? "amber" : "green", x.c.status), PAS.money(x.c.incurred), x.c.reserved ? PAS.money(x.c.reserved) : "—"];
          }),
          wrapCells: true,
        }));
      }
    }

    var states = Array.from(new Set(policies.map(function (p) { return p.state; }))).sort();
    var products = Array.from(new Set(policies.map(function (p) { return p.product; }))).sort();
    var secondDimOptions = Array.from(new Set(policies.map(function (p) { return p[secondDim]; }).filter(Boolean))).sort();
    var carrierOptions = Array.from(new Set(policies.map(function (p) { return p.carrier; }).filter(Boolean))).sort();

    var stateGroup = ui.h("div", {});
    stateGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "State"));
    stateGroup.appendChild(ui.multiSelect({ options: states, selected: filterState, allLabel: "All states", onChange: function (sel) { filterState = sel; refresh(); } }));
    filterBlock.appendChild(stateGroup);

    var lobGroup = ui.h("div", {});
    lobGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Line of business"));
    lobGroup.appendChild(ui.multiSelect({ options: products, selected: filterProduct, allLabel: "All LOBs", onChange: function (sel) { filterProduct = sel; refresh(); } }));
    filterBlock.appendChild(lobGroup);

    var secondDimGroup = ui.h("div", {});
    secondDimGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, secondLabel));
    secondDimGroup.appendChild(ui.multiSelect({ options: secondDimOptions, selected: filterSecondDim, allLabel: "All " + secondLabel.toLowerCase() + "s", onChange: function (sel) { filterSecondDim = sel; refresh(); } }));
    filterBlock.appendChild(secondDimGroup);

    if (isCarrierScope) {
      var thirdDimOptions = Array.from(new Set(policies.map(function (p) { return p[thirdDim]; }).filter(Boolean))).sort();
      var thirdDimGroup = ui.h("div", {});
      thirdDimGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, thirdLabel));
      thirdDimGroup.appendChild(ui.multiSelect({ options: thirdDimOptions, selected: filterThirdDim, allLabel: "All " + thirdLabel.toLowerCase() + "s", onChange: function (sel) { filterThirdDim = sel; refresh(); } }));
      filterBlock.appendChild(thirdDimGroup);
    }

    var carrierGroup = ui.h("div", {});
    carrierGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Reinsurer"));
    carrierGroup.appendChild(ui.multiSelect({ options: carrierOptions, selected: filterCarrier, allLabel: "All reinsurers", onChange: function (sel) { filterCarrier = sel; refresh(); } }));
    filterBlock.appendChild(carrierGroup);

    /* Period toggle, driving "New business issued" further down — Monthly/Quarterly/Yearly chips
       with ◀/▶ period navigation, or a custom date range instead. Placed right under the filters
       (same position it has on the Super Admin/Admin operational dashboard), not buried beneath
       the panels it doesn't control. */
    var toggleRow = ui.h("div", { class: "period-toggle-row" });
    toggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "New business issued"));
    var toggleAndNav = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } });
    var toggle = ui.h("div", { class: "period-toggle" });
    toggleAndNav.appendChild(toggle);
    var navWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    var prevBtn = ui.h("button", { class: "btn ghost-link", title: "Previous period" }, "◀");
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = ui.h("button", { class: "btn ghost-link", title: "Next period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    prevBtn.addEventListener("click", function () { periodOffset -= 1; refresh(); });
    nextBtn.addEventListener("click", function () { if (periodOffset < 0) { periodOffset += 1; refresh(); } });
    page.appendChild(toggleRow);

    var customToggleRow = ui.h("div", { class: "period-toggle-row" });
    customToggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Or a custom range"));
    var customBtn = ui.h("button", { class: "chip" }, "Custom range");
    customToggleRow.appendChild(customBtn);
    customBtn.addEventListener("click", function () { period = period === "custom" ? "month" : "custom"; periodOffset = 0; refresh(); });
    page.appendChild(customToggleRow);

    var rangeRow = ui.h("div", { class: "period-toggle-row" });
    rangeRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Date range"));
    var rangeWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    var fromInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customFrom });
    var toInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customTo });
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--color-muted)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    page.appendChild(rangeRow);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; refresh(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; refresh(); });

    page.appendChild(stateGrid);
    page.appendChild(lobGrid);
    page.appendChild(issuancePanel);

    function periodLabelText() {
      if (period === "month") { var mk = trailingMonths(1, periodOffset)[0]; return MONTH_NAMES[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4); }
      if (period === "quarter") return quarterKeyOffset(periodOffset);
      if (period === "year") return String(yearOffset(periodOffset));
      return customFrom + " to " + customTo;
    }
    function renderToggle() {
      toggle.innerHTML = "";
      [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"]].forEach(function (opt) {
        var btn = ui.h("button", { class: "chip" + (period === opt[0] ? " active" : "") }, opt[1]);
        btn.addEventListener("click", function () { if (period !== opt[0]) { period = opt[0]; periodOffset = 0; refresh(); } });
        toggle.appendChild(btn);
      });
      customBtn.className = "chip" + (period === "custom" ? " active" : "");
      navWrap.style.display = period === "custom" ? "none" : "flex";
      rangeRow.style.display = period === "custom" ? "" : "none";
      if (period !== "custom") {
        navLabel.textContent = periodLabelText();
        nextBtn.disabled = periodOffset >= 0;
      }
    }

    function refresh() { renderToggle(); renderCharts(); }
    refresh();
  }

  function render() {
    var role = PAS.getRole();
    var spec = PAS.ROLES[role] || {};
    var policies = PAS.getPolicies();
    var page = ui.h("div", {});
    /* Any role scoped to less than the whole book (MGA, Broker, or a future custom role an admin
       creates with the same shape) gets the shared scoped dashboard; full-access roles (Super
       Admin, Admin) get the operational one. Branching on scope rather than a role name keeps a
       new custom role from accidentally landing on the full-book view just because its name isn't
       one of these two. */
    if (spec.scope && spec.scope !== "all") renderScopedDashboard(page, policies, role);
    else renderUnderwriterDashboard(page, policies);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("dashboard", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
