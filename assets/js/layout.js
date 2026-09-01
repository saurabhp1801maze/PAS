/* Wires up the shared shell (reset button, notification bell + panel, toast container).
   The sidebar/topbar markup itself is now static HTML baked into every page (see
   gen_static_shell in project history) so it paints instantly on navigation instead of
   waiting for JS to build it — this file only attaches behavior to what's already there. */
(function (global) {
  "use strict";
  var PAS = global.PAS;
  var ui = PAS.ui;

  /* §12 dirty-state warning: a native confirm() before leaving a page with unsaved input.
     Every page here is a real HTML document (no client-side router), so a plain `beforeunload`
     listener already fires for all four vectors the framework lists — nav-item click, browser
     back, tab close, browser close — a `<a href>` click is a real navigation, not a route change.
     ".field-input" is this app's existing convention for genuine data-entry fields (request forms,
     decision-desk comments, admin config) as opposed to search boxes/filters (".register-search-
     input", ".register-select"), so scoping to it avoids nagging on read-only filter changes.
     Cleared centrally from store.js's PAS.decide*() commit points on a successful/declined
     decision, so the redirect right after a submit doesn't itself trip the warning. */
  var dirty = false;
  PAS.setDirty = function (v) { dirty = !!v; };
  PAS.isDirty = function () { return dirty; };
  PAS.clearDirty = function () { dirty = false; };

  function wireDirtyStateWarning() {
    /* Listens on document, not #page-content: the decision-confirmation modal (ui.js
       confirmDecision) appends its overlay straight to document.body as a floating layer, so a
       page-content-scoped listener never sees input typed into its required comment field. */
    function onFieldEvent(e) {
      if (e.target && e.target.classList && e.target.classList.contains("field-input")) PAS.setDirty(true);
    }
    document.addEventListener("input", onFieldEvent);
    document.addEventListener("change", onFieldEvent);
    window.addEventListener("beforeunload", function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
  }

  function ensureToastContainer() {
    var el = document.getElementById("toast-container");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast-container";
      el.className = "toast-container";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
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
    var btn = ui.h("button", { class: "search-btn", id: "search-btn", type: "button", "aria-label": "Search" });
    btn.appendChild(PAS.icon("search", { size: 14, color: "var(--color-ink-secondary)" }));
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
        var allPolicies = PAS.getPolicies();
        var hits = allPolicies.filter(function (p) { return matches(p, q); });
        if (hits.length === 0) {
          panelEl.appendChild(ui.h("div", { class: "notif-empty" }, 'No match for "' + q + '".'));
        } else {
          /* Customers first: search should land a real named insured on their own profile
             (every policy they hold), not force a guess at which one policy row to click —
             this is the actual gap the MOM 2026-08-26 feedback named ("also support searching
             for customers"), since a name match used to only ever surface individual policies. */
          var needle = q.toLowerCase();
          var customerNames = Array.from(new Set(allPolicies.filter(function (p) { return p.holder.toLowerCase().indexOf(needle) !== -1; }).map(function (p) { return p.holder; })));
          if (customerNames.length > 0) {
            panelEl.appendChild(ui.h("div", { class: "search-section-label" }, "Customers"));
            customerNames.slice(0, 4).forEach(function (name) {
              var policyCount = allPolicies.filter(function (p) { return p.holder === name; }).length;
              var row = ui.h("button", { class: "search-row", type: "button" });
              row.appendChild(PAS.icon("user", { size: 13, color: "var(--color-ink-secondary)" }));
              var body = ui.h("div", { class: "search-row-body" });
              body.appendChild(ui.h("div", { class: "search-row-name" }, name));
              body.appendChild(ui.h("div", { class: "search-row-meta" }, policyCount + " polic" + (policyCount === 1 ? "y" : "ies") + " on file"));
              row.appendChild(body);
              row.addEventListener("click", function () { location.href = "customers.html?customer=" + encodeURIComponent(name); });
              panelEl.appendChild(row);
            });
          }

          var policyHits = hits.slice(0, 5);
          if (policyHits.length > 0) {
            panelEl.appendChild(ui.h("div", { class: "search-section-label" }, "Policies"));
            policyHits.forEach(function (p) {
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
      }
      wrap.appendChild(panelEl);
    }
    function open() {
      if (input) return;
      wrap.classList.add("open");
      input = ui.h("input", { class: "search-input", type: "text", placeholder: "Search policies, insureds, brokers…", "aria-label": "Search policies, insureds, brokers" });
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
      var closeIcon = ui.h("button", { class: "notif-close", type: "button", "aria-label": "Close" });
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
      pill.appendChild(document.createTextNode(" " + PAS.getActingIdentity() + " · " + spec.label));
    }
    renderPill();

    var panelEl = null;
    function closePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }
    function openPanel() {
      closePanel();
      panelEl = ui.h("div", { class: "notif-panel role-panel" });
      var head = ui.h("div", { class: "notif-head" });
      head.appendChild(ui.h("span", { class: "notif-head-title" }, "View platform as"));
      var closeIcon = ui.h("button", { class: "notif-close", type: "button", "aria-label": "Close" });
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
          PAS.setActingIdentity(null);
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

  /* Nav visibility is a per-role allow-list (`spec.visibleNav`, editable in Admin Configuration)
     rather than a hardcoded deny-list — a page's nav item is shown only if the current role's
     permission grid explicitly includes its key. PAS.NAV supplies the href for every nav key, so
     this never has to hardcode a URL. */
  function wireNavForRole() {
    var spec = PAS.ROLES[PAS.getRole()];
    var visible = (spec && spec.visibleNav) || [];
    var hrefSet = {};
    if (visible !== "*") {
      PAS.NAV.forEach(function (group) {
        group.items.forEach(function (it) { if (visible.indexOf(it[0]) === -1) hrefSet[it[3]] = true; });
      });
    }
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
    var spec = PAS.ROLES[PAS.getRole()];
    var visible = (spec && spec.visibleNav) || [];
    PAS.NAV.forEach(function (group) {
      var g = ui.h("div", { class: "nav-group" });
      g.appendChild(ui.h("div", { class: "nav-group-label" }, group.label));
      var any = false;
      group.items.forEach(function (it) {
        if (visible !== "*" && visible.indexOf(it[0]) === -1) return;
        any = true;
        var active = PAS.PAGE_META[pageKey] && PAS.PAGE_META[pageKey].nav === it[0];
        var a = ui.h("a", { class: "nav-item" + (active ? " active" : ""), href: it[3], title: it[1] });
        a.appendChild(PAS.icon(it[2], { size: 13 }));
        a.appendChild(ui.h("span", { class: "nav-item-label" }, " " + it[1]));
        g.appendChild(a);
      });
      if (any) sidebar.insertBefore(g, footer);
    });
  }

  /* §5: left nav collapses to 64px icon-only via a toggle at the bottom; §10.18: Comfortable/
     Compact density toggle in the topbar. Both persist per-user in localStorage and apply purely
     by flipping a class/attribute — no reload, no layout rebuild. */
  var NAV_COLLAPSE_KEY = "pas.navCollapsed.v1", DENSITY_KEY = "pas.density.v1";

  function wireNavCollapse() {
    var sidebar = document.getElementById("sidebar");
    var btn = document.getElementById("nav-collapse-btn");
    if (!sidebar || !btn) return;
    var collapsed;
    try { collapsed = localStorage.getItem(NAV_COLLAPSE_KEY) === "1"; } catch (e) { collapsed = false; }
    function apply() {
      sidebar.classList.toggle("collapsed", collapsed);
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
    }
    apply();
    btn.addEventListener("click", function () {
      collapsed = !collapsed;
      try { localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) { /* storage unavailable */ }
      apply();
    });
  }

  /* Narrow screens use the same navigation as an off-canvas drawer. Keeping this behavior in
     the shared shell preserves one navigation source while preventing the fixed 240px sidebar
     from consuming most of a phone viewport. */
  function wireMobileNav() {
    var sidebar = document.getElementById("sidebar");
    var topbar = document.getElementById("topbar");
    if (!sidebar || !topbar || document.getElementById("mobile-nav-btn")) return;
    var btn = ui.h("button", { class: "mobile-nav-btn", id: "mobile-nav-btn", type: "button", "aria-label": "Open navigation", "aria-controls": "sidebar", "aria-expanded": "false" }, "☰");
    topbar.insertBefore(btn, topbar.firstChild);
    var scrim = ui.h("div", { class: "nav-scrim", "aria-hidden": "true" });
    document.body.appendChild(scrim);
    var open = false;
    var media = window.matchMedia ? window.matchMedia("(max-width: 760px)") : null;
    function isMobile() { return !!(media && media.matches); }
    function apply(returnFocus) {
      var mobile = isMobile();
      if (!mobile) open = false;
      sidebar.classList.toggle("mobile-open", mobile && open);
      scrim.classList.toggle("show", mobile && open);
      btn.setAttribute("aria-expanded", String(mobile && open));
      btn.setAttribute("aria-label", mobile && open ? "Close navigation" : "Open navigation");
      if (mobile && !open) {
        sidebar.setAttribute("aria-hidden", "true");
        sidebar.inert = true;
      } else {
        sidebar.removeAttribute("aria-hidden");
        sidebar.inert = false;
      }
      if (returnFocus && btn.focus) btn.focus();
    }
    btn.addEventListener("click", function () {
      open = !open;
      apply(false);
      if (open) {
        var target = sidebar.querySelector(".nav-item.active") || sidebar.querySelector(".nav-item");
        if (target && target.focus) target.focus();
      }
    });
    scrim.addEventListener("click", function () { open = false; apply(true); });
    sidebar.querySelectorAll(".nav-item").forEach(function (a) { a.addEventListener("click", function () { if (isMobile()) { open = false; apply(false); } }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) { open = false; apply(true); } });
    if (media) {
      if (media.addEventListener) media.addEventListener("change", function () { apply(false); });
      else if (media.addListener) media.addListener(function () { apply(false); });
    }
    apply(false);
  }

  function wireDensityToggle() {
    var topbar = document.getElementById("topbar");
    var bellBtn = document.getElementById("bell-btn");
    if (!topbar || !bellBtn || document.getElementById("density-btn")) return;
    var density;
    try { density = localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable"; } catch (e) { density = "comfortable"; }
    var btn = ui.h("button", { class: "density-btn", id: "density-btn", type: "button" });
    function apply() {
      document.body.setAttribute("data-density", density);
      btn.setAttribute("aria-label", density === "compact" ? "Switch to comfortable density" : "Switch to compact density");
      btn.setAttribute("aria-pressed", String(density === "compact"));
      btn.title = density === "compact" ? "Compact density — click for Comfortable" : "Comfortable density — click for Compact";
      btn.innerHTML = "";
      btn.appendChild(PAS.icon(density === "compact" ? "layers" : "list-checks", { size: 14 }));
    }
    apply();
    btn.addEventListener("click", function () {
      density = density === "compact" ? "comfortable" : "compact";
      try { localStorage.setItem(DENSITY_KEY, density); } catch (e) { /* storage unavailable */ }
      apply();
    });
    topbar.insertBefore(btn, bellBtn);
  }

  /* §10.11 breadcrumb separator. PAS.PAGE_META titles are authored as "Module / Page" — the
     static HTML bakes that literal text so the topbar paints before JS runs (same reasoning as
     the static nav markup), so this only needs to *upgrade* the separator glyph at runtime rather
     than build the whole breadcrumb from scratch. */
  function syncBreadcrumb() {
    var el = document.querySelector(".topbar-title");
    var pageKey = document.body.getAttribute("data-page");
    var meta = pageKey && PAS.PAGE_META[pageKey];
    if (!el || !meta) return;
    el.textContent = meta.title.split(" / ").join(" › ");
  }

  function init() {
    ensureToastContainer();
    syncNavFromConfig();
    syncBreadcrumb();
    var flash = PAS.takeFlash && PAS.takeFlash();
    if (flash) ui.renderToast(flash);
    wireReset();
    wireNavCollapse();
    wireMobileNav();
    wireDensityToggle();
    wireDirtyStateWarning();
    wireSearch();
    wireBell();
    wireRole();
    wireNavForRole();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  PAS.layout = { init: init };
})(window);
