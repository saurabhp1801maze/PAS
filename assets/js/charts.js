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
  };
})();
