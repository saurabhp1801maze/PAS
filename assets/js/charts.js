/* Shared trend-graph drawing, factored out of dashboard.js so any page (not just the dashboard)
   can put a real SVG line/area trend on screen without re-implementing it — first consumer
   besides the dashboard is the Cancellation desk's own trend (MOM 2026-08-26: "Cancellation data
   and trends should be clearly visible for analysis"). Load after ui.js, before any page script
   that calls PAS.charts.*. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function txnsOfType(policies, type, status) {
    var out = [];
    policies.forEach(function (p) { p.history.forEach(function (h) { if (h.type === type && (status ? h.status === status : true)) out.push({ p: p, h: h }); }); });
    return out;
  }
  function inMonth(dateStr, ym) { return !!dateStr && dateStr.slice(0, 7) === ym; }
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  function monthKeyLabel(key) { return MONTH_NAMES[Number(key.slice(5, 7)) - 1] + " '" + key.slice(2, 4); }
  function monthKeyOffset(offset) { return trailingMonths(1, offset)[0]; }

  function trailingYears(n, endOffset) {
    var curY = Number(PAS.todayISO().slice(0, 4)) + (endOffset || 0);
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(curY - i);
    return out;
  }
  function yearOffset(offset) { return Number(PAS.todayISO().slice(0, 4)) + (offset || 0); }
  function inYear(dateStr, y) { return !!dateStr && dateStr.slice(0, 4) === String(y); }

  /* Quarter keys are "YYYY-Qn". Built off the real UTC month so a window that crosses a year
     boundary (Q4 -> Q1) rolls the year too — same reasoning as trailingMonths. */
  function quarterKeyOf(y, monthIdx0) { return y + "-Q" + (Math.floor(monthIdx0 / 3) + 1); }
  function inQuarter(dateStr, qKey) {
    if (!dateStr) return false;
    var d = new Date(dateStr + "T00:00:00Z");
    return quarterKeyOf(d.getUTCFullYear(), d.getUTCMonth()) === qKey;
  }
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

  /* ================= period picker =================
     The Monthly / Quarterly / Yearly + Prev/Next + custom-date-range control the dashboard
     already uses, factored out as a genuine second consumer (the Cancellation desk's own trend)
     rather than left duplicated. Owns its own period/offset/custom-range state; the caller only
     ever asks it for bucket keys, labels and a match predicate, and gives it an onChange to
     re-render with. */
  function periodPicker(opts) {
    opts = opts || {};
    var period = opts.defaultPeriod || "month";
    var offset = 0;
    var customFrom = PAS.addDays(PAS.todayISO(), -(opts.rangeDays || 30));
    var customTo = PAS.todayISO();
    var onChange = opts.onChange || function () {};

    var toggleRow = ui.h("div", { class: "period-toggle-row" });
    toggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, opts.label || "Reporting period"));
    var toggleAndNav = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } });
    var toggle = ui.h("div", { class: "period-toggle" });
    toggleAndNav.appendChild(toggle);
    var navWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    var prevBtn = ui.h("button", { class: "btn ghost-link", type: "button", title: "Previous period", "aria-label": "Previous period" }, "◀");
    var navLabel = ui.h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = ui.h("button", { class: "btn ghost-link", type: "button", title: "Next period", "aria-label": "Next period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    prevBtn.addEventListener("click", function () { offset -= 1; refresh(); });
    nextBtn.addEventListener("click", function () { if (offset < 0) { offset += 1; refresh(); } });

    var customToggleRow = ui.h("div", { class: "period-toggle-row" });
    customToggleRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Or a custom range"));
    var customBtn = ui.h("button", { class: "chip", type: "button" }, "Custom range");
    customToggleRow.appendChild(customBtn);
    customBtn.addEventListener("click", function () { period = period === "custom" ? (opts.defaultPeriod || "month") : "custom"; offset = 0; refresh(); });

    var rangeRow = ui.h("div", { class: "period-toggle-row" });
    rangeRow.appendChild(ui.h("span", { class: "period-toggle-label" }, "Date range"));
    var rangeWrap = ui.h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    var fromInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customFrom, "aria-label": (opts.label || "Reporting period") + " start date" });
    var toInput = ui.h("input", { type: "date", class: "field-input select-fixed", value: customTo, "aria-label": (opts.label || "Reporting period") + " end date" });
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(ui.h("span", { style: { color: "var(--color-ink-tertiary)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; refresh(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; refresh(); });

    function periodLabelText() {
      if (period === "month") { var mk = monthKeyOffset(offset); return MONTH_NAMES[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4); }
      if (period === "quarter") return quarterKeyOffset(offset);
      if (period === "year") return String(yearOffset(offset));
      return customFrom + " to " + customTo;
    }
    function renderToggle() {
      toggle.innerHTML = "";
      [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"]].forEach(function (opt) {
        var btn = ui.h("button", { class: "chip" + (period === opt[0] ? " active" : ""), type: "button" }, opt[1]);
        btn.addEventListener("click", function () { if (period !== opt[0]) { period = opt[0]; offset = 0; refresh(); } });
        toggle.appendChild(btn);
      });
      customBtn.className = "chip" + (period === "custom" ? " active" : "");
      navWrap.style.display = period === "custom" ? "none" : "flex";
      rangeRow.style.display = period === "custom" ? "" : "none";
      if (period !== "custom") {
        navLabel.textContent = periodLabelText();
        nextBtn.disabled = offset >= 0;
      }
    }

    function bucketKeys(n) {
      return period === "month" ? trailingMonths(n, offset)
        : period === "quarter" ? trailingQuarters(n, offset)
        : period === "year" ? trailingYears(n, offset)
        : ["custom"];
    }
    function bucketLabel(key) {
      if (period === "month") return monthKeyLabel(key);
      if (period === "quarter") return "Q" + key.slice(6) + " '" + key.slice(2, 4);
      if (period === "year") return key;
      return customFrom + " – " + customTo;
    }
    function matches(dateStr, key) {
      if (period === "month") return inMonth(dateStr, key);
      if (period === "quarter") return inQuarter(dateStr, key);
      if (period === "year") return inYear(dateStr, key);
      return !!dateStr && dateStr >= customFrom && dateStr <= customTo;
    }
    function windowNote(nUnits, thing) {
      if (period === "month") return "Trailing " + nUnits + " months, " + thing + ".";
      if (period === "quarter") return "Trailing " + nUnits + " quarters, " + thing + ".";
      if (period === "year") return "Trailing " + nUnits + " years, " + thing + ".";
      return "From " + customFrom + " to " + customTo + ", " + thing + ".";
    }

    function refresh() { renderToggle(); onChange(); }
    renderToggle();

    return {
      toggleRow: toggleRow, customToggleRow: customToggleRow, rangeRow: rangeRow,
      bucketKeys: bucketKeys, bucketLabel: bucketLabel, matches: matches, windowNote: windowNote,
      getPeriod: function () { return period; },
    };
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* Mark spec, same as the dashboard's own graph: 2px line, round join/cap; >=8px (r=4) markers
     with a surface-color ring; a soft ~10% area wash under the line; hairline recessive gridlines.
     Every point carries a native hover tooltip; only the most recent point gets a permanent value
     label, per "never a number on every point". */
  function drawTrendGraph(container, seriesList, data, periodLabelFn, noteText) {
    var maxVal = Math.max.apply(null, data.reduce(function (acc, row) { seriesList.forEach(function (s) { acc.push(row[s.type]); }); return acc; }, [1]));
    var niceMax = Math.max(1, maxVal);
    var n = data.length;

    container.innerHTML = "";
    if (noteText) container.appendChild(ui.h("div", { class: "faint-note", style: { marginBottom: "10px" } }, noteText));

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
      svg.appendChild(Object.assign(svgEl("text", { x: xAt(i), y: H - 8, "text-anchor": "middle", class: "trend-axis-label-svg" }), { textContent: periodLabelFn(row.key) }));
    });

    if (seriesList.length > 1) {
      var legend = ui.h("div", { class: "trend-legend" });
      seriesList.forEach(function (s) {
        var row = ui.h("div", { class: "trend-legend-item" });
        row.appendChild(ui.h("span", { class: "trend-legend-swatch", style: { background: "var(--" + s.tone + ")" } }));
        row.appendChild(ui.h("span", {}, s.label));
        legend.appendChild(row);
      });
      container.appendChild(legend);
    }

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

  PAS.charts = {
    svgEl: svgEl, drawTrendGraph: drawTrendGraph, trailingMonths: trailingMonths, monthKeyLabel: monthKeyLabel,
    txnsOfType: txnsOfType, inMonth: inMonth,
    trailingQuarters: trailingQuarters, trailingYears: trailingYears,
    monthKeyOffset: monthKeyOffset, quarterKeyOffset: quarterKeyOffset, yearOffset: yearOffset,
    inQuarter: inQuarter, inYear: inYear,
    periodPicker: periodPicker,
  };
})();
