/* Generates a deterministic claims book across the seeded policies, replacing CLAIMS_BY_ID in
   store.js. Run with `node scripts/gen-claims.js` and paste nothing — it rewrites the block in
   store.js itself (see the --write flag at the bottom) and prints a reconciliation report.

   ---- Why this is generated rather than hand-typed ----
   Six hand-written claims across 1,000+ policies made every loss-ratio breakdown meaningless:
   no segment ever differed from any other, so "which business is profitable" had no answer.
   This produces enough volume, with per-line frequency and severity assumptions, that loss ratio
   genuinely varies by product, state and broker the way a real book does.

   ---- The exposure model (this is the part that has to be right) ----
   Frequency scales with EARNED exposure; severity does not. A policy two months into its term
   has had two months of chances to have a fire, but if it burns, it burns for the same amount as
   one eleven months in. That gives:

       expected incurred = (freq x earnedFraction) x severity x premium
       earned premium    = earnedFraction x premium
       loss ratio        = freq x severity          <-- earnedFraction cancels

   So each line's loss ratio is a stable, intended property of its own frequency/severity pair,
   not an accident of how far through their terms the policies happen to be. The previous version
   sized severity against full ANNUAL premium regardless of exposure, which made the resulting
   ratio drift with the calendar and mean nothing.

   Deterministic: seeded off each policy id, never Math.random, so re-running always produces the
   identical book and a diff shows only what the assumptions changed. */
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");

global.window = {};
eval(fs.readFileSync(path.join(ROOT, "data/policies.js"), "utf8"));
var policies = global.window.PAS_SEED_POLICIES;

var TODAY = "2026-08-20";

function hashStr(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(id, salt) { return mulberry32(hashStr(id + "::" + salt))(); }
/* A repeatable draw stream for one policy, so a policy that has several claims can draw
   independent severities/dates for each without them all collapsing to the same value. */
function streamFor(id, salt) { return mulberry32(hashStr(id + "::" + salt)); }
/* Poisson count via inverse CDF. Claim COUNT is drawn rather than a single yes/no coin flip:
   a policy in its third term has had three years of chances and can genuinely have had more
   than one claim. A Bernoulli trial would have to clamp its probability at 1 for long-lived
   policies, which would quietly bias their loss ratio downward — exactly the kind of silent
   distortion this whole exercise is about removing. */
function poisson(lambda, rand) {
  if (lambda <= 0) return 0;
  var L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L && k < 50);
  return k - 1;
}

function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
function addDays(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* Must stay identical to PAS.earnedFraction in store.js — asserted by the reconciliation test. */
function earnedFraction(p) {
  var totalDays = Math.max(1, daysBetween(p.effectiveDate, p.expirationDate));
  var elapsed = daysBetween(p.effectiveDate, TODAY);
  var thisTerm = Math.max(0, Math.min(1, elapsed / totalDays));
  return Math.max(0, (Number(p.termNumber) || 1) - 1) + thisTerm;
}

/* targetLR is the loss ratio this line is MEANT to run at, and freq x meanSeverity reproduces it
   (see the header). The spread between lines is the point: Comprehensive Auto is deliberately
   unprofitable, Marine Cargo and Term Life are deliberately strong, so the dashboard's
   "which is loss, where profit" panel has a real answer rather than noise.
   sevMin/sevMax are multiples of ANNUAL premium; their midpoint is meanSeverity.

   Frequencies are deliberately high enough (and severities correspondingly modest) that each
   line carries enough claims for its realized ratio to land near its target. Very low frequency
   with very high severity is more lifelike per-claim, but across only ~150 policies a line it
   produces 2-3 claims whose realized ratio is pure noise — a dashboard showing Term Life at 2.5%
   one run and 90% the next is worse than useless for the "which line is profitable" question
   this data exists to answer. */
var MODEL = {
  "Comprehensive Auto":  { targetLR: 0.95, freq: 0.55, spread: 0.45, types: ["Collision", "Theft", "Windshield damage", "Hail damage"] },
  "Home Owners":         { targetLR: 0.62, freq: 0.45, spread: 0.45, types: ["Water damage", "Fire", "Wind damage", "Theft"] },
  "Commercial Property": { targetLR: 0.52, freq: 0.35, spread: 0.45, types: ["Fire", "Water damage", "Machinery breakdown", "Storm damage"] },
  "Marine Cargo":        { targetLR: 0.38, freq: 0.30, spread: 0.45, types: ["Cargo damage", "Theft in transit", "Water intrusion"] },
  "Group Health":        { targetLR: 0.70, freq: 0.60, spread: 0.45, types: ["Inpatient treatment", "Surgical procedure", "Chronic condition management"] },
  "Term Life":           { targetLR: 0.30, freq: 0.35, spread: 0.45, types: ["Death benefit"] },
};

/* Ironwood Steel Works is the one hand-pinned record. Its ledger already carries a cancellation
   whose own detail text reads "adverse loss ratio... 140% over two terms", so its claim is fixed
   at exactly 140% of the premium earned across those two COMPLETED terms (2 x $100,000 x 1.4).
   Generated numbers must never overwrite it, or the dashboard would contradict a narrative
   sitting in plain sight on the same policy's ledger. */
var IRONWOOD_ID = "POL-2026-00988";
var PRESERVE = {};
(function () {
  var p = policies.find(function (x) { return x.id === IRONWOOD_ID; });
  if (!p) return;
  var completedTerms = Math.max(1, (Number(p.termNumber) || 1) - 1);
  var incurred = Math.round(p.premium * completedTerms * 1.4);
  PRESERVE[IRONWOOD_ID] = [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: incurred, paid: incurred, reserved: 0 }];
})();

