import { useState, useRef } from "react";
import {
  FileText, Edit3, XCircle, RotateCcw, RefreshCw, Headphones, Loader2, Plus, Bell, X,
  LayoutDashboard, ListChecks, Terminal, ArrowLeft, ArrowRight, Search, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, Layers, ChevronRight, ClipboardCheck, ShieldCheck, Activity,
  Info, Radio, Inbox, GitBranch, KeyRound, Stamp, FileCheck2, TrendingUp, TrendingDown,
  Clock, Ban, CornerUpLeft, Download, Building2, Zap, ArrowUpRight, ArrowDownLeft,
  User, Users, Cpu, PhoneCall, Send,
} from "lucide-react";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');`;

const C = {
  bg: "#F5F6FA", surface: "#FFFFFF", surfaceAlt: "#FAFBFD", border: "#E5E7F0",
  text: "#14162B", textSoft: "#666B80", textFaint: "#9AA0B4",
  sidebar: "#101124", sidebarAlt: "#191A33", sidebarText: "#9EA2C4",
  primary: "#5B5BF0", primarySoft: "#EEEEFE", primaryDark: "#4640D6",
  green: "#16A34A", greenSoft: "#E7F8ED", amber: "#D97706", amberSoft: "#FDF1DF",
  red: "#DC2626", redSoft: "#FCEAEA", blue: "#2563EB", blueSoft: "#E8F0FE",
  violet: "#8B3EE8", violetSoft: "#F2E8FD", gray: "#6B7080", graySoft: "#EEF0F5",
};
const shadow = "0 1px 2px rgba(20,22,43,0.04), 0 4px 14px rgba(20,22,43,0.06)";
const MONO = "'JetBrains Mono',monospace";

