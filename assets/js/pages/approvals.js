/* Ported from ApprovalsPage in the original App.jsx.
   Phase 1: triage toolbar (search / type / SLA) + urgency sort; SLA uses demo clock. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function slaOf(t) {
    return PAS.getTxnSla ? PAS.getTxnSla(t.h) : { remainingHours: 0, breached: false };
  }

  /* "Requested by" only ever showed the initiator's ROLE (Broker/Producer, MGA, ...), never which
     actual broker or MGA — a policy can have dozens of each, so the role alone doesn't say who.
     Stack the specific name underneath the role pill instead of adding separate columns: Broker
     and MGA initiators get the policy's own producer/mga field, Underwriter gets whoever made the
     last completed underwriting decision on this policy; Insured and System carry no further name
     to show (the Insured column already names the insured; System has no person behind it). */
  function requestedByCell(t) {
    var meta = t.h.meta || {};
    var role = meta.initiatedBy;
    var name = role === "Broker/Producer" ? t.p.producer
      : role === "MGA" ? t.p.mga
      : role === "Carrier" ? t.p.carrier
      : role === "Underwriter" ? PAS.underwriterOf(t.p)
      : null;
    var wrap = ui.h("div", {});
    wrap.appendChild(ui.initiatorPill(meta));
    if (name) wrap.appendChild(ui.h("div", { class: "faint-note", style: { marginTop: "3px" } }, name));
    return wrap;
  }

  function sortByUrgency(list) {
    return list.slice().sort(function (a, b) {
      var sa = slaOf(a), sb = slaOf(b);
      if (sa.breached !== sb.breached) return sa.breached ? -1 : 1;
      if (sa.remainingHours !== sb.remainingHours) return sa.remainingHours - sb.remainingHours;
      var da = a.h.recordedAt || a.h.date || "";
      var db = b.h.recordedAt || b.h.date || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return (a.h.seq || 0) - (b.h.seq || 0);
    });
  }

  function render() {
    var policies = PAS.getScopedPolicies();
    /* Underwriting referrals are excluded — they're decided from the Underwriting desk itself,
       not this general cross-desk queue, so listing them here again has no use. */
    var pending = PAS.allTxns(policies).filter(function (t) { return t.h.status === "Pending" && t.h.type !== "Underwriting"; });
    var types = ["All"].concat(Array.from(new Set(pending.map(function (t) { return t.h.type; }))).filter(function (ty) { return ty !== "Transfer"; }).sort());
    var q = "", typeF = "All", slaF = "All";

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "inbox", tone: "amber", title: "Pending Approvals", sub: "Every request received, not yet decided — across every desk",
      what: "A cross-type index of every held transaction, wherever it came from — except Underwriting referrals, decided from their own desk.",
      why: "Held means untouched — the policy stays exactly as it was until an underwriter reviews the request's full context and decides.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pending.length, tone: "amber", tip: "Held transactions across every desk, excluding Underwriting referrals." },
      { label: "Reinstatements", value: pending.filter(function (t) { return t.h.type === "Reinstatement"; }).length, tone: "green", tip: "Lapsed/cancelled policies requesting cover back." },
      { label: "Endorsements", value: pending.filter(function (t) { return t.h.type === "Endorsement"; }).length, tip: "Material changes needing sign-off." },
      { label: "Cancellations", value: pending.filter(function (t) { return t.h.type === "Cancellation"; }).length, tip: "Insured, broker or underwriter initiated." },
    ]));

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
    var typeSelect = ui.h("select", { class: "register-select", title: "Type" });
    types.forEach(function (ty) {
      typeSelect.appendChild(ui.h("option", { value: ty }, ty === "All" ? "All types" : ty));
    });
    filters.appendChild(typeSelect);

    var slaSelect = ui.h("select", { class: "register-select", title: "SLA = Service Level Agreement — the turnaround commitment this request is held against." });
    [["All", "All SLA"], ["at-risk", "At risk (≤24h)"], ["breached", "Breached"]].forEach(function (opt) {
      slaSelect.appendChild(ui.h("option", { value: opt[0] }, opt[1]));
    });
    filters.appendChild(slaSelect);
    toolbar.appendChild(filters);
    page.appendChild(toolbar);

    var tableContainer = ui.h("div", {});
    page.appendChild(tableContainer);

    function match(t) {
      var sla = slaOf(t);
      var ql = q.toLowerCase();
      var textOk = !ql
        || (t.p.holder || "").toLowerCase().indexOf(ql) !== -1
        || (t.p.id || "").toLowerCase().indexOf(ql) !== -1;
      var typeOk = typeF === "All" || t.h.type === typeF;
      var slaOk = slaF === "All"
        || (slaF === "breached" && sla.breached)
        || (slaF === "at-risk" && !sla.breached && sla.remainingHours <= 24);
      return textOk && typeOk && slaOk;
    }

    function openReview(t) {
      var desk = PAS.TYPE_TO_DESK[t.h.type];
      if (!desk) {
        location.href = "advanced-admin-decision.html?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id);
        return;
      }
      location.href = PAS.DETAIL_URL_OF[desk] + "?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id);
    }

    var pageSize = 10, pageIndex = 0;
    function buildTable() {
      var rows = sortByUrgency(pending.filter(match));
      tableContainer.innerHTML = "";
      if (q || typeF !== "All" || slaF !== "All") {
        tableContainer.appendChild(ui.h("div", { class: "faint-note mb-9" }, "Showing " + rows.length + " of " + pending.length + " pending."));
      }
      var total = rows.length;
      var totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (pageIndex >= totalPages) pageIndex = totalPages - 1;
      if (pageIndex < 0) pageIndex = 0;
      var start = pageIndex * pageSize;
      var pageRows = rows.slice(start, start + pageSize);
      tableContainer.appendChild(ui.dataTable({
        columns: [{ label: "Seq", what: "Position in the policy ledger." }, "Policy", "Insured", { label: "Type", what: "Which kind of transaction is held." }, "Requested by", { label: "SLA", what: "SLA = Service Level Agreement: the turnaround this request is committed to. Hours until it breaches that commitment (demo clock, not the real calendar)." }, { label: "Why it is held", what: "What was submitted, and by whom.", rule: "Material endorsements, fraud cancellations and authority referrals always hold." }, { label: "Effective", what: "Business date it would take effect." }, ""],
        rows: pageRows.map(function (t) {
          var seqSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--color-muted)" } }, "#" + t.h.seq);
          var idSpan = ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--color-ink-secondary)" } }, t.p.id);
          var detailSpan = ui.h("span", { style: { fontSize: "12px", color: "var(--color-ink-secondary)", whiteSpace: "normal", display: "inline-block", maxWidth: "300px" } }, t.h.detail);
          var sla = slaOf(t);
          var reviewBtn = ui.h("button", { class: "btn small tone-primary" }, "Review →");
          reviewBtn.addEventListener("click", function () { openReview(t); });
          return [seqSpan, idSpan, t.p.holder, ui.modulePill(t.h.type), requestedByCell(t), ui.pill(sla.breached ? "red" : "amber", sla.remainingHours + "h"), detailSpan, PAS.fmtDate(t.h.date), reviewBtn];
        }),
        emptyText: "Nothing awaiting approval.",
      }));
      if (total > 0) {
        var pager = ui.h("div", { class: "table-pager" });
        var from = start + 1, to = Math.min(total, start + pageSize);
        pager.appendChild(ui.h("span", { class: "table-pager-meta" }, "Showing " + from + "–" + to + " of " + total));
        var nav = ui.h("div", { class: "table-pager-nav" });
        var prev = ui.h("button", { class: "btn small", type: "button", disabled: pageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (pageIndex > 0) { pageIndex--; buildTable(); } });
        var next = ui.h("button", { class: "btn small", type: "button", disabled: pageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (pageIndex < totalPages - 1) { pageIndex++; buildTable(); } });
        nav.appendChild(prev);
        nav.appendChild(ui.h("span", { class: "table-pager-page" }, "Page " + (pageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        tableContainer.appendChild(pager);
      }
    }

    searchInput.addEventListener("input", function () { q = searchInput.value; pageIndex = 0; buildTable(); });
    typeSelect.addEventListener("change", function () { typeF = typeSelect.value; pageIndex = 0; buildTable(); });
    slaSelect.addEventListener("change", function () { slaF = slaSelect.value; pageIndex = 0; buildTable(); });
    buildTable();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("approvals", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
