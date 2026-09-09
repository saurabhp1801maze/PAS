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

  /* Where a segment/entity name actually drills into — the Policy Register when the dimension is
     one it can filter (product, state), or that entity's own directory page when it's a
     distribution-chain partner the Register has no filter for (Broker, MGA, Reinsurer). Shared by
     both the full operational dashboard and the scoped Broker/MGA/Carrier one, so the same name
     always lands in the same place no matter which dashboard or panel it was clicked from. */
  function drilldownHref(dim, name) {
    if (dim === "product") return "registry.html?product=" + encodeURIComponent(name);
    if (dim === "state") return "registry.html?state=" + encodeURIComponent(name);
    if (dim === "producer") return "brokers.html?broker=" + encodeURIComponent(name);
    if (dim === "mga") return "mgas.html?mga=" + encodeURIComponent(name);
    if (dim === "carrier") return "carriers.html?carrier=" + encodeURIComponent(name);
    return null;
  }
  /* A bare, underline-on-hover text link — same look ui.hbar's own clickable label uses — for
     naming a clickable cell inside a data table, where a full button's chrome would look wrong. */
  function linkCell(text, href) {
    if (!href) return text;
    var btn = ui.h("button", { class: "hbar-label-link", type: "button", style: { fontWeight: "700" } }, text);
    btn.addEventListener("click", function (e) { e.stopPropagation(); location.href = href; });
    return btn;
  }
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
  function pad2(n) { return String(n).padStart(2, "0"); }
  /* [fromISO, toISO] — the real calendar bounds of whichever period/offset (or custom range) is
     currently selected. Drives PAS.bookFinancialsInWindow so the Financial performance section can
     answer "what did this book do in the selected period" rather than only "as of today". */
  function periodBounds(period, offset, customFrom, customTo) {
    if (period === "custom") return [customFrom, customTo];
    if (period === "year") { var y = yearOffset(offset); return [y + "-01-01", y + "-12-31"]; }
    if (period === "quarter") {
      var qKey = quarterKeyOffset(offset), qy = Number(qKey.slice(0, 4)), q = Number(qKey.slice(6));
      var firstMonth0 = (q - 1) * 3;
      var from = qy + "-" + pad2(firstMonth0 + 1) + "-01";
      var lastDay = new Date(Date.UTC(qy, firstMonth0 + 3, 0));
      var to = lastDay.getUTCFullYear() + "-" + pad2(lastDay.getUTCMonth() + 1) + "-" + pad2(lastDay.getUTCDate());
      return [from, to];
    }
    var mk = monthKeyOffset(offset), my = Number(mk.slice(0, 4)), mm0 = Number(mk.slice(5, 7)) - 1;
    var mLast = new Date(Date.UTC(my, mm0 + 1, 0));
    return [mk + "-01", mLast.getUTCFullYear() + "-" + pad2(mLast.getUTCMonth() + 1) + "-" + pad2(mLast.getUTCDate())];
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
  function displayDate(iso) {
    if (!iso) return "—";
    return MONTH_NAMES[Number(iso.slice(5, 7)) - 1] + " " + Number(iso.slice(8, 10)) + ", " + iso.slice(0, 4);
  }

  /* The dashboard is the one screen every role lands on. Full-access roles (Super Admin, Admin)
     get the operational view below unchanged; any role scoped to less than the whole book (MGA,
     Broker, or a future custom role) gets the shared scoped analytics view instead
     (renderScopedDashboard) — same layout for every scoped role, real data per role's own book. */
  function renderUnderwriterDashboard(page, allPolicies) {
    var period = "all"; /* default: whole book, so the dashboard opens on the full lifetime view */
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
      if (carrierFilter.length) parts.push("reinsurer " + carrierFilter.join("/"));
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
      if (period === "all") return !!dateStr;
      if (period === "month") return inMonth(dateStr, monthKeyOffset(periodOffset));
      if (period === "quarter") return inQuarter(dateStr, quarterKeyOffset(periodOffset));
      if (period === "year") return inYear(dateStr, yearOffset(periodOffset));
      return !!dateStr && dateStr >= customFrom && dateStr <= customTo; /* custom range, inclusive */
    }
    function periodNoteText() {
      if (period === "all") return "across the whole book";
      if (period === "month") { var mk = monthKeyOffset(periodOffset); return "in " + MONTH_NAMES[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4); }
      if (period === "quarter") return "in " + quarterKeyOffset(periodOffset);
      if (period === "year") return "in " + yearOffset(periodOffset);
      return "from " + customFrom + " to " + customTo;
    }

    /* Referenced by the click handler below, assigned once the five multiSelect widgets exist
       further down this function — safe because the handler only runs on click, well after the
       whole page has finished building, even though this button itself is created first so it can
       sit in the page header's top-right corner. */
    var resetFiltersBtn = ui.h("button", { class: "btn", type: "button" }, [PAS.icon("x-circle", { size: 13 }), document.createTextNode(" Reset filters")]);
    resetFiltersBtn.addEventListener("click", function () {
      lobFilter = []; stateFilter = []; brokerFilter = []; mgaFilter = []; carrierFilter = [];
      lobMS.setSelected([]); stateMS.setSelected([]); brokerMS.setSelected([]); mgaMS.setSelected([]); carrierMS.setSelected([]);
      buildAll();
    });
    page.appendChild(ui.pageHeader({
      icon: "layout-dashboard", tone: "indigo", title: "Portfolio Dashboard",
      sub: "Portfolio performance and operational workload by line of business, state, broker, MGA and reinsurer",
      right: resetFiltersBtn,
    }));

    /* One wrapping row, every filter a same-shaped group (label above control) — the pattern
       already used by the register/workbench filter bars, so the dashboard doesn't invent its
       own layout. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    page.appendChild(filterBlock);
    var updateStatus = ui.h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" });

    var lobGroup = ui.h("div", {});
    lobGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Line of business"));
    var lobMS = lobGroup.appendChild(ui.multiSelect({ options: lobOptions, selected: lobFilter, allLabel: "All lines", onChange: function (sel) { lobFilter = sel; buildAll(); } }));
    filterBlock.appendChild(lobGroup);

    var stateGroup = ui.h("div", {});
    stateGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "State"));
    var stateMS = stateGroup.appendChild(ui.multiSelect({ options: stateOptions, selected: stateFilter, allLabel: "All states", onChange: function (sel) { stateFilter = sel; buildAll(); } }));
    filterBlock.appendChild(stateGroup);

    var brokerGroup = ui.h("div", {});
    brokerGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Broker"));
    var brokerMS = brokerGroup.appendChild(ui.multiSelect({ options: brokerOptions, selected: brokerFilter, allLabel: "All brokers", onChange: function (sel) { brokerFilter = sel; buildAll(); } }));
    filterBlock.appendChild(brokerGroup);

    var mgaGroup = ui.h("div", {});
    mgaGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "MGA"));
    var mgaMS = mgaGroup.appendChild(ui.multiSelect({ options: mgaOptions, selected: mgaFilter, allLabel: "All MGAs", onChange: function (sel) { mgaFilter = sel; buildAll(); } }));
    filterBlock.appendChild(mgaGroup);

    var carrierGroup = ui.h("div", {});
    carrierGroup.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Reinsurer"));
    var carrierMS = carrierGroup.appendChild(ui.multiSelect({ options: carrierOptions, selected: carrierFilter, allLabel: "All reinsurers", onChange: function (sel) { carrierFilter = sel; buildAll(); } }));
    filterBlock.appendChild(carrierGroup);

    var toggleRow = ui.h("div", { class: "period-toggle-row" });
    toggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Reporting period"));
    var toggleAndNav = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "10px" }, role: "group", "aria-label": "Reporting period" });
    var toggle = ui.h("div", { class: "period-toggle", role: "group", "aria-label": "Period type" });
    toggleAndNav.appendChild(toggle);
    /* ◀ current-period-label ▶ — steps periodOffset back/forward one unit of whatever period is
       selected (a month, a quarter, a year). Forward is disabled at offset 0: this book has no
       data past today, so "next" would only ever land on an empty period. Hidden entirely in
       custom-range mode, where the date pair below is the only control. */
    var navWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    var prevBtn = ui.h("button", { class: "btn ghost-link", title: "Previous period", "aria-label": "Previous reporting period" }, "◀");
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = ui.h("button", { class: "btn ghost-link", title: "Next period", "aria-label": "Next reporting period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    prevBtn.addEventListener("click", function () { periodOffset -= 1; buildAll(); });
    nextBtn.addEventListener("click", function () { if (periodOffset < 0) { periodOffset += 1; buildAll(); } });
    page.appendChild(toggleRow);

    /* Custom range is one of the reporting-period choices, not a separate hierarchy level. */
    var customBtn = ui.h("button", { class: "chip", type: "button", "aria-pressed": "false" }, "Custom dates");
    toggle.appendChild(customBtn);
    customBtn.addEventListener("click", function () { period = period === "custom" ? "month" : "custom"; periodOffset = 0; buildAll(); });

    /* Only visible when period === "custom" — a plain date pair, inclusive on both ends. */
    var rangeRow = ui.h("div", { class: "period-toggle-row" });
    rangeRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Date range"));
    var rangeWrap = ui.h("div", { class: "date-range-controls" });
    var fromInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customFrom, "aria-label": "Reporting period start date" });
    var toInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customTo, "aria-label": "Reporting period end date" });
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--color-muted)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    page.appendChild(rangeRow);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; buildAll(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; buildAll(); });
    page.appendChild(updateStatus);

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

    /* The panel that answers "which is loss, where profit, and how many claims is that actually
       resting on" in one place. This used to be two separate panels — this table (premium/ratios)
       up here, and a "Top claim segments" bar chart further down under Lifetime claims performance
       — so reading "Comprehensive Auto is at 118% loss ratio" and "backed by 14 claims" meant scrolling
       between them and manually matching the segment name by eye. The claim count now sits right
       next to the incurred-claims dollar figure it explains, both on the same row as the premium
       and ratios they're computed from — one table, no cross-referencing. Ranked worst-first by
       combined ratio by default (the loss-making segments are the ones anyone actually needs to
       act on), but every column header is click-to-sort — including Claims, so "which segment has
       the most claims" (what the old separate chart ranked by) is still one click away, not a
       separate panel. */
    var SEGMENT_DIMS = [
      { key: "product", label: "Line of business" },
      { key: "state", label: "State" },
      { key: "producer", label: "Broker" },
      { key: "mga", label: "MGA" },
    ];
    var segmentDim = "product";
    /* Which metric ranks the rows — a separate question from which dimension groups them (the
       chips above). Every option here mirrors a real column in the table below, so "sorted by
       X" always names a column actually on screen. Combined ratio is the default because it's
       the single number that answers "is this segment losing money" — same ordering the table
       used before this control existed. All bases rank worst/largest first (desc): for the
       ratios that means worst first, for the dollar/count columns it means biggest first —
       clicking a column header still works and overrides this for that column. */
    var SEGMENT_SORT_BASES = [
      { key: "combinedRatio", label: "Indicative combined ratio", sortValue: function (s) { return s.f.combinedRatio; } },
      { key: "lossRatio", label: "Loss ratio", sortValue: function (s) { return s.f.lossRatio; } },
      { key: "expenseRatio", label: "Acquisition expense ratio", sortValue: function (s) { return s.f.expenseRatio; } },
      { key: "claimCount", label: "Claims", sortValue: function (s) { return s.f.claimCount; } },
      { key: "incurred", label: "Incurred claims", sortValue: function (s) { return s.f.incurred; } },
      { key: "earnedPremium", label: "Earned premium", sortValue: function (s) { return s.f.earnedPremium; } },
      { key: "netCommission", label: "Net commission", sortValue: function (s) { return s.f.netCommission; } },
      { key: "policies", label: "Policies", sortValue: function (s) { return s.n; } },
    ];
    var segmentSortBasis = SEGMENT_SORT_BASES[0].key;
    var segmentSortSelect = ui.h("select", { class: "register-select", "aria-label": "Sort performance by", style: { maxWidth: "185px" } });
    SEGMENT_SORT_BASES.forEach(function (s) { segmentSortSelect.appendChild(ui.h("option", { value: s.key }, s.label)); });
    segmentSortSelect.value = segmentSortBasis;
    segmentSortSelect.addEventListener("change", function () { segmentSortBasis = segmentSortSelect.value; buildFinancials(); });
    var segmentRight = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } });
    var segmentChipRow = ui.h("div", { class: "chip-row" });
    SEGMENT_DIMS.forEach(function (d) {
      var chip = ui.h("button", { class: "chip" + (segmentDim === d.key ? " active" : ""), type: "button", "aria-pressed": String(segmentDim === d.key) }, d.label);
      chip.addEventListener("click", function () { segmentDim = d.key; buildFinancials(); });
      segmentChipRow.appendChild(chip);
    });
    segmentRight.appendChild(segmentChipRow);
    segmentRight.appendChild(ui.h("span", { class: "faint-note", style: { whiteSpace: "nowrap" } }, "Sort by"));
    segmentRight.appendChild(segmentSortSelect);
    var segmentPanel = ui.panel({
      title: "Performance by segment",
      collapsible: true,
      right: segmentRight,
    }, []);
    var segmentBody = segmentPanel.querySelector(".panel-body");
    page.appendChild(segmentPanel);

    page.appendChild(ui.h("div", { class: "kpi-section-head", style: { marginTop: "26px" } }, [
      ui.h("span", { class: "kpi-section-label" }, "Operations"),
      ui.h("span", { class: "kpi-section-sub" }, "Current queues and completed activity for the selected reporting period"),
    ]));

    var kpiContainer = ui.h("div", {});
    page.appendChild(kpiContainer);

    /* Portfolio concentration comes before the historical trend charts in the operations
       workflow. Open work queues used to sit right next to it in a two-col-grid — it now moves to
       the very end of the page (see queuePanelSlot below), so this holds Portfolio concentration
       alone, full width, rather than half-width with an empty column beside it. 14px bottom margin
       matches the two-col-grid immediately below it (chartGrid) — a lone .panel carries no margin
       of its own, so without this it sat flush against the next panel with no gap at all. */
    var topPanelSlot = ui.h("div", { style: { marginBottom: "14px" } });
    page.appendChild(topPanelSlot);

    var chartGrid = ui.h("div", { class: "two-col-grid" });
    var chartPanel = ui.panel({ title: "Renewal, cancellation & reinstatement activity", collapsible: true }, []);
    var chartBody = chartPanel.querySelector(".panel-body");
    chartGrid.appendChild(chartPanel);
    var issuancePanel = ui.panel({ title: "New policies issued", collapsible: true }, []);
    var issuanceBody = issuancePanel.querySelector(".panel-body");
    chartGrid.appendChild(issuancePanel);
    page.appendChild(chartGrid);

    function renderToggle() {
      toggle.innerHTML = "";
      [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"], ["all", "All history"]].forEach(function (opt) {
        var btn = ui.h("button", { class: "chip" + (period === opt[0] ? " active" : ""), type: "button", "aria-pressed": String(period === opt[0]) }, opt[1]);
        btn.addEventListener("click", function () { if (period !== opt[0]) { period = opt[0]; periodOffset = 0; buildAll(); } });
        toggle.appendChild(btn);
      });
      toggle.appendChild(customBtn);
      customBtn.className = "chip" + (period === "custom" ? " active" : "");
      customBtn.setAttribute("aria-pressed", String(period === "custom"));
      /* "All" has no offset to step through (there's no "previous All") any more than custom range
         does — its date span is however much history the book has, not a nameable unit. */
      navWrap.style.display = (period === "custom" || period === "all") ? "none" : "flex";
      rangeRow.style.display = period === "custom" ? "" : "none";
      if (period !== "custom" && period !== "all") {
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
      /* "Expiring soon" is a bounded, forward-looking idea — under "All" every active policy's
         term ends at *some* point, so periodMatches (which just means "has a date" there) would
         trivially match every one of them and duplicate Active policies exactly. Falls back to a
         fixed 30-day lookahead instead, so "All" still shows a real near-term renewal queue rather
         than a degenerate, always-100% count. */
      var expiringSoonWindow = period === "all";
      var expiring = expiringSoonWindow
        ? active.filter(function (p) { return p.expirationDate >= PAS.todayISO() && p.expirationDate <= PAS.addDays(PAS.todayISO(), 30); }).length
        : active.filter(function (p) { return periodMatches(p.expirationDate); }).length;
      var periodNote = periodNoteText();
      /* Not period-scoped, same reasoning as Pending approvals below — it's the live count of
         requests sitting in the Endorsement desk's queue right now, not a completed-this-period
         figure. */
      var endorsementPending = PAS.pendingOf(policies, "Endorsement").length;

      kpiContainer.innerHTML = "";
      kpiContainer.appendChild(ui.kpiSection({
        label: "Current position and workload",
        sub: "As of " + displayDate(PAS.todayISO()),
        rowClass: "operations-kpi-row",
      }, [
        { label: "Total policies", value: policies.length, href: "registry.html", tip: "Current total records in this filtered portfolio." },
        { label: "Active policies", value: active.length, tone: "green", href: "registry.html?status=Active", tip: "Policies in force as of " + displayDate(PAS.todayISO()) + "." },
        { label: expiringSoonWindow ? "Policies expiring in 30 days" : "Policies expiring in period", value: expiring, tone: expiring > 0 ? "amber" : "gray", href: "renewal.html", tip: expiringSoonWindow ? "Active policies whose term ends within the next 30 days." : ("Active policies whose term ends " + periodNote + ".") },
        { label: "Pending endorsement requests", value: endorsementPending, tone: endorsementPending > 0 ? "amber" : "gray", href: "endorsement.html" },
        { label: "Pending approvals", value: pending.length, tone: "red", href: "approvals.html", tip: "Transactions awaiting approval now; underwriting referrals are handled separately." },
        { label: "Bound, awaiting automatic issuance", value: bound.length, tone: bound.length > 0 ? "amber" : "gray", href: "issue.html", tip: "Bound policies waiting for automatic issuance after all blockers are cleared." },
      ]));
      kpiContainer.appendChild(ui.kpiSection({
        label: "Completed in selected period",
        sub: periodNote.replace(/^in /, ""),
        rowClass: "operations-kpi-row",
      }, [
        { label: "Renewals completed", value: renewed, tone: "blue", href: "renewal.html" },
        { label: "Reinstatements completed", value: reinstated, tone: reinstated > 0 ? "green" : "gray", href: "reinstatement.html" },
        { label: "Cancellations completed", value: cancelled, tone: cancelled > 0 ? "red" : "gray", href: "cancellation.html" },
      ]));
    }

    /* Shared period-bucketing: both the left chart and the right graph read the same trailing
       window and the same real ledger dates, so they can never disagree with each other or with
       the KPI cards above. */
    function bucketData(seriesList) {
      var policies = scopedPolicies();
      var keys = period === "month" ? trailingMonths(6, periodOffset) : period === "quarter" ? trailingQuarters(6, periodOffset)
        : (period === "year" || period === "all") ? trailingYears(period === "all" ? 6 : 4, periodOffset) : ["custom"]; /* one bucket: custom range only */
      var matches = period === "month" ? inMonth : period === "quarter" ? inQuarter
        : (period === "year" || period === "all") ? inYear : function (dateStr) { return periodMatches(dateStr); };
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
      if (period === "year" || period === "all") return String(key);
      return customFrom + " – " + customTo;
    }
    function windowNote() {
      if (period === "month") return "Trailing 6 months, completed transactions by their effective date.";
      if (period === "quarter") return "Trailing 6 quarters, completed transactions by their effective date.";
      if (period === "year") return "Trailing 4 years, completed transactions by their effective date.";
      /* All history still shows a trend rather than one flattened bucket — the last 6 calendar
         years, same trailingYears mechanics as the Yearly toggle, just a longer window since
         "All" has no periodOffset navigation to page through more of them. */
      if (period === "all") return "Trailing 6 years, completed transactions by their effective date.";
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

      var chartSummary = data.map(function (row) {
        return periodLabel(row.key) + ": " + seriesList.map(function (s) { return s.label + " " + row[s.type]; }).join(", ");
      }).join("; ");
      var chart = ui.h("div", { class: "trend-bar-chart", role: "img", "aria-label": "Policy servicing activity. " + chartSummary });
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
        item.appendChild(ui.h("span", { class: "trend-legend-swatch", style: { background: "var(--" + s.tone + ")" }, "aria-hidden": "true" }));
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
      var data = bucketData(seriesList);
      drawTrendGraph(container, seriesList, data, periodLabel, windowNote());
      container.setAttribute("role", "img");
      container.setAttribute("aria-label", "New policies issued. " + data.map(function (row) {
        return periodLabel(row.key) + ": " + row[seriesList[0].type];
      }).join("; "));
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
    var snapshotHead = ui.h("div", { class: "kpi-section-head", style: { marginTop: "26px" } }, [
      ui.h("span", { class: "kpi-section-label" }, "Current portfolio snapshot"),
      ui.h("span", { class: "kpi-section-sub" }, "As of " + displayDate(PAS.todayISO()) + " — portfolio filters apply; reporting period does not"),
    ]);
    page.appendChild(snapshotHead);
    var twoCol = ui.h("div", { class: "two-col-grid" });
    var prodPanel = ui.panel({ title: "In-force premium by line of business", collapsible: true }, []);
    var prodBody = prodPanel.querySelector(".panel-body");
    twoCol.appendChild(prodPanel);
    var compPanel = ui.panel({ title: "Policies by lifecycle status", collapsible: true }, []);
    var compBody = compPanel.querySelector(".panel-body");
    twoCol.appendChild(compPanel);
    page.appendChild(twoCol);

    /* Claims & loss ratio: the panel this dashboard didn't have before (MOM 2026-08-26) — real
       claim records (PAS.CLAIMS_BY_ID), not an asserted number, broken out by product and state so
       "which is loss, where profit" is a chart read, not a spreadsheet exercise. Loss ratio =
       incurred claims ÷ earned premium, the standard industry figure underwriting appetite and
       renewal-pricing decisions actually turn on. */
    var claimsHead = ui.h("div", { class: "kpi-section-head", style: { marginTop: "26px" } }, [
      ui.h("span", { class: "kpi-section-label" }, "Lifetime claims performance"),
      ui.h("span", { class: "kpi-section-sub" }, "All on-risk history — internal review threshold: 85%; reporting period does not apply"),
    ]);
    page.appendChild(claimsHead);
    var claimsGrid = ui.h("div", { class: "two-col-grid" });
    var lossByProductPanel = ui.panel({
      title: "Lifetime loss ratio by line of business",
      what: "Incurred claims divided by earned premium for each line of business across all on-risk history.",
      why: "Above 100% means claims alone exceed earned premium. The 85% alert is a review threshold, not proof of an underwriting loss; use combined ratio for profitability.",
      collapsible: true,
    }, []);
    var lossByProductBody = lossByProductPanel.querySelector(".panel-body");
    claimsGrid.appendChild(lossByProductPanel);
    var lossByStatePanel = ui.panel({
      title: "Lifetime loss ratio by state",
      what: "Incurred claims divided by earned premium for the eight states with the highest ratios.",
      why: "Use claim counts as context: a state with only one claim can show a volatile ratio.",
      collapsible: true,
    }, []);
    var lossByStateBody = lossByStatePanel.querySelector(".panel-body");
    claimsGrid.appendChild(lossByStatePanel);
    page.appendChild(claimsGrid);

    var claimsCalloutWrap = ui.h("div", {});
    page.appendChild(claimsCalloutWrap);

    /* Open work queues moves to the very last section of the page — reserved here, before the
       panel itself exists (it's built further down, alongside Portfolio concentration), so its
       final page position is set now rather than wherever its construction happens to sit in the
       source. */
    var queuePanelSlot = ui.h("div", { style: { marginTop: "26px" } });
    /* "Open work queues" temporarily removed from the dashboard — commented out, not deleted, so
       it can be restored by uncommenting this one line. The panel is still built and populated
       below (queuePanel/buildQueues) into this detached slot; it just never gets attached to the
       page, so nothing renders. */
    // page.appendChild(queuePanelSlot);

    /* ---- Top performers: one panel, switchable dimension and switchable ranking basis ----
       This was three fixed side-by-side cards (brokers / MGAs / insurers). One panel with a
       dropdown asks the same ranking question of any distribution-chain dimension — Broker, MGA
       or Reinsurer, the three real counterpart fields a policy carries. The row cap rises from 3
       to 5 now that the panel has the full page width rather than a third of it. */
    var TOP_ENTITY_ROWS = 5;
    var TOP_DIMS = [
      { key: "producer", label: "Brokers", note: "By broker, largest first — showing distribution concentration, not performance. Direct means business written without a producing broker.", href: "brokers.html" },
      { key: "mga", label: "MGAs", note: "By MGA facility, largest first — showing binding-authority concentration.", href: "mgas.html" },
      { key: "carrier", label: "Reinsurers", note: "By reinsurer, largest first — showing concentration on each reinsurer's paper.", href: "carriers.html" },
    ];
    /* What "top 5" actually ranks by — a separate control from which dimension is grouped, so
       "biggest by premium" and "biggest by policy count" can both be asked of the same Broker/MGA/
       Reinsurer breakdown without needing three panels. Percent-of-total only makes sense for the
       additive bases (premium, policy count, claims) — averaging averages isn't meaningful, so the avg-
       premium basis note leaves that figure out rather than show a bogus percentage. */
    var TOP_SORT_BASES = [
      { key: "premium", label: "In-force premium", sortValue: function (r) { return r.premium; } },
      { key: "policies", label: "Number of policies", sortValue: function (r) { return r.n; } },
      { key: "avgPremium", label: "Average premium", sortValue: function (r) { return r.avgPremium; } },
      { key: "claims", label: "Claims", sortValue: function (r) { return r.claimCount; } },
    ];
    var topDim = TOP_DIMS[0].key;
    var topSortBasis = TOP_SORT_BASES[0].key;
    var topSelect = ui.h("select", { class: "register-select", "aria-label": "Group portfolio concentration by" });
    TOP_DIMS.forEach(function (d) { topSelect.appendChild(ui.h("option", { value: d.key }, d.label)); });
    /* Plain metric names, same convention as topSelect's own options — no "Rank by " verb prefix,
       which pushed the longest option ("Rank by Average premium per policy") past .register-
       select's shared 168px max-width and clipped it mid-word. The wider max-width here is a
       per-control override, not a change to that shared class — every other .register-select on
       this page and across the app shows much shorter text and doesn't need it. */
    var topSortSelect = ui.h("select", { class: "register-select", "aria-label": "Rank top 5 by", style: { maxWidth: "185px" } });
    TOP_SORT_BASES.forEach(function (s) { topSortSelect.appendChild(ui.h("option", { value: s.key }, s.label)); });
    var topLinkWrap = ui.h("span", {});
    var topRight = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    topRight.appendChild(topSelect);
    topRight.appendChild(topSortSelect);
    topRight.appendChild(topLinkWrap);
    var topPanel = ui.panel({
      title: "Portfolio concentration",
      right: topRight,
      collapsible: true,
    }, []);
    var topBody = topPanel.querySelector(".panel-body");
    topSelect.addEventListener("change", function () { topDim = topSelect.value; buildTopEntities(); });
    topSortSelect.addEventListener("change", function () { topSortBasis = topSortSelect.value; buildTopEntities(); });

    /* ---- Open work queues: one panel, switchable queue ----
       Same consolidation, and the same gain: Reinstatement had no card before (there were only
       three columns) even though it is a real desk with real pending requests. Each queue stays
       capped and sorted by what makes it most actionable, so the cap drops the least urgent
       items, never the most. */
    var QUEUE_ROWS = 5;
    var QUEUES = [
      { key: "renewal", label: "Renewal pipeline", href: "renewal.html", note: "In-force policies by closeness to expiry, " + QUEUE_ROWS + " most urgent. Notices must be served " + PAS.RENEWAL_LEAD_DAYS + " days ahead." },
      { key: "cancellation", label: "Cancellation requests", href: "cancellation.html", note: "Open cancellation requests awaiting decision, top " + QUEUE_ROWS + " by refund amount — the biggest refund exposure still undecided." },
      { key: "reinstatement", label: "Reinstatement requests", href: "reinstatement.html", note: "Open reinstatement requests, soonest to fall outside the " + PAS.REINSTATEMENT_WINDOW_DAYS + "-day window first — eligibility expires, so these are time-critical." },
      { key: "endorsement", label: "Endorsement requests", href: "endorsement.html", note: "Open endorsement requests that increase premium, top " + QUEUE_ROWS + " by increase." },
    ];
    var queueKey = QUEUES[0].key;
    var queueSelect = ui.h("select", { class: "register-select", "aria-label": "Choose work queue" });
    QUEUES.forEach(function (q) { queueSelect.appendChild(ui.h("option", { value: q.key }, q.label)); });
    var queueLinkWrap = ui.h("span", {});
    var queueRight = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    queueRight.appendChild(queueSelect);
    queueRight.appendChild(queueLinkWrap);
    var queuePanel = ui.panel({
      title: "Open work queues",
      right: queueRight,
      collapsible: true,
    }, []);
    var queueBody = queuePanel.querySelector(".panel-body");
    queuePanelSlot.appendChild(queuePanel);
    topPanelSlot.appendChild(topPanel);
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
      byProduct.forEach(function (x) { prodBody.appendChild(ui.hbar({ label: x.pr, value: x.v, max: maxP, note: PAS.moneyShort(x.v) + " · " + x.n + " policies", tone: x.v === maxP ? "indigo" : "blue", onClick: function () { location.href = drilldownHref("product", x.pr); } })); });

      compBody.innerHTML = "";
      compBody.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Current records by status. Bound policies await automatic issuance; policies in UW Review are awaiting an underwriting decision."));
      /* Every one of the seven real statuses a policy can carry, not just the five most common —
         the donut's arcs are sized against `total`, so leaving any status out understates every
         slice by however many records the missing status holds. */
      var declined = policies.filter(function (p) { return p.status === "Declined"; });
      var nonRenewed = policies.filter(function (p) { return p.status === "Non-renewed"; });
      /* Every legend row links to the Policy Register pre-filtered to the same records — the
         Register's own status filter only understands the 4 lifecycle BUCKETS (PAS.statusBucket),
         not these 7 raw statuses, so a click on e.g. "Declined" lands on the whole Canceled bucket
         (Cancelled + Declined) rather than Declined alone — the most precise filter the Register
         can actually apply, same convention the Active/Bound KPI cards above already use. */
      function statusOnClick(raw) { return function () { location.href = "registry.html?status=" + encodeURIComponent(PAS.statusBucket(raw)); }; }
      compBody.appendChild(ui.donut({
        total: policies.length, centerValue: policies.length, centerLabel: "records", segments: [
          { label: PAS.statusLabel("Active"), value: active.length, tone: "green", onClick: statusOnClick("Active") },
          { label: PAS.statusLabel("Bound"), value: bound.length, tone: "amber", onClick: statusOnClick("Bound") },
          { label: PAS.statusLabel("Referred"), value: referred.length, tone: "violet", onClick: statusOnClick("Referred") },
          { label: PAS.statusLabel("Cancelled"), value: cancelled.length, tone: "red", onClick: statusOnClick("Cancelled") },
          { label: PAS.statusLabel("Expired"), value: policies.filter(function (p) { return p.status === "Expired"; }).length, tone: "gray", onClick: statusOnClick("Expired") },
          { label: PAS.statusLabel("Declined"), value: declined.length, tone: "blue", onClick: statusOnClick("Declined") },
          { label: PAS.statusLabel("Non-renewed"), value: nonRenewed.length, tone: "indigo", onClick: statusOnClick("Non-renewed") },
        ],
      }));

    }

    /* All four desk queues, one at a time. Each is its own small builder so the queue picker
       only ever has to choose between them — adding a fifth desk later means adding one entry
       to QUEUES and one builder here, not another column to a grid that has run out of room.

       Redesigned (was a plain ranked-bar list) so the two things that actually decide "do I act
       on this now" — who it belongs to, and how much time is left — are always visible as their
       own elements, not folded into one note string next to a magnitude bar:
         - Owner: for a real held transaction (cancellation/reinstatement/endorsement) this is
           ui.requestedByCell — the same initiator pill + real name Pending Approvals shows for
           the identical row, so "who does this belong to" reads the same on both screens. Renewal
           has no held transaction yet at this stage (it is a forward pipeline of active policies
           approaching expiry, not a decision already raised) — its real owner is whoever
           underwrote the policy, PAS.underwriterOf, the same source policy-detail's own
           "Underwritten by" field reads from.
         - Deadline: for the three held-transaction queues this is the real approval SLA
           (PAS.getTxnSla — the same clock Pending Approvals and Advanced Admin already show,
           factoring in the transaction's own reason/materiality). Reinstatement's own eligibility
           window is a more urgent, more relevant deadline than the generic approval SLA (the
           window can run out before an approval SLA ever would), so it uses that instead. Renewal
           has no approval SLA at all — its deadline is whether the notice lead time has arrived,
           from the same PAS.renewalCompliance the Renewal desk itself is sorted by. */
    function buildQueues() {
      var policies = scopedPolicies();
      var active = policies.filter(function (p) { return p.status === "Active"; });
      var spec = QUEUES.filter(function (q) { return q.key === queueKey; })[0] || QUEUES[0];

      queueSelect.value = spec.key;
      queueLinkWrap.innerHTML = "";
      queueLinkWrap.appendChild(openLink(spec.href, "Open desk"));
      queueBody.innerHTML = "";
      queueBody.appendChild(ui.h("div", { class: "faint-note mb-9" }, spec.note));

      function txnDecisionHref(t) {
        var desk = PAS.TYPE_TO_DESK[t.h.type];
        return PAS.DETAIL_URL_OF[desk] + "?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id);
      }
      /* Same shape ui.requestedByCell renders (a pill, with a real name stacked underneath it) —
         used for Renewal, which has no transaction/meta.initiatedBy to hand that helper. */
      function ownerBlock(pillNode, name) {
        var wrap = ui.h("div", {});
        wrap.appendChild(pillNode);
        if (name) wrap.appendChild(ui.h("div", { class: "faint-note", style: { marginTop: "3px" } }, name));
        return wrap;
      }
      function queueRow(row) {
        var item = ui.h("div", { class: "queue-item" + (row.onClick ? " clickable" : "") });
        if (row.onClick) {
          item.setAttribute("role", "link");
          item.setAttribute("tabindex", "0");
          item.addEventListener("click", row.onClick);
          item.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onClick(); } });
        }
        var main = ui.h("div", { class: "queue-item-main" });
        main.appendChild(ui.h("div", { class: "queue-item-title" }, row.title));
        if (row.sub) main.appendChild(ui.h("div", { class: "queue-item-sub" }, row.sub));
        row.ownerNode.style.marginTop = "6px";
        main.appendChild(row.ownerNode);
        item.appendChild(main);
        var side = ui.h("div", { class: "queue-item-side" });
        side.appendChild(ui.pill(row.deadlineTone, row.deadlineText));
        if (row.metric) side.appendChild(ui.h("div", { class: "queue-item-metric" }, row.metric));
        item.appendChild(side);
        return item;
      }
      /* Every queue renders the same way: up to QUEUE_ROWS compact rows, then a "showing N of M"
         note and a View more link when the real list is longer than the cap. */
      function renderRows(rows, total, emptyText, moreText) {
        if (rows.length === 0) { queueBody.appendChild(ui.h("div", { class: "faint-note" }, emptyText)); return; }
        var list = ui.h("div", { class: "queue-list" });
        rows.forEach(function (r) { list.appendChild(queueRow(r)); });
        queueBody.appendChild(list);
        if (total > QUEUE_ROWS) {
          queueBody.appendChild(ui.h("div", { class: "faint-note mt-6" }, "Showing " + QUEUE_ROWS + " of " + total + " " + moreText + "."));
          queueBody.appendChild(openLink(spec.href, "View more"));
        }
      }

      if (spec.key === "renewal") {
        var renewalSorted = active.slice().sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });
        var rows = renewalSorted.slice(0, QUEUE_ROWS).map(function (p) {
          var rc = PAS.renewalCompliance(p);
          var uwName = PAS.underwriterOf(p);
          return {
            title: p.holder, sub: p.id + " · " + p.product,
            ownerNode: ownerBlock(ui.initiatorPill({ initiatedBy: "Underwriter" }), uwName || "Unassigned — no underwriting decision on file"),
            deadlineTone: rc.status === "Overdue" ? "red" : rc.status === "Urgent" ? "amber" : "green",
            deadlineText: rc.status === "Overdue" ? "Overdue " + Math.abs(rc.daysToExpiry) + "d" : rc.daysToExpiry + "d left",
            metric: rc.daysToExpiry + "d to expiry",
            onClick: function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); },
          };
        });
        renderRows(rows, renewalSorted.length, "No in-force policies approaching expiry.", "in force, closest to expiry first");

      } else if (spec.key === "cancellation") {
        /* Ranked by refund amount — biggest exposure first. Same live quote (reason +
           initiatedBy + effective date -> cancelQuote) the Cancellation desk itself shows for
           these same rows, so the two screens can never disagree. */
        var pendingCx = PAS.pendingOf(policies, "Cancellation").map(function (t) {
          var meta = t.h.meta || {};
          var reason = meta.reason || "Insured Request";
          var initiatedBy = meta.initiatedBy || "Insured";
          var effDate = t.h.date || PAS.todayISO();
          return { t: t, reason: reason, refund: Math.round(PAS.cancelQuote(t.p, reason, initiatedBy, effDate).refund) };
        }).sort(function (a, b) { return b.refund - a.refund; });
        var cxRows = pendingCx.slice(0, QUEUE_ROWS).map(function (x) {
          var sla = PAS.getTxnSla(x.t.h);
          return {
            title: x.t.p.holder, sub: x.t.p.id + " · " + x.reason,
            ownerNode: ui.requestedByCell(x.t),
            deadlineTone: sla.breached ? "red" : sla.remainingHours <= 24 ? "amber" : "green",
            deadlineText: sla.breached ? "SLA breached" : sla.remainingHours + "h left",
            metric: PAS.money(x.refund) + " refund",
            onClick: function () { location.href = txnDecisionHref(x.t); },
          };
        });
        renderRows(cxRows, pendingCx.length, "No open cancellation requests.", "open requests");

      } else if (spec.key === "reinstatement") {
        /* Sorted by days already elapsed since cancellation, longest first: eligibility expires
           at REINSTATEMENT_WINDOW_DAYS, so the oldest request is the one about to run out of
           time. Ineligible ones (fraud, or past the window) still show, flagged — they need a
           decline rather than being quietly hidden from the desk. The deadline badge is this
           eligibility window, not the generic approval SLA — it is the real time-critical limit
           for this queue specifically (see the note text this panel already shows). */
        var pendingRe = PAS.pendingOf(policies, "Reinstatement").map(function (t) {
          return { t: t, el: PAS.reinstatementEligibility(t.p) };
        }).filter(function (x) { return x.el; }).sort(function (a, b) { return b.el.daysSince - a.el.daysSince; });
        var reRows = pendingRe.slice(0, QUEUE_ROWS).map(function (x) {
          var left = PAS.REINSTATEMENT_WINDOW_DAYS - x.el.daysSince;
          return {
            title: x.t.p.holder, sub: x.t.p.id,
            ownerNode: ui.requestedByCell(x.t),
            deadlineTone: x.el.fraud || !x.el.eligible ? "red" : (left <= 10 ? "amber" : "green"),
            deadlineText: x.el.fraud ? "Barred — fraud" : x.el.eligible ? left + "d left" : "Window closed",
            metric: x.el.daysSince + "d since cancellation",
            onClick: function () { location.href = txnDecisionHref(x.t); },
          };
        });
        renderRows(reRows, pendingRe.length, "No open reinstatement requests.", "open requests");

      } else {
        /* Only real premium INCREASES: a decrease or a no-impact change (a plain address update)
           is not what this queue is for. */
        var pendingEn = PAS.pendingOf(policies, "Endorsement").map(function (t) {
          return { t: t, impact: Math.round((t.h.meta && t.h.meta.premiumImpact) || 0) };
        }).filter(function (x) { return x.impact > 0; }).sort(function (a, b) { return b.impact - a.impact; });
        var enRows = pendingEn.slice(0, QUEUE_ROWS).map(function (x) {
          var sla = PAS.getTxnSla(x.t.h);
          return {
            title: x.t.p.holder, sub: x.t.p.id,
            ownerNode: ui.requestedByCell(x.t),
            deadlineTone: sla.breached ? "red" : sla.remainingHours <= 24 ? "amber" : "green",
            deadlineText: sla.breached ? "SLA breached" : sla.remainingHours + "h left",
            metric: "+" + PAS.money(x.impact),
            onClick: function () { location.href = txnDecisionHref(x.t); },
          };
        });
        renderRows(enRows, pendingEn.length, "No open endorsement requests increasing premium.", "open requests increasing premium");
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
         not-yet-incepted business stays out. Period-scoped to the Monthly/Quarterly/Yearly/custom
         toggle above via PAS.bookFinancialsInWindow — a flow of what this book did IN the selected
         window, not an as-of-today snapshot. See that function's own comment for the one honest
         simplification this carries: a renewed policy's earned premium in a period before its
         latest renewal isn't reconstructable from the record, so it undercounts (never overcounts)
         earned premium for periods further back than a policy's current term. "All" opts back out
         of that window entirely and uses the plain lifetime PAS.bookFinancials snapshot instead —
         the one figure that doesn't carry the current-term-only simplification, since it isn't
         trying to isolate any one slice of time. */
      var onRisk = PAS.onRiskPolicies(scopedPolicies());
      var bounds = period === "all" ? null : periodBounds(period, periodOffset, customFrom, customTo);
      function financialsFor(policies) { return bounds ? PAS.bookFinancialsInWindow(policies, bounds[0], bounds[1]) : PAS.bookFinancials(policies); }
      var f = financialsFor(onRisk);
      var previousF = null;
      /* True while the CURRENT period hasn't finished yet (today falls inside it — always true for
         offset 0 since this book has no data past today). Comparing a still-running period's
         figures against a FULL previous period manufactures a decline out of nothing: "month" at
         2026-08-20 only has 20 of August's 31 days of activity to show, so stacking it against all
         31 days of July made Written premium look like it fell 60%+ when the real story was just
         "11 fewer days have happened so far". Clip the previous period's end to the same elapsed
         day count instead — MTD vs MTD, QTD vs QTD, YTD vs YTD — so the delta reflects an actual
         trend rather than an artifact of where "today" sits inside the period. A fully-elapsed past
         period (periodOffset < 0) needs no clipping: both sides are already complete. */
      var inProgress = false;
      /* This seed book is weighted heavily toward recent inceptions — as of today only a small
         fraction of the currently on-risk book existed a year ago, since most policies were
         written in the last several months. Comparing today's full book against a "previous
         period" that's mostly empty produces a real but meaningless delta (+400%, +1000%+) that
         has nothing to do with an actual trend — it's just "the book didn't exist yet back then".
         Treat the comparison as unreliable whenever fewer than half of the current on-risk
         policies were even in force as of the previous period's own end date, and suppress the
         delta rather than show a manufactured swing. */
      var deltasReliable = true;
      if (period === "month" || period === "quarter" || period === "year") {
        var previousBounds = periodBounds(period, periodOffset - 1, customFrom, customTo);
        var today = PAS.todayISO();
        var previousTo = previousBounds[1];
        if (bounds && today >= bounds[0] && today < bounds[1]) {
          inProgress = true;
          var elapsedDays = PAS.daysBetween(bounds[0], today);
          var clipped = PAS.addDays(previousBounds[0], elapsedDays);
          previousTo = clipped < previousBounds[1] ? clipped : previousBounds[1];
        }
        previousF = PAS.bookFinancialsInWindow(onRisk, previousBounds[0], previousTo);
        var priorPopulation = onRisk.filter(function (p) { return p.effectiveDate <= previousTo; }).length;
        deltasReliable = onRisk.length === 0 || (priorPopulation / onRisk.length) >= 0.5;
      }
      function valueDelta(current, previous) {
        if (!previousF) return null;
        if (!deltasReliable) return "n/a";
        if (!previous) return null;
        var change = ((current - previous) / Math.abs(previous)) * 100;
        return (change >= 0 ? "+" : "") + change.toFixed(1) + "%";
      }
      function pointDelta(current, previous) {
        if (!previousF) return null;
        if (!deltasReliable) return "n/a";
        var change = (current - previous) * 100;
        return (change >= 0 ? "+" : "") + change.toFixed(1) + " pts";
      }
      var comparisonTitle = !previousF ? null
        : !deltasReliable ? "Not enough of this book existed " + (period === "month" ? "last month" : period === "quarter" ? "last quarter" : "a year ago") + " for a reliable comparison."
        : (inProgress ? "Compared with the same point in the previous " + period + "." : "Compared with the previous " + period + ".");

      finKpiContainer.innerHTML = "";
      finKpiContainer.appendChild(ui.kpiRow([
        {
          label: period === "all" ? "Annual premium" : "Premium written", value: PAS.moneyShort(f.writtenPremium), tone: "gray",
          delta: valueDelta(f.writtenPremium, previousF && previousF.writtenPremium), deltaTone: "gray", deltaTitle: comparisonTitle,
          tip: "Total premium from policies issued or renewed in this period.",
        },
        {
          label: "Earned premium", value: PAS.moneyShort(f.earnedPremium), tone: "blue",
          delta: valueDelta(f.earnedPremium, previousF && previousF.earnedPremium), deltaTone: "gray", deltaTitle: comparisonTitle,
          tip: "Premium earned for coverage actually provided so far.",
          /* Standard insurance accounting: Written >= Earned is a cumulative/balance-sheet identity
             (the unearned premium reserve can never go negative) — see the "All history" view, where
             it holds ($100.18M written vs $65.36M earned). It is NOT a per-period constraint: Earned
             draws ratably from the WHOLE in-force book every day, while Written only counts the
             handful of policies that happened to issue or renew inside this narrower window, so a
             below-average month/quarter for new business can legitimately show Earned > Written —
             the same dynamic insurers describe in their own 10-Q filings during slow write periods. */
          why: period === "all" ? undefined : "Can exceed Premium written in a single period — Earned draws from the whole in-force book's daily accrual, Written only from policies that issued or renewed in this window. The lifetime (All history) view always has Written ≥ Earned.",
        },
        {
          label: "Net commission", value: PAS.moneyShort(f.netCommission), tone: "green",
          delta: valueDelta(f.netCommission, previousF && previousF.netCommission), deltaTone: "gray", deltaTitle: comparisonTitle,
          tip: "Southlake paid commission (MGA + Broker) - Southlake received commission (Reinsurers).",
        },
        {
          label: "Incurred claims", value: PAS.moneyShort(f.paid), tone: "red",
          delta: valueDelta(f.paid, previousF && previousF.paid), deltaTone: !previousF ? null : !deltasReliable ? "gray" : (f.paid <= previousF.paid ? "green" : "red"), deltaTitle: comparisonTitle,
          tip: "Claims actually paid out so far, across " + f.claimCount + " claims — reserved amounts for open claims are shown separately, in Reserved claims.",
        },
        {
          label: "Reserved claims", value: PAS.moneyShort(f.reserved), tone: "amber",
          delta: valueDelta(f.reserved, previousF && previousF.reserved), deltaTone: !previousF ? null : !deltasReliable ? "gray" : (f.reserved <= previousF.reserved ? "green" : "red"), deltaTitle: comparisonTitle,
          tip: "Set aside for " + f.openClaimCount + " open claim" + (f.openClaimCount === 1 ? "" : "s") + " not yet paid out. Reserved + Incurred (paid) = total incurred claims, the figure Loss ratio is actually computed from.",
        },
        {
          label: "Loss ratio", value: pct(f.lossRatio), tone: lossToneFor(f.lossRatio),
          delta: pointDelta(f.lossRatio, previousF && previousF.lossRatio), deltaTone: !previousF ? null : !deltasReliable ? "gray" : (f.lossRatio <= previousF.lossRatio ? "green" : "red"), deltaTitle: comparisonTitle,
          tip: "Claims paid per $1 of earned premium.",
        },
        {
          label: "Combined ratio", value: pct(f.combinedRatio), tone: combinedToneFor(f.combinedRatio),
          delta: pointDelta(f.combinedRatio, previousF && previousF.combinedRatio), deltaTone: !previousF ? null : !deltasReliable ? "gray" : (f.combinedRatio <= previousF.combinedRatio ? "green" : "red"), deltaTitle: comparisonTitle,
          tip: "Loss ratio plus expense ratio. Below 100% = carrier profit.",
        },
      ]));

      /* A plain-language verdict, because a business owner should not have to remember which
         side of 100% is the good side. */
      finVerdictWrap.innerHTML = "";
      if (f.policies === 0) {
        finVerdictWrap.appendChild(ui.h("div", { class: "faint-note", style: { padding: "14px 15px" } }, "No on-risk business in this filter."));
      } else {
        var profitable = f.combinedRatio < 1;
        var margin = Math.abs(1 - f.combinedRatio);
        finVerdictWrap.appendChild(ui.callout(profitable ? "good" : "bad", [
          ui.h("strong", {}, profitable ? "This book produces a positive carrier underwriting result. " : "This book produces a carrier underwriting loss. "),
          document.createTextNode(
            "The indicative combined ratio is " + pct(f.combinedRatio) + " " + periodNoteText() + ", meaning $" + (f.combinedRatio * 100).toFixed(2) +
            " of claims and included acquisition expense for every $100 of earned premium. That is " + pct(margin) + (profitable ? " below" : " above") +
            " break-even and produces a carrier underwriting " + (profitable ? "profit" : "loss") + " of " + PAS.money(Math.abs(f.underwritingResult)) +
            ". Other operating costs are not included."
          ),
        ]));
      }

      /* ---- profit & loss by segment ---- */
      var dimLabel = SEGMENT_DIMS.filter(function (d) { return d.key === segmentDim; })[0].label;
      segmentPanel.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("active", c.textContent === dimLabel);
        c.setAttribute("aria-pressed", String(c.textContent === dimLabel));
      });

      var sortSpec = SEGMENT_SORT_BASES.filter(function (s) { return s.key === segmentSortBasis; })[0] || SEGMENT_SORT_BASES[0];
      segmentSortSelect.value = sortSpec.key;

      var keys = Array.from(new Set(onRisk.map(function (p) { return p[segmentDim]; }).filter(Boolean)));
      var segments = keys.map(function (k) {
        var seg = onRisk.filter(function (p) { return p[segmentDim] === k; });
        var sf = financialsFor(seg);
        return { k: k, f: sf, n: seg.length };
      }).filter(function (s) { return s.f.earnedPremium > 0; })
        .sort(function (a, b) { return sortSpec.sortValue(b) - sortSpec.sortValue(a); });

      segmentBody.innerHTML = "";
      if (segments.length === 0) {
        segmentBody.appendChild(ui.h("div", { class: "faint-note" }, "No on-risk business in this filter."));
        return;
      }
      var losing = segments.filter(function (s) { return s.f.combinedRatio >= 1; });
      segmentBody.appendChild(ui.h("div", { class: "faint-note mb-9" },
        losing.length === 0
          ? "Every " + dimLabel.toLowerCase() + " in this filter has an indicative combined ratio below 100%. Other operating costs are excluded."
          : losing.length + " of " + segments.length + " " + dimLabel.toLowerCase() + " segments have an indicative combined ratio of 100% or more — listed first. Other operating costs are excluded."));

      /* One consolidated table: premium, the claim count AND dollar figure it's derived from, and
         every ratio, all on the same row — a fresh instance every time the dimension/filters/
         period change, same as every other rebuilt panel on this page. Every header is click-to-
         sort (sortableTable), so ranking by raw claim volume — what the old separate "Top claim
         segments" chart existed for — is a click on the Claims header, not a different panel. */
      var segmentTable = ui.sortableTable({
        storageKey: "pas.dashboard.segment-performance.columns.v1",
        initialSort: { key: sortSpec.key, dir: "desc" },
        /* Clicking a column header re-sorts independently of the "Sort by" select — but when the
           clicked column IS one of that select's options (every column except the segment-name
           column itself), keep the select's displayed value truthful rather than letting it go
           stale and claim a basis the table is no longer actually sorted by. */
        onSortChange: function (s) {
          if (SEGMENT_SORT_BASES.some(function (b) { return b.key === s.key; })) {
            segmentSortBasis = s.key;
            segmentSortSelect.value = s.key;
          }
        },
        pageSize: 10,
        columns: [
          { key: "segment", label: dimLabel, locked: true, sortValue: function (s) { return String(s.k).toLowerCase(); }, cell: function (s) { return linkCell(s.k, drilldownHref(segmentDim, s.k)); } },
          { key: "policies", label: "Policies", what: "Policies that carried coverage risk in this segment.", sortValue: function (s) { return s.n; }, cell: function (s) { return String(s.n); } },
          { key: "earnedPremium", label: "Earned premium", what: "The exposure base every ratio in this row divides by.", sortValue: function (s) { return s.f.earnedPremium; }, cell: function (s) { return PAS.moneyShort(s.f.earnedPremium); } },
          { key: "claimCount", label: "Claims", what: "Number of claims reported against this segment's on-risk policies — the count behind the incurred-claims figure and loss ratio in this same row.", sortValue: function (s) { return s.f.claimCount; }, cell: function (s) { return s.f.claimCount ? String(s.f.claimCount) : "—"; } },
          { key: "incurred", label: "Incurred claims", what: "Paid plus reserved claims.", sortValue: function (s) { return s.f.incurred; }, cell: function (s) { return PAS.moneyShort(s.f.incurred); } },
          { key: "lossRatio", label: "Loss ratio", what: "Incurred ÷ earned premium.", sortValue: function (s) { return s.f.lossRatio; }, cell: function (s) { return ui.pill(lossToneFor(s.f.lossRatio), pct(s.f.lossRatio)); } },
          { key: "expenseRatio", label: "Acquisition expense ratio", what: "Commission paid by the carrier divided by earned premium.", sortValue: function (s) { return s.f.expenseRatio; }, cell: function (s) { return pct(s.f.expenseRatio); } },
          { key: "combinedRatio", label: "Indicative combined ratio", what: "Loss ratio plus acquisition expense ratio.", rule: "Below 100% indicates a carrier underwriting profit before other operating costs.", sortValue: function (s) { return s.f.combinedRatio; }, cell: function (s) { return ui.pill(combinedToneFor(s.f.combinedRatio), pct(s.f.combinedRatio)); } },
          { key: "netCommission", label: "Net commission", what: "Southlake paid commission (MGA + Broker) - Southlake received commission (Reinsurers).", sortValue: function (s) { return s.f.netCommission; }, cell: function (s) { return PAS.moneyShort(s.f.netCommission); } },
        ],
        rows: segments,
        wrapCells: true,
      });
      segmentBody.appendChild(segmentTable.tableWrap);
    }

    function buildClaims() {
      var policies = scopedPolicies();
      /* On-risk, not Active-only. Measuring loss ratio across surviving policies alone is
         survivorship bias: the business that went bad is precisely the business that got
         cancelled, so excluding it reports the survivors' loss ratio and labels it the book's.
         Earned premium (not written) is the denominator, matching PAS.bookFinancials exactly. */
      var onRisk = PAS.onRiskPolicies(policies);

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
            label: x.k, value: pct, max: maxProductRatio, note: pct + "% · $" + (x.ratio * 100).toFixed(2) + " per $100 earned", tone: lossToneFor(x.ratio),
            tip: x.k + ": " + PAS.money(x.incurred) + " incurred claims divided by " + PAS.money(x.premium) + " earned premium = " + pct + "%.",
            ariaLabel: x.k + ", " + pct + "% loss ratio, $" + (x.ratio * 100).toFixed(2) + " of incurred claims per $100 earned premium",
            onClick: function () { location.href = drilldownHref("product", x.k); },
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
          lossByStateBody.appendChild(ui.hbar({
            label: x.k, value: pct, max: maxStateRatio, note: pct + "% · " + x.claimN + " claim" + (x.claimN === 1 ? "" : "s"), tone: lossToneFor(x.ratio),
            ariaLabel: x.k + ", " + pct + "% lifetime loss ratio based on " + x.claimN + " claim" + (x.claimN === 1 ? "" : "s"),
            onClick: function () { location.href = drilldownHref("state", x.k); },
          }));
        });
      }

      claimsCalloutWrap.innerHTML = "";
      var lossSegments = byProduct.filter(function (x) { return x.ratio >= 0.85 && x.incurred > 0; });
      if (lossSegments.length > 0) {
        claimsCalloutWrap.appendChild(ui.callout("bad", [
          ui.h("strong", {}, "High loss ratio — review required: "),
          document.createTextNode(lossSegments.map(function (x) { return x.k + " (" + Math.round(x.ratio * 100) + "%)"; }).join(", ") + " — incurred claims are at or above 85% of earned premium. Check the combined ratio before concluding whether the segment made an underwriting loss."),
        ]));
      } else if (byProduct.some(function (x) { return x.incurred > 0; })) {
        claimsCalloutWrap.appendChild(ui.callout("good", [
          ui.h("strong", {}, "Loss ratios are within the review threshold. "),
          document.createTextNode("Every product's incurred claims remain below 85% of earned premium in this filter."),
        ]));
      }
    }

    /* Expand/collapse state is kept per dimension, outside buildTopEntities, so switching from
       Brokers to MGAs and back does not silently reset what you had expanded — and so a filter
       change or period switch does not either. */
    var topExpanded = {};
    TOP_DIMS.forEach(function (d) { topExpanded[d.key] = false; });

    function buildTopEntities() {
      var list = scopedPolicies();
      var spec = TOP_DIMS.filter(function (d) { return d.key === topDim; })[0] || TOP_DIMS[0];
      var sortSpec = TOP_SORT_BASES.filter(function (s) { return s.key === topSortBasis; })[0] || TOP_SORT_BASES[0];
      topSelect.value = spec.key;
      topSortSelect.value = sortSpec.key;

      topLinkWrap.innerHTML = "";
      if (spec.href) topLinkWrap.appendChild(openLink(spec.href, "View directory"));

      /* Same period window financials run over on-risk business elsewhere on this page (see
         buildFinancials' financialsFor) — claim count here uses that identical window, not just
         "Active" policies, since a claim can be reported against a policy that has since expired
         or cancelled and shouldn't silently vanish from a claims-basis ranking. */
      var bounds = period === "all" ? null : periodBounds(period, periodOffset, customFrom, customTo);
      var keys = Array.from(new Set(list.map(function (p) { return p[spec.key]; }).filter(Boolean)));
      var rows = keys.map(function (k) {
        var mine = list.filter(function (p) { return p[spec.key] === k; });
        var active = mine.filter(function (p) { return p.status === "Active"; });
        var premium = sum(active, function (p) { return p.premium; });
        var onRiskMine = PAS.onRiskPolicies(mine);
        var f = bounds ? PAS.bookFinancialsInWindow(onRiskMine, bounds[0], bounds[1]) : PAS.bookFinancials(onRiskMine);
        return { k: k, premium: premium, n: mine.length, avgPremium: active.length ? premium / active.length : 0, claimCount: f.claimCount };
      }).sort(function (a, b) { return sortSpec.sortValue(b) - sortSpec.sortValue(a); });

      topBody.innerHTML = "";
      topBody.appendChild(ui.h("div", { class: "faint-note mb-9" }, spec.note + " Ranked by " + sortSpec.label.toLowerCase() + "."));
      if (rows.length === 0) { topBody.appendChild(ui.h("div", { class: "faint-note" }, "No records in this filter.")); return; }

      var max = Math.max.apply(null, rows.map(function (r) { return sortSpec.sortValue(r); }).concat([1]));
      var totalPremium = rows.reduce(function (total, r) { return total + r.premium; }, 0) || 1;
      var totalPolicies = rows.reduce(function (total, r) { return total + r.n; }, 0) || 1;
      /* Percent-of-total is only meaningful for the two additive bases — an average can't be
         summed across entities and divided back into a share, so that basis states its own figure
         and the policy count for context instead of a bogus percentage. */
      var totalClaims = rows.reduce(function (total, r) { return total + r.claimCount; }, 0) || 1;
      function noteFor(r) {
        if (sortSpec.key === "policies") return r.n + " polic" + (r.n === 1 ? "y" : "ies") + " · " + ((r.n / totalPolicies) * 100).toFixed(1) + "% of filtered policies · " + PAS.moneyShort(r.premium) + " in-force premium";
        if (sortSpec.key === "avgPremium") return PAS.moneyShort(r.avgPremium) + " avg per policy · " + r.n + " policies · " + PAS.moneyShort(r.premium) + " total in-force premium";
        if (sortSpec.key === "claims") return r.claimCount + " claim" + (r.claimCount === 1 ? "" : "s") + (r.claimCount ? " · " + ((r.claimCount / totalClaims) * 100).toFixed(1) + "% of filtered claims" : "") + " · " + r.n + " policies";
        return PAS.moneyShort(r.premium) + " · " + ((r.premium / totalPremium) * 100).toFixed(1) + "% of filtered premium · " + r.n + " policies";
      }
      var expanded = topExpanded[spec.key];
      (expanded ? rows : rows.slice(0, TOP_ENTITY_ROWS)).forEach(function (r) {
        var v = sortSpec.sortValue(r);
        topBody.appendChild(ui.hbar({
          label: r.k, value: v, max: max,
          note: noteFor(r),
          tone: v === max ? "indigo" : "blue",
          ariaLabel: r.k + ", " + noteFor(r),
          onClick: function () { location.href = drilldownHref(spec.key, r.k); },
        }));
      });
      if (rows.length > TOP_ENTITY_ROWS) {
        var btn = ui.h("button", { class: "btn ghost-link mt-6", type: "button" }, expanded ? "Show top " + TOP_ENTITY_ROWS + " only" : "See " + (rows.length - TOP_ENTITY_ROWS) + " others");
        btn.addEventListener("click", function () { topExpanded[spec.key] = !expanded; buildTopEntities(); });
        topBody.appendChild(btn);
      }
    }

    function buildAll() {
      renderToggle(); buildFinancials(); buildKpis(); buildChart(); buildSnapshotPanels(); buildQueues(); buildClaims(); buildTopEntities();
      updateStatus.textContent = "Dashboard updated for " + periodNoteText() + filterNote() + ".";
      resetFiltersBtn.disabled = !(lobFilter.length || stateFilter.length || brokerFilter.length || mgaFilter.length || carrierFilter.length);
    }
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
    var scopeSubtitle = spec.scope === "producer"
      ? "Business placed by " + identity
      : spec.scope === "carrier"
        ? "Business written on " + identity + " paper"
        : "Business placed through " + identity;

    page.appendChild(ui.pageHeader({
      icon: spec.icon, tone: spec.tone, title: spec.label + " Dashboard",
      sub: scopeSubtitle + " — premium, loss activity and reserves",
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
    page.appendChild(ui.kpiSection({ label: "Current portfolio", sub: "As of " + displayDate(PAS.todayISO()), rowClass: "scoped-kpi-row" }, [
      { label: "In-force premium", value: PAS.moneyShort(inForcePremium), tone: "green", tip: "Annual premium across active policies as of " + displayDate(PAS.todayISO()) + "." },
      { label: "Active policies", value: active.length },
      { label: "Lines of business", value: Array.from(new Set(policies.map(function (p) { return p.product; }))).length },
      { label: "States", value: Array.from(new Set(policies.map(function (p) { return p.state; }))).length },
    ]));
    page.appendChild(ui.kpiSection({ label: "Lifetime loss performance", sub: "Policies that carried coverage risk", rowClass: "scoped-kpi-row" }, [
      {
        label: "Earned premium", value: PAS.moneyShort(scopedFin.earnedPremium), tone: "blue",
        tip: "Premium recognized for coverage already provided, including relevant cancelled and expired policies.",
        why: "The exposure base used by both ratios in this section.",
      },
      {
        label: "Loss ratio", value: pctOf(scopedFin.lossRatio), tone: lossToneForScoped(scopedFin.lossRatio),
        tip: PAS.money(scopedFin.incurred) + " incurred ÷ " + PAS.money(scopedFin.earnedPremium) + " earned, across " + scopedFin.claimCount + " claims.",
        why: "$" + (scopedFin.lossRatio * 100).toFixed(2) + " of incurred claims per $100 of earned premium. Expenses are excluded.",
      },
      {
        label: "Indicative combined ratio", value: pctOf(scopedFin.combinedRatio), tone: scopedFin.combinedRatio >= 1 ? "red" : scopedFin.combinedRatio >= 0.95 ? "amber" : "green",
        tip: pctOf(scopedFin.lossRatio) + " loss ratio plus " + pctOf(scopedFin.expenseRatio) + " acquisition expense ratio.",
        why: "Below 100% indicates a carrier underwriting profit before other operating costs, which are excluded.",
      },
    ]));

    /* Filters: state, LOB, the counterpart distribution entity, and carrier, all multi-select
       (empty selection = "All"), plus a period toggle (Monthly/Quarterly/Yearly/custom range) —
       applied to every chart below, not just decoration: `refresh()` rebuilds every panel body
       against the filtered/period-scoped set. */
    var filterBlock = ui.h("div", { class: "filter-block" });
    page.appendChild(filterBlock);

    /* The second breakdown panel is whichever distribution-chain dimension this role's own scope
       ISN'T — a Broker (scoped by producer, i.e. themselves) sees premium by MGA facility instead
       of premium by broker, which would otherwise be one bar, always themselves. A Carrier sees
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
      thirdWhy = "Shows which distribution channel ultimately sources this carrier's book.";

    /* stateGrid/lobGrid/issuancePanel are built now (their bodies are wired into renderCharts
       below) but not appended to `page` yet — they're added further down, after the period
       toggle, so the toggle reads at the top of the page (same position it has on the
       Super Admin/Admin dashboard) rather than buried beneath the panels it doesn't even
       control. */
    var stateGrid = ui.h("div", { class: isCarrierScope ? "three-col-grid" : "two-col-grid" });
    var stateTopOnly = spec.scope === "producer";
    var statePanel = ui.panel({ title: stateTopOnly ? "In-force premium by state (top 5)" : "In-force premium by state" }, []);
    var stateBody = statePanel.querySelector(".panel-body");
    stateGrid.appendChild(statePanel);
    var brokerPanel = ui.panel({ title: secondLabel === "MGA" ? "In-force premium by MGA" : "In-force premium by broker" }, []);
    var brokerBody = brokerPanel.querySelector(".panel-body");
    stateGrid.appendChild(brokerPanel);
    var thirdPanel = null, thirdBody = null;
    if (isCarrierScope) {
      thirdPanel = ui.panel({ title: "In-force premium by broker" }, []);
      thirdBody = thirdPanel.querySelector(".panel-body");
      stateGrid.appendChild(thirdPanel);
    }

    var lobGrid = ui.h("div", { class: "two-col-grid" });
    var lobPanel = ui.panel({ title: "In-force premium by line of business" }, []);
    var lobBody = lobPanel.querySelector(".panel-body");
    lobGrid.appendChild(lobPanel);
    var claimsPanel = ui.panel({ title: "Claims and reserves", what: "Claims, incurred amounts and open reserves for this filtered book.", why: "Shows loss performance and the exposure still held for open claims." }, []);
    var claimsBody = claimsPanel.querySelector(".panel-body");
    lobGrid.appendChild(claimsPanel);
    var claimsPageSize = 10, claimsPageIndex = 0;

    /* This dashboard has no second chart to pair it with in a two-col-grid the way the other
       panels are — left full width, the line graph (drawn to a fixed 640x172 design) reads as
       stretched thin across the whole page. Capped to the same ~640px a two-col-grid's own
       column would give it, so it renders at the size it was actually designed for. */
    var issuancePanel = ui.panel({ title: "New policies issued" }, []);
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
      /* `dim` is whichever real policy field these rows were grouped by (state/product/producer/
         mga) — drilldownHref already knows where each one goes: the Register for the two it can
         filter on (state, product), that partner's own directory page for the two it can't
         (producer/Broker, mga/MGA). Every breakdown on this scoped dashboard names a real
         dimension, so every one of them gets a real link now, not just the LOB panel. */
      function fillPanel(body, rows, dim) {
        body.innerHTML = "";
        var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
        if (rows.length === 0 || max === 1 && rows.every(function (r) { return r.v === 0; })) { body.appendChild(ui.h("div", { class: "faint-note" }, "No in-force premium in this filter.")); return; }
        rows.forEach(function (r) {
          body.appendChild(ui.hbar({
            label: r.k, value: r.v, max: max, note: PAS.moneyShort(r.v) + " · " + r.n + " policies", tone: r.v === max ? "indigo" : "blue",
            onClick: function () { location.href = drilldownHref(dim, r.k); },
          }));
        });
      }
      fillPanel(stateBody, stateTopOnly ? byField("state").slice(0, 5) : byField("state"), "state");
      fillPanel(brokerBody, byField(secondDim), secondDim);
      if (isCarrierScope) fillPanel(thirdBody, byField(thirdDim), thirdDim);
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

      /* Same on-risk, earned-premium basis as the full operational dashboard, read from the same
         PAS.bookFinancials — so a Broker or MGA viewing their own book never sees a loss ratio
         computed a different way from the one an admin sees for the same policies. */
      var scopedOnRisk = PAS.onRiskPolicies(scoped);
      var scopedClaims = PAS.allClaims(scopedOnRisk);
      claimsPageIndex = 0;
      buildClaimsBody();

      function buildClaimsBody() {
        claimsBody.innerHTML = "";
        if (scopedClaims.length === 0) {
          claimsBody.appendChild(ui.h("div", { class: "faint-note" }, "No claims on file in this filter."));
          return;
        }
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
        summary.appendChild(ui.kv({ k: "Open claim reserves", v: PAS.money(sfin.reserved), what: sfin.openClaimCount + " open of " + sfin.claimCount + " total claims in this filter." }));
        claimsBody.appendChild(summary);

        var total = scopedClaims.length;
        var totalPages = Math.max(1, Math.ceil(total / claimsPageSize));
        if (claimsPageIndex >= totalPages) claimsPageIndex = totalPages - 1;
        if (claimsPageIndex < 0) claimsPageIndex = 0;
        var start = claimsPageIndex * claimsPageSize;
        var pageClaims = scopedClaims.slice(start, start + claimsPageSize);

        claimsBody.appendChild(ui.dataTable({
          columns: ["Policy", "Claim type", "State", { label: "Status", what: "Open claims still carry a reserve; closed claims are fully paid." }, { label: "Incurred amount", what: "Paid plus reserved — the total cost estimate." }, { label: "Reserve", what: "Estimated amount held for an open claim." }],
          rows: pageClaims.map(function (x) {
            return [ui.cellId(x.p.id), x.c.type, x.p.state, ui.pill(x.c.status === "Open" ? "amber" : "green", x.c.status), PAS.money(x.c.incurred), x.c.reserved ? PAS.money(x.c.reserved) : "—"];
          }),
          wrapCells: true,
        }));

        var pager = ui.h("div", { class: "table-pager" });
        var from = total === 0 ? 0 : start + 1;
        var to = Math.min(total, start + claimsPageSize);
        pager.appendChild(ui.h("span", { class: "table-pager-meta" }, "Showing " + from + "–" + to + " of " + total));
        var nav = ui.h("div", { class: "table-pager-nav" });
        var prev = ui.h("button", { class: "btn small", type: "button", disabled: claimsPageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (claimsPageIndex > 0) { claimsPageIndex--; buildClaimsBody(); } });
        var next = ui.h("button", { class: "btn small", type: "button", disabled: claimsPageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (claimsPageIndex < totalPages - 1) { claimsPageIndex++; buildClaimsBody(); } });
        nav.appendChild(prev);
        nav.appendChild(ui.h("span", { class: "table-pager-page" }, "Page " + (claimsPageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        claimsBody.appendChild(pager);
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
    lobGroup.appendChild(ui.multiSelect({ options: products, selected: filterProduct, allLabel: "All lines", onChange: function (sel) { filterProduct = sel; refresh(); } }));
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
    var prevBtn = ui.h("button", { class: "btn ghost-link", title: "Previous period", "aria-label": "Previous reporting period" }, "◀");
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = ui.h("button", { class: "btn ghost-link", title: "Next period", "aria-label": "Next reporting period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    prevBtn.addEventListener("click", function () { periodOffset -= 1; refresh(); });
    nextBtn.addEventListener("click", function () { if (periodOffset < 0) { periodOffset += 1; refresh(); } });
    page.appendChild(toggleRow);

    var customBtn = ui.h("button", { class: "chip" }, "Custom");
    toggle.appendChild(customBtn);
    customBtn.addEventListener("click", function () { period = period === "custom" ? "month" : "custom"; periodOffset = 0; refresh(); });

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
      toggle.appendChild(customBtn);
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