/* Claims are generated for every policy that has actually been on risk — including cancelled and
   expired ones. Restricting them to Active policies (the previous version) implied a book where
   no policy that ever left had made a claim, which is both unrealistic and makes loss-by-status
   analysis impossible. Referred/Declined/Bound are excluded: never on risk, so never a claim. */
var ON_RISK = { Active: 1, Cancelled: 1, Expired: 1, "Non-renewed": 1 };

var claims = {};
Object.keys(PRESERVE).forEach(function (id) { claims[id] = PRESERVE[id]; });

var exposed = policies.filter(function (p) { return ON_RISK[p.status]; });
exposed.forEach(function (p) {
  if (claims[p.id]) return;
  var model = MODEL[p.product];
  if (!model) return;

  var e = earnedFraction(p);
  if (e <= 0) return; /* incepted but not yet on risk — cannot have had a claim */

  /* Expected claim COUNT scales with exposure; severity does not. See the header derivation. */
  var count = poisson(model.freq * e, streamFor(p.id, "count"));
  if (count < 1) return;

  var meanSeverity = model.targetLR / model.freq;
  var sevMin = meanSeverity * (1 - model.spread);
  var sevMax = meanSeverity * (1 + model.spread);

  var sevRand = streamFor(p.id, "severity");
  var dateRand = streamFor(p.id, "date");
  var typeRand = streamFor(p.id, "type");
  var openRand = streamFor(p.id, "open");

  /* Reported somewhere inside the window the policy was actually on risk. */
  var windowStart = p.effectiveDate > "2025-06-01" ? p.effectiveDate : "2025-06-01";
  var windowEnd = p.expirationDate < TODAY ? p.expirationDate : TODAY;
  if (windowEnd < windowStart) windowEnd = windowStart;
  var span = Math.max(1, daysBetween(windowStart, windowEnd));

  var list = [];
  for (var i = 0; i < count; i++) {
    var multiple = sevMin + sevRand() * (sevMax - sevMin);
    var incurred = Math.max(50, Math.round((p.premium * multiple) / 10) * 10);
    var typeIdx = Math.floor(typeRand() * model.types.length);
    var type = model.types[Math.min(typeIdx, model.types.length - 1)];
    var reportedOn = addDays(windowStart, Math.floor(dateRand() * span));

    /* Open claims still carry a reserve; closed ones are fully paid. */
    var isOpen = openRand() < 0.22;
    var paidFrac = isOpen ? 0.15 + sevRand() * 0.45 : 1;
    var paid = Math.round((incurred * paidFrac) / 10) * 10;
    var reserved = isOpen ? incurred - paid : 0;
    list.push({ type: type, status: isOpen ? "Open" : "Closed", reportedOn: reportedOn, incurred: incurred, paid: paid, reserved: reserved });
  }
  /* Oldest first, so a policy's claim list reads chronologically like its ledger does. */
  list.sort(function (a, b) { return a.reportedOn < b.reportedOn ? -1 : 1; });
  claims[p.id] = list;
});

