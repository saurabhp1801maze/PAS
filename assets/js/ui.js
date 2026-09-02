/* DOM-building component library. Ported from the "atoms" section of the original App.jsx —
   Pill, Badge, DataTable, Panel, KV, ActionBar, KpiRow, PageHeader, Field, Checkbox, Callout,
   CodeBlock, Tooltip, ScoreDial, RecordHead, DecisionLayout, BackLink, HBar, Donut,
   LogRequestForm, RequestOrigin, InitiatorPill, MethodBadge/StatusCodeBadge,
   ApiLifecycle/LifecycleStage — each turned into a small function that returns real DOM nodes
   (built via a tiny hyperscript-style `h()` helper) instead of JSX/vdom. */
(function (global) {
  "use strict";
  var PAS = global.PAS = global.PAS || {};

  /* conic-gradient()/background both accept a var() reference directly, so this stays token-driven
     rather than a second, driftable copy of the palette (this duplicated the pre-rebrand indigo
     hex values verbatim until caught by a grep sweep for stray hex literals). */
  var TONE_HEX = { green: "var(--color-success)", red: "var(--color-danger)", amber: "var(--color-warning)", blue: "var(--color-info)", violet: "var(--outcome-load)", indigo: "var(--color-brand)", gray: "var(--color-muted)" };

  /* ================= element builder ================= */
  function h(tag, props, children) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "style" && typeof v === "object") { Object.assign(el.style, v); return; }
      if (k === "dataset" && typeof v === "object") { Object.assign(el.dataset, v); return; }
      if (k.indexOf("on") === 0 && typeof v === "function") { el.addEventListener(k.slice(2).toLowerCase(), v); return; }
      if (k === "value") { el.value = v; return; }
      if (k === "checked" || k === "disabled" || k === "selected") { el[k] = !!v; return; }
      if (v === true) { el.setAttribute(k, ""); return; }
      el.setAttribute(k, v);
    });
    appendKids(el, children);
    return el;
  }
  function appendKids(el, children) {
    if (children == null) return;
    var arr = Array.isArray(children) ? children : [children];
    arr.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { appendKids(el, c); return; }
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  /* ================= tooltip (single shared floating box) ================= */
  var tipBoxEl = null, tipId = 0, activeTipAnchor = null;
  function tooltipText(opts) {
    var parts = [];
    if (opts.tip) parts.push(opts.tip);
    if (opts.what) parts.push("What: " + opts.what);
    if (opts.why) parts.push("Why: " + opts.why);
    if (opts.rule) parts.push("Rule: " + opts.rule);
    return parts.join(" ");
  }
  function ensureTipBox() {
    if (!tipBoxEl) {
      tipBoxEl = document.createElement("div");
      tipBoxEl.className = "tip-box";
      tipBoxEl.setAttribute("role", "tooltip");
      tipBoxEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(tipBoxEl);
    }
    return tipBoxEl;
  }
  function showTip(anchorEl, opts) {
    var box = ensureTipBox();
    activeTipAnchor = anchorEl;
    box.innerHTML = "";
    if (opts.tip) box.appendChild(h("span", { class: "tip-line" }, opts.tip));
    if (opts.what) box.appendChild(h("span", { class: "tip-line tip-what" }, [h("b", {}, "What "), document.createTextNode(opts.what)]));
    if (opts.why) box.appendChild(h("span", { class: "tip-line tip-why" }, [h("b", {}, "Why "), document.createTextNode(opts.why)]));
    if (opts.rule) box.appendChild(h("span", { class: "tip-line tip-rule" }, [h("b", {}, "Rule "), document.createTextNode(opts.rule)]));
    var w = opts.width || 280;
    box.style.width = w + "px";
    var r = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var below = r.bottom + 200 < vh;
    var x = Math.max(10, Math.min(r.left + r.width / 2 - w / 2, vw - w - 10));
    box.style.left = x + "px";
    if (below) { box.style.top = (r.bottom + 7) + "px"; box.style.bottom = "auto"; }
    else { box.style.bottom = (vh - r.top + 7) + "px"; box.style.top = "auto"; }
    box.classList.add("show");
    box.setAttribute("aria-hidden", "false");
  }
  function hideTip() {
    activeTipAnchor = null;
    if (tipBoxEl) { tipBoxEl.classList.remove("show"); tipBoxEl.setAttribute("aria-hidden", "true"); }
  }
  function tooltip(opts, child) {
    var hasTip = opts && (opts.tip || opts.what || opts.why || opts.rule);
    var wrap = h("span", { class: "tip-wrap" }, child);
    if (hasTip) {
      var descId = "pas-tip-desc-" + (++tipId);
      var desc = h("span", { class: "sr-only", id: descId }, tooltipText(opts));
      wrap.appendChild(desc);
      wrap.setAttribute("aria-describedby", descId);
      if (opts.focusable !== false) wrap.setAttribute("tabindex", "0");
      wrap.showTooltip = function () { showTip(wrap, opts); };
      wrap.hideTooltip = hideTip;
      wrap.tipDescriptionId = descId;
      wrap.addEventListener("mouseenter", wrap.showTooltip);
      wrap.addEventListener("mouseleave", hideTip);
      wrap.addEventListener("focus", wrap.showTooltip);
      wrap.addEventListener("blur", hideTip);
      if (opts.focusable !== false) {
        wrap.addEventListener("click", function (e) {
          e.stopPropagation();
          if (activeTipAnchor === wrap && tipBoxEl && tipBoxEl.classList.contains("show")) hideTip();
          else wrap.showTooltip();
        });
        wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { hideTip(); if (wrap.blur) wrap.blur(); } });
      }
    }
    return wrap;
  }
  document.addEventListener("click", function (e) {
    if (activeTipAnchor && !activeTipAnchor.contains(e.target)) hideTip();
  });
  function infoDot(size) { return PAS.icon("info", { size: size || 11, color: "var(--color-muted)" }); }
  function tipLabel(opts) {
    var span = h("span", { class: opts.className || "" }, opts.text);
    return tooltip(opts, [span, infoDot()]);
  }

  /* ================= basic atoms ================= */
  function pill(tone, text, iconName) {
    var kids = [];
    if (iconName) kids.push(PAS.icon(iconName, { size: 10 }));
    kids.push(document.createTextNode(text));
    return h("span", { class: "pill", "data-tone": tone || "gray" }, kids);
  }
  /* §10.1 Status Badge: fixed 20px height, 0 8px padding, 12px Inter 500 uppercase, 4px radius,
     never an icon inside (an icon may sit to its left, rendered by the caller). Distinct from
     `pill()` above, which stays the general icon-bearing tag/chip PAS already uses for module,
     initiator and role indicators — those are category tags, not lifecycle-status indicators, so
     they don't get folded into the narrower badge spec. */
  function statusBadge(tone, text) { return h("span", { class: "status-badge", "data-tone": tone || "gray" }, text); }
  function badge(status) { return statusBadge(PAS.STATUS_TONE[status] || "gray", status); }
  function txnStatusBadge(status) { return statusBadge(PAS.TXN_TONE[status] || "gray", status || "Completed"); }
  /* §10.2 Outcome Badge — decisioning-module outcomes (Accept/Decline/Refer/Load/Restrict/
     Evidence) get the `--outcome-*` tokens directly rather than the general tone system, per the
     framework's own token table; same shape as the status badge. */
  var OUTCOME_TONE = { Accept: "accept", Approve: "accept", Approved: "accept", Decline: "decline", Declined: "decline", Rejected: "decline", Refer: "refer", Referred: "refer", Escalate: "refer", Load: "load", Restrict: "restrict", Evidence: "evidence" };
  function outcomeBadge(outcome) {
    var key = OUTCOME_TONE[outcome] || "refer";
    return h("span", { class: "status-badge outcome-badge", "data-outcome": key }, outcome);
  }
  function modulePill(type) { return pill(PAS.MODULE_TONE[type], type, PAS.MODULE_ICON[type]); }
  /* labelOverrides is optional and defaults to none — every existing caller keeps showing
     PAS.INITIATORS' own shared label unchanged. A desk that needs its own wording for one
     initiator (without touching the shared map every other desk also reads from) passes e.g.
     { Carrier: "MGA" } and only that desk's pill/origin text changes. */
  function initiatorPill(meta, labelOverrides) {
    var key = meta && meta.initiatedBy;
    var init = PAS.INITIATORS[key] || PAS.INITIATORS.Insured;
    var label = (labelOverrides && labelOverrides[key]) || init.label;
    return pill(init.tone, label, init.icon);
  }
  function cellOpen(label) { return h("span", { class: "cell-open" }, [document.createTextNode(label || "Open"), PAS.icon("arrow-right", { size: 11 })]); }
  function cellId(v) { return h("span", { class: "cell-id" }, v); }
  function cellName(v) { return h("span", { class: "cell-name" }, v); }
  function methodBadge(method) { return h("span", { class: "method-badge" + (method === "GET" ? " get" : "") }, method); }
  function statusCodeBadge(code) {
    var cls = code >= 400 ? "err" : code === 202 ? "accepted" : "";
    return h("span", { class: "status-code-badge" + (cls ? " " + cls : "") }, String(code));
  }
  function codeBlock(data, small) { return h("pre", { class: "code-block" + (small ? " small" : "") }, JSON.stringify(data, null, 2)); }

  /* ================= data table ================= */
  /* opts.sortable: array of booleans parallel to opts.columns — true makes that header clickable.
     opts.sortState: { col, dir } | null — which column (index) is currently sorted and which way,
     purely for drawing the ▲/▼ indicator; the actual sort happens at the call site (it owns the
     real field values, this component only ever sees pre-rendered cells) and re-renders with a
     new sortState. opts.onSort(colIndex) fires on header click. */
  function dataTable(opts) {
    var wrap = h("div", { class: "table-wrap" });
    var scroll = h("div", {
      class: "table-scroll", tabindex: "0", role: "region",
      "aria-label": opts.ariaLabel || "Data table. Scroll horizontally to view additional columns.",
    });
    var table = h("table", { class: "data-table" });
    var thead = h("thead");
    var headRow = h("tr");
    opts.columns.forEach(function (c, i) {
      var th = h("th");
      var sortable = opts.sortable && opts.sortable[i];
      var labelNode = typeof c === "string"
        ? document.createTextNode(c)
        : tooltip({ what: c.what, why: c.why, rule: c.rule, tip: c.tip, focusable: !sortable }, [document.createTextNode(c.label), infoDot(10)]);
      if (sortable) {
        var active = opts.sortState && opts.sortState.col === i;
        th.classList.add("th-sortable");
        if (active) th.classList.add("th-sorted");
        th.setAttribute("aria-sort", active ? (opts.sortState.dir === "asc" ? "ascending" : "descending") : "none");
        var sortBtn = h("button", { class: "table-sort-btn", type: "button", "aria-label": "Sort by " + (typeof c === "string" ? c : c.label) }, [
          labelNode,
          h("span", { class: "th-sort-arrow", "aria-hidden": "true" }, active ? (opts.sortState.dir === "asc" ? "▲" : "▼") : "↕"),
        ]);
        if (labelNode.tipDescriptionId) {
          sortBtn.setAttribute("aria-describedby", labelNode.tipDescriptionId);
          sortBtn.addEventListener("focus", labelNode.showTooltip);
          sortBtn.addEventListener("blur", labelNode.hideTooltip);
          sortBtn.addEventListener("keydown", function (e) { if (e.key === "Escape") labelNode.hideTooltip(); });
        }
        sortBtn.addEventListener("click", function () { opts.onSort(i); });
        th.appendChild(sortBtn);
      } else th.appendChild(labelNode);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = h("tbody");
    opts.rows.forEach(function (r, i) {
      var tr = h("tr");
      if (opts.onRowClick) {
        tr.classList.add("has-row-click");
        tr.setAttribute("tabindex", "0");
        tr.setAttribute("role", "link");
        tr.setAttribute("aria-label", "View record " + (r[0] && r[0].textContent ? r[0].textContent : String(r[0] || i + 1)));
        tr.addEventListener("click", function () { opts.onRowClick(i); });
        tr.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onRowClick(i); }
        });
      }
      r.forEach(function (cell) {
        var td = h("td", { class: opts.wrapCells ? "wrap" : null });
        if (cell instanceof Node) td.appendChild(cell); else td.textContent = cell == null ? "" : String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    if (opts.rows.length === 0) {
      tbody.appendChild(h("tr", {}, h("td", { colspan: opts.columns.length, class: "table-empty" }, opts.emptyText || "Nothing here.")));
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    return wrap;
  }
  /* A dataTable with two things layered on top, shared by every "requests awaiting decision"
     desk list and the Policy Register: click-to-sort headers, and a "Columns" control the viewer
     uses to show/hide which of the available columns render (persisted per opts.storageKey so
     the choice survives navigating away and back).

     opts: {
       storageKey: sessionStorage key for the visible-column choice,
       columns: [{ key, label, locked, what, why, rule, sortValue(record), cell(record) }, ...],
         `locked` columns are always shown and never offered in the picker — reserve it for
         whichever column(s) identify the row, since hiding every column would leave nothing to
         click.
       defaultVisible: keys shown before the viewer has ever touched the picker (default: every
         non-locked column),
       trailingColumn: optional { label, cell(record) } appended after the data columns, always
         shown, never sortable — e.g. the row's "Review"/"Open" action,
       rows: the real records (not pre-rendered cells) — sortValue/cell both take one of these.
         Either a plain array (the common case — one fixed set for this render), or a function
         returning one, re-read on every rebuild — for a page like the Policy Register where its
         own search/filter controls change the row set and call `.rebuild()` after updating their
         own state, a static array captured at construction time would go stale immediately.
       onRowClick(record, i): i is the index into whatever order is currently displayed (post-
         sort), so callers must key off `record`, not a remembered index into their own array,
       emptyText, wrapCells: passed straight through to dataTable.
     }
     Returns { columnsControl, tableWrap, rebuild } — the two DOM nodes are standalone; the caller
     places them wherever fits its own layout (a toolbar row, next to a section label, ...) and
     may call `rebuild()` itself after changing something the table's own controls don't know
     about (e.g. a `rows` function whose upstream filter changed). */
  function sortableTable(opts) {
    var columns = opts.columns;
    var defaultVisible = opts.defaultVisible || columns.filter(function (c) { return !c.locked; }).map(function (c) { return c.key; });
    function loadVisible() {
      try {
        var raw = sessionStorage.getItem(opts.storageKey);
        if (raw) { var parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length) return parsed; }
      } catch (e) { /* ignore */ }
      return defaultVisible.slice();
    }
    function saveVisible(keys) { try { sessionStorage.setItem(opts.storageKey, JSON.stringify(keys)); } catch (e) { /* ignore */ } }
    var visibleKeys = loadVisible().filter(function (k) { return columns.some(function (c) { return c.key === k; }); });
    if (visibleKeys.length === 0) visibleKeys = defaultVisible.slice();

    var columnsBtnWrap = h("div", { class: "multiselect" });
    var columnsBtn = h("button", { type: "button", class: "field-input select-fixed multiselect-btn" }, "Columns");
    columnsBtnWrap.appendChild(columnsBtn);
    var panelEl = null;
    function onDocClick(e) { if (panelEl && !panelEl.contains(e.target) && !columnsBtn.contains(e.target)) closePanel(); }
    function closePanel() { if (!panelEl) return; panelEl.remove(); panelEl = null; document.removeEventListener("click", onDocClick); }
    function openPanel() {
      panelEl = h("div", { class: "multiselect-panel" });
      var list = h("div", { class: "multiselect-list" });
      columns.forEach(function (c) {
        if (c.locked) return;
        list.appendChild(checkboxRow({
          label: c.label, checked: visibleKeys.indexOf(c.key) !== -1,
          onChange: function (checked) {
            if (checked) { if (visibleKeys.indexOf(c.key) === -1) visibleKeys.push(c.key); }
            else { visibleKeys = visibleKeys.filter(function (k) { return k !== c.key; }); }
            saveVisible(visibleKeys);
            rebuild();
          },
        }));
      });
      panelEl.appendChild(list);
      columnsBtnWrap.appendChild(panelEl);
      document.addEventListener("click", onDocClick);
    }
    columnsBtn.addEventListener("click", function (e) { e.stopPropagation(); if (panelEl) closePanel(); else openPanel(); });

    var tableWrap = h("div", {});
    var sortState = null; /* { key, dir } */
    var pageSize = opts.pageSize || 0;
    var pageIndex = 0; /* 0-based */
    function rebuild() {
      var activeColumns = columns.filter(function (c) { return c.locked || visibleKeys.indexOf(c.key) !== -1; });
      var sortCol = sortState && activeColumns.filter(function (c) { return c.key === sortState.key; })[0];
      var rows = typeof opts.rows === "function" ? opts.rows() : opts.rows;
      if (sortCol) {
        var dir = sortState.dir;
        rows = rows.slice().sort(function (a, b) {
          var va = sortCol.sortValue(a), vb = sortCol.sortValue(b);
          var cmp = (typeof va === "number" && typeof vb === "number") ? (va - vb) : String(va).localeCompare(String(vb));
          return dir === "asc" ? cmp : -cmp;
        });
      }
      var total = rows.length;
      var pageRows = rows;
      var totalPages = 1;
      if (pageSize > 0) {
        totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (pageIndex >= totalPages) pageIndex = totalPages - 1;
        if (pageIndex < 0) pageIndex = 0;
        var start = pageIndex * pageSize;
        pageRows = rows.slice(start, start + pageSize);
      }
      var headerCols = activeColumns.map(function (c) { return (c.what || c.why || c.rule) ? { label: c.label, what: c.what, why: c.why, rule: c.rule } : c.label; });
      var sortableFlags = activeColumns.map(function () { return true; });
      if (opts.trailingColumn) { headerCols.push(opts.trailingColumn.label || ""); sortableFlags.push(false); }
      var sortDisplayState = sortCol ? { col: activeColumns.indexOf(sortCol), dir: sortState.dir } : null;
      tableWrap.innerHTML = "";
      tableWrap.appendChild(dataTable({
        columns: headerCols,
        sortable: sortableFlags,
        sortState: sortDisplayState,
        wrapCells: opts.wrapCells,
        onSort: function (i) {
          if (i >= activeColumns.length) return; /* the trailing action column isn't sortable */
          var key = activeColumns[i].key;
          if (sortState && sortState.key === key) sortState = { key: key, dir: sortState.dir === "asc" ? "desc" : "asc" };
          else sortState = { key: key, dir: "asc" };
          pageIndex = 0;
          rebuild();
        },
        rows: pageRows.map(function (r) {
          var cells = activeColumns.map(function (c) { return c.cell(r); });
          if (opts.trailingColumn) cells.push(opts.trailingColumn.cell(r));
          return cells;
        }),
        onRowClick: opts.onRowClick ? function (i) { opts.onRowClick(pageRows[i], i); } : null,
        emptyText: opts.emptyText,
      }));
      if (pageSize > 0) {
        var pager = h("div", { class: "table-pager" });
        var from = total === 0 ? 0 : pageIndex * pageSize + 1;
        var to = Math.min(total, (pageIndex + 1) * pageSize);
        pager.appendChild(h("span", { class: "table-pager-meta" }, total === 0 ? "No rows" : ("Showing " + from + "–" + to + " of " + total)));
        var nav = h("div", { class: "table-pager-nav" });
        var prev = h("button", { class: "btn small", type: "button", disabled: pageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (pageIndex > 0) { pageIndex--; rebuild(); } });
        var next = h("button", { class: "btn small", type: "button", disabled: pageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (pageIndex < totalPages - 1) { pageIndex++; rebuild(); } });
        nav.appendChild(prev);
        nav.appendChild(h("span", { class: "table-pager-page" }, "Page " + (pageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        tableWrap.appendChild(pager);
      }
    }
    function resetPage() { pageIndex = 0; }
    rebuild();
    return { columnsControl: columnsBtnWrap, tableWrap: tableWrap, rebuild: rebuild, resetPage: resetPage };
  }
  function deskList(opts) {
    var wrap = h("div", {});
    wrap.appendChild(pageHeader(opts));
    wrap.appendChild(kpiRow(opts.kpis));
    var columns = opts.columns.concat([""]);
    var rows = opts.rows.map(function (r) { return r.concat([cellOpen("Open")]); });
    wrap.appendChild(dataTable({ columns: columns, rows: rows, emptyText: opts.empty, onRowClick: opts.onOpen }));
    return wrap;
  }

  /* ================= KPI row ================= */
  /* wrap: true switches from an exact N-column grid (fine for the usual 4-item desk strip) to a
     responsive auto-fit grid that wraps onto a second row once cards no longer fit — needed once
     a KPI strip grows past what one row can hold at a readable width. */
  /* opts.href turns a card into a real link to the desk that count belongs to — not just a
     number, a way to act on it. Kept keyboard-accessible (role=link, tabindex, Enter/Space) since
     it's a div, not a native <a>. */
  function kpiRow(items, wrap) {
    var row = h("div", { class: "kpi-row" + (wrap ? " wrap" : ""), style: wrap ? {} : { gridTemplateColumns: "repeat(" + items.length + ",minmax(0,1fr))" } });
    items.forEach(function (s) {
      var card = h("div", { class: "kpi-card" + (s.href ? " clickable" : "") });
      var labelEl = s.tip || s.why
        ? tooltip({ tip: s.tip, why: s.why, focusable: !s.href }, [h("span", { class: "label-11 kpi-label" }, s.label), infoDot(10)])
        : h("div", { class: "label-11 kpi-label" }, s.label);
      card.appendChild(labelEl);
      var valueRow = h("div", { class: "kpi-value-row" });
      valueRow.appendChild(h("span", { class: "kpi-value" + (s.tone ? " toned" : ""), "data-tone": s.tone || null }, String(s.value)));
      if (s.delta) valueRow.appendChild(h("span", {
        class: "kpi-delta " + (s.deltaTone ? "toned" : (s.delta.indexOf("+") === 0 ? "up" : "down")),
        "data-tone": s.deltaTone || null,
        title: s.deltaTitle || null,
      }, s.delta));
      card.appendChild(valueRow);
      if (s.href) {
        card.setAttribute("role", "link");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", s.ariaLabel || ("View " + s.label + ": " + s.value));
        if (labelEl.tipDescriptionId) {
          card.setAttribute("aria-describedby", labelEl.tipDescriptionId);
          card.addEventListener("focus", labelEl.showTooltip);
          card.addEventListener("blur", labelEl.hideTooltip);
        }
        card.addEventListener("click", function () { location.href = s.href; });
        card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.href = s.href; } });
      }
      row.appendChild(card);
    });
    return row;
  }
  /* A labeled group of KPIs — groups a flat KPI strip under a named category (e.g. "Book &
     premium", "Risk & renewal") instead of one undifferentiated row. */
  function kpiSection(opts, items) {
    var wrap = h("div", { class: "kpi-section" });
    var head = h("div", { class: "kpi-section-head" });
    head.appendChild(h("span", { class: "kpi-section-label" }, opts.label));
    if (opts.sub) head.appendChild(h("span", { class: "kpi-section-sub" }, opts.sub));
    wrap.appendChild(head);
    var row = kpiRow(items);
    if (opts.rowClass) {
      row.classList.add(opts.rowClass);
      /* A named responsive class must be allowed to control the columns. */
      row.style.gridTemplateColumns = "";
    }
    wrap.appendChild(row);
    return wrap;
  }

  /* ================= action bar / buttons ================= */
  function actionBar(actions) {
    var bar = h("div", { class: "action-bar" });
    var busy = null;
    var current = actions;
    function render() {
      bar.innerHTML = "";
      current.forEach(function (a) {
        var btn = h("button", { class: "btn" + (a.tone ? " tone-" + a.tone : "") + (busy && busy !== a.label ? " busy" : ""), disabled: a.disabled || !!busy });
        if (busy === a.label) {
          var sp = PAS.icon("loader-2", { size: 13 }); sp.classList.add("spin");
          btn.appendChild(sp); btn.appendChild(document.createTextNode(" Working…"));
        } else {
          if (a.icon) btn.appendChild(PAS.icon(a.icon, { size: 13 }));
          btn.appendChild(document.createTextNode((a.icon ? " " : "") + a.label));
        }
        btn.addEventListener("click", function () {
          if (a.disabled || busy) return;
          function go(comment) {
            busy = a.label; render();
            Promise.resolve(a.onRun(comment)).then(function () { busy = null; render(); }).catch(function (err) { busy = null; render(); console.error(err); });
          }
          if (a.confirm) {
            confirmDecision(Object.assign({ tone: a.tone }, a.confirm)).then(function (comment) {
              if (comment == null) return;
              go(comment);
            });
            return;
          }
          go();
        });
        bar.appendChild(a.disabled && a.disabledReason ? tooltip({ rule: a.disabledReason, width: 290 }, btn) : btn);
      });
    }
    render();
    bar.updateActions = function (newActions) { current = newActions; render(); };
    return bar;
  }
  function backLink(label, onClick) {
    var btn = h("button", { class: "back-link" }, [PAS.icon("arrow-left", { size: 14 }), document.createTextNode(" " + label)]);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /* §10.6 Tabs. opts: { items: [{key,label}], active: key, onChange(key), pill: bool }.
     role=tablist/tab + aria-selected, matching the ARIA pattern policy-detail.js's own hand-built
     tab bar already follows — this is the reusable version of that same shape for other pages. */
  function tabs(opts) {
    var row = h("div", { class: "tabs" + (opts.pill ? " pill" : ""), role: "tablist" });
    var active = opts.active;
    function render() {
      row.innerHTML = "";
      opts.items.forEach(function (it) {
        var isActive = it.key === active;
        var btn = h("button", { class: "tab-btn" + (isActive ? " active" : ""), type: "button", role: "tab", "aria-selected": isActive ? "true" : "false" }, it.label);
        btn.addEventListener("click", function () { if (active === it.key) return; active = it.key; render(); opts.onChange(it.key); });
        row.appendChild(btn);
      });
    }
    render();
    row.setActive = function (key) { active = key; render(); };
    return row;
  }

  /* §10.10 Empty State — centered illustration + heading + description + optional action.
     `opts: { heading, description, actionLabel, onAction }`. Copy rule from the spec: state what
     can be done, not what's absent ("Create your first X" rather than "No records found"), left
     to each call site to phrase — this only supplies the shape. */
  function emptyState(opts) {
    var wrap = h("div", { class: "empty-state" });
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "120"); svg.setAttribute("height", "120"); svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("fill", "none"); svg.classList.add("empty-state-illo");
    svg.innerHTML = '<rect x="28" y="40" width="64" height="48" rx="4" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M28 56h64" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="40" cy="48" r="2.5" fill="currentColor"/><circle cx="49" cy="48" r="2.5" fill="currentColor"/>' +
      '<path d="M44 70h32M44 78h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    wrap.appendChild(svg);
    wrap.appendChild(h("div", { class: "empty-state-heading" }, opts.heading));
    if (opts.description) wrap.appendChild(h("div", { class: "empty-state-desc" }, opts.description));
    if (opts.actionLabel && opts.onAction) {
      var btn = h("button", { class: "btn tone-primary", type: "button" }, opts.actionLabel);
      btn.addEventListener("click", opts.onAction);
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /* §10.14 Diff / Version Comparison Panel. opts: { before, after, beforeLabel, afterLabel }.
     Block-level (whole-value before/after), not a word-level diff — the app's one real consumer
     (Terms & Conditions' clause reset view) compares whole retyped clause text, where a word-diff
     algorithm would add real complexity for a comparison a reader does just as well by reading two
     full paragraphs side by side. */
  function diffPanel(opts) {
    var wrap = h("div", { class: "diff-panel" });
    var before = h("div", { class: "diff-col diff-removed" });
    before.appendChild(h("div", { class: "diff-col-label" }, opts.beforeLabel || "Before"));
    before.appendChild(h("div", { class: "diff-col-body" }, opts.before));
    var after = h("div", { class: "diff-col diff-added" });
    after.appendChild(h("div", { class: "diff-col-label" }, opts.afterLabel || "After"));
    after.appendChild(h("div", { class: "diff-col-body" }, opts.after));
    wrap.appendChild(before);
    wrap.appendChild(after);
    return wrap;
  }

  /* §10.15 Stepper / Progress indicator. opts: steps: [label], activeIndex. */
  function stepper(opts) {
    var wrap = h("div", { class: "stepper" });
    opts.steps.forEach(function (label, i) {
      var state = i < opts.activeIndex ? "done" : i === opts.activeIndex ? "active" : "upcoming";
      var step = h("div", { class: "stepper-step", "data-state": state });
      var circle = h("div", { class: "stepper-circle" }, state === "done" ? "" : String(i + 1));
      if (state === "done") circle.appendChild(PAS.icon("check-circle-2", { size: 14 }));
      step.appendChild(circle);
      step.appendChild(h("div", { class: "stepper-label" }, label));
      wrap.appendChild(step);
      if (i < opts.steps.length - 1) wrap.appendChild(h("div", { class: "stepper-connector", "data-state": state === "done" ? "done" : "upcoming" }));
    });
    return wrap;
  }

  /* §10.17 Drawer (side panel). opts: { width: 480|640, header (node/string), body (node),
     footer (node), onClose }. Returns { open(triggerEl), close() }. Focus management matches
     confirmDecision's modal: trap Tab inside while open, restore focus to the trigger on close. */
  function drawer(opts) {
    var overlay = null, panel = null, trigger = null;
    function close() {
      if (!overlay) return;
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null; panel = null;
      if (trigger && trigger.focus && document.contains(trigger)) trigger.focus();
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab" || !panel) return;
      var focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open() {
      trigger = document.activeElement;
      overlay = h("div", { class: "drawer-overlay", role: "presentation" });
      panel = h("div", { class: "drawer-panel" + (opts.width === 640 ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": "drawer-title" });
      var head = h("div", { class: "drawer-head" });
      var titleEl = h("div", { class: "drawer-title", id: "drawer-title" });
      appendKids(titleEl, opts.header);
      head.appendChild(titleEl);
      var closeBtn = h("button", { class: "btn icon-only", type: "button", "aria-label": "Close" });
      closeBtn.appendChild(PAS.icon("x", { size: 16 }));
      closeBtn.addEventListener("click", close);
      head.appendChild(closeBtn);
      panel.appendChild(head);
      var body = h("div", { class: "drawer-body" });
      appendKids(body, opts.body);
      panel.appendChild(body);
      if (opts.footer) {
        var footer = h("div", { class: "drawer-footer" });
        appendKids(footer, opts.footer);
        panel.appendChild(footer);
      }
      overlay.appendChild(panel);
      overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      setTimeout(function () { closeBtn.focus(); }, 0);
    }
    return { open: open, close: close };
  }

  /* ================= KV / panel ================= */
  function kv(opts) {
    var row = h("div", { class: "kv-row" });
    row.appendChild(opts.tip || opts.what || opts.why || opts.rule
      ? tooltip({ tip: opts.tip, what: opts.what, why: opts.why, rule: opts.rule }, [h("span", { class: "kv-key" }, opts.k), infoDot(10)])
      : h("span", { class: "kv-key" }, opts.k));
    var valEl = h("span", { class: "kv-val" + (opts.mono ? " mono" : "") });
    if (opts.v instanceof Node) valEl.appendChild(opts.v); else valEl.textContent = opts.v;
    row.appendChild(valEl);
    return row;
  }
  function panel(opts, body) {
    var p = h("div", { class: "panel" + (opts.pad === 0 ? " no-pad" : "") });
    var head = h("div", { class: "panel-head" });
    head.appendChild(opts.what || opts.why || opts.tip || opts.rule
      ? tipLabel({ text: opts.title, what: opts.what, why: opts.why, tip: opts.tip, rule: opts.rule, className: "panel-title" })
      : h("span", { class: "panel-title" }, opts.title));
    if (opts.right) head.appendChild(opts.right);
    p.appendChild(head);
    var bodyEl = h("div", { class: "panel-body" });
    appendKids(bodyEl, body);
    p.appendChild(bodyEl);
    return p;
  }

  /* Independent open/close section — used for reference blocks on desks (e.g. cancellation
     terminology). Sections do not auto-close siblings; each acts like its own dropdown. */
  function accordionSection(opts) {
    var open = !!opts.open;
    var section = h("div", { class: "accordion-section" + (open ? " is-open" : "") });
    var head = h("button", {
      type: "button",
      class: "accordion-head",
      "aria-expanded": open ? "true" : "false",
    });
    var titleWrap = h("div", { class: "accordion-title-wrap" });
    titleWrap.appendChild(tipLabel({
      text: opts.title,
      what: opts.what,
      why: opts.why,
      className: "accordion-title",
    }));
    if (opts.sub) titleWrap.appendChild(h("div", { class: "accordion-sub" }, opts.sub));
    head.appendChild(titleWrap);
    var chevron = PAS.icon(open ? "chevron-up" : "chevron-down", { size: 16, color: "var(--color-muted)" });
    head.appendChild(chevron);
    section.appendChild(head);
    var body = h("div", { class: "accordion-body" + (opts.pad === 0 ? " no-pad" : "") });
    appendKids(body, opts.body);
    if (!open) body.hidden = true;
    section.appendChild(body);
    head.addEventListener("click", function () {
      open = !open;
      section.classList.toggle("is-open", open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
      body.hidden = !open;
      var next = PAS.icon(open ? "chevron-up" : "chevron-down", { size: 16, color: "var(--color-muted)" });
      head.replaceChild(next, chevron);
      chevron = next;
    });
    return section;
  }
  function accordion(opts) {
    var wrap = h("div", { class: "accordion" });
    (opts.sections || []).forEach(function (sec) {
      wrap.appendChild(accordionSection(sec));
    });
    return wrap;
  }

  /* ================= page header ================= */
  function pageHeader(opts) {
    var wrap = h("div", { class: "page-header" });
    if (opts.icon) {
      var iconBox = h("div", { class: "page-header-icon", "data-tone": opts.tone || "indigo" });
      iconBox.appendChild(PAS.icon(opts.icon, { size: 18 }));
      wrap.appendChild(iconBox);
    }
    var mid = h("div", { style: { minWidth: "0", flex: "1" } });
    /* §30: every page needs exactly one page-level <h1> — this was a plain <div> before, meaning
       screen-reader heading navigation found nothing to land on for the page title anywhere in
       the app. pageHeader() is the one place every page's title renders through, so fixing the
       tag here fixes it everywhere at once. */
    var titleWrap = h("h1", { class: "page-header-title" });
    titleWrap.appendChild(opts.what
      ? tooltip({ what: opts.what, why: opts.why, width: 330 }, [document.createTextNode(opts.title), infoDot(13)])
      : document.createTextNode(opts.title));
    mid.appendChild(titleWrap);
    if (opts.sub) mid.appendChild(h("div", { class: "page-header-sub" }, opts.sub));
    wrap.appendChild(mid);
    if (opts.right) wrap.appendChild(opts.right);
    return wrap;
  }

  /* ================= forms ================= */
  function field(opts, inputEl) {
    var wrap = h("div", { class: "field" });
    wrap.appendChild(h("label", { class: "label-11 field-label" }, opts.label));
    wrap.appendChild(inputEl);
    if (opts.hint) wrap.appendChild(h("div", { class: "field-hint" }, opts.hint));
    return wrap;
  }
  function checkboxRow(opts) {
    var label = h("label", { class: "checkbox-row" });
    var input = h("input", { type: "checkbox", checked: opts.checked });
    input.addEventListener("change", function (e) { opts.onChange(e.target.checked); });
    label.appendChild(input);
    label.appendChild(document.createTextNode(opts.label));
    return label;
  }
  /* A checkbox-dropdown: a button showing a summary ("All", one label, or "N selected") that
     opens a panel of checkboxRow options with All/None actions. `opts.selected` is an array —
     empty means "All" (no restriction), matching the button's own label logic, so an untouched
     filter and an explicitly-cleared one behave identically. */
  function multiSelect(opts) {
    var wrap = h("div", { class: "multiselect" });
    var btn = h("button", { type: "button", class: "field-input select-fixed multiselect-btn" });
    wrap.appendChild(btn);
    var panelEl = null;
    function optValue(o) { return typeof o === "string" ? o : o.value; }
    function optLabel(o) { return typeof o === "string" ? o : o.label; }
    function labelFor(v) { var m = opts.options.filter(function (o) { return optValue(o) === v; })[0]; return m ? optLabel(m) : v; }
    function updateBtn() {
      var n = opts.selected.length;
      btn.textContent = (n === 0 || n === opts.options.length) ? (opts.allLabel || "All")
        : n === 1 ? labelFor(opts.selected[0]) : n + " selected";
    }
    function onDocClick(e) { if (panelEl && !panelEl.contains(e.target) && !btn.contains(e.target)) closePanel(); }
    function closePanel() {
      if (!panelEl) return;
      panelEl.remove(); panelEl = null;
      document.removeEventListener("click", onDocClick);
    }
    function openPanel() {
      panelEl = h("div", { class: "multiselect-panel" });
      var actions = h("div", { class: "multiselect-actions" });
      var allBtn = h("button", { type: "button", class: "btn ghost-link" }, "All");
      var noneBtn = h("button", { type: "button", class: "btn ghost-link" }, "None");
      function pickAll(e) { e.stopPropagation(); opts.selected = opts.options.map(optValue); updateBtn(); opts.onChange(opts.selected.slice()); closePanel(); openPanel(); }
      function pickNone(e) { e.stopPropagation(); opts.selected = []; updateBtn(); opts.onChange(opts.selected.slice()); closePanel(); openPanel(); }
      allBtn.addEventListener("click", pickAll);
      noneBtn.addEventListener("click", pickNone);
      actions.appendChild(allBtn); actions.appendChild(noneBtn);
      panelEl.appendChild(actions);
      var list = h("div", { class: "multiselect-list" });
      opts.options.forEach(function (o) {
        var v = optValue(o), lbl = optLabel(o);
        list.appendChild(checkboxRow({
          label: lbl, checked: opts.selected.indexOf(v) !== -1,
          onChange: function (checked) {
            if (checked) { if (opts.selected.indexOf(v) === -1) opts.selected.push(v); }
            else { opts.selected = opts.selected.filter(function (x) { return x !== v; }); }
            updateBtn();
            opts.onChange(opts.selected.slice());
          },
        }));
      });
      panelEl.appendChild(list);
      wrap.appendChild(panelEl);
      document.addEventListener("click", onDocClick);
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (panelEl) closePanel(); else openPanel(); });
    updateBtn();
    return wrap;
  }

  /* §10.8 Callout / Alert Banner — 5 types (info/warning/error/success/brand), 4px left-colored
     border + icon + text. `tone` keeps its existing short keywords (info/warn/bad/good) plus the
     literal "brand" type for platform-announcement callouts (SS10.8, SS24). */
  var CALLOUT = {
    info: { data: "info", icon: "info" }, warn: { data: "warn", icon: "alert-triangle" },
    bad: { data: "bad", icon: "x-circle" }, good: { data: "good", icon: "check-circle-2" },
    brand: { data: "brand", icon: "zap" },
  };
  function callout(tone, content) {
    var spec = CALLOUT[tone] || CALLOUT.info;
    var div = h("div", { class: "callout", "data-callout": spec.data });
    div.appendChild(h("span", { class: "callout-icon" }, PAS.icon(spec.icon, { size: 15 })));
    var body = h("div", { class: "callout-body" });
    appendKids(body, content);
    div.appendChild(body);
    return div;
  }

  /* ================= dashboard visuals ================= */
  function hbar(opts) {
    var pct = opts.max ? Math.max(1.5, (opts.value / opts.max) * 100) : 0;
    var wrap = h("div", { class: "hbar", title: opts.tip || null, "aria-label": opts.ariaLabel || null });
    var headRow = h("div", { class: "hbar-head" });
    if (opts.onClick) {
      var labelBtn = h("button", { class: "hbar-label hbar-label-link", type: "button" }, opts.label);
      labelBtn.addEventListener("click", opts.onClick);
      headRow.appendChild(labelBtn);
    } else {
      headRow.appendChild(h("span", { class: "hbar-label" }, opts.label));
    }
    headRow.appendChild(h("span", { class: "hbar-note" }, opts.note));
    wrap.appendChild(headRow);
    var track = h("div", { class: "hbar-track", "data-tone": opts.tone || "indigo" });
    track.appendChild(h("div", { class: "hbar-fill", style: { width: pct + "%" } }));
    wrap.appendChild(track);
    return wrap;
  }
  function donut(opts) {
    var acc = 0;
    var stops = opts.segments.filter(function (s) { return s.value > 0; }).map(function (s) {
      var from = (acc / opts.total) * 360; acc += s.value; var to = (acc / opts.total) * 360;
      return TONE_HEX[s.tone] + " " + from + "deg " + to + "deg";
    }).join(", ");
    var wrap = h("div", { class: "donut-wrap" });
    var d = h("div", { class: "donut", style: { background: "conic-gradient(" + stops + ")" } });
    var center = h("div", { class: "donut-center" });
    center.appendChild(h("span", { class: "donut-center-value" }, String(opts.centerValue)));
    center.appendChild(h("span", { class: "donut-center-label" }, opts.centerLabel));
    d.appendChild(center);
    wrap.appendChild(d);
    var legend = h("div", { class: "donut-legend" });
    opts.segments.forEach(function (s) {
      var row = h("div", { class: "donut-legend-row" });
      row.appendChild(h("span", { class: "donut-swatch", style: { background: TONE_HEX[s.tone] } }));
      row.appendChild(h("span", { class: "donut-legend-label" }, s.label));
      row.appendChild(h("span", { class: "donut-legend-value" }, String(s.value)));
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    return wrap;
  }
  /* A single-row composition chart — segments sized by share of opts.total — always paired with
     a legend list below carrying a swatch, a text label and the count, so identity never rests on
     color alone (some of this app's tone pairs, e.g. violet/blue, are not reliably distinguishable
     by color). opts: { segments: [{label, value, tone, onClick}], total, empty }. */
  function stackBar(opts) {
    var total = opts.total || opts.segments.reduce(function (t, s) { return t + s.value; }, 0);
    var wrap = h("div", {});
    var present = opts.segments.filter(function (s) { return s.value > 0; });
    if (present.length === 0) {
      wrap.appendChild(h("div", { class: "faint-note" }, opts.empty || "Nothing to show."));
      return wrap;
    }
    var bar = h("div", { class: "stack-bar" });
    present.forEach(function (s) {
      var pct = total ? Math.max(2, (s.value / total) * 100) : 0;
      bar.appendChild(h("div", { class: "stack-bar-seg", style: { width: pct + "%", background: TONE_HEX[s.tone] } }));
    });
    wrap.appendChild(bar);
    var legend = h("div", { class: "stack-bar-legend" });
    present.forEach(function (s) {
      var row = h("div", { class: "stack-bar-row" });
      row.appendChild(h("span", { class: "stack-bar-swatch", style: { background: TONE_HEX[s.tone] } }));
      row.appendChild(h("span", { class: "stack-bar-row-label" }, s.label));
      row.appendChild(h("span", { class: "stack-bar-row-pct" }, Math.round((s.value / total) * 100) + "%"));
      row.appendChild(h("span", { class: "stack-bar-row-value" }, String(s.value)));
      if (s.onClick) row.addEventListener("click", s.onClick);
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    return wrap;
  }
  function workCard(opts) {
    var card = h("div", { class: "work-card", "data-tone": opts.tone });
    card.addEventListener("click", opts.onClick);
    var top = h("div", { class: "work-card-top" });
    top.appendChild(PAS.icon(opts.icon, { size: 14 }));
    top.appendChild(h("span", { class: "work-card-n" }, String(opts.n)));
    card.appendChild(top);
    card.appendChild(h("div", { class: "work-card-label" }, opts.label));
    card.appendChild(h("div", { class: "work-card-sub" }, opts.sub));
    card.appendChild(h("div", { class: "work-card-open" }, [document.createTextNode("Open desk "), PAS.icon("arrow-right", { size: 11 })]));
    return card;
  }

  /* ================= decision-screen scaffolding ================= */
  function recordHead(p, right) {
    var wrap = h("div", { class: "record-head" });
    var left = h("div", {});
    left.appendChild(h("div", { class: "record-head-id" }, p.id + " · term " + p.termNumber));
    /* §30: decision/detail pages render through recordHead() instead of pageHeader() (see the
       record name above the KPI strip) — same one-<h1>-per-page fix as pageHeader(), for the
       same reason: nothing was a heading here at all before. */
    left.appendChild(h("h1", { class: "record-head-name" }, p.holder));
    left.appendChild(h("div", { class: "record-head-meta" }, p.product + " · via " + p.producer + " · " + PAS.money(p.premium)));
    wrap.appendChild(left);
    var rightWrap = h("div", { class: "record-head-right" });
    if (right) appendKids(rightWrap, right);
    rightWrap.appendChild(badge(p.status));
    wrap.appendChild(rightWrap);
    return wrap;
  }
  /* Confirmation modal for every desk decision. Resolves with the comment, or null if cancelled. */
  function confirmDecision(opts) {
    return new Promise(function (resolve) {
      var existing = document.querySelector ? document.querySelector(".decision-modal-overlay") : null;
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      var minRec = PAS.COMMENT_MIN_RECOMMENDED || 20;
      var action = opts.action || "Confirm";
      var tone = opts.tone || (action === "Decline" ? "red" : action === "Approve" || action === "Issue" ? "green" : "indigo");
      var warning = opts.warning || (PAS.DECISION_WARNINGS && PAS.DECISION_WARNINGS[action]) || "This action is recorded permanently and cannot be easily reversed.";

      var overlay = h("div", { class: "decision-modal-overlay", role: "presentation" });
      var modal = h("div", { class: "decision-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "decision-modal-title" });

      var head = h("div", { class: "decision-modal-head" });
      head.appendChild(h("div", { class: "decision-modal-kicker" }, "Confirm decision"));
      head.appendChild(h("h2", { class: "decision-modal-title", id: "decision-modal-title" }, action));
      modal.appendChild(head);

      var summary = h("div", { class: "decision-modal-summary" });
      [["Policy No.", opts.policyNo || "—"], ["Transaction No.", opts.txnNo || "—"], ["Action", action]].forEach(function (pair) {
        var cell = h("div", { class: "decision-modal-sum-cell" });
        cell.appendChild(h("div", { class: "decision-modal-sum-k" }, pair[0]));
        cell.appendChild(h("div", { class: "decision-modal-sum-v" + (pair[0] === "Action" ? "" : " mono") }, pair[1]));
        summary.appendChild(cell);
      });
      modal.appendChild(summary);

      var warn = h("div", { class: "decision-modal-warn" });
      warn.appendChild(PAS.icon("alert-triangle", { size: 14 }));
      warn.appendChild(h("span", {}, warning));
      modal.appendChild(warn);

      var ta = h("textarea", {
        class: "field-input decision-modal-comment",
        rows: "4",
        maxlength: "2000",
        placeholder: "Comment is required. State the reason for this decision (minimum " + minRec + " characters recommended)…",
      });
      var counter = h("div", { class: "decision-modal-counter" });
      var btnTone = (tone === "red" || tone === "green" || tone === "primary") ? tone : "primary";
      var confirmBtn = h("button", { class: "btn tone-" + btnTone, type: "button", disabled: true }, PAS.t("action.confirm", "Confirm"));
      function sync() {
        var n = ta.value.trim().length;
        var ok = n > 0 && (!opts.typedConfirm || (typedInput && typedInput.value.trim() === opts.typedConfirm));
        confirmBtn.disabled = !ok;
        counter.textContent = n + " / " + minRec + " recommended";
        counter.setAttribute("data-state", n === 0 ? "empty" : n < minRec ? "short" : "ok");
      }
      ta.addEventListener("input", sync);
      ta.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !confirmBtn.disabled) confirmBtn.click();
      });

      modal.appendChild(field({ label: "Decision comment", hint: "Stored on the ledger with your name and the time of confirmation. Required." }, ta));
      modal.appendChild(counter);

      var emailInput = null;
      if (opts.showEmail) {
        emailInput = h("input", { class: "field-input", type: "email", placeholder: opts.emailPlaceholder || "name@company.com", value: opts.emailDefault || "" });
        modal.appendChild(field({ label: "Notify by email (optional)", hint: "Sent via the notification service (SMTP) the moment you confirm — leave blank to skip." }, emailInput));
      }

      var categorySelect = null;
      if (opts.showCategory) {
        categorySelect = h("select", { class: "field-input" });
        (PAS.ISSUE_CATEGORIES || ["Other"]).forEach(function (c) { categorySelect.appendChild(h("option", { value: c }, c)); });
        modal.appendChild(field({ label: "Category", hint: "Routes this to the right team — one dropdown instead of a separate button per issue type." }, categorySelect));
      }

      /* §10.16 typed confirmation: for the handful of actions that are genuinely hard to reverse
         (cancelling a bound policy, for example), requiring the record ID to be retyped is extra
         friction the framework says to spend specifically where the risk justifies it — not on
         every decision, which is why this is opt-in via opts.typedConfirm rather than default. */
      var typedInput = null;
      if (opts.typedConfirm) {
        typedInput = h("input", { class: "field-input", type: "text", autocomplete: "off", spellcheck: "false" });
        modal.appendChild(field({ label: "Type " + opts.typedConfirm + " to confirm", hint: "This action is hard to reverse — retype the record ID to proceed." }, typedInput));
        typedInput.addEventListener("input", sync);
      }

      var actions = h("div", { class: "decision-modal-actions" });
      var cancelBtn = h("button", { class: "btn", type: "button" }, "Cancel");
      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      sync();
      /* §13 focus management: capture the trigger so focus returns to it on close, and trap Tab
         inside the modal while it's open (a plain Escape-listener alone doesn't stop Tab from
         reaching the page behind the overlay). */
      var trigger = document.activeElement;
      setTimeout(function () { if (ta.focus) ta.focus(); }, 0);

      var settled = false;
      function close(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (trigger && trigger.focus && document.contains(trigger)) trigger.focus();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") { close(null); return; }
        if (e.key !== "Tab") return;
        var focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("click", function (e) { if (e.target === overlay) close(null); });
      cancelBtn.addEventListener("click", function () { close(null); });
      confirmBtn.addEventListener("click", function () {
        var comment = ta.value.trim();
        if (!comment) return;
        if (opts.typedConfirm && (!typedInput || typedInput.value.trim() !== opts.typedConfirm)) return;
        /* The record is being submitted now — every decision desk (Approve/Decline/Escalate/
           Request more information/etc.) funnels through this one modal, so this is the single
           place that needs to clear the §12 dirty flag, rather than every store.js commit point
           (some of which, like the Escalate/hold path, never call a PAS.decide*() function at all). */
        if (PAS.clearDirty) PAS.clearDirty();
        close((opts.showEmail || opts.showCategory)
          ? { comment: comment, email: emailInput ? emailInput.value.trim() : "", category: categorySelect ? categorySelect.value : "" }
          : comment);
      });
    });
  }
  function confirmable(policyNo, txnNo, action, spec) {
    return Object.assign({}, spec, {
      confirm: { policyNo: policyNo, txnNo: txnNo || "—", action: action, warning: spec.warning, showEmail: spec.showEmail, emailPlaceholder: spec.emailPlaceholder, emailDefault: spec.emailDefault, showCategory: spec.showCategory, typedConfirm: spec.typedConfirm },
    });
  }
  function decisionTrail(rows) {
    var wrap = h("div", { class: "decision-trail" });
    var head = h("div", { class: "decision-trail-title-row" });
    head.appendChild(PAS.icon("git-branch", { size: 14, color: "var(--color-brand)" }));
    head.appendChild(tipLabel({
      text: "Decision history",
      what: "Every comment left on Approve, Decline, Escalate, Request more information, and the original request.",
      why: "Comments are the audit trail — who said what, and when.",
      className: "decision-trail-title",
    }));
    if (rows && rows.length) {
      head.appendChild(h("span", { class: "decision-trail-count" }, rows.length + (rows.length === 1 ? " comment" : " comments")));
    }
    wrap.appendChild(head);

    if (!rows || rows.length === 0) {
      var empty = h("div", { class: "decision-trail-empty" });
      empty.appendChild(PAS.icon("edit-3", { size: 16, color: "var(--color-muted)" }));
      empty.appendChild(h("div", {}, "No comments yet"));
      empty.appendChild(h("div", { class: "decision-trail-empty-hint" }, "When you Approve, Decline, Escalate, or Request more information, your comment appears here."));
      wrap.appendChild(empty);
      return wrap;
    }

    var list = h("div", { class: "decision-trail-list" });
    rows.slice().reverse().forEach(function (a) {
      var tone = a.action === "Decline" ? "red"
        : (a.action === "Approve" || a.action === "Issue") ? "green"
        : a.action === "Escalate" ? "amber"
        : a.action === "Request More Information" ? "blue"
        : a.action === "Request" ? "violet"
        : "indigo";
      var iconName = a.action === "Decline" ? "ban"
        : (a.action === "Approve" || a.action === "Issue") ? "check-circle-2"
        : a.action === "Escalate" ? "arrow-up-right"
        : a.action === "Request More Information" ? "corner-up-left"
        : a.action === "Request" ? "inbox"
        : "edit-3";

      var card = h("div", { class: "decision-trail-card", "data-tone": tone });
      var top = h("div", { class: "decision-trail-card-top" });
      var avatar = h("div", { class: "decision-trail-avatar", "data-tone": tone });
      avatar.appendChild(PAS.icon(iconName, { size: 13 }));
      top.appendChild(avatar);
      var meta = h("div", { class: "decision-trail-meta" });
      meta.appendChild(h("div", { class: "decision-trail-user" }, a.user || "Unknown"));
      meta.appendChild(h("div", { class: "decision-trail-at" }, a.at
        ? new Date(a.at).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—"));
      top.appendChild(meta);
      top.appendChild(pill(tone, a.action));
      if (a.category) top.appendChild(pill("gray", a.category));
      card.appendChild(top);

      var quote = h("div", { class: "decision-trail-quote" });
      quote.appendChild(h("div", { class: "decision-trail-quote-label" }, "Comment"));
      quote.appendChild(h("div", { class: "decision-trail-comment" }, a.comment || "—"));
      card.appendChild(quote);
      list.appendChild(card);
    });
    wrap.appendChild(list);
    return wrap;
  }
  function decisionTrailSide(rows) {
    var wrap = h("div", { class: "decision-trail-side" });
    wrap.appendChild(decisionTrail(rows));
    return wrap;
  }
  function flashThenGo(href, note) {
    PAS.setFlash(note);
    location.href = href;
  }

  function decisionLayout(leftNode, rightNode, actions) {
    var wrap = h("div", { class: "decision-layout" });
    var grid = h("div", { class: "decision-grid" });
    var leftCol = h("div", { class: "decision-col left" }); appendKids(leftCol, leftNode);
    var rightCol = h("div", { class: "decision-col" }); appendKids(rightCol, rightNode);
    grid.appendChild(leftCol); grid.appendChild(rightCol);
    wrap.appendChild(grid);
    var bar = actionBar(actions);
    wrap.appendChild(bar);
    wrap.actionBar = bar;
    return wrap;
  }
  function scoreDial(score) {
    var bad = score < PAS.LOW_SCORE_REFER;
    var wrap = h("div", { class: "score-dial" });
    var circle = h("div", { class: "score-dial-circle" + (bad ? " bad" : "") });
    circle.appendChild(h("span", { class: "score-dial-num" + (bad ? " bad" : "") }, String(score)));
    circle.appendChild(h("span", { class: "score-dial-tag" }, "SCORE"));
    wrap.appendChild(circle);
    var body = h("div", { class: "score-dial-body" });
    body.appendChild(h("div", { class: "label-11" }, "Risk score · auto-refer below " + PAS.LOW_SCORE_REFER));
    body.appendChild(h("div", { class: "score-dial-body-sub" }, "Composite from the rating engine. Re-run at every renewal, never carried forward."));
    wrap.appendChild(body);
    return wrap;
  }
  function requestOrigin(meta, labelOverrides) {
    var key = meta && meta.initiatedBy;
    var init = PAS.INITIATORS[key] || PAS.INITIATORS.Insured;
    var label = (labelOverrides && labelOverrides[key]) || init.label;
    var wrap = h("div", { class: "request-origin", "data-tone": init.tone });
    var head = h("div", { class: "request-origin-head" });
    head.appendChild(PAS.icon(init.icon, { size: 14, color: "var(--tone-fg)" }));
    head.appendChild(h("span", { class: "request-origin-who" }, "Requested by " + label));
    head.appendChild(h("span", { class: "request-origin-channel" }, "via " + ((meta && meta.channel) || "—")));
    head.appendChild(h("span", { style: { flex: "1" } }));
    head.appendChild(h("span", { class: "request-origin-date" }, (meta && meta.submittedOn) || "—"));
    wrap.appendChild(head);
    if (meta && meta.requestNote) wrap.appendChild(h("div", { class: "request-origin-note" }, "“" + meta.requestNote + "”"));
    return wrap;
  }

  /* Small inline form used by every "Log a request" action.
     opts: {policies, typeLabel, extraFields(extra)->Node|null, onSubmit(payload)} */
  function logRequestForm(opts) {
    var container = h("div", {});
    function renderClosed() {
      container.innerHTML = "";
      var btn = h("button", { class: "log-request-toggle" }, [PAS.icon("phone-call", { size: 13 }), document.createTextNode(" Log a " + opts.typeLabel + " request received by phone or email")]);
      btn.addEventListener("click", renderOpen);
      container.appendChild(btn);
    }
    function renderOpen() {
      container.innerHTML = "";
      var extra = {};
      var form = h("div", { class: "log-request-form" });
      form.appendChild(tipLabel({ text: "Log a " + opts.typeLabel + " request", what: "For requests that arrived outside self-service — a call, an email, a broker fax.", why: "It still lands in the Pending queue below; ops logging it never skips the decision step.", className: "label-11 block mb-10" }));

      var grid1 = h("div", { class: "log-request-grid" });
      var policySelect = h("select", { class: "field-input" });
      policySelect.appendChild(h("option", { value: "" }, "Select…"));
      opts.policies.forEach(function (p) { policySelect.appendChild(h("option", { value: p.id }, p.id + " — " + p.holder)); });
      grid1.appendChild(field({ label: "Policy" }, policySelect));

      var initiatedSelect = h("select", { class: "field-input" });
      (opts.initiatorKeys || Object.keys(PAS.INITIATORS)).forEach(function (k) { initiatedSelect.appendChild(h("option", { value: k }, k)); });
      initiatedSelect.value = "Insured";
      grid1.appendChild(field({ label: "Initiated by", hint: "Who is actually asking for this." }, initiatedSelect));
      form.appendChild(grid1);

      var grid2 = h("div", { class: "log-request-grid" });
      var channelSelect = h("select", { class: "field-input" });
      function fillChannels(who) {
        channelSelect.innerHTML = "";
        PAS.INITIATORS[who].channels.forEach(function (c) { channelSelect.appendChild(h("option", { value: c }, c)); });
      }
      fillChannels("Insured");
      initiatedSelect.addEventListener("change", function () { fillChannels(initiatedSelect.value); });
      grid2.appendChild(field({ label: "Channel" }, channelSelect));
      var categorySelect = h("select", { class: "field-input" });
      (PAS.ISSUE_CATEGORIES || ["Other"]).forEach(function (c) { categorySelect.appendChild(h("option", { value: c }, c)); });
      extra.category = categorySelect.value;
      categorySelect.addEventListener("change", function () { extra.category = categorySelect.value; });
      grid2.appendChild(field({ label: "Category", hint: "Routes this request without needing a separate button per issue type." }, categorySelect));
      if (opts.extraFields) {
        var extraNode = opts.extraFields(extra);
        if (extraNode) appendKids(grid2, extraNode);
      }
      form.appendChild(grid2);

      var noteArea = h("textarea", { class: "field-input", placeholder: "e.g. Customer called, wants to cancel — sold the car last week." });
      form.appendChild(field({ label: "Note", hint: "What they actually said — quoted on the decision screen." }, noteArea));

      var actionsRow = h("div", { class: "log-request-actions" });
      var submitBtn = h("button", { class: "btn tone-primary" }, [PAS.icon("send", { size: 12 }), document.createTextNode(" Submit request")]);
      function updateDisabled() {
        var ok = policySelect.value && noteArea.value.trim();
        submitBtn.disabled = !ok;
        submitBtn.style.opacity = ok ? "1" : "0.5";
        submitBtn.style.cursor = ok ? "pointer" : "not-allowed";
      }
      policySelect.addEventListener("input", updateDisabled);
      noteArea.addEventListener("input", updateDisabled);
      updateDisabled();
      submitBtn.addEventListener("click", function () {
        if (!policySelect.value || !noteArea.value.trim()) return;
        opts.onSubmit({ policyId: policySelect.value, initiatedBy: initiatedSelect.value, channel: channelSelect.value, note: noteArea.value, extra: extra });
        renderClosed();
      });
      var cancelBtn = h("button", { class: "btn" }, "Cancel");
      cancelBtn.addEventListener("click", renderClosed);
      actionsRow.appendChild(submitBtn); actionsRow.appendChild(cancelBtn);
      form.appendChild(actionsRow);
      container.appendChild(form);
    }
    renderClosed();
    return container;
  }

  /* ================= notifications (bell panel + toasts) ================= */
  function renderToast(note) {
    var container = document.getElementById("toast-container");
    if (!container) return;
    var t = h("div", { class: "toast", "data-tone": note.tone || "gray" });
    var headRow = h("div", { class: "toast-head" });
    var iconBox = h("div", { class: "toast-icon" });
    iconBox.appendChild(PAS.icon(note.kind === "event" ? "zap" : note.dir === "out" ? "arrow-up-right" : "arrow-down-left", { size: 11 }));
    headRow.appendChild(iconBox);
    headRow.appendChild(h("span", { class: "toast-title" + (note.kind === "event" ? " mono" : "") }, note.title));
    t.appendChild(headRow);
    t.appendChild(h("div", { class: "toast-detail" }, note.detail));
    container.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4600);
  }
  function notifRow(note) {
    var row = h("div", { class: "notif-row" });
    var iconBox = h("div", { class: "notif-row-icon", "data-tone": note.tone || "gray" });
    iconBox.appendChild(PAS.icon(note.kind === "event" ? "zap" : note.dir === "out" ? "arrow-up-right" : "arrow-down-left", { size: 11 }));
    row.appendChild(iconBox);
    var mid = h("div", { style: { minWidth: "0", flex: "1" } });
    mid.appendChild(h("div", { class: "notif-row-title" + (note.kind === "event" ? " mono" : "") }, note.title));
    mid.appendChild(h("div", { class: "notif-row-detail" }, note.detail));
    row.appendChild(mid);
    row.appendChild(h("span", { class: "notif-row-time" }, new Date(note.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })));
    return row;
  }

  /* ================= API & event lifecycle panel ================= */
  function lifecycleStage(opts) {
    var wrap = h("div", { class: "lifecycle-stage" });
    var rail = h("div", { class: "lifecycle-stage-rail" });
    var dot = h("div", { class: "lifecycle-stage-dot", "data-tone": opts.tone });
    dot.appendChild(PAS.icon(opts.icon, { size: 13 }));
    rail.appendChild(dot);
    if (!opts.last) rail.appendChild(h("div", { class: "lifecycle-stage-line" }));
    wrap.appendChild(rail);
    var body = h("div", { class: "lifecycle-stage-body" + (opts.last ? " last" : "") });
    var headRow = h("div", { class: "lifecycle-stage-headrow" });
    headRow.appendChild(h("span", { class: "lifecycle-stage-n" }, opts.n));
    headRow.appendChild(h("span", { class: "lifecycle-stage-title" + (opts.mono ? " mono" : "") }, opts.title));
    body.appendChild(headRow);
    if (opts.sub) body.appendChild(h("div", { class: "lifecycle-stage-sub" + (opts.subMono ? " mono" : "") }, opts.sub));
    if (opts.children) { var cw = h("div", { class: "lifecycle-stage-children" }); appendKids(cw, opts.children); body.appendChild(cw); }
    wrap.appendChild(body);
    return wrap;
  }
  function apiLifecycle(pageKey) {
    var container = h("div", { class: "api-lifecycle" });
    var open = true, showJson = false;
    function render() {
      container.innerHTML = "";
      var flows = PAS.api.getFlows(), log = PAS.api.getLog(), events = PAS.api.getEvents();
      var latest = flows[0];
      var pageApis = PAS.PAGE_APIS[pageKey] || [];

      var head = h("div", { class: "api-lifecycle-head" + (!open ? " collapsed" : "") });
      var iconBox = h("div", { class: "api-lifecycle-icon" }); iconBox.appendChild(PAS.icon("activity", { size: 15 }));
      head.appendChild(iconBox);
      var mid = h("div", { style: { flex: "1" } });
      mid.appendChild(h("div", { class: "api-lifecycle-title" }, "API & event lifecycle"));
      mid.appendChild(h("div", { class: "api-lifecycle-sub" }, "What this screen does behind the glass — request, response, domain event, consumers"));
      head.appendChild(mid);
      head.appendChild(pill("gray", log.length + " calls"));
      head.appendChild(pill("violet", events.length + " events"));
      head.appendChild(PAS.icon(open ? "chevron-up" : "chevron-down", { size: 16, color: "var(--color-muted)" }));
      head.addEventListener("click", function () { open = !open; render(); });
      container.appendChild(head);

      if (!open) return;
      var grid = h("div", { class: "api-lifecycle-grid" });
      var leftPanel = h("div", { class: "card", style: { padding: "16px" } });
      var lpHead = h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" } });
      lpHead.appendChild(tipLabel({ text: "Most recent action, end to end", what: "The complete round trip produced by the last thing you did.", why: "One click in the UI becomes an API call, a database transaction, a domain event and a set of downstream consumers. This is that chain.", className: "" }));
      if (latest) {
        var toggleBtn = h("button", { class: "btn small" }, (showJson ? "Hide" : "Show") + " payloads");
        toggleBtn.addEventListener("click", function () { showJson = !showJson; render(); });
        lpHead.appendChild(toggleBtn);
      }
      leftPanel.appendChild(lpHead);

      if (!latest) {
        leftPanel.appendChild(h("div", { class: "api-lifecycle-empty" }, "Nothing yet. Approve a submission, issue a bound policy or cancel one — then come back here and the full chain will be laid out step by step."));
      } else {
        leftPanel.appendChild(lifecycleStage({ n: "01", icon: "arrow-up-right", tone: "indigo", title: "User action", sub: latest.action }));
        leftPanel.appendChild(lifecycleStage({ n: "02", icon: "arrow-up-right", tone: "blue", title: "Request leaves the browser", sub: latest.call.method + " " + latest.call.endpoint, subMono: true, children: showJson && latest.call.requestBody ? codeBlock(latest.call.requestBody, true) : null }));
        leftPanel.appendChild(lifecycleStage({ n: "03", icon: "shield-check", tone: "violet", title: "Domain rules run", sub: "Application layer validates the transition, the domain enforces its invariants, and the change is written with an outbox row in one transaction." }));
        leftPanel.appendChild(lifecycleStage({ n: "04", icon: "arrow-down-left", tone: latest.call.statusCode >= 400 ? "red" : "green", title: "Response · " + latest.call.statusCode, sub: "Returned in " + latest.call.latency + "ms", children: showJson ? codeBlock(latest.call.responseBody, true) : null }));
        if (latest.event) {
          var consumerPills = h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap" } });
          latest.event.consumers.forEach(function (c) { consumerPills.appendChild(pill("blue", c)); });
          var kidsArr = [consumerPills];
          if (showJson) kidsArr.push(h("div", { style: { marginTop: "8px" } }, codeBlock({ eventId: latest.event.eventId, eventType: latest.event.eventType, eventVersion: 1, occurredAt: latest.event.occurredAt, tenantId: latest.event.tenantId, aggregateId: latest.event.aggregateId, producer: latest.event.producer }, true)));
          leftPanel.appendChild(lifecycleStage({ n: "05", icon: "zap", tone: "violet", title: latest.event.eventType, mono: true, sub: "Published from the outbox to Service Bus with a versioned envelope.", last: !showJson, children: kidsArr }));
        } else {
          leftPanel.appendChild(lifecycleStage({ n: "05", icon: "radio", tone: "gray", title: "No domain event", sub: "Read-only operations do not publish. Only state changes reach the bus.", last: true }));
        }
      }
      grid.appendChild(leftPanel);

      var rightCol = h("div", { style: { display: "flex", flexDirection: "column", gap: "14px", minWidth: "0" } });
      var endpointsPanel = panel({ title: "Endpoints on this screen", what: "Every operation this page can call.", why: "Nothing here is decorative — each one fires from a control on the screen." }, []);
      var epBody = endpointsPanel.querySelector(".panel-body");
      pageApis.forEach(function (row) {
        var epRow = h("div", { class: "endpoint-row" });
        var top = h("div", { class: "endpoint-row-top" });
        top.appendChild(methodBadge(row[0]));
        top.appendChild(h("span", { class: "endpoint-path" }, row[1]));
        epRow.appendChild(top);
        epRow.appendChild(h("div", { class: "endpoint-desc" }, row[2]));
        epBody.appendChild(epRow);
      });
      if (pageApis.length === 0) epBody.appendChild(h("div", { class: "faint-note" }, "Reference screen — no live calls."));
      rightCol.appendChild(endpointsPanel);

      var logPanel = panel({ title: "Call log", what: "Every request made this session, newest first.", pad: 0 }, []);
      var logBody = logPanel.querySelector(".panel-body");
      var logScroll = h("div", { class: "call-log-scroll" });
      if (log.length === 0) logScroll.appendChild(h("div", { style: { padding: "0 15px 14px" }, class: "faint-note" }, "No calls yet."));
      log.forEach(function (l) {
        var row = h("div", { class: "call-log-row" });
        row.appendChild(methodBadge(l.method));
        row.appendChild(h("span", { class: "call-log-endpoint" }, l.endpoint));
        row.appendChild(statusCodeBadge(l.statusCode));
        row.appendChild(h("span", { class: "call-log-latency" }, l.latency + "ms"));
        logScroll.appendChild(row);
      });
      logBody.appendChild(logScroll);
      rightCol.appendChild(logPanel);
      grid.appendChild(rightCol);
      container.appendChild(grid);
    }
    render();
    return { el: container, refresh: render };
  }
  /* Wraps a page's content: content, then the lifecycle section beneath it. */
  function screen(pageKey, contentNode) {
    var wrap = h("div", {});
    appendKids(wrap, contentNode);
    wrap.appendChild(apiLifecycle(pageKey).el);
    return wrap;
  }

  /* Reusable Monthly/Quarterly/Yearly/All-history/Custom reporting-period control — the same
     widget the Dashboard built first, factored out so the Policy register, Brokers, MGA, Carriers
     and Customers pages can drop in an identical toggle without re-deriving the date math (that
     math itself lives once, in PAS.periodBounds/periodMatches/periodLabelOf — this only owns the
     DOM and the period/offset/custom-range state machine on top of it).
     opts.onChange fires after every state change (chip click, prev/next, custom date edit) so the
     caller can re-filter its list and recompute its KPIs; the returned handle's bounds()/matches()/
     noteText() are what a caller reads to do that filtering. opts.defaultPeriod (default "month")
     sets which chip is active on first render — directory-style pages (Policy register, Brokers,
     MGA, Carriers, Customers) pass "all" so they still open showing the whole book, matching what
     those pages already promise ("every record") rather than narrowing to the current month
     before the viewer has touched anything. */
  function periodToggle(opts) {
    opts = opts || {};
    var period = opts.defaultPeriod || "month", periodOffset = 0;
    var customFrom = PAS.addDays(PAS.todayISO(), -30), customTo = PAS.todayISO();

    var wrap = h("div", {});
    var toggleRow = h("div", { class: "period-toggle-row" });
    toggleRow.appendChild(h("span", { class: "period-toggle-label" }, "Reporting period"));
    var toggleAndNav = h("div", { style: { display: "flex", alignItems: "center", gap: "10px" }, role: "group", "aria-label": "Reporting period" });
    var toggle = h("div", { class: "period-toggle", role: "group", "aria-label": "Period type" });
    toggleAndNav.appendChild(toggle);
    var navWrap = h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    var prevBtn = h("button", { class: "btn ghost-link", type: "button", title: "Previous period", "aria-label": "Previous reporting period" }, "◀");
    var navLabel = h("span", { style: { fontSize: "12.5px", fontWeight: "700", color: "var(--color-ink)", minWidth: "108px", textAlign: "center" } });
    var nextBtn = h("button", { class: "btn ghost-link", type: "button", title: "Next period", "aria-label": "Next reporting period" }, "▶");
    navWrap.appendChild(prevBtn); navWrap.appendChild(navLabel); navWrap.appendChild(nextBtn);
    toggleAndNav.appendChild(navWrap);
    toggleRow.appendChild(toggleAndNav);
    wrap.appendChild(toggleRow);

    var customBtn = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, "Custom dates");
    customBtn.addEventListener("click", function () { period = period === "custom" ? "month" : "custom"; periodOffset = 0; update(); });

    var rangeRow = h("div", { class: "period-toggle-row" });
    rangeRow.appendChild(h("span", { class: "period-toggle-label" }, "Date range"));
    var rangeWrap = h("div", { class: "date-range-controls" });
    var fromInput = h("input", { type: "date", class: "field-input select-fixed", value: customFrom, "aria-label": "Reporting period start date" });
    var toInput = h("input", { type: "date", class: "field-input select-fixed", value: customTo, "aria-label": "Reporting period end date" });
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(h("span", { style: { color: "var(--color-muted)", fontSize: "12px" } }, "to"));
    rangeWrap.appendChild(toInput);
    rangeRow.appendChild(rangeWrap);
    wrap.appendChild(rangeRow);
    fromInput.addEventListener("change", function () { if (fromInput.value) customFrom = fromInput.value; update(); });
    toInput.addEventListener("change", function () { if (toInput.value) customTo = toInput.value; update(); });

    prevBtn.addEventListener("click", function () { periodOffset -= 1; update(); });
    nextBtn.addEventListener("click", function () { if (periodOffset < 0) { periodOffset += 1; update(); } });

    function renderChips() {
      toggle.innerHTML = "";
      [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"], ["all", "All history"]].forEach(function (opt) {
        var btn = h("button", { class: "chip" + (period === opt[0] ? " active" : ""), type: "button", "aria-pressed": String(period === opt[0]) }, opt[1]);
        btn.addEventListener("click", function () { if (period !== opt[0]) { period = opt[0]; periodOffset = 0; update(); } });
        toggle.appendChild(btn);
      });
      toggle.appendChild(customBtn);
      customBtn.className = "chip" + (period === "custom" ? " active" : "");
      customBtn.setAttribute("aria-pressed", String(period === "custom"));
      navWrap.style.display = (period === "custom" || period === "all") ? "none" : "flex";
      rangeRow.style.display = period === "custom" ? "" : "none";
      if (period !== "custom" && period !== "all") {
        navLabel.textContent = PAS.periodLabelOf(period, periodOffset);
        nextBtn.disabled = periodOffset >= 0;
      }
    }
    function update() { renderChips(); if (opts.onChange) opts.onChange(); }
    renderChips();

    return {
      el: wrap,
      get period() { return period; },
      get periodOffset() { return periodOffset; },
      bounds: function () { return PAS.periodBounds(period, periodOffset, customFrom, customTo); },
      matches: function (dateStr) { return PAS.periodMatches(dateStr, period, periodOffset, customFrom, customTo); },
      noteText: function () {
        if (period === "all") return "across the whole book";
        if (period === "custom") return "from " + customFrom + " to " + customTo;
        return "in " + PAS.periodLabelOf(period, periodOffset);
      },
    };
  }

  PAS.ui = {
    h: h, append: appendKids, tooltip: tooltip, tipLabel: tipLabel, infoDot: infoDot,
    pill: pill, statusBadge: statusBadge, badge: badge, txnStatusBadge: txnStatusBadge, outcomeBadge: outcomeBadge, modulePill: modulePill, initiatorPill: initiatorPill, tabs: tabs, emptyState: emptyState, diffPanel: diffPanel, stepper: stepper, drawer: drawer,
    cellOpen: cellOpen, cellId: cellId, cellName: cellName, methodBadge: methodBadge, statusCodeBadge: statusCodeBadge,
    codeBlock: codeBlock, dataTable: dataTable, sortableTable: sortableTable, deskList: deskList, kpiRow: kpiRow, kpiSection: kpiSection, actionBar: actionBar,
    backLink: backLink, kv: kv, panel: panel, accordion: accordion, accordionSection: accordionSection, pageHeader: pageHeader, field: field, checkboxRow: checkboxRow, multiSelect: multiSelect,
    callout: callout, hbar: hbar, donut: donut, stackBar: stackBar, workCard: workCard, recordHead: recordHead,
    decisionLayout: decisionLayout, confirmDecision: confirmDecision, confirmable: confirmable, decisionTrail: decisionTrail, decisionTrailSide: decisionTrailSide, flashThenGo: flashThenGo, scoreDial: scoreDial, requestOrigin: requestOrigin, logRequestForm: logRequestForm,
    renderToast: renderToast, notifRow: notifRow, lifecycleStage: lifecycleStage,
    apiLifecycle: apiLifecycle, screen: screen, TONE_HEX: TONE_HEX, periodToggle: periodToggle,
  };
})(window);
