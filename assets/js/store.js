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
     way `documents` already is. Ironwood Steel Works (POL-2026-00988) is deliberately consistent
     with the cancellation already on its ledger — that record's own detail text says "adverse
     loss ratio... 140% over two terms," so its claim's incurred amount is set to exactly 140% of
     premium ($100,000 × 1.4 = $140,000) rather than an arbitrary number that would contradict
     the narrative already on file. */
  var CLAIMS_BY_ID = {
    "POL-2026-00988": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: 140000, paid: 140000, reserved: 0 }],
    "POL-2025-06210": [{ type: "Collision", status: "Closed", reportedOn: "2026-03-14", incurred: 2400, paid: 2400, reserved: 0 }],
    "POL-2026-00777": [{ type: "Cargo damage", status: "Open", reportedOn: "2026-07-28", incurred: 14500, paid: 4800, reserved: 9700 }],
    "POL-2025-04456": [{ type: "Water damage", status: "Closed", reportedOn: "2026-02-19", incurred: 4500, paid: 4500, reserved: 0 }],
    "POL-2025-09112": [{ type: "Theft", status: "Open", reportedOn: "2026-08-01", incurred: 1600, paid: 290, reserved: 1310 }],
    "POL-2024-09321": [{ type: "Machinery breakdown", status: "Closed", reportedOn: "2026-01-11", incurred: 9500, paid: 9500, reserved: 0 }],
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
  function seedPolicies() {
    var list = fetchSeedRecords();
    list.forEach(function (p) { p.risk = RISK_PROFILE[p.id] || {}; p.claims = CLAIMS_BY_ID[p.id] || []; p.carrier = PRODUCT_CARRIER[p.product] || PAS.CARRIERS[0]; p.mga = mgaForPolicy(p); });
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
  };
  PAS.CONSUMERS = {
    policyIssued: ["Billing", "Documents", "Reinsurance"], policyCancelled: ["Billing", "Claims", "Documents"],
    policyRenewed: ["Billing", "Documents"], policyEndorsed: ["Billing", "Documents"],
    policyReinstated: ["Billing", "Claims"], documentGenerated: ["Documents"], underwritingDecided: ["CRM"],
    transactionApproved: ["Billing"], transactionRejected: ["CRM"], transactionReversed: ["Billing"],
    policyNonRenewed: ["CRM", "Documents"], serviceRequestLogged: ["CRM"],
    policyTransferred: ["Billing", "Documents", "CRM", "Reinsurance"],
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
  PAS.MODULE_TONE = { Submission: "blue", Underwriting: "violet", Bind: "amber", Issuance: "indigo", Endorsement: "amber", Cancellation: "red", Reinstatement: "green", Renewal: "blue", Servicing: "violet", Transfer: "indigo" };
  PAS.MODULE_ICON = { Submission: "inbox", Underwriting: "clipboard-check", Bind: "shield-check", Issuance: "stamp", Endorsement: "edit-3", Cancellation: "x-circle", Reinstatement: "rotate-ccw", Renewal: "refresh-cw", Servicing: "headphones", Transfer: "send" };

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
  ];

  /* Sidebar nav: [pageKey, label, iconName, href] */
  PAS.NAV = [
    { label: "Workspace", items: [["dashboard", "Dashboard", "layout-dashboard", "index.html"], ["approvals", "Pending approvals", "inbox", "approvals.html"]] },
    { label: "Decision desks", items: [
      ["uw-desk", "Issue Policy", "clipboard-check", "underwriting.html"],
      ["issue-desk", "Issue", "stamp", "issue.html"],
      ["endorsement-desk", "Endorsements", "edit-3", "endorsement.html"],
      ["cancellation-desk", "Cancellation", "x-circle", "cancellation.html"],
      ["reinstatement-desk", "Reinstatement", "rotate-ccw", "reinstatement.html"],
      ["renewal-desk", "Renewal", "refresh-cw", "renewal.html"],
      ["servicing-desk", "Servicing", "headphones", "servicing.html"],
      ["transfer-desk", "Transfer", "send", "transfer.html"],
    ] },
    { label: "Records", items: [
      ["registry", "Policy register", "list-checks", "registry.html"],
      ["brokers", "Brokers", "users", "brokers.html"],
      ["mgas", "MGA", "building-2", "mgas.html"],
      ["carriers", "Carriers", "shield-check", "carriers.html"],
      ["customers", "Customers", "user", "customers.html"],
      ["workbench", "Transaction workbench", "git-branch", "workbench.html"],
      ["documents", "Documents", "file-check-2", "documents.html"],
      ["loyalty", "Loyalty", "award", "loyalty.html"],
      ["terms", "Terms & Conditions", "edit-3", "terms.html"],
    ] },
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
    "transfer-desk": { nav: "transfer-desk", title: "Decision desks / Transfer" },
    "transfer-detail": { nav: "transfer-desk", title: "Decision desks / Transfer" },
    registry: { nav: "registry", title: "Records / Policy register" },
    detail: { nav: "registry", title: "Records / Policy detail" },
    brokers: { nav: "brokers", title: "Records / Brokers" },
    mgas: { nav: "mgas", title: "Records / MGA" },
    carriers: { nav: "carriers", title: "Records / Carriers" },
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
  /* Four roles, one demo identity per role (this prototype has no real auth — switching role
     switches who you're seeing the platform as, not who's logged in). Nav visibility and
     dashboard content both branch on this; decision desks are hidden entirely for the two
     read-only roles rather than shown-but-disabled, since neither can act on a held transaction. */
  var ROLES = {
    Underwriter: {
      label: "Underwriter", icon: "clipboard-check", tone: "violet", identity: "A. Bennett",
      scope: "all", canDecide: true, canRequest: true,
      desc: "Full operational access — every desk, every policy, every decision.",
    },
    MGA: {
      label: "MGA", icon: "building-2", tone: "indigo", identity: "Jordan Blake",
      scope: "all", canDecide: false, canRequest: false,
      desc: "Portfolio-wide analytics across every product line, broker and state. Read-only — an MGA sees the book, underwriters decide it.",
    },
    Carrier: {
      label: "Carrier", icon: "shield-check", tone: "green", identity: "Meridian Assurance Co.",
      scope: "carrier", canDecide: false, canRequest: false,
      desc: "The risk-bearing partner's view of the paper written on their behalf — premium, loss activity, reserves. Read-only, and genuinely scoped to their own book (PAS.PRODUCT_CARRIER), not the whole portfolio.",
    },
    "Broker/Producer": {
      label: "Broker / Producer", icon: "users", tone: "amber", identity: "Apex Insurance Brokers",
      scope: "producer", canDecide: false, canRequest: true,
      desc: "The business this producer placed, and nothing else. Can raise a request (a cancellation, an endorsement); cannot decide one.",
    },
    Customer: {
      label: "Customer", icon: "user", tone: "blue", identity: "Marcus Whitfield",
      scope: "holder", canDecide: false, canRequest: true,
      desc: "The end-customer portal — a named insured's own policy, documents and coverage, and the ability to raise a self-service request. Nothing else on the platform is visible from here.",
    },
  };
  PAS.ROLES = ROLES;
  /* Desks a read-only role (MGA, Carrier) can't reach — decisions live with the Underwriter. A
     Broker/Producer keeps the request-raising desks (Cancellation, Reinstatement, Renewal,
     Endorsement, Servicing, Transfer all accept a logged request) but loses Underwriting/Issue,
     which are internal decision points a producer never sees into. Customer is the narrowest of
     all — a real customer portal is ordinarily a separate public-facing application, not a role
     inside the internal ops shell; modeled as a role here so it can reuse the same scoping,
     request-raising and document infrastructure everything else already has, with the sidebar
     reduced to just Dashboard (which is where their whole portal view lives). */
  var OPS_ONLY_DESKS = ["uw-desk", "issue-desk", "endorsement-desk", "cancellation-desk", "reinstatement-desk", "renewal-desk", "servicing-desk", "transfer-desk", "approvals"];
  PAS.NAV_HIDDEN_FOR_ROLE = {
    MGA: OPS_ONLY_DESKS.concat(["terms"]),
    Carrier: OPS_ONLY_DESKS.concat(["terms"]),
    "Broker/Producer": ["uw-desk", "issue-desk", "approvals", "terms"],
    Customer: OPS_ONLY_DESKS.concat(["registry", "brokers", "mgas", "carriers", "customers", "workbench", "documents", "loyalty", "terms", "domain-model", "data-model", "api-reference", "architecture"]),
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
    if (!spec || spec.scope === "all") return policies;
    if (spec.scope === "producer") return policies.filter(function (p) { return p.producer === spec.identity; });
    if (spec.scope === "carrier") return policies.filter(function (p) { return p.carrier === spec.identity; });
    if (spec.scope === "holder") return policies.filter(function (p) { return p.holder === spec.identity; });
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

  /* ---------- decision audit (who / when / action / comment) ---------- */
  PAS.COMMENT_MIN_RECOMMENDED = 20;
  PAS.actorName = function () {
    var spec = ROLES[PAS.getRole()];
    return (spec && spec.identity) || "You";
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
  /* Escalate / Request More Information: stamp the held row, append a completed note, leave status Pending. */
  PAS.recordHeldDecision = function (id, txnId, action, comment, typeHint) {
    var audit = PAS.makeAudit(action, comment);
    return patch(id, function (p) {
      var held = txnId ? p.history.find(function (h) { return h.id === txnId; }) : null;
      var history = held
        ? p.history.map(function (h) { return h.id === txnId ? withAudit(h, audit) : h; })
        : p.history;
      return pushTxn(Object.assign({}, p, { history: history }), {
        date: todayISO(), type: (held && held.type) || typeHint || "Underwriting",
        title: ((held && held.type) || typeHint || "Underwriting") + ": " + action,
        detail: audit.comment, user: audit.user,
        meta: { audit: audit, noteOnly: true },
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
        return issueGatesPass(bound) ? doIssue(bound, true) : bound;
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
      var titles = { Cancellation: "Cancellation requested — awaiting decision", Renewal: "Renewal requested — awaiting decision", Reinstatement: "Reinstatement requested — awaiting decision", Endorsement: "Endorsement requested — awaiting decision", Transfer: "Transfer requested — awaiting decision" };
      var effDate = type === "Renewal" ? p.expirationDate : todayISO();
      return pushTxn(p, { date: effDate, type: type, status: "Pending", title: titles[type],
        detail: "Requested by " + meta.initiatedBy + " via " + meta.channel + ". \"" + meta.requestNote + "\"",
        meta: Object.assign({}, meta, { submittedOn: submittedOn }) });
    });
  };
  PAS.decideCancellation = function (id, txnId, approve, effDate, q, audit) {
    return patch(id, function (p) {
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        var detail = approve ? ("Approved. " + q.type + " basis, effective " + effDate + ". Refund " + money(q.refund) + ".") : ("Declined. Policy remains ACTIVE. " + h.detail);
        if (audit && audit.comment) detail += " " + audit.comment;
        return withAudit(h, audit, {
          status: approve ? "Completed" : "Rejected", date: effDate,
          title: approve ? "Cancellation approved" : "Cancellation declined",
          detail: detail,
          meta: { cancelType: q.type, refund: Math.round(q.refund) },
        });
      });
      if (!approve) return Object.assign({}, p, { history: history });
      return Object.assign({}, p, { history: history, status: "Cancelled",
        documents: (p.documents || []).concat([{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: todayISO(), type: "Notice" }]) });
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
