/* Ported from CancellationDecision in the original App.jsx. The effective-date field is live
   (recomputing the derived cancellation type, refund and notice check on every change), so this
   page rebuilds just its decision-layout container rather than the whole page on each edit. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policyId = sp.get("policy");
    var txnId = sp.get("txn");
    var p = PAS.getPolicy(policyId);
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var h = p.history.find(function (x) { return x.id === txnId; })
      || p.history.find(function (x) { return x.type === "Cancellation" && x.status === "Pending"; });
    if (!h) { root.appendChild(ui.h("div", { class: "faint-note" }, "Transaction not found.")); return; }
    txnId = h.id;

    var reason = (h.meta && h.meta.reason) || "Insured Request";
    var initiatedBy = (h.meta && h.meta.initiatedBy) || "Insured";
    var effDate = h.date || PAS.todayISO();

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Cancellation desk", function () { location.href = "cancellation.html"; }));
    var headContainer = ui.h("div", {});
    var layoutContainer = ui.h("div", {});
    page.appendChild(headContainer);
    page.appendChild(layoutContainer);

    function refreshPolicy() {
      p = PAS.getPolicy(policyId) || p;
      h = p.history.find(function (x) { return x.id === txnId; }) || h;
    }

    function buildContent() {
      refreshPolicy();
      var q = PAS.cancelQuote(p, reason, initiatedBy, effDate, h.meta || {});
      var dnoc = PAS.dnocState(h.meta || {});
      var decided = h.status === "Completed" || h.status === "Rejected";
      headContainer.innerHTML = "";
      headContainer.appendChild(ui.recordHead(p, ui.pill(q.spec.tone, q.type)));

      var left = [];
      left.push(ui.requestOrigin(h.meta));
      left.push(ui.tipLabel({ text: "What was requested", what: "Reason and Initiated By came in with the request — neither is chosen here.", why: "Type is derived from both of them plus the effective date, never hand-picked.", className: "label-11 block mb-10" }));
      left.push(ui.kv({ k: "Reason", v: reason, what: "What the requester gave.", rule: "Fraud never auto-completes and permanently blocks any later reinstatement." }));
      left.push(ui.kv({ k: "Initiated by", v: initiatedBy, what: "Who is actually asking for this.", rule: "An insurer-side initiator (Reinsurer, MGA, System) can never end up with a Short-Rate penalty." }));
      left.push(ui.kv({ k: "Timing", v: q.timing, what: "Immediate if the effective date is today or past, Future/Scheduled otherwise." }));

      var dateInput = ui.h("input", { class: "field-input", type: "date", value: effDate, disabled: decided || dnoc.required });
      dateInput.addEventListener("change", function () { effDate = dateInput.value; buildContent(); });
      left.push(ui.field({
        label: "Effective date",
        hint: dnoc.required
          ? "Set by DNOC: notice served date + statutory notice days. Not hand-typed for insurer-side notices."
          : "Pre-filled from the request; adjust only if the underwriter is confirming a different date.",
      }, dateInput));

      var derivedWrap = ui.h("div", { class: "mt-6" });
      derivedWrap.appendChild(ui.tipLabel({ text: q.overridden ? "Type (manually overridden)" : "Derived type", what: "Which of the three cancellation types this maps to — from Reason + Initiated By + whether it lands at inception.", why: q.overridden ? "Would otherwise derive to " + q.derivedType + " — this is a manual exception, logged in the decision trail." : undefined, className: "label-11 block mb-9" }));
      var derivedCard = ui.h("div", { class: "cancel-type-card", "data-tone": q.spec.tone, style: { background: "var(--tone-bg)", borderColor: "var(--tone-fg)" } });
      derivedCard.appendChild(ui.pill(q.spec.tone, q.type));
      if (q.overridden) derivedCard.appendChild(ui.pill("gray", "was " + q.derivedType));
      derivedCard.appendChild(ui.h("div", { style: { fontSize: "12px", color: "var(--color-ink)", marginTop: "8px", lineHeight: "1.5" } }, q.spec.when));
      derivedCard.appendChild(ui.h("div", { style: { fontSize: "11.5px", color: "var(--color-ink-secondary)", marginTop: "6px", lineHeight: "1.5" } }, q.spec.rate));
      derivedWrap.appendChild(derivedCard);

      /* "Where permitted" (MOM 2026-08-26): only a role that can already decide this desk sees the
         override control at all, and even then it only ever offers types isValidCancelType allows
         for this reason/initiator/date — never a combination the domain rule forbids outright. */
      var canOverride = (PAS.ROLES[PAS.getRole()] || {}).canDecide && !decided;
      if (canOverride) {
        var validTypes = Object.keys(PAS.CANCEL_TYPES).filter(function (t) { return PAS.isValidCancelType(t, initiatedBy, q.atInception); });
        if (validTypes.length > 1) {
          var overrideWrap = ui.h("div", { class: "mt-9" });
          var overrideToggle = ui.h("button", { class: "btn ghost-link", type: "button" }, q.overridden ? "Change override…" : "Override type…");
          var overrideForm = ui.h("div", { class: "mt-6", style: { display: "none" } });
          var typeSelect = ui.h("select", { class: "field-input select-fixed" });
          validTypes.forEach(function (t) { typeSelect.appendChild(ui.h("option", { value: t, selected: t === q.type }, t)); });
          var reasonInput = ui.h("input", { class: "field-input", placeholder: "Why override the derived type? (required)" });
          var applyBtn = ui.h("button", { class: "btn small", type: "button" }, "Apply override");
          var clearBtn = ui.h("button", { class: "btn small ghost-link", type: "button" }, "Clear override");
          overrideForm.appendChild(ui.field({ label: "Override to" }, typeSelect));
          overrideForm.appendChild(ui.field({ label: "Reason" }, reasonInput));
          var overrideBtnRow = ui.h("div", { style: { display: "flex", gap: "8px", marginTop: "6px" } });
          overrideBtnRow.appendChild(applyBtn);
          if (q.overridden) overrideBtnRow.appendChild(clearBtn);
          overrideForm.appendChild(overrideBtnRow);
          overrideToggle.addEventListener("click", function () { overrideForm.style.display = overrideForm.style.display === "none" ? "" : "none"; });
          applyBtn.addEventListener("click", function () {
            if (!reasonInput.value.trim()) { reasonInput.focus(); return; }
            var result = PAS.setCancelTypeOverride(p.id, txnId, typeSelect.value, reasonInput.value.trim());
            if (!result.allowed) { ui.renderToast({ title: "Override refused", detail: result.reason, tone: "red" }); return; }
            ui.renderToast({ title: "Type overridden", detail: p.id + " · " + typeSelect.value, tone: "blue" });
            buildContent();
          });
          clearBtn.addEventListener("click", function () {
            PAS.clearCancelTypeOverride(p.id, txnId, "Reverted to the derived type.");
            ui.renderToast({ title: "Override cleared", detail: p.id + " · back to " + q.derivedType, tone: "blue" });
            buildContent();
          });
          overrideWrap.appendChild(overrideToggle);
          overrideWrap.appendChild(overrideForm);
          derivedWrap.appendChild(overrideWrap);
        }
      }
      left.push(derivedWrap);

      /* DNOC panel — Direct Notice of Cancellation for System / Carrier / MGA with notice days */
      if (dnoc.required) {
        var dnocWrap = ui.h("div", { class: "mt-13" });
        dnocWrap.appendChild(ui.tipLabel({ text: "DNOC — Direct Notice of Cancellation", what: "Formal notice the insurer must serve before an insurer-side cancellation can take effect.", why: "Pending days count down from the day DNOC is served. Cancellation completes only when pending days reach zero.", className: "label-11 block mb-9" }));
        if (!dnoc.served) {
          dnocWrap.appendChild(ui.callout("warn", "DNOC not yet served. " + dnoc.noticeRequired + " statutory notice days are required for " + reason + ". Serve the Direct Notice of Cancellation to start the countdown."));
        } else if (!dnoc.ready) {
          dnocWrap.appendChild(ui.callout("warn", "DNOC served on " + PAS.fmtDate(dnoc.dnocServedOn) + ". " + dnoc.pendingDays + " pending day" + (dnoc.pendingDays === 1 ? "" : "s") + " remaining before cancellation can complete (effective " + PAS.fmtDate(dnoc.effectiveDate || effDate) + ")."));
        } else {
          dnocWrap.appendChild(ui.callout("good", "DNOC notice completed. Pending days = 0. Cancellation is ready to approve and take effect."));
        }
        dnocWrap.appendChild(ui.kv({ k: "DNOC status", v: !dnoc.served ? "Required — not served" : (dnoc.ready ? "Ready to complete" : "Notice running") }));
        dnocWrap.appendChild(ui.kv({ k: "Pending days", v: String(dnoc.pendingDays), what: "Days left in the statutory notice window." }));
        if (dnoc.served) {
          dnocWrap.appendChild(ui.kv({ k: "DNOC issue date", v: PAS.fmtDate(dnoc.dnocServedOn), what: "When Direct Notice of Cancellation was served." }));
          dnocWrap.appendChild(ui.kv({ k: "DNOC expire date", v: PAS.fmtDate(dnoc.effectiveDate || effDate), what: "When the statutory notice period ends — cancel may complete on or after this date." }));
        }
        left.push(dnocWrap);
      }

      var noticeWrap = ui.h("div", { class: "mt-13" });
      noticeWrap.appendChild(ui.callout(q.noticeOk ? "good" : "bad", q.noticeOk ? ("Notice satisfied — " + q.noticeRequired + "d required, " + q.noticeProvided + "d given.") : (reason + " requires " + q.noticeRequired + "d notice, only " + q.noticeProvided + "d given." + (dnoc.required ? " Serve or wait for DNOC." : " Decide with this in mind."))));
      if (reason === "Fraud") noticeWrap.appendChild(ui.callout("warn", "Fraud-flagged — decide carefully. Approving permanently blocks reinstatement."));
      left.push(noticeWrap);

      /* Worked refund breakdown — a real per-day calculation table, not just the final numbers.
         The daily rate is the same one line, applied consistently, for every type: what changes
         between Flat / Pro-Rata / Short-Rate is which days count and whether a penalty is taken
         off the top, not the underlying arithmetic. */
      var dailyRate = p.premium / q.totalDays;
      var earnedAmount = dailyRate * q.earnedDays;
      var unearnedAmount = dailyRate * q.remainingDays;
      var basisLabel = q.type === "Flat" ? "Full written premium — the insurer was never on risk" : "Unearned premium — " + q.remainingDays + " unused day(s) × the daily rate";
      var worked = [
        ["Policy term", q.totalDays + " days total", "—", PAS.money(p.premium)],
        ["Daily premium rate", "Annual premium ÷ " + q.totalDays + " term days", "÷ " + q.totalDays + "d", PAS.money(dailyRate) + "/day"],
        ["Earned (insurer on risk)", q.earnedDays + " day(s) × " + PAS.money(dailyRate) + "/day", q.earnedDays + "d", PAS.money(earnedAmount)],
        ["Unearned (days returned)", q.remainingDays + " day(s) × " + PAS.money(dailyRate) + "/day", q.remainingDays + "d", PAS.money(unearnedAmount)],
        ["Refund basis (" + q.type + ")", basisLabel, "—", PAS.money(q.gross)],
      ];
      if (q.penalty > 0) {
        worked.push(["Short-rate penalty (" + (q.spec.penaltyPct * 100) + "%)", PAS.money(q.gross) + " basis × " + (q.spec.penaltyPct * 100) + "%", "—", "− " + PAS.money(q.penalty)]);
      }

      var right = [];
      right.push(ui.tipLabel({ text: "Refund calculation — worked, per day", what: "Every step from the daily premium rate to the final refund, computed from term dates and the derived type.", why: "Never hand-keyed — this is the number that goes to Billing, and exactly how it was reached.", className: "label-11 block mb-10" }));
      right.push(ui.dataTable({
        columns: ["Step", "How it's worked out", "Days", "Amount"],
        rows: worked,
        wrapCells: true,
      }));
      var totalRow = ui.h("div", { class: "refund-total" });
      totalRow.appendChild(ui.h("span", { class: "refund-total-label" }, "Refund due"));
      totalRow.appendChild(ui.h("span", { class: "refund-total-value" }, PAS.money(q.refund)));
      right.push(totalRow);
      var noticePeriodWrap = ui.h("div", { class: "mt-14" });
      noticePeriodWrap.appendChild(ui.tipLabel({ text: "Notice period", what: "Statutory days that must run before the effective date.", className: "label-11 block mb-9" }));
      noticePeriodWrap.appendChild(ui.kv({ k: "Required", v: q.noticeRequired + " days", what: reason + " requires this much notice." }));
      noticePeriodWrap.appendChild(ui.kv({ k: "Provided", v: q.noticeProvided + " days", what: dnoc.served ? "From DNOC served date." : "Between today and the effective date." }));
      if (dnoc.required) noticePeriodWrap.appendChild(ui.kv({ k: "Pending days", v: dnoc.pendingDays + " days", what: "Countdown after DNOC is served. Zero = ready to cancel." }));
      right.push(noticePeriodWrap);
      right.push(ui.decisionTrailSide(PAS.decisionTrailFor(p, txnId)));

      function flash(action) {
        return { title: action + " recorded", detail: p.id + " · " + txnId, tone: action === "Approve" ? "red" : action === "Decline" ? "amber" : "blue" };
      }
      function decide(approve, comment) {
        var audit = PAS.makeAudit(approve ? "Approve" : "Decline", comment);
        return PAS.api.call("POST", "/api/v1/transactions/" + txnId + "/" + (approve ? "approve" : "reject"),
          { decision: approve ? "approved" : "rejected", effectiveDate: effDate, premiumMethod: q.type, refund: { amount: Math.round(q.refund), currency: "USD" }, note: comment },
          { module: "Cancellation", policyId: p.id, statusCode: 200, label: (approve ? "Approve" : "Decline") + " cancellation — " + p.holder, response: approve ? { txnId: txnId, status: "completed", premiumMethod: q.type, refundAmount: Math.round(q.refund), events: ["policyCancelled"] } : { txnId: txnId, status: "rejected" } })
          .then(function () {
            PAS.decideCancellation(p.id, txnId, approve, effDate, q, audit);
            ui.renderToast(flash(approve ? "Approve" : "Decline"));
            buildContent();
          });
      }
      function hold(action) {
        return function (result) {
          var comment = result && typeof result === "object" ? result.comment : result;
          var category = (result && typeof result === "object" && result.category) || "";
          PAS.recordHeldDecision(p.id, txnId, action, comment, "Cancellation", "", category);
          ui.renderToast(flash(action));
          buildContent();
        };
      }
      function serveDnoc() {
        return PAS.api.call("POST", "/api/v1/policies/" + p.id + "/dnoc", { txnId: txnId, reason: reason },
          { module: "Cancellation", policyId: p.id, statusCode: 201, label: "Serve DNOC — " + p.holder, response: { txnId: txnId, event: "dnocServed", noticeDays: dnoc.noticeRequired } })
          .then(function () {
            PAS.serveDnoc(p.id, txnId);
            refreshPolicy();
            effDate = (h.meta && h.meta.dnocEffectiveDate) || effDate;
            ui.renderToast({ title: "DNOC served", detail: p.id + " · " + dnoc.noticeRequired + " pending days started", tone: "amber" });
            buildContent();
          });
      }

      var approveBlocked = dnoc.required && (!dnoc.served || !dnoc.ready);
      var approveDisabledReason = !dnoc.served
        ? "Serve DNOC first — Direct Notice of Cancellation required."
        : (!dnoc.ready ? (dnoc.pendingDays + " pending notice day(s) remaining after DNOC.") : "");

      var actions = decided
        ? [{ label: "Back to cancellation desk", icon: "arrow-left", onRun: function () { location.href = "cancellation.html"; } }]
        : [
          (!dnoc.required || dnoc.served) ? null : { label: "Serve DNOC", tone: "primary", icon: "file-check-2", onRun: function () { return serveDnoc(); } },
          ui.confirmable(p.id, txnId, "Approve", {
            label: "Approve cancellation", tone: "red", icon: "x-circle",
            onRun: function (c) { return decide(true, c); },
            disabled: approveBlocked,
            disabledReason: approveDisabledReason,
            typedConfirm: p.id,
          }),
          ui.confirmable(p.id, txnId, "Decline", { label: "Decline request", icon: "ban", onRun: function (c) { return decide(false, c); } }),
          ui.confirmable(p.id, txnId, "Escalate", { label: "Escalate", icon: "arrow-up-right", showCategory: true, onRun: hold("Escalate") }),
          ui.confirmable(p.id, txnId, "Request More Information", { label: "Request more information", icon: "corner-up-left", showCategory: true, onRun: hold("Request More Information") }),
        ].filter(Boolean);

      layoutContainer.innerHTML = "";
      layoutContainer.appendChild(ui.decisionLayout(left, right, actions));
    }
    buildContent();

    root.appendChild(ui.screen("cancellation-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