const uid = (p) => p + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
const todayISO = () => "2026-08-20";
const addDays = (iso, d) => { const x = new Date(iso); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const money = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const moneyShort = (n) => n >= 10000000 ? "₹" + (n / 10000000).toFixed(2) + "Cr" : n >= 100000 ? "₹" + (n / 100000).toFixed(1) + "L" : money(n);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const REINSTATEMENT_WINDOW_DAYS = 45;
const RENEWAL_LEAD_DAYS = 45;
const AUTHORITY_LIMIT = 5000000;
const LOW_SCORE_REFER = 50;

/* ---------- the four cancellation types, each with its own default rate logic ----------
   Type is DERIVED from who initiated it and why — it is not a free choice by the user. */
const CANCEL_TYPES = {
  Flat: {
    tone: "blue", initiator: "Either", noticeDays: 0, penaltyPct: 0, basis: "full",
    when: "Cancelled as of the policy effective date — the insurer never went on risk.",
    rate: "100% of written premium returned. No earned portion, no penalty.",
    rule: "Only valid when the effective date equals the policy inception date.",
  },
  "Pro-Rata": {
    tone: "green", initiator: "Insurer", noticeDays: 30, penaltyPct: 0, basis: "unearned",
    when: "Insurer cancels mid-term for an underwriting or regulatory reason.",
    rate: "Full unearned premium returned, in exact proportion to the unused term. No penalty.",
    rule: "Insurer-initiated cancellations may never apply a short-rate penalty.",
  },
  "Short-Rate": {
    tone: "amber", initiator: "Insured", noticeDays: 0, penaltyPct: 0.1, basis: "unearned",
    when: "Policyholder chooses to cancel mid-term.",
    rate: "Unearned premium minus a 10% short-rate penalty covering the insurer's acquisition cost.",
    rule: "The penalty shrinks as the term runs — the longer in force, the smaller the deduction.",
  },
  "Non-Payment": {
    tone: "red", initiator: "Insurer", noticeDays: 15, penaltyPct: 0, basis: "unearned",
    when: "Premium remains unpaid after the grace period lapses.",
    rate: "Unearned premium returned, but a statutory 15-day notice must run before the effective date.",
    rule: "Cancelling for non-payment without serving the notice period is a regulatory breach.",
  },
};
const CANCEL_REASONS = {
  "Insured request": { type: "Short-Rate", initiator: "Insured" },
  "Vehicle/asset sold": { type: "Short-Rate", initiator: "Insured" },
  "Cancelled at inception": { type: "Flat", initiator: "Either" },
  "Duplicate policy": { type: "Flat", initiator: "Either" },
  "Non-payment": { type: "Non-Payment", initiator: "Insurer" },
  "Underwriting decision": { type: "Pro-Rata", initiator: "Insurer" },
  "Regulatory / compliance": { type: "Pro-Rata", initiator: "Insurer" },
  "Fraud": { type: "Pro-Rata", initiator: "Insurer" },
};
/* Everything about a cancellation follows from reason + dates. Nothing is hand-keyed. */
function cancelQuote(policy, reason, effectiveDate) {
  const map = CANCEL_REASONS[reason] || CANCEL_REASONS["Insured request"];
  const t = CANCEL_TYPES[map.type];
  const totalDays = Math.max(1, daysBetween(policy.effectiveDate, policy.expirationDate));
  const atInception = effectiveDate <= policy.effectiveDate;
  const type = atInception ? "Flat" : map.type;
  const spec = CANCEL_TYPES[type];
  const remainingDays = Math.max(0, daysBetween(effectiveDate, policy.expirationDate));
  const unearned = policy.premium * (remainingDays / totalDays);
  const gross = type === "Flat" ? policy.premium : unearned;
  const penalty = gross * spec.penaltyPct;
  const refund = Math.max(0, gross - penalty);
  const noticeProvided = daysBetween(todayISO(), effectiveDate);
  return {
    type, spec, initiator: map.initiator, totalDays, remainingDays,
    earnedDays: totalDays - remainingDays, gross, penalty, refund,
    noticeRequired: spec.noticeDays, noticeProvided, noticeOk: noticeProvided >= spec.noticeDays,
    needsReview: reason === "Fraud" || noticeProvided < spec.noticeDays,
  };
}

function riskScore(premium, seedTxt) {
  const base = 92 - Math.round((Number(premium) || 0) / 90000);
  const noise = ((String(seedTxt || "").length * 7) % 11) - 5;
  return Math.max(5, Math.min(97, base + noise));
}
function underwritingDecision(premium, score) {
  if (score < LOW_SCORE_REFER) return { outcome: "Refer", tier: "Senior underwriter", reason: `Risk score ${score} is below the ${LOW_SCORE_REFER} auto-refer threshold.` };
  if (Number(premium) > AUTHORITY_LIMIT) return { outcome: "Refer", tier: "Senior underwriter", reason: `Premium exceeds the ${money(AUTHORITY_LIMIT)} delegated authority limit.` };
  return { outcome: "Approve", tier: "Within agent authority", reason: `Score ${score} and premium are inside standard authority.` };
}
function renewalCompliance(policy) {
  const daysToExpiry = daysBetween(todayISO(), policy.expirationDate);
  return { daysToExpiry, status: daysToExpiry < 0 ? "Overdue" : daysToExpiry < RENEWAL_LEAD_DAYS ? "Urgent" : "Compliant" };
}
function lastEvent(policy, type) {
  const evs = policy.history.filter((h) => h.type === type).sort((a, b) => (a.date < b.date ? 1 : -1));
  return evs[0] || null;
}
function reinstatementEligibility(policy) {
  const ev = lastEvent(policy, "Cancellation");
  if (!ev) return null;
  const daysSince = daysBetween(ev.date, todayISO());
  const fraud = ev.meta?.reason === "Fraud";
  return { cancelEv: ev, daysSince, fraud, eligible: !fraud && daysSince <= REINSTATEMENT_WINDOW_DAYS && daysSince >= 0 };
}
const txn = (seq, date, type, title, detail, user, meta, status) => ({
  id: uid("TXN"), seq, date, recordedAt: date + "T09:30:00.000Z", type, title, detail,
  user, status: status || "Completed", meta: meta || {},
});

/* ---------- the book of business ----------
   This is the point of a PAS: the data is ALREADY here and the operator makes decisions on it.
   Every status below represents work sitting on someone's desk right now. */
function seedPolicies() {
  return [
    /* --- awaiting an underwriting decision --- */
    { id: "SUB-2026-0041", holder: "Sharma Textiles Pvt Ltd", product: "Commercial Property", status: "Referred",
      effectiveDate: "2026-09-01", expirationDate: "2027-09-01", premium: 6200000, termNumber: 1,
      producer: "Apex Insurance Brokers", submittedOn: "2026-08-14", sumInsured: "₹12,00,00,000",
      documents: [], history: [
        txn(1, "2026-08-14", "Submission", "Submission received", "Commercial property risk, 3 locations, Bhiwandi & Surat.", "Apex Brokers", { channel: "Broker" }),
        txn(2, "2026-08-15", "Underwriting", "Auto-referred to senior underwriter", "Premium above delegated authority and score below threshold.", "System", { score: 46, tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-15", requestNote: "Score and authority checks failed — routed automatically, no human trigger." }, "Pending"),
      ] },
    { id: "SUB-2026-0042", holder: "Kavita Enterprises", product: "Comprehensive Auto", status: "Referred",
      effectiveDate: "2026-09-05", expirationDate: "2027-09-05", premium: 184000, termNumber: 1,
      producer: "Direct", submittedOn: "2026-08-17", sumInsured: "₹18,00,000 IDV",
      documents: [], history: [
        txn(1, "2026-08-17", "Submission", "Submission received", "Fleet of 4 commercial vehicles.", "Direct", { channel: "Direct" }),
        txn(2, "2026-08-18", "Underwriting", "Awaiting underwriter decision", "Two at-fault claims in the prior term.", "System", { score: 44, tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-18", requestNote: "Score below threshold on prior claims history — routed automatically." }, "Pending"),
      ] },
    { id: "SUB-2026-0043", holder: "Coastal Marine Traders", product: "Marine Cargo", status: "Referred",
      effectiveDate: "2026-09-10", expirationDate: "2027-09-10", premium: 5800000, termNumber: 1,
      producer: "Meridian Risk Partners", submittedOn: "2026-08-16", sumInsured: "₹9,50,00,000",
      documents: [], history: [
        txn(1, "2026-08-16", "Submission", "Submission received", "Cargo cover for 3 vessels, Mumbai–Colombo route.", "Meridian Risk", { channel: "Broker" }),
        txn(2, "2026-08-17", "Underwriting", "Auto-referred to senior underwriter", "Premium exceeds delegated agent authority.", "System", { score: 58, tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-17", requestNote: "Premium above authority limit — routed automatically." }, "Pending"),
      ] },
    { id: "SUB-2026-0044", holder: "Horizon Health Corp", product: "Group Health", status: "Referred",
      effectiveDate: "2026-09-12", expirationDate: "2027-09-12", premium: 920000, termNumber: 1,
      producer: "Direct", submittedOn: "2026-08-20", sumInsured: "₹5,00,00,000 (group limit)",
      documents: [], history: [
        txn(1, "2026-08-20", "Submission", "Submission received", "Group health cover for 140 employees.", "Direct", { channel: "Direct" }),
        txn(2, "2026-08-20", "Underwriting", "Awaiting underwriter decision", "New group scheme, no prior claims history on file.", "System", { score: 61, tier: "Senior underwriter", initiatedBy: "System", channel: "Auto-referral engine", submittedOn: "2026-08-20", requestNote: "First-time group scheme — routed for manual review pending census data." }, "Pending"),
      ] },

    /* --- bound, awaiting formal issue --- */
    { id: "POL-2026-00311", holder: "Nirmala Rao", product: "Home Owners", status: "Bound",
      effectiveDate: "2026-08-25", expirationDate: "2027-08-25", premium: 46800, termNumber: 1,
      producer: "Apex Insurance Brokers", sumInsured: "₹85,00,000",
      binder: { number: "BN-2026-0311", boundOn: "2026-08-12", expiryDate: "2026-09-11",
        subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Electrical safety certificate", met: false }] },
      documents: [], history: [
        txn(1, "2026-08-10", "Submission", "Submission received", "New home owners risk, Pune.", "Apex Brokers", {}),
        txn(2, "2026-08-11", "Underwriting", "Underwriting: Approve", "Score 81, within agent authority.", "A. Nair", { score: 81, tier: "Within agent authority" }),
        txn(3, "2026-08-12", "Bind", "Bound — binder BN-2026-0311", "Provisional cover in force for 30 days pending issue.", "A. Nair", { binderNumber: "BN-2026-0311" }),
      ] },
    { id: "POL-2026-00312", holder: "Ganesh Logistics LLP", product: "Comprehensive Auto", status: "Bound",
      effectiveDate: "2026-08-22", expirationDate: "2027-08-22", premium: 312000, termNumber: 1,
      producer: "Meridian Risk Partners", sumInsured: "₹42,00,000 IDV",
      binder: { number: "BN-2026-0312", boundOn: "2026-08-16", expiryDate: "2026-09-15",
        subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Fleet schedule confirmed", met: true }] },
      documents: [], history: [
        txn(1, "2026-08-14", "Submission", "Submission received", "12-vehicle goods carrier fleet.", "Meridian Risk", {}),
        txn(2, "2026-08-15", "Underwriting", "Underwriting: Approve", "Score 76, within agent authority.", "A. Nair", { score: 76, tier: "Within agent authority" }),
        txn(3, "2026-08-16", "Bind", "Bound — binder BN-2026-0312", "All subjectivities satisfied; ready to issue.", "A. Nair", { binderNumber: "BN-2026-0312" }),
      ] },
    { id: "POL-2026-00313", holder: "Meridian Textiles Ltd", product: "Commercial Property", status: "Bound",
      effectiveDate: "2026-08-28", expirationDate: "2027-08-28", premium: 612000, termNumber: 1,
      producer: "Apex Insurance Brokers", sumInsured: "₹4,20,00,000",
      binder: { number: "BN-2026-0313", boundOn: "2026-08-13", expiryDate: "2026-09-12",
        subjectivities: [{ label: "Signed proposal form", met: true }, { label: "Fire safety certificate", met: false }] },
      documents: [], history: [
        txn(1, "2026-08-11", "Submission", "Submission received", "Textile warehouse and factory floor, Surat.", "Apex Brokers", {}),
        txn(2, "2026-08-12", "Underwriting", "Underwriting: Approve", "Score 74, within agent authority.", "A. Nair", { score: 74, tier: "Within agent authority" }),
        txn(3, "2026-08-13", "Bind", "Bound — binder BN-2026-0313", "Provisional cover in force pending fire safety certificate.", "A. Nair", { binderNumber: "BN-2026-0313" }),
      ] },
    { id: "POL-2026-00314", holder: "Deepak Auto Traders", product: "Comprehensive Auto", status: "Bound",
      effectiveDate: "2026-08-26", expirationDate: "2027-08-26", premium: 218000, termNumber: 1,
      producer: "Direct", sumInsured: "₹31,00,000 IDV",
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
      producer: "Direct", sumInsured: "₹8,50,000 IDV",
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
      producer: "Meridian Risk Partners", sumInsured: "₹1,10,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-10-12", type: "Schedule" }],
      history: [
        txn(1, "2025-10-12", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-08-14", "Endorsement", "Endorsement requested: Coverage change", "Add flood cover following monsoon risk review. HELD — material change, not yet applied.", "Broker portal",
          { changeType: "Coverage change", materiality: "Material", premiumImpact: 7800, initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-14", requestNote: "Client wants flood cover added given this year's monsoon forecast." }, "Pending"),
      ] },
    { id: "POL-2026-00120", holder: "Ritu Kapoor", product: "Comprehensive Auto", status: "Active",
      effectiveDate: "2026-04-02", expirationDate: "2027-04-02", premium: 39000, termNumber: 1,
      producer: "Direct", sumInsured: "₹7,40,000 IDV",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-04-02", type: "Schedule" }],
      history: [
        txn(1, "2026-04-02", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-08-17", "Endorsement", "Endorsement requested: Address change", "Registered address updated to new residence in Bengaluru.", "Self-service portal",
          { changeType: "Address change", materiality: "Minor", premiumImpact: 0, initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-17", requestNote: "Moved house last week, please update my address on file." }, "Pending"),
      ] },
    { id: "POL-2024-00187", holder: "Priya Deshmukh", product: "Home Owners", status: "Active",
      effectiveDate: "2025-08-20", expirationDate: "2026-08-20", premium: 21800, termNumber: 2,
      producer: "Apex Insurance Brokers", sumInsured: "₹42,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 2, generatedAt: "2025-08-20", type: "Schedule" }],
      history: [
        txn(1, "2024-08-20", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2025-08-20", "Renewal", "Renewed into term 2", "No change in coverage.", "System", { previousPremium: 20200, newPremium: 21800 }),
        txn(3, "2026-08-20", "Renewal", "Renewal requested — awaiting decision", "Insured confirmed intent to renew via self-service portal. Term expires today; re-underwriting and pricing pending.", "Self-service portal",
          { initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-11", requestNote: "Please renew my home policy, no changes needed." }, "Pending"),
      ] },
    { id: "POL-2026-02233", holder: "Karan Malhotra", product: "Term Life", status: "Active",
      effectiveDate: "2026-02-01", expirationDate: "2027-02-01", premium: 15600, termNumber: 1,
      producer: "Direct", sumInsured: "₹1,00,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-02-01", type: "Schedule" }],
      history: [
        txn(1, "2026-02-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-08-19", "Cancellation", "Cancellation requested — held for review", "Insured requests cancellation. Short-rate. HELD — awaiting review.", "Broker portal",
          { reason: "Insured request", cancelType: "Short-Rate", refund: 6890, initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-19", requestNote: "Client is emigrating and no longer needs the policy." }, "Pending"),
      ] },
    { id: "POL-2026-00988", holder: "Bharat Steel Works", product: "Commercial Property", status: "Active",
      effectiveDate: "2026-03-15", expirationDate: "2027-03-15", premium: 890000, termNumber: 3,
      producer: "Meridian Risk Partners", sumInsured: "₹6,50,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 3, generatedAt: "2026-03-15", type: "Schedule" }],
      history: [
        txn(1, "2026-03-15", "Renewal", "Renewed into term 3", "Premium increased 8% on claims experience.", "A. Nair", { previousPremium: 824000, newPremium: 890000 }),
        txn(2, "2026-09-15", "Cancellation", "Cancellation requested — held for review", "Underwriter-initiated on adverse loss ratio. HELD — requires a second underwriter's sign-off before it can proceed.", "Internal review",
          { reason: "Underwriting decision", initiatedBy: "Underwriter", channel: "Internal review", submittedOn: "2026-08-19", requestNote: "Loss ratio has run 140% over two terms on this location — recommend non-renewal path via mid-term cancellation with full notice." }, "Pending"),
      ] },
    { id: "POL-2026-00560", holder: "Ashok Furnishings", product: "Commercial Property", status: "Active",
      effectiveDate: "2026-05-01", expirationDate: "2027-05-01", premium: 264000, termNumber: 1,
      producer: "Meridian Risk Partners", sumInsured: "₹2,80,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-05-01", type: "Schedule" }],
      history: [
        txn(1, "2026-05-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-08-18", "Cancellation", "Cancellation requested — held for review", "Underwriter-initiated after inconsistencies found in the proposal declaration. HELD — fraud review.", "Internal review",
          { reason: "Fraud", initiatedBy: "Underwriter", channel: "Internal review", submittedOn: "2026-08-18", requestNote: "Site survey contradicts declared stock value by a wide margin — recommend fraud review before any further action." }, "Pending"),
      ] },
    { id: "POL-2025-08765", holder: "Neha Bhatt", product: "Home Owners", status: "Active",
      effectiveDate: "2025-12-01", expirationDate: "2026-12-01", premium: 27400, termNumber: 1,
      producer: "Direct", sumInsured: "₹55,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-12-01", type: "Schedule" }],
      history: [
        txn(1, "2025-12-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-08-16", "Cancellation", "Cancellation requested — held for review", "Insured is relocating overseas and no longer needs the property covered.", "Self-service portal",
          { reason: "Insured request", initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-16", requestNote: "We're moving abroad end of this month, please cancel the policy." }, "Pending"),
      ] },
    { id: "POL-2025-06210", holder: "Suresh Iyer", product: "Comprehensive Auto", status: "Active",
      effectiveDate: "2025-09-10", expirationDate: "2026-09-10", premium: 44500, termNumber: 1,
      producer: "Apex Insurance Brokers", sumInsured: "₹8,90,000 IDV",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-09-10", type: "Schedule" }],
      history: [
        txn(1, "2025-09-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-08-15", "Renewal", "Renewal requested — awaiting decision", "Broker confirmed renewal intent ahead of the notice deadline.", "Broker portal",
          { initiatedBy: "Broker/Producer", channel: "Broker portal", submittedOn: "2026-08-15", requestNote: "Client confirmed renewal, no changes to the vehicle." }, "Pending"),
      ] },
    { id: "POL-2024-09321", holder: "Lakshmi Textiles Ltd", product: "Commercial Property", status: "Active",
      effectiveDate: "2025-10-01", expirationDate: "2026-10-01", premium: 745000, termNumber: 3,
      producer: "Meridian Risk Partners", sumInsured: "₹5,80,00,000",
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
      producer: "Direct", sumInsured: "₹2,00,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-07-01", type: "Schedule" }],
      history: [
        txn(1, "2025-07-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-02-14", "Servicing", "Service request logged", "Nominee details updated on file.", "Direct", { category: "Contact update", channel: "Phone" }),
      ] },
    { id: "POL-2026-00777", holder: "Global Freight Movers", product: "Marine Cargo", status: "Active",
      effectiveDate: "2026-01-15", expirationDate: "2027-01-15", premium: 1180000, termNumber: 1,
      producer: "Meridian Risk Partners", sumInsured: "₹18,00,00,000",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2026-01-15", type: "Schedule" }],
      history: [
        txn(1, "2026-01-15", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-04-02", "Endorsement", "Endorsement: Add route", "Added Chennai–Singapore lane to the schedule.", "Meridian Risk", { changeType: "Coverage change", materiality: "Minor", premiumImpact: 12000 }),
        txn(3, "2026-06-18", "Servicing", "Service request logged", "Duplicate certificate of insurance emailed for customs clearance.", "Meridian Risk", { category: "Document request", channel: "Email" }),
      ] },
    { id: "POL-2025-03321", holder: "Anita Krishnamurthy", product: "Group Health", status: "Active",
      effectiveDate: "2025-09-01", expirationDate: "2026-09-01", premium: 68000, termNumber: 1,
      producer: "Direct", sumInsured: "₹15,00,000 (family floater)",
      documents: [{ id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: "2025-09-01", type: "Schedule" }],
      history: [
        txn(1, "2025-09-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-03-11", "Servicing", "Service request logged", "Query on cashless hospital network coverage.", "Direct", { category: "Inquiry", channel: "Phone" }),
        txn(3, "2026-07-02", "Servicing", "Service request logged", "Billing dispute on last installment resolved.", "Direct", { category: "Billing", channel: "Email" }),
      ] },

    /* --- cancelled: one reinstatement candidate, one time-barred --- */
    { id: "POL-2026-01190", holder: "Divya Krishnan", product: "Comprehensive Auto", status: "Cancelled",
      effectiveDate: "2026-01-10", expirationDate: "2027-01-10", premium: 33000, termNumber: 1,
      producer: "Direct", sumInsured: "₹6,20,000 IDV",
      documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-08-05", type: "Notice" }],
      history: [
        txn(1, "2026-01-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-08-05", "Cancellation", "Policy cancelled", "Cancelled for non-payment after the 15-day notice ran.", "System",
          { reason: "Non-payment", cancelType: "Non-Payment", refund: 0, requestedBy: "Billing" }),
        txn(3, "2026-08-19", "Reinstatement", "Reinstatement requested — awaiting decision", "Insured paid the outstanding premium and is requesting reinstatement via the self-service portal.", "Self-service portal",
          { initiatedBy: "Insured", channel: "Self-service portal", submittedOn: "2026-08-19", requestNote: "Payment has gone through now, please reactivate my policy.", outstandingClaimed: 33000 }, "Pending"),
      ] },
    { id: "POL-2026-00045", holder: "Farhan Sheikh", product: "Comprehensive Auto", status: "Cancelled",
      effectiveDate: "2025-11-20", expirationDate: "2026-11-20", premium: 36200, termNumber: 1,
      producer: "Direct", sumInsured: "₹6,80,000 IDV",
      documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-08-10", type: "Notice" }],
      history: [
        txn(1, "2025-11-20", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-08-10", "Cancellation", "Policy cancelled", "Cancelled for non-payment after the 15-day notice ran.", "System",
          { reason: "Non-payment", cancelType: "Non-Payment", refund: 0, requestedBy: "Billing" }),
        txn(3, "2026-08-18", "Reinstatement", "Reinstatement requested — awaiting decision", "Insured called in to confirm payment has cleared and requests reinstatement.", "Phone",
          { initiatedBy: "Insured", channel: "Phone", submittedOn: "2026-08-18", requestNote: "Sorry for the delay, payment has gone through, please switch the cover back on.", outstandingClaimed: 36200 }, "Pending"),
      ] },
    { id: "POL-2025-12200", holder: "Ovais Traders", product: "Home Owners", status: "Cancelled",
      effectiveDate: "2025-06-01", expirationDate: "2026-06-01", premium: 41000, termNumber: 1,
      producer: "Meridian Risk Partners", sumInsured: "₹95,00,000",
      documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-07-25", type: "Notice" }],
      history: [
        txn(1, "2025-06-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-07-25", "Cancellation", "Policy cancelled", "Cancelled following a confirmed fraud investigation — declaration discrepancies substantiated.", "A. Nair",
          { reason: "Fraud", cancelType: "Pro-Rata", refund: 0 }),
      ] },
    { id: "POL-2025-05678", holder: "Meenal Joshi", product: "Comprehensive Auto", status: "Cancelled",
      effectiveDate: "2025-04-10", expirationDate: "2026-04-10", premium: 29800, termNumber: 1,
      producer: "Direct", sumInsured: "₹5,60,000 IDV",
      documents: [{ id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: "2026-06-21", type: "Notice" }],
      history: [
        txn(1, "2025-04-10", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Direct" }),
        txn(2, "2026-06-21", "Cancellation", "Policy cancelled", "Cancelled at insured's request — vehicle sold.", "R. Iyer",
          { reason: "Vehicle/asset sold", cancelType: "Short-Rate", refund: 5100 }),
      ] },
    { id: "POL-2025-11044", holder: "Arjun Bhatia", product: "Comprehensive Auto", status: "Cancelled",
      effectiveDate: "2025-11-01", expirationDate: "2026-11-01", premium: 39500, termNumber: 1,
      producer: "Apex Insurance Brokers", sumInsured: "₹7,10,000 IDV",
      documents: [], history: [
        txn(1, "2025-11-01", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" }),
        txn(2, "2026-05-30", "Cancellation", "Policy cancelled", "Cancelled at insured's request — vehicle sold. Short-rate refund issued.", "R. Iyer",
          { reason: "Vehicle/asset sold", cancelType: "Short-Rate", refund: 6900 }),
      ] },
    { id: "POL-2024-07765", holder: "Sanjay Rao", product: "Home Owners", status: "Expired",
      effectiveDate: "2024-06-15", expirationDate: "2025-06-15", premium: 18400, termNumber: 1,
      producer: "Apex Insurance Brokers", sumInsured: "₹35,00,000", documents: [],
      history: [txn(1, "2024-06-15", "Issuance", "Policy issued", "New business bound and issued.", "U. Sharma", { channel: "Broker" })] },
  ];
}

/* ================= API + LIVE NOTIFICATION LAYER ================= */
const TENANT = "0190c4f2-77aa-7c31-9f10-5a2e4b8c1d33";
const EVENT_FOR = {
  "/issue": "policyIssued", "/endorsements": "policyEndorsed", "/cancellations": "policyCancelled",
  "/reinstatements": "policyReinstated", "/renewals": "policyRenewed", "/non-renewal": "policyNonRenewed",
  "/service-requests": "serviceRequestLogged", "/approve": "transactionApproved",
  "/reject": "transactionRejected", "/reverse": "transactionReversed",
  "/underwriting-decision": "underwritingDecided", "/documents": "documentGenerated",
};
const CONSUMERS = { policyIssued: ["Billing", "Documents", "Reinsurance"], policyCancelled: ["Billing", "Claims", "Documents"], policyRenewed: ["Billing", "Documents"], policyEndorsed: ["Billing", "Documents"], policyReinstated: ["Billing", "Claims"], documentGenerated: ["Documents"], underwritingDecided: ["CRM"], transactionApproved: ["Billing"], transactionRejected: ["CRM"], transactionReversed: ["Billing"], policyNonRenewed: ["CRM", "Documents"], serviceRequestLogged: ["CRM"] };
const eventTypeFor = (ep) => { const k = Object.keys(EVENT_FOR).find((x) => ep.includes(x)); return k ? EVENT_FOR[k] : null; };

/* One call produces a whole lifecycle: request out → response in → domain event → consumers.
   Each stage raises a notification so the operator literally watches it happen. */
function useApiLog() {
  const [log, setLog] = useState([]);
  const [events, setEvents] = useState([]);
  const [notes, setNotes] = useState([]);
  const [flows, setFlows] = useState([]);
  const notify = (n) => setNotes((p) => [{ id: uid("N"), at: Date.now(), ...n }, ...p].slice(0, 60));

  function call(method, endpoint, requestBody, meta) {
    return new Promise((resolve) => {
      const start = Date.now();
      const flowId = uid("FLOW");
      const short = endpoint.split("?")[0];
      notify({ dir: "out", kind: "request", title: `${method} ${short.split("/").slice(-2).join("/")}`, detail: meta?.label || "Request sent to Policy API", tone: "blue" });
      setTimeout(() => {
        const responseBody = meta?.response || { ok: true, requestId: uid("REQ") };
        const statusCode = meta?.statusCode || (method === "GET" ? 200 : method === "POST" ? 201 : 200);
        const latency = Date.now() - start;
        const entry = { id: uid("LOG"), flowId, time: new Date().toISOString(), method, endpoint, requestBody, responseBody, statusCode, latency, module: meta?.module, policyId: meta?.policyId, label: meta?.label };
        setLog((p) => [entry, ...p]);
        notify({ dir: "in", kind: "response", title: `${statusCode} · ${latency}ms`, detail: short, tone: statusCode >= 400 ? "red" : statusCode === 202 ? "violet" : "green" });

        const et = method !== "GET" && eventTypeFor(endpoint);
        let ev = null;
        if (et) {
          const consumers = CONSUMERS[et] || ["Billing"];
          ev = { eventId: uid("EVT").toLowerCase(), flowId, eventType: et, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: TENANT, aggregateType: "policy", aggregateId: meta?.policyId || "—", producer: "veridex-policy", consumers, data: responseBody };
          setEvents((p) => [ev, ...p]);
          setTimeout(() => notify({ dir: "out", kind: "event", title: et, detail: `Published to ${consumers.join(", ")}`, tone: "violet" }), 260);
        }
        setFlows((p) => [{ id: flowId, at: new Date().toISOString(), action: meta?.label || `${method} ${short}`, policyId: meta?.policyId, call: entry, event: ev, ledger: meta?.ledger }, ...p].slice(0, 40));
        resolve(responseBody);
      }, 260 + Math.random() * 240);
    });
  }
  return { log, events, notes, flows, call, notify, clearNotes: () => setNotes([]) };
}

/* ================= ATOMS ================= */
const inputStyle = { width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif", fontSize: 13.5, padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.text, outline: "none" };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: shadow };
const label11 = { fontSize: 10.5, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.6 };
const TONES = { green: [C.greenSoft, C.green], red: [C.redSoft, C.red], amber: [C.amberSoft, C.amber], blue: [C.blueSoft, C.blue], violet: [C.violetSoft, C.violet], indigo: [C.primarySoft, C.primary], gray: [C.graySoft, C.gray] };

function Tooltip({ tip, what, why, rule, children, width }) {
  const [pos, setPos] = useState(null); const ref = useRef(null);
  function show() {
    const r = ref.current.getBoundingClientRect(); const w = width || 280;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const below = r.bottom + 200 < vh;
    setPos({ x: Math.max(10, Math.min(r.left + r.width / 2 - w / 2, vw - w - 10)), y: below ? r.bottom + 7 : undefined, yb: below ? undefined : vh - r.top + 7, w });
  }
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "help" }}>
      {children}
      {pos && <span style={{ position: "fixed", left: pos.x, top: pos.y, bottom: pos.yb, width: pos.w, zIndex: 9999, background: "#14152B", color: "#E4E6F5", borderRadius: 9, padding: "10px 12px", fontSize: 12, lineHeight: 1.55, fontWeight: 400, boxShadow: "0 8px 26px rgba(10,12,30,.34)", textTransform: "none", letterSpacing: 0, pointerEvents: "none", textAlign: "left" }}>
        {tip && <span style={{ display: "block" }}>{tip}</span>}
        {what && <span style={{ display: "block" }}><b style={{ color: "#fff" }}>What </b>{what}</span>}
        {why && <span style={{ display: "block", marginTop: 5 }}><b style={{ color: "#8FA6FF" }}>Why </b>{why}</span>}
        {rule && <span style={{ display: "block", marginTop: 5, paddingTop: 5, borderTop: "1px solid #2C2E4E", color: "#B9BEDC" }}><b style={{ color: "#FFC46B" }}>Rule </b>{rule}</span>}
      </span>}
    </span>
  );
}
const InfoDot = ({ size }) => <Info size={size || 11} style={{ color: C.textFaint, flexShrink: 0 }} />;
const TipLabel = ({ text, tip, what, why, rule, style }) => (
  <Tooltip tip={tip} what={what} why={why} rule={rule}><span style={style}>{text}</span><InfoDot /></Tooltip>
);
function Pill({ tone, children, icon: Icon }) {
  const [bg, fg] = TONES[tone] || TONES.gray;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{Icon && <Icon size={10} />}{children}</span>;
}
const STATUS_TONE = { Active: "green", Cancelled: "red", Expired: "gray", Bound: "amber", Referred: "violet", Submitted: "blue", "Non-renewed": "red", Declined: "red" };
const Badge = ({ status }) => <Pill tone={STATUS_TONE[status] || "gray"}>{status}</Pill>;
const TXN_TONE = { Completed: "green", Pending: "amber", Rejected: "red", Reversed: "violet" };
const TxnStatusBadge = ({ status }) => <Pill tone={TXN_TONE[status] || "gray"}>{status || "Completed"}</Pill>;
const MODULE_TONE = { Submission: "blue", Underwriting: "violet", Bind: "amber", Issuance: "indigo", Endorsement: "amber", Cancellation: "red", Reinstatement: "green", Renewal: "blue", Servicing: "violet" };
const MODULE_ICON = { Submission: Inbox, Underwriting: ClipboardCheck, Bind: ShieldCheck, Issuance: Stamp, Endorsement: Edit3, Cancellation: XCircle, Reinstatement: RotateCcw, Renewal: RefreshCw, Servicing: Headphones };

/* ---------- who can originate a request, and by what channel ----------
   Cancellation, Renewal and Reinstatement are never self-initiated by ops — a request
   always arrives first (from the insured, a broker, an underwriter's own review, or an
   automated system trigger) and only then does an underwriter decide it. This taxonomy
   is what every "Requested by" block on a decision screen renders from. */
const INITIATORS = {
  Insured: { icon: User, tone: "blue", label: "Insured", channels: ["Self-service portal", "Phone", "Email"] },
  "Broker/Producer": { icon: Users, tone: "indigo", label: "Broker / Producer", channels: ["Broker portal", "Phone", "Email"] },
  Underwriter: { icon: ClipboardCheck, tone: "violet", label: "Underwriter (internal)", channels: ["Internal review", "Portfolio audit"] },
  System: { icon: Cpu, tone: "gray", label: "System (automated)", channels: ["Billing non-payment trigger", "Renewal reminder job"] },
};
function RequestOrigin({ meta }) {
  const init = INITIATORS[meta?.initiatedBy] || INITIATORS.Insured;
  const Icon = init.icon;
  return (
    <div style={{ ...card, boxShadow: "none", padding: 12, background: TONES[init.tone][0], borderColor: TONES[init.tone][1], marginBottom: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: meta?.requestNote ? 6 : 0 }}>
        <Icon size={14} color={TONES[init.tone][1]} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>Requested by {init.label}</span>
        <span style={{ fontSize: 11.5, color: C.textSoft }}>via {meta?.channel || "—"}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.textFaint }}>{meta?.submittedOn || "—"}</span>
      </div>
      {meta?.requestNote && <div style={{ fontSize: 12, color: C.textSoft, fontStyle: "italic", lineHeight: 1.5 }}>"{meta.requestNote}"</div>}
    </div>
  );
}
/* Small inline form used by every "Log a request" action — an ops user logging a phone-in
   or portal submission on someone else's behalf. It never executes anything itself; it only
   creates a Pending request that lands in the same review queue as a self-service submission. */
function LogRequestForm({ policies, typeLabel, extraFields, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [initiatedBy, setInitiatedBy] = useState("Insured");
  const [channel, setChannel] = useState(INITIATORS.Insured.channels[0]);
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState({});
  if (!open) {
    return <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: C.textSoft, cursor: "pointer", marginBottom: 15 }}>
      <PhoneCall size={13} /> Log a {typeLabel} request received by phone or email
    </button>;
  }
  return (
    <div style={{ ...card, padding: 15, marginBottom: 15 }}>
      <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text={`Log a ${typeLabel} request`}
        what="For requests that arrived outside self-service — a call, an email, a broker fax." why="It still lands in the Pending queue below; ops logging it never skips the decision step." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label="Policy">
          <select style={inputStyle} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            <option value="">Select…</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.holder}</option>)}
          </select>
        </Field>
        <Field label="Initiated by" hint="Who is actually asking for this.">
          <select style={inputStyle} value={initiatedBy} onChange={(e) => { setInitiatedBy(e.target.value); setChannel(INITIATORS[e.target.value].channels[0]); }}>
            {Object.keys(INITIATORS).map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label="Channel"><select style={inputStyle} value={channel} onChange={(e) => setChannel(e.target.value)}>{INITIATORS[initiatedBy].channels.map((c) => <option key={c}>{c}</option>)}</select></Field>
        {extraFields && extraFields(extra, setExtra)}
      </div>
      <Field label="Note" hint="What they actually said — quoted on the decision screen."><textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer called, wants to cancel — sold the car last week." /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { if (!policyId || !note.trim()) return; onSubmit({ policyId, initiatedBy, channel, note, extra }); setOpen(false); setPolicyId(""); setNote(""); setExtra({}); }}
          disabled={!policyId || !note.trim()}
          style={{ background: C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: !policyId || !note.trim() ? "not-allowed" : "pointer", opacity: !policyId || !note.trim() ? 0.5 : 1 }}>
          <Send size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Submit request
        </button>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, color: C.textSoft, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}
const MethodBadge = ({ method }) => <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "#fff", background: method === "GET" ? C.blue : C.primary, borderRadius: 4, padding: "2px 5px" }}>{method}</span>;
function StatusCodeBadge({ code }) {
  const t = code >= 400 ? C.red : code === 202 ? C.violet : C.green;
  const s = code >= 400 ? C.redSoft : code === 202 ? C.violetSoft : C.greenSoft;
  return <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: t, background: s, borderRadius: 4, padding: "2px 5px" }}>{code}</span>;
}
const CodeBlock = ({ data, small }) => (
  <pre style={{ background: "#14152B", color: "#C9CCE8", fontFamily: MONO, fontSize: small ? 10.5 : 11.5, lineHeight: 1.6, padding: small ? 9 : 12, borderRadius: 8, overflowX: "auto", margin: 0 }}>{JSON.stringify(data, null, 2)}</pre>
);
function Field({ label, children, hint }) {
  return <div style={{ marginBottom: 13 }}><label style={{ display: "block", ...label11, marginBottom: 5 }}>{label}</label>{children}{hint && <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4, lineHeight: 1.45 }}>{hint}</div>}</div>;
}
function Checkbox({ checked, onChange, label }) {
  return <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: C.text, marginBottom: 8, cursor: "pointer" }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 15, height: 15, accentColor: C.primary }} />{label}</label>;
}
function Callout({ tone, children }) {
  const [bg, fg] = TONES[tone === "info" ? "blue" : tone === "warn" ? "amber" : tone === "good" ? "green" : tone === "bad" ? "red" : "violet"];
  return <div style={{ background: bg, color: fg, borderRadius: 9, padding: "10px 13px", fontSize: 12.5, lineHeight: 1.55, marginBottom: 13, fontWeight: 500 }}>{children}</div>;
}
function DataTable({ columns, rows, emptyText, onRowClick }) {
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ background: C.surfaceAlt }}>
            {columns.map((c, i) => {
              const th = { textAlign: "left", padding: "9px 13px", fontSize: 10, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` };
              return typeof c === "string" ? <th key={i} style={th}>{c}</th>
                : <th key={i} style={th}><Tooltip what={c.what} why={c.why} rule={c.rule} tip={c.tip}>{c.label}<InfoDot size={10} /></Tooltip></th>;
            })}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} onClick={onRowClick ? () => onRowClick(i) : undefined} className={onRowClick ? "rowhover" : ""}
                style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none", cursor: onRowClick ? "pointer" : "default" }}>
                {r.map((cell, j) => <td key={j} style={{ padding: "10px 13px", color: C.text, verticalAlign: "middle", whiteSpace: "nowrap" }}>{cell}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 20, color: C.textFaint, fontSize: 12.5 }}>{emptyText || "Nothing here."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function PageHeader({ icon: Icon, tone, title, sub, what, why, right }) {
  const [bg, fg] = TONES[tone || "indigo"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      {Icon && <div style={{ width: 36, height: 36, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={18} color={fg} /></div>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 18.5, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
          {what ? <Tooltip what={what} why={why} width={330}>{title}<InfoDot size={13} /></Tooltip> : title}
        </div>
        {sub && <div style={{ fontSize: 12.5, color: C.textSoft, marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
function KpiRow({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length},minmax(0,1fr))`, gap: 10, marginBottom: 14 }}>
      {items.map((s) => (
        <div key={s.label} style={{ ...card, padding: "10px 13px", boxShadow: "none", minWidth: 0 }}>
          {s.tip ? <Tooltip tip={s.tip} why={s.why}><span style={{ ...label11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span><InfoDot size={10} /></Tooltip>
            : <div style={{ ...label11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>}
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 3 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: s.tone ? TONES[s.tone][1] : C.text, whiteSpace: "nowrap" }}>{s.value}</span>
            {s.delta && <span style={{ fontSize: 11, fontWeight: 700, color: s.delta.startsWith("+") ? C.green : C.red }}>{s.delta}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
function ActionBar({ actions, sticky }) {
  const [busy, setBusy] = useState(null);
  async function go(a) { if (a.disabled) return; setBusy(a.label); await a.onRun(); setBusy(null); }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "13px 16px", background: C.surfaceAlt, borderTop: `1px solid ${C.border}`, borderRadius: sticky ? 0 : "0 0 12px 12px" }}>
      {actions.map((a) => {
        const bg = a.tone === "primary" ? C.primary : a.tone === "green" ? C.green : a.tone === "red" ? C.red : C.surface;
        const fg = a.tone && a.tone !== "ghost" ? "#fff" : C.textSoft;
        const btn = (
          <button key={a.label} onClick={() => go(a)} disabled={a.disabled || !!busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: bg, color: fg, border: a.tone && a.tone !== "ghost" ? "none" : `1px solid ${C.border}`, borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: a.disabled || busy ? "not-allowed" : "pointer", opacity: a.disabled ? 0.42 : busy && busy !== a.label ? 0.5 : 1 }}>
            {busy === a.label ? <Loader2 size={13} className="spin" /> : a.icon ? <a.icon size={13} /> : null}
            {busy === a.label ? "Working…" : a.label}
          </button>
        );
        return a.disabled && a.disabledReason ? <Tooltip key={a.label} rule={a.disabledReason} width={290}>{btn}</Tooltip> : btn;
      })}
    </div>
  );
}
function KV({ k, v, tip, what, why, rule, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      {tip || what ? <Tooltip tip={tip} what={what} why={why} rule={rule}><span style={{ fontSize: 12, color: C.textFaint }}>{k}</span><InfoDot size={10} /></Tooltip>
        : <span style={{ fontSize: 12, color: C.textFaint }}>{k}</span>}
      <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, textAlign: "right", fontFamily: mono ? MONO : undefined }}>{v}</span>
    </div>
  );
}
function Panel({ title, what, why, children, right, pad }) {
  return (
    <div style={{ ...card, padding: pad === undefined ? 15 : pad, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <TipLabel style={{ fontSize: 12.5, fontWeight: 800, color: C.text }} text={title} what={what} why={why} />
        {right}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
function BackLink({ onClick, label }) {
  return <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.textSoft, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 13, padding: 0 }}><ArrowLeft size={14} /> {label}</button>;
}

/* ================= LIVE NOTIFICATIONS ================= */
function Toasts({ notes }) {
  const live = notes.filter((n) => Date.now() - n.at < 4600).slice(0, 4);
  if (!live.length) return null;
  return (
    <div style={{ position: "fixed", top: 14, right: 16, zIndex: 10000, display: "flex", flexDirection: "column", gap: 7, pointerEvents: "none" }}>
      {live.map((n) => {
        const [bg, fg] = TONES[n.tone] || TONES.gray;
        const Icon = n.kind === "event" ? Zap : n.dir === "out" ? ArrowUpRight : ArrowDownLeft;
        return (
          <div key={n.id} className="toastin" style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${fg}`, borderRadius: 9, padding: "9px 13px", boxShadow: "0 8px 24px rgba(10,12,30,.16)", minWidth: 250, maxWidth: 340 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 19, height: 19, borderRadius: 5, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={11} color={fg} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontFamily: n.kind === "event" ? MONO : undefined }}>{n.title}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 3, marginLeft: 26, lineHeight: 1.45 }}>{n.detail}</div>
          </div>
        );
      })}
    </div>
  );
}
function NotificationPanel({ notes, onClose, clearNotes }) {
  return (
    <div style={{ position: "absolute", top: 44, right: 0, width: 330, maxHeight: 420, overflowY: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, boxShadow: "0 12px 34px rgba(10,12,30,.2)", zIndex: 9998 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "11px 13px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, flex: 1 }}>Activity</span>
        <button onClick={clearNotes} style={{ background: "none", border: "none", color: C.primary, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Clear</button>
        <X size={14} color={C.textFaint} style={{ cursor: "pointer", marginLeft: 8 }} onClick={onClose} />
      </div>
      {notes.length === 0 && <div style={{ padding: 20, fontSize: 12.5, color: C.textFaint, lineHeight: 1.6 }}>Nothing yet. Take a decision on any desk and you'll see the request, the response and the domain event stream through here live.</div>}
      {notes.map((n) => {
        const [bg, fg] = TONES[n.tone] || TONES.gray;
        const Icon = n.kind === "event" ? Zap : n.dir === "out" ? ArrowUpRight : ArrowDownLeft;
        return (
          <div key={n.id} style={{ display: "flex", gap: 9, padding: "9px 13px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}><Icon size={11} color={fg} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: n.kind === "event" ? MONO : undefined }}>{n.title}</div>
              <div style={{ fontSize: 11, color: C.textSoft, marginTop: 2, lineHeight: 1.45 }}>{n.detail}</div>
            </div>
            <span style={{ fontSize: 10, color: C.textFaint, whiteSpace: "nowrap" }}>{new Date(n.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ================= BOTTOM: API & EVENT LIFECYCLE =================
   Sits under every screen. Scroll down and it tells the whole story of what the last
   action did — the request that left, the response that came back, the domain event
   that was published and who consumed it. */
const PAGE_APIS = {
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
};

function LifecycleStage({ n, icon: Icon, tone, title, sub, children, last }) {
  const [bg, fg] = TONES[tone];
  return (
    <div style={{ display: "flex", gap: 12, position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}><Icon size={13} color={fg} /></div>
        {!last && <div style={{ width: 2, flex: 1, background: C.border, minHeight: 14 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 15 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: C.textFaint, letterSpacing: 0.6 }}>{n}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{title}</span>
        </div>
        {sub && <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
    </div>
  );
}

function ApiLifecycle({ view, flows, log, events }) {
  const [open, setOpen] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const latest = flows[0];
  const pageApis = PAGE_APIS[view] || [];
  return (
    <div style={{ marginTop: 26, borderTop: `2px dashed ${C.border}`, paddingTop: 18 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: open ? 14 : 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "#14152B", display: "flex", alignItems: "center", justifyContent: "center" }}><Activity size={15} color="#8FA6FF" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>API &amp; event lifecycle</div>
          <div style={{ fontSize: 11.5, color: C.textFaint }}>What this screen does behind the glass — request, response, domain event, consumers</div>
        </div>
        <Pill tone="gray">{log.length} calls</Pill>
        <Pill tone="violet">{events.length} events</Pill>
        {open ? <ChevronUp size={16} color={C.textFaint} /> : <ChevronDown size={16} color={C.textFaint} />}
      </div>

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr)", gap: 14 }}>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <TipLabel style={{ fontSize: 12, fontWeight: 800, color: C.text }} text="Most recent action, end to end"
                what="The complete round trip produced by the last thing you did."
                why="One click in the UI becomes an API call, a database transaction, a domain event and a set of downstream consumers. This is that chain." />
              {latest && <button onClick={() => setShowJson(!showJson)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.textSoft, cursor: "pointer" }}>{showJson ? "Hide" : "Show"} payloads</button>}
            </div>
            {!latest && <div style={{ fontSize: 12.5, color: C.textFaint, lineHeight: 1.6, padding: "10px 0" }}>
              Nothing yet. Approve a submission, issue a bound policy or cancel one — then come back here and the full chain will be laid out step by step.
            </div>}
            {latest && <>
              <LifecycleStage n="01" icon={ArrowUpRight} tone="indigo" title="User action" sub={latest.action} />
              <LifecycleStage n="02" icon={ArrowUpRight} tone="blue" title="Request leaves the browser"
                sub={<span style={{ fontFamily: MONO }}>{latest.call.method} {latest.call.endpoint}</span>}>
                {showJson && latest.call.requestBody && <CodeBlock data={latest.call.requestBody} small />}
              </LifecycleStage>
              <LifecycleStage n="03" icon={ShieldCheck} tone="violet" title="Domain rules run"
                sub="Application layer validates the transition, the domain enforces its invariants, and the change is written with an outbox row in one transaction." />
              <LifecycleStage n="04" icon={ArrowDownLeft} tone={latest.call.statusCode >= 400 ? "red" : "green"} title={`Response · ${latest.call.statusCode}`}
                sub={`Returned in ${latest.call.latency}ms`}>
                {showJson && <CodeBlock data={latest.call.responseBody} small />}
              </LifecycleStage>
              {latest.event ? (
                <LifecycleStage n="05" icon={Zap} tone="violet" title={<span style={{ fontFamily: MONO }}>{latest.event.eventType}</span>}
                  sub="Published from the outbox to Service Bus with a versioned envelope." last={!showJson}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {latest.event.consumers.map((c) => <Pill key={c} tone="blue">{c}</Pill>)}
                  </div>
                  {showJson && <div style={{ marginTop: 8 }}><CodeBlock data={{ eventId: latest.event.eventId, eventType: latest.event.eventType, eventVersion: 1, occurredAt: latest.event.occurredAt, tenantId: latest.event.tenantId, aggregateId: latest.event.aggregateId, producer: latest.event.producer }} small /></div>}
                </LifecycleStage>
              ) : (
                <LifecycleStage n="05" icon={Radio} tone="gray" title="No domain event" sub="Read-only operations do not publish. Only state changes reach the bus." last />
              )}
            </>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <Panel title="Endpoints on this screen" what="Every operation this page can call." why="Nothing here is decorative — each one fires from a control on the screen.">
              {pageApis.map(([m, p, d]) => (
                <div key={p + m} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <MethodBadge method={m} />
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text, wordBreak: "break-all" }}>{p}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.45 }}>{d}</div>
                </div>
              ))}
              {pageApis.length === 0 && <div style={{ fontSize: 12, color: C.textFaint }}>Reference screen — no live calls.</div>}
            </Panel>
            <Panel title="Call log" what="Every request made this session, newest first." pad={0}>
              <div style={{ maxHeight: 210, overflowY: "auto" }}>
                {log.length === 0 && <div style={{ padding: "0 15px 14px", fontSize: 12, color: C.textFaint }}>No calls yet.</div>}
                {log.map((l) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 15px", borderTop: `1px solid ${C.border}` }}>
                    <MethodBadge method={l.method} />
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.endpoint}</span>
                    <StatusCodeBadge code={l.statusCode} />
                    <span style={{ fontSize: 10, color: C.textFaint, whiteSpace: "nowrap" }}>{l.latency}ms</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/* Wraps every screen: content, then the lifecycle section beneath it. */
function Screen({ view, api, children }) {
  return (
    <>
      {children}
      <ApiLifecycle view={view} flows={api.flows} log={api.log} events={api.events} />
    </>
  );
}

/* ================= DASHBOARD ================= */
/* Horizontal bars, not columns — premium across product lines spans two orders of
   magnitude, and vertical bars just collapse the small lines into nothing. */
function HBar({ label, value, max, tone, note }) {
  const pct = max ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: C.textFaint, whiteSpace: "nowrap", fontWeight: 600 }}>{note}</span>
      </div>
      <div style={{ height: 8, background: C.surfaceAlt, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: TONES[tone || "indigo"][1], borderRadius: 4 }} />
      </div>
    </div>
  );
}
function Donut({ segments, total, centerValue, centerLabel }) {
  let acc = 0;
  const stops = segments.filter((s) => s.value > 0).map((s) => {
    const from = (acc / total) * 360; acc += s.value;
    return `${TONES[s.tone][1]} ${from}deg ${(acc / total) * 360}deg`;
  }).join(", ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 96, height: 96, borderRadius: "50%", background: `conic-gradient(${stops})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{centerValue}</span>
          <span style={{ fontSize: 9, color: C.textFaint, fontWeight: 700, textTransform: "uppercase" }}>{centerLabel}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2.5px 0" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TONES[s.tone][1], flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function DashboardPage({ policies, nav }) {
  const active = policies.filter((p) => p.status === "Active");
  const bound = policies.filter((p) => p.status === "Bound");
  const referred = policies.filter((p) => p.status === "Referred");
  const cancelled = policies.filter((p) => p.status === "Cancelled");
  const gwp = active.reduce((s, p) => s + p.premium, 0);
  const pending = policies.flatMap((p) => p.history.filter((h) => h.status === "Pending"));
  const renewals = active.filter((p) => renewalCompliance(p).status !== "Compliant");
  const blocked = bound.filter((p) => (p.binder?.subjectivities || []).some((s) => !s.met));
  const byProduct = [...new Set(policies.map((p) => p.product))]
    .map((pr) => ({ pr, v: policies.filter((p) => p.product === pr && p.status === "Active").reduce((s, p) => s + p.premium, 0), n: policies.filter((p) => p.product === pr).length }))
    .sort((a, b) => b.v - a.v);
  const maxP = Math.max(...byProduct.map((x) => x.v), 1);
  const work = [
    { label: "Submissions to underwrite", n: referred.length, tone: "violet", icon: ClipboardCheck, go: "uw-desk", sub: moneyShort(referred.reduce((s, p) => s + p.premium, 0)) + " at stake" },
    { label: "Bound, awaiting issue", n: bound.length, tone: "amber", icon: Stamp, go: "issue-desk", sub: blocked.length + " blocked by subjectivity" },
    { label: "Transactions to approve", n: pending.length, tone: "red", icon: Inbox, go: "approvals", sub: "Held — policies unchanged" },
    { label: "Renewals in notice window", n: renewals.length, tone: "blue", icon: RefreshCw, go: "renewal-desk", sub: `${RENEWAL_LEAD_DAYS}-day lead time` },
  ];
  return (
    <div>
      <PageHeader icon={LayoutDashboard} tone="indigo" title="Portfolio Dashboard"
        sub="Live position of the book and everything waiting on a decision"
        what="Portfolio KPIs plus the operator's work list."
        why="A PAS is judged on what it tells you to do next." />
      <KpiRow items={[
        { label: "Gross written premium", value: moneyShort(gwp), delta: "+8.2%", tone: "green", tip: "Total annual premium across in-force policies." },
        { label: "In force", value: active.length, tip: "Issued, not cancelled or expired." },
        { label: "Pipeline premium", value: moneyShort([...bound, ...referred].reduce((s, p) => s + p.premium, 0)), tone: "amber", tip: "Committed but not yet earning — the conversion gap." },
        { label: "Awaiting decision", value: referred.length + bound.length + pending.length, tone: "red", tip: "Every item needing a person to act." },
        { label: "Avg premium", value: moneyShort(active.length ? gwp / active.length : 0), tip: "Mean premium per in-force policy." },
        { label: "Retention", value: "91%", delta: "-1.4%", tip: "Share renewed rather than lapsed over trailing 12 months." },
      ]} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 11, marginBottom: 14 }}>
        {work.map((w) => (
          <div key={w.label} onClick={() => nav(w.go)} className="lift" style={{ ...card, padding: 14, cursor: "pointer", borderLeft: `3px solid ${TONES[w.tone][1]}`, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <w.icon size={14} color={TONES[w.tone][1]} />
              <span style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1 }}>{w.n}</span>
            </div>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600, lineHeight: 1.35 }}>{w.label}</div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>{w.sub}</div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: TONES[w.tone][1], fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>Open desk <ArrowRight size={11} /></div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 14, marginBottom: 14 }}>
        <Panel title="Written premium by product" what="In-force premium per product line, largest first." why="Concentration in one line is a portfolio risk an underwriting manager watches.">
          {byProduct.map((x) => <HBar key={x.pr} label={x.pr} value={x.v} max={maxP} note={`${moneyShort(x.v)} · ${x.n} pol`} tone={x.v === maxP ? "indigo" : "blue"} />)}
        </Panel>
        <Panel title="Book composition" what="Every record by lifecycle status." why="Bound-not-issued and cancelled are the two counts that signal operational drag.">
          <Donut total={policies.length} centerValue={policies.length} centerLabel="records" segments={[
            { label: "Active", value: active.length, tone: "green" },
            { label: "Bound", value: bound.length, tone: "amber" },
            { label: "Referred", value: referred.length, tone: "violet" },
            { label: "Cancelled", value: cancelled.length, tone: "red" },
            { label: "Expired", value: policies.filter((p) => p.status === "Expired").length, tone: "gray" },
          ]} />
        </Panel>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
        <Panel title="Renewal pipeline" what="In-force policies by closeness to expiry." why={`Notices must be served ${RENEWAL_LEAD_DAYS} days ahead.`}
          right={<button onClick={() => nav("renewal-desk")} style={{ background: "none", border: "none", color: C.primary, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Open →</button>}>
          {active.slice().sort((a, b) => daysBetween(todayISO(), a.expirationDate) - daysBetween(todayISO(), b.expirationDate)).map((p) => {
            const rc = renewalCompliance(p);
            return <HBar key={p.id} label={p.holder} value={Math.max(0, 365 - rc.daysToExpiry)} max={365} note={`${rc.daysToExpiry}d left`}
              tone={rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red"} />;
          })}
        </Panel>
        <Panel title="Blocked from issuing" what="Bound policies where a subjectivity blocks formal issue." why="Cover is already live under the binder — every day here is unpriced exposure."
          right={<button onClick={() => nav("issue-desk")} style={{ background: "none", border: "none", color: C.primary, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Open →</button>}>
          {blocked.length === 0 && <div style={{ fontSize: 12, color: C.textFaint }}>Nothing blocked.</div>}
          {blocked.map((p) => (
            <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{p.holder}</span>
                <span style={{ fontSize: 11.5, color: C.textFaint }}>{moneyShort(p.premium)}</span>
              </div>
              {p.binder.subjectivities.filter((s) => !s.met).map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.amber, marginTop: 3 }}><AlertTriangle size={11} />{s.label}</div>
              ))}
            </div>
          ))}
        </Panel>
        <Panel title="Oldest waiting" what="Work that has sat longest without a decision." why="Ageing, not volume, is what breaks an SLA.">
          {[...referred, ...bound].map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
              <Clock size={11} color={C.textFaint} />
              <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.holder}</span>
              <Badge status={p.status} />
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/* ================= DESK LIST SCREENS =================
   A desk is a list. Clicking a row navigates to its own full screen — never a cramped
   side panel. */
function DeskList({ icon, tone, title, sub, what, why, kpis, columns, rows, empty, onOpen }) {
  return (
    <div>
      <PageHeader icon={icon} tone={tone} title={title} sub={sub} what={what} why={why} />
      <KpiRow items={kpis} />
      <DataTable columns={[...columns, ""]} rows={rows.map((r) => [...r, <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Open <ArrowRight size={11} /></span>])}
        onRowClick={onOpen} emptyText={empty} />
    </div>
  );
}
const idCell = (v) => <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textSoft }}>{v}</span>;
const nameCell = (v) => <span style={{ fontWeight: 700 }}>{v}</span>;

function UnderwritingList({ policies, onOpen }) {
  const q = policies.filter((p) => p.status === "Referred");
  return <DeskList icon={ClipboardCheck} tone="violet" title="Underwriting Desk" sub="Submissions referred out of automatic authority"
    what="Submissions already received and scored, waiting for an underwriter to accept, decline or price them."
    why="The data arrives on its own — the value you add is the decision."
    kpis={[
      { label: "In queue", value: q.length, tone: "violet", tip: "Submissions awaiting a decision." },
      { label: "Pipeline premium", value: moneyShort(q.reduce((s, x) => s + x.premium, 0)), tip: "Premium riding on these decisions." },
      { label: "Authority limit", value: moneyShort(AUTHORITY_LIMIT), tip: "Premium above this cannot be bound under delegated authority.", why: "One of two independent referral triggers." },
      { label: "Refer threshold", value: LOW_SCORE_REFER, tip: "Scores below this auto-refer regardless of premium." },
    ]}
    columns={["Submission", "Insured", "Product",
      { label: "Premium", what: "Indicative annual premium from rating.", why: "Compared against delegated authority." },
      { label: "Score", what: "Composite 0–100 risk score.", rule: `Below ${LOW_SCORE_REFER} refers automatically.` },
      { label: "Waiting", what: "Days since it landed in this queue.", why: "SLA is measured on age." }]}
    rows={q.map((x) => [idCell(x.id), nameCell(x.holder), x.product, moneyShort(x.premium),
      <Pill tone={riskScore(x.premium, x.holder) < LOW_SCORE_REFER ? "red" : "green"}>{riskScore(x.premium, x.holder)}</Pill>,
      daysBetween(x.submittedOn, todayISO()) + "d"])}
    empty="Underwriting queue is clear." onOpen={(i) => onOpen(q[i].id)} />;
}
function IssueList({ policies, onOpen }) {
  const q = policies.filter((p) => p.status === "Bound");
  return <DeskList icon={Stamp} tone="amber" title="Issue Desk" sub="Bound policies awaiting formal issue and documentation"
    what="Policies already bound under a binder, waiting to be formally issued."
    why="Bind and issue are legally distinct — cover is live, but until issue there is no contract and no document pack."
    kpis={[
      { label: "Awaiting issue", value: q.length, tone: "amber", tip: "Bound with no formal contract yet." },
      { label: "Blocked", value: q.filter((x) => (x.binder?.subjectivities || []).some((s) => !s.met)).length, tone: "red", tip: "An outstanding subjectivity prevents issue.", why: "Live cover with unmet conditions is the riskiest state in the book." },
      { label: "Premium bound", value: moneyShort(q.reduce((s, x) => s + x.premium, 0)), tip: "Premium on risk under binders." },
      { label: "Ready now", value: q.filter((x) => !(x.binder?.subjectivities || []).some((s) => !s.met)).length, tone: "green", tip: "All gates satisfied." },
    ]}
    columns={["Policy", "Insured",
      { label: "Binder", what: "Provisional cover note number.", why: "Legal evidence of cover until issue." },
      { label: "Expires", what: "When provisional cover lapses.", rule: "Issuing after binder expiry is not permitted — the risk must be re-bound." },
      { label: "Premium", what: "Annual premium as bound." },
      { label: "Gates", what: "How many of the five issue preconditions pass." }]}
    rows={q.map((x) => {
      const u = (x.binder?.subjectivities || []).filter((s) => !s.met).length;
      return [idCell(x.id), nameCell(x.holder), <span style={{ fontFamily: MONO, fontSize: 11.5 }}>{x.binder.number}</span>, x.binder.expiryDate, moneyShort(x.premium),
        u === 0 ? <Pill tone="green" icon={CheckCircle2}>Ready</Pill> : <Pill tone="red" icon={AlertTriangle}>{u} blocking</Pill>];
    })}
    empty="Nothing awaiting issue." onOpen={(i) => onOpen(q[i].id)} />;
}
/* A small "who's asking" pill used in every request queue row, so the origin is visible
   before you even open the record. */
function InitiatorPill({ meta }) {
  const init = INITIATORS[meta?.initiatedBy] || INITIATORS.Insured;
  return <Pill tone={init.tone} icon={init.icon}>{init.label}</Pill>;
}
function pendingOf(policies, type) {
  return policies.flatMap((p) => p.history.filter((h) => h.type === type && h.status === "Pending").map((h) => ({ p, h })));
}

function CancellationList({ policies, onOpen, raiseRequest }) {
  const pend = pendingOf(policies, "Cancellation");
  const hist = policies.flatMap((x) => x.history.filter((h) => h.type === "Cancellation" && h.status !== "Pending").map((h) => ({ x, h })));
  return (
    <div>
      <PageHeader icon={XCircle} tone="red" title="Cancellation Desk" sub="Requests already received — type, refund and notice are all derived from what was submitted"
        what="Every cancellation begins as a request from the insured, a broker, or an underwriter's own review — never something ops invents on the spot."
        why="Getting the type wrong means refunding money you were entitled to keep, or breaching a statutory notice rule." />
      <KpiRow items={[
        { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
        { label: "From insured/broker", value: pend.filter((t) => t.h.meta?.initiatedBy !== "Underwriter" && t.h.meta?.initiatedBy !== "System").length, tone: "blue", tip: "Customer-initiated requests." },
        { label: "From underwriting", value: pend.filter((t) => t.h.meta?.initiatedBy === "Underwriter" || t.h.meta?.initiatedBy === "System").length, tone: "violet", tip: "Internal or automated triggers — e.g. non-payment, adverse loss ratio.", why: "These still require a decision, never an instant execution." },
        { label: "Cancelled to date", value: hist.length, tip: "Completed cancellations across the book." },
      ]} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 15 }}>
        {Object.entries(CANCEL_TYPES).map(([name, t]) => (
          <Tooltip key={name} what={t.when} why={t.rate} rule={t.rule} width={300}>
            <div style={{ ...card, padding: 12, boxShadow: "none", width: "100%", minWidth: 0 }}>
              <Pill tone={t.tone}>{name}</Pill>
              <div style={{ fontSize: 11, color: C.textSoft, lineHeight: 1.45, marginTop: 6 }}>{t.when}</div>
              <div style={{ marginTop: 6, fontSize: 10, color: C.textFaint, fontWeight: 700 }}>
                {t.initiator} · {t.noticeDays}d notice · {t.penaltyPct ? t.penaltyPct * 100 + "% penalty" : "no penalty"}
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
      <LogRequestForm policies={policies.filter((p) => p.status === "Active")} typeLabel="cancellation"
        extraFields={(extra, setExtra) => (
          <Field label="Reason"><select style={inputStyle} value={extra.reason || Object.keys(CANCEL_REASONS)[0]} onChange={(e) => setExtra({ ...extra, reason: e.target.value })}>
            {Object.keys(CANCEL_REASONS).map((r) => <option key={r}>{r}</option>)}</select></Field>
        )}
        onSubmit={({ policyId, initiatedBy, channel, note, extra }) => raiseRequest(policyId, "Cancellation", { reason: extra.reason || Object.keys(CANCEL_REASONS)[0], initiatedBy, channel, requestNote: note })} />
      <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text={`Requests awaiting decision (${pend.length})`} what="Already-submitted requests, ordered newest first." />
      <DataTable columns={["Policy", "Insured", "Requested by",
        { label: "Stated reason", what: "What the requester gave as their reason.", why: "Drives the derived type, refund and notice period." },
        { label: "Submitted", what: "When the request arrived." }, ""]}
        rows={pend.map(({ p, h }) => [idCell(p.id), nameCell(p.holder), <InitiatorPill meta={h.meta} />, h.meta?.reason || "—", h.meta?.submittedOn || h.date,
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Review <ArrowRight size={11} /></span>])}
        onRowClick={(i) => onOpen(pend[i].p.id, pend[i].h.id)} emptyText="No cancellation requests awaiting decision." />
    </div>
  );
}
function ReinstatementList({ policies, onOpen, raiseRequest }) {
  const pend = pendingOf(policies, "Reinstatement");
  const cancelled = policies.filter((p) => p.status === "Cancelled" && !pend.some((t) => t.p.id === p.id));
  return (
    <div>
      <PageHeader icon={RotateCcw} tone="green" title="Reinstatement Desk" sub="A cancelled policy is reinstated only on a request from the insured or broker"
        what="Cancelled policies with a reinstatement request already submitted."
        why={`Reinstatement is conditional — it closes permanently after ${REINSTATEMENT_WINDOW_DAYS} days, and ops never initiates it unprompted.`} />
      <KpiRow items={[
        { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Reinstatement requests submitted, not yet decided." },
        { label: "Still eligible", value: pend.filter((t) => reinstatementEligibility(t.p)?.eligible).length, tone: "green", tip: "Inside the window and not fraud-cancelled." },
        { label: "Window", value: REINSTATEMENT_WINDOW_DAYS + " days", tip: "Time allowed after cancellation.", why: "Beyond it, the risk needs new-business underwriting." },
        { label: "Cancelled, no request yet", value: cancelled.length, tip: "Closed out — nobody has asked to reinstate them." },
      ]} />
      <LogRequestForm policies={policies.filter((p) => p.status === "Cancelled")} typeLabel="reinstatement"
        extraFields={() => null}
        onSubmit={({ policyId, initiatedBy, channel, note }) => raiseRequest(policyId, "Reinstatement", { initiatedBy, channel, requestNote: note })} />
      <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text={`Requests awaiting decision (${pend.length})`} what="Already-submitted reinstatement requests." />
      <DataTable columns={["Policy", "Insured", "Requested by",
        { label: "Cancelled on", what: "Effective date of the original cancellation." },
        { label: "Days since", what: "Elapsed days — eligibility is a pure function of this." },
        { label: "Eligibility", what: "Whether reinstatement is still available.", rule: "Fraud cancellations are never eligible." }, ""]}
        rows={pend.map(({ p, h }) => {
          const el = reinstatementEligibility(p);
          return [idCell(p.id), nameCell(p.holder), <InitiatorPill meta={h.meta} />, el.cancelEv.date, el.daysSince + "d",
            <Pill tone={el.eligible ? "green" : "red"} icon={el.eligible ? CheckCircle2 : AlertTriangle}>{el.eligible ? "Eligible" : el.fraud ? "Fraud — barred" : "Window closed"}</Pill>,
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Review <ArrowRight size={11} /></span>];
        })}
        onRowClick={(i) => onOpen(pend[i].p.id, pend[i].h.id)} emptyText="No reinstatement requests awaiting decision." />
    </div>
  );
}
function RenewalList({ policies, onOpen, raiseRequest }) {
  const pend = pendingOf(policies, "Renewal");
  const noRequest = policies.filter((p) => p.status === "Active" && !pend.some((t) => t.p.id === p.id))
    .sort((a, b) => daysBetween(todayISO(), a.expirationDate) - daysBetween(todayISO(), b.expirationDate));
  return (
    <div>
      <PageHeader icon={RefreshCw} tone="blue" title="Renewal Desk" sub="Renewal is decided against a confirmed request, never started from the desk"
        what="Policies where the insured or broker has already confirmed intent to renew."
        why="Renewal is a new term on the same policy — underwriting is re-run, but the trigger is always an external confirmation, not ops." />
      <KpiRow items={[
        { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Renewal confirmations received, not yet decided." },
        { label: "In notice window", value: pend.filter((t) => renewalCompliance(t.p).status !== "Compliant").length, tone: "red", tip: `Expiring within ${RENEWAL_LEAD_DAYS} days.` },
        { label: "Premium at renewal", value: moneyShort(pend.reduce((s, t) => s + t.p.premium, 0)), tip: "Premium exposed to these decisions." },
        { label: "No confirmation yet", value: noRequest.length, tip: "Approaching expiry but the insured hasn't confirmed renewal.", why: "These need a renewal notice chased, not a desk action." },
      ]} />
      <LogRequestForm policies={policies.filter((p) => p.status === "Active")} typeLabel="renewal confirmation"
        extraFields={() => null}
        onSubmit={({ policyId, initiatedBy, channel, note }) => raiseRequest(policyId, "Renewal", { initiatedBy, channel, requestNote: note })} />
      <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text={`Requests awaiting decision (${pend.length})`} what="Confirmed renewal intent, ready for re-underwriting and pricing." />
      <DataTable columns={["Policy", "Insured", "Requested by", { label: "Expires", what: "End of the current term." },
        { label: "Days left", what: "Time before expiry." }, { label: "Premium", what: "Expiring term premium." }, ""]}
        rows={pend.map(({ p, h }) => [idCell(p.id), nameCell(p.holder), <InitiatorPill meta={h.meta} />, p.expirationDate,
          daysBetween(todayISO(), p.expirationDate) + "d", moneyShort(p.premium),
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Review <ArrowRight size={11} /></span>])}
        onRowClick={(i) => onOpen(pend[i].p.id, pend[i].h.id)} emptyText="No renewal confirmations awaiting decision." />
      {noRequest.length > 0 && <div style={{ marginTop: 18 }}>
        <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Approaching expiry, no confirmation yet" what="Reference only — nothing to decide until the insured responds to the renewal notice." />
        <DataTable columns={["Policy", "Insured", "Expires", "Days left",
          { label: "Notice status", what: "Whether the renewal notice window has been met.", rule: `Notices must go out at least ${RENEWAL_LEAD_DAYS} days before expiry.` }]}
          rows={noRequest.map((x) => { const r = renewalCompliance(x); return [idCell(x.id), nameCell(x.holder), x.expirationDate, r.daysToExpiry + "d",
            <Pill tone={r.status === "Compliant" ? "green" : r.status === "Urgent" ? "amber" : "red"}>{r.status}</Pill>]; })} />
      </div>}
    </div>
  );
}
function ServicingList({ policies, onOpen }) {
  const log = policies.flatMap((x) => x.history.filter((h) => h.type === "Servicing").map((h) => ({ x, h })));
  return <DeskList icon={Headphones} tone="violet" title="Servicing Desk" sub="Operational requests against existing policies"
    what="Requests that do not rise to a formal endorsement."
    why="Anything that moves a rating factor must become an endorsement, not stay a note."
    kpis={[
      { label: "Requests logged", value: log.length, tip: "Servicing entries across the book." },
      { label: "Serviceable", value: policies.length, tip: "Any policy in any status can receive a request." },
      { label: "Channels", value: "4", tip: "Phone, email, portal, branch — all writing to one ledger." },
      { label: "Open SLA breaches", value: 0, tone: "green", tip: "Requests past their category SLA target." },
    ]}
    columns={["Policy", "Insured", { label: "Status", what: "Servicing is available in any lifecycle state." }, "Product",
      { label: "Requests", what: "Servicing entries already logged against this policy." }]}
    rows={policies.map((x) => [idCell(x.id), nameCell(x.holder), <Badge status={x.status} />, x.product,
      x.history.filter((h) => h.type === "Servicing").length])}
    empty="No policies." onOpen={(i) => onOpen(policies[i].id)} />;
}
function EndorsementList({ policies, onOpen, raiseRequest }) {
  const pend = pendingOf(policies, "Endorsement");
  const done = policies.flatMap((p) => p.history.filter((h) => h.type === "Endorsement" && h.status !== "Pending").map((h) => ({ p, h })));
  return (
    <div>
      <PageHeader icon={Edit3} tone="amber" title="Endorsement Desk" sub="Mid-term change requests — every one decided, none applied on the spot"
        what="Change requests from the insured, a broker, or logged by ops on their behalf."
        why="Material changes carry real risk and financial impact — nothing touches the policy until an underwriter has reviewed the actual request." />
      <KpiRow items={[
        { label: "Awaiting decision", value: pend.length, tone: "amber", tip: "Requests already submitted, not yet decided." },
        { label: "Material", value: pend.filter((t) => t.h.meta?.materiality === "Material").length, tone: "red", tip: "Alters the risk — needs real scrutiny before approval.", why: "Adding a driver or raising a limit changes what's insured, not just paperwork." },
        { label: "Premium at stake", value: moneyShort(pend.reduce((s, e) => s + Math.abs(e.h.meta?.premiumImpact || 0), 0)), tip: "Absolute premium impact of held requests." },
        { label: "Applied to date", value: done.length, tip: "Endorsements already committed to the ledger." },
      ]} />
      <LogRequestForm policies={policies.filter((p) => p.status === "Active")} typeLabel="endorsement"
        extraFields={(extra, setExtra) => <>
          <Field label="Change type">
            <select style={inputStyle} value={extra.changeType || "Address change"} onChange={(e) => setExtra({ ...extra, changeType: e.target.value })}>
              <option>Address change</option><option>Add/remove driver</option><option>Vehicle change</option><option>Coverage change</option><option>Limit change</option>
            </select>
          </Field>
          <Field label="Materiality" hint="Whether this alters the underlying risk.">
            <select style={inputStyle} value={extra.materiality || "Minor"} onChange={(e) => setExtra({ ...extra, materiality: e.target.value })}>
              <option>Minor</option><option>Material</option>
            </select>
          </Field>
          <Field label="Premium impact (₹)" hint="Positive for an increase, negative for a decrease.">
            <input style={inputStyle} type="number" value={extra.premiumImpact ?? ""} onChange={(e) => setExtra({ ...extra, premiumImpact: e.target.value })} placeholder="0" />
          </Field>
        </>}
        onSubmit={({ policyId, initiatedBy, channel, note, extra }) => raiseRequest(policyId, "Endorsement", {
          changeType: extra.changeType || "Address change", materiality: extra.materiality || "Minor",
          premiumImpact: Number(extra.premiumImpact) || 0, initiatedBy, channel, requestNote: note,
        })} />
      <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text={`Requests awaiting decision (${pend.length})`} what="Already-submitted change requests, ordered newest first." />
      <DataTable columns={["Policy", "Insured", "Requested by",
        { label: "Change", what: "Category of mid-term change." },
        { label: "Materiality", what: "Whether this alters the underlying risk.", rule: "Material changes require re-underwriting before they can be approved." },
        { label: "Premium impact", what: "Prorated delta from effective date to end of term." }, ""]}
        rows={pend.map(({ p, h }) => [idCell(p.id), nameCell(p.holder), <InitiatorPill meta={h.meta} />, h.meta.changeType, <Pill tone={h.meta.materiality === "Material" ? "red" : "gray"}>{h.meta.materiality}</Pill>,
          <span style={{ color: (h.meta.premiumImpact || 0) >= 0 ? C.green : C.red, fontWeight: 700 }}>{(h.meta.premiumImpact || 0) >= 0 ? "+" : ""}{money(h.meta.premiumImpact || 0)}</span>,
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Review <ArrowRight size={11} /></span>])}
        onRowClick={(i) => onOpen(pend[i].p.id, pend[i].h.id)} emptyText="No endorsements awaiting decision." />
    </div>
  );
}

/* ================= FULL-SCREEN DECISION VIEWS =================
   Opening a record gives it the whole screen: facts on the left, the decision on the right,
   and the action bar pinned under both. */
function RecordHead({ p, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 15, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.textFaint }}>{p.id} · term {p.termNumber}</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: C.text, marginTop: 2, letterSpacing: -0.3 }}>{p.holder}</div>
        <div style={{ fontSize: 12.5, color: C.textSoft, marginTop: 3 }}>{p.product} · via {p.producer} · {money(p.premium)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>{right}<Badge status={p.status} /></div>
    </div>
  );
}
function DecisionLayout({ left, right, actions }) {
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 0 }}>
        <div style={{ padding: 16, borderRight: `1px solid ${C.border}`, minWidth: 0 }}>{left}</div>
        <div style={{ padding: 16, minWidth: 0 }}>{right}</div>
      </div>
      <ActionBar actions={actions} sticky />
    </div>
  );
}
function ScoreDial({ score }) {
  const bad = score < LOW_SCORE_REFER;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, background: C.surfaceAlt, borderRadius: 10, padding: "13px 15px", marginBottom: 13 }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.surface, border: `3px solid ${bad ? C.red : C.green}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: bad ? C.red : C.green, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 7.5, color: C.textFaint, fontWeight: 700, marginTop: 1 }}>SCORE</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...label11 }}>Risk score · auto-refer below {LOW_SCORE_REFER}</div>
        <div style={{ fontSize: 12, color: C.textSoft, marginTop: 3, lineHeight: 1.45 }}>Composite from the rating engine. Re-run at every renewal, never carried forward.</div>
      </div>
    </div>
  );
}

function UnderwritingDecision({ p, api, decide, onBack }) {
  const score = riskScore(p.premium, p.holder);
  const dec = underwritingDecision(p.premium, score);
  const [note, setNote] = useState("");
  async function act(outcome) {
    await api.call("POST", `/api/v1/submissions/${p.id}/underwriting-decision`,
      { score, decision: outcome.toLowerCase(), tier: dec.tier, note: note || undefined },
      { module: "Underwriting", policyId: p.id, statusCode: 200, label: `${outcome} — ${p.holder}`,
        response: { decisionId: uid("UWD"), outcome: outcome.toLowerCase(), authorityTier: dec.tier, nextState: outcome === "Approve" ? "bound" : outcome === "Decline" ? "declined" : "referred" } });
    decide(p.id, outcome, { score, tier: dec.tier, note }); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Underwriting desk" />
      <RecordHead p={p} right={<Pill tone={score < LOW_SCORE_REFER ? "red" : "green"}>Score {score}</Pill>} />
      <DecisionLayout
        left={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Submission" what="What was received from the producer." />
          <KV k="Sum insured" v={p.sumInsured} what="Total limit of indemnity requested." />
          <KV k="Annual premium" v={money(p.premium)} what="Indicative premium from rating." why="Final premium is confirmed at bind." />
          <KV k="Requested effective" v={p.effectiveDate} what="Date cover is asked to begin." />
          <KV k="Producer" v={p.producer} what="Broker or channel that placed the risk." />
          <KV k="Received" v={p.submittedOn} what="Date the submission landed." />
          <KV k="Waiting" v={daysBetween(p.submittedOn, todayISO()) + " days"} what="Age in the queue." why="SLA is measured on age, not volume." />
          <div style={{ marginTop: 14 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 8 }} text="Submission history" what="Everything recorded against this submission so far." />
            {p.history.map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <Pill tone={MODULE_TONE[h.type]} icon={MODULE_ICON[h.type]}>{h.type}</Pill>
                <span style={{ fontSize: 11.5, color: C.textSoft, flex: 1, lineHeight: 1.45 }}>{h.detail}</span>
                <span style={{ fontSize: 10.5, color: C.textFaint, whiteSpace: "nowrap" }}>{h.date}</span>
              </div>
            ))}
          </div>
        </>}
        right={<>
          <ScoreDial score={score} />
          <Callout tone={dec.outcome === "Approve" ? "good" : "warn"}>
            <b>System recommendation: {dec.outcome}</b><br />{dec.reason}
          </Callout>
          <KV k="Authority tier" v={dec.tier} what="Who may bind this risk." rule={`Premium above ${money(AUTHORITY_LIMIT)} always refers to a senior underwriter.`} />
          <KV k="Score gate" v={score < LOW_SCORE_REFER ? "Failed" : "Passed"} what={`Auto-refer triggers below ${LOW_SCORE_REFER}.`} />
          <KV k="Authority gate" v={p.premium > AUTHORITY_LIMIT ? "Exceeded" : "Within limit"} what="Premium against delegated authority." />
          <div style={{ marginTop: 14 }}>
            <Field label="Decision note" hint="Recorded permanently. Required to decline.">
              <textarea style={{ ...inputStyle, minHeight: 76, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rationale for the decision…" />
            </Field>
          </div>
        </>}
        actions={[
          { label: "Approve & bind", tone: "green", icon: ShieldCheck, onRun: () => act("Approve") },
          { label: "Decline", tone: "red", icon: Ban, onRun: () => act("Decline"), disabled: !note.trim(), disabledReason: "A decline must carry a written reason — it is disclosable to the applicant." },
          { label: "Request more info", icon: CornerUpLeft, onRun: () => act("Refer back") },
        ]} />
    </div>
  );
}

function IssueDecision({ p, api, issuePolicy, toggleSubjectivity, onBack }) {
  const subs = p.binder?.subjectivities || [];
  const unmet = subs.filter((s) => !s.met);
  const expired = daysBetween(todayISO(), p.binder.expiryDate) < 0;
  const gates = [
    { label: "Status is BOUND", ok: p.status === "Bound", why: "Only a bound risk can be issued." },
    { label: "Binder not expired", ok: !expired, why: `Binder runs to ${p.binder.expiryDate}.` },
    { label: "All subjectivities satisfied", ok: unmet.length === 0, why: unmet.length ? `Outstanding: ${unmet.map((s) => s.label).join(", ")}` : "All conditions cleared." },
    { label: "Compliance & sanctions clear", ok: true, why: "Screening returned no hits." },
    { label: "Document template available", ok: true, why: "Schedule and certificate templates resolved for this product." },
  ];
  const canIssue = gates.every((g) => g.ok);
  async function doIssue() {
    await api.call("POST", `/api/v1/policies/${p.id}/issue`, { generateDocuments: true },
      { module: "Issuance", policyId: p.id, statusCode: 200, label: `Issue policy — ${p.holder}`,
        response: { policyNumber: p.id, status: "active", documents: ["policy-schedule-v1.pdf", "certificate-of-insurance-v1.pdf"], events: ["policyIssued"] } });
    issuePolicy(p.id); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Issue desk" />
      <RecordHead p={p} right={canIssue ? <Pill tone="green" icon={CheckCircle2}>Ready to issue</Pill> : <Pill tone="red" icon={AlertTriangle}>{unmet.length} blocking</Pill>} />
      <DecisionLayout
        left={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Issue gates"
            what="All five must pass before a policy can be issued." rule="Issue is blocked, not warned — an unmet gate disables the button." />
          {gates.map((g) => (
            <div key={g.label} style={{ display: "flex", gap: 9, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              {g.ok ? <CheckCircle2 size={15} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={15} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: g.ok ? C.text : C.red, fontWeight: g.ok ? 600 : 700 }}>{g.label}</div>
                <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 1, lineHeight: 1.45 }}>{g.why}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 15 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Subjectivities"
              what="Conditions the insured must satisfy before the contract can be formalised."
              why="Tick to clear — in production each is evidence-backed, not a checkbox." />
            {subs.map((s, i) => <Checkbox key={s.label} checked={s.met} onChange={() => toggleSubjectivity(p.id, i)} label={s.label} />)}
          </div>
        </>}
        right={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Binder" what="The provisional cover currently protecting this insured." />
          <KV k="Binder number" v={p.binder.number} mono what="Reference for provisional cover." />
          <KV k="Bound on" v={p.binder.boundOn} what="Date provisional cover attached." />
          <KV k="Expires" v={p.binder.expiryDate} what="Deadline to formalise." rule="Past this date the risk must be re-underwritten and re-bound." />
          <KV k="Days remaining" v={daysBetween(todayISO(), p.binder.expiryDate) + " days"} what="Time left on the binder." />
          <div style={{ marginTop: 15 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="What issuing will do"
              what="The exact side effects of pressing the button." why="Nothing hidden — issue is a compound operation." />
            {[["Policy status → ACTIVE", Stamp], ["Policy schedule generated & stored", FileCheck2], ["Certificate of insurance generated", FileCheck2], ["policyIssued published to Billing, Documents, Reinsurance", Zap], ["Ledger entry appended", GitBranch]].map(([t, I]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                <I size={13} color={C.primary} /><span style={{ fontSize: 12, color: C.text }}>{t}</span>
              </div>
            ))}
          </div>
          {!canIssue && <div style={{ marginTop: 12 }}><Callout tone="bad">Issue is blocked. Cover stays provisional under the binder until every gate clears.</Callout></div>}
        </>}
        actions={[{ label: "Issue policy & generate documents", tone: "primary", icon: FileCheck2, onRun: doIssue, disabled: !canIssue,
          disabledReason: unmet.length ? `Outstanding subjectivity: ${unmet.map((s) => s.label).join(", ")}` : "An issue gate has not passed." }]} />
    </div>
  );
}

function CancellationDecision({ p, h, api, decideCancellation, onBack }) {
  const reason = h.meta.reason || "Insured request";
  const [effDate, setEffDate] = useState(h.date || todayISO());
  const q = cancelQuote(p, reason, effDate);
  async function decide(approve) {
    await api.call("POST", `/api/v1/transactions/${h.id}/${approve ? "approve" : "reject"}`,
      { decision: approve ? "approved" : "rejected", effectiveDate: effDate, premiumMethod: q.type, refund: { amount: Math.round(q.refund), currency: "INR" } },
      { module: "Cancellation", policyId: p.id, statusCode: approve ? 200 : 200, label: `${approve ? "Approve" : "Decline"} cancellation — ${p.holder}`,
        response: approve ? { txnId: h.id, status: "completed", premiumMethod: q.type, refundAmount: Math.round(q.refund), events: ["policyCancelled"] } : { txnId: h.id, status: "rejected" } });
    decideCancellation(p.id, h.id, approve, { effDate, q }); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Cancellation desk" />
      <RecordHead p={p} right={<Pill tone={q.spec.tone}>{q.type}</Pill>} />
      <DecisionLayout
        left={<>
          <RequestOrigin meta={h.meta} />
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="What was requested"
            what="The reason came in with the request — it is not chosen here." why="Everything else — type, refund, notice — is derived from it." />
          <KV k="Stated reason" v={reason} what="What the requester gave." rule="Fraud never auto-completes and permanently blocks any later reinstatement." />
          <Field label="Effective date" hint="Pre-filled from the request; adjust only if the underwriter is confirming a different date.">
            <input style={inputStyle} type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)} />
          </Field>
          <div style={{ marginTop: 6 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Derived type" what="Which of the four cancellation types this maps to." />
            <div style={{ ...card, boxShadow: "none", padding: 13, background: TONES[q.spec.tone][0], borderColor: TONES[q.spec.tone][1] }}>
              <Pill tone={q.spec.tone}>{q.type}</Pill>
              <div style={{ fontSize: 12, color: C.text, marginTop: 8, lineHeight: 1.5 }}>{q.spec.when}</div>
              <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 6, lineHeight: 1.5 }}>{q.spec.rate}</div>
            </div>
          </div>
          <div style={{ marginTop: 13 }}>
            <Callout tone={q.noticeOk ? "good" : "bad"}>
              {q.noticeOk ? `Notice satisfied — ${q.noticeRequired}d required, ${q.noticeProvided}d given.`
                : `Notice shortfall — ${q.type} requires ${q.noticeRequired}d, only ${q.noticeProvided}d given. Decide with this in mind.`}
            </Callout>
            {reason === "Fraud" && <Callout tone="warn">Fraud-flagged — decide carefully. Approving permanently blocks reinstatement.</Callout>}
          </div>
        </>}
        right={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Refund calculation" what="Computed from term dates and the derived type." why="Never hand-keyed — this is the number that goes to Billing." />
          <KV k="Policy term" v={`${q.totalDays} days`} what="Full length of the term." />
          <KV k="Earned" v={`${q.earnedDays} days`} what="Days the insurer was on risk." />
          <KV k="Unearned" v={`${q.remainingDays} days`} what="Days being returned." why="Drives the refund." />
          <KV k="Basis" v={q.type === "Flat" ? "Full written premium" : "Unearned premium"} what={q.type === "Flat" ? "Insurer never went on risk." : "Proportional to unused term."} />
          <KV k="Gross refund" v={money(q.gross)} what="Before any penalty." />
          {q.penalty > 0 && <KV k={`Short-rate penalty (${q.spec.penaltyPct * 100}%)`} v={"− " + money(q.penalty)} what="Retained for acquisition and admin cost." rule="Only ever applied to insured-initiated cancellations." />}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "12px 14px", background: C.greenSoft, borderRadius: 9 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>Refund due</span>
            <span style={{ fontSize: 19, fontWeight: 800, color: C.green }}>{money(q.refund)}</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Notice period" what="Statutory days that must run before the effective date." />
            <KV k="Required" v={q.noticeRequired + " days"} what={`${q.type} requires this much notice.`} />
            <KV k="Provided" v={q.noticeProvided + " days"} what="Between today and the effective date." />
          </div>
        </>}
        actions={[
          { label: "Approve cancellation", tone: "red", icon: XCircle, onRun: () => decide(true) },
          { label: "Decline request", icon: Ban, onRun: () => decide(false) },
        ]} />
    </div>
  );
}

function ReinstatementDecision({ p, h, api, decideReinstatement, onBack }) {
  const e = reinstatementEligibility(p);
  const [outstanding, setOutstanding] = useState(String(h.meta?.outstandingClaimed || 0));
  async function decide(approve) {
    await api.call("POST", `/api/v1/transactions/${h.id}/${approve ? "approve" : "reject"}`,
      { decision: approve ? "approved" : "rejected", outstandingPremium: { amount: Number(outstanding) || 0, currency: "INR" } },
      { module: "Reinstatement", policyId: p.id, statusCode: 200, label: `${approve ? "Approve" : "Decline"} reinstatement — ${p.holder}`,
        response: approve ? { txnId: h.id, status: "active", gapDays: e.daysSince, disclosureRequired: true, events: ["policyReinstated"] } : { txnId: h.id, status: "rejected" } });
    decideReinstatement(p.id, h.id, approve, { gapDays: e.daysSince, outstanding: Number(outstanding) || 0 }); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Reinstatement desk" />
      <RecordHead p={p} right={<Pill tone={e.eligible ? "green" : "red"}>{e.eligible ? "Eligible" : e.fraud ? "Fraud — barred" : "Window closed"}</Pill>} />
      <DecisionLayout
        left={<>
          <RequestOrigin meta={h.meta} />
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Cancellation on record" what="What put this policy out of force." />
          <KV k="Cancelled on" v={e.cancelEv.date} what="Effective date of cancellation." />
          <KV k="Reason" v={e.cancelEv.meta?.reason || "—"} what="Why it was cancelled." rule="Fraud permanently bars reinstatement." />
          <KV k="Type applied" v={e.cancelEv.meta?.cancelType || "—"} what="Which refund basis was used." />
          <KV k="Refund issued" v={money(e.cancelEv.meta?.refund || 0)} what="Unearned premium already returned." why="Typically recollected on reinstatement." />
          <div style={{ marginTop: 13 }}>
            <Callout tone={e.eligible ? "good" : "bad"}>
              Cancelled {e.daysSince} days ago. {e.fraud ? "Fraud cancellation — reinstatement permanently barred."
                : e.eligible ? `Inside the ${REINSTATEMENT_WINDOW_DAYS}-day window.` : `Outside the ${REINSTATEMENT_WINDOW_DAYS}-day window — needs new-business underwriting.`}
            </Callout>
          </div>
        </>}
        right={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Reinstatement terms" what="What restoring cover involves." />
          <KV k="Coverage gap" v={e.daysSince + " days"} what="Period with no cover in force." rule="The gap must be disclosed to the policyholder in writing." />
          <KV k="Window remaining" v={Math.max(0, REINSTATEMENT_WINDOW_DAYS - e.daysSince) + " days"} what="Time left to reinstate." />
          <KV k="Gap disclosure" v="Required" what="Written notice explaining the uninsured period." />
          <div style={{ marginTop: 13 }}>
            <Field label="Outstanding premium to collect" hint="The requester's claimed figure — confirm against Billing before approving.">
              <input style={inputStyle} type="number" value={outstanding} onChange={(ev) => setOutstanding(ev.target.value)} />
            </Field>
          </div>
        </>}
        actions={[
          { label: "Approve reinstatement", tone: "green", icon: RotateCcw, onRun: () => decide(true), disabled: !e.eligible,
            disabledReason: e.fraud ? "Policies cancelled for fraud are never eligible." : `Cancelled ${e.daysSince} days ago — beyond the ${REINSTATEMENT_WINDOW_DAYS}-day window.` },
          { label: "Decline request", icon: Ban, onRun: () => decide(false) },
        ]} />
    </div>
  );
}

function RenewalDecision({ p, h, api, decideRenewal, onBack }) {
  const rc = renewalCompliance(p);
  const score = riskScore(p.premium, p.holder);
  const suggested = Math.round(p.premium * (score < 60 ? 1.12 : score > 85 ? 0.97 : 1.05));
  const [newPrem, setNewPrem] = useState("");
  const prem = newPrem === "" ? suggested : Number(newPrem) || 0;
  async function decide(approve) {
    await api.call("POST", `/api/v1/transactions/${h.id}/${approve ? "approve" : "reject"}`,
      approve ? { decision: "approved", newPremium: { amount: prem, currency: "INR" }, termNumber: p.termNumber + 1 } : { decision: "rejected", reason: "underwritingDecision" },
      { module: "Renewal", policyId: p.id, statusCode: approve ? 200 : 200, label: `${approve ? "Approve renewal" : "Decline renewal"} — ${p.holder}`,
        response: approve ? { txnId: h.id, newTermNumber: p.termNumber + 1, effectiveDate: p.expirationDate, expirationDate: addDays(p.expirationDate, 365), events: ["policyRenewed"] }
          : { txnId: h.id, status: "nonRenewed", noticeServedOn: todayISO() } });
    decideRenewal(p.id, h.id, approve, prem); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Renewal desk" />
      <RecordHead p={p} right={<Pill tone={rc.status === "Compliant" ? "green" : rc.status === "Urgent" ? "amber" : "red"}>{rc.status}</Pill>} />
      <DecisionLayout
        left={<>
          <RequestOrigin meta={h.meta} />
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Expiring term" what="The term now coming to an end." />
          <KV k="Current term" v={`${p.effectiveDate} → ${p.expirationDate}`} what="Term being renewed out of." />
          <KV k="Days to expiry" v={rc.daysToExpiry + " days"} what="Time remaining." />
          <KV k="Notice requirement" v={RENEWAL_LEAD_DAYS + " days"} what="Statutory lead time." rule="Serving later than this is a compliance exception, not a scheduling slip." />
          <KV k="Expiring premium" v={money(p.premium)} what="Premium on the ending term." />
          <KV k="Term number" v={p.termNumber} what="How many times this policy has renewed." />
          <div style={{ marginTop: 13 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Claims & change history" what="What the re-underwriting decision is based on." />
            <KV k="Endorsements" v={p.history.filter((x) => x.type === "Endorsement").length} what="Mid-term changes this term." why="Frequent changes can signal an unstable risk." />
            <KV k="Prior cancellations" v={p.history.filter((x) => x.type === "Cancellation").length} what="Cancellations on record." />
          </div>
        </>}
        right={<>
          <ScoreDial score={score} />
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Renewal offer" what="The new term you are about to create." why="A new PolicyTerm on the same policy — number and history carry forward." />
          <KV k="New term" v={`${p.expirationDate} → ${addDays(p.expirationDate, 365)}`} what="Dates of the term being created." />
          <KV k="Becomes term" v={p.termNumber + 1} what="Incremented on renewal." />
          <div style={{ marginTop: 12 }}>
            <Field label="Renewal premium" hint={`System suggests ${money(suggested)} from the re-underwritten score. Override if you have a reason.`}>
              <input style={inputStyle} type="number" value={newPrem} onChange={(e) => setNewPrem(e.target.value)} placeholder={String(suggested)} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.textSoft }}>
              Change vs expiring:
              <span style={{ fontWeight: 800, color: prem >= p.premium ? C.amber : C.green, display: "inline-flex", alignItems: "center", gap: 3 }}>
                {prem >= p.premium ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{((prem / p.premium - 1) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </>}
        actions={[
          { label: `Approve — renew into term ${p.termNumber + 1}`, tone: "primary", icon: RefreshCw, onRun: () => decide(true) },
          { label: "Decline — non-renew", tone: "red", icon: Ban, onRun: () => decide(false) },
        ]} />
    </div>
  );
}

function EndorsementDecision({ p, h, api, decideTxn, onBack }) {
  async function act(ok) {
    await api.call("POST", `/api/v1/transactions/${h.id}/${ok ? "approve" : "reject"}`, { decision: ok ? "approved" : "rejected" },
      { module: "Endorsement", policyId: p.id, statusCode: 200, label: `${ok ? "Approve" : "Decline"} endorsement — ${p.holder}`,
        response: { txnId: h.id, status: ok ? "completed" : "rejected", premiumDelta: { amount: h.meta.premiumImpact || 0, currency: "INR" }, policyVersion: p.history.length + 1 } });
    decideTxn(p.id, h.id, ok); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Endorsement desk" />
      <RecordHead p={p} right={<TxnStatusBadge status={h.status} />} />
      <DecisionLayout
        left={<>
          <RequestOrigin meta={h.meta} />
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Requested change" what="What was asked for, mid-term." />
          <KV k="Change type" v={h.meta.changeType} what="What is being altered." />
          <KV k="Materiality" v={h.meta.materiality} what="Material changes alter the risk and need sign-off." rule="Material endorsements are never auto-applied." />
          <KV k="Requested" v={h.date} what="Business date the change was requested." />
          <KV k="Transaction" v={"#" + h.seq} mono what="Position in the policy ledger." />
          <div style={{ marginTop: 13 }}><Callout tone="warn">{h.detail}</Callout></div>
        </>}
        right={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Financial impact" what="What approving this does to premium and billing." />
          <KV k="Current premium" v={money(p.premium)} what="Premium before the change." />
          <KV k="Premium delta" v={<span style={{ color: (h.meta.premiumImpact || 0) >= 0 ? C.green : C.red }}>{(h.meta.premiumImpact || 0) >= 0 ? "+" : ""}{money(h.meta.premiumImpact || 0)}</span>}
            what="Prorated for the remainder of the term." why="Published to Billing as an adjustment once approved." />
          <KV k="Premium after" v={money(p.premium + (h.meta.premiumImpact || 0))} what="Revised annual premium." />
          <div style={{ marginTop: 15 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="What approval will do" what="Side effects of committing this change." />
            {[["Transaction status → Completed", CheckCircle2], ["Policy version incremented", GitBranch], ["Premium delta published to Billing", TrendingUp], ["Endorsement wording regenerated", FileCheck2], ["policyEndorsed event published", Zap]].map(([t, I]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}><I size={13} color={C.primary} /><span style={{ fontSize: 12, color: C.text }}>{t}</span></div>
            ))}
          </div>
        </>}
        actions={[
          { label: "Approve & apply", tone: "green", icon: CheckCircle2, onRun: () => act(true) },
          { label: "Decline", tone: "red", icon: Ban, onRun: () => act(false) },
        ]} />
    </div>
  );
}

function ServicingDecision({ p, api, logService, onBack }) {
  const SLA = { "Document request": 24, Inquiry: 8, "Contact update": 24, Billing: 48, Correspondence: 72 };
  const [category, setCategory] = useState("Document request");
  const [channel, setChannel] = useState("Phone");
  const [notes, setNotes] = useState("");
  const escalate = category === "Contact update";
  async function doLog() {
    await api.call("POST", `/api/v1/policies/${p.id}/service-requests`, { category, channel, notes },
      { module: "Servicing", policyId: p.id, statusCode: 201, label: `Service request — ${p.holder}`,
        response: { serviceRequestId: uid("SRV"), status: "logged", slaTargetHours: SLA[category] } });
    logService(p.id, { category, channel, notes, sla: SLA[category] }); onBack();
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Servicing desk" />
      <RecordHead p={p} />
      <DecisionLayout
        left={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="New request" what="Log an operational request against this policy." />
          <Field label="Category" hint="Drives the SLA and whether this can stay a note.">
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>{Object.keys(SLA).map((k) => <option key={k}>{k}</option>)}</select>
          </Field>
          <Field label="Channel"><select style={inputStyle} value={channel} onChange={(e) => setChannel(e.target.value)}><option>Phone</option><option>Email</option><option>Portal</option><option>Branch</option></select></Field>
          <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 84, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did the customer ask for?" /></Field>
          {escalate && <Callout tone="warn">A contact update can change a rating factor. Log it here for the trail, but raise an <b>endorsement</b> to actually change the policy.</Callout>}
        </>}
        right={<>
          <TipLabel style={{ ...label11, display: "block", marginBottom: 10 }} text="Handling" what="Commitments attached to this request." />
          <KV k="SLA target" v={SLA[category] + " hours"} what="Turnaround commitment for this category." why="Each category has its own — they are not uniform." />
          <KV k="Rating relevant" v={escalate ? "Yes — escalate" : "No"} what="Whether this touches a rating factor." rule="Rating-relevant requests must become endorsements, not notes." />
          <KV k="Channel" v={channel} what="How the customer got in touch." why="All channels write to one ledger." />
          <div style={{ marginTop: 15 }}>
            <TipLabel style={{ ...label11, display: "block", marginBottom: 9 }} text="Existing requests" what="Servicing already logged against this policy." />
            {p.history.filter((h) => h.type === "Servicing").map((h) => (
              <div key={h.id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{h.meta.category}</span>
                  <span style={{ fontSize: 11, color: C.textFaint }}>{h.date}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 2 }}>{h.detail}</div>
              </div>
            ))}
            {p.history.filter((h) => h.type === "Servicing").length === 0 && <div style={{ fontSize: 12, color: C.textFaint }}>None yet.</div>}
          </div>
        </>}
        actions={[{ label: "Log request", tone: "primary", icon: Headphones, onRun: doLog, disabled: !notes.trim(), disabledReason: "A servicing entry needs a note — it becomes part of the permanent record." }]} />
    </div>
  );
}

/* ================= RECORDS ================= */
const allTxns = (ps) => ps.flatMap((p) => p.history.map((h) => ({ p, h }))).sort((a, b) => (a.h.recordedAt < b.h.recordedAt ? 1 : -1));

/* Which desk owns the decision for each held transaction type — used so this cross-type
   index never decides anything itself, only routes to the screen that has the full
   request context (origin, derived numbers) needed to decide responsibly. */
const TYPE_TO_DESK = { Underwriting: "uw-desk", Endorsement: "endorsement-desk", Cancellation: "cancellation-desk", Renewal: "renewal-desk", Reinstatement: "reinstatement-desk" };
function ApprovalsPage({ policies, openRequest }) {
  const pending = allTxns(policies).filter((t) => t.h.status === "Pending");
  return (
    <div>
      <PageHeader icon={Inbox} tone="amber" title="Pending Approvals" sub="Every request received, not yet decided — across every desk"
        what="A cross-type index of every held transaction, wherever it came from."
        why="Held means untouched — the policy stays exactly as it was until an underwriter reviews the request's full context and decides." />
      <KpiRow items={[
        { label: "Awaiting decision", value: pending.length, tone: "amber", tip: "Held transactions of all types." },
        { label: "Endorsements", value: pending.filter((t) => t.h.type === "Endorsement").length, tip: "Material changes needing sign-off." },
        { label: "Cancellations", value: pending.filter((t) => t.h.type === "Cancellation").length, tip: "Insured, broker or underwriter initiated." },
        { label: "Renewal / reinstatement", value: pending.filter((t) => t.h.type === "Renewal" || t.h.type === "Reinstatement").length, tip: "Confirmed by the insured or broker, awaiting underwriter pricing." },
      ]} />
      <DataTable columns={[{ label: "Seq", what: "Position in the policy ledger." }, "Policy", "Insured",
        { label: "Type", what: "Which kind of transaction is held." }, "Requested by",
        { label: "Why it is held", what: "What was submitted, and by whom.", rule: "Material endorsements, fraud cancellations and authority referrals always hold." },
        { label: "Effective", what: "Business date it would take effect." }, ""]}
        rows={pending.map((t) => [
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textFaint }}>#{t.h.seq}</span>,
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textSoft }}>{t.p.id}</span>,
          t.p.holder, <Pill tone={MODULE_TONE[t.h.type]} icon={MODULE_ICON[t.h.type]}>{t.h.type}</Pill>,
          <InitiatorPill meta={t.h.meta} />,
          <span style={{ fontSize: 12, color: C.textSoft, whiteSpace: "normal", display: "inline-block", maxWidth: 300 }}>{t.h.detail}</span>,
          t.h.date,
          <button onClick={() => openRequest(t.h.type, t.p.id, t.h.id)} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.primary, color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Review <ArrowRight size={11} /></button>])}
        emptyText="Nothing awaiting approval." />
    </div>
  );
}

function WorkbenchPage({ policies, api, reverseTxn, openPolicy }) {
  const [typeF, setTypeF] = useState("All"); const [statusF, setStatusF] = useState("All");
  const all = allTxns(policies);
  const rows = all.filter((t) => (typeF === "All" || t.h.type === typeF) && (statusF === "All" || (t.h.status || "Completed") === statusF));
  async function rev(t) {
    await api.call("POST", `/api/v1/transactions/${t.h.id}/reverse`, { reason: "keyedInError" },
      { module: t.h.type, policyId: t.p.id, statusCode: 201, label: `Reverse txn #${t.h.seq} — ${t.p.holder}`,
        response: { reversalTxnId: uid("TXN"), reversesTxnId: t.h.id, status: "completed" } });
    reverseTxn(t.p.id, t.h.id);
  }
  const chip = (list, val, set) => <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{list.map((m) => (
    <button key={m} onClick={() => set(m)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${val === m ? C.primary : C.border}`, background: val === m ? C.primary : C.surface, color: val === m ? "#fff" : C.textSoft }}>{m}</button>))}</div>;
  return (
    <div>
      <PageHeader icon={GitBranch} tone="blue" title="Transaction Workbench" sub="The append-only ledger behind every policy"
        what="Every transaction of every type, in sequence." why="Transactions, not modules, are the real unit of work after issue." />
      <KpiRow items={[
        { label: "Transactions", value: all.length, tip: "Complete ledger across the book." },
        { label: "Pending", value: all.filter((t) => t.h.status === "Pending").length, tone: "amber", tip: "Held, not applied." },
        { label: "Reversed", value: all.filter((t) => t.h.status === "Reversed").length, tone: "violet", tip: "Superseded by a compensating row." },
        { label: "Policies", value: policies.length, tip: "Aggregates in this ledger." },
      ]} />
      <div style={{ display: "flex", gap: 16, marginBottom: 13, flexWrap: "wrap" }}>
        <div><div style={{ ...label11, marginBottom: 5 }}>Type</div>{chip(["All", "Submission", "Underwriting", "Bind", "Issuance", "Endorsement", "Cancellation", "Reinstatement", "Renewal", "Servicing"], typeF, setTypeF)}</div>
        <div><div style={{ ...label11, marginBottom: 5 }}>Status</div>{chip(["All", "Completed", "Pending", "Rejected", "Reversed"], statusF, setStatusF)}</div>
      </div>
      <DataTable columns={[{ label: "Seq", what: "Monotonic order within the policy." }, "Policy",
        { label: "Type", what: "Kind of change." },
        { label: "Status", what: "Draft → Pending → Completed, or Rejected / Reversed.", rule: "Completed rows are never edited — corrections are new reversal rows." },
        { label: "Effective", what: "Business date the change applies from." },
        { label: "Recorded", what: "System date it was entered.", why: "Storing both makes the ledger bitemporal and as-of queryable." },
        "By", { label: "Action", what: "Reverse appends a compensating transaction.", rule: "The ledger is append-only — nothing is deleted." }]}
        rows={rows.map((t) => [
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textFaint }}>#{t.h.seq}</span>,
          <button onClick={() => openPolicy(t.p.id)} style={{ background: "none", border: "none", padding: 0, fontFamily: MONO, fontSize: 11.5, color: C.primary, fontWeight: 700, cursor: "pointer" }}>{t.p.id}</button>,
          <Pill tone={MODULE_TONE[t.h.type]} icon={MODULE_ICON[t.h.type]}>{t.h.type}</Pill>,
          <TxnStatusBadge status={t.h.status} />, t.h.date,
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint }}>{(t.h.recordedAt || "").slice(0, 10)}</span>, t.h.user,
          (t.h.status || "Completed") === "Completed"
            ? <button onClick={() => rev(t)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.violet, borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Reverse</button>
            : <span style={{ fontSize: 11, color: C.textFaint }}>—</span>])}
        emptyText="No transactions match these filters." />
    </div>
  );
}

function RegistryPage({ policies, openPolicy }) {
  const [q, setQ] = useState(""); const [sf, setSf] = useState("All");
  const rows = policies.filter((p) => (sf === "All" || p.status === sf) && (p.holder.toLowerCase().includes(q.toLowerCase()) || p.id.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <PageHeader icon={ListChecks} tone="indigo" title="Policy Register" sub="Every record in the book, in every lifecycle state"
        what="Submissions and policies alike." why="The single source of truth each decision desk reads from." />
      <KpiRow items={[
        { label: "Total records", value: policies.length, tip: "Submissions plus policies." },
        { label: "In force", value: policies.filter((p) => p.status === "Active").length, tone: "green", tip: "Issued, not cancelled or expired." },
        { label: "Pre-issue", value: policies.filter((p) => ["Referred", "Bound"].includes(p.status)).length, tone: "amber", tip: "Submissions and bound-not-issued." },
        { label: "Closed", value: policies.filter((p) => ["Cancelled", "Expired", "Non-renewed"].includes(p.status)).length, tip: "No longer on risk." },
      ]} />
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 11, color: C.textFaint }} />
          <input style={{ ...inputStyle, paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search insured or policy number" />
        </div>
        <select style={{ ...inputStyle, width: 165 }} value={sf} onChange={(e) => setSf(e.target.value)}>
          {["All", "Referred", "Bound", "Active", "Cancelled", "Expired", "Non-renewed"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <DataTable columns={["Record", "Insured", "Product",
        { label: "Status", what: "Position in the lifecycle state machine.", why: "Status decides which actions are legal on this record." },
        { label: "Premium", what: "Annual written premium." },
        { label: "Term", what: "Effective and expiry dates of the current term." },
        { label: "Docs", what: "Generated document versions held." }, ""]}
        rows={rows.map((p) => [idCell(p.id), nameCell(p.holder), p.product, <Badge status={p.status} />, money(p.premium),
          `${p.effectiveDate} → ${p.expirationDate}`, <Pill tone={p.documents?.length ? "gray" : "amber"}>{p.documents?.length || 0}</Pill>,
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.primary, fontSize: 12, fontWeight: 700 }}>Open <ArrowRight size={11} /></span>])}
        onRowClick={(i) => openPolicy(rows[i].id)} />
    </div>
  );
}

function PolicyDetailPage({ policy, onBack, api, generateDoc }) {
  const [tab, setTab] = useState("ledger");
  async function gen() {
    await api.call("POST", `/api/v1/policies/${policy.id}/documents`, { template: "policySchedule" },
      { module: "Issuance", policyId: policy.id, statusCode: 201, label: `Generate schedule — ${policy.holder}`,
        response: { documentId: uid("DOC"), name: "Policy schedule", version: (policy.documents?.length || 0) + 1, events: ["documentGenerated"] } });
    generateDoc(policy.id, "Policy schedule", "Schedule");
  }
  return (
    <div>
      <BackLink onClick={onBack} label="Policy register" />
      <RecordHead p={policy} />
      <KpiRow items={[
        { label: "Term", value: `${policy.effectiveDate} → ${policy.expirationDate}`, tip: "Current coverage period." },
        { label: "Premium", value: money(policy.premium), tip: "Annual written premium." },
        { label: "Sum insured", value: policy.sumInsured || "—", tip: "Total limit of indemnity." },
        { label: "Transactions", value: policy.history.length, tip: "Entries in the append-only ledger." },
        { label: "Documents", value: policy.documents?.length || 0, tip: "Stored document versions." },
      ]} />
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        {[["ledger", "Transaction ledger"], ["docs", `Documents (${policy.documents?.length || 0})`], ["cover", "Cover & parties"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: "none", border: "none", padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: tab === k ? C.text : C.textFaint, borderBottom: tab === k ? `2px solid ${C.primary}` : "2px solid transparent" }}>{l}</button>
        ))}
      </div>
      {tab === "ledger" && <DataTable columns={[{ label: "Seq", what: "Order within this policy's ledger." }, "Date", "Type",
        { label: "Status", what: "Whether this transaction has been applied." }, "Detail", "By"]}
        rows={[...policy.history].sort((a, b) => b.seq - a.seq).map((h) => [
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.textFaint }}>#{h.seq}</span>, h.date,
          <Pill tone={MODULE_TONE[h.type]} icon={MODULE_ICON[h.type]}>{h.type}</Pill>, <TxnStatusBadge status={h.status} />,
          <span style={{ fontSize: 12, color: C.textSoft, whiteSpace: "normal", display: "inline-block", maxWidth: 420 }}>{h.detail}</span>, h.user])} />}
      {tab === "docs" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
          <TipLabel style={{ fontSize: 12.5, fontWeight: 800, color: C.text }} text="Generated documents"
            what="Versioned PDFs produced by the platform and stored against the policy."
            why="Every issue, endorsement and cancellation regenerates the pack so the customer's copy matches the system of record." />
          <button onClick={gen} style={{ display: "flex", alignItems: "center", gap: 6, background: C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}><Plus size={13} /> Generate schedule</button>
        </div>
        <DataTable columns={["Document", { label: "Type", what: "Schedule, certificate or notice." },
          { label: "Version", what: "Incremented each regeneration.", why: "Lets you prove what the customer held on any date." }, "Generated", ""]}
          rows={(policy.documents || []).map((d) => [
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600 }}><FileText size={13} color={C.primary} />{d.name}</span>,
            d.type, <Pill tone="gray">v{d.version}</Pill>, d.generatedAt,
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.primary, fontSize: 12, fontWeight: 700 }}><Download size={12} />PDF</span>])}
          emptyText="No documents yet. Issuing the policy generates the schedule and certificate." />
      </>}
      {tab === "cover" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Panel title="Cover" what="What the policy insures.">
          <KV k="Product" v={policy.product} /><KV k="Sum insured" v={policy.sumInsured || "—"} />
          <KV k="Premium" v={money(policy.premium)} /><KV k="Term number" v={policy.termNumber} what="How many times this policy has renewed." />
        </Panel>
        <Panel title="Parties & distribution" what="Who is insured and who placed the business.">
          <KV k="Named insured" v={policy.holder} /><KV k="Producer" v={policy.producer} what="Broker or channel." />
          <KV k="Binder" v={policy.binder?.number || "—"} mono what="Provisional cover reference, if bound." />
          <KV k="Status" v={<Badge status={policy.status} />} />
        </Panel>
      </div>}
    </div>
  );
}

function DocumentsPage({ policies }) {
  const docs = policies.flatMap((p) => (p.documents || []).map((d) => ({ p, d })));
  return (
    <div>
      <PageHeader icon={FileCheck2} tone="gray" title="Document Library" sub="Every generated artefact, versioned and traceable"
        what="Documents across the book, tied to the policy that produced them."
        why="Regulators ask what the customer held on a given date — versioning is how you answer." />
      <KpiRow items={[
        { label: "Documents", value: docs.length, tip: "Total generated artefacts." },
        { label: "Schedules", value: docs.filter((x) => x.d.type === "Schedule").length, tip: "Policy schedules issued." },
        { label: "Certificates", value: docs.filter((x) => x.d.type === "Certificate").length, tip: "Certificates of insurance." },
        { label: "Notices", value: docs.filter((x) => x.d.type === "Notice").length, tip: "Cancellation and renewal notices." },
      ]} />
      <DataTable columns={["Document", "Policy", "Insured", { label: "Type", what: "Document class." },
        { label: "Version", what: "Regenerated on every material change." }, "Generated", ""]}
        rows={docs.map(({ p, d }) => [
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600 }}><FileText size={13} color={C.primary} />{d.name}</span>,
          idCell(p.id), p.holder, d.type, <Pill tone="gray">v{d.version}</Pill>, d.generatedAt,
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.primary, fontSize: 12, fontWeight: 700 }}><Download size={12} />PDF</span>])}
        emptyText="No documents generated yet." />
    </div>
  );
}

function ArchitecturePage() {
  const layers = [["React", "Decision desks"], ["Policy API", ".NET minimal API"], ["Application", "Use cases, validators"], ["Domain", "Aggregates, invariants"], ["EF Core", "Repository"], ["Azure SQL", "System of record"]];
  const side = [
    ["Camunda 8", "Runs the approval workflows behind every held transaction — material endorsements, fraud cancellations and authority referrals."],
    ["Service Bus", "Carries policyIssued, policyCancelled and policyRenewed to Billing, Claims and Documents via the outbox pattern."],
    ["Blob Storage", "Holds generated schedules, certificates and notices. The database keeps only metadata, checksum and retention."],
    ["Redis", "Caches dashboard aggregates and the renewal pipeline so KPIs do not recompute on every request."],
  ];
  return (
    <div>
      <PageHeader icon={Layers} tone="gray" title="Architecture" sub="How these screens map onto the production stack"
        what="The request path behind every action in this prototype." why="Each click stands in for a full trip through the real system." />
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 15 }}>
        {layers.map(([t, s], i) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Tooltip tip={s} width={200}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 700, color: C.text }}>{t}<InfoDot size={10} /></span>
            </Tooltip>
            {i < layers.length - 1 && <ChevronRight size={13} color={C.textFaint} />}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
        {side.map(([n, r]) => (
          <div key={n} style={{ ...card, padding: 15 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 5 }}>{n}</div>
            <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.55 }}>{r}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= SHELL ================= */
const NAV = [
  { label: "Workspace", items: [["dashboard", "Dashboard", LayoutDashboard], ["approvals", "Pending approvals", Inbox]] },
  { label: "Decision desks", items: [["uw-desk", "Underwriting", ClipboardCheck], ["issue-desk", "Issue", Stamp], ["endorsement-desk", "Endorsements", Edit3], ["cancellation-desk", "Cancellation", XCircle], ["reinstatement-desk", "Reinstatement", RotateCcw], ["renewal-desk", "Renewal", RefreshCw], ["servicing-desk", "Servicing", Headphones]] },
  { label: "Records", items: [["registry", "Policy register", ListChecks], ["workbench", "Transaction workbench", GitBranch], ["documents", "Documents", FileCheck2]] },
  { label: "Platform", items: [["architecture", "Architecture", Layers]] },
];
const TITLES = { dashboard: "Workspace / Dashboard", approvals: "Workspace / Pending approvals", "uw-desk": "Decision desks / Underwriting", "issue-desk": "Decision desks / Issue", "endorsement-desk": "Decision desks / Endorsements", "cancellation-desk": "Decision desks / Cancellation", "reinstatement-desk": "Decision desks / Reinstatement", "renewal-desk": "Decision desks / Renewal", "servicing-desk": "Decision desks / Servicing", registry: "Records / Policy register", workbench: "Records / Transaction workbench", documents: "Records / Documents", architecture: "Platform / Architecture", detail: "Records / Policy detail" };
/* Opening a record swaps the whole screen rather than opening a side panel. */
const DETAIL_OF = { "uw-desk": "uw-detail", "issue-desk": "issue-detail", "cancellation-desk": "cancel-detail", "reinstatement-desk": "reinstate-detail", "renewal-desk": "renew-detail", "servicing-desk": "servicing-detail", "endorsement-desk": "endorsement-detail" };
const PARENT_OF = Object.fromEntries(Object.entries(DETAIL_OF).map(([a, b]) => [b, a]));

export default function PolicyLifecyclePlatform() {
  const [policies, setPolicies] = useState(seedPolicies());
  const [view, setView] = useState("dashboard");
  const [sel, setSel] = useState(null);
  const [selTxn, setSelTxn] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const api = useApiLog();
  const P = policies.find((p) => p.id === sel);
  const patch = (id, fn) => setPolicies((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
  const push = (p, e) => ({ ...p, history: [...p.history, { id: uid("TXN"), seq: p.history.length + 1, recordedAt: new Date().toISOString(), status: "Completed", user: "You", ...e }] });

  function decide(id, outcome, meta) {
    patch(id, (p) => {
      const t = push({ ...p, history: p.history.map((h) => (h.status === "Pending" && h.type === "Underwriting" ? { ...h, status: "Completed" } : h)) },
        { date: todayISO(), type: "Underwriting", title: `Underwriting: ${outcome}`, detail: meta.note || `Decided by underwriter. Score ${meta.score}, ${meta.tier}.`, meta });
      if (outcome === "Approve") return { ...t, status: "Bound", binder: { number: uid("BN"), boundOn: todayISO(), expiryDate: addDays(todayISO(), 30), subjectivities: [{ label: "Signed proposal form", met: true }] } };
      if (outcome === "Decline") return { ...t, status: "Declined" };
      return t;
    });
  }
  const issuePolicy = (id) => patch(id, (p) => ({ ...push(p, { date: todayISO(), type: "Issuance", title: "Policy issued", detail: "Formal contract issued. Schedule and certificate generated and stored.", meta: {} }),
    status: "Active", documents: [...(p.documents || []), { id: uid("DOC"), name: "Policy schedule", version: 1, generatedAt: todayISO(), type: "Schedule" }, { id: uid("DOC"), name: "Certificate of insurance", version: 1, generatedAt: todayISO(), type: "Certificate" }] }));
  const toggleSubjectivity = (id, i) => patch(id, (p) => ({ ...p, binder: { ...p.binder, subjectivities: p.binder.subjectivities.map((s, j) => (j === i ? { ...s, met: !s.met } : s)) } }));
  /* Cancellation, Reinstatement and Renewal are never started by ops directly — they always
     begin as a Pending request (self-service, broker, underwriter or system), and only a
     separate decision step (below) applies or rejects it. raiseRequest is the single entry
     point every "Log a request" form and every seed record goes through. */
  function raiseRequest(id, type, meta) {
    patch(id, (p) => {
      const submittedOn = meta.submittedOn || todayISO();
      const titles = { Cancellation: "Cancellation requested — awaiting decision", Renewal: "Renewal requested — awaiting decision", Reinstatement: "Reinstatement requested — awaiting decision", Endorsement: "Endorsement requested — awaiting decision" };
      const effDate = type === "Renewal" ? p.expirationDate : todayISO();
      return push(p, { date: effDate, type, status: "Pending", title: titles[type],
        detail: `Requested by ${meta.initiatedBy} via ${meta.channel}. "${meta.requestNote}"`,
        meta: { ...meta, submittedOn } });
    });
  }
  function decideCancellation(id, txnId, approve, { effDate, q }) {
    patch(id, (p) => {
      const history = p.history.map((h) => h.id === txnId
        ? { ...h, status: approve ? "Completed" : "Rejected", date: effDate, approvedBy: "You",
            title: approve ? "Cancellation approved" : "Cancellation declined",
            detail: approve ? `Approved. ${q.type} basis, effective ${effDate}. Refund ${money(q.refund)}.` : `Declined. Policy remains ACTIVE. ${h.detail}`,
            meta: { ...h.meta, cancelType: q.type, refund: Math.round(q.refund) } }
        : h);
      return approve ? { ...p, history, status: "Cancelled", documents: [...(p.documents || []), { id: uid("DOC"), name: "Cancellation notice", version: 1, generatedAt: todayISO(), type: "Notice" }] } : { ...p, history };
    });
  }
  function decideReinstatement(id, txnId, approve, m) {
    patch(id, (p) => {
      const history = p.history.map((h) => h.id === txnId
        ? { ...h, status: approve ? "Completed" : "Rejected", approvedBy: "You",
            title: approve ? "Policy reinstated" : "Reinstatement declined",
            detail: approve ? `Reinstated after a ${m.gapDays}-day lapse. Outstanding premium collected: ${money(m.outstanding)}. Gap disclosure issued.` : `Declined. Policy remains Cancelled. ${h.detail}`,
            meta: { ...h.meta, ...m } } : h);
      return approve ? { ...p, history, status: "Active" } : { ...p, history };
    });
  }
  function decideRenewal(id, txnId, approve, prem) {
    patch(id, (p) => {
      const history = p.history.map((h) => h.id === txnId
        ? { ...h, status: approve ? "Completed" : "Rejected", approvedBy: "You",
            title: approve ? `Renewed into term ${p.termNumber + 1}` : "Renewal declined — non-renewed",
            detail: approve ? `Re-underwritten and renewed. Premium ${money(p.premium)} → ${money(prem)}.` : `Declined. ${RENEWAL_LEAD_DAYS}-day non-renewal notice served.`,
            meta: { ...h.meta, previousPremium: p.premium, newPremium: prem } } : h);
      return approve
        ? { ...p, history, termNumber: p.termNumber + 1, effectiveDate: p.expirationDate, expirationDate: addDays(p.expirationDate, 365), premium: prem,
            documents: [...(p.documents || []), { id: uid("DOC"), name: "Policy schedule", version: p.termNumber + 1, generatedAt: todayISO(), type: "Schedule" }] }
        : { ...p, history, status: "Non-renewed" };
    });
  }
  const logService = (id, m) => patch(id, (p) => push(p, { date: todayISO(), type: "Servicing", title: "Service request logged", detail: m.notes, meta: { category: m.category, channel: m.channel, sla: m.sla } }));
  const generateDoc = (id, name, type) => patch(id, (p) => ({ ...p, documents: [...(p.documents || []), { id: uid("DOC"), name, version: (p.documents || []).filter((d) => d.name === name).length + 1, generatedAt: todayISO(), type }] }));
  const decideTxn = (pid, tid, ok) => patch(pid, (p) => {
    const held = p.history.find((h) => h.id === tid);
    if (!held) return p;
    const premiumDelta = ok ? (held.meta?.premiumImpact || 0) : 0;
    const outcomeText = ok
      ? `Approved and applied.${premiumDelta ? ` Premium adjusted ${premiumDelta >= 0 ? "+" : ""}${money(premiumDelta)}.` : ""}`
      : "Declined.";
    const detail = /HELD[^.]*\./.test(held.detail) ? held.detail.replace(/HELD[^.]*\./, outcomeText) : `${held.detail} ${outcomeText}`;
    return { ...p, premium: p.premium + premiumDelta,
      history: p.history.map((h) => (h.id === tid ? { ...h, status: ok ? "Completed" : "Rejected", approvedBy: "Senior UW", detail } : h)) };
  });
  const reverseTxn = (pid, tid) => patch(pid, (p) => {
    const o = p.history.find((h) => h.id === tid); if (!o) return p;
    return { ...p, history: [...p.history.map((h) => (h.id === tid ? { ...h, status: "Reversed" } : h)),
      { id: uid("TXN"), seq: p.history.length + 1, date: todayISO(), recordedAt: new Date().toISOString(), status: "Completed", user: "You", type: o.type, title: `Reversal of ${o.title}`, detail: `Compensating reversal of transaction #${o.seq}. The original row is retained unchanged.`, meta: { ...o.meta, reversal: true } }] };
  });

  const nav = (k) => { setView(k); setSel(null); setSelTxn(null); };
  const openFromDesk = (deskKey) => (id, txnId) => { setSel(id); setSelTxn(txnId || null); setView(DETAIL_OF[deskKey]); };
  const backToDesk = () => { const parent = PARENT_OF[view]; setSel(null); setSelTxn(null); setView(parent || "dashboard"); };
  const openPolicy = (id) => { setSel(id); setView("detail"); };
  const openRequest = (type, id, txnId) => openFromDesk(TYPE_TO_DESK[type])(id, txnId);
  const unread = api.notes.length;

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: C.bg, height: "100vh", display: "flex", overflow: "hidden" }}>
      <style>{FONTS}{`.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        ::placeholder{color:${C.textFaint}} *{box-sizing:border-box}
        .rowhover:hover{background:${C.surfaceAlt}} .lift:hover{border-color:${C.primary}}
        .toastin{animation:tin .22s ease-out}@keyframes tin{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
        ::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:#D3D6E4;border-radius:5px}`}</style>
      <Toasts notes={api.notes} />

      <div style={{ width: 198, background: C.sidebar, padding: "15px 9px", flexShrink: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 7px 16px" }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: C.primary, display: "flex", alignItems: "center", justifyContent: "center" }}><Building2 size={13} color="#fff" /></div>
          <div><div style={{ fontSize: 13, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>Veridex PAS</div>
            <div style={{ fontSize: 9, color: C.sidebarText }}>Policy administration</div></div>
        </div>
        {NAV.map((g) => (
          <div key={g.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#5C6088", textTransform: "uppercase", letterSpacing: 0.7, padding: "0 8px 4px" }}>{g.label}</div>
            {g.items.map(([k, l, Icon]) => {
              const on = view === k || PARENT_OF[view] === k;
              return (
                <button key={k} onClick={() => nav(k)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: on ? C.sidebarAlt : "transparent", border: "none", borderRadius: 6, padding: "6.5px 8px", marginBottom: 1.5, color: on ? "#fff" : C.sidebarText, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                  <Icon size={13} /> {l}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "9px 22px", borderBottom: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", gap: 10, position: "relative", flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: C.textFaint, fontWeight: 600, flex: 1 }}>{TITLES[view] || TITLES[PARENT_OF[view]] || ""}</span>
          <Pill tone="gray">Veridex Demo</Pill>
          <Pill tone="indigo">Rahul Verma · Underwriter</Pill>
          <button onClick={() => setBellOpen(!bellOpen)} style={{ position: "relative", background: "none", border: `1px solid ${C.border}`, borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Bell size={14} color={C.textSoft} />
            {unread > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: C.red, color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: 999, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{unread > 99 ? "99+" : unread}</span>}
          </button>
          {bellOpen && <NotificationPanel notes={api.notes} onClose={() => setBellOpen(false)} clearNotes={api.clearNotes} />}
        </div>

        <div style={{ flex: 1, padding: "18px 22px 30px", overflowY: "auto" }}>
          <Screen view={PARENT_OF[view] || view} api={api}>
            {view === "dashboard" && <DashboardPage policies={policies} nav={nav} />}
            {view === "approvals" && <ApprovalsPage policies={policies} openRequest={openRequest} />}

            {view === "uw-desk" && <UnderwritingList policies={policies} onOpen={openFromDesk("uw-desk")} />}
            {view === "uw-detail" && P && <UnderwritingDecision p={P} api={api} decide={decide} onBack={backToDesk} />}
            {view === "issue-desk" && <IssueList policies={policies} onOpen={openFromDesk("issue-desk")} />}
            {view === "issue-detail" && P && <IssueDecision p={P} api={api} issuePolicy={issuePolicy} toggleSubjectivity={toggleSubjectivity} onBack={backToDesk} />}
            {view === "endorsement-desk" && <EndorsementList policies={policies} onOpen={openFromDesk("endorsement-desk")} raiseRequest={raiseRequest} />}
            {view === "endorsement-detail" && P && selTxn && <EndorsementDecision p={P} h={P.history.find((h) => h.id === selTxn)} api={api} decideTxn={decideTxn} onBack={backToDesk} />}
            {view === "cancellation-desk" && <CancellationList policies={policies} onOpen={openFromDesk("cancellation-desk")} raiseRequest={raiseRequest} />}
            {view === "cancel-detail" && P && selTxn && <CancellationDecision p={P} h={P.history.find((h) => h.id === selTxn)} api={api} decideCancellation={decideCancellation} onBack={backToDesk} />}
            {view === "reinstatement-desk" && <ReinstatementList policies={policies} onOpen={openFromDesk("reinstatement-desk")} raiseRequest={raiseRequest} />}
            {view === "reinstate-detail" && P && selTxn && <ReinstatementDecision p={P} h={P.history.find((h) => h.id === selTxn)} api={api} decideReinstatement={decideReinstatement} onBack={backToDesk} />}
            {view === "renewal-desk" && <RenewalList policies={policies} onOpen={openFromDesk("renewal-desk")} raiseRequest={raiseRequest} />}
            {view === "renew-detail" && P && selTxn && <RenewalDecision p={P} h={P.history.find((h) => h.id === selTxn)} api={api} decideRenewal={decideRenewal} onBack={backToDesk} />}
            {view === "servicing-desk" && <ServicingList policies={policies} onOpen={openFromDesk("servicing-desk")} />}
            {view === "servicing-detail" && P && <ServicingDecision p={P} api={api} logService={logService} onBack={backToDesk} />}

            {view === "registry" && <RegistryPage policies={policies} openPolicy={openPolicy} />}
            {view === "workbench" && <WorkbenchPage policies={policies} api={api} reverseTxn={reverseTxn} openPolicy={openPolicy} />}
            {view === "documents" && <DocumentsPage policies={policies} />}
            {view === "detail" && P && <PolicyDetailPage policy={P} onBack={() => nav("registry")} api={api} generateDoc={generateDoc} />}
            {view === "architecture" && <ArchitecturePage />}
          </Screen>
        </div>
      </div>
    </div>
  );
}
