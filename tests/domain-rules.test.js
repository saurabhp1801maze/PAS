/* Loads the browser store.js under a stub global and asserts the audit findings are closed. */
var fs = require("fs"), vm = require("vm");
var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
stub.window = stub;
vm.createContext(stub);
vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
var PAS = stub.PAS;

var fails = 0;
function check(label, ok, detail) {
  if (!ok) fails++;
  console.log((ok ? "  PASS  " : "  FAIL  ") + label + (detail ? "   " + detail : ""));
}

var book = PAS.seedPolicies();
function byId(id) { return book.find(function (p) { return p.id === id; }); }

console.log("\n=== F-01/F-02: referral gates, one submission per failure mode ===");
["SUB-2026-0041", "SUB-2026-0042", "SUB-2026-0043", "SUB-2026-0044"].forEach(function (id) {
  var p = byId(id);
  var d = PAS.underwritingDecision(p);
  var failed = d.failed.map(function (g) { return g.key; }).join("+") || "none";
  console.log("  " + id + "  " + String(p.product).padEnd(20) + " score " + String(PAS.riskScore(p)).padStart(3) +
              "  premium " + String(p.premium).padStart(8) + "  -> " + d.outcome + "  gates failed: " + failed);
});

var g41 = PAS.underwritingDecision(byId("SUB-2026-0041")).failed.map(function (g) { return g.key; });
var g42 = PAS.underwritingDecision(byId("SUB-2026-0042")).failed.map(function (g) { return g.key; });
var g43 = PAS.underwritingDecision(byId("SUB-2026-0043")).failed.map(function (g) { return g.key; });
var g44 = PAS.underwritingDecision(byId("SUB-2026-0044")).failed.map(function (g) { return g.key; });
check("0041 trips score + authority", g41.join("+") === "score+authority", g41.join("+"));
check("0042 trips score only", g42.join("+") === "score", g42.join("+"));
check("0043 trips AUTHORITY ONLY (branch was unreachable before)", g43.join("+") === "authority", g43.join("+"));
check("0044 trips information only", g44.join("+") === "information", g44.join("+"));
check("all four still Refer", ["SUB-2026-0041","SUB-2026-0042","SUB-2026-0043","SUB-2026-0044"]
  .every(function (id) { return PAS.underwritingDecision(byId(id)).outcome === "Refer"; }));

console.log("\n=== F-01: no pending referral carries a score of its own ===");
var strays = [];
book.forEach(function (p) {
  p.history.forEach(function (h) {
    if (h.status === "Pending" && h.meta && typeof h.meta.score === "number") strays.push(p.id);
    if (h.status === "Pending" && h.meta && typeof h.meta.refund === "number") strays.push(p.id + " (refund)");
  });
});
check("no pending txn duplicates a computed figure", strays.length === 0, strays.join(", "));

console.log("\n=== F-03: score is no longer a function of premium ===");
var probe = { product: "Commercial Property", premium: 50000, risk: { claimFreeYears: 1 }, history: [] };
var lo = PAS.riskScore(probe);
probe.premium = 200000000;
var hi = PAS.riskScore(probe);
check("premium x4000 leaves the score unchanged", lo === hi, lo + " -> " + hi);
var spread = book.map(function (p) { return PAS.riskScore(p); });
check("scores spread across the book, no floor pile-up",
  spread.filter(function (v) { return v === 5; }).length === 0,
  "min " + Math.min.apply(null, spread) + " max " + Math.max.apply(null, spread));

console.log("\n=== F-03: the desk's own factors now drive the number ===");
var k = byId("SUB-2026-0042");
var rf = PAS.riskFactors(k);
console.log("  " + k.holder + ": base " + rf.base + " (" + rf.product + ")");
rf.lines.forEach(function (l) {
  console.log("      " + (l.value > 0 ? "+" : "") + String(l.value).padStart(3) + "  " + l.label);
});
console.log("      = " + rf.score);
check("derivation sums to the score", rf.base + rf.lines.reduce(function (t, l) { return t + l.value; }, 0) === rf.score);
check("at-fault claims are an input", rf.lines.some(function (l) { return /At-fault/.test(l.label); }));

console.log("\n=== F-13: calendar-year rollover ===");
[["2028-02-01", "2029-02-01"], ["2027-03-01", "2028-03-01"], ["2026-09-05", "2027-09-05"], ["2028-02-29", "2029-02-28"]]
  .forEach(function (c) {
    var got = PAS.addYears(c[0], 1);
    check(c[0] + " + 1y = " + got, got === c[1], got === c[1] ? "" : "expected " + c[1]);
  });