/* ---------------- reconciliation report ---------------- */
var COMMISSION_RATES = {
  "Commercial Property": 0.15, "Comprehensive Auto": 0.12, "Marine Cargo": 0.15,
  "Group Health": 0.10, "Home Owners": 0.18, "Term Life": 0.20,
};
function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

var agg = {};
exposed.forEach(function (p) {
  var k = p.product;
  agg[k] = agg[k] || { earned: 0, incurred: 0, n: 0, claims: 0, commission: 0 };
  var e = earnedFraction(p) * p.premium;
  agg[k].earned += e;
  agg[k].commission += e * (COMMISSION_RATES[k] || 0.15);
  agg[k].n++;
  (claims[p.id] || []).forEach(function (c) { agg[k].incurred += c.incurred; agg[k].claims++; });
});

var totE = 0, totI = 0, totC = 0, totN = 0;
console.log("line".padEnd(21) + "policies".padStart(9) + "claims".padStart(8) + "earned".padStart(14) + "incurred".padStart(14) + "  loss%  target%");
Object.keys(agg).sort().forEach(function (k) {
  var a = agg[k];
  totE += a.earned; totI += a.incurred; totC += a.commission; totN += a.claims;
  var lr = a.earned ? a.incurred / a.earned : 0;
  var target = (MODEL[k] || {}).targetLR || 0;
  console.log(k.padEnd(21) + String(a.n).padStart(9) + String(a.claims).padStart(8) +
    fmt(a.earned).padStart(14) + fmt(a.incurred).padStart(14) +
    (lr * 100).toFixed(1).padStart(7) + (target * 100).toFixed(0).padStart(9));
});
var LR = totI / totE, ER = totC / totE;
console.log("");
console.log("total claims       : " + totN + " across " + exposed.length + " on-risk policies");
console.log("earned premium     : " + fmt(totE));
console.log("incurred claims    : " + fmt(totI));
console.log("commission (acq)   : " + fmt(totC));
console.log("LOSS RATIO         : " + (LR * 100).toFixed(1) + "%");
console.log("EXPENSE RATIO      : " + (ER * 100).toFixed(1) + "%");
console.log("COMBINED RATIO     : " + ((LR + ER) * 100).toFixed(1) + "%  " + (LR + ER < 1 ? "(underwriting profit)" : "(underwriting LOSS)"));
console.log("u/w result         : " + fmt(totE - totI - totC));

/* ---------------- emit ---------------- */
var ids = Object.keys(claims).sort();
var lines = ["var CLAIMS_BY_ID = {"];
ids.forEach(function (id) {
  var entries = claims[id].map(function (c) {
    return "{ type: " + JSON.stringify(c.type) + ", status: " + JSON.stringify(c.status) +
      ", reportedOn: " + JSON.stringify(c.reportedOn) + ", incurred: " + c.incurred +
      ", paid: " + c.paid + ", reserved: " + c.reserved + " }";
  });
  lines.push("    " + JSON.stringify(id) + ": [" + entries.join(", ") + "],");
});
lines.push("  };");
var block = lines.join("\n");

var storePath = path.join(ROOT, "assets/js/store.js");
var store = fs.readFileSync(storePath, "utf8");
var blockRe = /^[ \t]*var CLAIMS_BY_ID = \{[\s\S]*?\n[ \t]*\};/m;
if (!blockRe.test(store)) {
  console.error("\nCOULD NOT FIND the CLAIMS_BY_ID block in store.js — nothing written.");
  process.exit(1);
}
fs.writeFileSync(storePath, store.replace(blockRe, block));
console.log("\nwrote " + ids.length + " policies' claims into assets/js/store.js");
