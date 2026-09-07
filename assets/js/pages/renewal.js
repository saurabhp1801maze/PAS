/* Ported from RenewalList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getScopedPolicies();
    var pend = PAS.pendingOf(policies, "Renewal");
    var noRequest = policies.filter(function (p) { return p.status === "Active" && !pend.some(function (t) { return t.p.id === p.id; }); })
      .sort(function (a, b) { return PAS.daysBetween(PAS.todayISO(), a.expirationDate) - PAS.daysBetween(PAS.todayISO(), b.expirationDate); });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "refresh-cw", tone: "blue", title: "Renewal Desk", sub: "Renewal is decided against a confirmed request, never started from the desk",
      what: "Policies where the insured or broker has already confirmed intent to renew.",
      why: "Renewal is a new term on the same policy — underwriting is re-run, but the trigger is always an external confirmation, not ops.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Renewal confirmations received, not yet decided." },
      { label: "In notice window", value: pend.filter(function (t) { return PAS.renewalCompliance(t.p).status !== "Compliant"; }).length, tone: "red", tip: "Expiring within " + PAS.RENEWAL_LEAD_DAYS + " days." },
      { label: "Premium at renewal", value: PAS.moneyShort(pend.reduce(function (s, t) { return s + t.p.premium; }, 0)), tip: "Premium exposed to these decisions." },
      { label: "No confirmation yet", value: noRequest.length, tip: "Approaching expiry but the insured hasn't confirmed renewal.", why: "These need a renewal notice chased, not a desk action." },
    ]));

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "renewal confirmation",
      extraFields: function () { return null; },
      onSubmit: function (payload) {
        PAS.raiseRequest(payload.policyId, "Renewal", { initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note, category: payload.extra.category });
        render();
      },
    }));

    var q = "", productF = "All", fromDate = "", toDate = "";
    var products = ["All"].concat(Array.from(new Set(pend.map(function (t) { return t.p.product; }).filter(Boolean))).sort());
    function matchAll(t) {
      var needle = q.toLowerCase();
      return (!needle || t.p.holder.toLowerCase().indexOf(needle) !== -1 || t.p.id.toLowerCase().indexOf(needle) !== -1)
        && (productF === "All" || t.p.product === productF)
        && (!fromDate || t.p.expirationDate >= fromDate) && (!toDate || t.p.expirationDate <= toDate);
    }

    var toolbar = ui.h("div", { class: "register-toolbar" });
    var searchWrap = ui.h("div", { class: "register-search" });
    searchWrap.appendChild(PAS.icon("search", { size: 14 }));
    var searchInput = ui.h("input", { class: "register-search-input", type: "search", placeholder: "Search by insured name or policy number…", autocomplete: "off" });
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);
    var filters = ui.h("div", { class: "register-filters" });
    var productSelect = ui.h("select", { class: "register-select", title: "Line of business" });
    products.forEach(function (p) { productSelect.appendChild(ui.h("option", { value: p }, p === "All" ? "All LOBs" : p)); });
    filters.appendChild(productSelect);
    var fromInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Expires from" });
    filters.appendChild(fromInput);
    var toInput = ui.h("input", { class: "field-input select-fixed", type: "date", title: "Expires to" });
    filters.appendChild(toInput);
    toolbar.appendChild(filters);
    page.appendChild(toolbar);

    var reqHead = ui.h("div", { class: "period-toggle-row" });
    reqHead.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Confirmed renewal intent, ready for re-underwriting and pricing.", className: "label-11" }));
    var renewalTable = ui.sortableTable({
      storageKey: "pas.renewal.columns.v1",
      pageSize: 10,
      columns: [
        { key: "policy", label: "Policy", locked: true, sortValue: function (t) { return t.p.id; }, cell: function (t) { return ui.cellId(t.p.id); } },
        { key: "insured", label: "Insured", locked: true, sortValue: function (t) { return (t.p.holder || "").toLowerCase(); }, cell: function (t) { return ui.cellName(t.p.holder); } },
        { key: "requestedBy", label: "Requested by", sortValue: function (t) { return (t.h.meta && t.h.meta.initiatedBy) || ""; }, cell: function (t) { return ui.initiatorPill(t.h.meta); } },
        { key: "expires", label: "Expires", what: "End of the current term.", sortValue: function (t) { return t.p.expirationDate; }, cell: function (t) { return PAS.fmtDate(t.p.expirationDate); } },
        { key: "daysLeft", label: "Days left", what: "Time before expiry.", sortValue: function (t) { return PAS.daysBetween(PAS.todayISO(), t.p.expirationDate); }, cell: function (t) { return PAS.daysBetween(PAS.todayISO(), t.p.expirationDate) + "d"; } },
        { key: "premium", label: "Premium", what: "Expiring term premium.", sortValue: function (t) { return t.p.premium || 0; }, cell: function (t) { return PAS.moneyShort(t.p.premium); } },
      ],
      trailingColumn: { cell: function () { return ui.cellOpen("Review"); } },
      rows: function () { return pend.filter(matchAll); },
      onRowClick: function (t) { location.href = "renewal-decision.html?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id); },
      emptyText: "No renewal confirmations match that search.",
    });
    reqHead.appendChild(renewalTable.columnsControl);
    page.appendChild(reqHead);

    var noteEl = ui.h("div", { class: "faint-note mb-9" });
    page.appendChild(noteEl);
    page.appendChild(renewalTable.tableWrap);

    function refresh() {
      var filtered = pend.filter(matchAll);
      noteEl.textContent = (q || productF !== "All" || fromDate || toDate) ? "Showing " + filtered.length + " of " + pend.length + " requests." : "";
      renewalTable.rebuild();
    }
    function onFilterChange() { renewalTable.resetPage(); refresh(); }
    searchInput.addEventListener("input", function () { q = searchInput.value; onFilterChange(); });
    productSelect.addEventListener("change", function () { productF = productSelect.value; onFilterChange(); });
    fromInput.addEventListener("change", function () { fromDate = fromInput.value; onFilterChange(); });
    toInput.addEventListener("change", function () { toDate = toInput.value; onFilterChange(); });

    if (noRequest.length > 0) {
      var extra = ui.h("div", { class: "mt-18" });
      extra.appendChild(ui.tipLabel({
        text: "Approaching expiry, no confirmation yet",
        what: "Reference only — nothing to decide until the insured responds to the renewal notice.",
        why: "Sending the notice here logs a real, inspectable ledger entry to the customer, the underwriter, and the renewal lead — so the relevant teams can proactively reach out, not just watch the clock run down.",
        className: "label-11 block mb-9",
      }));
      var noticeBody = ui.h("div", {});
      extra.appendChild(noticeBody);
      page.appendChild(extra);

      var noticePageSize = 10, noticePageIndex = 0;
      function buildNoticeTable() {
        var total = noRequest.length;
        var totalPages = Math.max(1, Math.ceil(total / noticePageSize));
        if (noticePageIndex >= totalPages) noticePageIndex = totalPages - 1;
        if (noticePageIndex < 0) noticePageIndex = 0;
        var start = noticePageIndex * noticePageSize;
        var pageRows = noRequest.slice(start, start + noticePageSize);
        noticeBody.innerHTML = "";
        noticeBody.appendChild(ui.dataTable({
          columns: ["Policy", "Insured", "Expires", "Days left", { label: "Notice status", what: "Whether the renewal notice window has been met.", rule: "Notices must go out at least " + PAS.RENEWAL_LEAD_DAYS + " days before expiry." }, { label: "Renewal notice", what: "Sends to the customer, the underwriter on file, and the renewal lead — logged on the policy's own ledger, not a toast that vanishes." }],
          rows: pageRows.map(function (x) {
            var r = PAS.renewalCompliance(x);
            var sent = PAS.lastRenewalNotice(x);
            var noticeCell;
            if (sent) {
              noticeCell = ui.h("span", { class: "faint-note" }, "Sent " + sent.date + " to " + sent.meta.recipients.customer + ", " + sent.meta.recipients.underwriter + " & lead");
            } else {
              var btn = ui.h("button", { class: "btn small" }, "Send notice");
              btn.addEventListener("click", function () { PAS.sendRenewalNotice(x.id); render(); });
              noticeCell = btn;
            }
            return [ui.cellId(x.id), ui.cellName(x.holder), PAS.fmtDate(x.expirationDate), r.daysToExpiry + "d", ui.pill(r.status === "Compliant" ? "green" : r.status === "Urgent" ? "amber" : "red", r.status), noticeCell];
          }),
        }));
        var pager = ui.h("div", { class: "table-pager" });
        var from = total === 0 ? 0 : start + 1;
        var to = Math.min(total, start + noticePageSize);
        pager.appendChild(ui.h("span", { class: "table-pager-meta" }, total === 0 ? "No rows" : ("Showing " + from + "–" + to + " of " + total)));
        var nav = ui.h("div", { class: "table-pager-nav" });
        var prev = ui.h("button", { class: "btn small", type: "button", disabled: noticePageIndex <= 0 }, "← Prev");
        prev.addEventListener("click", function () { if (noticePageIndex > 0) { noticePageIndex--; buildNoticeTable(); } });
        var next = ui.h("button", { class: "btn small", type: "button", disabled: noticePageIndex >= totalPages - 1 }, "Next →");
        next.addEventListener("click", function () { if (noticePageIndex < totalPages - 1) { noticePageIndex++; buildNoticeTable(); } });
        nav.appendChild(prev);
        nav.appendChild(ui.h("span", { class: "table-pager-page" }, "Page " + (noticePageIndex + 1) + " of " + totalPages));
        nav.appendChild(next);
        pager.appendChild(nav);
        noticeBody.appendChild(pager);
      }
      buildNoticeTable();
    }

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("renewal-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
