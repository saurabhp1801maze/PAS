/* Data + business-logic layer. Ported 1:1 from the original React app's App.jsx
   (seedPolicies, cancelQuote, riskScore, underwritingDecision, renewalCompliance,
   reinstatementEligibility, and every mutation function). Policies are persisted to
   sessionStorage so state survives navigation between the separate HTML pages. */
(function (global) {
  "use strict";
  var PAS = global.PAS = global.PAS || {};

  /* The originally-authored seed premiums summed to a written premium around $58M across the
     on-risk book — a believable book for a single-office MGA, but small next to the "whole
     book" framing the dashboard's All-history view gives it. Scaling every premium-derived
     dollar figure up by one constant factor gets the lifetime written premium to roughly $100M
     without hand-editing the ~1,100 seed records. Every FIXED dollar threshold that compares
     against a policy's premium (delegated authority, manual-issue review, the loyalty high-value
     bonus, the auto-fleet size heuristic) is scaled by this same factor at its own declaration
     below, so which side of each threshold a given policy falls on is unchanged — only the
     absolute numbers grow, exactly like a currency redenomination. */
  var PREMIUM_SCALE = 1.73;
  PAS.PREMIUM_SCALE = PREMIUM_SCALE;

  /* ---------- generic helpers ---------- */
  var uid = function (p) { return p + "-" + Math.random().toString(36).slice(2, 7).toUpperCase(); };
  var todayISO = function () { return "2026-08-20"; };
  var addDays = function (iso, d) { var x = new Date(iso); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  var daysBetween = function (a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); };
  var pad2 = function (v) { return (v < 10 ? "0" : "") + v; };
  /* Advances by calendar year rather than a fixed 365 days — a term starting in a leap year used
     to renew a day early (2028-02-01 + 365 = 2029-01-31). Feb 29 clamps back to Feb 28 in a
     non-leap year instead of rolling forward into March. */
  var addYears = function (iso, k) {
    var parts = iso.split("-"), y = Number(parts[0]) + k, m = Number(parts[1]), d = Number(parts[2]);
    var lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + "-" + pad2(m) + "-" + pad2(Math.min(d, lastOfMonth));
  };
  /* §34 Data Presentation & Locale Formatting. Seed data is USD-denominated (§27) — that doesn't
     change — but *how* a number/date renders now follows the viewer's own locale via Intl, with
     `en-US` only as the fallback when a locale can't be read (this file also runs standalone
     under Node in tests/render.test.js, where `navigator` doesn't exist at all). Output format is
     deliberately unchanged for the en-US case (whole-dollar amounts, no cents) so this is a
     locale-readiness upgrade, not a visual change, for the demo's actual audience today. */
  var CURRENCY_CODE = "USD";
  var locale = function () { return (typeof navigator !== "undefined" && navigator.language) || "en-US"; };
  var money = function (n, currency) {
    try { return new Intl.NumberFormat(locale(), { style: "currency", currency: currency || CURRENCY_CODE, maximumFractionDigits: 0 }).format(Math.round(n || 0)); }
    catch (e) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }
  };
  var moneyShort = function (n) {
    return n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M"
      : n >= 1000 ? "$" + (n / 1000).toFixed(1) + "K" : money(n);
  };
  var fmtTime = function (iso) { return new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
  /* Renders a stored `YYYY-MM-DD` as a locale-formatted date without ever touching what's stored
     — the ISO string stays canonical everywhere else (sorting, arithmetic, the query string).
     opts passed straight to Intl.DateTimeFormat; default is a compact "DD Mon YYYY" style shown
     in the viewer's own locale conventions. */
  var fmtDate = function (iso, opts) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale(), opts || { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso + "T00:00:00")); }
    catch (e) { return iso; }
  };

  PAS.uid = uid; PAS.todayISO = todayISO; PAS.addDays = addDays; PAS.addYears = addYears; PAS.daysBetween = daysBetween;
  PAS.money = money; PAS.moneyShort = moneyShort; PAS.fmtTime = fmtTime; PAS.fmtDate = fmtDate; PAS.CURRENCY = CURRENCY_CODE;

  /* ---------- reporting-period bucketing ----------
     Shared Monthly/Quarterly/Yearly/All-history/Custom reporting-period math — one implementation
     so the Dashboard, Policy register, Brokers, MGA, Carriers and Customers pages can never mean
     something different by "September" or "Q3". Ported verbatim from the Dashboard's own
     period logic (the first page this shipped on) rather than reimplemented, so results match
     exactly. See PAS.ui.periodToggle for the reusable control built on top of this. */
  function inMonth(dateStr, ym) { return !!dateStr && dateStr.slice(0, 7) === ym; }
  function inYear(dateStr, y) { return !!dateStr && dateStr.slice(0, 4) === String(y); }
  /* Trailing N month keys ("YYYY-MM"), oldest first, ending at the given month offset from today
     (0 = current month, -1 = last month, ...). Built off a real Date object (not string math) so
     a window that crosses a year boundary rolls correctly. */
  function trailingMonths(n, endOffset) {
    var off = endOffset || 0;
    var today = new Date(todayISO() + "T00:00:00Z");
    var y = today.getUTCFullYear(), m = today.getUTCMonth() + off;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(y, m - i, 1));
      out.push(d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"));
    }
    return out;
  }
  function monthKeyOffset(offset) { return trailingMonths(1, offset)[0]; }
  function trailingYears(n, endOffset) {
    var curY = Number(todayISO().slice(0, 4)) + (endOffset || 0);
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(curY - i);
    return out;
  }
  function yearOffset(offset) { return Number(todayISO().slice(0, 4)) + (offset || 0); }
  /* Quarter keys are "YYYY-Qn". Built off the real UTC month, same reasoning as trailingMonths —
     a window that crosses a year boundary (Q4 -> Q1) has to roll the year too. */
  function quarterKeyOf(y, monthIdx0) { return y + "-Q" + (Math.floor(monthIdx0 / 3) + 1); }
  function inQuarter(dateStr, qKey) {
    if (!dateStr) return false;
    var d = new Date(dateStr + "T00:00:00Z");
    return quarterKeyOf(d.getUTCFullYear(), d.getUTCMonth()) === qKey;
  }
  /* Quarter index arithmetic (year*4 + quarter0) so offsets roll cleanly across year boundaries
     in both directions, including negative modulo when stepping back past Q1. */
  function quarterIndexOffset(offset) {
    var today = new Date(todayISO() + "T00:00:00Z");
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
  /* [fromISO, toISO] — the real calendar bounds of whichever period/offset (or custom range) is
     selected. "all" has no bounds (the caller treats null as "the whole book"). */
  function periodBounds(period, offset, customFrom, customTo) {
    if (period === "all") return null;
    if (period === "custom") return [customFrom, customTo];
    if (period === "year") { var y = yearOffset(offset); return [y + "-01-01", y + "-12-31"]; }
    if (period === "quarter") {
      var qKey = quarterKeyOffset(offset), qy = Number(qKey.slice(0, 4)), q = Number(qKey.slice(6));
      var firstMonth0 = (q - 1) * 3;
      var from = qy + "-" + pad2(firstMonth0 + 1) + "-01";
      var lastDay = new Date(Date.UTC(qy, firstMonth0 + 3, 0));
      var to = lastDay.getUTCFullYear() + "-" + pad2(lastDay.getUTCMonth() + 1) + "-" + pad2(lastDay.getUTCDate());
      return [from, to];
    }
    var mk = monthKeyOffset(offset), my = Number(mk.slice(0, 4)), mm0 = Number(mk.slice(5, 7)) - 1;
    var mLast = new Date(Date.UTC(my, mm0 + 1, 0));
    return [mk + "-01", mLast.getUTCFullYear() + "-" + pad2(mLast.getUTCMonth() + 1) + "-" + pad2(mLast.getUTCDate())];
  }
  /* True if dateStr falls inside the given period/offset (or custom range) — the single predicate
     every list-filtering caller uses, so "does this row belong in the selected period" is answered
     once. "all" matches anything with a date at all. */
  function periodMatches(dateStr, period, offset, customFrom, customTo) {
    if (period === "all") return !!dateStr;
    var bounds = periodBounds(period, offset, customFrom, customTo);
    return !!dateStr && dateStr >= bounds[0] && dateStr <= bounds[1];
  }
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* Human label for the currently selected period/offset — "Aug 2026", "Q3 2026", "2026". Custom
     range and "All" are handled by the caller (there's no single offset to name). */
  function periodLabelOf(period, offset) {
    if (period === "year") return String(yearOffset(offset));
    if (period === "quarter") return quarterKeyOffset(offset).replace("-", " ");
    var mk = monthKeyOffset(offset);
    return MONTH_NAMES[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4);
  }
  PAS.inMonth = inMonth; PAS.inYear = inYear; PAS.inQuarter = inQuarter;
  PAS.trailingMonths = trailingMonths; PAS.trailingQuarters = trailingQuarters; PAS.trailingYears = trailingYears;
  PAS.monthKeyOffset = monthKeyOffset; PAS.quarterKeyOffset = quarterKeyOffset; PAS.yearOffset = yearOffset;
  PAS.periodBounds = periodBounds; PAS.periodMatches = periodMatches; PAS.periodLabelOf = periodLabelOf;
  PAS.MONTH_NAMES = MONTH_NAMES;

  var REINSTATEMENT_WINDOW_DAYS = 45;
  /* 45 days matches the NAIC model act's nonrenewal-notice convention (most states require at
     least 45 days before expiration; a minority require 30, a few go to 60-75 for specific
     lines), so it's a defensible single number for a prototype that isn't state-specific. */
  var RENEWAL_LEAD_DAYS = 45;
  /* A regional underwriter's delegated binding authority, not a regulatory figure — $250,000 of
     premium (pre-scale) is a realistic single-account ceiling before a submission has to go to a
     senior underwriter in a US P&C shop. Scaled by PREMIUM_SCALE along with every seed premium so
     which submissions clear delegated authority is unchanged by the book-wide rescale. */
  var AUTHORITY_LIMIT = Math.round(250000 * PREMIUM_SCALE);
  var LOW_SCORE_REFER = 50;
  PAS.REINSTATEMENT_WINDOW_DAYS = REINSTATEMENT_WINDOW_DAYS;
  PAS.RENEWAL_LEAD_DAYS = RENEWAL_LEAD_DAYS;
  PAS.AUTHORITY_LIMIT = AUTHORITY_LIMIT;
  PAS.LOW_SCORE_REFER = LOW_SCORE_REFER;

  /* ---------- effective date: system-determined, never hand-typed ----------
     Who/what sets it, at each stage:
       - New business: the date the broker/insured requested at submission (`submittedOn` in the
         ledger). The system does not let an underwriter retype it — underwritingDecision's
         effective-date gate below is the enforcement: a request outside these bounds refers out
         rather than silently accepting whatever date arrived with the file.
       - Bind: inherited unchanged from the approved submission. PAS.decide never sets a date.
       - Issue: inherited unchanged from bind. PAS.issuePolicy never touches effectiveDate.
       - Renewal: the prior term's own expirationDate, exactly — computed by addYears, never
         chosen. See decideRenewal.
     No screen in this app exposes an editable "policy effective date" field anywhere in this
     chain — the one date input that exists (on the cancellation desk) sets when a CANCELLATION
     takes effect, a distinct, legitimately human-adjusted date, not the policy's own inception. */
  var EFFECTIVE_DATE_MAX_LEAD_DAYS = 60;
  PAS.EFFECTIVE_DATE_MAX_LEAD_DAYS = EFFECTIVE_DATE_MAX_LEAD_DAYS;
  function effectiveDateOk(policy) {
    if (!policy.submittedOn) return true; /* no submission date on record (e.g. renewed terms) — nothing to check against */
    var lead = daysBetween(policy.submittedOn, policy.effectiveDate);
    return lead >= 0 && lead <= EFFECTIVE_DATE_MAX_LEAD_DAYS;
  }
  PAS.effectiveDateOk = effectiveDateOk;

  /* ---------- cancellation: four independent attributes, not one ----------
     Type, Reason, Initiated By and Timing each answer a different question and are recorded
     separately. Type is still DERIVED, never hand-picked — but now from Reason + Initiated By
     + whether the cancellation lands at inception, instead of from Reason alone. */

  /* Type — the refund/proration BASIS. What happened financially, not why. Exactly three: a
     fourth "Non-Payment" type used to exist here, conflating a REASON with a financial basis;
     non-payment cancellations use the Pro-Rata basis like any other insurer-side exit; the
     15-day statutory notice that used to hang off the type now hangs off the Reason it actually
     belongs to (see CANCEL_REASONS). */
  /* when / rate / rule are the plain-language explanation shown on the Cancellation desk's own
     "Types of cancellation" cards and the decision screen's derived-type card — kept short (2-3
     lines) and jargon-free on purpose. "Basis"/"unearned premium"/"acquisition cost" language
     used to sit here; it was accurate but not easy to read at a glance, so it's gone from the
     display text even though the underlying `basis` field (used only for that one internal
     written/unearned distinction, not shown raw anymore) is unchanged. */
  var CANCEL_TYPES = {
    Flat: {
      tone: "blue", penaltyPct: 0, basis: "written",
      when: "Cover never actually started. This cancels on or before the policy's own start date.",
      rate: "You get the full premium back. No deductions, no matter the reason or who asked for it.",
      rule: "Only allowed when the cancellation date is on or before the policy's start date.",
    },
    "Pro-Rata": {
      tone: "green", penaltyPct: 0, basis: "unearned",
      when: "Cover ran for part of the term. Either the MGA or System is ending it, or the reason itself never carries a penalty.",
      rate: "You get back exactly the unused portion of your premium, day for day. No penalty.",
      rule: "An MGA- or System-initiated cancellation never carries a penalty, even if the reason would normally trigger one.",
    },
    "Short-Rate": {
      tone: "amber", penaltyPct: 0.1, basis: "unearned",
      when: "You (the insured) or your broker are choosing to cancel early, on your own.",
      rate: "You get back the unused portion of your premium, minus a 10% fee for the cost of setting up the policy.",
      rule: "Never applies when the MGA or System is the one cancelling — see Pro-Rata.",
    },
  };

  /* Reason — why, independent of Type. Each carries the notice period that must run before the
     effective date (this is where that requirement actually lives now, not on Type), and the
     Type a reason recommends by default before the Initiated By check can downgrade it. */
  /* Notice-day defaults follow the NAIC model act's cancellation timeline: at least 10 days for
     nonpayment, at least 30 days for other reasons within the first 60 days on risk, and at least
     45 days once the policy has been in force beyond 60 days or is a renewal. "Underwriting" here
     represents that post-60-day, insurer-initiated exit, so it takes the 45-day figure. */
  var CANCEL_REASONS = {
    "Insured Request": { noticeDays: 0, defaultType: "Short-Rate" },
    "Non-Payment": { noticeDays: 10, defaultType: "Pro-Rata" },
    "Fraud": { noticeDays: 0, defaultType: "Pro-Rata" },
    "Underwriting": { noticeDays: 45, defaultType: "Pro-Rata" },
    "Sold Vehicle/Business": { noticeDays: 0, defaultType: "Short-Rate" },
    "Other": { noticeDays: 30, defaultType: "Short-Rate" },
  };

  /* Initiated By — who, independent of Type and Reason. The valid values themselves are defined
     alongside PAS.INITIATORS as PAS.CANCEL_INITIATOR_KEYS (kept in one place, next to the shared
     initiator directory it's a subset of). The three insurer-side values here are the ones
     deriveCancelType checks against to enforce "never penalize the insurer's own exit." */
  var CANCEL_INSURER_SIDE = { MGA: true, Carrier: true, System: true };
  PAS.CANCEL_TYPES = CANCEL_TYPES;
  PAS.CANCEL_REASONS = CANCEL_REASONS;
  PAS.CANCEL_INSURER_SIDE = CANCEL_INSURER_SIDE;

  /* Timing — Immediate vs. Future/Scheduled. Never stored: it's a pure function of the effective
     date against today, so it can't drift out of sync the way a hand-set flag could. */
  function cancelTiming(effectiveDate) { return effectiveDate <= todayISO() ? "Immediate" : "Future/Scheduled"; }
  PAS.cancelTiming = cancelTiming;

  /* The one place Type is decided. atInception always wins; otherwise Reason proposes a default
     and an insurer-side Initiated By can only ever downgrade Short-Rate to Pro-Rata — it can
     never upgrade a no-penalty reason into one. */
  function deriveCancelType(reason, initiatedBy, atInception) {
    if (atInception) return "Flat";
    var spec = CANCEL_REASONS[reason] || CANCEL_REASONS.Other;
    if (spec.defaultType === "Short-Rate" && CANCEL_INSURER_SIDE[initiatedBy]) return "Pro-Rata";
    return spec.defaultType;
  }
  PAS.deriveCancelType = deriveCancelType;

  /* "Where permitted" (MOM 2026-08-26): Type stays derived by default. isValidCancelType is the
     *normal* rule — Flat only when the effective date lands at/before inception (the insurer was
     never on risk); an insurer-side initiator (Reinsurer/MGA/System) never carries a Short-Rate
     penalty. It still drives the UI's default suggestion and the "outside the normal rule"
     warning, but it no longer blocks an override outright: a Super Admin/Admin is allowed to force
     any of the three types as a deliberate, logged exception (see setCancelTypeOverride / the
     overrideOutsideRule flag on cancelQuote's result). */
  function isValidCancelType(type, initiatedBy, atInception) {
    if (!CANCEL_TYPES[type]) return false;
    if (atInception) return type === "Flat";
    if (type === "Flat") return false;
    if (type === "Short-Rate" && CANCEL_INSURER_SIDE[initiatedBy]) return false;
    return true;
  }
  PAS.isValidCancelType = isValidCancelType;

  /* Everything about a cancellation follows from these four attributes plus dates, unless a
     decision-maker has explicitly overridden Type (meta.typeOverride) — any of the three types is
     honored; overrideOutsideRule flags when that choice breaks the normal isValidCancelType rule,
     so the UI can show it as a logged exception rather than pretend it's the ordinary case. */
  function cancelQuote(policy, reason, initiatedBy, effectiveDate, meta) {
    meta = meta || {};
    var reasonSpec = CANCEL_REASONS[reason] || CANCEL_REASONS.Other;
    var totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
    var atInception = effectiveDate <= policy.effectiveDate;
    var derivedType = deriveCancelType(reason, initiatedBy, atInception);
    var overrideValid = !!meta.typeOverride && !!CANCEL_TYPES[meta.typeOverride];
    var type = overrideValid ? meta.typeOverride : derivedType;
    var overridden = overrideValid && type !== derivedType;
    var overrideOutsideRule = overridden && !isValidCancelType(type, initiatedBy, atInception);
    var spec = CANCEL_TYPES[type];
    var remainingDays = Math.max(0, daysBetween(effectiveDate, policy.expirationDate));
    var unearned = policy.premium * (remainingDays / totalDays);
    var gross = type === "Flat" ? policy.premium : unearned;
    var penalty = gross * spec.penaltyPct;
    var refund = Math.max(0, gross - penalty);
    var noticeRequired = reasonSpec.noticeDays;
    /* When a DNOC has been served, noticeProvided is measured from the notice date — not from
       "today vs effective" alone. That is what makes the pending-days countdown real. */
    var noticeAnchor = meta.dnocServedOn || todayISO();
    var noticeProvided = daysBetween(noticeAnchor, effectiveDate);
    if (meta.dnocServedOn) {
      noticeProvided = Math.max(noticeProvided, daysBetween(meta.dnocServedOn, todayISO()));
    }
    var noticeOk = noticeProvided >= noticeRequired;
    var pendingDays = meta.dnocServedOn
      ? Math.max(0, noticeRequired - daysBetween(meta.dnocServedOn, todayISO()))
      : noticeRequired;
    return {
      type: type, derivedType: derivedType, overridden: overridden, overrideOutsideRule: overrideOutsideRule, atInception: atInception,
      spec: spec, reason: reason, initiatedBy: initiatedBy, timing: cancelTiming(effectiveDate),
      totalDays: totalDays, remainingDays: remainingDays,
      earnedDays: totalDays - remainingDays, gross: gross, penalty: penalty, refund: refund,
      noticeRequired: noticeRequired, noticeProvided: noticeProvided, noticeOk: noticeOk,
      needsReview: reason === "Fraud" || !noticeOk,
      requiresDnoc: requiresDnoc(reason, initiatedBy),
      dnocServed: !!meta.dnocServedOn,
      dnocServedOn: meta.dnocServedOn || null,
      dnocPendingDays: pendingDays,
      dnocReady: !!meta.dnocServedOn && pendingDays === 0,
    };
  }

  /* DNOC — Direct Notice of Cancellation. Required when an insurer-side initiator (System,
     Carrier, MGA) cancels for a reason that carries a statutory notice period. The notice is a
     first-class PAS document; the cancellation cannot complete until the pending days run out. */
  function requiresDnoc(reason, initiatedBy) {
    if (!CANCEL_INSURER_SIDE[initiatedBy]) return false;
    var spec = CANCEL_REASONS[reason] || CANCEL_REASONS.Other;
    return (spec.noticeDays || 0) > 0;
  }
  PAS.requiresDnoc = requiresDnoc;

  function dnocState(meta) {
    meta = meta || {};
    var reason = meta.reason || "Insured Request";
    var initiatedBy = meta.initiatedBy || "Insured";
    var required = (CANCEL_REASONS[reason] || CANCEL_REASONS.Other).noticeDays || 0;
    if (!requiresDnoc(reason, initiatedBy)) {
      return { required: false, served: false, pendingDays: 0, ready: true, noticeRequired: required };
    }
    if (!meta.dnocServedOn) {
      return { required: true, served: false, pendingDays: required, ready: false, noticeRequired: required };
    }
    var elapsed = daysBetween(meta.dnocServedOn, todayISO());
    var pending = Math.max(0, required - elapsed);
    return {
      required: true, served: true, pendingDays: pending, ready: pending === 0,
      noticeRequired: required, dnocServedOn: meta.dnocServedOn,
      effectiveDate: meta.dnocEffectiveDate || addDays(meta.dnocServedOn, required),
    };
  }
  PAS.dnocState = dnocState;

  /* Manual Type override (MOM 2026-08-26: "Users should be able to change the policy type...
     where permitted" — Super Admin/Admin want full discretion, e.g. to force Short-Rate on an
     insurer-initiated cancellation, even though that's not the normal rule). "Where permitted"
     is enforced as a role gate only (see cancellation-decision.js's canOverride check) — the only
     thing refused here is an unrecognized type. isValidCancelType still runs, but purely to flag
     when this choice departs from the normal rule (surfaced to the caller as outsideRule, and to
     the UI via cancelQuote's overrideOutsideRule), not to block it. */
  PAS.setCancelTypeOverride = function (policyId, txnId, type, comment) {
    var p = PAS.getPolicy(policyId);
    var held = p && p.history.find(function (h) { return h.id === txnId; });
    if (!held) return { allowed: false, reason: "Transaction not found." };
    if (!CANCEL_TYPES[type]) return { allowed: false, reason: "\"" + type + "\" is not a cancellation type." };
    var meta = held.meta || {};
    var atInception = (held.date || todayISO()) <= p.effectiveDate;
    var outsideRule = !isValidCancelType(type, meta.initiatedBy, atInception);
    var audit = PAS.makeAudit("Override Type", comment || ("Type manually set to " + type + (outsideRule ? " (outside the normal rule)." : ".")));
    patch(policyId, function (pp) {
      return Object.assign({}, pp, {
        history: pp.history.map(function (h) { return h.id === txnId ? withAudit(h, audit, { meta: { typeOverride: type } }) : h; }),
      });
    });
    return { allowed: true, outsideRule: outsideRule };
  };
  PAS.clearCancelTypeOverride = function (policyId, txnId, comment) {
    var audit = PAS.makeAudit("Clear Type Override", comment || "Reverted to the derived type.");
    patch(policyId, function (pp) {
      return Object.assign({}, pp, {
        history: pp.history.map(function (h) { return h.id === txnId ? withAudit(h, audit, { meta: { typeOverride: null } }) : h; }),
      });
    });
  };

  PAS.serveDnoc = function (policyId, txnId) {
    return patch(policyId, function (p) {
      var txn = p.history.find(function (h) { return h.id === txnId && h.type === "Cancellation" && h.status === "Pending"; });
      if (!txn) return p;
      var meta = txn.meta || {};
      if (!requiresDnoc(meta.reason, meta.initiatedBy)) return p;
      if (meta.dnocServedOn) return p;
      var noticeDays = (CANCEL_REASONS[meta.reason] || CANCEL_REASONS.Other).noticeDays || 0;
      if (noticeDays < 1) return p;
      var submittedOn = meta.submittedOn || todayISO();
      var servedOn = todayISO();
      /* Expire must be strictly after submitted (and after issue). Use max of issue+notice and submitted+notice. */
      var effDate = addDays(servedOn, noticeDays);
      var fromSubmitted = addDays(submittedOn, noticeDays);
      if (effDate <= submittedOn || effDate < fromSubmitted) effDate = fromSubmitted;
      if (effDate <= servedOn) effDate = addDays(servedOn, noticeDays);
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        return Object.assign({}, h, {
          date: effDate,
          title: "DNOC served — " + noticeDays + " days pending",
          detail: "Direct Notice of Cancellation served on " + servedOn + ". Cancellation may complete on or after " + effDate + " (" + noticeDays + "-day statutory notice for " + meta.reason + ").",
          meta: Object.assign({}, meta, {
            submittedOn: submittedOn,
            dnocServedOn: servedOn,
            dnocEffectiveDate: effDate,
            dnocPendingDaysAtServe: noticeDays,
          }),
        });
      });
      var docs = (p.documents || []).concat([{
        id: uid("DOC"), name: "Direct Notice of Cancellation", version: 1,
        generatedAt: servedOn, type: "DNOC", transactionId: txnId, deliveryStatus: "Generated",
      }]);
      return Object.assign({}, p, { history: history, documents: docs });
    });
  };
  /* ---------- risk scoring ----------
     The score measures risk QUALITY only. Exposure size is deliberately not an input: premium is
     an output of risk assessment, not an input to it, and while it was one the score gate and the
     authority gate were secretly the same gate — any premium above AUTHORITY_LIMIT forced a score
     below LOW_SCORE_REFER, so the authority branch could never be the stated reason for a referral.
     Size is now gated only by AUTHORITY_LIMIT, which leaves the two triggers genuinely independent.
     Every component is declared here so the desk can show the operator the whole arithmetic. */
  var PRODUCT_BASE = {
    "Commercial Property": 72, "Comprehensive Auto": 74, "Home Owners": 80,
    "Marine Cargo": 68, "Group Health": 70, "Term Life": 84,
  };
  var RISK_WEIGHTS = {
    atFaultClaim: -11, otherClaim: -4, claimFreeYear: 4, claimFreeCap: 20,
    priorCancellation: -8, nonPayment: -12, excessEndorsement: -3, endorsementAllowance: 2,
    newBusiness: -6, infoPending: -6,
  };
  PAS.PRODUCT_BASE = PRODUCT_BASE;
  PAS.RISK_WEIGHTS = RISK_WEIGHTS;

  /* Returns the score AND its line-by-line derivation, so the underwriting desk can render the
     claims and change history it was already displaying as decoration and have it actually drive
     the number the operator is asked to act on. */
  function riskFactors(policy) {
    var r = policy.risk || {}, w = RISK_WEIGHTS;
    var base = PRODUCT_BASE[policy.product];
    if (typeof base !== "number") base = 75;
    var hist = policy.history || [];
    var atFault = r.atFaultClaims || 0;
    var other = r.otherClaims || 0;
    var claimFree = r.claimFreeYears || 0;
    var priorCx = (r.priorCancellations || 0)
      + hist.filter(function (h) { return h.type === "Cancellation" && h.status === "Completed"; }).length;
    var endorsements = hist.filter(function (h) { return h.type === "Endorsement" && h.status === "Completed"; }).length;
    var excess = Math.max(0, endorsements - w.endorsementAllowance);

    var lines = [];
    function add(label, value, note) { if (value) lines.push({ label: label, value: value, note: note }); }
    add("At-fault claims (" + atFault + ")", atFault * w.atFaultClaim, "Each at-fault loss on the prior term.");
    add("Other claims (" + other + ")", other * w.otherClaim, "Non-fault and partial losses.");
    add("Claim-free years (" + claimFree + ")", Math.min(w.claimFreeCap, claimFree * w.claimFreeYear), "Capped at +" + w.claimFreeCap + ".");
    add("Prior cancellations (" + priorCx + ")", priorCx * w.priorCancellation, "Counted from the ledger and from disclosure.");
    add("Non-payment on record", r.nonPayment ? w.nonPayment : 0, "A prior term lapsed for non-payment.");
    add("Endorsements above " + w.endorsementAllowance + " (" + excess + ")", excess * w.excessEndorsement, "Frequent mid-term change signals an unstable risk.");
    add("New business, no loss history", r.newBusiness ? w.newBusiness : 0, "No prior term to price from.");
    add("Information outstanding", r.infoPending ? w.infoPending : 0, "Underwriting data not yet supplied.");

    var raw = lines.reduce(function (t, l) { return t + l.value; }, base);
    return { base: base, product: policy.product, lines: lines, raw: raw, score: Math.max(5, Math.min(97, raw)) };
  }
  function riskScore(policy) { return riskFactors(policy).score; }

  /* Three independent referral gates, each able to fail on its own. The seed book carries one
     submission per failure mode so every branch is reachable and demonstrable on the desk. */
  function underwritingDecision(policy, score) {
    if (typeof score !== "number") score = riskScore(policy);
    var r = policy.risk || {};
    var gates = [
      { key: "score", label: "Score gate", threshold: "Refers below " + LOW_SCORE_REFER,
        passed: score >= LOW_SCORE_REFER,
        failReason: "Risk score " + score + " is below the " + LOW_SCORE_REFER + " auto-refer threshold." },
      { key: "authority", label: "Authority gate", threshold: "Refers above " + money(AUTHORITY_LIMIT),
        passed: (Number(policy.premium) || 0) <= AUTHORITY_LIMIT,
        failReason: "Premium " + money(policy.premium) + " exceeds the " + money(AUTHORITY_LIMIT) + " delegated authority limit." },
      { key: "information", label: "Information gate", threshold: "Refers while data is outstanding",
        passed: !r.infoPending,
        failReason: "Underwriting information outstanding — " + (r.infoPendingNote || "requested data not yet supplied") + "." },
      { key: "effectiveDate", label: "Effective date gate", threshold: "Refers outside a 0–" + EFFECTIVE_DATE_MAX_LEAD_DAYS + "-day lead from submission",
        passed: effectiveDateOk(policy),
        failReason: "Requested effective date " + policy.effectiveDate + " is " + (daysBetween(policy.submittedOn, policy.effectiveDate) < 0 ? "before" : "more than " + EFFECTIVE_DATE_MAX_LEAD_DAYS + " days after") + " the submission date " + policy.submittedOn + " — outside the system's allowed lead time." },
    ];
    var failed = gates.filter(function (g) { return !g.passed; });
    if (failed.length === 0) {
      return { outcome: "Approve", tier: "Within agent authority", gates: gates, failed: failed,
        reason: "Score " + score + " clears the threshold, premium is inside delegated authority and the file is complete." };
    }
    return { outcome: "Refer", tier: "Senior underwriter", gates: gates, failed: failed,
      reason: failed.map(function (g) { return g.failReason; }).join(" ") };
  }
  function renewalCompliance(policy) {
    var daysToExpiry = daysBetween(todayISO(), policy.expirationDate);
    return { daysToExpiry: daysToExpiry, status: daysToExpiry < 0 ? "Overdue" : daysToExpiry < RENEWAL_LEAD_DAYS ? "Urgent" : "Compliant" };
  }
  function lastEvent(policy, type) {
    var evs = policy.history.filter(function (h) { return h.type === type; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return evs[0] || null;
  }
  function reinstatementEligibility(policy) {
    var ev = lastEvent(policy, "Cancellation");
    if (!ev) return null;
    var daysSince = daysBetween(ev.date, todayISO());
    var fraud = ev.meta && ev.meta.reason === "Fraud";
    return { cancelEv: ev, daysSince: daysSince, fraud: fraud, eligible: !fraud && daysSince <= REINSTATEMENT_WINDOW_DAYS && daysSince >= 0 };
  }
  function txn(seq, date, type, title, detail, user, meta, status) {
    return { id: uid("TXN"), seq: seq, date: date, recordedAt: date + "T09:30:00.000Z", type: type, title: title, detail: detail, user: user, status: status || "Completed", meta: meta || {} };
  }
  PAS.cancelQuote = cancelQuote;
  PAS.riskScore = riskScore;
  PAS.riskFactors = riskFactors;
  PAS.underwritingDecision = underwritingDecision;
  PAS.renewalCompliance = renewalCompliance;
  PAS.lastEvent = lastEvent;
  PAS.reinstatementEligibility = reinstatementEligibility;

  /* ---------- renewal notifications (MOM 2026-08-26) ----------
     "Renewal notifications should be sent to the customer, underwriter, and lead so the relevant
     teams can proactively contact the customer and initiate the renewal process." Real recipients,
     not fabricated ones: the underwriter is read from that policy's own completed Underwriting
     decision (the same source "Underwritten by" on policy-detail.js reads from), never a made-up
     name. Same honesty pattern as recordHeldDecision's emailTo — there is no real mail transport
     in a static frontend, so sending is simulated by appending a real, inspectable ledger entry
     (visible on the policy's own Transaction ledger tab and in the decision trail), not a toast
     that vanishes and leaves no trace. */
  PAS.RENEWAL_LEAD_IDENTITY = "M. Ferreira (Renewal Operations Lead)";
  PAS.renewalNoticeRecipients = function (policy) {
    var uw = policy.history.filter(function (h) { return h.type === "Underwriting" && h.status === "Completed"; }).sort(function (a, b) { return b.seq - a.seq; })[0];
    return {
      customer: policy.holder,
      underwriter: uw ? uw.user : "Unassigned — no underwriting decision on file",
      lead: PAS.RENEWAL_LEAD_IDENTITY,
    };
  };
  PAS.lastRenewalNotice = function (policy) {
    return policy.history.filter(function (h) { return h.type === "Renewal" && h.meta && h.meta.renewalNotice; }).sort(function (a, b) { return b.seq - a.seq; })[0] || null;
  };
  PAS.sendRenewalNotice = function (id) {
    return patch(id, function (p) {
      var recipients = PAS.renewalNoticeRecipients(p);
      var detail = "Renewal notice sent to the customer (" + recipients.customer + "), the underwriter (" + recipients.underwriter + "), and the " + recipients.lead + ".";
      return pushTxn(p, {
        date: todayISO(), type: "Renewal", status: "Completed", title: "Renewal notice sent",
        detail: detail, user: PAS.actorName(),
        meta: { noteOnly: true, renewalNotice: true, recipients: recipients },
      });
    });
  };

  /* ---------- the book of business ----------
     This is the point of a PAS: the data is ALREADY here and the operator makes decisions on it. */
  /* Underwriting factors per record, kept as a table beside the book rather than inline on 23
     object literals. It is deliberately obvious here which referral gate each referred
     submission exists to trip:
       SUB-2026-0041  score + authority      SUB-2026-0043  authority only
       SUB-2026-0042  score only             SUB-2026-0044  information only  */
  var RISK_PROFILE = {
    "SUB-2026-0041": { otherClaims: 3, priorCancellations: 1, newBusiness: true },
    "SUB-2026-0042": { atFaultClaims: 2, otherClaims: 1, newBusiness: true },
    "SUB-2026-0043": { newBusiness: true },
    "SUB-2026-0044": { newBusiness: true, infoPending: true, infoPendingNote: "employee census and prior-year claims data not yet received" },
    "POL-2026-00311": { claimFreeYears: 1, newBusiness: true },
    "POL-2026-00312": { claimFreeYears: 2, newBusiness: true },
    "POL-2026-00313": { claimFreeYears: 1, newBusiness: true },
    "POL-2026-00314": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-09112": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-04456": { claimFreeYears: 1, newBusiness: true },
    "POL-2026-00120": { claimFreeYears: 1, newBusiness: true },
    "POL-2024-00187": { claimFreeYears: 2 },
    "POL-2026-02233": { newBusiness: true },
    "POL-2026-00988": { claimFreeYears: 3, otherClaims: 1 },
    "POL-2026-00560": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-08765": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-06210": { claimFreeYears: 1, newBusiness: true },
    "POL-2024-09321": { claimFreeYears: 3 },
    "POL-2025-07734": { claimFreeYears: 1, newBusiness: true },
    "POL-2026-00777": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-03321": { claimFreeYears: 1, newBusiness: true },
    "POL-2026-01190": { nonPayment: true, newBusiness: true },
    "POL-2026-00045": { nonPayment: true, newBusiness: true },
    "POL-2025-12200": { newBusiness: true },
    "POL-2025-05678": { claimFreeYears: 1, newBusiness: true },
    "POL-2025-11044": { claimFreeYears: 1, newBusiness: true },
    "POL-2024-07765": { newBusiness: true },
  };
  PAS.RISK_PROFILE = RISK_PROFILE;

  /* ---------- claims: real records, not a fabricated loss ratio ----------
     Generated deterministically by scripts/gen-claims.js from per-product frequency/severity
     assumptions (not hand-typed, not Math.random — same policy id always produces the same claim,
     so it is reproducible and auditable, re-run the script after any change to the assumptions).
     Each claim is `{ type, status, reportedOn, incurred, paid, reserved }`, attached to its policy
     the same way `documents` already is. This is what makes the loss-ratio breakdowns on the
     dashboard genuinely show some segments in loss and some profitable (Comprehensive Auto ~119%,
     Marine Cargo ~34%, as of the last generation) instead of an unrealistic near-zero book-wide
     ratio. Ironwood Steel Works (POL-2026-00988) is the one hand-pinned exception, preserved
     verbatim by the generator — its cancellation record's own detail text says "adverse loss
     ratio... 140% over two terms," so its claim's incurred amount stays exactly 140% of premium
     ($100,000 × 1.4 = $140,000) rather than being regenerated into a number that would contradict
     the narrative already on file. */
var CLAIMS_BY_ID = {
    "POL-2024-09321": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-11", incurred: 157660, paid: 157660, reserved: 0 }],
    "POL-2025-11044": [{ type: "Collision", status: "Closed", reportedOn: "2026-03-03", incurred: 3420, paid: 3420, reserved: 0 }],
    "POL-2025-12200": [{ type: "Water damage", status: "Closed", reportedOn: "2026-05-02", incurred: 8110, paid: 8110, reserved: 0 }],
    "POL-2026-00988": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: 280000, paid: 280000, reserved: 0 }],
    "POL-2026-0244": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-06-01", incurred: 72710, paid: 72710, reserved: 0 }, { type: "Chronic condition management", status: "Closed", reportedOn: "2025-06-01", incurred: 91190, paid: 91190, reserved: 0 }],
    "POL-2026-0246": [{ type: "Water damage", status: "Closed", reportedOn: "2025-07-08", incurred: 1730, paid: 1730, reserved: 0 }],
    "POL-2026-0249": [{ type: "Death benefit", status: "Open", reportedOn: "2025-10-18", incurred: 270, paid: 80, reserved: 190 }],
    "POL-2026-0264": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-08-29", incurred: 77700, paid: 77700, reserved: 0 }],
    "POL-2026-0268": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-06-09", incurred: 73730, paid: 73730, reserved: 0 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-04-02", incurred: 87550, paid: 87550, reserved: 0 }],
    "POL-2026-0273": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2025-06-01", incurred: 103040, paid: 103040, reserved: 0 }],
    "POL-2026-0278": [{ type: "Hail damage", status: "Closed", reportedOn: "2025-06-01", incurred: 5620, paid: 5620, reserved: 0 }],
    "POL-2026-0279": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-06-01", incurred: 266830, paid: 266830, reserved: 0 }],
    "POL-2026-0282": [{ type: "Windshield damage", status: "Open", reportedOn: "2025-10-03", incurred: 3170, paid: 1680, reserved: 1490 }],
    "POL-2026-0289": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2025-06-23", incurred: 301460, paid: 301460, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2025-07-04", incurred: 311850, paid: 311850, reserved: 0 }],
    "POL-2026-0293": [{ type: "Collision", status: "Open", reportedOn: "2025-07-25", incurred: 7400, paid: 1330, reserved: 6070 }],
    "POL-2026-0294": [{ type: "Water intrusion", status: "Open", reportedOn: "2025-11-03", incurred: 119230, paid: 42680, reserved: 76550 }],
    "POL-2026-0298": [{ type: "Collision", status: "Open", reportedOn: "2025-11-29", incurred: 2090, paid: 1110, reserved: 980 }],
    "POL-2026-0300": [{ type: "Theft", status: "Open", reportedOn: "2025-07-23", incurred: 2710, paid: 930, reserved: 1780 }],
    "POL-2026-03003": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-06-11", incurred: 156080, paid: 156080, reserved: 0 }],
    "POL-2026-03007": [{ type: "Collision", status: "Closed", reportedOn: "2026-03-13", incurred: 187700, paid: 187700, reserved: 0 }],
    "POL-2026-03010": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-07-15", incurred: 215270, paid: 116040, reserved: 99230 }],
    "POL-2026-03013": [{ type: "Collision", status: "Open", reportedOn: "2026-01-23", incurred: 230940, paid: 83490, reserved: 147450 }],
    "POL-2026-03014": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-03-07", incurred: 152080, paid: 152080, reserved: 0 }, { type: "Theft", status: "Closed", reportedOn: "2026-05-22", incurred: 236600, paid: 236600, reserved: 0 }],
    "POL-2026-03015": [{ type: "Theft", status: "Closed", reportedOn: "2026-04-08", incurred: 258060, paid: 258060, reserved: 0 }],
    "POL-2026-03016": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-02-09", incurred: 108220, paid: 108220, reserved: 0 }],
    "POL-2026-03017": [{ type: "Collision", status: "Closed", reportedOn: "2026-05-23", incurred: 86340, paid: 86340, reserved: 0 }],
    "POL-2026-03018": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-01-14", incurred: 187470, paid: 187470, reserved: 0 }],
    "POL-2026-0302": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-06-01", incurred: 182990, paid: 182990, reserved: 0 }, { type: "Chronic condition management", status: "Open", reportedOn: "2025-06-01", incurred: 126980, paid: 59670, reserved: 67310 }],
    "POL-2026-03020": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-05-10", incurred: 292790, paid: 292790, reserved: 0 }],
    "POL-2026-0303": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2025-07-24", incurred: 132270, paid: 132270, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2025-12-11", incurred: 55850, paid: 55850, reserved: 0 }],
    "POL-2026-0308": [{ type: "Cargo damage", status: "Closed", reportedOn: "2025-10-25", incurred: 93250, paid: 93250, reserved: 0 }],
    "POL-2026-0309": [{ type: "Windshield damage", status: "Open", reportedOn: "2025-07-13", incurred: 2980, paid: 1070, reserved: 1910 }, { type: "Theft", status: "Open", reportedOn: "2025-08-06", incurred: 2270, paid: 550, reserved: 1720 }],
    "POL-2026-0313": [{ type: "Death benefit", status: "Closed", reportedOn: "2025-06-15", incurred: 830, paid: 830, reserved: 0 }],
    "POL-2026-0316": [{ type: "Cargo damage", status: "Closed", reportedOn: "2025-09-09", incurred: 129530, paid: 129530, reserved: 0 }, { type: "Cargo damage", status: "Closed", reportedOn: "2025-12-30", incurred: 109790, paid: 109790, reserved: 0 }, { type: "Cargo damage", status: "Open", reportedOn: "2026-01-23", incurred: 135300, paid: 63480, reserved: 71820 }],
    "POL-2026-0318": [{ type: "Collision", status: "Closed", reportedOn: "2025-08-04", incurred: 8080, paid: 8080, reserved: 0 }],
    "POL-2026-0320": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2025-10-25", incurred: 292400, paid: 292400, reserved: 0 }, { type: "Storm damage", status: "Closed", reportedOn: "2026-03-20", incurred: 172820, paid: 172820, reserved: 0 }],
    "POL-2026-0323": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-03-10", incurred: 97520, paid: 97520, reserved: 0 }, { type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-30", incurred: 54210, paid: 54210, reserved: 0 }],
    "POL-2026-0325": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-08-19", incurred: 71460, paid: 71460, reserved: 0 }],
    "POL-2026-0327": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-02-06", incurred: 163930, paid: 163930, reserved: 0 }],
    "POL-2026-0334": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-04-17", incurred: 241850, paid: 241850, reserved: 0 }],
    "POL-2026-0338": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-03-16", incurred: 147280, paid: 67080, reserved: 80200 }],
    "POL-2026-0341": [{ type: "Storm damage", status: "Closed", reportedOn: "2026-01-26", incurred: 129930, paid: 129930, reserved: 0 }, { type: "Fire", status: "Open", reportedOn: "2026-06-04", incurred: 103340, paid: 31800, reserved: 71540 }],
    "POL-2026-0342": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-24", incurred: 5710, paid: 5710, reserved: 0 }],
    "POL-2026-0352": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-04-15", incurred: 208960, paid: 208960, reserved: 0 }],
    "POL-2026-0353": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2025-11-16", incurred: 160120, paid: 160120, reserved: 0 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-16", incurred: 182630, paid: 182630, reserved: 0 }],
    "POL-2026-0357": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-01-10", incurred: 253210, paid: 253210, reserved: 0 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-19", incurred: 163370, paid: 163370, reserved: 0 }],
    "POL-2026-0360": [{ type: "Windshield damage", status: "Closed", reportedOn: "2025-11-24", incurred: 1500, paid: 1500, reserved: 0 }],
    "POL-2026-0362": [{ type: "Theft", status: "Closed", reportedOn: "2025-11-21", incurred: 7170, paid: 7170, reserved: 0 }],
    "POL-2026-0363": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-08-17", incurred: 159690, paid: 159690, reserved: 0 }],
    "POL-2026-0364": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-07-11", incurred: 269630, paid: 269630, reserved: 0 }],
    "POL-2026-0365": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-02-03", incurred: 1360, paid: 1360, reserved: 0 }],
    "POL-2026-0374": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-05-28", incurred: 2100, paid: 2100, reserved: 0 }],
    "POL-2026-0376": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-15", incurred: 2720, paid: 2720, reserved: 0 }],
    "POL-2026-0378": [{ type: "Theft", status: "Closed", reportedOn: "2026-07-14", incurred: 5100, paid: 5100, reserved: 0 }],
    "POL-2026-0380": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-09", incurred: 2900, paid: 2900, reserved: 0 }],
    "POL-2026-0386": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-04-03", incurred: 148860, paid: 148860, reserved: 0 }, { type: "Theft in transit", status: "Closed", reportedOn: "2026-06-09", incurred: 203940, paid: 203940, reserved: 0 }],
    "POL-2026-0395": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-03-15", incurred: 7950, paid: 7950, reserved: 0 }, { type: "Fire", status: "Closed", reportedOn: "2026-08-03", incurred: 9700, paid: 9700, reserved: 0 }],
    "POL-2026-0398": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-08", incurred: 170790, paid: 170790, reserved: 0 }],
    "POL-2026-0407": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2025-11-11", incurred: 178830, paid: 178830, reserved: 0 }],
    "POL-2026-0412": [{ type: "Water damage", status: "Open", reportedOn: "2025-12-23", incurred: 212740, paid: 41040, reserved: 171700 }],
    "POL-2026-0413": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-06-04", incurred: 104520, paid: 104520, reserved: 0 }],
    "POL-2026-0415": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-06-20", incurred: 7110, paid: 7110, reserved: 0 }],
    "POL-2026-0423": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-06-14", incurred: 400, paid: 400, reserved: 0 }],
    "POL-2026-0429": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-01", incurred: 2310, paid: 2310, reserved: 0 }],
    "POL-2026-0430": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-08-15", incurred: 5000, paid: 2420, reserved: 2580 }],
    "POL-2026-0436": [{ type: "Theft", status: "Closed", reportedOn: "2025-12-06", incurred: 4290, paid: 4290, reserved: 0 }],
    "POL-2026-0439": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2025-12-01", incurred: 301110, paid: 301110, reserved: 0 }, { type: "Inpatient treatment", status: "Open", reportedOn: "2026-02-28", incurred: 216780, paid: 50920, reserved: 165860 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-03-17", incurred: 360790, paid: 360790, reserved: 0 }],
    "POL-2026-0441": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-04-29", incurred: 311470, paid: 311470, reserved: 0 }],
    "POL-2026-0442": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-08-19", incurred: 1340, paid: 1340, reserved: 0 }, { type: "Hail damage", status: "Closed", reportedOn: "2026-08-19", incurred: 1370, paid: 1370, reserved: 0 }, { type: "Hail damage", status: "Closed", reportedOn: "2026-08-19", incurred: 1970, paid: 1970, reserved: 0 }],
    "POL-2026-0443": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-01-04", incurred: 1200, paid: 1200, reserved: 0 }],
    "POL-2026-0444": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-20", incurred: 4610, paid: 4610, reserved: 0 }],
    "POL-2026-0449": [{ type: "Fire", status: "Closed", reportedOn: "2026-04-09", incurred: 225400, paid: 225400, reserved: 0 }],
    "POL-2026-0450": [{ type: "Storm damage", status: "Closed", reportedOn: "2026-07-19", incurred: 34020, paid: 34020, reserved: 0 }],
    "POL-2026-0451": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-06-23", incurred: 48850, paid: 48850, reserved: 0 }],
    "POL-2026-0453": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-06-19", incurred: 209020, paid: 209020, reserved: 0 }, { type: "Chronic condition management", status: "Closed", reportedOn: "2026-07-30", incurred: 138310, paid: 138310, reserved: 0 }],
    "POL-2026-0454": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-26", incurred: 1880, paid: 1880, reserved: 0 }],
    "POL-2026-0460": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-13", incurred: 440, paid: 440, reserved: 0 }],
    "POL-2026-0461": [{ type: "Water damage", status: "Open", reportedOn: "2026-05-26", incurred: 499570, paid: 288380, reserved: 211190 }],
    "POL-2026-0462": [{ type: "Storm damage", status: "Closed", reportedOn: "2026-05-28", incurred: 263450, paid: 263450, reserved: 0 }, { type: "Fire", status: "Closed", reportedOn: "2026-06-14", incurred: 234490, paid: 234490, reserved: 0 }],
    "POL-2026-0464": [{ type: "Theft", status: "Closed", reportedOn: "2026-02-23", incurred: 2620, paid: 2620, reserved: 0 }, { type: "Windshield damage", status: "Closed", reportedOn: "2026-07-15", incurred: 1850, paid: 1850, reserved: 0 }],
    "POL-2026-0465": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-25", incurred: 5000, paid: 5000, reserved: 0 }],
    "POL-2026-0468": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-07-05", incurred: 204580, paid: 204580, reserved: 0 }],
    "POL-2026-0469": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-01-31", incurred: 233640, paid: 233640, reserved: 0 }],
    "POL-2026-0470": [{ type: "Storm damage", status: "Open", reportedOn: "2026-06-29", incurred: 74580, paid: 24620, reserved: 49960 }],
    "POL-2026-0475": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-07-31", incurred: 313580, paid: 313580, reserved: 0 }, { type: "Machinery breakdown", status: "Open", reportedOn: "2026-08-02", incurred: 274130, paid: 142920, reserved: 131210 }, { type: "Machinery breakdown", status: "Closed", reportedOn: "2026-08-12", incurred: 269410, paid: 269410, reserved: 0 }],
    "POL-2026-0477": [{ type: "Fire", status: "Open", reportedOn: "2026-03-05", incurred: 220800, paid: 120580, reserved: 100220 }],
    "POL-2026-0480": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-06-27", incurred: 257320, paid: 257320, reserved: 0 }],
    "POL-2026-0481": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-08-06", incurred: 200190, paid: 200190, reserved: 0 }],
    "POL-2026-0484": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-03-30", incurred: 71860, paid: 71860, reserved: 0 }],
    "POL-2026-0488": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-03-02", incurred: 3020, paid: 1250, reserved: 1770 }, { type: "Windshield damage", status: "Closed", reportedOn: "2026-03-24", incurred: 1510, paid: 1510, reserved: 0 }],
    "POL-2026-0491": [{ type: "Machinery breakdown", status: "Open", reportedOn: "2026-06-07", incurred: 96590, paid: 46760, reserved: 49830 }],
    "POL-2026-0492": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-27", incurred: 206910, paid: 206910, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2026-08-03", incurred: 111240, paid: 111240, reserved: 0 }],
    "POL-2026-0495": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-17", incurred: 1320, paid: 1320, reserved: 0 }],
    "POL-2026-0498": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-01-27", incurred: 161790, paid: 161790, reserved: 0 }],
    "POL-2026-0499": [{ type: "Water intrusion", status: "Closed", reportedOn: "2026-06-01", incurred: 117520, paid: 117520, reserved: 0 }, { type: "Cargo damage", status: "Closed", reportedOn: "2026-08-09", incurred: 110280, paid: 110280, reserved: 0 }],
    "POL-2026-0501": [{ type: "Water intrusion", status: "Closed", reportedOn: "2025-11-19", incurred: 137170, paid: 137170, reserved: 0 }],
    "POL-2026-0502": [{ type: "Water intrusion", status: "Closed", reportedOn: "2026-05-26", incurred: 165120, paid: 165120, reserved: 0 }],
    "POL-2026-0505": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-16", incurred: 3320, paid: 3320, reserved: 0 }, { type: "Hail damage", status: "Closed", reportedOn: "2026-05-19", incurred: 4050, paid: 4050, reserved: 0 }],
    "POL-2026-0507": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-05-25", incurred: 2550, paid: 2550, reserved: 0 }],
    "POL-2026-0508": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-08-10", incurred: 340560, paid: 340560, reserved: 0 }],
    "POL-2026-0509": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-06-11", incurred: 4910, paid: 4910, reserved: 0 }],
    "POL-2026-0510": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-06", incurred: 1450, paid: 1450, reserved: 0 }],
    "POL-2026-0511": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-07-25", incurred: 145580, paid: 145580, reserved: 0 }],
    "POL-2026-0512": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-27", incurred: 3850, paid: 3850, reserved: 0 }],
    "POL-2026-0513": [{ type: "Windshield damage", status: "Open", reportedOn: "2025-11-17", incurred: 2520, paid: 760, reserved: 1760 }],
    "POL-2026-0519": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-04-17", incurred: 5640, paid: 5640, reserved: 0 }],
    "POL-2026-0521": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-02-15", incurred: 3950, paid: 3950, reserved: 0 }],
    "POL-2026-0522": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-01-27", incurred: 192230, paid: 90670, reserved: 101560 }],
    "POL-2026-0523": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-03-02", incurred: 4130, paid: 4130, reserved: 0 }, { type: "Hail damage", status: "Closed", reportedOn: "2026-04-08", incurred: 3110, paid: 3110, reserved: 0 }],
    "POL-2026-0524": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-06", incurred: 1570, paid: 1570, reserved: 0 }],
    "POL-2026-0527": [{ type: "Hail damage", status: "Closed", reportedOn: "2025-12-01", incurred: 6890, paid: 6890, reserved: 0 }],
    "POL-2026-0528": [{ type: "Cargo damage", status: "Open", reportedOn: "2026-08-09", incurred: 25900, paid: 13480, reserved: 12420 }],
    "POL-2026-0530": [{ type: "Water intrusion", status: "Closed", reportedOn: "2026-05-26", incurred: 234000, paid: 234000, reserved: 0 }],
    "POL-2026-0531": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-28", incurred: 4490, paid: 4490, reserved: 0 }],
    "POL-2026-0540": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-05-30", incurred: 5710, paid: 1380, reserved: 4330 }],
    "POL-2026-0548": [{ type: "Inpatient treatment", status: "Open", reportedOn: "2026-08-01", incurred: 188980, paid: 43630, reserved: 145350 }],
    "POL-2026-0549": [{ type: "Collision", status: "Closed", reportedOn: "2026-07-26", incurred: 1810, paid: 1810, reserved: 0 }],
    "POL-2026-0557": [{ type: "Water intrusion", status: "Closed", reportedOn: "2026-07-20", incurred: 8250, paid: 8250, reserved: 0 }],
    "POL-2026-0560": [{ type: "Death benefit", status: "Closed", reportedOn: "2025-10-30", incurred: 280, paid: 280, reserved: 0 }, { type: "Death benefit", status: "Closed", reportedOn: "2026-03-16", incurred: 650, paid: 650, reserved: 0 }, { type: "Death benefit", status: "Closed", reportedOn: "2026-05-12", incurred: 390, paid: 390, reserved: 0 }],
    "POL-2026-0562": [{ type: "Hail damage", status: "Open", reportedOn: "2026-06-04", incurred: 2520, paid: 1310, reserved: 1210 }],
    "POL-2026-0566": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-05-10", incurred: 6320, paid: 6320, reserved: 0 }],
    "POL-2026-0567": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-27", incurred: 1330, paid: 1330, reserved: 0 }],
    "POL-2026-0576": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-01-19", incurred: 364370, paid: 364370, reserved: 0 }],
    "POL-2026-0579": [{ type: "Fire", status: "Open", reportedOn: "2026-04-14", incurred: 1760, paid: 650, reserved: 1110 }],
    "POL-2026-0583": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2025-11-06", incurred: 231960, paid: 231960, reserved: 0 }],
    "POL-2026-0585": [{ type: "Death benefit", status: "Open", reportedOn: "2026-05-14", incurred: 3520, paid: 1290, reserved: 2230 }],
    "POL-2026-0594": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-10", incurred: 2890, paid: 2890, reserved: 0 }],
    "POL-2026-0603": [{ type: "Water damage", status: "Closed", reportedOn: "2026-03-17", incurred: 274850, paid: 274850, reserved: 0 }],
    "POL-2026-0604": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-01-18", incurred: 227820, paid: 227820, reserved: 0 }],
    "POL-2026-0606": [{ type: "Fire", status: "Closed", reportedOn: "2026-03-13", incurred: 262520, paid: 262520, reserved: 0 }],
    "POL-2026-0609": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-02-21", incurred: 288720, paid: 288720, reserved: 0 }, { type: "Surgical procedure", status: "Open", reportedOn: "2026-07-16", incurred: 181370, paid: 104630, reserved: 76740 }],
    "POL-2026-0611": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-06-23", incurred: 198160, paid: 198160, reserved: 0 }],
    "POL-2026-0613": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-07-25", incurred: 114250, paid: 114250, reserved: 0 }],
    "POL-2026-0619": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-05-09", incurred: 1620, paid: 1620, reserved: 0 }],
    "POL-2026-0621": [{ type: "Water damage", status: "Open", reportedOn: "2026-04-08", incurred: 3590, paid: 1110, reserved: 2480 }],
    "POL-2026-0622": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-03-12", incurred: 2570, paid: 2570, reserved: 0 }],
    "POL-2026-0625": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-03-14", incurred: 32770, paid: 32770, reserved: 0 }],
    "POL-2026-0627": [{ type: "Collision", status: "Closed", reportedOn: "2026-07-21", incurred: 2340, paid: 2340, reserved: 0 }],
    "POL-2026-0630": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-02-12", incurred: 3060, paid: 3060, reserved: 0 }],
    "POL-2026-0640": [{ type: "Theft in transit", status: "Closed", reportedOn: "2025-12-12", incurred: 126930, paid: 126930, reserved: 0 }],
    "POL-2026-0645": [{ type: "Theft", status: "Closed", reportedOn: "2026-04-26", incurred: 1140, paid: 1140, reserved: 0 }, { type: "Windshield damage", status: "Closed", reportedOn: "2026-05-17", incurred: 1530, paid: 1530, reserved: 0 }],
    "POL-2026-0647": [{ type: "Fire", status: "Closed", reportedOn: "2026-02-03", incurred: 6960, paid: 6960, reserved: 0 }],
    "POL-2026-0659": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-08-11", incurred: 13310, paid: 13310, reserved: 0 }],
    "POL-2026-0661": [{ type: "Water damage", status: "Closed", reportedOn: "2026-02-03", incurred: 28110, paid: 28110, reserved: 0 }],
    "POL-2026-0675": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-05-26", incurred: 3250, paid: 3250, reserved: 0 }],
    "POL-2026-0677": [{ type: "Water intrusion", status: "Open", reportedOn: "2026-01-28", incurred: 117340, paid: 61880, reserved: 55460 }],
    "POL-2026-0680": [{ type: "Fire", status: "Open", reportedOn: "2026-03-07", incurred: 8150, paid: 3740, reserved: 4410 }, { type: "Wind damage", status: "Open", reportedOn: "2026-07-12", incurred: 5550, paid: 2640, reserved: 2910 }],
    "POL-2026-0685": [{ type: "Inpatient treatment", status: "Open", reportedOn: "2026-03-04", incurred: 152370, paid: 65140, reserved: 87230 }],
    "POL-2026-0696": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-06-10", incurred: 286810, paid: 286810, reserved: 0 }],
    "POL-2026-0703": [{ type: "Theft in transit", status: "Closed", reportedOn: "2025-12-14", incurred: 5390, paid: 5390, reserved: 0 }, { type: "Water intrusion", status: "Closed", reportedOn: "2026-07-09", incurred: 6440, paid: 6440, reserved: 0 }],
    "POL-2026-0708": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-04-27", incurred: 520, paid: 520, reserved: 0 }],
    "POL-2026-0711": [{ type: "Water damage", status: "Closed", reportedOn: "2026-05-02", incurred: 288840, paid: 288840, reserved: 0 }],
    "POL-2026-0727": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-02", incurred: 4450, paid: 4450, reserved: 0 }],
    "POL-2026-0729": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-03-26", incurred: 291070, paid: 291070, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2026-04-28", incurred: 301290, paid: 301290, reserved: 0 }],
    "POL-2026-0734": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-01-11", incurred: 42550, paid: 42550, reserved: 0 }],
    "POL-2026-0740": [{ type: "Death benefit", status: "Closed", reportedOn: "2025-12-15", incurred: 1390, paid: 1390, reserved: 0 }, { type: "Death benefit", status: "Open", reportedOn: "2026-06-08", incurred: 970, paid: 160, reserved: 810 }],
    "POL-2026-0752": [{ type: "Chronic condition management", status: "Open", reportedOn: "2026-05-02", incurred: 159530, paid: 78870, reserved: 80660 }],
    "POL-2026-0757": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-02-27", incurred: 2370, paid: 2370, reserved: 0 }],
    "POL-2026-0760": [{ type: "Collision", status: "Closed", reportedOn: "2025-10-13", incurred: 5050, paid: 5050, reserved: 0 }],
    "POL-2026-0764": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-30", incurred: 1210, paid: 1210, reserved: 0 }],
    "POL-2026-0765": [{ type: "Collision", status: "Closed", reportedOn: "2026-08-02", incurred: 2290, paid: 2290, reserved: 0 }],
    "POL-2026-0769": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-03-17", incurred: 70060, paid: 70060, reserved: 0 }],
    "POL-2026-0781": [{ type: "Storm damage", status: "Closed", reportedOn: "2025-09-23", incurred: 264050, paid: 264050, reserved: 0 }],
    "POL-2026-0792": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-16", incurred: 4310, paid: 4310, reserved: 0 }],
    "POL-2026-0795": [{ type: "Death benefit", status: "Open", reportedOn: "2026-01-25", incurred: 2840, paid: 1210, reserved: 1630 }],
    "POL-2026-0804": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-05-27", incurred: 329630, paid: 329630, reserved: 0 }],
    "POL-2026-0820": [{ type: "Fire", status: "Closed", reportedOn: "2026-01-19", incurred: 2590, paid: 2590, reserved: 0 }],
    "POL-2026-0829": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-12", incurred: 250, paid: 250, reserved: 0 }],
    "POL-2026-0836": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-12", incurred: 1220, paid: 1220, reserved: 0 }],
    "POL-2026-0843": [{ type: "Theft", status: "Closed", reportedOn: "2026-03-01", incurred: 4750, paid: 4750, reserved: 0 }],
    "POL-2026-0844": [{ type: "Theft", status: "Closed", reportedOn: "2026-03-18", incurred: 2970, paid: 2970, reserved: 0 }],
    "POL-2026-0846": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-03-29", incurred: 1620, paid: 1620, reserved: 0 }],
    "POL-2026-0847": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-16", incurred: 1040, paid: 1040, reserved: 0 }],
    "POL-2026-0856": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-01-18", incurred: 87110, paid: 87110, reserved: 0 }, { type: "Surgical procedure", status: "Open", reportedOn: "2026-08-02", incurred: 143920, paid: 34460, reserved: 109460 }],
    "POL-2026-0865": [{ type: "Collision", status: "Closed", reportedOn: "2026-04-15", incurred: 4980, paid: 4980, reserved: 0 }],
    "POL-2026-0876": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-18", incurred: 6550, paid: 6550, reserved: 0 }],
    "POL-2026-0880": [{ type: "Fire", status: "Open", reportedOn: "2026-05-27", incurred: 1610, paid: 810, reserved: 800 }],
    "POL-2026-0881": [{ type: "Water damage", status: "Closed", reportedOn: "2026-04-28", incurred: 115300, paid: 115300, reserved: 0 }],
    "POL-2026-0891": [{ type: "Water damage", status: "Closed", reportedOn: "2025-11-12", incurred: 260470, paid: 260470, reserved: 0 }],
    "POL-2026-0899": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-08-03", incurred: 2740, paid: 2740, reserved: 0 }],
    "POL-2026-0900": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-08-18", incurred: 7240, paid: 7240, reserved: 0 }],
    "POL-2026-0903": [{ type: "Water damage", status: "Closed", reportedOn: "2026-07-26", incurred: 56470, paid: 56470, reserved: 0 }],
    "POL-2026-0907": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-02-06", incurred: 77570, paid: 77570, reserved: 0 }],
    "POL-2026-0921": [{ type: "Collision", status: "Closed", reportedOn: "2026-08-16", incurred: 3090, paid: 3090, reserved: 0 }],
    "POL-2026-0922": [{ type: "Theft", status: "Closed", reportedOn: "2026-07-02", incurred: 5520, paid: 5520, reserved: 0 }],
    "POL-2026-0930": [{ type: "Water damage", status: "Closed", reportedOn: "2026-01-09", incurred: 1550, paid: 1550, reserved: 0 }],
    "POL-2026-0931": [{ type: "Fire", status: "Open", reportedOn: "2026-03-04", incurred: 1120, paid: 520, reserved: 600 }],
    "POL-2026-0935": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-29", incurred: 175110, paid: 175110, reserved: 0 }],
    "POL-2026-0940": [{ type: "Water damage", status: "Closed", reportedOn: "2026-03-05", incurred: 239140, paid: 239140, reserved: 0 }],
    "POL-2026-0944": [{ type: "Collision", status: "Closed", reportedOn: "2026-07-26", incurred: 4600, paid: 4600, reserved: 0 }],
    "POL-2026-0949": [{ type: "Theft", status: "Closed", reportedOn: "2026-08-14", incurred: 6100, paid: 6100, reserved: 0 }],
    "POL-2026-0958": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-07", incurred: 4180, paid: 4180, reserved: 0 }],
    "POL-2026-0959": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-04-18", incurred: 277180, paid: 277180, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2026-06-17", incurred: 200810, paid: 200810, reserved: 0 }],
    "POL-2026-0968": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-01-09", incurred: 220990, paid: 220990, reserved: 0 }, { type: "Surgical procedure", status: "Closed", reportedOn: "2026-06-20", incurred: 188810, paid: 188810, reserved: 0 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-10", incurred: 167080, paid: 167080, reserved: 0 }],
    "POL-2026-0975": [{ type: "Water intrusion", status: "Closed", reportedOn: "2026-08-02", incurred: 24040, paid: 24040, reserved: 0 }],
    "POL-2026-0976": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-08-07", incurred: 1310, paid: 1310, reserved: 0 }],
    "POL-2026-0991": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-16", incurred: 500, paid: 500, reserved: 0 }],
    "POL-2026-0999": [{ type: "Water damage", status: "Open", reportedOn: "2026-06-29", incurred: 2390, paid: 440, reserved: 1950 }],
    "POL-2026-1000": [{ type: "Theft", status: "Open", reportedOn: "2026-06-26", incurred: 1520, paid: 530, reserved: 990 }],
    "POL-2026-1004": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-30", incurred: 181290, paid: 181290, reserved: 0 }],
    "POL-2026-1009": [{ type: "Water damage", status: "Closed", reportedOn: "2026-03-30", incurred: 9060, paid: 9060, reserved: 0 }, { type: "Fire", status: "Closed", reportedOn: "2026-04-23", incurred: 7940, paid: 7940, reserved: 0 }],
    "POL-2026-1010": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-01-24", incurred: 1860, paid: 1860, reserved: 0 }],
    "POL-2026-1014": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-27", incurred: 88050, paid: 88050, reserved: 0 }],
    "POL-2026-1018": [{ type: "Water intrusion", status: "Closed", reportedOn: "2025-12-10", incurred: 71710, paid: 71710, reserved: 0 }, { type: "Water intrusion", status: "Open", reportedOn: "2026-05-06", incurred: 93620, paid: 18980, reserved: 74640 }],
    "POL-2026-1024": [{ type: "Water intrusion", status: "Closed", reportedOn: "2025-11-05", incurred: 66900, paid: 66900, reserved: 0 }],
    "POL-2026-1039": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-06-08", incurred: 185910, paid: 185910, reserved: 0 }],
    "POL-2026-1040": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-08-10", incurred: 3330, paid: 3330, reserved: 0 }],
    "POL-2026-1042": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-26", incurred: 1600, paid: 1600, reserved: 0 }, { type: "Hail damage", status: "Closed", reportedOn: "2026-07-18", incurred: 2880, paid: 2880, reserved: 0 }],
    "POL-2026-1044": [{ type: "Windshield damage", status: "Closed", reportedOn: "2026-02-28", incurred: 1870, paid: 1870, reserved: 0 }],
    "POL-2026-1049": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2025-12-09", incurred: 106180, paid: 106180, reserved: 0 }],
    "POL-2026-1050": [{ type: "Water damage", status: "Open", reportedOn: "2026-04-21", incurred: 163620, paid: 39730, reserved: 123890 }],
    "POL-2026-1056": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-02-19", incurred: 82670, paid: 82670, reserved: 0 }],
    "POL-2026-1061": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-04-22", incurred: 190080, paid: 190080, reserved: 0 }],
    "POL-2026-1064": [{ type: "Storm damage", status: "Closed", reportedOn: "2026-01-20", incurred: 55240, paid: 55240, reserved: 0 }],
    "POL-2026-1066": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-14", incurred: 1210, paid: 1210, reserved: 0 }],
    "POL-2026-1067": [{ type: "Water damage", status: "Open", reportedOn: "2026-01-31", incurred: 102290, paid: 20230, reserved: 82060 }],
    "POL-2026-1079": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-03-22", incurred: 108000, paid: 108000, reserved: 0 }, { type: "Inpatient treatment", status: "Closed", reportedOn: "2026-08-12", incurred: 46760, paid: 46760, reserved: 0 }],
    "POL-2026-1082": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-07-27", incurred: 272820, paid: 272820, reserved: 0 }],
    "POL-2026-1089": [{ type: "Machinery breakdown", status: "Open", reportedOn: "2026-07-15", incurred: 54860, paid: 18360, reserved: 36500 }],
    "POL-2026-1092": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-07-30", incurred: 1290, paid: 1290, reserved: 0 }],
    "POL-2026-1096": [{ type: "Surgical procedure", status: "Open", reportedOn: "2025-10-01", incurred: 263610, paid: 53960, reserved: 209650 }],
    "POL-2026-1102": [{ type: "Hail damage", status: "Closed", reportedOn: "2025-11-07", incurred: 4440, paid: 4440, reserved: 0 }, { type: "Theft", status: "Closed", reportedOn: "2025-11-13", incurred: 8520, paid: 8520, reserved: 0 }],
    "POL-2026-1103": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-28", incurred: 102810, paid: 102810, reserved: 0 }],
    "POL-2026-1104": [{ type: "Theft in transit", status: "Closed", reportedOn: "2026-05-22", incurred: 151910, paid: 151910, reserved: 0 }],
    "POL-2026-1105": [{ type: "Water damage", status: "Closed", reportedOn: "2026-04-04", incurred: 3350, paid: 3350, reserved: 0 }],
    "POL-2026-1109": [{ type: "Water damage", status: "Open", reportedOn: "2026-04-27", incurred: 33970, paid: 20370, reserved: 13600 }],
    "POL-2026-1116": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-07-08", incurred: 6210, paid: 6210, reserved: 0 }],
    "POL-2026-1121": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-02-28", incurred: 1800, paid: 1800, reserved: 0 }],
    "POL-2026-1123": [{ type: "Fire", status: "Open", reportedOn: "2026-02-26", incurred: 7030, paid: 3080, reserved: 3950 }, { type: "Theft", status: "Open", reportedOn: "2026-04-26", incurred: 7790, paid: 3300, reserved: 4490 }, { type: "Theft", status: "Closed", reportedOn: "2026-07-28", incurred: 3410, paid: 3410, reserved: 0 }],
    "POL-2026-1129": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-04-28", incurred: 120240, paid: 59320, reserved: 60920 }],
    "POL-2026-1140": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-01-06", incurred: 301680, paid: 301680, reserved: 0 }],
  };
  PAS.CLAIMS_BY_ID = CLAIMS_BY_ID;

  /* ---------- connected carriers: a real multi-carrier data model ----------
     Veridex is the MGA; it doesn't carry risk itself, it places business with the carrier
     partner that has appetite for that line — the mechanism a real "modular architecture that
     consumes data/services from connected carriers" would be built on. Each product line is
     placed with exactly one partner (a real MGA's paper is split by appetite, not at random),
     so `p.carrier` is a genuine second dimension to segment the book by — this is what makes the
     Carrier role's dashboard actually scope to "my own book" instead of the whole portfolio. */
  var PRODUCT_CARRIER = {
    "Commercial Property": "Meridian Assurance Co.", "Marine Cargo": "Meridian Assurance Co.",
    "Comprehensive Auto": "Apex General Insurance", "Home Owners": "Apex General Insurance",
    "Term Life": "Horizon Life & Health", "Group Health": "Horizon Life & Health",
  };
  PAS.PRODUCT_CARRIER = PRODUCT_CARRIER;
  PAS.CARRIERS = ["Meridian Assurance Co.", "Apex General Insurance", "Horizon Life & Health"];

  /* ---------- brokers: individuals and agencies are both real producers ----------
     A producer of record is either a licensed individual or an agency/brokerage — the same
     license-type distinction NIPR's NPN registry makes. `PAS.BROKERS` carries that type so the
     dashboard filter can show it, not just a flat name list. "Direct" isn't a producer at all
     (no broker of record placed the business), so it gets its own type rather than being
     mislabeled Individual or Organization. */
  PAS.BROKERS = [
    { name: "Apex Insurance Brokers", type: "Organization" },
    { name: "Meridian Risk Partners", type: "Organization" },
    { name: "Diane Kowalski", type: "Individual" },
    { name: "Trevor Osei", type: "Individual" },
    { name: "Direct", type: "Direct" },
  ];
  var BROKER_TYPE = {};
  PAS.BROKERS.forEach(function (b) { BROKER_TYPE[b.name] = b.type; });
  PAS.BROKER_TYPE = BROKER_TYPE;

  /* ---------- MGA facilities: a third, genuinely independent dimension ----------
     Broker (`producer`) is who placed the business; Carrier is whose paper it's written on.
     MGA is the wholesale facility with the binding authority in between — distinct from both.
     Real wholesale distribution has both agency-style facilities and individual MGAs holding
     their own binding authority, so `PAS.MGAS` carries a type the same way `PAS.BROKERS` does.
     Assignment is by the risk's own state region for the agency facilities (a real facility's
     appetite is usually regional) with a deterministic slice of policies (~18%, by a stable hash
     of the policy id so it's reproducible without a giant static map) routed to one of the two
     individual MGAs instead — a genuine mix, not just the region lookup relabeled. Every state
     in the seed book falls into exactly one region below; unmapped states fall back to the first
     facility rather than throwing. */
  var STATE_REGION = {
    Maine: "Northeast", Massachusetts: "Northeast", "New Jersey": "Northeast", "New York": "Northeast",
    Pennsylvania: "Northeast", Vermont: "Northeast", Connecticut: "Northeast", "New Hampshire": "Northeast", "Rhode Island": "Northeast",
    Illinois: "Midwest", Indiana: "Midwest", Michigan: "Midwest", Minnesota: "Midwest", Missouri: "Midwest",
    Ohio: "Midwest", Wisconsin: "Midwest", Iowa: "Midwest", Kansas: "Midwest", Nebraska: "Midwest", "North Dakota": "Midwest", "South Dakota": "Midwest",
    Alabama: "South", Florida: "South", Georgia: "South", Kentucky: "South", Louisiana: "South",
    "North Carolina": "South", "South Carolina": "South", Tennessee: "South", Texas: "South", Virginia: "South",
    Arkansas: "South", Mississippi: "South", Oklahoma: "South", "West Virginia": "South", Delaware: "South", Maryland: "South",
    Arizona: "West", California: "West", Colorado: "West", Nevada: "West", Oregon: "West", Utah: "West", Washington: "West",
    Idaho: "West", Montana: "West", Wyoming: "West", "New Mexico": "West", Alaska: "West", Hawaii: "West",
  };
  var REGION_MGA = {
    Northeast: "Cornerstone MGA Partners", Midwest: "Heartland Underwriting Agency",
    South: "Palmetto Risk Managers", West: "Summit Peak MGA Group",
  };
  var INDIVIDUAL_MGAS = ["Foster Langley", "Renata Solis"];
  PAS.MGAS = [
    { name: "Cornerstone MGA Partners", type: "Organization" },
    { name: "Heartland Underwriting Agency", type: "Organization" },
    { name: "Palmetto Risk Managers", type: "Organization" },
    { name: "Summit Peak MGA Group", type: "Organization" },
    { name: "Foster Langley", type: "Individual" },
    { name: "Renata Solis", type: "Individual" },
  ];
  var MGA_TYPE = {};
  PAS.MGAS.forEach(function (m) { MGA_TYPE[m.name] = m.type; });
  PAS.MGA_TYPE = MGA_TYPE;
  function hash32(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function mgaForPolicy(p) {
    var h = hash32(p.id);
    if (h % 100 < 18) return INDIVIDUAL_MGAS[h % INDIVIDUAL_MGAS.length];
    return REGION_MGA[STATE_REGION[p.state]] || PAS.MGAS[0].name;
  }
  PAS.mgaForPolicy = mgaForPolicy;

  /* ---------- configurable terms & conditions, per product ----------
     Illustrative standard clauses per product line — real insurance clause *categories*, generic
     placeholder text (not any real insurer's actual policy wording). What makes this genuinely
     "configurable" rather than static copy is that every clause is editable and the edit persists
     — PAS.updateTermClause / PAS.resetTermClause below, backed by their own sessionStorage key so
     an edit survives navigation the same way a policy decision does. */
  var TERMS_TEMPLATE = {
    "Home Owners": [
      { id: "wear-tear", title: "Wear and tear exclusion", text: "Gradual deterioration, wear and tear, and damage from lack of maintenance are excluded from cover." },
      { id: "underinsurance", title: "Underinsurance (average) clause", text: "If the sum insured is less than the full replacement value at the time of loss, the claim is reduced in the same proportion the sum insured falls short." },
      { id: "vacancy", title: "Vacancy clause", text: "Cover is suspended for any period the property is left unoccupied beyond 30 consecutive days, unless declared and accepted in advance." },
      { id: "claim-notice", title: "Claim notice period", text: "Loss or damage must be notified within 15 days of discovery." },
    ],
    "Comprehensive Auto": [
      { id: "ncb", title: "Claims-free discount", text: "A claims-free discount applies to own-damage premium at renewal for each consecutive claim-free year, per the applicable discount tier, and is forfeited entirely on any at-fault claim in the expiring term." },
      { id: "territorial", title: "Territorial limits", text: "Cover applies only within the United States, its territories and Canada." },
      { id: "driver-clause", title: "Named driver / valid licence clause", text: "The vehicle must be driven by the insured or a named driver holding a valid, effective driver's licence at the time of loss." },
      { id: "claim-notice", title: "Claim notice period", text: "Any accident, theft or loss must be reported within 48 hours." },
    ],
    "Commercial Property": [
      { id: "bi-waiting", title: "Business interruption waiting period", text: "Business interruption cover, where attached, responds only after the first 3 days of the indemnity period." },
      { id: "average", title: "Average (underinsurance) clause", text: "Same proportional-reduction basis as Home Owners, applied to declared sums insured for building, stock and machinery separately." },
      { id: "firefighting", title: "Fire-fighting expenses", text: "Reasonable costs incurred in fire-fighting and demolition to prevent the spread of loss are covered in addition to the sum insured, up to 1% of it." },
      { id: "reinstatement-basis", title: "Sum insured basis", text: "Building and machinery are insured on a reinstatement (replacement) basis; stock is insured on an indemnity (market value) basis." },
    ],
    "Marine Cargo": [
      { id: "icc-basis", title: "Institute Cargo Clauses basis", text: "Cover is written on Institute Cargo Clauses (A), (B) or (C) as declared on the schedule, warehouse to warehouse." },
      { id: "war-srcc", title: "War & SRCC exclusion", text: "Loss caused by war, strikes, riots or civil commotion is excluded unless the corresponding Institute War/SRCC Clauses are separately bought back." },
      { id: "claim-notice", title: "Claim notice at destination", text: "Any loss apparent on delivery must be noted with the carrier immediately and notified to the insurer within 7 days." },
      { id: "duty-to-sue", title: "Duty to sue and labour", text: "The insured must take all reasonable steps to minimise loss and preserve rights of recovery against carriers or other third parties." },
    ],
    "Group Health": [
      { id: "waiting-period", title: "New-enrollee waiting period", text: "Coverage for a newly eligible employee begins on the first of the month following 60 days of continuous employment; pre-existing conditions are covered from day one, per the Affordable Care Act." },
      { id: "room-rent", title: "Deductible and out-of-pocket maximum", text: "An annual per-member deductible applies before coinsurance begins; once the member's out-of-pocket maximum is reached, the plan pays 100% of covered charges for the remainder of the plan year." },
      { id: "copay", title: "Co-payment and coinsurance clause", text: "A fixed co-payment applies per office visit, with 20% coinsurance on all other covered services after the deductible is met." },
      { id: "portability", title: "Continuation and portability rights", text: "A member losing eligibility may elect COBRA continuation coverage for up to 18 months, and enrolling in a new employer's plan triggers HIPAA special-enrollment rights regardless of the new plan's open-enrollment window." },
    ],
    "Term Life": [
      { id: "suicide", title: "Suicide exclusion clause", text: "No death benefit is payable if death by suicide occurs within 24 months of the policy's commencement or reinstatement; premiums paid are refunded instead." },
      { id: "free-look", title: "Free-look period", text: "The policy may be returned within 10 days of receipt for a full refund of premium paid, per the NAIC model minimum — some states require longer." },
      { id: "grace-period", title: "Grace period", text: "A grace period of 30 days (10 days for monthly mode) is allowed for premium payment without loss of continuity." },
      { id: "nomination", title: "Beneficiary designation", text: "The policyholder may designate or change a beneficiary at any time during the policy term by written request." },
    ],
  };
  PAS.TERMS_TEMPLATE = TERMS_TEMPLATE;

  var TERMS_KEY = "pas.terms.v1";
  function loadTermEdits() {
    var raw;
    try { raw = sessionStorage.getItem(TERMS_KEY); } catch (e) { raw = null; }
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through */ } }
    return {};
  }
  function saveTermEdits(edits) {
    try { sessionStorage.setItem(TERMS_KEY, JSON.stringify(edits)); } catch (e) { /* ignore */ }
  }
  /* The clauses a product actually has right now — template defaults with any session edit
     applied on top, plus whether each one has been edited (so the UI can show that state). */
  PAS.getTerms = function (product) {
    var edits = loadTermEdits();
    return (TERMS_TEMPLATE[product] || []).map(function (c) {
      var key = product + "::" + c.id;
      var edited = Object.prototype.hasOwnProperty.call(edits, key);
      return { id: c.id, title: c.title, text: edited ? edits[key] : c.text, defaultText: c.text, edited: edited };
    });
  };
  PAS.updateTermClause = function (product, clauseId, newText) {
    var edits = loadTermEdits();
    edits[product + "::" + clauseId] = newText;
    saveTermEdits(edits);
  };
  PAS.resetTermClause = function (product, clauseId) {
    var edits = loadTermEdits();
    delete edits[product + "::" + clauseId];
    saveTermEdits(edits);
  };

  /* Every claim across a set of policies, flattened with its parent policy attached — the shape
     every claims-aware panel iterates over. */
  function allClaims(policies) {
    var out = [];
    policies.forEach(function (p) { (p.claims || []).forEach(function (c) { out.push({ p: p, c: c }); }); });
    return out;
  }
  PAS.allClaims = allClaims;

  /* ================= the financial model =================
     Everything the dashboard reports as revenue, cost or profit comes from this one block, so
     two panels can never quote different numbers for the same thing.

     ---- Why EARNED premium, not WRITTEN premium ----
     Written premium is the whole annual premium the moment a policy incepts. Earned premium is
     only the part the insurer has actually been on risk for. A policy written last week has its
     full annual premium "written" but has earned barely any of it — so dividing claims by
     WRITTEN premium flatters the loss ratio badly on a growing book. This book is roughly half
     earned on average, so the old written-basis figure understated the true loss ratio by
     about half (it read ~57% when the earned basis says ~116%): the difference between
     "comfortably profitable" and "underwater". Loss ratio is always incurred ÷ EARNED. */

  /* A policy earns its premium evenly across its term. Lifetime basis: every completed prior
     term is fully earned, plus however much of the current term has run. termNumber is 1-based,
     so a policy in term 3 that is 40% through has earned 2.4x its annual premium over its life —
     which is the right denominator for `p.claims`, since that array is the policy's whole claim
     history, not just this term's.

     A Cancelled policy stopped being on risk on its cancellation effective date, not today — so
     the "as of" date for the current term is that date, read from the completed Cancellation
     transaction, rather than todayISO(). Without this, a policy cancelled months ago keeps
     "earning" premium all the way up to today. */
  /* The last date this policy's current term was actually on risk — today, unless it's Cancelled,
     in which case it stopped on the completed Cancellation's effective date. Shared by the
     lifetime earnedFraction below and by the period-windowed version, so "when did this term
     stop earning" is answered once. */
  function currentTermEndsOn(policy) {
    if (policy.status !== "Cancelled") return todayISO();
    var cx = (policy.history || []).filter(function (h) { return h.type === "Cancellation" && h.status === "Completed"; })
      .sort(function (a, b) { return b.seq - a.seq; })[0];
    return cx ? cx.date : todayISO();
  }
  function earnedFraction(policy) {
    var totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
    var elapsed = daysBetween(policy.effectiveDate, currentTermEndsOn(policy));
    var thisTerm = Math.max(0, Math.min(1, elapsed / totalDays));
    var priorTerms = Math.max(0, (Number(policy.termNumber) || 1) - 1);
    return priorTerms + thisTerm;
  }
  function earnedPremium(policy) { return (Number(policy.premium) || 0) * earnedFraction(policy); }
  PAS.earnedFraction = earnedFraction;
  PAS.earnedPremium = earnedPremium;

  /* Earned premium recognized strictly within [fromDate, toDate], pro-rated by day-overlap with
     the policy's CURRENT term only. Known simplification: a renewal overwrites the policy's
     effectiveDate/expirationDate/premium in place with the new term's values (see
     PAS.decideRenewal), so a policy's *prior* terms leave no dated premium on the record itself to
     reconstruct exactly what was earned in a period before the latest renewal — the same
     simplification earnedFraction above already makes by treating every prior term as fully
     earned rather than dating exactly when each was. A period entirely before the current term
     started (or after it stopped being on risk) earns this policy $0 for that period — an
     undercount for long-lived renewed policies on a period further back than their latest
     renewal, not an overcount, so this errs toward being conservative rather than wrong-high. */
  function earnedPremiumInWindow(policy, fromDate, toDate) {
    var onRiskTo = currentTermEndsOn(policy);
    var start = policy.effectiveDate > fromDate ? policy.effectiveDate : fromDate;
    var end = onRiskTo < toDate ? onRiskTo : toDate;
    if (start > end) return 0;
    var totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
    var overlapDays = daysBetween(start, end) + 1; /* inclusive on both ends */
    return (Number(policy.premium) || 0) * (overlapDays / totalDays);
  }
  PAS.earnedPremiumInWindow = earnedPremiumInWindow;

  /* The premium a given Issuance/Renewal transaction actually established — not necessarily this
     policy's current p.premium, since an OLDER renewal (relevant when a custom range reaches back
     past the latest one) wrote a smaller, since-superseded amount. Renewal transactions log their
     own newPremium; Issuance doesn't, so the term-1 premium is read off the earliest Renewal's
     previousPremium, falling back to the current premium only when the policy has never renewed
     (in which case "current" and "term 1" are the same thing). */
  function premiumEstablishedBy(policy, txn) {
    if (txn.type === "Renewal") return (txn.meta && Number(txn.meta.newPremium)) || 0;
    var renewals = (policy.history || []).filter(function (h) { return h.type === "Renewal" && h.status === "Completed"; })
      .sort(function (a, b) { return a.seq - b.seq; });
    return renewals.length ? Number(renewals[0].meta && renewals[0].meta.previousPremium) || 0 : (Number(policy.premium) || 0);
  }

  /* ---- Commission: an MGA's actual revenue ----
     Veridex is an MGA. It does NOT own the premium — that belongs to the carrier whose paper the
     risk is written on. The MGA's revenue is the COMMISSION it earns for placing and servicing
     the business, so reporting premium as "revenue" would overstate what this business actually
     earns by roughly 7x. Rates vary by line: personal lines pay more than large commercial,
     because the same percentage on a small premium has to cover the same handling cost. */
  var COMMISSION_RATES = {
    "Commercial Property": 0.15,
    "Comprehensive Auto": 0.12,
    "Marine Cargo": 0.15,
    "Group Health": 0.10,
    "Home Owners": 0.18,
    "Term Life": 0.20,
  };
  var DEFAULT_COMMISSION_RATE = 0.15;
  /* Where a broker placed the risk, they take the larger share of that commission and the MGA
     keeps the rest. Business written "Direct" has no broker to pay, so the MGA keeps all of it —
     which is why Direct business earns far more per premium dollar than brokered business, a
     real margin difference the segment table below surfaces rather than averaging away. */
  var BROKER_COMMISSION_SHARE = 0.55;
  PAS.COMMISSION_RATES = COMMISSION_RATES;
  PAS.DEFAULT_COMMISSION_RATE = DEFAULT_COMMISSION_RATE;
  PAS.BROKER_COMMISSION_SHARE = BROKER_COMMISSION_SHARE;

  function commissionRateOf(policy) {
    var r = COMMISSION_RATES[policy.product];
    return typeof r === "number" ? r : DEFAULT_COMMISSION_RATE;
  }
  function isDirect(policy) { return !policy.producer || policy.producer === "Direct"; }
  PAS.commissionRateOf = commissionRateOf;
  PAS.isDirect = isDirect;

  /* The full P&L for any set of policies. One function, so the KPI row, the segment table and
     the waterfall are mathematically incapable of disagreeing — they all read this.
     Combined ratio is the industry's profitability test: under 100% the book makes an
     underwriting profit, over 100% it loses money before any investment return. */
  function bookFinancials(policies) {
    var written = 0, earned = 0, commission = 0, brokerCommission = 0;
    policies.forEach(function (p) {
      var prem = Number(p.premium) || 0;
      var e = earnedPremium(p);
      var rate = commissionRateOf(p);
      written += prem;
      earned += e;
      /* Commission is earned as the premium is earned, not banked up-front — the same accrual
         basis as the loss ratio, so revenue and losses are always measured over one period. */
      var comm = e * rate;
      commission += comm;
      if (!isDirect(p)) brokerCommission += comm * BROKER_COMMISSION_SHARE;
    });
    var claims = allClaims(policies);
    var incurred = claims.reduce(function (s, x) { return s + (Number(x.c.incurred) || 0); }, 0);
    var paid = claims.reduce(function (s, x) { return s + (Number(x.c.paid) || 0); }, 0);
    var reserved = claims.filter(function (x) { return x.c.status === "Open"; })
      .reduce(function (s, x) { return s + (Number(x.c.reserved) || 0); }, 0);

    var lr = earned ? incurred / earned : 0;
    /* Expense ratio here is ACQUISITION cost only — the commission paid away to put the business
       on the books. It deliberately excludes the carrier's own overhead, which this system has
       no data for. So the combined ratio below is a FLOOR: the real one is higher by whatever
       opex the carrier carries. Stated plainly rather than quietly passed off as complete. */
    var er = earned ? commission / earned : 0;
    return {
      policies: policies.length,
      writtenPremium: written,
      earnedPremium: earned,
      unearnedPremium: Math.max(0, written - earned),
      commission: commission,
      brokerCommission: brokerCommission,
      netCommission: commission - brokerCommission,
      claimCount: claims.length,
      openClaimCount: claims.filter(function (x) { return x.c.status === "Open"; }).length,
      incurred: incurred,
      paid: paid,
      reserved: reserved,
      lossRatio: lr,
      paidLossRatio: earned ? paid / earned : 0,
      expenseRatio: er,
      combinedRatio: lr + er,
      /* The money answer, not just a percentage: what this business actually made or lost. */
      underwritingResult: earned - incurred - commission,
    };
  }
  PAS.bookFinancials = bookFinancials;

  /* Same shape as bookFinancials, but as a period FLOW instead of an as-of-today snapshot: earned
     premium/commission is only the slice actually earned within [fromDate,toDate] (see
     earnedPremiumInWindow), written premium is only business actually issued or renewed within
     the window (read off each Issuance/completed-Renewal transaction's own dated premium, not
     today's p.premium), and claims count only those reported within the window. This is what
     drives the dashboard's period toggle for the Financial performance section — bookFinancials
     itself stays an as-of-today view for every other caller (Broker/MGA/Reinsurer/policy-detail),
     which is a deliberately different question ("how healthy is this book right now") from this
     one ("what did this book do in August"). */
  function bookFinancialsInWindow(policies, fromDate, toDate) {
    var written = 0, earned = 0, commission = 0, brokerCommission = 0;
    policies.forEach(function (p) {
      var e = earnedPremiumInWindow(p, fromDate, toDate);
      var rate = commissionRateOf(p);
      earned += e;
      var comm = e * rate;
      commission += comm;
      if (!isDirect(p)) brokerCommission += comm * BROKER_COMMISSION_SHARE;
      (p.history || []).forEach(function (h) {
        var isWriteEvent = h.type === "Issuance" ? h.status === "Completed" : (h.type === "Renewal" && h.status === "Completed");
        if (isWriteEvent && h.date >= fromDate && h.date <= toDate) written += premiumEstablishedBy(p, h);
      });
    });
    var claims = allClaims(policies).filter(function (x) { return x.c.reportedOn >= fromDate && x.c.reportedOn <= toDate; });
    var incurred = claims.reduce(function (s, x) { return s + (Number(x.c.incurred) || 0); }, 0);
    var paid = claims.reduce(function (s, x) { return s + (Number(x.c.paid) || 0); }, 0);
    var reserved = claims.filter(function (x) { return x.c.status === "Open"; })
      .reduce(function (s, x) { return s + (Number(x.c.reserved) || 0); }, 0);

    var lr = earned ? incurred / earned : 0;
    var er = earned ? commission / earned : 0;
    return {
      policies: policies.length,
      writtenPremium: written,
      earnedPremium: earned,
      unearnedPremium: Math.max(0, written - earned),
      commission: commission,
      brokerCommission: brokerCommission,
      netCommission: commission - brokerCommission,
      claimCount: claims.length,
      openClaimCount: claims.filter(function (x) { return x.c.status === "Open"; }).length,
      incurred: incurred,
      paid: paid,
      reserved: reserved,
      lossRatio: lr,
      paidLossRatio: earned ? paid / earned : 0,
      expenseRatio: er,
      combinedRatio: lr + er,
      underwritingResult: earned - incurred - commission,
    };
  }
  PAS.bookFinancialsInWindow = bookFinancialsInWindow;

  /* Loss ratio: incurred ÷ EARNED premium, across whatever set of policies is passed in — the
     caller decides the denominator (the whole book, one state, one LOB) by filtering first. */
  function lossRatio(policies) { return bookFinancials(policies).lossRatio; }
  PAS.lossRatio = lossRatio;

  /* ---- Which policies belong in a financial view ----
     Only business that actually went on risk. A Referred or Declined submission never attached,
     and a Bound policy has not incepted yet, so none of them have earned a rupee or could have
     had a claim — including them would dilute every ratio with pure zeroes.

     Cancelled, Expired and Non-renewed policies ARE included, and that matters: they were on
     risk, they earned premium, and they had claims. Measuring loss ratio over Active policies
     alone is survivorship bias in its purest form — the business that went bad is exactly the
     business that gets cancelled, so excluding it reports the loss ratio of the survivors and
     calls it the loss ratio of the book. */
  var ON_RISK_STATUSES = { Active: 1, Cancelled: 1, Expired: 1, "Non-renewed": 1 };
  PAS.ON_RISK_STATUSES = ON_RISK_STATUSES;
  PAS.isOnRisk = function (p) { return !!ON_RISK_STATUSES[p.status]; };
  PAS.onRiskPolicies = function (policies) { return policies.filter(PAS.isOnRisk); };

  /* Who actually underwrote a policy — read from its own most recent completed Underwriting
     decision, never from `producer` (that is the broker who introduced the risk, a different
     party entirely). Shared so the dashboard's "Top underwriters" ranking and policy-detail's
     "Underwritten by" field can never disagree about who decided a given policy. */
  PAS.underwriterOf = function (policy) {
    var uw = (policy.history || [])
      .filter(function (h) { return h.type === "Underwriting" && h.status === "Completed"; })
      .sort(function (a, b) { return b.seq - a.seq; })[0];
    return uw ? uw.user : null;
  };
  /* ---------- coverage-wise breakdown ----------
     Every product's premium is split across the layers of cover it's actually built from — real
     percentages applied to each policy's own premium, not a fabricated number. The split is a
     documented modeling simplification (a real system would price each layer independently and
     sum them, not the reverse), not a live-rated figure; it's declared here as one table so it
     stays visible and correctable rather than hand-typed per policy. */
  var COVERAGE_TEMPLATE = {
    "Home Owners": [{ name: "Building", share: 0.70 }, { name: "Contents", share: 0.20 }, { name: "Liability", share: 0.10 }],
    "Comprehensive Auto": [{ name: "Own damage", share: 0.55 }, { name: "Third-party liability", share: 0.35 }, { name: "Personal accident", share: 0.10 }],
    "Commercial Property": [{ name: "Building", share: 0.50 }, { name: "Stock", share: 0.30 }, { name: "Machinery", share: 0.15 }, { name: "Business interruption", share: 0.05 }],
    "Marine Cargo": [{ name: "Cargo (transit)", share: 0.90 }, { name: "War & SRCC", share: 0.10 }],
    "Group Health": [{ name: "Base sum insured", share: 0.85 }, { name: "Critical illness rider", share: 0.15 }],
    "Term Life": [{ name: "Base sum assured", share: 0.90 }, { name: "Accidental death rider", share: 0.10 }],
  };
  PAS.COVERAGE_TEMPLATE = COVERAGE_TEMPLATE;
  /* Every line but the last rounds independently; the last absorbs whatever rounding remainder
     is left so the split always reconciles exactly to the policy's own premium, for any premium
     — rounding each share independently and summing can drift a dollar off in either direction
     whenever the premium doesn't divide the shares evenly. */
  function coverageBreakdown(policy) {
    /* An imported rating quote (PAS.importQuote) carries its own real per-coverage subtotals —
       prefer those over the fixed template split, which has no entry for a rated LOB like
       "Commercial Trucking" anyway and would otherwise silently fall back to an empty []. */
    if (policy.quote && policy.quote.coverages && policy.quote.coverages.length) {
      return policy.quote.coverages.map(function (c) {
        return { name: c.name, share: policy.premium ? c.subtotal / policy.premium : 0, premium: c.subtotal };
      });
    }
    var template = COVERAGE_TEMPLATE[policy.product] || [];
    var running = 0;
    return template.map(function (c, i) {
      var isLast = i === template.length - 1;
      var line = isLast ? (policy.premium - running) : Math.round(policy.premium * c.share);
      running += line;
      return { name: c.name, share: c.share, premium: line };
    });
  }
  PAS.coverageBreakdown = coverageBreakdown;

  var STATE_ABBR = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
    Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
    Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
    Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
    Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
    Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
    Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
  };
  PAS.STATE_ABBR = STATE_ABBR;
  PAS.stateAbbr = function (state) { return STATE_ABBR[state] || (state || "—"); };

  /* ---------- fleet roster: the vehicles and drivers actually on an auto policy ----------
     The seed book carries premium and sum insured for every Comprehensive Auto policy, not a
     hand-authored vehicle/driver roster for all ~190 of them — so this derives one the same way
     mgaForPolicy derives an MGA assignment: deterministically, from the policy's own id and
     premium (hash32-seeded), not stored data. Same policy always yields the same roster; nothing
     here is randomized per render. Premium is the only real signal for fleet size in this model,
     so it's what decides vehicle/driver count — a $2,780 personal policy gets one car and its
     named insured as the driver, a $150K fleet policy gets a multi-truck roster with named
     drivers, the same shape a commercial auto submission would actually carry. */
  var TRUCK_MAKES = [["Freightliner", "Cascadia"], ["Peterbilt", "579"], ["Kenworth", "T680"], ["Volvo", "VNL"], ["International", "LT"], ["Mack", "Anthem"]];
  var TRAILER_MAKES = [["Great Dane", "Everest"], ["Wabash", "DuraPlate"], ["Utility", "4000D-X"], ["Stoughton", "Z-Plate"]];
  var CAR_MAKES = [["Toyota", "Camry"], ["Honda", "Accord"], ["Ford", "F-150"], ["Chevrolet", "Silverado"], ["Nissan", "Altima"], ["Subaru", "Outback"]];
  var DRIVER_FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Susan", "David", "Karen", "John", "Patricia", "Carlos", "Angela", "Kevin", "Nicole", "Brian", "Stephanie", "Eric", "Rachel", "Tyler", "Monica"];
  var DRIVER_LAST = ["Turner", "Reyes", "Bennett", "Coleman", "Foster", "Nguyen", "Patel", "Ramirez", "Douglas", "Fisher", "Whitfield", "Hayes", "Sutton", "Barron", "Mercer", "Ortiz"];
  function vin17(seed) {
    var chars = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ", out = "";
    for (var i = 0; i < 17; i++) { out += chars[seed % chars.length]; seed = (seed * 31 + i) >>> 0; }
    return out;
  }
  PAS.vehicleFleetFor = function (policy) {
    if (!policy || policy.product !== "Comprehensive Auto") return null;
    var h = hash32(policy.id);
    var isFleet = (policy.premium || 0) >= 20000 * PREMIUM_SCALE;
    var vehicleCount = isFleet ? Math.max(2, Math.min(12, Math.round(policy.premium / (22000 * PREMIUM_SCALE)))) : 1;
    var makePool = isFleet ? TRUCK_MAKES : CAR_MAKES;
    var powerUnits = [];
    for (var i = 0; i < vehicleCount; i++) {
      var vseed = hash32(policy.id + "-veh-" + i);
      var mk = makePool[vseed % makePool.length];
      powerUnits.push({ unit: (isFleet ? "Truck " : "Vehicle ") + (i + 1), type: isFleet ? "Tractor unit" : "Passenger vehicle", make: mk[0], model: mk[1], year: 2020 + (vseed % 7), vin: vin17(vseed), drivers: [] });
    }
    var trailers = [];
    if (isFleet) {
      var trailerCount = Math.max(1, Math.round(vehicleCount / 2));
      for (var t = 0; t < trailerCount; t++) {
        var tseed = hash32(policy.id + "-trl-" + t);
        var tm = TRAILER_MAKES[tseed % TRAILER_MAKES.length];
        trailers.push({ unit: "Trailer " + (t + 1), type: "Dry van trailer", make: tm[0], model: tm[1], year: 2019 + (tseed % 8), vin: vin17(tseed), drivers: [] });
      }
    }

    /* A vehicle and a driver are a many-to-many relationship, not one-to-one: a fleet truck gets
       a lead driver plus a relief driver who also covers another truck's off-shift, and even a
       single personal-auto vehicle usually carries more than one household driver. Each vehicle's
       `drivers` names into the flat `drivers` roster below rather than duplicating driver detail,
       so the license/roster table and the per-vehicle assignment can never disagree. */
    var drivers = [];
    if (isFleet) {
      var driverCount = Math.max(vehicleCount, Math.min(14, vehicleCount + (h % 3)));
      for (var d = 0; d < driverCount; d++) {
        var dseed = hash32(policy.id + "-drv-" + d);
        var name = DRIVER_FIRST[dseed % DRIVER_FIRST.length] + " " + DRIVER_LAST[hash32(policy.id + "-drvl-" + d) % DRIVER_LAST.length];
        drivers.push({ name: name, role: d === 0 ? "Lead driver" : "Driver", licenseClass: "CDL-A", licenseState: PAS.stateAbbr(policy.state), yearsLicensed: 2 + (dseed % 15) });
      }
      powerUnits.forEach(function (v, i) {
        var leadIdx = i % driverCount;
        v.drivers.push({ name: drivers[leadIdx].name, contextRole: leadIdx === 0 ? "Lead driver" : "Driver" });
        /* Only double up when the pool is thin relative to the truck count — a fleet with one
           driver per truck and no slack has nobody left over to run relief shifts. */
        if (driverCount < vehicleCount * 1.5) {
          var reliefIdx = (i + Math.max(1, Math.floor(driverCount / 2))) % driverCount;
          if (reliefIdx !== leadIdx) v.drivers.push({ name: drivers[reliefIdx].name, contextRole: "Relief · night shift" });
        }
      });
    } else {
      var primaryName = policy.holder;
      drivers.push({ name: primaryName, role: "Primary", licenseClass: "Class C", licenseState: PAS.stateAbbr(policy.state), yearsLicensed: 5 + (h % 20) });
      powerUnits[0].drivers.push({ name: primaryName, contextRole: "Primary" });
      /* Real personal auto is rarely exactly one driver on the household car — a spouse or adult
         child usually shares it. About half of these policies get a second driver, deterministically,
         so the same policy always renders the same roster rather than reflecting only the named
         insured every time. */
      if (h % 2 === 0) {
        var secondSeed = hash32(policy.id + "-drv-1");
        var lastName = primaryName.trim().split(/\s+/).slice(-1)[0];
        var secondName = DRIVER_FIRST[secondSeed % DRIVER_FIRST.length] + " " + lastName;
        drivers.push({ name: secondName, role: "Secondary · household member", licenseClass: "Class C", licenseState: PAS.stateAbbr(policy.state), yearsLicensed: 1 + (secondSeed % 25) });
        powerUnits[0].drivers.push({ name: secondName, contextRole: "Secondary · household member" });
      }
    }

    return { isFleet: isFleet, vehicles: powerUnits.concat(trailers), drivers: drivers };
  };

  /* ---------- loyalty: configurable criteria, computed from real ledger data ----------
     Same shape as the underwriting risk model — a weights table an admin could tune, plus a pure
     function that shows its derivation line by line rather than asserting a tier. Every input is
     a fact already on the policy (renewal count, claims on file, cancellation history, premium)
     — nothing here is a fabricated "loyalty points" balance. */
  var LOYALTY_CRITERIA = {
    perRenewalTerm: 15, claimFreeBonus: 20, noCancellationBonus: 15,
    highValuePremium: Math.round(500000 * PREMIUM_SCALE), highValueBonus: 10,
  };
  PAS.LOYALTY_CRITERIA = LOYALTY_CRITERIA;
  var LOYALTY_TIERS = [
    { name: "Platinum", min: 60, tone: "violet" },
    { name: "Gold", min: 40, tone: "amber" },
    { name: "Silver", min: 20, tone: "blue" },
    { name: "Bronze", min: 0, tone: "gray" },
  ];
  PAS.LOYALTY_TIERS = LOYALTY_TIERS;
  function loyaltyScore(policy) {
    var w = LOYALTY_CRITERIA;
    var renewals = Math.max(0, (policy.termNumber || 1) - 1);
    var claims = (policy.claims || []).length;
    var priorCx = policy.history.filter(function (h) { return h.type === "Cancellation" && h.status === "Completed"; }).length;
    var lines = [];
    function add(label, value, note) { if (value) lines.push({ label: label, value: value, note: note }); }
    add("Renewed " + renewals + " time" + (renewals === 1 ? "" : "s"), renewals * w.perRenewalTerm, "Every completed renewal is worth " + w.perRenewalTerm + " points.");
    add("Claim-free", claims === 0 ? w.claimFreeBonus : 0, claims === 0 ? "No claims on file." : "");
    add("Never cancelled", priorCx === 0 ? w.noCancellationBonus : 0, priorCx === 0 ? "No completed cancellation in this policy's history." : "");
    add("High-value policy", policy.premium >= w.highValuePremium ? w.highValueBonus : 0, "Premium at or above " + money(w.highValuePremium) + ".");
    var score = lines.reduce(function (s, l) { return s + l.value; }, 0);
    var tier = LOYALTY_TIERS.find(function (t) { return score >= t.min; }) || LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
    return { score: score, tier: tier.name, tone: tier.tone, lines: lines };
  }
  PAS.loyaltyScore = loyaltyScore;
  function reservesTotal(policies) {
    return allClaims(policies).filter(function (x) { return x.c.status === "Open"; }).reduce(function (s, x) { return s + x.c.reserved; }, 0);
  }
  PAS.reservesTotal = reservesTotal;

  /* PREMIUM_SCALE itself is declared at the top of this file (every fixed dollar threshold that
     compares against a policy's premium needs it too). This block applies it to the seed data:
     loss ratio, combined ratio, commission rates and every other RATIO stay exactly as authored
     (scaling both sides of a ratio by the same factor leaves it unchanged), only the absolute
     dollar figures grow. Applied once here, at the seed boundary, so every screen — dashboard,
     registry, invoices, printed documents — reads the same scaled premium; nothing downstream
     needs to know scaling happened. */
  function scaleMoney(n) { return Math.round((Number(n) || 0) * PREMIUM_SCALE); }

  /* Scales every premium-shaped number on a policy record, not just p.premium: a windowed period
     view's "written premium" (see premiumEstablishedBy) reads Renewal.newPremium/previousPremium
     off the transaction history, not p.premium, so those need the same factor or a monthly/
     quarterly filter would show unscaled figures next to a scaled All-history total. Cancellation
     refunds, reinstatement arrears and endorsement premium impacts are scaled too, purely for
     realism — none of them feed PAS.bookFinancials. */
  function scalePolicyPremiums(p) {
    p.premium = scaleMoney(p.premium);
    (p.history || []).forEach(function (h) {
      if (!h.meta) return;
      if (h.type === "Renewal") {
        if (h.meta.previousPremium != null) h.meta.previousPremium = scaleMoney(h.meta.previousPremium);
        if (h.meta.newPremium != null) h.meta.newPremium = scaleMoney(h.meta.newPremium);
      } else if (h.type === "Cancellation" && h.meta.refund != null) {
        h.meta.refund = scaleMoney(h.meta.refund);
      } else if (h.type === "Reinstatement") {
        if (h.meta.outstanding != null) h.meta.outstanding = scaleMoney(h.meta.outstanding);
        if (h.meta.outstandingClaimed != null) h.meta.outstandingClaimed = scaleMoney(h.meta.outstandingClaimed);
      } else if (h.type === "Endorsement" && h.meta.premiumImpact != null) {
        h.meta.premiumImpact = scaleMoney(h.meta.premiumImpact);
      }
    });
    return p;
  }

  /* Scales a claim's dollar fields by deriving reserved from the scaled incurred/paid rather than
     rounding all three independently — that keeps the paid + reserved = incurred identity exact
     after scaling instead of drifting a dollar off from three separate roundings. */
  function scaleClaim(c) {
    var incurred = scaleMoney(c.incurred);
    var paid = scaleMoney(c.paid);
    return Object.assign({}, c, { incurred: incurred, paid: paid, reserved: Math.max(0, incurred - paid) });
  }

  /* The raw book of business lives in data/policies.js — a plain <script> include (see every
     HTML page's script chain, and CORE in the test harness) that runs before this file and sets
     window.PAS_SEED_POLICIES. Loaded as a script, not fetched, so the app keeps working when
     opened directly via file:// with no local server — a blocking XHR/fetch to a local JSON file
     is blocked by browser CORS policy over file://, a <script src> is not. Deep-cloned on every
     call so repeated seedPolicies() calls (e.g. after Reset demo data) never share object
     references with a previous call. */
  function fetchSeedRecords() {
    if (!Array.isArray(global.PAS_SEED_POLICIES)) {
      throw new Error("Seed data not found — data/policies.js must be loaded (as a <script> tag) before store.js.");
    }
    var list = JSON.parse(JSON.stringify(global.PAS_SEED_POLICIES));
    list.forEach(scalePolicyPremiums);
    return list;
  }
  /* Every record should have at least one document on file — a submission that's only Referred
     has a quote, not a schedule; a Bound risk has an application; only an issued/lapsed/declined
     policy has the real schedule. Only backfills records the seed JSON left empty — anything
     already carrying real documents (an issued policy's schedule + certificate) is untouched. */
  var STATUS_DOC = {
    Referred: ["Quote", "Quote"], Bound: ["Application form", "Application"],
    Declined: ["Decline notice", "Notice"],
  };
  /* A modest, deterministic slice of the active book gets one *completed* mid-term change already
     on its ledger — real policies that have been in force a while often have had one. Not every
     policy: most personal lines genuinely never get endorsed, so this only touches active records
     over a small premium floor, roughly a third of them (hash32-selected, so it's stable across
     reseeds), using the same structured meta shapes (drivers/coverageChange/limitChange/
     addressChange) the Endorsement desk and decision screen already know how to render — not
     just a text blob. Minor materiality throughout: a "Completed" entry with no pending step
     behind it should never claim to be a material change, since the domain rule is material
     changes are never auto-applied. */
  var ENDORSE_TEMPLATES = {
    "Comprehensive Auto": function (p, seed) {
      var name = DRIVER_FIRST[seed % DRIVER_FIRST.length] + " " + DRIVER_LAST[hash32(p.id + "-endname") % DRIVER_LAST.length];
      return {
        changeType: "Add/remove driver", premiumImpact: 80 + (seed % 12) * 15,
        requestNote: "Add " + name + " as a named driver.", detail: "Named driver " + name + " added to the policy.",
        extra: { drivers: [{ action: "Add", name: name, relationship: "Household member", licenseNumber: "D" + (1000000 + seed % 8999999), licenseState: PAS.stateAbbr(p.state), yearsLicensed: 2 + (seed % 15) }] },
      };
    },
    "Home Owners": function (p, seed) {
      return {
        changeType: "Coverage change", premiumImpact: 60 + (seed % 10) * 20,
        requestNote: "Increase contents coverage after a home improvement.", detail: "Contents coverage limit increased.",
        extra: { coverageChange: { coverage: "Contents", action: "Increase limit", limit: "$" + (20000 + (seed % 8) * 5000).toLocaleString(), deductible: "$1,000" } },
      };
    },
    "Commercial Property": function (p, seed) {
      return {
        changeType: "Limit change", premiumImpact: 200 + (seed % 10) * 60,
        requestNote: "Raise building limit following a valuation update.", detail: "Building limit increased following revaluation.",
        extra: { limitChange: { coverage: "Building limit", from: "$" + (500000 + seed % 400000).toLocaleString(), to: "$" + (900000 + seed % 400000).toLocaleString() } },
      };
    },
    "Marine Cargo": function (p, seed) {
      return {
        changeType: "Limit change", premiumImpact: 150 + (seed % 10) * 40,
        requestNote: "Raise per-shipment cargo limit for a larger consignment.", detail: "Per-shipment cargo limit increased.",
        extra: { limitChange: { coverage: "Cargo limit (per shipment)", from: "$250,000", to: "$400,000" } },
      };
    },
    "Group Health": function () {
      return {
        changeType: "Address change", premiumImpact: 0,
        requestNote: "Group registered address updated.", detail: "Registered address on file updated.",
        extra: { addressChange: { from: "Prior registered address on file", to: "Updated registered address on file" } },
      };
    },
    "Term Life": function () {
      return {
        changeType: "Address change", premiumImpact: 0,
        requestNote: "Insured's address updated.", detail: "Registered address on file updated.",
        extra: { addressChange: { from: "Prior registered address on file", to: "Updated registered address on file" } },
      };
    },
  };
  function backfillEndorsementTrail(p) {
    if (p.status !== "Active" || (p.premium || 0) < 3000 * PREMIUM_SCALE) return;
    if (p.history.some(function (h) { return h.type === "Endorsement"; })) return;
    var tmpl = ENDORSE_TEMPLATES[p.product];
    if (!tmpl) return;
    var seed = hash32(p.id + "-endorse");
    if (seed % 3 !== 0) return;
    var edate = addDays(p.effectiveDate, 30 + (seed % 200));
    if (edate > todayISO()) return;
    var data = tmpl(p, seed);
    p.history.push(Object.assign({
      id: uid("TXN"), seq: p.history.length + 1, date: edate, recordedAt: edate + "T09:30:00.000Z",
      type: "Endorsement", status: "Completed", user: "Broker portal",
      title: "Endorsement applied: " + data.changeType, detail: data.detail,
      meta: Object.assign({ changeType: data.changeType, materiality: "Minor", premiumImpact: data.premiumImpact, initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: edate, requestNote: data.requestNote }, data.extra),
    }));
  }
  /* A handful of extra pending cancellation requests, hand-picked to cover the derived-type
     combinations the original seed happened not to have any of — specifically so the "Override
     type" control on the Cancellation desk (setCancelTypeOverride, "where permitted") has real
     records to demonstrate every outcome against, not just Short-Rate:
       - POL-2026-0442: effective date = the policy's own inception date -> derives FLAT. Pro-Rata
         or Short-Rate is not the normal rule here (Flat is the only type isValidCancelType allows
         at/before inception) — Super Admin/Admin can still force either as a logged exception
         (overrideOutsideRule), demonstrating the "outside the normal rule" warning path.
       - POL-2025-09112 / POL-2026-0424: an INSURED- or BROKER-initiated request whose reason
         (Non-Payment / Underwriting) defaults to Pro-Rata on its own, with no insurer-side
         initiator forcing that downgrade. Because the initiator isn't insurer-side, Short-Rate
         is a genuinely valid override target here — every Pro-Rata request already in the book
         happened to be Carrier/System-initiated, where Short-Rate is correctly refused, so there
         was no record anywhere that could demonstrate a Pro-Rata -> Short-Rate override actually
         being permitted and applied.
     Each target policy was checked to have no Transfer entry of its own — the Transfer-continuity
     test elsewhere asserts its pending transfer is the LAST history entry on that specific policy,
     and appending a cancellation request after it would silently invalidate that assumption. */
  var EXTRA_CANCEL_REQUESTS = {
    "POL-2026-0442": { reason: "Insured Request", initiatedBy: "Insured", channel: "Self-service portal", atInception: true, requestNote: "Bought this by mistake — I already have auto cover through my employer. Please cancel before it starts." },
    "POL-2025-09112": { reason: "Non-Payment", initiatedBy: "Insured", channel: "Phone", requestNote: "Lost my job in July and can't keep up with the premium payments. Please cancel." },
    "POL-2026-0424": { reason: "Underwriting", initiatedBy: "Broker/Producer", channel: "Broker portal", requestNote: "Flagging an underwriting concern on this account after a routine review — recommending cancellation." },
  };
  function seedExtraCancelRequest(p) {
    var spec = EXTRA_CANCEL_REQUESTS[p.id];
    if (!spec || p.status !== "Active") return;
    if (p.history.some(function (h) { return h.type === "Cancellation" && h.status === "Pending"; })) return;
    var submittedOn = addDays(todayISO(), -1);
    var effDate = spec.atInception ? p.effectiveDate : todayISO();
    p.history.push({
      id: uid("TXN"), seq: p.history.length + 1, date: effDate, recordedAt: submittedOn + "T09:30:00.000Z",
      type: "Cancellation", status: "Pending", user: spec.channel,
      title: "Cancellation requested — held for review",
      detail: spec.initiatedBy + " requests cancellation. \"" + spec.requestNote + "\"",
      meta: { reason: spec.reason, initiatedBy: spec.initiatedBy, channel: spec.channel, submittedOn: submittedOn, requestNote: spec.requestNote },
    });
  }
  /* A handful of Bound records whose effective date has already arrived (per todayISO) but whose
     issuance was never completed in the original story — issueGatesPass (the exact same gate the
     live Issue desk enforces) says nothing is actually blocking them, so a real system would have
     issued them by now rather than leaving them sitting in the queue past their own start date.
     Completing them here, dated on each policy's own effective date — the same date===effectiveDate
     convention every other real issuance in this book already follows — gives the dashboard's
     current-month written premium the on-time new business it would genuinely already have,
     instead of undercounting it because nothing ever simulated their "Issue" click. */
  function backfillOverdueIssuance(p) {
    if (p.status !== "Bound" || p.effectiveDate > todayISO() || !issueGatesPass(p)) return;
    p.history.push({
      id: uid("TXN"), seq: p.history.length + 1, date: p.effectiveDate, recordedAt: p.effectiveDate + "T09:30:00.000Z",
      type: "Issuance", status: "Completed", user: "System",
      title: "Policy issued", detail: "Formal contract issued. Schedule and certificate generated and stored.",
      meta: {},
    });
    p.status = "Active";
    p.documents = (p.documents || []).filter(function (d) { return d.type !== "Quote" && d.type !== "Application"; }).concat([
      { id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: p.effectiveDate, type: "Schedule" },
      { id: uid("DOC"), name: "Certificate of insurance", version: 1, generatedAt: p.effectiveDate, type: "Certificate" },
    ]);
  }

  function seedPolicies() {
    var list = fetchSeedRecords();
    list.forEach(function (p) {
      p.risk = RISK_PROFILE[p.id] || {}; p.claims = (CLAIMS_BY_ID[p.id] || []).map(scaleClaim); p.carrier = PRODUCT_CARRIER[p.product] || PAS.CARRIERS[0]; p.mga = mgaForPolicy(p);
      if (!p.documents || !p.documents.length) {
        var docShape = STATUS_DOC[p.status] || ["Policy schedule", "Schedule"];
        p.documents = [{ id: uid("DOC"), name: docShape[0], version: 1, generatedAt: p.submittedOn || p.effectiveDate, type: docShape[1] }];
      }
      backfillOverdueIssuance(p);
      backfillEndorsementTrail(p);
      seedExtraCancelRequest(p);
    });
    return list;
  }
  PAS.seedPolicies = seedPolicies;

  /* ================= constants shared with the UI layer ================= */
  PAS.TENANT = "0190c4f2-77aa-7c31-9f10-5a2e4b8c1d33";
  PAS.EVENT_FOR = {
    "/issue": "policyIssued", "/endorsements": "policyEndorsed", "/cancellations": "policyCancelled",
    "/reinstatements": "policyReinstated", "/renewals": "policyRenewed", "/non-renewal": "policyNonRenewed",
    "/transfers": "policyTransferred",
    "/service-requests": "serviceRequestLogged", "/approve": "transactionApproved",
    "/reject": "transactionRejected", "/reverse": "transactionReversed",
    "/underwriting-decision": "underwritingDecided", "/documents": "documentGenerated",
    "/dnoc": "dnocServed",
  };
  PAS.CONSUMERS = {
    policyIssued: ["Billing", "Documents", "Reinsurance"], policyCancelled: ["Billing", "Claims", "Documents"],
    policyRenewed: ["Billing", "Documents"], policyEndorsed: ["Billing", "Documents"],
    policyReinstated: ["Billing", "Claims"], documentGenerated: ["Documents"], underwritingDecided: ["CRM"],
    transactionApproved: ["Billing"], transactionRejected: ["CRM"], transactionReversed: ["Billing"],
    policyNonRenewed: ["CRM", "Documents"], serviceRequestLogged: ["CRM"],
    policyTransferred: ["Billing", "Documents", "CRM", "Reinsurance"],
    dnocServed: ["Documents", "CRM", "Billing"],
  };
  PAS.eventTypeFor = function (ep) {
    var k = Object.keys(PAS.EVENT_FOR).find(function (x) { return ep.indexOf(x) !== -1; });
    return k ? PAS.EVENT_FOR[k] : null;
  };

  PAS.INITIATORS = {
    Insured: { icon: "user", tone: "blue", label: "Insured", channels: ["Self-service portal", "Phone", "Email"] },
    "Broker/Producer": { icon: "users", tone: "indigo", label: "Broker / Producer", channels: ["Broker portal", "Phone", "Email"] },
    Underwriter: { icon: "clipboard-check", tone: "violet", label: "Underwriter (internal)", channels: ["Internal review", "Portfolio audit"] },
    MGA: { icon: "key-round", tone: "amber", label: "MGA", channels: ["MGA portal", "Phone", "Email"] },
    Carrier: { icon: "building-2", tone: "green", label: "Reinsurer", channels: ["Internal review", "Portfolio audit", "Compliance directive"] },
    System: { icon: "cpu", tone: "gray", label: "System (automated)", channels: ["Billing non-payment trigger", "Renewal reminder job"] },
  };
  /* Cancellation restricts the "Initiated by" picker to this subset — an underwriter's portfolio
     review is a Renewal/Endorsement concept; a cancellation is initiated by the Carrier itself,
     an MGA acting on its behalf, a Broker, the Insured, or the System (non-payment). */
  PAS.CANCEL_INITIATOR_KEYS = ["Insured", "Broker/Producer", "MGA", "Carrier", "System"];
  PAS.STATUS_TONE = { Active: "green", Cancelled: "red", Expired: "gray", Bound: "amber", Referred: "violet", Submitted: "blue", "Non-renewed": "red", Declined: "red" };
  /* Display labels for the 7 canonical policy statuses above — real PAS terminology (curated from
     the carrier's own status-code table: RECEIVED / UW REVIEW / BOUND / POLICY ISSUED / DECLINED /
     CANCELLED POLICY / EXPIRED, etc.), not the internal short codes every comparison in this file
     is keyed on. The canonical values (Active, Referred, Bound, ...) are never renamed — they stay
     untouched in the seed data and in every p.status === "..." check across the app — only the
     text shown to a user runs through this map, the same pattern already used for the Cancellation
     desk's Carrier -> "MGA" relabel. Deliberately a small, curated set: the real table has 30+
     codes, many test/duplicate/legacy artifacts ("test", "IGNORE/ERROR", "[Deleted]") that would
     make the app harder to explain, not easier, so only the ones this app's 7-status model actually
     needs were picked. Bound/Declined/Expired already matched real terms and are left as-is. */
  PAS.STATUS_LABELS = {
    Referred: "UW Review", Bound: "Bound", Active: "Policy Issued", Declined: "Declined",
    Cancelled: "Cancelled Policy", Expired: "Expired", "Non-renewed": "Non-Renewed",
  };
  PAS.statusLabel = function (status) { return PAS.STATUS_LABELS[status] || status; };
  /* Same idea, one level down: the *transaction* ledger's own status badge (Completed/Pending/
     Rejected/Reversed — module-agnostic, PAS.TXN_TONE) also gets real terms where a (module,
     status) pair maps unambiguously to one — pulled from the same reference table. Deliberately
     narrow: only pairs verified against the actual code paths that produce them (e.g. an
     "Underwriting" transaction's own status is always "Completed" for both Approve and Decline —
     the outcome lives in its title, not its status — so it's never in this map, to avoid ever
     mislabeling a declined submission as approved). A Cancellation left Pending with a DNOC served
     gets its own real term regardless of status text, matching PAS.dnocState's own trigger. */
  var TXN_STATUS_LABELS = {
    Bind: { Completed: "Bound" }, Issuance: { Completed: "Policy Issued" },
    Cancellation: { Completed: "Cancelled Policy" }, Reinstatement: { Completed: "Reinstated" },
  };
  PAS.txnStatusLabel = function (txnType, status, meta) {
    if (txnType === "Cancellation" && status === "Pending" && meta && meta.dnocServedOn) return "DNOC/Pending Cancellation";
    var m = TXN_STATUS_LABELS[txnType];
    return (m && m[status]) || status || "Completed";
  };
  PAS.TXN_TONE = { Completed: "green", Pending: "amber", Rejected: "red", Reversed: "violet" };
  PAS.MODULE_TONE = { Submission: "blue", Underwriting: "violet", Bind: "amber", Issuance: "indigo", Endorsement: "amber", Cancellation: "red", Reinstatement: "green", Renewal: "blue", Servicing: "violet", Transfer: "indigo" };
  PAS.MODULE_ICON = { Submission: "inbox", Underwriting: "clipboard-check", Bind: "shield-check", Issuance: "stamp", Endorsement: "edit-3", Cancellation: "x-circle", Reinstatement: "rotate-ccw", Renewal: "refresh-cw", Servicing: "headphones", Transfer: "send" };

  PAS.PAGE_APIS = {
    dashboard: [["GET", "/api/v1/policies/kpis", "Portfolio aggregates for the KPI strip"], ["GET", "/api/v1/policies?limit=50", "The register behind every panel"]],
    approvals: [["GET", "/api/v1/transactions?status=pending", "Held transactions across the book"], ["POST", "/api/v1/transactions/{txnId}/approve", "Commits a held transaction"]],
    "admin-config": [["GET", "/api/v1/admin/roles", "Every role and its permission grid"], ["POST", "/api/v1/admin/roles", "Creates or updates a role"], ["DELETE", "/api/v1/admin/roles/{roleKey}", "Deletes a custom role"], ["GET", "/api/v1/admin/users", "Every invited user and their role"], ["POST", "/api/v1/admin/users/invite", "Invites a user under a role"]],
    "uw-desk": [["GET", "/api/v1/underwriting/queue", "Submissions referred out of auto authority"], ["POST", "/api/v1/submissions/{id}/underwriting-decision", "Records approve / decline / refer"]],
    "issue-desk": [["GET", "/api/v1/policies?status=bound", "Bound but not yet issued"], ["POST", "/api/v1/policies/{policyId}/issue", "Runs issue gates, generates the pack"]],
    "endorsement-desk": [["GET", "/api/v1/endorsements?status=requested", "Change requests awaiting a decision"], ["POST", "/api/v1/transactions/{txnId}/approve", "Applies the held change"]],
    "cancellation-desk": [["GET", "/api/v1/policies?status=active", "Policies eligible to cancel"], ["POST", "/api/v1/policies/{policyId}/cancellations", "Derives type, computes refund, checks notice"]],
    "reinstatement-desk": [["GET", "/api/v1/policies?status=cancelled", "Reinstatement candidates"], ["POST", "/api/v1/policies/{policyId}/reinstatements", "Validates window then returns to ACTIVE"]],
    "renewal-desk": [["GET", "/api/v1/renewals/upcoming", "Policies inside the notice window"], ["POST", "/api/v1/policies/{policyId}/renewals", "Creates the next PolicyTerm"]],
    "servicing-desk": [["GET", "/api/v1/service-requests", "Servicing ledger"], ["POST", "/api/v1/policies/{policyId}/service-requests", "Logs a request against the SLA"]],
    "transfer-desk": [["GET", "/api/v1/transfers?status=requested", "Transfer requests awaiting a decision"], ["POST", "/api/v1/policies/{policyId}/transfers", "Records a change of named insured, preserving continuity"]],
    workbench: [["GET", "/api/v1/transactions", "The full append-only ledger"], ["POST", "/api/v1/transactions/{txnId}/reverse", "Appends a compensating row"]],
    registry: [["GET", "/api/v1/policies", "Cursor-paged, tenant-scoped register"]],
    brokers: [["GET", "/api/v1/policies?producer={name}", "Every record placed through one broker"]],
    mgas: [["GET", "/api/v1/policies?mga={name}", "Every record bound through one MGA"]],
    carriers: [["GET", "/api/v1/policies?carrier={name}", "Every record written on one carrier's paper"]],
    customers: [["GET", "/api/v1/policies?holder={name}", "Every record for one named insured"]],
    detail: [["GET", "/api/v1/policies/{policyId}", "Aggregate + ETag"], ["GET", "/api/v1/policies/{policyId}/transactions", "Ledger in seq order"], ["POST", "/api/v1/policies/{policyId}/documents", "Renders and stores a new version"]],
    documents: [["GET", "/api/v1/documents", "Document metadata across the book"]],
    loyalty: [["GET", "/api/v1/loyalty", "Every active policy's computed tier and score"], ["GET", "/api/v1/loyalty/criteria", "The current weight table — what earns points and how much"]],
    terms: [["GET", "/api/v1/products/{product}/terms", "The current clause set for a product, edits included"], ["PUT", "/api/v1/products/{product}/terms/{clauseId}", "Saves an edited clause"]],
    "domain-model": [],
    "data-model": [],
    "api-reference": [],
    architecture: [],
  };

  /* The whole endpoint surface, grouped by resource. The API reference screen renders this and
     resolves each write to its domain event through EVENT_FOR, so a new endpoint cannot appear
     in the app without appearing in the reference. */
  PAS.API_CATALOGUE = [
    { resource: "Policies", base: "/api/v1/policies", endpoints: [
      ["GET", "/api/v1/policies", "Cursor-paged, tenant-scoped register.", "Backs the Dashboard and the Policy register. Accepts ?status= and ?limit=."],
      ["GET", "/api/v1/policies/{policyId}", "One aggregate, with an ETag.", "The ETag is the concurrency token — writes must send it back in If-Match."],
      ["GET", "/api/v1/policies/kpis", "Portfolio aggregates.", "Served from the Redis cache, not recomputed per request."],
      ["GET", "/api/v1/policies/{policyId}/transactions", "That policy's ledger, in seq order.", "Append-only: seq is monotonic per policy and never resequenced."],
      ["POST", "/api/v1/policies/{policyId}/issue", "Runs the issue gates, generates the document pack.", "Rejects unless every subjectivity on the binder is met."],
      ["POST", "/api/v1/policies/{policyId}/cancellations", "Derives the type, computes the refund, checks notice.", "Type is derived from reason and dates — never supplied by the caller."],
      ["POST", "/api/v1/policies/{policyId}/reinstatements", "Validates the window, returns the policy to ACTIVE.", "Fraud-flagged cancellations are permanently barred here."],
      ["POST", "/api/v1/policies/{policyId}/renewals", "Creates the next term.", "Should insert a new policy_terms row — see the note on the Data model screen."],
      ["POST", "/api/v1/policies/{policyId}/endorsements", "Raises a mid-term change request.", "Material changes are held; they never auto-apply."],
      ["POST", "/api/v1/policies/{policyId}/service-requests", "Logs a servicing request against its SLA.", "Non-financial: no premium effect, no policy state change."],
      ["POST", "/api/v1/policies/{policyId}/documents", "Renders and stores a new document version.", "Version increments per document name, per policy."],
    ] },
    { resource: "Submissions & underwriting", base: "/api/v1/submissions", endpoints: [
      ["GET", "/api/v1/underwriting/queue", "Submissions referred out of automatic authority.", "One row per submission that failed at least one referral gate."],
      ["POST", "/api/v1/submissions/{id}/underwriting-decision", "Records approve, decline or refer back.", "A decline must carry a written reason — it is disclosable to the applicant."],
    ] },
    { resource: "Transactions", base: "/api/v1/transactions", endpoints: [
      ["GET", "/api/v1/transactions", "The full append-only ledger across the book.", "Backs the Transaction workbench."],
      ["GET", "/api/v1/transactions?status=pending", "Cross-type index of held transactions.", "Backs Pending approvals; a held transaction leaves the policy untouched."],
      ["POST", "/api/v1/transactions/{txnId}/approve", "Commits a held transaction.", "The single write path for every decision desk."],
      ["POST", "/api/v1/transactions/{txnId}/reject", "Declines a held transaction.", "The policy is left exactly as it was."],
      ["POST", "/api/v1/transactions/{txnId}/reverse", "Appends a compensating reversal row.", "Today this flips the ledger status only — it does not yet unwind the policy-level effect."],
    ] },
    { resource: "Renewals & documents", base: "/api/v1", endpoints: [
      ["GET", "/api/v1/renewals/upcoming", "Policies inside the notice window.", "Window is RENEWAL_LEAD_DAYS wide."],
      ["GET", "/api/v1/endorsements?status=requested", "Change requests awaiting a decision.", ""],
      ["GET", "/api/v1/service-requests", "The servicing ledger.", ""],
      ["GET", "/api/v1/documents", "Document metadata across the book.", "Metadata only — the bytes live in Blob Storage."],
    ] },
    { resource: "Loyalty", base: "/api/v1/loyalty", endpoints: [
      ["GET", "/api/v1/loyalty", "Every active policy's computed tier and score.", "Computed on read from renewal count, claims and cancellation history — never a stored points balance."],
      ["GET", "/api/v1/loyalty/criteria", "The current weight table.", "What earns points and how much — configurable, not hardcoded into the scoring logic itself."],
    ] },
    { resource: "Admin", base: "/api/v1/admin", endpoints: [
      ["GET", "/api/v1/admin/roles", "Every role, default or custom, with its permission grid.", "Backs the Admin Configuration screen's Roles tab."],
      ["POST", "/api/v1/admin/roles", "Creates or updates a role.", "The four default roles can be edited but not deleted."],
      ["DELETE", "/api/v1/admin/roles/{roleKey}", "Deletes a custom role.", "Refused for a default role, or for the last role that can manage roles."],
      ["GET", "/api/v1/admin/users", "Every invited user, their role and scoping identity.", ""],
      ["POST", "/api/v1/admin/users/invite", "Invites a user under a role.", "Simulated — no real email is sent in this prototype."],
    ] },
  ];

  /* Sidebar nav: [pageKey, label, iconName, href]. Items commented out here (uw-desk, issue-desk,
     servicing-desk, transfer-desk, documents, loyalty, terms) are deliberately off the sidebar —
     the pages themselves still exist and stay reachable by direct URL/links elsewhere (e.g. the
     Pending Approvals queue still routes to servicing/transfer), only the persistent nav entry is
     gone. Admin Configuration is its own trailing group so it always renders last, below every
     other section, matching where an admin/settings entry conventionally sits. */
  PAS.NAV = [
    { label: "Workspace", items: [["dashboard", "Dashboard", "layout-dashboard", "index.html"], ["approvals", "Pending approvals", "inbox", "approvals.html"]] },
    { label: "Decision desks", items: [
      // ["uw-desk", "Issue Policy", "clipboard-check", "underwriting.html"],
      // ["issue-desk", "Issue", "stamp", "issue.html"],
      ["endorsement-desk", "Endorsements", "edit-3", "endorsement.html"],
      ["cancellation-desk", "Cancellation", "x-circle", "cancellation.html"],
      ["reinstatement-desk", "Reinstatement", "rotate-ccw", "reinstatement.html"],
      ["renewal-desk", "Renewal", "refresh-cw", "renewal.html"],
      // ["servicing-desk", "Servicing", "headphones", "servicing.html"],
      // ["transfer-desk", "Transfer", "send", "transfer.html"],
    ] },
    { label: "Records", items: [
      ["registry", "Policy register", "list-checks", "registry.html"],
      ["brokers", "Brokers", "users", "brokers.html"],
      ["mgas", "MGA", "building-2", "mgas.html"],
      ["carriers", "Reinsurer", "shield-check", "carriers.html"],
      ["customers", "Customers", "user", "customers.html"],
      ["workbench", "Transaction workbench", "git-branch", "workbench.html"],
      // ["documents", "Documents", "file-check-2", "documents.html"],
      // ["loyalty", "Loyalty", "award", "loyalty.html"],
      // ["terms", "Terms & Conditions", "edit-3", "terms.html"],
    ] },
    { label: "Reference", items: [
      ["domain-model", "Domain model", "git-branch", "domain-model.html"],
      ["data-model", "Data model", "database", "data-model.html"],
      ["api-reference", "API reference", "braces", "api-reference.html"],
      ["architecture", "Architecture", "layers", "architecture.html"],
    ] },
    { label: "Admin", items: [["admin-config", "Admin Configuration", "key-round", "admin-config.html"]] },
  ];

  /* Per-page metadata: which nav item to highlight + the breadcrumb title.
     Detail/decision pages point `nav` at their parent desk, mirroring the old PARENT_OF map —
     this is also the key used to look up PAS.PAGE_APIS for the API-lifecycle panel. */
  PAS.PAGE_META = {
    dashboard: { nav: "dashboard", title: "Workspace / Dashboard" },
    approvals: { nav: "approvals", title: "Workspace / Pending approvals" },
    "admin-config": { nav: "admin-config", title: "Workspace / Admin Configuration" },
    "uw-desk": { nav: "uw-desk", title: "Decision desks / Underwriting" },
    "uw-detail": { nav: "uw-desk", title: "Decision desks / Underwriting" },
    "issue-desk": { nav: "issue-desk", title: "Decision desks / Issue" },
    "issue-detail": { nav: "issue-desk", title: "Decision desks / Issue" },
    "endorsement-desk": { nav: "endorsement-desk", title: "Decision desks / Endorsements" },
    "endorsement-detail": { nav: "endorsement-desk", title: "Decision desks / Endorsements" },
    "cancellation-desk": { nav: "cancellation-desk", title: "Decision desks / Cancellation" },
    "cancel-detail": { nav: "cancellation-desk", title: "Decision desks / Cancellation" },
    "reinstatement-desk": { nav: "reinstatement-desk", title: "Decision desks / Reinstatement" },
    "reinstate-detail": { nav: "reinstatement-desk", title: "Decision desks / Reinstatement" },
    "renewal-desk": { nav: "renewal-desk", title: "Decision desks / Renewal" },
    "renew-detail": { nav: "renewal-desk", title: "Decision desks / Renewal" },
    "servicing-desk": { nav: "servicing-desk", title: "Decision desks / Servicing" },
    "servicing-detail": { nav: "servicing-desk", title: "Decision desks / Servicing" },
    "transfer-desk": { nav: "transfer-desk", title: "Decision desks / Transfer" },
    "transfer-detail": { nav: "transfer-desk", title: "Decision desks / Transfer" },
    registry: { nav: "registry", title: "Records / Policy register" },
    detail: { nav: "registry", title: "Records / Policy detail" },
    brokers: { nav: "brokers", title: "Records / Brokers" },
    mgas: { nav: "mgas", title: "Records / MGA" },
    carriers: { nav: "carriers", title: "Records / Reinsurer" },
    customers: { nav: "customers", title: "Records / Customers" },
    workbench: { nav: "workbench", title: "Records / Transaction workbench" },
    documents: { nav: "documents", title: "Records / Documents" },
    loyalty: { nav: "loyalty", title: "Records / Loyalty" },
    terms: { nav: "terms", title: "Records / Terms & Conditions" },
    "domain-model": { nav: "domain-model", title: "Reference / Domain model" },
    "data-model": { nav: "data-model", title: "Reference / Data model" },
    "api-reference": { nav: "api-reference", title: "Reference / API reference" },
    architecture: { nav: "architecture", title: "Reference / Architecture" },
  };

  /* Detail page URL for each desk key, and the reverse. */
  PAS.DETAIL_URL_OF = {
    "uw-desk": "underwriting-decision.html", "issue-desk": "issue-decision.html",
    "endorsement-desk": "endorsement-decision.html", "cancellation-desk": "cancellation-decision.html",
    "reinstatement-desk": "reinstatement-decision.html", "renewal-desk": "renewal-decision.html",
    "servicing-desk": "servicing-decision.html", "transfer-desk": "transfer-decision.html",
  };
  PAS.DESK_URL_OF = {
    "uw-desk": "underwriting.html", "issue-desk": "issue.html", "endorsement-desk": "endorsement.html",
    "cancellation-desk": "cancellation.html", "reinstatement-desk": "reinstatement.html",
    "renewal-desk": "renewal.html", "servicing-desk": "servicing.html", "transfer-desk": "transfer.html",
  };
  /* Which desk owns the decision for each held transaction type — used by the cross-type
     Pending Approvals index to route to the right decision page. */
  PAS.TYPE_TO_DESK = { Underwriting: "uw-desk", Endorsement: "endorsement-desk", Cancellation: "cancellation-desk", Renewal: "renewal-desk", Reinstatement: "reinstatement-desk", Transfer: "transfer-desk" };

  /* ================= roles ================= */
  /* Roles are admin-manageable, not hardcoded: seeded with four defaults the first time this
     loads, then persisted to sessionStorage (`pas.rolesConfig.v1`) exactly like policies/terms —
     an admin's edits and any custom roles they add survive navigation for the rest of the demo
     session (see Admin Configuration). PAS.ROLES is a live snapshot of that store, reassigned on
     every load/save so every existing call site that reads PAS.ROLES[key] — the role-switcher
     panel, scopePolicies, the dashboards, the Domain Model directory — keeps working unchanged.
       "Nav visibility" is now literally per-role: `visibleNav` lists exactly which PAS.NAV keys
     a role can see, replacing the old static allow/deny map; layout.js filters the sidebar
     against it directly. The literal string "*" (rather than an array) means "every nav key,
     including ones added later" — used by Super Admin/Admin so they stay genuinely full-access
     even as pas-extensions.js (loaded right after this file) appends more nav groups/items of its
     own; an explicit array taken here would go stale the moment that happens. canDecide/canRequest
     stay editable/documentary — this prototype's permission boundary has always been "hidden from
     nav", not a real per-action check (see the callout on Domain Model), and that stays true here
     too. */
  var ALL_NAV_KEYS = [];
  PAS.NAV.forEach(function (g) { g.items.forEach(function (it) { ALL_NAV_KEYS.push(it[0]); }); });
  var OPS_DESK_KEYS = ["endorsement-desk", "cancellation-desk", "reinstatement-desk", "renewal-desk", "servicing-desk", "transfer-desk"];
  var BROKER_NAV = ALL_NAV_KEYS.filter(function (k) { return ["approvals", "terms", "admin-config"].indexOf(k) === -1; });
  var MGA_NAV = ALL_NAV_KEYS.filter(function (k) { return OPS_DESK_KEYS.concat(["approvals", "terms", "admin-config"]).indexOf(k) === -1; });

  var DEFAULT_ROLES = {
    "Super Admin": {
      label: "Super Admin", icon: "shield-check", tone: "violet", identity: "A. Bennett",
      scope: "all", canDecide: true, canRequest: true, canManageUsers: true, canManageRoles: true,
      visibleNav: "*", isSystem: true,
      desc: "Full operational access — every desk, every policy, every decision — plus role, permission and user management.",
    },
    Admin: {
      label: "Admin", icon: "clipboard-check", tone: "indigo", identity: "R. Alvarez",
      scope: "all", canDecide: true, canRequest: true, canManageUsers: true, canManageRoles: true,
      visibleNav: "*", isSystem: true,
      desc: "The same full access as Super Admin by default — a separate role so it can be scoped down later without touching Super Admin itself.",
    },
    Broker: {
      label: "Broker", icon: "users", tone: "amber", identity: "Apex Insurance Brokers",
      scope: "producer", canDecide: false, canRequest: true, canManageUsers: false, canManageRoles: false,
      visibleNav: BROKER_NAV, isSystem: true,
      desc: "The business this producer placed, and nothing else. Can raise a request (a cancellation, an endorsement); cannot decide one.",
    },
    MGA: {
      label: "MGA", icon: "building-2", tone: "green", identity: "Cornerstone MGA Partners",
      scope: "mga", canDecide: false, canRequest: false, canManageUsers: false, canManageRoles: false,
      visibleNav: MGA_NAV, isSystem: true,
      desc: "The business placed through this MGA, and nothing else. Read-only, and genuinely scoped to its own book — an MGA sees its own business; decisions stay with an admin.",
    },
    Carrier: {
      label: "Carrier", icon: "shield-check", tone: "blue", identity: "Meridian Assurance Co.",
      scope: "carrier", canDecide: false, canRequest: false, canManageUsers: false, canManageRoles: false,
      visibleNav: MGA_NAV, isSystem: true,
      desc: "The business written on this carrier's own paper, and nothing else — its new business trend, loss activity and reserves, not Veridex's whole book. Read-only, with visibility into both the MGA and Broker layers underneath it.",
    },
  };

  var ROLES_KEY = "pas.rolesConfig.v1";
  function loadRolesConfig() {
    var raw;
    try { raw = sessionStorage.getItem(ROLES_KEY); } catch (e) { raw = null; }
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through to reseed */ } }
    saveRolesConfig(DEFAULT_ROLES);
    return DEFAULT_ROLES;
  }
  function saveRolesConfig(map) {
    try { sessionStorage.setItem(ROLES_KEY, JSON.stringify(map)); } catch (e) { /* storage unavailable */ }
    PAS.ROLES = map;
  }
  PAS.ROLES = loadRolesConfig();
  PAS.getRolesConfig = function () { return loadRolesConfig(); };
  PAS.saveRole = function (key, spec) {
    var map = loadRolesConfig();
    map[key] = Object.assign({}, map[key], spec);
    saveRolesConfig(map);
    return map[key];
  };
  PAS.deleteRole = function (key) {
    var map = loadRolesConfig();
    var spec = map[key];
    if (!spec) return { allowed: false, reason: "Role does not exist." };
    if (spec.isSystem) return { allowed: false, reason: "Default roles can't be deleted — edit its permissions instead." };
    var remainingManagers = Object.keys(map).filter(function (k) { return k !== key && map[k].canManageRoles; });
    if (spec.canManageRoles && remainingManagers.length === 0) return { allowed: false, reason: "Can't delete the last role that can manage roles — that would lock everyone out of this screen." };
    delete map[key];
    saveRolesConfig(map);
    if (PAS.getRole() === key) PAS.setRole("Super Admin");
    return { allowed: true };
  };

  var ROLE_KEY = "pas.role.v1";
  PAS.getRole = function () {
    var r;
    try { r = sessionStorage.getItem(ROLE_KEY); } catch (e) { r = null; }
    return (r && PAS.ROLES[r]) ? r : "Super Admin";
  };
  PAS.setRole = function (role) {
    if (!PAS.ROLES[role]) return;
    try { sessionStorage.setItem(ROLE_KEY, role); } catch (e) { /* ignore */ }
  };

  /* An acting identity lets "View as" scope the platform to one specific invited user's own book
     instead of just their role's shared demo identity — e.g. two different Brokers, each genuinely
     scoped to a different book. Falls back to the role's own identity when nothing is overridden. */
  var IDENTITY_OVERRIDE_KEY = "pas.identityOverride.v1";
  PAS.getActingIdentity = function () {
    var spec = PAS.ROLES[PAS.getRole()];
    var override;
    try { override = sessionStorage.getItem(IDENTITY_OVERRIDE_KEY); } catch (e) { override = null; }
    return override || (spec && spec.identity);
  };
  PAS.setActingIdentity = function (identity) {
    try {
      if (identity) sessionStorage.setItem(IDENTITY_OVERRIDE_KEY, identity);
      else sessionStorage.removeItem(IDENTITY_OVERRIDE_KEY);
    } catch (e) { /* ignore */ }
  };

  /* A policy belongs to the current identity if the matching field equals it — real scoping, not
     a fake filter, since producer/mga/carrier/holder are already on every seed record. */
  PAS.scopePolicies = function (policies, role) {
    var spec = PAS.ROLES[role];
    if (!spec || spec.scope === "all") return policies;
    if (spec.scope === "none") return [];
    var identity = PAS.getActingIdentity();
    if (spec.scope === "producer") return policies.filter(function (p) { return p.producer === identity; });
    if (spec.scope === "mga") return policies.filter(function (p) { return p.mga === identity; });
    if (spec.scope === "carrier") return policies.filter(function (p) { return p.carrier === identity; });
    if (spec.scope === "holder") return policies.filter(function (p) { return p.holder === identity; });
    return policies;
  };
  /* The book, pre-scoped to the current role — what every desk list/register/workbench page
     should build its table from, so a Broker or MGA only ever sees their own book in a list, not
     just on the dashboard. `PAS.getPolicies()` itself stays the raw/unscoped accessor for pages
     that legitimately need the whole book (reference/documentation screens, per-entity rollups). */
  PAS.getScopedPolicies = function () { return PAS.scopePolicies(PAS.getPolicies(), PAS.getRole()); };

  /* ================= users (invited, not authenticated) ================= */
  /* No real backend exists to send mail from, so "invite" is simulated: a row is added with
     status "Invited" and the action is logged through PAS.api.call like every other write in this
     app, but nothing is actually emailed. See Admin Configuration's Users tab. */
  var USERS_KEY = "pas.users.v1";
  function loadUsers() {
    var raw;
    try { raw = sessionStorage.getItem(USERS_KEY); } catch (e) { raw = null; }
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through */ } }
    return [];
  }
  function saveUsers(list) {
    try { sessionStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  PAS.getUsers = function () { return loadUsers(); };
  PAS.inviteUser = function (data) {
    var list = loadUsers();
    var user = {
      id: uid("USR"), name: data.name, email: data.email, roleKey: data.roleKey,
      identity: data.identity || (PAS.ROLES[data.roleKey] || {}).identity || "",
      status: "Invited", invitedOn: todayISO(),
    };
    list = [user].concat(list);
    saveUsers(list);
    return user;
  };
  PAS.revokeUser = function (id) {
    saveUsers(loadUsers().filter(function (u) { return u.id !== id; }));
  };

  /* ================= persistence ================= */
  var STORAGE_KEY = "pas.policies.v1";

  function loadPolicies() {
    var raw;
    try { raw = sessionStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* fall through to reseed */ }
    }
    var seeded = seedPolicies();
    savePolicies(seeded);
    return seeded;
  }
  function savePolicies(list) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  function patch(id, fn) {
    var list = loadPolicies();
    var next = list.map(function (p) { return p.id === id ? fn(p) : p; });
    savePolicies(next);
    return next.find(function (p) { return p.id === id; });
  }
  function pushTxn(p, e) {
    var entry = Object.assign({ id: uid("TXN"), seq: p.history.length + 1, recordedAt: new Date().toISOString(), status: "Completed", user: "You" }, e);
    return Object.assign({}, p, { history: p.history.concat([entry]) });
  }

  /* ---------- decision audit (who / when / action / comment) ---------- */
  PAS.COMMENT_MIN_RECOMMENDED = 20;
  PAS.actorName = function () {
    return PAS.getActingIdentity() || "You";
  };
  PAS.makeAudit = function (action, comment) {
    return {
      at: new Date().toISOString(),
      user: PAS.actorName(),
      action: action,
      comment: String(comment || "").trim(),
    };
  };
  function withAudit(h, audit, extra) {
    extra = extra || {};
    var meta = Object.assign({}, h.meta, extra.meta || {});
    if (audit) {
      meta.decisionHistory = ((h.meta && h.meta.decisionHistory) || []).concat([audit]);
      meta.lastDecision = audit;
    }
    var next = Object.assign({}, h, extra, { meta: meta });
    if (audit) { next.user = audit.user; next.approvedBy = audit.user; }
    return next;
  }
  PAS.decisionTrailFor = function (p, txnId) {
    var rows = [];
    var held = txnId ? p.history.find(function (h) { return h.id === txnId; }) : null;
    var typeFilter = held ? held.type : null;

    if (held && held.meta && held.meta.requestNote) {
      rows.push({
        at: held.recordedAt || (held.meta.submittedOn ? held.meta.submittedOn + "T12:00:00.000Z" : null),
        user: held.meta.initiatedBy || held.user || "Requester",
        action: "Request",
        comment: held.meta.requestNote,
        category: held.meta.category,
      });
    }

    function pushUnique(a) {
      if (!a || !a.comment) return;
      var dup = rows.some(function (r) {
        return r.action === a.action && r.comment === a.comment && r.at === a.at;
      });
      if (!dup) rows.push(a);
    }

    if (held && held.meta && held.meta.decisionHistory) {
      held.meta.decisionHistory.forEach(pushUnique);
    }

    (p.history || []).forEach(function (h) {
      if (typeFilter && h.type !== typeFilter) return;
      if (h.meta && h.meta.decisionHistory) h.meta.decisionHistory.forEach(pushUnique);
      if (h.meta && h.meta.noteOnly && h.meta.audit) pushUnique(h.meta.audit);
      if (h.meta && h.meta.audit && !h.meta.noteOnly) pushUnique(h.meta.audit);
    });

    rows.sort(function (a, b) {
      var ta = a.at ? new Date(a.at).getTime() : 0;
      var tb = b.at ? new Date(b.at).getTime() : 0;
      return ta - tb;
    });
    return rows;
  };
  /* Escalate / Request More Information: stamp the held row, append a completed note, leave status Pending.
     emailTo is optional — when the decision modal's email field was filled in, the notification note
     rides along on the same audit comment (so it shows up in the existing Decision trail for free,
     no separate UI needed) and the address itself is kept on the txn's own meta too. There is no real
     mail transport here — a static frontend can't originate SMTP — this simulates the notification
     step the way the rest of the ledger narrates other backend effects (e.g. "policyEndorsed event
     published") without a live integration behind it. */
  /* Routing category for Escalations and Requests — one dropdown instead of a separate button per
     issue type, per the MOM 2026-08-26 feedback ("so users can route issues correctly without
     needing multiple buttons/options"). Shared across both surfaces (the Escalate/Request-more-
     information modal on every decision desk, and the "Log a request" form) so a category means
     the same thing everywhere it's used, rather than each desk inventing its own list. Distinct
     from the Servicing desk's own category list (store.js's SLA-driven service-request types,
     defined in servicing-decision.js) — that one classifies the servicing action itself; this one
     routes who should be looking at it. */
  PAS.ISSUE_CATEGORIES = ["Underwriting", "Billing & Payments", "Claims", "Compliance", "Technical / System", "Customer Service", "Other"];

  PAS.recordHeldDecision = function (id, txnId, action, comment, typeHint, emailTo, category) {
    var noteText = comment + (emailTo ? "\n\nNotification emailed to " + emailTo + " via SMTP." : "");
    var audit = PAS.makeAudit(action, noteText);
    if (category) audit.category = category;
    return patch(id, function (p) {
      var held = txnId ? p.history.find(function (h) { return h.id === txnId; }) : null;
      var history = held
        ? p.history.map(function (h) { return h.id === txnId ? withAudit(h, audit) : h; })
        : p.history;
      var meta = { audit: audit, noteOnly: true };
      if (emailTo) meta.emailTo = emailTo;
      if (category) meta.category = category;
      return pushTxn(Object.assign({}, p, { history: history }), {
        date: todayISO(), type: (held && held.type) || typeHint || "Underwriting",
        title: ((held && held.type) || typeHint || "Underwriting") + ": " + action,
        detail: audit.comment, user: audit.user,
        meta: meta,
      });
    });
  };
  var FLASH_KEY = "pas.flash.v1";
  PAS.setFlash = function (note) {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify(note)); } catch (e) { /* ignore */ }
  };
  PAS.takeFlash = function () {
    var raw;
    try { raw = sessionStorage.getItem(FLASH_KEY); sessionStorage.removeItem(FLASH_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  PAS.DECISION_WARNINGS = {
    Approve: "This applies the decision to the policy. It cannot be easily undone — a reversal is a new compensating ledger entry and does not unwind premium or status automatically.",
    Decline: "This rejects the request. The policy is left as it stands. The comment is retained for disclosure and audit and cannot be edited later.",
    Escalate: "This does not decide the file. It records an escalation to a senior underwriter and leaves the request pending.",
    "Request More Information": "This does not decide the file. It records a request for information and leaves the request pending until the file is complete.",
    Issue: "Issuing creates the formal contract and generates documents. Cover moves from provisional to in-force. This cannot be easily reversed.",
  };

  PAS.getPolicies = loadPolicies;
  PAS.getPolicy = function (id) { return loadPolicies().find(function (p) { return p.id === id; }); };
  PAS.resetDemoData = function () {
    try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem("pas.api.v1"); sessionStorage.removeItem(FLASH_KEY); } catch (e) { /* ignore */ }
    location.href = "index.html";
  };
  /* The record's real lifecycle status (7 values) is what every rule in this app keys off of —
     this is only a coarser 4-bucket *display* grouping layered on top, shared by every screen
     that lists policies (Policy Register, and the Brokers/MGA/Carrier/Customer detail tables). */
  PAS.STATUS_BUCKETS = ["Active", "On Hold", "Expired", "Canceled"];
  PAS.BUCKET_TONE = { Active: "green", "On Hold": "amber", Expired: "gray", Canceled: "red" };
  PAS.statusBucket = function (status) {
    if (status === "Active") return "Active";
    if (status === "Referred" || status === "Bound") return "On Hold";
    if (status === "Cancelled" || status === "Declined") return "Canceled";
    return "Expired"; /* Expired, Non-renewed */
  };
  /* Display labels for the 4 buckets above — real PAS terms, same idea as PAS.STATUS_LABELS. The
     bucket keys themselves (Active/On Hold/Expired/Canceled) stay untouched: they're the literal
     `?status=` querystring value on cross-page links (e.g. the Dashboard's "Active policies" KPI
     links to registry.html?status=Active) and the <option value> the Policy Register's own filter
     compares against, so renaming the keys would break both — only the visible text changes. */
  PAS.BUCKET_LABELS = { Active: "Policy Issued", "On Hold": "Pending", Expired: "Expired", Canceled: "Closed" };
  PAS.bucketLabel = function (bucket) { return PAS.BUCKET_LABELS[bucket] || bucket; };
  PAS.pendingOf = function (policies, type) {
    return policies.reduce(function (acc, p) {
      p.history.filter(function (h) { return h.type === type && h.status === "Pending"; })
        .forEach(function (h) { acc.push({ p: p, h: h }); });
      return acc;
    }, []);
  };
  PAS.allTxns = function (policies) {
    return policies.reduce(function (acc, p) { p.history.forEach(function (h) { acc.push({ p: p, h: h }); }); return acc; }, [])
      .sort(function (a, b) { return a.h.recordedAt < b.h.recordedAt ? 1 : -1; });
  };
  /* Real wall-clock, not the frozen demo "today" — recordedAt on a live-triggered auto-issue is
     always `new Date().toISOString()` (see pushTxn), so comparing against real Date.now() is what
     makes "issued in the last 24 hours" actually light up the moment the pipeline runs, rather
     than depending on how far the demo calendar has drifted from the real one. */
  PAS.autoIssuedSince = function (policies, sinceMs) {
    return policies.reduce(function (acc, p) {
      p.history.filter(function (h) { return h.type === "Issuance" && h.meta && h.meta.automated && new Date(h.recordedAt).getTime() >= sinceMs; })
        .forEach(function (h) { acc.push({ p: p, h: h }); });
      return acc;
    }, []).sort(function (a, b) { return a.h.recordedAt < b.h.recordedAt ? 1 : -1; });
  };

  /* ================= mutations (ported 1:1 from the React app's state updaters) ================= */
  /* Issue is automated: nothing waits on a manual click any more. `issueGatesPass` is the exact
     five-gate check issue-decision.js renders (status Bound, binder not expired, every
     subjectivity met, compliance clear, template available — the last two are always true in
     this prototype, no real screening/template registry exists yet). The moment those gates are
     true — at bind, if the binder starts with nothing outstanding, or the instant the last
     subjectivity is cleared — `doIssue` runs on its own. PAS.issuePolicy stays as a manual
     fallback for the Issue desk button, for the rare case gates were true but nothing triggered
     the automatic path (e.g. a subjectivity satisfied through a channel other than this app). */
  function issueGatesPass(p) {
    if (p.status !== "Bound" || !p.binder) return false;
    if (daysBetween(todayISO(), p.binder.expiryDate) < 0) return false;
    return ((p.binder.subjectivities || []).filter(function (s) { return !s.met; })).length === 0;
  }
  PAS.issueGatesPass = issueGatesPass;
  /* A policy can clear every issue gate and still not auto-issue — premium above this line
     needs a human to actually look at the file before the contract goes out the door. Same
     $500K line the endorsement desk already uses for mandatory Carrier-level approval, so
     "large enough that automation alone isn't enough" means one consistent thing app-wide. */
  PAS.AUTO_ISSUE_PREMIUM_LIMIT = Math.round(500000 * PREMIUM_SCALE);
  PAS.requiresManualIssue = function (p) { return (p.premium || 0) > PAS.AUTO_ISSUE_PREMIUM_LIMIT; };
  function doIssue(p, automated) {
    var t = pushTxn(p, {
      date: todayISO(), type: "Issuance",
      title: automated ? "Policy issued — automatically" : "Policy issued",
      detail: automated
        ? "All issue gates cleared with nothing outstanding — the system issued the policy without a manual Issue click. Schedule and certificate generated and stored."
        : "Formal contract issued. Schedule and certificate generated and stored.",
      meta: automated ? { automated: true } : {},
    });
    return Object.assign({}, t, {
      status: "Active",
      /* A pre-issue Quote/Application (the placeholder backfilled onto every Referred/Bound
         record so nothing shows zero documents) is superseded the moment the real contract
         issues — it doesn't belong on an Active policy's document list alongside the actual
         schedule and certificate. */
      documents: (p.documents || []).filter(function (d) { return d.type !== "Quote" && d.type !== "Application"; }).concat([
        { id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: todayISO(), type: "Schedule" },
        { id: uid("DOC"), name: "Certificate of insurance", version: 1, generatedAt: todayISO(), type: "Certificate" },
      ]),
    });
  }
  PAS.decide = function (id, outcome, meta) {
    meta = meta || {};
    var audit = meta.audit || (meta.note ? PAS.makeAudit(outcome, meta.note) : PAS.makeAudit(outcome, ""));
    return patch(id, function (p) {
      var withCompleted = Object.assign({}, p, {
        history: p.history.map(function (h) {
          return (h.status === "Pending" && h.type === "Underwriting")
            ? withAudit(h, audit, { status: "Completed" })
            : h;
        }),
      });
      var t = pushTxn(withCompleted, { date: todayISO(), type: "Underwriting", title: "Underwriting: " + outcome, detail: audit.comment || ("Decided by underwriter. Score " + meta.score + ", " + meta.tier + "."), user: audit.user, meta: Object.assign({}, meta, { audit: audit }) });
      if (outcome === "Approve") {
        var bound = Object.assign({}, t, { status: "Bound", binder: { number: uid("BN"), boundOn: todayISO(), expiryDate: addDays(todayISO(), 30), subjectivities: [{ label: "Signed proposal form", met: true }] } });
        return (issueGatesPass(bound) && !PAS.requiresManualIssue(bound)) ? doIssue(bound, true) : bound;
      }
      if (outcome === "Decline") return Object.assign({}, t, { status: "Declined" });
      return t;
    });
  };
  PAS.issuePolicy = function (id, audit) {
    return patch(id, function (p) {
      var issued = doIssue(p, false);
      if (!audit) return issued;
      var last = issued.history[issued.history.length - 1];
      return Object.assign({}, issued, {
        history: issued.history.map(function (h, i) {
          return i === issued.history.length - 1 ? withAudit(h, audit, { detail: audit.comment ? (last.detail + " " + audit.comment) : last.detail }) : h;
        }),
      });
    });
  };
  PAS.toggleSubjectivity = function (id, i) {
    return patch(id, function (p) {
      var toggled = Object.assign({}, p, { binder: Object.assign({}, p.binder, { subjectivities: p.binder.subjectivities.map(function (s, j) { return j === i ? Object.assign({}, s, { met: !s.met }) : s; }) }) });
      return (issueGatesPass(toggled) && !PAS.requiresManualIssue(toggled)) ? doIssue(toggled, true) : toggled;
    });
  };
  /* Cancellation, Reinstatement, Renewal and Endorsement are never started by ops directly —
     they always begin as a Pending request, and only a separate decision step applies or
     rejects it. raiseRequest is the single entry point every "Log a request" form and every
     seed record goes through. */
  PAS.raiseRequest = function (id, type, meta) {
    return patch(id, function (p) {
      var submittedOn = meta.submittedOn || todayISO();
      var titles = { Cancellation: "Cancellation requested — awaiting decision", Renewal: "Renewal requested — awaiting decision", Reinstatement: "Reinstatement requested — awaiting decision", Endorsement: "Endorsement requested — awaiting decision", Transfer: "Transfer requested — awaiting decision" };
      var effDate = type === "Renewal" ? p.expirationDate : todayISO();
      var nextMeta = Object.assign({}, meta, { submittedOn: submittedOn });
      var title = titles[type];
      var detail = "Requested by " + meta.initiatedBy + " via " + meta.channel + ". \"" + meta.requestNote + "\"";
      /* Insurer-side cancellations with a statutory notice period begin as DNOC-required —
         the Direct Notice of Cancellation must be served before the cancel can complete. */
      if (type === "Cancellation" && requiresDnoc(meta.reason, meta.initiatedBy)) {
        nextMeta.requiresDnoc = true;
        title = "Cancellation initiated — DNOC required";
        detail = "Initiated by " + meta.initiatedBy + " for " + meta.reason + ". Direct Notice of Cancellation (DNOC) must be served; " +
          ((CANCEL_REASONS[meta.reason] || CANCEL_REASONS.Other).noticeDays) + " pending notice days must run before cancellation can complete.";
        var noticeDays = (CANCEL_REASONS[meta.reason] || CANCEL_REASONS.Other).noticeDays || 0;
        if (noticeDays > 0) {
          /* Planned DNOC expire is always strictly after submitted — never the same day. */
          effDate = addDays(submittedOn, noticeDays);
        }
      }
      return pushTxn(p, { date: effDate, type: type, status: "Pending", title: title,
        detail: detail,
        meta: nextMeta });
    });
  };
  PAS.decideCancellation = function (id, txnId, approve, effDate, q, audit) {
    if (PAS.clearDirty) PAS.clearDirty();
    return patch(id, function (p) {
      var held = p.history.find(function (h) { return h.id === txnId; });
      var meta = (held && held.meta) || {};
      if (approve && requiresDnoc(meta.reason || q.reason, meta.initiatedBy || q.initiatedBy)) {
        var st = dnocState(meta);
        if (!st.served || !st.ready) return p; /* cannot complete until DNOC pending days are zero */
      }
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        var detail = approve ? ("Approved. " + q.type + " basis, effective " + effDate + ". Refund " + money(q.refund) + ".") : ("Declined. Policy remains ACTIVE. " + h.detail);
        if (approve && meta.dnocServedOn) detail = "DNOC notice completed (" + meta.dnocServedOn + " → " + effDate + "). " + detail;
        if (audit && audit.comment) detail += " " + audit.comment;
        return withAudit(h, audit, {
          status: approve ? "Completed" : "Rejected", date: effDate,
          title: approve ? "Cancellation approved" : "Cancellation declined",
          detail: detail,
          meta: { cancelType: q.type, refund: Math.round(q.refund), dnocServedOn: meta.dnocServedOn || null },
        });
      });
      if (!approve) return Object.assign({}, p, { history: history });
      var noticeName = (meta.dnocServedOn || requiresDnoc(q.reason, q.initiatedBy))
        ? "Direct Notice of Cancellation"
        : "Cancellation notice";
      var alreadyHasDnoc = (p.documents || []).some(function (d) { return d.type === "DNOC" || d.name === "Direct Notice of Cancellation"; });
      var docs = p.documents || [];
      if (!alreadyHasDnoc) {
        docs = docs.concat([{ id: uid("DOC"), name: noticeName, version: 1, generatedAt: todayISO(), type: meta.dnocServedOn ? "DNOC" : "Notice", transactionId: txnId }]);
      } else if (noticeName === "Cancellation notice") {
        docs = docs.concat([{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: todayISO(), type: "Notice", transactionId: txnId }]);
      }
      return Object.assign({}, p, { history: history, status: "Cancelled", documents: docs });
    });
  };
  PAS.decideReinstatement = function (id, txnId, approve, m, audit) {
    if (PAS.clearDirty) PAS.clearDirty();
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        var detail = approve ? ("Reinstated after a " + m.gapDays + "-day lapse. Outstanding premium collected: " + money(m.outstanding) + ". Gap disclosure issued.") : ("Declined. Policy remains Cancelled. " + h.detail);
        if (audit && audit.comment) detail += " " + audit.comment;
        return withAudit(h, audit, {
          status: approve ? "Completed" : "Rejected",
          title: approve ? "Policy reinstated" : "Reinstatement declined",
          detail: detail,
          meta: m,
        });
      });
      return approve ? Object.assign({}, p, { history: history, status: "Active" }) : Object.assign({}, p, { history: history });
    });
  };
  PAS.decideRenewal = function (id, txnId, approve, prem, audit) {
    if (PAS.clearDirty) PAS.clearDirty();
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        var detail = approve ? ("Re-underwritten and renewed. Premium " + money(p.premium) + " → " + money(prem) + ".") : ("Declined. " + RENEWAL_LEAD_DAYS + "-day non-renewal notice served.");
        if (audit && audit.comment) detail += " " + audit.comment;
        return withAudit(h, audit, {
          status: approve ? "Completed" : "Rejected",
          title: approve ? ("Renewed into term " + (p.termNumber + 1)) : "Renewal declined — non-renewed",
          detail: detail,
          meta: { previousPremium: p.premium, newPremium: prem },
        });
      });
      if (approve) {
        return Object.assign({}, p, {
          history: history, termNumber: p.termNumber + 1, effectiveDate: p.expirationDate, expirationDate: addYears(p.expirationDate, 1), premium: prem,
          documents: (p.documents || []).concat([{ id: uid("DOC"), name: "Policy schedule", version: p.termNumber + 1, generatedAt: todayISO(), type: "Schedule" }]),
        });
      }
      return Object.assign({}, p, { history: history, status: "Non-renewed" });
    });
  };

  /* ---------- policy transfer — a change of named insured, with continuity preserved ----------
     Same policy ID, same ledger, same term dates and history — only the holder changes. This is
     the "Rewrite" transaction type named in docs/common.md's taxonomy but never built: a business
     sale, an ownership change, or an estate/inheritance transfer, modeled as a decision on the
     existing policy rather than cancel-and-rewrite-as-new-business, which would break the
     continuity chain the append-only ledger exists to preserve. */
  var TRANSFER_REASONS = ["Business Sale", "Ownership Change", "Estate/Inheritance", "Other"];
  PAS.TRANSFER_REASONS = TRANSFER_REASONS;
  PAS.decideTransfer = function (id, txnId, approve, newHolder, audit) {
    if (PAS.clearDirty) PAS.clearDirty();
    return patch(id, function (p) {
      var prevHolder = p.holder;
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        var detail = approve ? ("Named insured changed from \"" + prevHolder + "\" to \"" + newHolder + "\". Continuity preserved — same policy ID, same term, same ledger.") : ("Declined. Policy remains held by \"" + prevHolder + "\". " + h.detail);
        if (audit && audit.comment) detail += " " + audit.comment;
        return withAudit(h, audit, {
          status: approve ? "Completed" : "Rejected",
          title: approve ? ("Transferred to " + newHolder) : "Transfer declined",
          detail: detail,
          meta: { previousHolder: prevHolder, newHolder: newHolder },
        });
      });
      if (!approve) return Object.assign({}, p, { history: history });
      return Object.assign({}, p, {
        history: history, holder: newHolder,
        documents: (p.documents || []).concat([{ id: uid("DOC"), name: "Policy schedule", version: (p.documents || []).filter(function (d) { return d.name === "Policy schedule"; }).length + 1, generatedAt: todayISO(), type: "Schedule" }]),
      });
    });
  };
  PAS.logService = function (id, m) {
    return patch(id, function (p) {
      return pushTxn(p, { date: todayISO(), type: "Servicing", title: "Service request logged", detail: m.notes, meta: { category: m.category, channel: m.channel, sla: m.sla } });
    });
  };
  PAS.generateDoc = function (id, name, type) {
    return patch(id, function (p) {
      return Object.assign({}, p, { documents: (p.documents || []).concat([{ id: uid("DOC"), name: name, version: (p.documents || []).filter(function (d) { return d.name === name; }).length + 1, generatedAt: todayISO(), type: type }]) });
    });
  };
  PAS.decideTxn = function (pid, tid, ok, audit) {
    if (PAS.clearDirty) PAS.clearDirty();
    return patch(pid, function (p) {
      var held = p.history.find(function (h) { return h.id === tid; });
      if (!held) return p;
      var premiumDelta = ok ? ((held.meta && held.meta.premiumImpact) || 0) : 0;
      var outcomeText = ok
        ? ("Approved and applied." + (premiumDelta ? (" Premium adjusted " + (premiumDelta >= 0 ? "+" : "") + money(premiumDelta) + ".") : ""))
        : "Declined.";
      var detail = /HELD[^.]*\./.test(held.detail) ? held.detail.replace(/HELD[^.]*\./, outcomeText) : (held.detail + " " + outcomeText);
      if (audit && audit.comment) detail += " " + audit.comment;
      return Object.assign({}, p, {
        premium: p.premium + premiumDelta,
        history: p.history.map(function (h) {
          return h.id === tid ? withAudit(h, audit, { status: ok ? "Completed" : "Rejected", detail: detail }) : h;
        }),
      });
    });
  };
  PAS.reverseTxn = function (pid, tid) {
    return patch(pid, function (p) {
      var o = p.history.find(function (h) { return h.id === tid; });
      if (!o) return p;
      var newHistory = p.history.map(function (h) { return h.id === tid ? Object.assign({}, h, { status: "Reversed" }) : h; });
      newHistory = newHistory.concat([{ id: uid("TXN"), seq: p.history.length + 1, date: todayISO(), recordedAt: new Date().toISOString(), status: "Completed", user: "You", type: o.type, title: "Reversal of " + o.title, detail: "Compensating reversal of transaction #" + o.seq + ". The original row is retained unchanged.", meta: Object.assign({}, o.meta, { reversal: true }) }]);
      return Object.assign({}, p, { history: newHistory });
    });
  };
})(window);
