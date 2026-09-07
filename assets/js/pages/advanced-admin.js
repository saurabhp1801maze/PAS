/* Advanced PAS admin desk — Rewrite, Reissue, Rescind, Audit, Lapse, Split, Merge */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;
  var TYPES = Object.keys(PAS.ADVANCED_TXN_TYPES || {});

  function render() {
    var policies = PAS.getPolicies();
    var pending = PAS.pendingOf(policies).filter(function (t) { return TYPES.indexOf(t.h.type) !== -1; });
    var typeF = { v: "All" };

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "layers", tone: "violet", title: "Advanced PAS Admin",
      sub: "Industry-standard policy administration transactions beyond core endorsements",
      what: "Rewrite, reissue, rescind, premium audit, lapse, split and merge.",
      why: "These are PAS-native admin actions — they change the policy record, not rate or underwrite it.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pending.length, tone: "amber" },
      { label: "Transaction types", value: TYPES.length, tone: "violet", tip: "Full Guidewire/Duck Creek PAS taxonomy coverage." },
      { label: "Rescind window", value: PAS.RESCIND_WINDOW_DAYS + " days", tip: "Undo window for recent transactions." },
      { label: "Policies on book", value: policies.length },
    ]));

    var typeChips = ui.h("div", { class: "chip-row mb-13" });
    ["All"].concat(TYPES).forEach(function (t) {
      var chip = ui.h("button", { class: "chip" + (typeF.v === t ? " active" : "") }, t);
      chip.addEventListener("click", function () { typeF.v = t; pendingPageIndex = 0; buildPending(); renderChips(); });
      typeChips.appendChild(chip);
    });
    function renderChips() {
      typeChips.querySelectorAll(".chip").forEach(function (chip) {
        chip.classList.toggle("active", chip.textContent === typeF.v);
      });
    }
    page.appendChild(typeChips);

    var formPanel = ui.panel({ title: "Log advanced PAS transaction", what: "Select type and policy — held until admin approves." }, []);
    var body = formPanel.querySelector(".panel-body");
    var extra = { txnType: TYPES[0], requestNote: "", premiumDelta: "", newHolder: "", mergePolicyId: "", targetTxnSeq: "" };

    var typeSel = ui.h("select", { class: "field-input" });
    TYPES.forEach(function (t) { typeSel.appendChild(ui.h("option", { value: t }, PAS.ADVANCED_TXN_TYPES[t].label)); });
    typeSel.addEventListener("change", function () { extra.txnType = typeSel.value; });
    body.appendChild(ui.field({ label: "Transaction type" }, typeSel));

    var polSel = ui.h("select", { class: "field-input" });
    policies.filter(function (p) { return p.status === "Active" || p.status === "Bound" || p.status === "Cancelled"; }).forEach(function (p) {
      polSel.appendChild(ui.h("option", { value: p.id }, p.id + " · " + p.holder));
    });
    body.appendChild(ui.field({ label: "Policy" }, polSel));

    var noteInput = ui.h("textarea", { class: "field-input", rows: "2", placeholder: "Admin note…" });
    noteInput.addEventListener("input", function () { extra.requestNote = noteInput.value; });
    body.appendChild(ui.field({ label: "Request note" }, noteInput));

    var submitBtn = ui.h("button", { class: "btn tone-primary" }, "Log request");
    submitBtn.addEventListener("click", function () {
      var meta = { requestNote: extra.requestNote, initiatedBy: "Underwriter", channel: "Internal review" };
      if (extra.txnType === "Audit") meta.premiumDelta = Number(extra.premiumDelta) || 0;
      if (extra.txnType === "Split") { meta.newHolder = extra.newHolder; meta.splitPct = 0.5; }
      if (extra.txnType === "Merge") meta.mergePolicyId = extra.mergePolicyId;
      if (extra.txnType === "Rescind") {
        var pol = PAS.getPolicy(polSel.value);
        var tgt = pol.history.find(function (h) { return String(h.seq) === String(extra.targetTxnSeq); });
        if (tgt) { meta.targetTxnId = tgt.id; meta.targetTxnSeq = tgt.seq; }
      }
      PAS.raiseAdvancedTxn(polSel.value, extra.txnType, meta);
      render();
    });
    body.appendChild(submitBtn);
    page.appendChild(formPanel);

    var pendingWrap = ui.h("div", { id: "advanced-pending" });
    page.appendChild(pendingWrap);

    var pendingPageSize = 10, pendingPageIndex = 0;
    function buildPending() {
      var rows = pending.filter(function (t) { return typeF.v === "All" || t.h.type === typeF.v; });
      pendingWrap.innerHTML = "";
      pendingWrap.appendChild(ui.tipLabel({ text: "Awaiting decision (" + rows.length + ")", className: "label-11 block mb-9" }));
      var total = rows.length;
      var totalPages = Math.max(1, Math.ceil(total / pendingPageSize));
      if (pendingPageIndex >= totalPages) pendingPageIndex = totalPages - 1;
      if (pendingPageIndex < 0) pendingPageIndex = 0;
      var start = pendingPageIndex * pendingPageSize;
      var pageRows = rows.slice(start, start + pendingPageSize);
      pendingWrap.appendChild(ui.dataTable({
        columns: ["Policy", "Type", "Effective", { label: "SLA", what: "SLA = Service Level Agreement: the turnaround this request is committed to. Hours remaining before it breaches that commitment (demo clock, not the real calendar)." }, "Detail", ""],
        rows: pageRows.map(function (t) {
          var sla = PAS.getTxnSla(t.h);
          return [ui.cellId(t.p.id), ui.modulePill(t.h.type), PAS.fmtDate(t.h.date),
            ui.pill(sla.breached ? "red" : "green", sla.remainingHours + "h"),
            ui.h("span", { style: { fontSize: "12px", color: "var(--color-ink-secondary)" } }, t.h.title),
            ui.cellOpen("Review")];
        }),
        emptyText: "No advanced transactions pending.",
        onRowClick: function (i) {
          var t = pageRows[i];
          location.href = "advanced-admin-decision.html?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id);
        },
      }));
      if (total > 0) {
        var pager = ui.h("div", { class: "table-pager" });
        var from = start + 1, to = Math.min(total, start + pendingPageSize);
        pager.appendChild(ui.h("span", { class: "table-pager-meta" }, "Showing " + from + "–" + to + " of " + total));
        var nav = ui.h("div", { class: "table-pager-nav" });
        var prev = ui.h("button", { class: "btn small", type: "button", disabled: pendingPageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (pendingPageIndex > 0) { pendingPageIndex--; buildPending(); } });
        var next = ui.h("button", { class: "btn small", type: "button", disabled: pendingPageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (pendingPageIndex < totalPages - 1) { pendingPageIndex++; buildPending(); } });
        nav.appendChild(prev);
        nav.appendChild(ui.h("span", { class: "table-pager-page" }, "Page " + (pendingPageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        pendingWrap.appendChild(pager);
      }
    }
    buildPending();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("advanced-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
