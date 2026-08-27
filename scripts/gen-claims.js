/* Generates a realistic, deterministic claims book across the seeded active policies, replacing
   the 6-claim placeholder in store.js's CLAIMS_BY_ID. Six claims across 1087 policies made the
   loss-ratio "which business is profitable" dashboard analysis meaningless (overall loss ratio
   ~0.2%, no segment ever underwater) — this generates enough volume, with per-product frequency/
   severity assumptions loosely grounded in real P&C/health/life claim behavior, that loss ratio
   genuinely varies by product/state/broker: some segments profitable, some not, same as a real
   book. Deterministic (seeded by policy id, no Math.random) so it's reproducible, not fabricated
   noise — re-running this script always produces the exact same claims. */
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");

global.window = {};
eval(fs.readFileSync(path.join(ROOT, "data/policies.js"), "utf8"));
var policies = global.window.PAS_SEED_POLICIES;

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

function addDays(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }

var TODAY = "2026-08-24";

/* freq = fraction of this product's active policies that get exactly one claim.
   sevMin/sevMax = incurred as a multiple of the policy's own annual premium.
   Term Life is intentionally != the others: mortality frequency is very low, but a death
   benefit is priced across the policy's whole duration, not one year's premium, so a single
   claim always dwarfs one annual premium — that's realistic life-insurance behavior, not a
   modeling error, and it's worth surfacing exactly that way on the claims chart. */
var MODEL = {
  "Comprehensive Auto": { freq: 0.18, sevMin: 1.0, sevMax: 6.0, types: ["Collision", "Theft", "Windshield damage", "Hail damage"] },
  "Home Owners": { freq: 0.11, sevMin: 1.5, sevMax: 10.0, types: ["Water damage", "Fire", "Wind damage", "Theft"] },
  "Term Life": { freq: 0.05, sevMin: 8, sevMax: 30, types: ["Death benefit"] },
  "Commercial Property": { freq: 0.09, sevMin: 1.0, sevMax: 14.0, types: ["Fire", "Water damage", "Machinery breakdown", "Storm damage"] },
  "Marine Cargo": { freq: 0.07, sevMin: 1.0, sevMax: 13.0, types: ["Cargo damage", "Theft in transit", "Water intrusion"] },
  "Group Health": { freq: 0.32, sevMin: 0.5, sevMax: 4.4, types: ["Inpatient treatment", "Surgical procedure", "Chronic condition management"] },
};

/* Carried over verbatim from the existing hand-authored set — Ironwood Steel Works' claim is
   deliberately consistent with the "adverse loss ratio... 140%" narrative already on its
   cancellation record, so it must not be regenerated or overwritten. */
var PRESERVE = {
  "POL-2026-00988": [{ type: "Fire", status: "Closed", reportedOn: "2026-05-02", incurred: 140000, paid: 140000, reserved: 0 }],
};

var claims = {};
Object.keys(PRESERVE).forEach(function (id) { claims[id] = PRESERVE[id]; });

var active = policies.filter(function (p) { return p.status === "Active"; });
active.forEach(function (p) {
  if (claims[p.id]) return;
  var model = MODEL[p.product];
  if (!model) return;
  var roll = rngFor(p.id, "occurs");
  if (roll >= model.freq) return;

  var sevRoll = rngFor(p.id, "severity");
  var multiple = model.sevMin + sevRoll * (model.sevMax - model.sevMin);
  var incurred = Math.round((p.premium * multiple) / 10) * 10;
  if (incurred < 50) incurred = 50;

  var typeIdx = Math.floor(rngFor(p.id, "type") * model.types.length);
  var type = model.types[Math.min(typeIdx, model.types.length - 1)];

  var windowStart = p.effectiveDate > "2025-06-01" ? p.effectiveDate : "2025-06-01";
  var span = Math.max(1, daysBetween(windowStart, TODAY));
  var reportedOn = addDays(windowStart, Math.floor(rngFor(p.id, "date") * span));
  if (reportedOn > TODAY) reportedOn = TODAY;

  var openRoll = rngFor(p.id, "open");
  var isOpen = openRoll < 0.22;
  var paidFrac = isOpen ? 0.15 + rngFor(p.id, "paidfrac") * 0.45 : 1;
  var paid = Math.round((incurred * paidFrac) / 10) * 10;
  var reserved = isOpen ? incurred - paid : 0;

  claims[p.id] = [{ type: type, status: isOpen ? "Open" : "Closed", reportedOn: reportedOn, incurred: incurred, paid: paid, reserved: reserved }];
});

/* ---- report, so the generation is auditable before it's wired in ---- */
var all = [];
Object.keys(claims).forEach(function (id) {
  var p = policies.find(function (x) { return x.id === id; });
  claims[id].forEach(function (c) { all.push({ p: p, c: c }); });
});
var byProduct = {};
all.forEach(function (x) {
  var k = x.p.product;
  byProduct[k] = byProduct[k] || { n: 0, incurred: 0, premium: 0 };
  byProduct[k].n++; byProduct[k].incurred += x.c.incurred;
});
active.forEach(function (p) { byProduct[p.product] = byProduct[p.product] || { n: 0, incurred: 0, premium: 0 }; byProduct[p.product].premium += p.premium; });
console.log("total claims:", all.length, "of", active.length, "active policies");
Object.keys(byProduct).forEach(function (k) {
  var b = byProduct[k];
  console.log("  " + k.padEnd(20) + b.n + " claims, loss ratio " + (b.premium ? Math.round((b.incurred / b.premium) * 1000) / 10 : 0) + "%");
});
var totalIncurred = all.reduce(function (s, x) { return s + x.c.incurred; }, 0);
var totalPremium = active.reduce(function (s, p) { return s + p.premium; }, 0);
console.log("overall loss ratio:", Math.round((totalIncurred / totalPremium) * 1000) / 10 + "%");

/* ---- emit as a JS object literal, sorted by policy id for a stable diff ---- */
var ids = Object.keys(claims).sort();
var lines = ["  var CLAIMS_BY_ID = {"];
ids.forEach(function (id) {
  var entries = claims[id].map(function (c) {
    return '{ type: ' + JSON.stringify(c.type) + ', status: ' + JSON.stringify(c.status) + ', reportedOn: ' + JSON.stringify(c.reportedOn) + ', incurred: ' + c.incurred + ', paid: ' + c.paid + ', reserved: ' + c.reserved + ' }';
  });
  lines.push('    ' + JSON.stringify(id) + ': [' + entries.join(", ") + '],');
});
lines.push("  };");
fs.writeFileSync(path.join(ROOT, "scripts", ".claims-generated.js"), lines.join("\n") + "\n");
console.log("\nwrote scripts/.claims-generated.js — " + ids.length + " policies with at least one claim");
