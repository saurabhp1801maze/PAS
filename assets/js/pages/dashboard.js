/* Portfolio dashboard. Every figure is computed live from the seeded book for the selected
   period — nothing is hardcoded. Two audit fixes carried over from the previous version:
     - "Awaiting decision" = pending.length + bound.length, never + referred.length on top, since
       every referred submission already carries the Pending Underwriting transaction counted in
       `pending` (summing both used to double-count it).
     - No fabricated trend numbers. This prototype has no period-bucketed snapshots, only ledger
       transaction dates — so every period-scoped figure below is a real count of transactions
       whose own `date` falls in the selected month or year, not an invented delta.
   Monthly defaults to the current calendar month (matches PAS.todayISO()); Yearly to the current
   calendar year. Total policies, Active policies and Awaiting decision are snapshot metrics — the
   book has no history of "active as of a past month" to show, so they stay constant across the
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

  /* The dashboard is the one screen every role lands on, so it's the one screen that has to
     genuinely look different per role rather than the same operational view with a label
     changed. Underwriter keeps the full operational dashboard below unchanged; MGA and Carrier
     share a read-only portfolio-analytics view (renderPortfolioDashboard); Broker/Producer gets
     their own book only, scoped by the real `producer` field already on every policy. */
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
    carrierGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Carrier"));
    carrierGroup.appendChild(ui.multiSelect({ options: carrierOptions, selected: carrierFilter, allLabel: "All carriers", onChange: function (sel) { carrierFilter = sel; buildAll(); } }));
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
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--text)", minWidth: "108px", textAlign: "center" } });
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
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--text-faint)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    page.appendChild(rangeRow);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; buildAll(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; buildAll(); });

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
      var pending = PAS.allTxns(policies).map(function (t) { return t.h; }).filter(function (h) { return h.status === "Pending"; });
      var awaitingDecision = pending.length + bound.length; /* see file header — the F-15 fix */

      function countTxns(type, status) {
        return txnsOfType(policies, type, status).filter(function (x) {
          return periodMatches(x.h.date);
        }).length;
      }
      var renewed = countTxns("Renewal", "Completed");
      var cancelled = countTxns("Cancellation", "Completed");
      var reinstated = countTxns("Reinstatement", "Completed");
      var expiring = active.filter(function (p) { return periodMatches(p.expirationDate); }).length;
      var decidedRenewals = renewed + countTxns("Renewal", "Rejected");
      var periodNote = periodNoteText();
      var retentionLabel, retentionTone;
      if (decidedRenewals === 0) { retentionLabel = "—"; retentionTone = "gray"; }
      else { var pct = Math.round((renewed / decidedRenewals) * 100); retentionLabel = pct + "%"; retentionTone = pct >= 90 ? "green" : pct >= 70 ? "amber" : "red"; }

      kpiContainer.innerHTML = "";
      kpiContainer.appendChild(ui.kpiRow([
        { label: "Total policies", value: policies.length, tip: "Every record in the register" + filterNote() + ".", why: "Portfolio size — not period-scoped, the book has no past-state snapshots to filter this against." },
        { label: "Active policies", value: active.length, tone: "green", tip: "In force as of today.", why: "A snapshot count, same reason as Total policies." },
        { label: "Renewed", value: renewed, tone: "blue", tip: "Renewals completed " + periodNote + "." },
        { label: "Expiring soon", value: expiring, tone: expiring > 0 ? "amber" : "gray", tip: "Active policies whose term ends " + periodNote + "." },
        { label: "Retention", value: retentionLabel, tone: retentionTone, tip: decidedRenewals === 0 ? ("No renewals decided " + periodNote + ".") : ("Completed ÷ (completed + declined) " + periodNote + " — " + renewed + " completed, " + (decidedRenewals - renewed) + " declined.") },
        { label: "Reinstated", value: reinstated, tone: reinstated > 0 ? "green" : "gray", tip: "Reinstatements completed " + periodNote + "." },
        { label: "Cancelled", value: cancelled, tone: cancelled > 0 ? "red" : "gray", tip: "Cancellations completed " + periodNote + "." },
        { label: "Awaiting decision", value: awaitingDecision, tone: "red", tip: "Pending transactions (" + pending.length + ") plus bound policies awaiting issue (" + bound.length + ") — counted once each.", why: "Operational queue, not period-scoped: it's what needs action right now, regardless of which period you're viewing." },
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

    var SVG_NS = "http://www.w3.org/2000/svg";
    function svgEl(tag, attrs) {
      var el = document.createElementNS(SVG_NS, tag);
      if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }

    /* Right panel — an actual line/area graph, for reading one series' trend rather than comparing
       several. Mark spec: 2px line, round join/cap; ≥8px (r=4) markers with a surface-color ring;
       a soft ~10% area wash under the line; hairline recessive gridlines. Every point carries a
       native hover tooltip; only the most recent point gets a permanent value label, per "never a
       number on every point" — a single series needs no legend box, the panel title names it. */
    function renderTrendGraph(container, seriesList) {
      var data = bucketData(seriesList);
      var maxVal = Math.max.apply(null, data.reduce(function (acc, row) { seriesList.forEach(function (s) { acc.push(row[s.type]); }); return acc; }, [1]));
      var niceMax = Math.max(1, maxVal);
      var n = data.length;

      container.innerHTML = "";
      container.appendChild(ui.h("div", { class: "faint-note", style: { marginBottom: "10px" } }, windowNote()));

      var W = 640, H = 172, padL = 12, padR = 44, padT = 20, padB = 26;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      function xAt(i) { return n > 1 ? padL + (i / (n - 1)) * plotW : padL + plotW / 2; }
      function yAt(v) { return padT + plotH - (v / niceMax) * plotH; }

      var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: String(H), preserveAspectRatio: "none", class: "trend-graph" });

      [0, 1].forEach(function (frac) {
        var y = padT + plotH * frac;
        svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "trend-grid-line" }));
      });

      data.forEach(function (row, i) {
        svg.appendChild(Object.assign(svgEl("text", { x: xAt(i), y: H - 8, "text-anchor": "middle", class: "trend-axis-label-svg" }), { textContent: periodLabel(row.key) }));
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
          dot.appendChild(Object.assign(svgEl("title"), { textContent: s.label + " — " + periodLabel(data[i].key) + ": " + v }));
          svg.appendChild(dot);
          if (i === n - 1) {
            svg.appendChild(Object.assign(svgEl("text", { x: p[0] + 8, y: p[1] + 3.5, class: "trend-val-label" }), { textContent: String(v) }));
          }
        });
      });

      container.appendChild(svg);
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
    var compPanel = ui.panel({ title: "Book composition", what: "Every record by lifecycle status.", why: "Bound-not-issued and cancelled are the two counts that signal operational drag." }, []);
    var compBody = compPanel.querySelector(".panel-body");
    twoCol.appendChild(compPanel);
    page.appendChild(twoCol);

    var threeCol = ui.h("div", { class: "three-col-grid" });
    /* Capped so a growing book can't push the panel's height past its neighbors — each list is
       already sorted by what makes it most actionable, so the cap drops the least urgent items,
       never the most. */
    var RENEWAL_ROWS = 10, BOUND_ROWS = 5;
    var renewalPanel = ui.panel({ title: "Renewal pipeline", what: "In-force policies by closeness to expiry, top " + RENEWAL_ROWS + " most urgent.", why: "Notices must be served " + PAS.RENEWAL_LEAD_DAYS + " days ahead.", right: openLink("renewal.html", "Open") }, []);
    var renewalBody = renewalPanel.querySelector(".panel-body");
    threeCol.appendChild(renewalPanel);
    var boundPanel = ui.panel({ title: "Bound policies", what: "Every bound policy's issue readiness, blocked ones first, top " + BOUND_ROWS + ".", why: "Cover is already live under every binder here — a blocked one is unpriced exposure with no clock stopped; a ready one just needs the Issue click.", right: openLink("issue.html", "Open") }, []);
    var boundBody = boundPanel.querySelector(".panel-body");
    threeCol.appendChild(boundPanel);
    var waitingPanel = ui.panel({ title: "Oldest waiting", what: "Work that has sat longest without a decision, oldest first.", why: "Ageing, not volume, is what breaks an SLA." }, []);
    var waitingBody = waitingPanel.querySelector(".panel-body");
    threeCol.appendChild(waitingPanel);
    page.appendChild(threeCol);

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
      byProduct.forEach(function (x) { prodBody.appendChild(ui.hbar({ label: x.pr, value: x.v, max: maxP, note: PAS.moneyShort(x.v) + " · " + x.n + " pol", tone: x.v === maxP ? "indigo" : "blue" })); });

      compBody.innerHTML = "";
      compBody.appendChild(ui.donut({
        total: policies.length, centerValue: policies.length, centerLabel: "records", segments: [
          { label: "Active", value: active.length, tone: "green" },
          { label: "Bound", value: bound.length, tone: "amber" },
          { label: "Referred", value: referred.length, tone: "violet" },
          { label: "Cancelled", value: cancelled.length, tone: "red" },
          { label: "Expired", value: policies.filter(function (p) { return p.status === "Expired"; }).length, tone: "gray" },
        ],
      }));

      var renewalSorted = active.slice().sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });
      renewalBody.innerHTML = "";
      renewalSorted.slice(0, RENEWAL_ROWS).forEach(function (p) {
        var rc = PAS.renewalCompliance(p);
        renewalBody.appendChild(ui.hbar({ label: p.holder, value: Math.max(0, 365 - rc.daysToExpiry), max: 365, note: rc.daysToExpiry + "d left", tone: rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red" }));
      });
      if (renewalSorted.length > RENEWAL_ROWS) renewalBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing the " + RENEWAL_ROWS + " closest to expiry, of " + renewalSorted.length + " in force."));

      /* Every bound policy, not just the blocked ones. Blocked policies sort first, soonest-
         expiring binder first within that group — that's the real deadline the panel is warning
         about — then ready-to-issue ones after, so the panel always shows the full bound book,
         not a fragment of it. */
      var boundSorted = bound.slice().sort(function (a, b) {
        var aBlocked = ((a.binder && a.binder.subjectivities) || []).some(function (s) { return !s.met; });
        var bBlocked = ((b.binder && b.binder.subjectivities) || []).some(function (s) { return !s.met; });
        if (aBlocked !== bBlocked) return aBlocked ? -1 : 1;
        return PAS.daysBetween(PAS.todayISO(), a.binder.expiryDate) - PAS.daysBetween(PAS.todayISO(), b.binder.expiryDate);
      });
      boundBody.innerHTML = "";
      if (boundSorted.length === 0) boundBody.appendChild(ui.h("div", { class: "faint-note" }, "Nothing bound."));
      boundSorted.slice(0, BOUND_ROWS).forEach(function (p) {
        var unmet = ((p.binder && p.binder.subjectivities) || []).filter(function (s) { return !s.met; });
        var row = ui.h("div", { class: "blocked-row" });
        var headRow = ui.h("div", { class: "blocked-row-head" });
        var nameWrap = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } });
        nameWrap.appendChild(PAS.icon(unmet.length ? "alert-triangle" : "check-circle-2", { size: 12, color: unmet.length ? "var(--red)" : "var(--green)" }));
        nameWrap.appendChild(ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--text)" } }, p.holder));
        headRow.appendChild(nameWrap);
        headRow.appendChild(ui.h("span", { style: { fontSize: "11.5px", color: "var(--text-faint)" } }, PAS.moneyShort(p.premium)));
        row.appendChild(headRow);
        if (unmet.length) {
          unmet.forEach(function (s) {
            var sub = ui.h("div", { class: "blocked-sub" });
            sub.appendChild(PAS.icon("alert-triangle", { size: 11 }));
            sub.appendChild(document.createTextNode(s.label));
            row.appendChild(sub);
          });
        } else {
          row.appendChild(ui.h("div", { class: "blocked-sub ready" }, "Ready to issue"));
        }
        boundBody.appendChild(row);
      });
      if (boundSorted.length > BOUND_ROWS) boundBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing " + BOUND_ROWS + " of " + boundSorted.length + " bound policies."));

      var waitingItems = referred.map(function (p) { return { p: p, age: PAS.daysBetween(p.submittedOn, PAS.todayISO()) }; })
        .concat(bound.map(function (p) { return { p: p, age: PAS.daysBetween(p.binder.boundOn, PAS.todayISO()) }; }))
        .sort(function (a, b) { return b.age - a.age; });
      waitingBody.innerHTML = "";
      if (waitingItems.length === 0) waitingBody.appendChild(ui.h("div", { class: "faint-note" }, "Nothing waiting."));
      waitingItems.forEach(function (x) {
        var row = ui.h("div", { class: "waiting-row" });
        row.appendChild(PAS.icon("clock", { size: 11, color: "var(--text-faint)" }));
        row.appendChild(ui.h("span", { class: "waiting-name" }, x.p.holder));
        row.appendChild(ui.h("span", { class: "waiting-age" }, x.age + "d"));
        row.appendChild(ui.badge(x.p.status));
        waitingBody.appendChild(row);
      });
    }

    function buildAll() { renderToggle(); buildKpis(); buildChart(); buildSnapshotPanels(); }
    buildAll();
  }

  /* Shared by MGA and Carrier: both are portfolio-wide, read-only, no decision buttons anywhere.
     They differ only in framing (MGA = "the whole book across every state and broker", Carrier =
     "the paper written on my behalf") and which KPIs lead — Carrier's own risk exposure and loss
     activity lead for them, revenue/broker mix leads for MGA. Claims and Reserves are real now
     (PAS.CLAIMS_BY_ID / PAS.lossRatio / PAS.reservesTotal in store.js) — six seeded claims across
     the active book, including one deliberately consistent with the "adverse loss ratio... 140%"
     narrative already on Bharat Steel Works' cancellation record, so the two screens agree
     instead of one silently contradicting the other. */
  function renderPortfolioDashboard(page, allPolicies, role) {
    var spec = PAS.ROLES[role];
    /* MGA sees the whole portfolio; Carrier is genuinely scoped to the paper placed with them
       (PAS.PRODUCT_CARRIER) — a real filter, not the same data with a different label. */
    var policies = PAS.scopePolicies(allPolicies, role);
    var active = policies.filter(function (p) { return p.status === "Active"; });
    var cancelled = policies.filter(function (p) { return p.status === "Cancelled"; });
    var declined = policies.filter(function (p) { return p.status === "Declined"; });
    var inForcePremium = sum(active, function (p) { return p.premium; });

    /* Conversion: every policy in this book passed through Submission — "initiated" is the whole
       book; "converted" is whatever made it past underwriting into Bound or further, i.e.
       everything except still-Referred or Declined. Real, computed from status alone. */
    var referred = policies.filter(function (p) { return p.status === "Referred"; });
    var converted = policies.length - referred.length - declined.length;
    var conversionRate = policies.length ? Math.round((converted / policies.length) * 100) : 0;

    page.appendChild(ui.pageHeader({
      icon: spec.icon, tone: spec.tone, title: spec.label + " Dashboard",
      sub: role === "Carrier" ? "The book written on " + spec.identity + "'s paper — premium, loss activity and reserves" : "Portfolio-wide — revenue, state, broker, LOB and conversion",
      what: spec.desc, why: "Read-only: " + spec.label + " sees the book; decisions stay with underwriting.",
    }));

    var portfolioLossRatio = PAS.lossRatio(active);
    var portfolioReserves = PAS.reservesTotal(active);
    var allClaimsList = PAS.allClaims(active);

    page.appendChild(ui.kpiRow([
      { label: "In-force premium", value: PAS.moneyShort(inForcePremium), tone: "green", tip: "Sum of annual premium across in-force policies, as of today." },
      { label: "Active policies", value: active.length, tip: "In force as of today, of " + policies.length + " total records." },
      { label: "Avg premium", value: PAS.moneyShort(active.length ? inForcePremium / active.length : 0), tip: "Mean annual premium per in-force policy." },
      { label: "Product lines", value: Array.from(new Set(policies.map(function (p) { return p.product; }))).length, tip: "Distinct LOBs written." },
      { label: "States", value: Array.from(new Set(policies.map(function (p) { return p.state; }))).length, tip: "Distinct states with business on the books." },
      { label: "Initiated", value: policies.length, tone: "blue", tip: "Every submission that ever entered underwriting." },
      { label: "Converted", value: converted, tone: "green", tip: "Made it past underwriting into Bound or further — the complement of still-Referred or Declined." },
      { label: "Conversion rate", value: conversionRate + "%", tone: conversionRate >= 70 ? "green" : conversionRate >= 40 ? "amber" : "red", tip: converted + " converted ÷ " + policies.length + " initiated." },
      { label: "Loss ratio", value: Math.round(portfolioLossRatio * 100) + "%", tone: portfolioLossRatio > 1 ? "red" : portfolioLossRatio > 0.6 ? "amber" : "green", tip: "Incurred claims ÷ premium, across the active book — " + allClaimsList.length + " claims on file." },
      { label: "Open reserves", value: PAS.moneyShort(portfolioReserves), tone: portfolioReserves > 0 ? "amber" : "gray", tip: "Sum of reserved amounts on claims still open — the carrier's current exposure to unsettled loss." },
    ], true));

    /* Filters: state and LOB, both multi-select (empty selection = "All"), applied to every chart
       below — not just decoration, `renderCharts()` rebuilds every panel body against the
       filtered set. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    page.appendChild(filterBlock);

    var stateGrid = ui.h("div", { class: "two-col-grid" });
    var statePanel = ui.panel({ title: "Premium by state", what: "In-force premium per state, largest first.", why: "State-level concentration matters for regulatory exposure and catastrophe accumulation." }, []);
    var stateBody = statePanel.querySelector(".panel-body");
    stateGrid.appendChild(statePanel);
    var brokerPanel = ui.panel({ title: "Premium by broker", what: "In-force premium per placing broker, Direct included.", why: "Shows which distribution channel the book actually depends on." }, []);
    var brokerBody = brokerPanel.querySelector(".panel-body");
    stateGrid.appendChild(brokerPanel);
    page.appendChild(stateGrid);

    var lobGrid = ui.h("div", { class: "two-col-grid" });
    var lobPanel = ui.panel({ title: "Premium by LOB", what: "In-force premium per product line, largest first.", why: "Line concentration is the risk an MGA and its carrier partners watch first." }, []);
    var lobBody = lobPanel.querySelector(".panel-body");
    lobGrid.appendChild(lobPanel);
    var claimsPanel = ui.panel({ title: "Claims & reserves", what: "Every claim on file, incurred/paid/reserved, filtered the same as the charts above.", why: "The two numbers a carrier partner asks for first — loss ratio and open exposure — computed from real claim records, not asserted." }, []);
    var claimsBody = claimsPanel.querySelector(".panel-body");
    lobGrid.appendChild(claimsPanel);
    page.appendChild(lobGrid);

    var filterState = [], filterProduct = [];
    function matchesMulti(selected, value) { return selected.length === 0 || selected.indexOf(value) !== -1; }
    function renderCharts() {
      var scoped = policies.filter(function (p) {
        return matchesMulti(filterState, p.state) && matchesMulti(filterProduct, p.product);
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
      function fillPanel(body, rows) {
        body.innerHTML = "";
        var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
        if (rows.length === 0 || max === 1 && rows.every(function (r) { return r.v === 0; })) { body.appendChild(ui.h("div", { class: "faint-note" }, "No in-force premium in this filter.")); return; }
        rows.forEach(function (r) { body.appendChild(ui.hbar({ label: r.k, value: r.v, max: max, note: PAS.moneyShort(r.v) + " · " + r.n + " pol", tone: r.v === max ? "indigo" : "blue" })); });
      }
      fillPanel(stateBody, byField("state"));
      fillPanel(brokerBody, byField("producer"));
      fillPanel(lobBody, byField("product"));

      claimsBody.innerHTML = "";
      var scopedClaims = PAS.allClaims(scoped);
      if (scopedClaims.length === 0) {
        claimsBody.appendChild(ui.h("div", { class: "faint-note" }, "No claims on file in this filter."));
      } else {
        var scopedIncurred = scopedClaims.reduce(function (s, x) { return s + x.c.incurred; }, 0);
        var scopedReserved = scopedClaims.filter(function (x) { return x.c.status === "Open"; }).reduce(function (s, x) { return s + x.c.reserved; }, 0);
        var scopedRatio = PAS.lossRatio(scoped);
        var summary = ui.h("div", { class: "mt-6" });
        summary.appendChild(ui.kv({ k: "Loss ratio (this filter)", v: Math.round(scopedRatio * 100) + "%", what: PAS.money(scopedIncurred) + " incurred ÷ " + PAS.money(sum(scoped, function (p) { return p.premium; })) + " premium." }));
        summary.appendChild(ui.kv({ k: "Open reserves (this filter)", v: PAS.money(scopedReserved), what: scopedClaims.filter(function (x) { return x.c.status === "Open"; }).length + " open of " + scopedClaims.length + " total claims." }));
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

    var stateGroup = ui.h("div", {});
    stateGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "State"));
    stateGroup.appendChild(ui.multiSelect({ options: states, selected: filterState, allLabel: "All states", onChange: function (sel) { filterState = sel; renderCharts(); } }));
    filterBlock.appendChild(stateGroup);

    var lobGroup = ui.h("div", {});
    lobGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Line of business"));
    lobGroup.appendChild(ui.multiSelect({ options: products, selected: filterProduct, allLabel: "All LOBs", onChange: function (sel) { filterProduct = sel; renderCharts(); } }));
    filterBlock.appendChild(lobGroup);

    renderCharts();
  }

  /* A Broker/Producer sees only the business they placed — real scoping via `producer`, not a
     cosmetic filter, and there's no decision action anywhere: raising a request is as far as this
     role goes. */
  function renderBrokerDashboard(page, policies) {
    var spec = PAS.ROLES["Broker/Producer"];
    var own = PAS.scopePolicies(policies, "Broker/Producer");
    var active = own.filter(function (p) { return p.status === "Active"; });
    var pending = PAS.allTxns(own).map(function (t) { return t.h; }).filter(function (h) { return h.status === "Pending"; });
    var premium = sum(active, function (p) { return p.premium; });

    page.appendChild(ui.pageHeader({
      icon: spec.icon, tone: spec.tone, title: spec.identity + "'s Book",
      sub: own.length + " polic" + (own.length === 1 ? "y" : "ies") + " placed with Veridex",
      what: spec.desc, why: "Scoped to policies where producer = \"" + spec.identity + "\" — the same field every desk already records.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Policies placed", value: own.length, tip: "Every record with this producer on file." },
      { label: "Active", value: active.length, tone: "green", tip: "In force as of today." },
      { label: "In-force premium", value: PAS.moneyShort(premium), tone: "green", tip: "Sum of annual premium across this producer's in-force policies." },
      { label: "Requests pending", value: pending.length, tone: "amber", tip: "Held transactions raised on this producer's book, awaiting an underwriter's decision." },
    ], true));

    var panel = ui.panel({ title: "Policies", what: "Every policy placed by " + spec.identity + ".", pad: 0 }, []);
    panel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Product", "Status", { label: "Premium", what: "Annual premium." }],
      rows: own.map(function (p) { return [ui.cellId(p.id), ui.cellName(p.holder), p.product, ui.badge(p.status), PAS.money(p.premium)]; }),
      emptyText: "No policies on file for this producer.",
      onRowClick: function (i) { location.href = "policy-detail.html?policy=" + encodeURIComponent(own[i].id); },
    }));
    page.appendChild(panel);
  }

  /* The end-customer portal. A real one would be a separate public-facing app with its own
     customer accounts — this reuses the internal shell's role system instead, scoped by `holder`
     the same way Broker/Producer is scoped by `producer`, since the goal here is real, working
     self-service functionality rather than a second application. First-person throughout: this
     is the one screen in the whole app written from the policyholder's side of the glass, not
     operations'. */
  function renderCustomerPortal(page, policies) {
    var spec = PAS.ROLES.Customer;
    var mine = PAS.scopePolicies(policies, "Customer");

    page.appendChild(ui.pageHeader({
      icon: "user", tone: "blue", title: "My Policies",
      sub: "Welcome back, " + spec.identity,
      what: "Your own policies only — coverage, documents and activity.", why: "Nothing here reaches any other customer's data or any internal desk.",
    }));

    if (mine.length === 0) {
      page.appendChild(ui.callout("info", "No policies found for " + spec.identity + "."));
      return;
    }

    mine.forEach(function (p) {
      page.appendChild(ui.kpiRow([
        { label: "Product", value: p.product, tip: "What this policy covers." },
        { label: "Status", value: p.status, tone: PAS.STATUS_TONE[p.status], tip: "Current lifecycle state." },
        { label: "Premium", value: PAS.money(p.premium), tip: "Annual premium for the current term." },
        { label: "Cover period", value: p.effectiveDate + " → " + p.expirationDate, tip: "Your current term." },
      ]));

      var grid = ui.h("div", { class: "two-col-grid" });

      var covPanel = ui.panel({ title: "Your coverage", what: p.id + " · " + p.sumInsured, why: "How your premium breaks down across what's actually covered." }, []);
      var covBody = covPanel.querySelector(".panel-body");
      var breakdown = PAS.coverageBreakdown(p);
      if (breakdown.length === 0) covBody.appendChild(ui.h("div", { class: "faint-note" }, "No coverage breakdown available for this product."));
      else {
        var maxCov = Math.max.apply(null, breakdown.map(function (c) { return c.premium; }));
        breakdown.forEach(function (c) { covBody.appendChild(ui.hbar({ label: c.name, value: c.premium, max: maxCov, note: PAS.money(c.premium), tone: c.premium === maxCov ? "indigo" : "blue" })); });
      }
      grid.appendChild(covPanel);

      var docPanel = ui.panel({ title: "Your documents", what: "Every schedule, certificate and notice issued to you.", pad: 0 }, []);
      docPanel.querySelector(".panel-body").appendChild(ui.dataTable({
        columns: ["Document", "Type", "Version", "Issued"],
        rows: (p.documents || []).map(function (d) { return [d.name, d.type, "v" + d.version, d.generatedAt]; }),
        emptyText: "No documents issued yet.",
      }));
      grid.appendChild(docPanel);
      page.appendChild(grid);

      var activityPanel = ui.panel({ title: "Recent activity", what: "Everything that's happened on this policy.", pad: 0 }, []);
      activityPanel.querySelector(".panel-body").appendChild(ui.dataTable({
        columns: ["Date", "What happened", "Status"],
        rows: p.history.slice().sort(function (a, b) { return b.seq - a.seq; }).slice(0, 8).map(function (h) {
          return [h.date, h.title, ui.txnStatusBadge(h.status)];
        }),
      }));
      page.appendChild(activityPanel);
    });

    page.appendChild(ui.logRequestForm({
      policies: mine,
      typeLabel: "service",
      initiatorKeys: ["Insured"],
      extraFields: function () { return null; },
      onSubmit: function (payload) {
        PAS.api.call("POST", "/api/v1/policies/" + payload.policyId + "/service-requests", { category: "Customer request", channel: payload.channel, notes: payload.note },
          { module: "Servicing", policyId: payload.policyId, statusCode: 201, label: "Service request — " + spec.identity, response: { serviceRequestId: PAS.uid("SRV"), status: "logged" } })
          .then(function () { PAS.logService(payload.policyId, { category: "Customer request", channel: payload.channel, notes: payload.note, sla: 24 }); render(); });
      },
    }));
  }

  function render() {
    var role = PAS.getRole();
    var policies = PAS.getPolicies();
    var page = ui.h("div", {});
    if (role === "MGA" || role === "Carrier") renderPortfolioDashboard(page, policies, role);
    else if (role === "Broker/Producer") renderBrokerDashboard(page, policies);
    else if (role === "Customer") renderCustomerPortal(page, policies);
    else renderUnderwriterDashboard(page, policies);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("dashboard", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