console.log("  (old addDays(...,365) gave 2029-01-31 for the first case)");

console.log("\n=== F-17: cancellation refund computed, not stored ===");
var kar = byId("POL-2026-02233");
var pend = kar.history.find(function (h) { return h.type === "Cancellation" && h.status === "Pending"; });
var q = PAS.cancelQuote(kar, pend.meta.reason, pend.meta.initiatedBy, pend.date);
console.log("  " + kar.id + "  type " + q.type + "  unearned " + Math.round(q.gross) +
            "  penalty " + Math.round(q.penalty) + "  refund " + Math.round(q.refund));
check("refund is derived on read", typeof pend.meta.refund === "undefined");
check("cancelQuote returns real numbers, not NaN", !isNaN(q.gross) && !isNaN(q.penalty) && !isNaN(q.refund) && !isNaN(q.totalDays) && !isNaN(q.remainingDays));

console.log("\n=== Cancellation model: Type / Reason / Initiated By / Timing ===");
check("exactly 3 cancellation types (Non-Payment is a reason now, not a type)",
  JSON.stringify(Object.keys(PAS.CANCEL_TYPES).sort()) === JSON.stringify(["Flat", "Pro-Rata", "Short-Rate"]));
check("exactly 6 cancellation reasons, matching the requested set",
  JSON.stringify(Object.keys(PAS.CANCEL_REASONS).sort()) === JSON.stringify(["Fraud", "Insured Request", "Non-Payment", "Other", "Sold Vehicle/Business", "Underwriting"].sort()));
check("cancellation initiator whitelist is Insured/Broker/MGA/Carrier/System",
  JSON.stringify(PAS.CANCEL_INITIATOR_KEYS) === JSON.stringify(["Insured", "Broker/Producer", "MGA", "Carrier", "System"]));
check("PAS.INITIATORS carries entries for MGA and Carrier",
  !!PAS.INITIATORS.MGA && !!PAS.INITIATORS.Carrier);

/* Type is derived, never hand-picked: at-inception always wins; an insurer-side initiator can
   only ever downgrade a Short-Rate default to Pro-Rata, never upgrade a no-penalty reason. */
check("at inception always derives Flat, regardless of reason/initiator",
  PAS.deriveCancelType("Fraud", "Carrier", true) === "Flat" && PAS.deriveCancelType("Insured Request", "Insured", true) === "Flat");
check("Insured Request + Insured (not at inception) derives Short-Rate",
  PAS.deriveCancelType("Insured Request", "Insured", false) === "Short-Rate");
check("Insured Request + Carrier (not at inception) downgrades to Pro-Rata — insurer side never pays a penalty",
  PAS.deriveCancelType("Insured Request", "Carrier", false) === "Pro-Rata");
check("Sold Vehicle/Business + Broker/Producer derives Short-Rate",
  PAS.deriveCancelType("Sold Vehicle/Business", "Broker/Producer", false) === "Short-Rate");
check("Sold Vehicle/Business + MGA downgrades to Pro-Rata",
  PAS.deriveCancelType("Sold Vehicle/Business", "MGA", false) === "Pro-Rata");
check("Non-Payment always derives Pro-Rata (its own default), regardless of initiator",
  PAS.deriveCancelType("Non-Payment", "System", false) === "Pro-Rata" && PAS.deriveCancelType("Non-Payment", "Insured", false) === "Pro-Rata");
check("Fraud always derives Pro-Rata",
  PAS.deriveCancelType("Fraud", "Carrier", false) === "Pro-Rata");
check("Underwriting always derives Pro-Rata",
  PAS.deriveCancelType("Underwriting", "Carrier", false) === "Pro-Rata");
var noUpgrade = true;
["Non-Payment", "Fraud", "Underwriting"].forEach(function (r) {
  PAS.CANCEL_INITIATOR_KEYS.forEach(function (who) {
    if (PAS.deriveCancelType(r, who, false) === "Short-Rate") noUpgrade = false;
  });
});
check("a no-penalty reason (Non-Payment/Fraud/Underwriting) can never derive Short-Rate for any initiator", noUpgrade);

/* Notice period now lives on Reason, not Type. */
check("Non-Payment requires 15 days' notice", PAS.CANCEL_REASONS["Non-Payment"].noticeDays === 15);
check("Underwriting requires 30 days' notice", PAS.CANCEL_REASONS.Underwriting.noticeDays === 30);
check("Insured Request requires 0 days' notice", PAS.CANCEL_REASONS["Insured Request"].noticeDays === 0);

