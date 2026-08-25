/* Ported from CancellationList in the original App.jsx. Cancellation is modeled as four
   independent attributes — Type (the refund basis), Reason (why), Initiated By (who) and Timing
   (when) — rather than one reason string with type baked in. Type is still derived, never
   hand-picked (see store.js's deriveCancelType). */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var pend = PAS.pendingOf(policies, "Cancellation");
    var hist = policies.reduce(function (acc, x) {
      x.history.filter(function (h) { return h.type === "Cancellation" && h.status !== "Pending"; }).forEach(function (h) { acc.push({ x: x, h: h }); });
      return acc;
    }, []);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "x-circle", tone: "red", title: "Cancellation Desk", sub: "Requests already received — type, refund and notice are all derived from what was submitted",
      what: "Every cancellation begins as a request from the insured, a broker, or the carrier's own review — never something ops invents on the spot.",
      why: "Getting the type wrong means refunding money you were entitled to keep, or breaching a statutory notice rule.",
    }));

    /* Auto-cancelled: the System raised AND completed the cancellation itself, for Non-Payment.
       The real trigger — never modeled as a UI action — is Billing telling the policy system
       that premium is still unpaid once the grace period has run out; the System reacts to that
       notification by cancelling on its own, with nobody in ops clicking anything. */
    var autoCancelled = hist.filter(function (t) { return t.h.status === "Completed" && t.h.meta && t.h.meta.reason === "Non-Payment" && t.h.meta.initiatedBy === "System"; });

    page.appendChild(ui.kpiRow([
      { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
      { label: "From insured/broker", value: pend.filter(function (t) { return !PAS.CANCEL_INSURER_SIDE[t.h.meta.initiatedBy]; }).length, tone: "blue", tip: "Initiated by the Insured or a Broker." },
      { label: "From insurer side", value: pend.filter(function (t) { return PAS.CANCEL_INSURER_SIDE[t.h.meta.initiatedBy]; }).length, tone: "violet", tip: "Initiated by the Carrier, an MGA, or the System — e.g. non-payment, adverse loss ratio.", why: "These still require a decision, never an instant execution." },
      { label: "Auto-cancelled (non-payment)", value: autoCancelled.length, tone: "red", tip: "Cancelled automatically by the System for Non-Payment — no held request, no human click.", why: "The trigger is a notification from Billing that premium is still unpaid once the grace period has run out. The System reacts to that notification on its own and cancels the policy directly; this is the one cancellation path that skips the request-then-decide queue entirely." },
    ]));

    /* Type — the refund basis, three cards. Reason, Initiated By and Timing are shown separately
       below rather than folded into the type card, since none of them determine Type on their
       own — see the derivation panel underneath. */
    var typeGrid = ui.h("div", { class: "cancel-type-grid" });
    Object.keys(PAS.CANCEL_TYPES).forEach(function (name) {
      var t = PAS.CANCEL_TYPES[name];
      var card = ui.h("div", { class: "cancel-type-card" });
      card.appendChild(ui.pill(t.tone, name));
      card.appendChild(ui.h("div", { class: "cancel-type-desc" }, t.when));
      card.appendChild(ui.h("div", { class: "cancel-type-meta" }, (t.penaltyPct ? (t.penaltyPct * 100 + "% penalty") : "no penalty") + " · " + t.basis + " basis"));
      typeGrid.appendChild(ui.tooltip({ what: t.when, why: t.rate, rule: t.rule, width: 300 }, card));
    });
    page.appendChild(typeGrid);

    /* Reason — six values, each carrying the notice period that must run and the Type it
       recommends before an insurer-side Initiated By can downgrade it. Shown as its own reference
       table so the notice-period rule (which used to live invisibly inside Type) is visible. */
    var reasonPanel = ui.panel({
      title: "Reason, notice & default type",
      what: "Every reason a cancellation can be raised for.",
      why: "Notice period is a property of Reason now, not Type — a non-payment cancellation needs 15 days regardless of which of the three types it ends up deriving to.",
      pad: 0,
    }, []);
    reasonPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Reason",
        { label: "Notice required", what: "Days that must run before the effective date." },
        { label: "Default type", what: "What Type this reason recommends, before the Initiated By check applies.", rule: "An insurer-side Initiated By (Carrier, MGA, System) downgrades a Short-Rate default to Pro-Rata — it can never upgrade a no-penalty reason into one." }],
      rows: Object.keys(PAS.CANCEL_REASONS).map(function (r) {
        var spec = PAS.CANCEL_REASONS[r];
        return [r, spec.noticeDays + " days", ui.pill(PAS.CANCEL_TYPES[spec.defaultType].tone, spec.defaultType)];
      }),
      wrapCells: true,
    }));
    page.appendChild(reasonPanel);

    /* Refund-wise breakdown: every completed cancellation already carries its decided type,
       reason and refund on `meta` — this is that history grouped two ways rather than a new
       computation. Pending requests are excluded deliberately: their refund is a live quote, not
       yet a fact, and mixing a projection into a completed total would misstate what's actually
       been paid out. */
    var completed = hist.filter(function (t) { return t.h.status === "Completed"; });
    var totalRefunded = completed.reduce(function (s, t) { return s + (Number(t.h.meta && t.h.meta.refund) || 0); }, 0);
    function groupRefunds(field) {
      var keys = Array.from(new Set(completed.map(function (t) { return (t.h.meta && t.h.meta[field]) || "—"; })));
      return keys.map(function (k) {
        var rows = completed.filter(function (t) { return ((t.h.meta && t.h.meta[field]) || "—") === k; });
        return { k: k, v: rows.reduce(function (s, t) { return s + (Number(t.h.meta && t.h.meta.refund) || 0); }, 0), n: rows.length };
      }).sort(function (a, b) { return b.v - a.v; });
    }
    var refundGrid = ui.h("div", { class: "two-col-grid" });
    var byTypePanel = ui.panel({ title: "Refunds by type", what: "Total refunded, grouped by the decided cancellation type.", why: "Total refunded to date: " + PAS.money(totalRefunded) + " across " + completed.length + " completed cancellations." }, []);
    var byTypeBody = byTypePanel.querySelector(".panel-body");
    var byType = groupRefunds("cancelType");
    if (byType.length === 0) byTypeBody.appendChild(ui.h("div", { class: "faint-note" }, "No completed cancellations yet."));
    else {
      var maxType = Math.max.apply(null, byType.map(function (r) { return r.v; }).concat([1]));
      byType.forEach(function (r) { byTypeBody.appendChild(ui.hbar({ label: r.k, value: r.v, max: maxType, note: PAS.money(r.v) + " · " + r.n, tone: (PAS.CANCEL_TYPES[r.k] && PAS.CANCEL_TYPES[r.k].tone) || "gray" })); });
    }
    refundGrid.appendChild(byTypePanel);

    var byReasonPanel = ui.panel({ title: "Refunds by reason", what: "Total refunded, grouped by the stated reason.", why: "Where the money is actually going out — not just why a policy was cancelled." }, []);
    var byReasonBody = byReasonPanel.querySelector(".panel-body");
    var byReason = groupRefunds("reason");
    if (byReason.length === 0) byReasonBody.appendChild(ui.h("div", { class: "faint-note" }, "No completed cancellations yet."));
    else {
      var maxReason = Math.max.apply(null, byReason.map(function (r) { return r.v; }).concat([1]));
      byReason.forEach(function (r) { byReasonBody.appendChild(ui.hbar({ label: r.k, value: r.v, max: maxReason, note: PAS.money(r.v) + " · " + r.n, tone: r.v === maxReason ? "indigo" : "blue" })); });
    }
    refundGrid.appendChild(byReasonPanel);
    page.appendChild(refundGrid);

    page.appendChild(ui.logRequestForm({
      policies: policies.filter(function (p) { return p.status === "Active"; }),
      typeLabel: "cancellation",
      initiatorKeys: PAS.CANCEL_INITIATOR_KEYS,
      extraFields: function (extra) {
        var reasons = Object.keys(PAS.CANCEL_REASONS);
        extra.reason = reasons[0];
        var sel = ui.h("select", { class: "field-input" });
        reasons.forEach(function (r) { sel.appendChild(ui.h("option", { value: r }, r)); });
        sel.addEventListener("change", function () { extra.reason = sel.value; });
        return ui.field({ label: "Reason" }, sel);
      },
      onSubmit: function (payload) {
        PAS.raiseRequest(payload.policyId, "Cancellation", { reason: payload.extra.reason || Object.keys(PAS.CANCEL_REASONS)[0], initiatedBy: payload.initiatedBy, channel: payload.channel, requestNote: payload.note });
        render();
      },
    }));

    page.appendChild(ui.tipLabel({ text: "Requests awaiting decision (" + pend.length + ")", what: "Already-submitted requests, ordered newest first.", className: "label-11 block mb-9" }));
    page.appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Requested by",
        { label: "Reason", what: "What the requester gave as their reason.", why: "Drives the default type and the notice period." },
        { label: "Type", what: "The derived refund basis — Reason plus Initiated By, never hand-picked." },
        { label: "Timing", what: "Immediate if the effective date is today or past, Future/Scheduled otherwise." },
        { label: "Submitted", what: "When the request arrived." }, ""],
      rows: pend.map(function (t) {
        var meta = t.h.meta || {};
        var atInception = t.h.date <= t.p.effectiveDate;
        var type = PAS.deriveCancelType(meta.reason, meta.initiatedBy, atInception);
        return [ui.cellId(t.p.id), ui.cellName(t.p.holder), ui.initiatorPill(meta), meta.reason || "—",
          ui.pill(PAS.CANCEL_TYPES[type].tone, type), PAS.cancelTiming(t.h.date),
          meta.submittedOn || t.h.date, ui.cellOpen("Review")];
      }),
      emptyText: "No cancellation requests awaiting decision.",
      wrapCells: true,
      onRowClick: function (i) { location.href = "cancellation-decision.html?policy=" + encodeURIComponent(pend[i].p.id) + "&txn=" + encodeURIComponent(pend[i].h.id); },
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("cancellation-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
