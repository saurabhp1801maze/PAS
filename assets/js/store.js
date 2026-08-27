/* Data + business-logic layer. Ported 1:1 from the original React app's App.jsx
   (seedPolicies, cancelQuote, riskScore, underwritingDecision, renewalCompliance,
   reinstatementEligibility, and every mutation function). Policies are persisted to
   sessionStorage so state survives navigation between the separate HTML pages. */
(function (global) {
  "use strict";
  var PAS = global.PAS = global.PAS || {};

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
  var money = function (n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); };
  var moneyShort = function (n) {
    return n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M"
      : n >= 1000 ? "$" + (n / 1000).toFixed(1) + "K" : money(n);
  };
  var fmtTime = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };

  PAS.uid = uid; PAS.todayISO = todayISO; PAS.addDays = addDays; PAS.addYears = addYears; PAS.daysBetween = daysBetween;
  PAS.money = money; PAS.moneyShort = moneyShort; PAS.fmtTime = fmtTime;

  var REINSTATEMENT_WINDOW_DAYS = 45;
  /* 45 days matches the NAIC model act's nonrenewal-notice convention (most states require at
     least 45 days before expiration; a minority require 30, a few go to 60-75 for specific
     lines), so it's a defensible single number for a prototype that isn't state-specific. */
  var RENEWAL_LEAD_DAYS = 45;
  /* A regional underwriter's delegated binding authority, not a regulatory figure — $250,000 of
     premium is a realistic single-account ceiling before a submission has to go to a senior
     underwriter in a US P&C shop. */
  var AUTHORITY_LIMIT = 250000;
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
  var CANCEL_TYPES = {
    Flat: {
      tone: "blue", penaltyPct: 0, basis: "written",
      when: "Effective on or before the policy's own inception date — the insurer was never on risk.",
      rate: "Full written premium returned. No penalty, regardless of reason or who initiated it.",
      rule: "Only valid when the effective date is on or before the policy inception date.",
    },
    "Pro-Rata": {
      tone: "green", penaltyPct: 0, basis: "unearned",
      when: "The cancellation was initiated by the Carrier, an MGA or the System, or the reason itself carries no penalty by right.",
      rate: "Full unearned premium returned, in exact proportion to the unused term. No penalty.",
      rule: "An insurer-side initiator (Reinsurer, MGA, System) may never carry a short-rate penalty — Type downgrades to this even if the Reason's default is Short-Rate.",
    },
    "Short-Rate": {
      tone: "amber", penaltyPct: 0.1, basis: "unearned",
      when: "A voluntary exit initiated by the Insured or a Broker.",
      rate: "Unearned premium minus a 10% short-rate penalty covering the insurer's acquisition cost.",
      rule: "Never applied when Initiated By is Carrier, MGA or System — see Pro-Rata's rule.",
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

  /* "Where permitted" (MOM 2026-08-26): Type stays derived by default, but a decision-maker can
     override it — never into a combination the domain rule itself forbids. Flat is only ever
     valid when the effective date lands at/before inception (the insurer was never on risk); an
     insurer-side initiator (Reinsurer/MGA/System) can never carry a Short-Rate penalty. An
     override that would violate either rule is simply not valid — the UI never offers it, and
     cancelQuote silently falls back to the real derived type if one ever slipped through. */
  function isValidCancelType(type, initiatedBy, atInception) {
    if (!CANCEL_TYPES[type]) return false;
    if (atInception) return type === "Flat";
    if (type === "Flat") return false;
    if (type === "Short-Rate" && CANCEL_INSURER_SIDE[initiatedBy]) return false;
    return true;
  }
  PAS.isValidCancelType = isValidCancelType;

  /* Everything about a cancellation follows from these four attributes plus dates. Nothing is
     hand-keyed, unless a decision-maker has explicitly overridden Type (meta.typeOverride) — and
     even then, only within what isValidCancelType allows. */
  function cancelQuote(policy, reason, initiatedBy, effectiveDate, meta) {
    meta = meta || {};
    var reasonSpec = CANCEL_REASONS[reason] || CANCEL_REASONS.Other;
    var totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
    var atInception = effectiveDate <= policy.effectiveDate;
    var derivedType = deriveCancelType(reason, initiatedBy, atInception);
    var overrideValid = !!meta.typeOverride && isValidCancelType(meta.typeOverride, initiatedBy, atInception);
    var type = overrideValid ? meta.typeOverride : derivedType;
    var overridden = overrideValid && type !== derivedType;
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
      type: type, derivedType: derivedType, overridden: overridden, atInception: atInception,
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
     where permitted"). "Where permitted" means two things at once: only a role that can already
     decide this desk may call it (a UI-layer gate — see cancellation-decision.js), and even then
     only into a type isValidCancelType still allows for this reason/initiator/date. Refused
     outright rather than silently clamped, so a caller can't mistake a no-op for success. */
  PAS.setCancelTypeOverride = function (policyId, txnId, type, comment) {
    var p = PAS.getPolicy(policyId);
    var held = p && p.history.find(function (h) { return h.id === txnId; });
    if (!held) return { allowed: false, reason: "Transaction not found." };
    var meta = held.meta || {};
    var atInception = (held.date || todayISO()) <= p.effectiveDate;
    if (!isValidCancelType(type, meta.initiatedBy, atInception)) {
      return { allowed: false, reason: type + " is not a valid type for this cancellation — the override was not applied." };
    }
    var audit = PAS.makeAudit("Override Type", comment || ("Type manually set to " + type + "."));
    patch(policyId, function (pp) {
      return Object.assign({}, pp, {
        history: pp.history.map(function (h) { return h.id === txnId ? withAudit(h, audit, { meta: { typeOverride: type } }) : h; }),
      });
    });
    return { allowed: true };
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
    "POL-2024-00187": [{ type: "Fire", status: "Closed", reportedOn: "2026-06-10", incurred: 8090, paid: 8090, reserved: 0 }],
    "POL-2025-09112": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-07-05", incurred: 14230, paid: 14230, reserved: 0 }],
    "POL-2026-00988": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: 140000, paid: 140000, reserved: 0 }],
    "POL-2026-03005": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-06-06", incurred: 786520, paid: 786520, reserved: 0 }],
    "POL-2026-03008": [{ type: "Windshield damage", status: "Closed", reportedOn: "2025-11-27", incurred: 509910, paid: 509910, reserved: 0 }],
    "POL-2026-03010": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-07-19", incurred: 421460, paid: 242490, reserved: 178970 }],
    "POL-2026-03012": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-07-11", incurred: 169390, paid: 169390, reserved: 0 }],
    "POL-2026-0435": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-04-28", incurred: 1664550, paid: 1664550, reserved: 0 }],
    "POL-2026-0437": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-05-06", incurred: 25590, paid: 25590, reserved: 0 }],
    "POL-2026-0440": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-08-14", incurred: 309400, paid: 309400, reserved: 0 }],
    "POL-2026-0444": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-20", incurred: 20190, paid: 20190, reserved: 0 }],
    "POL-2026-0457": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-03-22", incurred: 3760, paid: 3760, reserved: 0 }],
    "POL-2026-0465": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-27", incurred: 11900, paid: 11900, reserved: 0 }],
    "POL-2026-0467": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-06-23", incurred: 370230, paid: 370230, reserved: 0 }],
    "POL-2026-0468": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-07-08", incurred: 461310, paid: 461310, reserved: 0 }],
    "POL-2026-0469": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-02-01", incurred: 525990, paid: 525990, reserved: 0 }],
    "POL-2026-0470": [{ type: "Storm damage", status: "Open", reportedOn: "2026-07-01", incurred: 473610, paid: 157070, reserved: 316540 }],
    "POL-2026-0487": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-11", incurred: 8970, paid: 8970, reserved: 0 }],
    "POL-2026-0492": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-08-04", incurred: 159470, paid: 159470, reserved: 0 }],
    "POL-2026-0496": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-07-22", incurred: 687160, paid: 687160, reserved: 0 }],
    "POL-2026-0512": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-28", incurred: 8620, paid: 8620, reserved: 0 }],
    "POL-2026-0522": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-01-29", incurred: 421170, paid: 204360, reserved: 216810 }],
    "POL-2026-0542": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-06-16", incurred: 603520, paid: 603520, reserved: 0 }],
    "POL-2026-0549": [{ type: "Collision", status: "Closed", reportedOn: "2026-07-29", incurred: 2220, paid: 2220, reserved: 0 }],
    "POL-2026-0552": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-08-20", incurred: 376220, paid: 376220, reserved: 0 }],
    "POL-2026-0593": [{ type: "Water damage", status: "Closed", reportedOn: "2026-08-18", incurred: 1498060, paid: 1498060, reserved: 0 }],
    "POL-2026-0604": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-01-19", incurred: 416780, paid: 416780, reserved: 0 }],
    "POL-2026-0609": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-07-20", incurred: 302630, paid: 174350, reserved: 128280 }],
    "POL-2026-0611": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-06-27", incurred: 336740, paid: 336740, reserved: 0 }],
    "POL-2026-0612": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-06-01", incurred: 8630, paid: 8630, reserved: 0 }],
    "POL-2026-0628": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-06-27", incurred: 248740, paid: 118700, reserved: 130040 }],
    "POL-2026-0638": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-16", incurred: 1550, paid: 1550, reserved: 0 }],
    "POL-2026-0643": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-08-18", incurred: 16230, paid: 16230, reserved: 0 }],
    "POL-2026-0670": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-07-10", incurred: 2080, paid: 2080, reserved: 0 }],
    "POL-2026-0674": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-07-16", incurred: 517140, paid: 517140, reserved: 0 }],
    "POL-2026-0680": [{ type: "Fire", status: "Open", reportedOn: "2026-03-09", incurred: 38270, paid: 21220, reserved: 17050 }],
    "POL-2026-0681": [{ type: "Collision", status: "Open", reportedOn: "2026-08-10", incurred: 6100, paid: 2370, reserved: 3730 }],
    "POL-2026-0696": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-06-12", incurred: 642470, paid: 642470, reserved: 0 }],
    "POL-2026-0697": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-07-11", incurred: 112610, paid: 112610, reserved: 0 }],
    "POL-2026-0705": [{ type: "Death benefit", status: "Open", reportedOn: "2026-06-05", incurred: 11710, paid: 6320, reserved: 5390 }],
    "POL-2026-0709": [{ type: "Fire", status: "Open", reportedOn: "2026-03-24", incurred: 624200, paid: 194250, reserved: 429950 }],
    "POL-2026-0710": [{ type: "Collision", status: "Closed", reportedOn: "2026-03-24", incurred: 14890, paid: 14890, reserved: 0 }],
    "POL-2026-0712": [{ type: "Death benefit", status: "Closed", reportedOn: "2025-12-16", incurred: 100600, paid: 100600, reserved: 0 }],
    "POL-2026-0729": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-04-30", incurred: 746170, paid: 746170, reserved: 0 }],
    "POL-2026-0742": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-05-01", incurred: 143450, paid: 143450, reserved: 0 }],
    "POL-2026-0749": [{ type: "Theft", status: "Closed", reportedOn: "2026-06-25", incurred: 8530, paid: 8530, reserved: 0 }],
    "POL-2026-0758": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-04-11", incurred: 139340, paid: 139340, reserved: 0 }],
    "POL-2026-0773": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-08-07", incurred: 10160, paid: 10160, reserved: 0 }],
    "POL-2026-0777": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-05-13", incurred: 9730, paid: 9730, reserved: 0 }],
    "POL-2026-0793": [{ type: "Fire", status: "Closed", reportedOn: "2026-08-19", incurred: 127050, paid: 127050, reserved: 0 }],
    "POL-2026-0802": [{ type: "Theft", status: "Open", reportedOn: "2026-07-04", incurred: 14180, paid: 3340, reserved: 10840 }],
    "POL-2026-0803": [{ type: "Collision", status: "Closed", reportedOn: "2026-07-08", incurred: 9220, paid: 9220, reserved: 0 }],
    "POL-2026-0804": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-05-30", incurred: 790220, paid: 790220, reserved: 0 }],
    "POL-2026-0807": [{ type: "Collision", status: "Open", reportedOn: "2026-06-02", incurred: 12760, paid: 3030, reserved: 9730 }],
    "POL-2026-0834": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-03-03", incurred: 351090, paid: 351090, reserved: 0 }],
    "POL-2026-0836": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-13", incurred: 1330, paid: 1330, reserved: 0 }],
    "POL-2026-0838": [{ type: "Theft", status: "Closed", reportedOn: "2026-04-23", incurred: 20270, paid: 20270, reserved: 0 }],
    "POL-2026-0843": [{ type: "Theft", status: "Closed", reportedOn: "2026-03-03", incurred: 11060, paid: 11060, reserved: 0 }],
    "POL-2026-0851": [{ type: "Storm damage", status: "Closed", reportedOn: "2026-08-18", incurred: 1350630, paid: 1350630, reserved: 0 }],
    "POL-2026-0854": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-08-09", incurred: 39640, paid: 39640, reserved: 0 }],
    "POL-2026-0856": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-01-18", incurred: 145590, paid: 145590, reserved: 0 }],
    "POL-2026-0865": [{ type: "Collision", status: "Closed", reportedOn: "2026-04-17", incurred: 8350, paid: 8350, reserved: 0 }],
    "POL-2026-0868": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-06-30", incurred: 11210, paid: 11210, reserved: 0 }],
    "POL-2026-0874": [{ type: "Inpatient treatment", status: "Open", reportedOn: "2026-04-09", incurred: 304160, paid: 98330, reserved: 205830 }],
    "POL-2026-0876": [{ type: "Theft", status: "Closed", reportedOn: "2026-01-19", incurred: 15210, paid: 15210, reserved: 0 }],
    "POL-2026-0879": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-08-05", incurred: 151470, paid: 151470, reserved: 0 }],
    "POL-2026-0883": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-01-13", incurred: 753580, paid: 753580, reserved: 0 }],
    "POL-2026-0888": [{ type: "Machinery breakdown", status: "Open", reportedOn: "2026-06-25", incurred: 410900, paid: 180620, reserved: 230280 }],
    "POL-2026-0900": [{ type: "Wind damage", status: "Closed", reportedOn: "2026-08-21", incurred: 32460, paid: 32460, reserved: 0 }],
    "POL-2026-0911": [{ type: "Theft", status: "Closed", reportedOn: "2026-05-02", incurred: 45010, paid: 45010, reserved: 0 }],
    "POL-2026-0912": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-16", incurred: 2260, paid: 2260, reserved: 0 }],
    "POL-2026-0925": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-08-11", incurred: 568600, paid: 568600, reserved: 0 }],
    "POL-2026-0935": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-05-02", incurred: 334000, paid: 334000, reserved: 0 }],
    "POL-2026-0943": [{ type: "Water damage", status: "Closed", reportedOn: "2026-08-08", incurred: 23220, paid: 23220, reserved: 0 }],
    "POL-2026-0949": [{ type: "Theft", status: "Closed", reportedOn: "2026-08-18", incurred: 14340, paid: 14340, reserved: 0 }],
    "POL-2026-0977": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-03-16", incurred: 350740, paid: 350740, reserved: 0 }],
    "POL-2026-0979": [{ type: "Theft in transit", status: "Open", reportedOn: "2026-06-12", incurred: 596560, paid: 113830, reserved: 482730 }],
    "POL-2026-0980": [{ type: "Chronic condition management", status: "Open", reportedOn: "2026-08-07", incurred: 370170, paid: 82390, reserved: 287780 }],
    "POL-2026-0988": [{ type: "Theft", status: "Closed", reportedOn: "2026-07-21", incurred: 2020, paid: 2020, reserved: 0 }],
    "POL-2026-1013": [{ type: "Windshield damage", status: "Open", reportedOn: "2026-05-13", incurred: 15610, paid: 6110, reserved: 9500 }],
    "POL-2026-1029": [{ type: "Wind damage", status: "Open", reportedOn: "2026-08-16", incurred: 22540, paid: 6980, reserved: 15560 }],
    "POL-2026-1038": [{ type: "Fire", status: "Open", reportedOn: "2026-08-07", incurred: 424210, paid: 182840, reserved: 241370 }],
    "POL-2026-1039": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-06-10", incurred: 477690, paid: 477690, reserved: 0 }],
    "POL-2026-1042": [{ type: "Hail damage", status: "Closed", reportedOn: "2026-07-21", incurred: 6060, paid: 6060, reserved: 0 }],
    "POL-2026-1049": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2025-12-09", incurred: 178730, paid: 178730, reserved: 0 }],
    "POL-2026-1055": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-24", incurred: 1431410, paid: 1431410, reserved: 0 }],
    "POL-2026-1056": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-02-21", incurred: 102730, paid: 102730, reserved: 0 }],
    "POL-2026-1058": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-06-27", incurred: 286470, paid: 286470, reserved: 0 }],
    "POL-2026-1061": [{ type: "Surgical procedure", status: "Closed", reportedOn: "2026-04-24", incurred: 319930, paid: 319930, reserved: 0 }],
    "POL-2026-1063": [{ type: "Death benefit", status: "Closed", reportedOn: "2026-04-18", incurred: 10910, paid: 10910, reserved: 0 }],
    "POL-2026-1073": [{ type: "Fire", status: "Closed", reportedOn: "2026-08-23", incurred: 20320, paid: 20320, reserved: 0 }],
    "POL-2026-1079": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-08-16", incurred: 48430, paid: 48430, reserved: 0 }],
    "POL-2026-1083": [{ type: "Cargo damage", status: "Closed", reportedOn: "2026-06-09", incurred: 259800, paid: 259800, reserved: 0 }],
    "POL-2026-1091": [{ type: "Chronic condition management", status: "Open", reportedOn: "2026-08-14", incurred: 145260, paid: 78230, reserved: 67030 }],
    "POL-2026-1111": [{ type: "Chronic condition management", status: "Closed", reportedOn: "2026-04-21", incurred: 382770, paid: 382770, reserved: 0 }],
    "POL-2026-1129": [{ type: "Surgical procedure", status: "Open", reportedOn: "2026-05-01", incurred: 164120, paid: 66580, reserved: 97540 }],
    "POL-2026-1130": [{ type: "Collision", status: "Closed", reportedOn: "2026-01-19", incurred: 4650, paid: 4650, reserved: 0 }],
    "POL-2026-1135": [{ type: "Inpatient treatment", status: "Closed", reportedOn: "2026-05-05", incurred: 138420, paid: 138420, reserved: 0 }],
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
  /* Loss ratio: incurred ÷ premium, across whatever set of policies is passed in — the caller
     decides the denominator (the whole active book, one state, one LOB) by filtering first. */
  function lossRatio(policies) {
    var premium = policies.reduce(function (s, p) { return s + (Number(p.premium) || 0); }, 0);
    var incurred = allClaims(policies).reduce(function (s, x) { return s + x.c.incurred; }, 0);
    return premium ? incurred / premium : 0;
  }
  PAS.lossRatio = lossRatio;
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
    var isFleet = (policy.premium || 0) >= 20000;
    var vehicleCount = isFleet ? Math.max(2, Math.min(12, Math.round(policy.premium / 22000))) : 1;
    var makePool = isFleet ? TRUCK_MAKES : CAR_MAKES;
    var vehicles = [];
    for (var i = 0; i < vehicleCount; i++) {
      var vseed = hash32(policy.id + "-veh-" + i);
      var mk = makePool[vseed % makePool.length];
      vehicles.push({ unit: (isFleet ? "Truck " : "Vehicle ") + (i + 1), type: isFleet ? "Tractor unit" : "Passenger vehicle", make: mk[0], model: mk[1], year: 2020 + (vseed % 7), vin: vin17(vseed) });
    }
    if (isFleet) {
      var trailerCount = Math.max(1, Math.round(vehicleCount / 2));
      for (var t = 0; t < trailerCount; t++) {
        var tseed = hash32(policy.id + "-trl-" + t);
        var tm = TRAILER_MAKES[tseed % TRAILER_MAKES.length];
        vehicles.push({ unit: "Trailer " + (t + 1), type: "Dry van trailer", make: tm[0], model: tm[1], year: 2019 + (tseed % 8), vin: vin17(tseed) });
      }
    }
    var drivers = [];
    if (isFleet) {
      var driverCount = Math.max(vehicleCount, Math.min(14, vehicleCount + (h % 3)));
      for (var d = 0; d < driverCount; d++) {
        var dseed = hash32(policy.id + "-drv-" + d);
        var name = DRIVER_FIRST[dseed % DRIVER_FIRST.length] + " " + DRIVER_LAST[hash32(policy.id + "-drvl-" + d) % DRIVER_LAST.length];
        drivers.push({ name: name, role: d === 0 ? "Lead driver" : "Driver", licenseClass: "CDL-A", licenseState: PAS.stateAbbr(policy.state), yearsLicensed: 2 + (dseed % 15) });
      }
    } else {
      drivers.push({ name: policy.holder, role: "Named insured", licenseClass: "Class C", licenseState: PAS.stateAbbr(policy.state), yearsLicensed: 5 + (h % 20) });
    }
    return { isFleet: isFleet, vehicles: vehicles, drivers: drivers };
  };

  /* ---------- loyalty: configurable criteria, computed from real ledger data ----------
     Same shape as the underwriting risk model — a weights table an admin could tune, plus a pure
     function that shows its derivation line by line rather than asserting a tier. Every input is
     a fact already on the policy (renewal count, claims on file, cancellation history, premium)
     — nothing here is a fabricated "loyalty points" balance. */
  var LOYALTY_CRITERIA = {
    perRenewalTerm: 15, claimFreeBonus: 20, noCancellationBonus: 15,
    highValuePremium: 500000, highValueBonus: 10,
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
    return JSON.parse(JSON.stringify(global.PAS_SEED_POLICIES));
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
    if (p.status !== "Active" || (p.premium || 0) < 3000) return;
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
  function seedPolicies() {
    var list = fetchSeedRecords();
    list.forEach(function (p) {
      p.risk = RISK_PROFILE[p.id] || {}; p.claims = CLAIMS_BY_ID[p.id] || []; p.carrier = PRODUCT_CARRIER[p.product] || PAS.CARRIERS[0]; p.mga = mgaForPolicy(p);
      if (!p.documents || !p.documents.length) {
        var docShape = STATUS_DOC[p.status] || ["Policy schedule", "Schedule"];
        p.documents = [{ id: uid("DOC"), name: docShape[0], version: 1, generatedAt: p.submittedOn || p.effectiveDate, type: docShape[1] }];
      }
      backfillEndorsementTrail(p);
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
      ["carriers", "Reinsurers", "shield-check", "carriers.html"],
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
    carriers: { nav: "carriers", title: "Records / Reinsurers" },
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
  PAS.AUTO_ISSUE_PREMIUM_LIMIT = 500000;
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