/* Timing is derived from the effective date, never stored. */
check("an effective date today or earlier is Immediate", PAS.cancelTiming(PAS.todayISO()) === "Immediate" && PAS.cancelTiming("2020-01-01") === "Immediate");
check("a future effective date is Future/Scheduled", PAS.cancelTiming(PAS.addDays(PAS.todayISO(), 30)) === "Future/Scheduled");

/* No seed record should still carry the old vocabulary — legacy lowercase reason strings, or the
   removed "Non-Payment" type value. */
var legacyReasons = ["Insured request", "Vehicle/asset sold", "Cancelled at inception", "Duplicate policy", "Non-payment", "Underwriting decision", "Regulatory / compliance"];
var staleFound = [];
book.forEach(function (p) {
  p.history.forEach(function (h) {
    if (h.type !== "Cancellation") return;
    if (h.meta && legacyReasons.indexOf(h.meta.reason) !== -1) staleFound.push(p.id + " reason=" + h.meta.reason);
    if (h.meta && h.meta.cancelType === "Non-Payment") staleFound.push(p.id + " cancelType=Non-Payment (removed type)");
    if (h.meta && h.meta.initiatedBy === "Underwriter") staleFound.push(p.id + " initiatedBy=Underwriter (not a valid cancellation initiator)");
  });
});
check("no seed cancellation record uses the pre-migration reason/type/initiator vocabulary", staleFound.length === 0, staleFound.join(", "));

/* Every seeded cancellation's stored data should be internally consistent with the live formula —
   same discipline as the underwriting score fix: nothing hand-keyed that the code could compute
   and might one day disagree with. */
var typeMismatches = [];
book.forEach(function (p) {
  p.history.forEach(function (h) {
    if (h.type !== "Cancellation" || !h.meta || !h.meta.cancelType) return;
    var atInception = h.date <= p.effectiveDate;
    var expected = PAS.deriveCancelType(h.meta.reason, h.meta.initiatedBy, atInception);
    if (expected !== h.meta.cancelType) typeMismatches.push(p.id + " stored=" + h.meta.cancelType + " derived=" + expected);
  });
});
check("every seeded cancellation's stored type matches what deriveCancelType would produce today", typeMismatches.length === 0, typeMismatches.join(", "));

console.log("\n=== decision audit trail ===");
var mem = {};
stub.sessionStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
};
PAS.resetDemoData = function () { /* don't navigate in tests */ try { stub.sessionStorage.removeItem("pas.policies.v1"); } catch (e) {} };
var seeded = PAS.seedPolicies();
stub.sessionStorage.setItem("pas.policies.v1", JSON.stringify(seeded));
var kar = PAS.getPolicy("POL-2026-02233");
var pendCx = kar.history.find(function (h) { return h.type === "Cancellation" && h.status === "Pending"; });
var note = PAS.recordHeldDecision(kar.id, pendCx.id, "Escalate", "Need senior review of the refund basis before we commit.", "Cancellation");
var stillPend = note.history.find(function (h) { return h.id === pendCx.id; });
check("escalate leaves the held cancellation pending", stillPend.status === "Pending");
check("escalate stamps user + action + comment on the held row",
  stillPend.meta.lastDecision.user === "Rahul Verma" &&
  stillPend.meta.lastDecision.action === "Escalate" &&
  /senior review/.test(stillPend.meta.lastDecision.comment));
check("trail helper returns the same audit row", PAS.decisionTrailFor(note, pendCx.id).length === 1);
var decided = PAS.decideCancellation(kar.id, pendCx.id, false, PAS.todayISO(), PAS.cancelQuote(kar, pendCx.meta.reason, pendCx.meta.initiatedBy, PAS.todayISO()), PAS.makeAudit("Decline", "Notice period not satisfied — decline and re-serve."));
var rejected = decided.history.find(function (h) { return h.id === pendCx.id; });
check("decline records the confirming actor, not a placeholder", rejected.approvedBy === "Rahul Verma");
check("decline comment is on the ledger row", /re-serve/.test(rejected.detail));
check("decision history keeps escalate then decline", rejected.meta.decisionHistory.length === 2 && rejected.meta.decisionHistory[1].action === "Decline");

console.log(fails === 0 ? "\nALL CHECKS PASSED\n" : "\n" + fails + " CHECK(S) FAILED\n");
process.exit(fails === 0 ? 0 : 1);
