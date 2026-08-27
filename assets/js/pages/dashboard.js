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

    /* Top 3 by in-force premium for each of the three distribution dimensions this dashboard
       now filters by — Broker, MGA, Carrier. Each is capped at 3 with a "See N others" toggle
       rather than always listing every one, so a long tail of low-volume producers can't push
       the card past its neighbors; expanding one doesn't collapse the others. */
    var TOP_ENTITY_ROWS = 3;
    var topGrid = ui.h("div", { class: "three-col-grid" });
    var topBrokerPanel = ui.panel({ title: "Top brokers", what: "In-force premium per broker, largest first.", why: "Which producers the book actually depends on.", right: openLink("brokers.html", "Open") }, []);
    var topBrokerBody = topBrokerPanel.querySelector(".panel-body");
    topGrid.appendChild(topBrokerPanel);
    var topMgaPanel = ui.panel({ title: "Top MGAs", what: "In-force premium per MGA, largest first.", why: "Which wholesale facilities are carrying the most bound risk.", right: openLink("mgas.html", "Open") }, []);
    var topMgaBody = topMgaPanel.querySelector(".panel-body");
    topGrid.appendChild(topMgaPanel);
    var topCarrierPanel = ui.panel({ title: "Top carriers", what: "In-force premium per carrier, largest first.", why: "Concentration on one carrier's paper is a placement risk.", right: openLink("carriers.html", "Open") }, []);
    var topCarrierBody = topCarrierPanel.querySelector(".panel-body");
    topGrid.appendChild(topCarrierPanel);
    page.appendChild(topGrid);

    var threeCol = ui.h("div", { class: "three-col-grid" });
    /* Capped so a growing book can't push the panel's height past its neighbors — each list is
       already sorted by what makes it most actionable, so the cap drops the least urgent items,
       never the most. */
    var RENEWAL_ROWS = 5, CANCEL_ROWS = 5;
    var renewalPanel = ui.panel({ title: "Renewal pipeline", what: "In-force policies by closeness to expiry, top " + RENEWAL_ROWS + " most urgent.", why: "Notices must be served " + PAS.RENEWAL_LEAD_DAYS + " days ahead.", right: openLink("renewal.html", "Open") }, []);
    var renewalBody = renewalPanel.querySelector(".panel-body");
    threeCol.appendChild(renewalPanel);
    var cancelPanel = ui.panel({ title: "Cancelled policy requests", what: "Open cancellation requests awaiting decision, top " + CANCEL_ROWS + " by refund amount.", why: "The biggest refund exposure among requests still awaiting a decision.", right: openLink("cancellation.html", "Open") }, []);
    var cancelBody = cancelPanel.querySelector(".panel-body");
    threeCol.appendChild(cancelPanel);
    var ENDORSE_ROWS = 5;
    var endorsePanel = ui.panel({ title: "Endorsement requests", what: "Open endorsement requests that increase premium, top " + ENDORSE_ROWS + " by increase.", why: "The biggest premium increases still awaiting a decision.", right: openLink("endorsement.html", "Open") }, []);
    var endorseBody = endorsePanel.querySelector(".panel-body");
    threeCol.appendChild(endorsePanel);
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

      var renewalSorted = active.slice().sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });
      renewalBody.innerHTML = "";
      renewalSorted.slice(0, RENEWAL_ROWS).forEach(function (p) {
        var rc = PAS.renewalCompliance(p);
        renewalBody.appendChild(ui.hbar({ label: p.holder, value: Math.max(0, 365 - rc.daysToExpiry), max: 365, note: rc.daysToExpiry + "d left", tone: rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red" }));
      });
      if (renewalSorted.length > RENEWAL_ROWS) {
        renewalBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing the " + RENEWAL_ROWS + " closest to expiry, of " + renewalSorted.length + " in force."));
        renewalBody.appendChild(openLink("renewal.html", "View more"));
      }

      /* Open cancellation requests, ranked by refund amount — biggest exposure first. Same live
         quote (reason + initiatedBy + effective date → cancelQuote) the Cancellation desk itself
         shows for these same rows, so the two screens can never disagree. */
      var pendingCancellations = PAS.pendingOf(policies, "Cancellation").map(function (t) {
        var meta = t.h.meta || {};
        var reason = meta.reason || "Insured Request";
        var initiatedBy = meta.initiatedBy || "Insured";
        var effDate = t.h.date || PAS.todayISO();
        var quote = PAS.cancelQuote(t.p, reason, initiatedBy, effDate);
        return { p: t.p, reason: reason, refund: Math.round(quote.refund) };
      }).sort(function (a, b) { return b.refund - a.refund; });
      cancelBody.innerHTML = "";
      if (pendingCancellations.length === 0) cancelBody.appendChild(ui.h("div", { class: "faint-note" }, "No open cancellation requests."));
      else {
        var maxRefund = Math.max.apply(null, pendingCancellations.map(function (x) { return x.refund; }).concat([1]));
        pendingCancellations.slice(0, CANCEL_ROWS).forEach(function (x) {
          cancelBody.appendChild(ui.hbar({ label: x.p.holder, value: x.refund, max: maxRefund, note: PAS.money(x.refund) + " · " + x.reason, tone: x.refund === maxRefund ? "red" : "amber" }));
        });
        if (pendingCancellations.length > CANCEL_ROWS) {
          cancelBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing " + CANCEL_ROWS + " of " + pendingCancellations.length + " open requests."));
          cancelBody.appendChild(openLink("cancellation.html", "View more"));
        }
      }

      /* Open endorsement requests, ranked by how much they'd raise premium — a decrease or a
         no-impact change (e.g. a plain address update) isn't what this panel is for, so only
         real increases are listed. */
      var pendingEndorsements = PAS.pendingOf(policies, "Endorsement").map(function (t) {
        return { p: t.p, impact: Math.round((t.h.meta && t.h.meta.premiumImpact) || 0) };
      }).filter(function (x) { return x.impact > 0; }).sort(function (a, b) { return b.impact - a.impact; });
      endorseBody.innerHTML = "";
      if (pendingEndorsements.length === 0) endorseBody.appendChild(ui.h("div", { class: "faint-note" }, "No open endorsement requests increasing premium."));
      else {
        var maxImpact = Math.max.apply(null, pendingEndorsements.map(function (x) { return x.impact; }).concat([1]));
        pendingEndorsements.slice(0, ENDORSE_ROWS).forEach(function (x) {
          endorseBody.appendChild(ui.hbar({ label: x.p.holder, value: x.impact, max: maxImpact, note: "+" + PAS.money(x.impact), tone: x.impact === maxImpact ? "red" : "amber" }));
        });
        if (pendingEndorsements.length > ENDORSE_ROWS) {
          endorseBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing " + ENDORSE_ROWS + " of " + pendingEndorsements.length + " open requests increasing premium."));
          endorseBody.appendChild(openLink("endorsement.html", "View more"));
        }
      }
    }

    /* Expand/collapse state per card, kept outside buildTopEntities so it survives every rebuild
       (a filter change or period switch) rather than resetting to collapsed each time. */
    var brokerState = { expanded: false }, mgaState = { expanded: false }, carrierState = { expanded: false };
    function buildRankedList(body, list, field, state) {
      var keys = Array.from(new Set(list.map(function (p) { return p[field]; }).filter(Boolean)));
      var rows = keys.map(function (k) {
        return {
          k: k,
          v: sum(list.filter(function (p) { return p[field] === k && p.status === "Active"; }), function (p) { return p.premium; }),
          n: list.filter(function (p) { return p[field] === k; }).length,
        };
      }).sort(function (a, b) { return b.v - a.v; });
      var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
      body.innerHTML = "";
      if (rows.length === 0) { body.appendChild(ui.h("div", { class: "faint-note" }, "No records in this filter.")); return; }
      var shown = state.expanded ? rows : rows.slice(0, TOP_ENTITY_ROWS);
      shown.forEach(function (r) { body.appendChild(ui.hbar({ label: r.k, value: r.v, max: max, note: PAS.moneyShort(r.v) + " · " + r.n + " pol", tone: r.v === max ? "indigo" : "blue" })); });
      if (rows.length > TOP_ENTITY_ROWS) {
        var btn = ui.h("button", { class: "btn ghost-link mt-6" }, state.expanded ? "Show top " + TOP_ENTITY_ROWS + " only" : "See " + (rows.length - TOP_ENTITY_ROWS) + " others");
        btn.addEventListener("click", function () { state.expanded = !state.expanded; buildTopEntities(); });
        body.appendChild(btn);
      }
    }
    function buildTopEntities() {
      var policies = scopedPolicies();
      buildRankedList(topBrokerBody, policies, "producer", brokerState);
      buildRankedList(topMgaBody, policies, "mga", mgaState);
      buildRankedList(topCarrierBody, policies, "carrier", carrierState);
    }

    function buildAll() { renderToggle(); buildKpis(); buildChart(); buildSnapshotPanels(); buildTopEntities(); }
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

    page.appendChild(ui.kpiRow([
      { label: "In-force premium", value: PAS.moneyShort(inForcePremium), tone: "green", tip: "Sum of annual premium across in-force policies, as of today." },
      { label: "Active policies", value: active.length, tip: "In force as of today, of " + policies.length + " total records." },
      { label: "Avg premium", value: PAS.moneyShort(active.length ? inForcePremium / active.length : 0), tip: "Mean annual premium per in-force policy." },
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
       of premium by broker, which would otherwise be one bar, always themselves. Everyone else
       (MGA, and any future scoped role) sees the traditional broker breakdown. */
    var secondDim = spec.scope === "producer" ? "mga" : "producer";
    var secondLabel = spec.scope === "producer" ? "MGA" : "Broker";
    var secondTitle = spec.scope === "producer" ? "Premium by MGA" : "Premium by broker";
    var secondWhat = spec.scope === "producer" ? "In-force premium per MGA facility this book is placed through." : "In-force premium per placing broker, Direct included.";
    var secondWhy = spec.scope === "producer" ? "Shows which wholesale facilities this book actually depends on." : "Shows which distribution channel the book actually depends on.";

    /* stateGrid/lobGrid/issuancePanel are built now (their bodies are wired into renderCharts
       below) but not appended to `page` yet — they're added further down, after the period
       toggle, so the toggle reads at the top of the page (same position it has on the
       Super Admin/Admin dashboard) rather than buried beneath the panels it doesn't even
       control. */
    var stateGrid = ui.h("div", { class: "two-col-grid" });
    var stateTopOnly = spec.scope === "producer";
    var statePanel = ui.panel({ title: stateTopOnly ? "Premium by state (top 5)" : "Premium by state", what: stateTopOnly ? "Top 5 states by in-force premium, largest first." : "In-force premium per state, largest first.", why: "State-level concentration matters for regulatory exposure and catastrophe accumulation." }, []);
    var stateBody = statePanel.querySelector(".panel-body");
    stateGrid.appendChild(statePanel);
    var brokerPanel = ui.panel({ title: secondTitle, what: secondWhat, why: secondWhy }, []);
    var brokerBody = brokerPanel.querySelector(".panel-body");
    stateGrid.appendChild(brokerPanel);

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

    var filterState = [], filterProduct = [], filterSecondDim = [], filterCarrier = [];
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
          && matchesMulti(filterSecondDim, p[secondDim]) && matchesMulti(filterCarrier, p.carrier);
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

    var carrierGroup = ui.h("div", {});
    carrierGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Carrier"));
    carrierGroup.appendChild(ui.multiSelect({ options: carrierOptions, selected: filterCarrier, allLabel: "All carriers", onChange: function (sel) { filterCarrier = sel; refresh(); } }));
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
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--text)", minWidth: "108px", textAlign: "center" } });
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
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--text-faint)", fontSize: "12px" } }, "to"));
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
