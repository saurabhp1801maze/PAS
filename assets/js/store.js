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
  var money = function (n) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); };
  var moneyShort = function (n) {
    return n >= 10000000 ? "₹" + (n / 10000000).toFixed(2) + "Cr"
      : n >= 100000 ? "₹" + (n / 100000).toFixed(1) + "L" : money(n);
  };
  var fmtTime = function (iso) { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };

  PAS.uid = uid; PAS.todayISO = todayISO; PAS.addDays = addDays; PAS.addYears = addYears; PAS.daysBetween = daysBetween;
  PAS.money = money; PAS.moneyShort = moneyShort; PAS.fmtTime = fmtTime;

  var REINSTATEMENT_WINDOW_DAYS = 45;
  var RENEWAL_LEAD_DAYS = 45;
  var AUTHORITY_LIMIT = 5000000;
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
      rule: "An insurer-side initiator (Carrier, MGA, System) may never carry a short-rate penalty — Type downgrades to this even if the Reason's default is Short-Rate.",
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
  var CANCEL_REASONS = {
    "Insured Request": { noticeDays: 0, defaultType: "Short-Rate" },
    "Non-Payment": { noticeDays: 15, defaultType: "Pro-Rata" },
    "Fraud": { noticeDays: 0, defaultType: "Pro-Rata" },
    "Underwriting": { noticeDays: 30, defaultType: "Pro-Rata" },
    "Sold Vehicle/Business": { noticeDays: 0, defaultType: "Short-Rate" },
    "Other": { noticeDays: 15, defaultType: "Short-Rate" },
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

  /* Everything about a cancellation follows from these four attributes plus dates. Nothing is
     hand-keyed. */
  function cancelQuote(policy, reason, initiatedBy, effectiveDate) {
    var reasonSpec = CANCEL_REASONS[reason] || CANCEL_REASONS.Other;
    var totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
    var atInception = effectiveDate <= policy.effectiveDate;
    var type = deriveCancelType(reason, initiatedBy, atInception);
    var spec = CANCEL_TYPES[type];
    var remainingDays = Math.max(0, daysBetween(effectiveDate, policy.expirationDate));
    var unearned = policy.premium * (remainingDays / totalDays);
    var gross = type === "Flat" ? policy.premium : unearned;
    var penalty = gross * spec.penaltyPct;
    var refund = Math.max(0, gross - penalty);
    var noticeProvided = daysBetween(todayISO(), effectiveDate);
    var noticeRequired = reasonSpec.noticeDays;
    return {
      type: type, spec: spec, reason: reason, initiatedBy: initiatedBy, timing: cancelTiming(effectiveDate),
      totalDays: totalDays, remainingDays: remainingDays,
      earnedDays: totalDays - remainingDays, gross: gross, penalty: penalty, refund: refund,
      noticeRequired: noticeRequired, noticeProvided: noticeProvided, noticeOk: noticeProvided >= noticeRequired,
      needsReview: reason === "Fraud" || noticeProvided < noticeRequired,
    };
  }
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
     A minimal claims subsystem — enough for the MGA/Carrier dashboards to compute a genuine loss
     ratio and reserve figure instead of the "not modeled" gap this used to be. Each claim is
     `{ id, type, status, reportedOn, incurred, paid, reserved }`, attached to its policy the same
     way `documents` already is. Bharat Steel Works (POL-2026-00988) is deliberately consistent
     with the cancellation already on its ledger — that record's own detail text says "adverse
     loss ratio... 140% over two terms," so its claim's incurred amount is set to exactly 140% of
     premium (₹8,90,000 × 1.4 = ₹12,46,000) rather than an arbitrary number that would contradict
     the narrative already on file. */
  var CLAIMS_BY_ID = {
    "POL-2026-00988": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: 1246000, paid: 1246000, reserved: 0 }],
    "POL-2025-06210": [{ type: "Collision", status: "Closed", reportedOn: "2026-03-14", incurred: 32000, paid: 32000, reserved: 0 }],
    "POL-2026-00777": [{ type: "Cargo damage", status: "Open", reportedOn: "2026-07-28", incurred: 180000, paid: 60000, reserved: 120000 }],
    "POL-2025-04456": [{ type: "Water damage", status: "Closed", reportedOn: "2026-02-19", incurred: 45000, paid: 45000, reserved: 0 }],
    "POL-2025-09112": [{ type: "Theft", status: "Open", reportedOn: "2026-08-01", incurred: 28000, paid: 5000, reserved: 23000 }],
    "POL-2024-09321": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-01-11", incurred: 95000, paid: 95000, reserved: 0 }],
  };
  PAS.CLAIMS_BY_ID = CLAIMS_BY_ID;

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
  function coverageBreakdown(policy) {
    var template = COVERAGE_TEMPLATE[policy.product] || [];
    return template.map(function (c) { return { name: c.name, share: c.share, premium: Math.round(policy.premium * c.share) }; });
  }
  PAS.coverageBreakdown = coverageBreakdown;
  function reservesTotal(policies) {
    return allClaims(policies).filter(function (x) { return x.c.status === "Open"; }).reduce(function (s, x) { return s + x.c.reserved; }, 0);
  }
  PAS.reservesTotal = reservesTotal;

  function seedPolicies() {
    var list = [
      /* --- awaiting an underwriting decision --- */
      { id: "SUB-2026-0041", holder: "Sharma Textiles Pvt Ltd", product: "Commercial Property", status: "Referred",
        effectiveDate: "2026-09-01", expirationDate: "2027-09-01", premium: 6200000, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Maharashtra", submittedOn: "2026-08-14", sumInsured: "₹12,00,00,000",
        documents: [], history: [
          txn(1, "2026-08-14", "Submission", "Submission received", "Commercial property risk, 3 locations, Bhiwandi & Surat.", "Apex Brokers", { channel: "Broker" }),
          txn(2, "2026-08-15", "Underwriting", "Auto-referred to senior underwriter", "Premium above delegated authority and score below threshold.", "System", { tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-15", requestNote: "Score and authority checks failed — routed automatically, no human trigger." }, "Pending"),
        ] },
      { id: "SUB-2026-0042", holder: "Kavita Enterprises", product: "Comprehensive Auto", status: "Referred",
        effectiveDate: "2026-09-05", expirationDate: "2027-09-05", premium: 184000, termNumber: 1,
        producer: "Direct", state: "Karnataka", submittedOn: "2026-08-17", sumInsured: "₹18,00,000 IDV",
        documents: [], history: [
          txn(1, "2026-08-17", "Submission", "Submission received", "Fleet of 4 commercial vehicles.", "Direct", { channel: "Direct" }),
          txn(2, "2026-08-18", "Underwriting", "Awaiting underwriter decision", "Two at-fault claims in the prior term.", "System", { tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-18", requestNote: "Score below threshold on prior claims history — routed automatically." }, "Pending"),
        ] },
      { id: "SUB-2026-0043", holder: "Coastal Marine Traders", product: "Marine Cargo", status: "Referred",
        effectiveDate: "2026-09-10", expirationDate: "2027-09-10", premium: 5800000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Maharashtra", submittedOn: "2026-08-16", sumInsured: "₹9,50,00,000",
        documents: [], history: [
          txn(1, "2026-08-16", "Submission", "Submission received", "Cargo cover for 3 vessels, Mumbai–Colombo route.", "Meridian Risk", { channel: "Broker" }),
          txn(2, "2026-08-17", "Underwriting", "Auto-referred to senior underwriter", "Premium exceeds delegated agent authority.", "System", { tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-17", requestNote: "Premium above authority limit — routed automatically." }, "Pending"),
        ] },
      { id: "SUB-2026-0044", holder: "Horizon Health Corp", product: "Group Health", status: "Referred",
        effectiveDate: "2026-09-12", expirationDate: "2027-09-12", premium: 920000, termNumber: 1,
        producer: "Direct", state: "Delhi", submittedOn: "2026-08-20", sumInsured: "₹5,00,00,000 (group limit)",
        documents: [], history: [
          txn(1, "2026-08-20", "Submission", "Submission received", "Group health cover for 140 employees.", "Direct", { channel: "Direct" }),
          txn(2, "2026-08-20", "Underwriting", "Awaiting underwriter decision", "New group scheme, no prior claims history on file.", "System", { tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-20", requestNote: "First-time group scheme — routed for manual review pending census data." }, "Pending"),
        ] },

      /* --- bound, awaiting formal issue --- */
      { id: "POL-2026-00311", holder: "Nirmala Rao", product: "Home Owners", status: "Bound",
        effectiveDate: "2026-08-25", expirationDate: "2027-08-25", premium: 46800, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Maharashtra", sumInsured: "₹85,00,000",
        binder: { number: "BN-2026-0311", boundOn: "2026-08-12", expiryDate: "2026-09-11",
          subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Electrical safety certificate", met: false }] },
        documents: [], history: [
          txn(1, "2026-08-10", "Submission", "Submission received", "New home owners risk, Pune.", "Apex Brokers", {}),
          txn(2, "2026-08-11", "Underwriting", "Underwriting: Approve", "Score 81, within agent authority.", "A. Nair", { score: 81, tier: "Within agent authority" }),
          txn(3, "2026-08-12", "Bind", "Bound — binder BN-2026-0311", "Provisional cover in force for 30 days pending issue.", "A. Nair", { binderNumber: "BN-2026-0311" }),
        ] },
      { id: "POL-2026-00312", holder: "Ganesh Logistics LLP", product: "Comprehensive Auto", status: "Bound",
        effectiveDate: "2026-08-22", expirationDate: "2027-08-22", premium: 312000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Gujarat", sumInsured: "₹42,00,000 IDV",
        binder: { number: "BN-2026-0312", boundOn: "2026-08-16", expiryDate: "2026-09-15",
          subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Fleet schedule confirmed", met: true }] },
        documents: [], history: [
          txn(1, "2026-08-14", "Submission", "Submission received", "12-vehicle goods carrier fleet.", "Meridian Risk", {}),
          txn(2, "2026-08-15", "Underwriting", "Underwriting: Approve", "Score 76, within agent authority.", "A. Nair", { score: 76, tier: "Within agent authority" }),
          txn(3, "2026-08-16", "Bind", "Bound — binder BN-2026-0312", "All subjectivities satisfied; ready to issue.", "A. Nair", { binderNumber: "BN-2026-0312" }),
        ] },
      { id: "POL-2026-00313", holder: "Meridian Textiles Ltd", product: "Commercial Property", status: "Bound",
        effectiveDate: "2026-08-28", expirationDate: "2027-08-28", premium: 612000, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Gujarat", sumInsured: "₹4,20,00,000",
        binder: { number: "BN-2026-0313", boundOn: "2026-08-13", expiryDate: "2026-09-12",
          subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Fire safety certificate", met: false }] },
        documents: [], history: [
          txn(1, "2026-08-11", "Submission", "Submission received", "Textile warehouse and factory floor, Surat.", "Apex Brokers", {}),
          txn(2, "2026-08-12", "Underwriting", "Underwriting: Approve", "Score 74, within agent authority.", "A. Nair", { score: 74, tier: "Within agent authority" }),
          txn(3, "2026-08-13", "Bind", "Bound — binder BN-2026-0313", "Provisional cover in force pending fire safety certificate.", "A. Nair", { binderNumber: "BN-2026-0313" }),
        ] },
      { id: "POL-2026-00314", holder: "Deepak Auto Traders", product: "Comprehensive Auto", status: "Bound",
        effectiveDate: "2026-08-26", expirationDate: "2027-08-26", premium: 218000, termNumber: 1,
        producer: "Direct", state: "Telangana", sumInsured: "₹31,00,000 IDV",
        binder: { number: "BN-2026-0314", boundOn: "2026-08-17", expiryDate: "2026-09-16",
          subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Vehicle inspection report", met: true }] },
        documents: [], history: [
          txn(1, "2026-08-15", "Submission", "Submission received", "8-vehicle showroom fleet.", "Direct", {}),
          txn(2, "2026-08-16", "Underwriting", "Underwriting: Approve", "Score 79, within agent authority.", "A. Nair", { score: 79, tier: "Within agent authority" }),
          txn(3, "2026-08-17", "Bind", "Bound — binder BN-2026-0314", "All subjectivities satisfied; ready to issue.", "A. Nair", { binderNumber: "BN-2026-0314" }),
        ] },

      /* --- in force, with work pending against them --- */
      { id: "POL-2025-09112", holder: "Meera Shankar", product: "Comprehensive Auto", status: "Active",
        effectiveDate: "2025-09-05", expirationDate: "2026-09-05", premium: 48200, termNumber: 1,
        producer: "Direct", state: "Karnataka", sumInsured: "₹8,50,000 IDV",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-09-05", type: "Schedule" },
                    { id: uid("DOC"), name: "Certificate of insurance", version: 1, generatedAt: "2025-09-05", type: "Certificate" }],
        history: [
          txn(1, "2025-09-05", "Underwriting", "Underwriting: Approve", "Score 82, within agent authority.", "System", { score: 82, tier: "Within agent authority" }),
          txn(2, "2025-09-05", "Bind", "Bound — binder BN-25091", "Provisional cover bound.", "U. Sharma", { binderNumber: "BN-25091" }),
          txn(3, "2025-09-05", "Issuance", "Policy issued", "Schedule and certificate generated.", "U. Sharma", { channel: "Direct" }),
          txn(4, "2026-08-18", "Endorsement", "Endorsement requested: Add driver", "Add named driver Rohit Verma. HELD — material change, not yet applied.", "Broker portal",
            { changeType: "Add/remove driver", materiality: "Material", premiumImpact: 4200, initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-18", requestNote: "Please add Rohit Verma as a named driver from next week." }, "Pending"),
        ] },
      { id: "POL-2025-04456", holder: "Vikram Enterprises", product: "Home Owners", status: "Active",
        effectiveDate: "2025-10-12", expirationDate: "2026-10-12", premium: 58000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Maharashtra", sumInsured: "₹1,10,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-10-12", type: "Schedule" }],
        history: [
          txn(1, "2025-10-12", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-08-14", "Endorsement", "Endorsement requested: Coverage change", "Add flood cover following monsoon risk review. HELD — material change, not yet applied.", "Broker portal",
            { changeType: "Coverage change", materiality: "Material", premiumImpact: 7800, initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-14", requestNote: "Client wants flood cover added given this year's monsoon forecast." }, "Pending"),
        ] },
      { id: "POL-2026-00120", holder: "Ritu Kapoor", product: "Comprehensive Auto", status: "Active",
        effectiveDate: "2026-04-02", expirationDate: "2027-04-02", premium: 39000, termNumber: 1,
        producer: "Direct", state: "Karnataka", sumInsured: "₹7,40,000 IDV",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-04-02", type: "Schedule" }],
        history: [
          txn(1, "2026-04-02", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-08-17", "Endorsement", "Endorsement requested: Address change", "Registered address updated to new residence in Bengaluru.", "Self-service portal",
            { changeType: "Address change", materiality: "Minor", premiumImpact: 0, initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-17", requestNote: "Moved house last week, please update my address on file." }, "Pending"),
        ] },
      { id: "POL-2024-00187", holder: "Priya Deshmukh", product: "Home Owners", status: "Active",
        effectiveDate: "2025-08-20", expirationDate: "2026-08-20", premium: 21800, termNumber: 2,
        producer: "Apex Insurance Brokers", state: "Maharashtra", sumInsured: "₹42,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 2, generatedAt: "2025-08-20", type: "Schedule" }],
        history: [
          txn(1, "2024-08-20", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2025-08-20", "Renewal", "Renewed into term 2", "No change in coverage.", "System", { previousPremium: 20200, newPremium: 21800 }),
          txn(3, "2026-08-20", "Renewal", "Renewal requested — awaiting decision", "Insured confirmed intent to renew via self-service portal. Term expires today; re-underwriting and pricing pending.", "Self-service portal",
            { initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-11", requestNote: "Please renew my home policy, no changes needed." }, "Pending"),
        ] },
      { id: "POL-2026-02233", holder: "Karan Malhotra", product: "Term Life", status: "Active",
        effectiveDate: "2026-02-01", expirationDate: "2027-02-01", premium: 15600, termNumber: 1,
        producer: "Direct", state: "Delhi", sumInsured: "₹1,00,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-02-01", type: "Schedule" }],
        history: [
          txn(1, "2026-02-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-08-19", "Cancellation", "Cancellation requested — held for review", "Insured requests cancellation. Short-rate. HELD — awaiting review.", "Broker portal",
            { reason: "Insured Request", initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-19", requestNote: "Client is emigrating and no longer needs the policy." }, "Pending"),
        ] },
      { id: "POL-2026-00988", holder: "Bharat Steel Works", product: "Commercial Property", status: "Active",
        effectiveDate: "2026-03-15", expirationDate: "2027-03-15", premium: 890000, termNumber: 3,
        producer: "Meridian Risk Partners", state: "West Bengal", sumInsured: "₹6,50,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 3, generatedAt: "2026-03-15", type: "Schedule" }],
        history: [
          txn(1, "2026-03-15", "Renewal", "Renewed into term 3", "Premium increased 8% on claims experience.", "A. Nair", { previousPremium: 824000, newPremium: 890000 }),
          txn(2, "2026-09-15", "Cancellation", "Cancellation requested — held for review", "Carrier-initiated on adverse loss ratio. HELD — requires a second underwriter's sign-off before it can proceed.", "Internal review",
            { reason: "Underwriting", initiatedBy: "Carrier", channel: "Internal review", submittedOn: "2026-08-19", requestNote: "Loss ratio has run 140% over two terms on this location — recommend non-renewal path via mid-term cancellation with full notice." }, "Pending"),
        ] },
      { id: "POL-2026-00560", holder: "Ashok Furnishings", product: "Commercial Property", status: "Active",
        effectiveDate: "2026-05-01", expirationDate: "2027-05-01", premium: 264000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Gujarat", sumInsured: "₹2,80,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-05-01", type: "Schedule" }],
        history: [
          txn(1, "2026-05-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-08-18", "Cancellation", "Cancellation requested — held for review", "Carrier-initiated after inconsistencies found in the proposal declaration. HELD — fraud review.", "Internal review",
            { reason: "Fraud", initiatedBy: "Carrier", channel: "Internal review", submittedOn: "2026-08-18", requestNote: "Site survey contradicts declared stock value by a wide margin — recommend fraud review before any further action." }, "Pending"),
        ] },
      { id: "POL-2025-08765", holder: "Neha Bhatt", product: "Home Owners", status: "Active",
        effectiveDate: "2025-12-01", expirationDate: "2026-12-01", premium: 27400, termNumber: 1,
        producer: "Direct", state: "Maharashtra", sumInsured: "₹55,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-12-01", type: "Schedule" }],
        history: [
          txn(1, "2025-12-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-08-16", "Cancellation", "Cancellation requested — held for review", "Insured is relocating overseas and no longer needs the property covered.", "Self-service portal",
            { reason: "Insured Request", initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-16", requestNote: "We're moving abroad end of this month, please cancel the policy." }, "Pending"),
        ] },
      { id: "POL-2025-06210", holder: "Suresh Iyer", product: "Comprehensive Auto", status: "Active",
        effectiveDate: "2025-09-10", expirationDate: "2026-09-10", premium: 44500, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Tamil Nadu", sumInsured: "₹8,90,000 IDV",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-09-10", type: "Schedule" }],
        history: [
          txn(1, "2025-09-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-08-15", "Renewal", "Renewal requested — awaiting decision", "Broker confirmed renewal intent ahead of the notice deadline.", "Broker portal",
            { initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-15", requestNote: "Client confirmed renewal, no changes to the vehicle." }, "Pending"),
        ] },
      { id: "POL-2024-09321", holder: "Lakshmi Textiles Ltd", product: "Commercial Property", status: "Active",
        effectiveDate: "2025-10-01", expirationDate: "2026-10-01", premium: 745000, termNumber: 3,
        producer: "Meridian Risk Partners", state: "Gujarat", sumInsured: "₹5,80,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 3, generatedAt: "2025-10-01", type: "Schedule" }],
        history: [
          txn(1, "2023-10-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2024-10-01", "Renewal", "Renewed into term 2", "No change in coverage.", "System", { previousPremium: 690000, newPremium: 712000 }),
          txn(3, "2025-08-20", "Endorsement", "Endorsement: Limit change", "Sum insured increased following new machinery installation.", "Apex Brokers", { changeType: "Limit change", materiality: "Material", premiumImpact: 33000 }),
          txn(4, "2025-10-01", "Renewal", "Renewed into term 3", "Premium reflects increased sum insured.", "System", { previousPremium: 712000, newPremium: 745000 }),
          txn(5, "2026-08-12", "Renewal", "Renewal requested — awaiting decision", "Insured confirmed renewal via self-service portal.", "Self-service portal",
            { initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-12", requestNote: "Please renew, we may add a fourth location next term but not yet." }, "Pending"),
        ] },
      { id: "POL-2025-07734", holder: "Rakesh Oberoi", product: "Term Life", status: "Active",
        effectiveDate: "2025-07-01", expirationDate: "2035-07-01", premium: 42000, termNumber: 1,
        producer: "Direct", state: "Delhi", sumInsured: "₹2,00,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-07-01", type: "Schedule" }],
        history: [
          txn(1, "2025-07-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-02-14", "Servicing", "Service request logged", "Nominee details updated on file.", "Direct", { category: "Contact update", channel: "Phone" }),
        ] },
      { id: "POL-2026-00777", holder: "Global Freight Movers", product: "Marine Cargo", status: "Active",
        effectiveDate: "2026-01-15", expirationDate: "2027-01-15", premium: 1180000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Tamil Nadu", sumInsured: "₹18,00,00,000",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-01-15", type: "Schedule" }],
        history: [
          txn(1, "2026-01-15", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-04-02", "Endorsement", "Endorsement: Add route", "Added Chennai–Singapore lane to the schedule.", "Meridian Risk", { changeType: "Coverage change", materiality: "Minor", premiumImpact: 12000 }),
          txn(3, "2026-06-18", "Servicing", "Service request logged", "Duplicate certificate of insurance emailed for customs clearance.", "Meridian Risk", { category: "Document request", channel: "Email" }),
        ] },
      { id: "POL-2025-03321", holder: "Anita Krishnamurthy", product: "Group Health", status: "Active",
        effectiveDate: "2025-09-01", expirationDate: "2026-09-01", premium: 68000, termNumber: 1,
        producer: "Direct", state: "Karnataka", sumInsured: "₹15,00,000 (family floater)",
        documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-09-01", type: "Schedule" }],
        history: [
          txn(1, "2025-09-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-03-11", "Servicing", "Service request logged", "Query on cashless hospital network coverage.", "Direct", { category: "Inquiry", channel: "Phone" }),
          txn(3, "2026-07-02", "Servicing", "Service request logged", "Billing dispute on last installment resolved.", "Direct", { category: "Billing", channel: "Email" }),
        ] },

      /* --- cancelled: one reinstatement candidate, one time-barred --- */
      { id: "POL-2026-01190", holder: "Divya Krishnan", product: "Comprehensive Auto", status: "Cancelled",
        effectiveDate: "2026-01-10", expirationDate: "2027-01-10", premium: 33000, termNumber: 1,
        producer: "Direct", state: "Tamil Nadu", sumInsured: "₹6,20,000 IDV",
        documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-08-05", type: "Notice" }],
        history: [
          txn(1, "2026-01-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-08-05", "Cancellation", "Policy cancelled", "Cancelled for non-payment after the 15-day notice ran.", "System",
            { reason: "Non-Payment", cancelType: "Pro-Rata", initiatedBy: "System", refund: 0 }),
          txn(3, "2026-08-19", "Reinstatement", "Reinstatement requested — awaiting decision", "Insured paid the outstanding premium and is requesting reinstatement via the self-service portal.", "Self-service portal",
            { initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-19", requestNote: "Payment has gone through now, please reactivate my policy.", outstandingClaimed: 33000 }, "Pending"),
        ] },
      { id: "POL-2026-00045", holder: "Farhan Sheikh", product: "Comprehensive Auto", status: "Cancelled",
        effectiveDate: "2025-11-20", expirationDate: "2026-11-20", premium: 36200, termNumber: 1,
        producer: "Direct", state: "Telangana", sumInsured: "₹6,80,000 IDV",
        documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-08-10", type: "Notice" }],
        history: [
          txn(1, "2025-11-20", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-08-10", "Cancellation", "Policy cancelled", "Cancelled for non-payment after the 15-day notice ran.", "System",
            { reason: "Non-Payment", cancelType: "Pro-Rata", initiatedBy: "System", refund: 0 }),
          txn(3, "2026-08-18", "Reinstatement", "Reinstatement requested — awaiting decision", "Insured called in to confirm payment has cleared and requests reinstatement.", "Phone",
            { initiatedBy: "Insured", channel: "Phone", submittedOn: "2026-08-18", requestNote: "Sorry for the delay, payment has gone through, please switch the cover back on.", outstandingClaimed: 36200 }, "Pending"),
        ] },
      { id: "POL-2025-12200", holder: "Ovais Traders", product: "Home Owners", status: "Cancelled",
        effectiveDate: "2025-06-01", expirationDate: "2026-06-01", premium: 41000, termNumber: 1,
        producer: "Meridian Risk Partners", state: "Maharashtra", sumInsured: "₹95,00,000",
        documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-07-25", type: "Notice" }],
        history: [
          txn(1, "2025-06-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-07-25", "Cancellation", "Policy cancelled", "Cancelled following a confirmed fraud investigation — declaration discrepancies substantiated.", "A. Nair",
            { reason: "Fraud", cancelType: "Pro-Rata", initiatedBy: "Carrier", refund: 0 }),
        ] },
      { id: "POL-2025-05678", holder: "Meenal Joshi", product: "Comprehensive Auto", status: "Cancelled",
        effectiveDate: "2025-04-10", expirationDate: "2026-04-10", premium: 29800, termNumber: 1,
        producer: "Direct", state: "Maharashtra", sumInsured: "₹5,60,000 IDV",
        documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-06-21", type: "Notice" }],
        history: [
          txn(1, "2025-04-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
          txn(2, "2026-06-21", "Cancellation", "Policy cancelled", "Cancelled at insured's request — vehicle sold.", "R. Iyer",
            { reason: "Sold Vehicle/Business", cancelType: "Short-Rate", initiatedBy: "Insured", refund: 5100 }),
        ] },
      { id: "POL-2025-11044", holder: "Arjun Bhatia", product: "Comprehensive Auto", status: "Cancelled",
        effectiveDate: "2025-11-01", expirationDate: "2026-11-01", premium: 39500, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Delhi", sumInsured: "₹7,10,000 IDV",
        documents: [], history: [
          txn(1, "2025-11-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
          txn(2, "2026-05-30", "Cancellation", "Policy cancelled", "Cancelled at insured's request — vehicle sold. Short-rate refund issued.", "R. Iyer",
            { reason: "Sold Vehicle/Business", cancelType: "Short-Rate", initiatedBy: "Insured", refund: 6900 }),
        ] },
      { id: "POL-2024-07765", holder: "Sanjay Rao", product: "Home Owners", status: "Expired",
        effectiveDate: "2024-06-15", expirationDate: "2025-06-15", premium: 18400, termNumber: 1,
        producer: "Apex Insurance Brokers", state: "Karnataka", sumInsured: "₹35,00,000", documents: [],
        history: [txn(1, "2024-06-15", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" })] },
    ];
    list.forEach(function (p) { p.risk = RISK_PROFILE[p.id] || {}; p.claims = CLAIMS_BY_ID[p.id] || []; });
    return list;
  }
  PAS.seedPolicies = seedPolicies;

  /* ================= constants shared with the UI layer ================= */
  PAS.TENANT = "0190c4f2-77aa-7c31-9f10-5a2e4b8c1d33";
  PAS.EVENT_FOR = {
    "/issue": "policyIssued", "/endorsements": "policyEndorsed", "/cancellations": "policyCancelled",
    "/reinstatements": "policyReinstated", "/renewals": "policyRenewed", "/non-renewal": "policyNonRenewed",
    "/service-requests": "serviceRequestLogged", "/approve": "transactionApproved",
    "/reject": "transactionRejected", "/reverse": "transactionReversed",
    "/underwriting-decision": "underwritingDecided", "/documents": "documentGenerated",
  };
  PAS.CONSUMERS = {
    policyIssued: ["Billing", "Documents", "Reinsurance"], policyCancelled: ["Billing", "Claims", "Documents"],
    policyRenewed: ["Billing", "Documents"], policyEndorsed: ["Billing", "Documents"],
    policyReinstated: ["Billing", "Claims"], documentGenerated: ["Documents"], underwritingDecided: ["CRM"],
    transactionApproved: ["Billing"], transactionRejected: ["CRM"], transactionReversed: ["Billing"],
    policyNonRenewed: ["CRM", "Documents"], serviceRequestLogged: ["CRM"],
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
    Carrier: { icon: "building-2", tone: "green", label: "Carrier", channels: ["Internal review", "Portfolio audit", "Compliance directive"] },
    System: { icon: "cpu", tone: "gray", label: "System (automated)", channels: ["Billing non-payment trigger", "Renewal reminder job"] },
  };
  /* Cancellation restricts the "Initiated by" picker to this subset — an underwriter's portfolio
     review is a Renewal/Endorsement concept; a cancellation is initiated by the Carrier itself,
     an MGA acting on its behalf, a Broker, the Insured, or the System (non-payment). */
  PAS.CANCEL_INITIATOR_KEYS = ["Insured", "Broker/Producer", "MGA", "Carrier", "System"];
  PAS.STATUS_TONE = { Active: "green", Cancelled: "red", Expired: "gray", Bound: "amber", Referred: "violet", Submitted: "blue", "Non-renewed": "red", Declined: "red" };
  PAS.TXN_TONE = { Completed: "green", Pending: "amber", Rejected: "red", Reversed: "violet" };
  PAS.MODULE_TONE = { Submission: "blue", Underwriting: "violet", Bind: "amber", Issuance: "indigo", Endorsement: "amber", Cancellation: "red", Reinstatement: "green", Renewal: "blue", Servicing: "violet" };
  PAS.MODULE_ICON = { Submission: "inbox", Underwriting: "clipboard-check", Bind: "shield-check", Issuance: "stamp", Endorsement: "edit-3", Cancellation: "x-circle", Reinstatement: "rotate-ccw", Renewal: "refresh-cw", Servicing: "headphones" };

  PAS.PAGE_APIS = {
    dashboard: [["GET", "/api/v1/policies/kpis", "Portfolio aggregates for the KPI strip"], ["GET", "/api/v1/policies?limit=50", "The register behind every panel"]],
    approvals: [["GET", "/api/v1/transactions?status=pending", "Held transactions across the book"], ["POST", "/api/v1/transactions/{txnId}/approve", "Commits a held transaction"]],
    "uw-desk": [["GET", "/api/v1/underwriting/queue", "Submissions referred out of auto authority"], ["POST", "/api/v1/submissions/{id}/underwriting-decision", "Records approve / decline / refer"]],
    "issue-desk": [["GET", "/api/v1/policies?status=bound", "Bound but not yet issued"], ["POST", "/api/v1/policies/{policyId}/issue", "Runs issue gates, generates the pack"]],
    "endorsement-desk": [["GET", "/api/v1/endorsements?status=requested", "Change requests awaiting a decision"], ["POST", "/api/v1/transactions/{txnId}/approve", "Applies the held change"]],
    "cancellation-desk": [["GET", "/api/v1/policies?status=active", "Policies eligible to cancel"], ["POST", "/api/v1/policies/{policyId}/cancellations", "Derives type, computes refund, checks notice"]],
    "reinstatement-desk": [["GET", "/api/v1/policies?status=cancelled", "Reinstatement candidates"], ["POST", "/api/v1/policies/{policyId}/reinstatements", "Validates window then returns to ACTIVE"]],
    "renewal-desk": [["GET", "/api/v1/renewals/upcoming", "Policies inside the notice window"], ["POST", "/api/v1/policies/{policyId}/renewals", "Creates the next PolicyTerm"]],
    "servicing-desk": [["GET", "/api/v1/service-requests", "Servicing ledger"], ["POST", "/api/v1/policies/{policyId}/service-requests", "Logs a request against the SLA"]],
    workbench: [["GET", "/api/v1/transactions", "The full append-only ledger"], ["POST", "/api/v1/transactions/{txnId}/reverse", "Appends a compensating row"]],
    registry: [["GET", "/api/v1/policies", "Cursor-paged, tenant-scoped register"]],
    detail: [["GET", "/api/v1/policies/{policyId}", "Aggregate + ETag"], ["GET", "/api/v1/policies/{policyId}/transactions", "Ledger in seq order"], ["POST", "/api/v1/policies/{policyId}/documents", "Renders and stores a new version"]],
    documents: [["GET", "/api/v1/documents", "Document metadata across the book"]],
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
  ];

  /* Sidebar nav: [pageKey, label, iconName, href] */
  PAS.NAV = [
    { label: "Workspace", items: [["dashboard", "Dashboard", "layout-dashboard", "index.html"], ["approvals", "Pending approvals", "inbox", "approvals.html"]] },
    { label: "Decision desks", items: [
      ["uw-desk", "Underwriting", "clipboard-check", "underwriting.html"],
      ["issue-desk", "Issue", "stamp", "issue.html"],
      ["endorsement-desk", "Endorsements", "edit-3", "endorsement.html"],
      ["cancellation-desk", "Cancellation", "x-circle", "cancellation.html"],
      ["reinstatement-desk", "Reinstatement", "rotate-ccw", "reinstatement.html"],
      ["renewal-desk", "Renewal", "refresh-cw", "renewal.html"],
      ["servicing-desk", "Servicing", "headphones", "servicing.html"],
    ] },
    { label: "Records", items: [["registry", "Policy register", "list-checks", "registry.html"], ["workbench", "Transaction workbench", "git-branch", "workbench.html"], ["documents", "Documents", "file-check-2", "documents.html"]] },
    { label: "Reference", items: [
      ["domain-model", "Domain model", "git-branch", "domain-model.html"],
      ["data-model", "Data model", "database", "data-model.html"],
      ["api-reference", "API reference", "braces", "api-reference.html"],
      ["architecture", "Architecture", "layers", "architecture.html"],
    ] },
  ];

  /* Per-page metadata: which nav item to highlight + the breadcrumb title.
     Detail/decision pages point `nav` at their parent desk, mirroring the old PARENT_OF map —
     this is also the key used to look up PAS.PAGE_APIS for the API-lifecycle panel. */
  PAS.PAGE_META = {
    dashboard: { nav: "dashboard", title: "Workspace / Dashboard" },
    approvals: { nav: "approvals", title: "Workspace / Pending approvals" },
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
    registry: { nav: "registry", title: "Records / Policy register" },
    detail: { nav: "registry", title: "Records / Policy detail" },
    workbench: { nav: "workbench", title: "Records / Transaction workbench" },
    documents: { nav: "documents", title: "Records / Documents" },
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
    "servicing-desk": "servicing-decision.html",
  };
  PAS.DESK_URL_OF = {
    "uw-desk": "underwriting.html", "issue-desk": "issue.html", "endorsement-desk": "endorsement.html",
    "cancellation-desk": "cancellation.html", "reinstatement-desk": "reinstatement.html",
    "renewal-desk": "renewal.html", "servicing-desk": "servicing.html",
  };
  /* Which desk owns the decision for each held transaction type — used by the cross-type
     Pending Approvals index to route to the right decision page. */
  PAS.TYPE_TO_DESK = { Underwriting: "uw-desk", Endorsement: "endorsement-desk", Cancellation: "cancellation-desk", Renewal: "renewal-desk", Reinstatement: "reinstatement-desk" };

  /* ================= roles ================= */
  /* Four roles, one demo identity per role (this prototype has no real auth — switching role
     switches who you're seeing the platform as, not who's logged in). Nav visibility and
     dashboard content both branch on this; decision desks are hidden entirely for the two
     read-only roles rather than shown-but-disabled, since neither can act on a held transaction. */
  var ROLES = {
    Underwriter: {
      label: "Underwriter", icon: "clipboard-check", tone: "violet", identity: "Rahul Verma",
      scope: "all", canDecide: true, canRequest: true,
      desc: "Full operational access — every desk, every policy, every decision.",
    },
    MGA: {
      label: "MGA", icon: "building-2", tone: "indigo", identity: "Priya Nair",
      scope: "all", canDecide: false, canRequest: false,
      desc: "Portfolio-wide analytics across every product line, broker and state. Read-only — an MGA sees the book, underwriters decide it.",
    },
    Carrier: {
      label: "Carrier", icon: "shield-check", tone: "green", identity: "Meridian Assurance Co.",
      scope: "carrier", canDecide: false, canRequest: false,
      desc: "The risk-bearing partner's view of the paper written on their behalf — premium, loss activity, reserves. Read-only, and scoped to their own book once this prototype models more than one carrier (see domain-model.html).",
    },
    "Broker/Producer": {
      label: "Broker / Producer", icon: "users", tone: "amber", identity: "Apex Insurance Brokers",
      scope: "producer", canDecide: false, canRequest: true,
      desc: "The business this producer placed, and nothing else. Can raise a request (a cancellation, an endorsement); cannot decide one.",
    },
  };
  PAS.ROLES = ROLES;
  /* Desks a read-only role (MGA, Carrier) can't reach — decisions live with the Underwriter. A
     Broker/Producer keeps the request-raising desks (Cancellation, Reinstatement, Renewal,
     Endorsement, Servicing all accept a logged request) but loses Underwriting/Issue, which are
     internal decision points a producer never sees into. */
  PAS.NAV_HIDDEN_FOR_ROLE = {
    MGA: ["uw-desk", "issue-desk", "endorsement-desk", "cancellation-desk", "reinstatement-desk", "renewal-desk", "servicing-desk", "approvals"],
    Carrier: ["uw-desk", "issue-desk", "endorsement-desk", "cancellation-desk", "reinstatement-desk", "renewal-desk", "servicing-desk", "approvals"],
    "Broker/Producer": ["uw-desk", "issue-desk", "approvals"],
  };

  var ROLE_KEY = "pas.role.v1";
  PAS.getRole = function () {
    var r;
    try { r = sessionStorage.getItem(ROLE_KEY); } catch (e) { r = null; }
    return (r && ROLES[r]) ? r : "Underwriter";
  };
  PAS.setRole = function (role) {
    if (!ROLES[role]) return;
    try { sessionStorage.setItem(ROLE_KEY, role); } catch (e) { /* ignore */ }
  };
  /* A policy belongs to the current Broker/Producer identity if its `producer` field matches —
     real scoping, not a fake filter, since `producer` is already on every seed record. Carrier
     scoping has no real second dimension to filter on yet (this prototype models one implicit
     carrier for the whole book) — `scopePolicies` is a no-op for Carrier until that exists;
     see the Domain model screen's note on this gap. */
  PAS.scopePolicies = function (policies, role) {
    var spec = ROLES[role];
    if (!spec || spec.scope === "all" || spec.scope === "carrier") return policies;
    if (spec.scope === "producer") return policies.filter(function (p) { return p.producer === spec.identity; });
    return policies;
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

  PAS.getPolicies = loadPolicies;
  PAS.getPolicy = function (id) { return loadPolicies().find(function (p) { return p.id === id; }); };
  PAS.resetDemoData = function () {
    try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem("pas.api.v1"); } catch (e) { /* ignore */ }
    location.href = "index.html";
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
      documents: (p.documents || []).concat([
        { id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: todayISO(), type: "Schedule" },
        { id: uid("DOC"), name: "Certificate of insurance", version: 1, generatedAt: todayISO(), type: "Certificate" },
      ]),
    });
  }
  PAS.decide = function (id, outcome, meta) {
    return patch(id, function (p) {
      var withCompleted = Object.assign({}, p, {
        history: p.history.map(function (h) { return (h.status === "Pending" && h.type === "Underwriting") ? Object.assign({}, h, { status: "Completed" }) : h; }),
      });
      var t = pushTxn(withCompleted, { date: todayISO(), type: "Underwriting", title: "Underwriting: " + outcome, detail: meta.note || ("Decided by underwriter. Score " + meta.score + ", " + meta.tier + "."), meta: meta });
      if (outcome === "Approve") {
        var bound = Object.assign({}, t, { status: "Bound", binder: { number: uid("BN"), boundOn: todayISO(), expiryDate: addDays(todayISO(), 30), subjectivities: [{ label: "Signed proposal form", met: true }] } });
        return issueGatesPass(bound) ? doIssue(bound, true) : bound;
      }
      if (outcome === "Decline") return Object.assign({}, t, { status: "Declined" });
      return t;
    });
  };
  PAS.issuePolicy = function (id) {
    return patch(id, function (p) { return doIssue(p, false); });
  };
  PAS.toggleSubjectivity = function (id, i) {
    return patch(id, function (p) {
      var toggled = Object.assign({}, p, { binder: Object.assign({}, p.binder, { subjectivities: p.binder.subjectivities.map(function (s, j) { return j === i ? Object.assign({}, s, { met: !s.met }) : s; }) }) });
      return issueGatesPass(toggled) ? doIssue(toggled, true) : toggled;
    });
  };
  /* Cancellation, Reinstatement, Renewal and Endorsement are never started by ops directly —
     they always begin as a Pending request, and only a separate decision step applies or
     rejects it. raiseRequest is the single entry point every "Log a request" form and every
     seed record goes through. */
  PAS.raiseRequest = function (id, type, meta) {
    return patch(id, function (p) {
      var submittedOn = meta.submittedOn || todayISO();
      var titles = { Cancellation: "Cancellation requested — awaiting decision", Renewal: "Renewal requested — awaiting decision", Reinstatement: "Reinstatement requested — awaiting decision", Endorsement: "Endorsement requested — awaiting decision" };
      var effDate = type === "Renewal" ? p.expirationDate : todayISO();
      return pushTxn(p, { date: effDate, type: type, status: "Pending", title: titles[type],
        detail: "Requested by " + meta.initiatedBy + " via " + meta.channel + ". \"" + meta.requestNote + "\"",
        meta: Object.assign({}, meta, { submittedOn: submittedOn }) });
    });
  };
  PAS.decideCancellation = function (id, txnId, approve, effDate, q) {
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        return Object.assign({}, h, {
          status: approve ? "Completed" : "Rejected", date: effDate, approvedBy: "You",
          title: approve ? "Cancellation approved" : "Cancellation declined",
          detail: approve ? ("Approved. " + q.type + " basis, effective " + effDate + ". Refund " + money(q.refund) + ".") : ("Declined. Policy remains ACTIVE. " + h.detail),
          meta: Object.assign({}, h.meta, { cancelType: q.type, refund: Math.round(q.refund) }),
        });
      });
      if (!approve) return Object.assign({}, p, { history: history });
      return Object.assign({}, p, { history: history, status: "Cancelled",
        documents: (p.documents || []).concat([{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: todayISO(), type: "Notice" }]) });
    });
  };
  PAS.decideReinstatement = function (id, txnId, approve, m) {
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        return Object.assign({}, h, {
          status: approve ? "Completed" : "Rejected", approvedBy: "You",
          title: approve ? "Policy reinstated" : "Reinstatement declined",
          detail: approve ? ("Reinstated after a " + m.gapDays + "-day lapse. Outstanding premium collected: " + money(m.outstanding) + ". Gap disclosure issued.") : ("Declined. Policy remains Cancelled. " + h.detail),
          meta: Object.assign({}, h.meta, m),
        });
      });
      return approve ? Object.assign({}, p, { history: history, status: "Active" }) : Object.assign({}, p, { history: history });
    });
  };
  PAS.decideRenewal = function (id, txnId, approve, prem) {
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        return Object.assign({}, h, {
          status: approve ? "Completed" : "Rejected", approvedBy: "You",
          title: approve ? ("Renewed into term " + (p.termNumber + 1)) : "Renewal declined — non-renewed",
          detail: approve ? ("Re-underwritten and renewed. Premium " + money(p.premium) + " → " + money(prem) + ".") : ("Declined. " + RENEWAL_LEAD_DAYS + "-day non-renewal notice served."),
          meta: Object.assign({}, h.meta, { previousPremium: p.premium, newPremium: prem }),
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
  PAS.decideTxn = function (pid, tid, ok) {
    return patch(pid, function (p) {
      var held = p.history.find(function (h) { return h.id === tid; });
      if (!held) return p;
      var premiumDelta = ok ? ((held.meta && held.meta.premiumImpact) || 0) : 0;
      var outcomeText = ok
        ? ("Approved and applied." + (premiumDelta ? (" Premium adjusted " + (premiumDelta >= 0 ? "+" : "") + money(premiumDelta) + ".") : ""))
        : "Declined.";
      var detail = /HELD[^.]*\./.test(held.detail) ? held.detail.replace(/HELD[^.]*\./, outcomeText) : (held.detail + " " + outcomeText);
      return Object.assign({}, p, {
        premium: p.premium + premiumDelta,
        history: p.history.map(function (h) { return h.id === tid ? Object.assign({}, h, { status: ok ? "Completed" : "Rejected", approvedBy: "Senior UW", detail: detail }) : h; }),
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
