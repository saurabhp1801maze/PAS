/* Wires up the shared shell (reset button, notification bell + panel, toast container).
   The sidebar/topbar markup itself is now static HTML baked into every page (see
   gen_static_shell in project history) so it paints instantly on navigation instead of
   waiting for JS to build it — this file only attaches behavior to what's already there. */
(function (global) {
  "use strict";
  var PAS = global.PAS;
  var ui = PAS.ui;

  function ensureToastContainer() {
    var el = document.getElementById("toast-container");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast-container";
      el.className = "toast-container";
      document.body.appendChild(el);
    }
    return el;
  }

  function wireReset() {
    var btn = document.getElementById("reset-demo-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (window.confirm("Reset all demo data back to the original seed? This clears every decision made this session.")) {
        PAS.resetDemoData();
      }
    });
  }

  /* Global search — inserted into the topbar at runtime rather than baked into all 24 static
     files, the same call the role pill's enhancement made, just with a new element instead of an
     existing one to enhance. Searches policy ID, holder name and producer across the whole book,
     live as you type, from any page. */
  function wireSearch() {
    var topbar = document.getElementById("topbar");
    var bellBtn = document.getElementById("bell-btn");
    if (!topbar || !bellBtn || document.getElementById("search-btn")) return;

    var wrap = ui.h("div", { class: "search-wrap" });
    var btn = ui.h("button", { class: "search-btn", id: "search-btn", type: "button" });
    btn.appendChild(PAS.icon("search", { size: 14, color: "var(--text-soft)" }));
    wrap.appendChild(btn);
    topbar.insertBefore(wrap, bellBtn);

    var input = null, panelEl = null;
    function close() {
      if (panelEl) { panelEl.remove(); panelEl = null; }
      if (input) { input.remove(); input = null; }
      wrap.classList.remove("open");
    }
    function matches(p, q) {
      q = q.toLowerCase();
      return p.id.toLowerCase().indexOf(q) !== -1 || p.holder.toLowerCase().indexOf(q) !== -1 || (p.producer || "").toLowerCase().indexOf(q) !== -1;
    }
    function runSearch(q) {
      if (panelEl) panelEl.remove();
      panelEl = ui.h("div", { class: "notif-panel search-panel" });
      if (!q.trim()) {
        panelEl.appendChild(ui.h("div", { class: "notif-empty" }, "Search by policy ID, insured name, or broker/producer — across every page."));
      } else {
        var hits = PAS.getPolicies().filter(function (p) { return matches(p, q); }).slice(0, 8);
        if (hits.length === 0) {
          panelEl.appendChild(ui.h("div", { class: "notif-empty" }, 'No policy matches "' + q + '".'));
        } else {
          hits.forEach(function (p) {
            var row = ui.h("button", { class: "search-row", type: "button" });
            row.appendChild(ui.cellId(p.id));
            var body = ui.h("div", { class: "search-row-body" });
            body.appendChild(ui.h("div", { class: "search-row-name" }, p.holder));
            body.appendChild(ui.h("div", { class: "search-row-meta" }, p.product + " · " + p.producer));
            row.appendChild(body);
            row.appendChild(ui.badge(p.status));
            row.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(p.id); });
            panelEl.appendChild(row);
          });
        }
      }
      wrap.appendChild(panelEl);
    }
    function open() {
      if (input) return;
      wrap.classList.add("open");
      input = ui.h("input", { class: "search-input", type: "text", placeholder: "Search policies, insureds, brokers…" });
      wrap.insertBefore(input, wrap.firstChild);
      input.addEventListener("input", function () { runSearch(input.value); });
      input.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      input.focus();
      runSearch("");
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (input) close(); else open(); });
    document.addEventListener("click", function (e) { if (input && !wrap.contains(e.target)) close(); });
  }

  function wireBell() {
    var bellBtn = document.getElementById("bell-btn");
    var badgeEl = document.getElementById("bell-badge");
    var topbar = document.getElementById("topbar");
    if (!bellBtn || !topbar) return;

    function updateBadge() {
      if (!badgeEl) return;
      var n = PAS.api.getNotes().length;
      if (n > 0) { badgeEl.textContent = n > 99 ? "99+" : String(n); badgeEl.style.display = "flex"; }
      else { badgeEl.style.display = "none"; }
    }
    updateBadge();

    var panelEl = null;
    function closePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }
    function openPanel() {
      closePanel();
      panelEl = ui.h("div", { class: "notif-panel" });
      var head = ui.h("div", { class: "notif-head" });
      head.appendChild(ui.h("span", { class: "notif-head-title" }, "Activity"));
      var clearBtn = ui.h("button", { class: "notif-clear" }, "Clear");
      clearBtn.addEventListener("click", function (e) { e.stopPropagation(); PAS.api.clearNotes(); updateBadge(); openPanel(); });
      head.appendChild(clearBtn);
      var closeIcon = ui.h("span", { class: "notif-close" });
      closeIcon.appendChild(PAS.icon("x", { size: 14 }));
      closeIcon.addEventListener("click", function (e) { e.stopPropagation(); closePanel(); });
      head.appendChild(closeIcon);
      panelEl.appendChild(head);
      var notes = PAS.api.getNotes();
      if (notes.length === 0) panelEl.appendChild(ui.h("div", { class: "notif-empty" }, "Nothing yet. Take a decision on any desk and you'll see the request, the response and the domain event stream through here live."));
      notes.forEach(function (n) { panelEl.appendChild(ui.notifRow(n)); });
      topbar.appendChild(panelEl);
    }
    bellBtn.addEventListener("click", function (e) { e.stopPropagation(); if (panelEl) closePanel(); else openPanel(); });
    document.addEventListener("click", function (e) { if (panelEl && !panelEl.contains(e.target) && !bellBtn.contains(e.target)) closePanel(); });

    PAS.api.onNotify = function (note) {
      ui.renderToast(note);
      updateBadge();
      if (panelEl) openPanel();
    };
  }

  /* The role pill in the topbar is baked static HTML ("Rahul Verma · Underwriter") like the rest
     of the shell — this turns it into a live switcher. Switching role reloads the page rather
     than live-patching the DOM: nav visibility and every page's own render() already read
     PAS.getRole() fresh on load, so a reload is what keeps this in sync with zero special-cased
     re-render logic per page. */
  function wireRole() {
    var topbar = document.getElementById("topbar");
    if (!topbar) return;
    var pill = topbar.querySelector('.pill[data-tone="indigo"]');
    if (!pill) return;
    pill.classList.add("role-pill");
    pill.setAttribute("tabindex", "0");

    function currentSpec() { return PAS.ROLES[PAS.getRole()]; }
    function renderPill() {
      var spec = currentSpec();
      pill.setAttribute("data-tone", spec.tone);
      pill.innerHTML = "";
      pill.appendChild(PAS.icon(spec.icon, { size: 11 }));
      pill.appendChild(document.createTextNode(" " + spec.identity + " · " + spec.label));
    }
    renderPill();

    var panelEl = null;
    function closePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }
    function openPanel() {
      closePanel();
      panelEl = ui.h("div", { class: "notif-panel role-panel" });
      var head = ui.h("div", { class: "notif-head" });
      head.appendChild(ui.h("span", { class: "notif-head-title" }, "View platform as"));
      var closeIcon = ui.h("span", { class: "notif-close" });
      closeIcon.appendChild(PAS.icon("x", { size: 14 }));
      closeIcon.addEventListener("click", function (e) { e.stopPropagation(); closePanel(); });
      head.appendChild(closeIcon);
      panelEl.appendChild(head);
      var current = PAS.getRole();
      Object.keys(PAS.ROLES).forEach(function (key) {
        var spec = PAS.ROLES[key];
        var row = ui.h("button", { class: "role-row" + (key === current ? " active" : ""), type: "button" });
        var iconBox = ui.h("span", { class: "role-row-icon", "data-tone": spec.tone });
        iconBox.appendChild(PAS.icon(spec.icon, { size: 13 }));
        row.appendChild(iconBox);
        var body = ui.h("div", { class: "role-row-body" });
        body.appendChild(ui.h("div", { class: "role-row-name" }, spec.identity + " · " + spec.label));
        body.appendChild(ui.h("div", { class: "role-row-desc" }, spec.desc));
        row.appendChild(body);
        if (key === current) row.appendChild(PAS.icon("check-circle-2", { size: 14, color: "var(--" + spec.tone + ")" }));
        row.addEventListener("click", function (e) {
          e.stopPropagation();
          if (key === current) { closePanel(); return; }
          PAS.setRole(key);
          location.reload();
        });
        panelEl.appendChild(row);
      });
      topbar.appendChild(panelEl);
    }
    pill.addEventListener("click", function (e) { e.stopPropagation(); if (panelEl) closePanel(); else openPanel(); });
    pill.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pill.click(); } });
    document.addEventListener("click", function (e) { if (panelEl && !panelEl.contains(e.target) && !pill.contains(e.target)) closePanel(); });
  }

  /* Decision desks a read-only role can't reach are removed from the sidebar entirely, not just
     disabled — MGA and Carrier never decide anything, and a Broker/Producer never sees into the
     internal Underwriting/Issue queues. PAS.NAV supplies the href for every nav key, so this
     never has to hardcode a URL. */
  function wireNavForRole() {
    var hidden = PAS.NAV_HIDDEN_FOR_ROLE[PAS.getRole()];
    if (!hidden || !hidden.length) return;
    var hrefSet = {};
    PAS.NAV.forEach(function (group) {
      group.items.forEach(function (it) { if (hidden.indexOf(it[0]) !== -1) hrefSet[it[3]] = true; });
    });
    document.querySelectorAll(".nav-item").forEach(function (a) {
      if (hrefSet[a.getAttribute("href")]) a.style.display = "none";
    });
    document.querySelectorAll(".nav-group").forEach(function (g) {
      var anyVisible = Array.prototype.some.call(g.querySelectorAll(".nav-item"), function (a) { return a.style.display !== "none"; });
      if (!anyVisible) g.style.display = "none";
    });
  }

  function syncNavFromConfig() {
    var sidebar = document.getElementById("sidebar");
    var footer = sidebar && sidebar.querySelector(".sidebar-footer");
    if (!sidebar || !footer || !PAS.NAV) return;
    sidebar.querySelectorAll(".nav-group").forEach(function (g) { g.remove(); });
    var pageKey = document.body.getAttribute("data-page");
    var hidden = PAS.NAV_HIDDEN_FOR_ROLE[PAS.getRole()] || [];
    PAS.NAV.forEach(function (group) {
      var g = ui.h("div", { class: "nav-group" });
      g.appendChild(ui.h("div", { class: "nav-group-label" }, group.label));
      var any = false;
      group.items.forEach(function (it) {
        if (hidden.indexOf(it[0]) !== -1) return;
        any = true;
        var active = PAS.PAGE_META[pageKey] && PAS.PAGE_META[pageKey].nav === it[0];
        var a = ui.h("a", { class: "nav-item" + (active ? " active" : ""), href: it[3] });
        a.appendChild(PAS.icon(it[2], { size: 13 }));
        a.appendChild(document.createTextNode(" " + it[1]));
        g.appendChild(a);
      });
      if (any) sidebar.insertBefore(g, footer);
    });
  }

  function init() {
    ensureToastContainer();
    syncNavFromConfig();
    var flash = PAS.takeFlash && PAS.takeFlash();
    if (flash) ui.renderToast(flash);
    wireReset();
    wireSearch();
    wireBell();
    wireRole();
    wireNavForRole();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  PAS.layout = { init: init };
})(window);
