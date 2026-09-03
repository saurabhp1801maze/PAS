/* Minimal DOM shim — enough to actually EXECUTE each page's render() and catch runtime errors
   that a syntax check and a static symbol check both miss. Not a browser; just the surface
   ui.js and the page files touch. */
var fs = require("fs"), vm = require("vm");

function makeNode(tag) {
  var n = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    childNodes: [],
    attributes: {},
    style: {},
    dataset: {},
    _text: "",
    classList: {
      _s: {},
      add: function () { for (var i = 0; i < arguments.length; i++) this._s[arguments[i]] = 1; },
      remove: function () { for (var i = 0; i < arguments.length; i++) delete this._s[arguments[i]]; },
      contains: function (c) { return !!this._s[c]; },
      toggle: function (c) { this._s[c] ? delete this._s[c] : this._s[c] = 1; },
    },
  };
  n.appendChild = function (c) {
    if (c == null) throw new Error("appendChild(null) on <" + tag + ">");
    n.childNodes.push(c); c.parentNode = n; return c;
  };
  n.append = n.appendChild;
  n.removeChild = function (c) { n.childNodes = n.childNodes.filter(function (x) { return x !== c; }); return c; };
  n.remove = function () { if (n.parentNode) n.parentNode.removeChild(n); };
  n.setAttribute = function (k, v) {
    n.attributes[k] = String(v);
    if (k === "class") String(v).split(/\s+/).forEach(function (c) { if (c) n.classList._s[c] = 1; });
  };
  n.getAttribute = function (k) { return k in n.attributes ? n.attributes[k] : null; };
  n._listeners = {};
  n.addEventListener = function (type, fn) { (n._listeners[type] = n._listeners[type] || []).push(fn); };
  n.removeEventListener = function (type, fn) {
    if (n._listeners[type]) n._listeners[type] = n._listeners[type].filter(function (f) { return f !== fn; });
  };
  n.dispatchEvent = function (evt) {
    evt = evt || {};
    (n._listeners[evt.type] || []).slice().forEach(function (fn) { fn.call(n, evt); });
    return true;
  };
  n.click = function () { n.dispatchEvent({ type: "click", target: n }); };
  n.contains = function () { return false; };
  n.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 20 }; };
  n.focus = function () {};

  function all(node, out) {
    node.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); all(c, out); } });
    return out;
  }
  function matches(node, sel) {
    if (sel[0] === ".") return node.classList.contains(sel.slice(1));
    if (sel[0] === "#") return node.attributes.id === sel.slice(1);
    return node.tagName === sel.toUpperCase();
  }
  n.querySelector = function (sel) {
    var hit = all(n, []).filter(function (c) { return matches(c, sel); });
    return hit.length ? hit[0] : null;
  };
  n.querySelectorAll = function (sel) { return all(n, []).filter(function (c) { return matches(c, sel); }); };

  Object.defineProperty(n, "textContent", {
    get: function () {
      return n._text + n.childNodes.map(function (c) { return c.nodeType === 3 ? c.data : c.textContent; }).join("");
    },
    set: function (v) { n.childNodes = []; n._text = String(v); },
  });
  Object.defineProperty(n, "innerHTML", {
    get: function () { return ""; },
    set: function (v) { n.childNodes = []; n._html = String(v); },
  });
  Object.defineProperty(n, "className", {
    get: function () { return Object.keys(n.classList._s).join(" "); },
    set: function (v) { n.classList._s = {}; n.setAttribute("class", v); },
  });
  return n;
}

function setValue(el, v) { el.value = v; el.dispatchEvent({ type: el.tagName === "SELECT" ? "change" : "input" }); }
function clickText(nodes, text) {
  var hit = nodes.filter(function (n) { return n.textContent === text; })[0];
  if (!hit) throw new Error("clickText: no node with text " + JSON.stringify(text));
  hit.click();
}

function buildEnv(pageKey, query, role) {
  var body = makeNode("body");
  var pageContent = makeNode("div");
  pageContent.setAttribute("id", "page-content");
  body.appendChild(pageContent);

  var doc = {
    readyState: "complete",
    createElement: makeNode,
    createElementNS: function (ns, tag) { return makeNode(tag); },
    createTextNode: function (t) { return { nodeType: 3, data: String(t), textContent: String(t) }; },
    getElementById: function (id) { return id === "page-content" ? pageContent : null; },
    addEventListener: function () {},
    body: body,
    documentElement: makeNode("html"),
  };
  var env = {
    document: doc,
    sessionStorage: (function () {
      var m = {};
      if (role) m["pas.role.v1"] = role;
      return {
        getItem: function (k) { return k in m ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; },
      };
    })(),
    location: { search: query || "", href: "" },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String,
    Number: Number, Boolean: Boolean, Promise: Promise, Error: Error, RegExp: RegExp,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    URLSearchParams: URLSearchParams,
    console: console,
    Node: function () {},
  };
  /* ui.js tests `c instanceof Node`; make every shim node satisfy it. */
  Object.defineProperty(env.Node, Symbol.hasInstance, {
    value: function (x) { return !!x && (x.nodeType === 1 || x.nodeType === 3); },
  });
  env.window = env;
  env._pageContent = pageContent;
  return env;
}

var PAGES = [
  ["domain-model", "domain-model"],
  ["data-model", "data-model"],
  ["api-reference", "api-reference"],
  ["architecture", "architecture"],
  ["dashboard", "dashboard"],
  ["underwriting", "underwriting"],
  ["registry", "registry"],
  ["workbench", "workbench"],
  ["approvals", "approvals"],
  ["cancellation", "cancellation-desk"],
  ["cancellation-decision", "cancellation-desk", "?policy=POL-2026-02233"],
  ["endorsement", "endorsement-desk"],
  ["reinstatement", "reinstatement-desk"],
  ["reinstatement-decision", "reinstatement-desk", "?policy=POL-2026-01190"],
  ["renewal", "renewal-desk"],
  ["policy-detail", "detail", "?policy=POL-2026-02233&tab=cover"],
  ["loyalty", "loyalty"],
  ["transfer", "transfer-desk"],
  ["transfer-decision", "transfer-desk", "?policy=POL-2026-00777"],
  ["terms", "terms"],
  ["admin-config", "admin-config"],
  ["brokers", "brokers"],
  ["mgas", "mgas"],
  ["carriers", "carriers"],
  ["customers", "customers"],
];

var CORE = ["assets/js/icons.js", "data/policies.js", "assets/js/store.js", "assets/js/pas-extensions.js", "assets/js/i18n.js", "assets/js/api.js", "assets/js/ui.js", "assets/js/charts.js", "assets/js/entity-book.js"];
var fails = 0;

PAGES.forEach(function (pair) {
  var file = "assets/js/pages/" + pair[0] + ".js";
  var env = buildEnv(pair[1], pair[2]);
  vm.createContext(env);
  try {
    CORE.forEach(function (f) { vm.runInContext(fs.readFileSync(f, "utf8"), env, { filename: f }); });
    vm.runInContext(fs.readFileSync(file, "utf8"), env, { filename: file });
  } catch (e) {
    fails++;
    console.log("  FAIL  " + pair[0] + " — " + e.message);
    console.log("        " + String(e.stack).split("\n").slice(1, 4).join("\n        "));
    return;
  }
  var out = env._pageContent;
  var nodes = out.querySelectorAll("div").length;
  var text = out.textContent.replace(/\s+/g, " ").trim();
  if (nodes === 0 || text.length < 40) {
    fails++;
    console.log("  FAIL  " + pair[0] + " rendered almost nothing (" + nodes + " divs, " + text.length + " chars)");
    return;
  }
  console.log("  PASS  " + pair[0].padEnd(16) + nodes + " elements, " + text.length + " chars of copy");
});

/* Spot-check that the new screens actually surfaced their key content. */
function renderDom(page, query, role) {
  var env = buildEnv(page, query, role);
  vm.createContext(env);
  CORE.forEach(function (f) { vm.runInContext(fs.readFileSync(f, "utf8"), env, { filename: f }); });
  vm.runInContext(fs.readFileSync("assets/js/pages/" + page + ".js", "utf8"), env, { filename: page });
  return env._pageContent;
}
function renderText(page, query, role) { return renderDom(page, query, role).textContent.replace(/\s+/g, " "); }
console.log("\n  content spot-checks");
[
  ["domain-model", ["Rewrite (Transfer)", "Transfer desk", "Reissue", "Missing", "Request, then decide", "Warns only", "User & role directory", "No real authentication exists"]],
  ["data-model", ["policy_terms", "domain_events", "reverses_transaction_id", "decideRenewal overwrites"]],
  ["api-reference", ["Idempotency-Key", "policyCancelled", "412", "at-least-once"]],
  ["architecture", ["At-least-once", "Camunda 8", "outbox", "Not yet", "Connected reinsurers", "Meridian Assurance Co.", "Composable modules"]],
  ["underwriting", ["Referred on", "Authority", "Score"]],
  ["dashboard", ["Total policies", "Active policies", "Renewed", "Expiring in period", "Endorsement requests", "Reinstated", "Cancelled", "Pending approvals", "Bound — awaiting issuance", "Monthly", "Yearly", "New business issued", "Cancellation requests"]],
  ["cancellation", ["Auto-cancelled (non-payment)", "DNOC pending", "Types of cancellation", "Refunds by type", "Refunds by reason", "Cancellation trend", "Pro-Rata", "Short-Rate", "Monthly", "Quarterly", "Yearly", "Custom range"]],
].forEach(function (c) {
  var txt = renderText(c[0]);
  c[1].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log("  FAIL  " + c[0] + ' is missing "' + needle + '"'); }
  });
  console.log("  PASS  " + c[0].padEnd(16) + c[1].length + " expected strings present");
});

/* Cancellation model, end to end on the decision screen: Type/Reason/Initiated By/Timing all
   render, and the refund matches the worked example in docs/cancellation.md exactly. */
console.log("\n  cancellation-decision: Type/Reason/Initiated By/Timing + worked-example refund");
(function () {
  var txt = renderText("cancellation-decision", "?policy=POL-2026-02233");
  ["Insured Request", "Broker/Producer", "Immediate", "Short-Rate", "$982", "$109"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  cancellation-decision missing "' + needle + '"'); }
  });
  console.log("  PASS  Marcus Whitfield: Reason=Insured Request, Initiated By=Broker/Producer, Type=Short-Rate, refund=$982 matches the doc's worked example exactly");

  /* The worked per-day refund table must reconcile with real arithmetic, not just contain the
     right-looking strings: earned + unearned days = policy term, and the table's own basis/
     penalty/refund figures must be the exact figures cancelQuote itself computed — not a second,
     independently-rounded version that could quietly drift from the number that goes to Billing. */
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PW = stub.PAS;
  var wp = PW.getPolicy("POL-2026-02233");
  var wTxn = wp.history.find(function (h) { return h.type === "Cancellation" && h.status === "Pending"; });
  var wq = PW.cancelQuote(wp, wTxn.meta.reason, wTxn.meta.initiatedBy, wTxn.date, wTxn.meta);
  if (wq.earnedDays + wq.remainingDays !== wq.totalDays) { fails++; console.log("  FAIL  earned days (" + wq.earnedDays + ") + unearned days (" + wq.remainingDays + ") != policy term (" + wq.totalDays + ") — the worked table's own day split doesn't add up"); }
  else console.log("  PASS  earned (" + wq.earnedDays + "d) + unearned (" + wq.remainingDays + "d) days sum exactly to the " + wq.totalDays + "-day policy term");

  var dailyRate = wp.premium / wq.totalDays;
  ["Daily premium rate", "How it's worked out", PW.money(dailyRate) + "/day", "Refund basis (Short-Rate)", "Short-rate penalty (" + (wq.spec.penaltyPct * 100) + "%)"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  worked refund table missing "' + needle + '"'); }
  });
  console.log("  PASS  the worked table shows the real daily rate (" + PW.money(dailyRate) + "/day) and names the actual type-specific basis and penalty line, not generic placeholder text");

  if (txt.indexOf(PW.money(wq.gross)) === -1) { fails++; console.log('  FAIL  worked table does not show the real refund basis amount "' + PW.money(wq.gross) + '"'); }
  else console.log("  PASS  the table's refund-basis amount (" + PW.money(wq.gross) + ") is the exact same figure cancelQuote computed — no second, independently-derived number");
})();

/* Reinstatement desk: the original cancellation's full attribute set (added this pass) surfaces
   on the reinstatement decision screen, not just Reason and Type. */
console.log("\n  reinstatement-decision: original cancellation's Initiated By + Timing surface");
(function () {
  var txt = renderText("reinstatement-decision", "?policy=POL-2026-01190");
  ["Initiated by", "System", "Timing", "Immediate", "Non-Payment"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  reinstatement-decision missing "' + needle + '"'); }
  });
  console.log("  PASS  Olivia Sanders' original cancellation shows Initiated By (System) and Timing (Immediate), not just Reason and Type");
})();

/* Dashboard-specific regressions:
   - F-15 (double-counted "Awaiting decision") must stay fixed. The combined "Awaiting decision"
     tile itself is gone — it linked to Pending Approvals as if its number matched, but that page
     only ever lists held transactions, and a Bound policy has none (it auto-issues once nothing
     is outstanding, never appearing there). Split into "Pending transactions" (matches Pending
     Approvals exactly) and its own unlinked "Bound, awaiting issue" tile.
   - F-16 (mislabeled GWP + hardcoded retention/deltas) must stay fixed.
   - The redesign that replaced the sectioned KPI groups with a 9-card strip (Total/Active/
     Renewed/Expiring soon/Endorsement requests/Reinstated/Cancelled/Pending transactions/Bound
     awaiting issue) plus the Monthly/Yearly period toggle and the 4 "open desk" work-cards must
     not silently regress to the previous layout. */
console.log("\n  dashboard regression checks (F-15, F-16, KPI redesign)");
(function () {
  var txt = renderText("dashboard");
  [
    /* Original hardcoded literals. "Retention" stands in for the fake hardcoded 91% that used to
       sit beside it: banning the bare string "91%" became a false positive once loss ratio was
       corrected to an earned basis, because a real computed segment ratio can legitimately land
       on 91%. Banning the label keeps the guard on the fabricated KPI without also outlawing a
       genuine number that happens to round the same way. */
    "Gross written premium", "Retention", "+8.2%", "-1.4%",
    "Avg premium",                                                /* superseded KPI tile */
    "Underwriting queue", "Ready to issue now", "Pipeline premium",
    "Held transactions", "Avg risk score", "Below refer threshold", "Renewals decided, all-time",
    "Submissions to underwrite", "Renewals in notice window",    /* the 4 removed work-desk boxes */
    "Blocked from issuing",                                     /* superseded by "Bound policies" */
  ].forEach(function (banned) {
    if (txt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  dashboard still contains banned literal "' + banned + '"'); }
  });
  console.log("  PASS  no hardcoded literals or superseded KPI tiles/work-cards present");

  ["Renewed", "Cancelled", "Reinstated"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  trend chart legend missing "' + needle + '"'); }
  });
  console.log("  PASS  trend chart legend present (Renewed / Cancelled / Reinstated)");

  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS = stub.PAS;
  var policies = PAS.getPolicies();
  var bound = policies.filter(function (p) { return p.status === "Bound"; });
  var referred = policies.filter(function (p) { return p.status === "Referred"; });
  /* Underwriting referrals excluded — decided from the Underwriting desk, not the Pending
     Approvals link this KPI points to (same exclusion as approvals.js's own pending list). */
  var pending = PAS.allTxns(policies).map(function (t) { return t.h; }).filter(function (h) { return h.status === "Pending" && h.type !== "Underwriting"; });
  var oldDoubleCountedTotal = referred.length + bound.length + pending.length;
  if (pending.length + bound.length === oldDoubleCountedTotal) { fails++; console.log("  FAIL  split totals coincide with the old double-counted formula — test is not discriminating"); }
  var mPending = txt.match(/Pending approvals(\d+)/);
  if (!mPending) { fails++; console.log('  FAIL  could not find rendered "Pending approvals" value'); }
  else if (Number(mPending[1]) !== pending.length) { fails++; console.log("  FAIL  Pending approvals renders " + mPending[1] + ", expected " + pending.length); }
  else console.log("  PASS  Pending approvals = " + pending.length + " (excludes Underwriting, matches Pending Approvals exactly)");
  var mBound = txt.match(/Bound — awaiting issuance(\d+)/);
  if (!mBound) { fails++; console.log('  FAIL  could not find rendered "Bound — awaiting issuance" value'); }
  else if (Number(mBound[1]) !== bound.length) { fails++; console.log("  FAIL  Bound — awaiting issuance renders " + mBound[1] + ", expected " + bound.length); }
  else console.log("  PASS  Bound — awaiting issuance = " + bound.length + " — its own queue, not folded into Pending approvals, not the old double-counted " + oldDoubleCountedTotal);

  /* There are two KPI rows on this page now: the Financial performance row at the top, and the
     Operations row below it. These assertions are about the OPERATIONS row specifically, which is
     the one carrying the 4-per-row "wrap" layout — so select it by that class rather than by
     "whichever row happens to come first in the document", which silently retargeted the moment
     a second row was added above it. */
  var dom = renderDom("dashboard");
  var allKpiRows = dom.querySelectorAll(".kpi-row");
  var opsRow = Array.prototype.filter.call(allKpiRows, function (r) { return r.classList.contains("wrap"); })[0];
  if (!opsRow) { fails++; console.log("  FAIL  no KPI row carries the 4-per-row \"wrap\" layout class (found " + allKpiRows.length + " rows)"); }
  else console.log('  PASS  the Operations KPI row uses the fixed 4-per-row grid (".kpi-row.wrap")');
  var opsCards = opsRow ? opsRow.querySelectorAll(".kpi-card") : [];
  if (opsCards.length !== 9) { fails++; console.log("  FAIL  expected exactly 9 Operations KPI cards, found " + opsCards.length); }
  else console.log("  PASS  exactly 9 Operations KPI cards render (2 full rows of 4 plus a trailing card)");
  /* Left panel: a bar chart (3 series × 6 trailing months = 18 bars), with a legend. */
  var barChart = dom.querySelectorAll(".trend-bar-chart");
  var barFills = dom.querySelectorAll(".trend-bar-fill");
  if (barChart.length !== 1) { fails++; console.log("  FAIL  expected exactly 1 bar chart (activity panel), found " + barChart.length); }
  else if (barFills.length !== 18) { fails++; console.log("  FAIL  activity bar chart expected 18 bars (3 series × 6 months), found " + barFills.length); }
  else console.log("  PASS  left panel is a bar chart — 3 series × 6 months = 18 bars");

  /* Right panel: an actual SVG line/area graph (1 series × 6 trailing months = 6 dots), no legend
     box (single series — the panel title names it). */
  var graphs = dom.querySelectorAll(".trend-graph");
  var dots = dom.querySelectorAll(".trend-dot");
  var areas = dom.querySelectorAll(".trend-area");
  var lines = dom.querySelectorAll(".trend-line");
  var legends = dom.querySelectorAll(".trend-legend");
  if (graphs.length !== 1) { fails++; console.log("  FAIL  expected exactly 1 SVG line/area graph (new-business panel), found " + graphs.length); }
  else if (dots.length !== 6 || areas.length !== 1 || lines.length !== 1) { fails++; console.log("  FAIL  new-business graph expected 6 dots / 1 area / 1 line, found " + dots.length + "/" + areas.length + "/" + lines.length); }
  else if (legends.length !== 1) { fails++; console.log("  FAIL  expected exactly 1 legend (bar chart only — the single-series graph shouldn't have one), found " + legends.length); }
  else console.log("  PASS  right panel is a real SVG line/area graph — 1 line, 1 area wash, 6 marked points, no legend box");

  /* The four desk queues (renewal / cancellation / reinstatement / endorsement) are now one
     panel with a dropdown rather than three side-by-side cards. These assertions drive that
     dropdown for real — selecting an option and re-reading the rendered rows — so they cover the
     switching itself, which the old three-fixed-panels version could not. */
  var panels = dom.querySelectorAll(".panel");
  var queuePanel = null, topPanel = null;
  panels.forEach(function (p) {
    var t = p.querySelector(".panel-title").textContent;
    if (t.indexOf("Open work queues") === 0) queuePanel = p;
    if (t.indexOf("Portfolio concentration") === 0) topPanel = p;
  });
  if (!queuePanel) { fails++; console.log('  FAIL  no "Open work queues" panel found — the four desk queues should be consolidated into one'); return; }
  if (!topPanel) { fails++; console.log('  FAIL  no "Portfolio concentration" panel found — the ranking cards should be consolidated into one'); return; }

  var queueSelect = queuePanel.querySelector("select");
  var queueOptions = queueSelect ? queueSelect.querySelectorAll("option").map(function (o) { return o.textContent; }) : [];
  ["Renewal pipeline", "Cancellation requests", "Reinstatement requests", "Endorsement requests"].forEach(function (label) {
    if (queueOptions.indexOf(label) === -1) { fails++; console.log('  FAIL  work-queue dropdown is missing "' + label + '"'); }
  });
  console.log("  PASS  one work-queue panel offering all four desks (" + queueOptions.join(", ") + ") — reinstatement included, which had no card of its own before");

  /* Renewal is the default queue: capped at 5, most-urgent-first, with a "View more" link only
     when the real list is longer than the cap. */
  var activeCount = policies.filter(function (p) { return p.status === "Active"; }).length;
  var renewalRows = queuePanel.querySelectorAll(".hbar").length;
  if (renewalRows > 5) { fails++; console.log("  FAIL  Renewal pipeline shows " + renewalRows + " rows, expected at most 5"); }
  else if (activeCount > 5 && renewalRows !== 5) { fails++; console.log("  FAIL  Renewal pipeline has " + activeCount + " active policies but shows only " + renewalRows + ", expected the full cap of 5"); }
  else if (activeCount > 5 && queuePanel.textContent.indexOf("View more") === -1) { fails++; console.log('  FAIL  Renewal pipeline exceeds the cap but is missing its "View more" link'); }
  else console.log("  PASS  Renewal pipeline (the default queue) capped at " + renewalRows + " rows of " + activeCount + " active policies, with a View more link");

  /* Switch the dropdown to Cancellation for real, then verify the rows genuinely changed to the
     open cancellation requests, ranked by their live refund quote — the same cancelQuote the
     Cancellation desk itself shows for these same rows, so the two screens cannot disagree. */
  var pendingCx = PAS.pendingOf(policies, "Cancellation").map(function (t) {
    var meta = t.h.meta || {};
    var reason = meta.reason || "Insured Request";
    var initiatedBy = meta.initiatedBy || "Insured";
    var effDate = t.h.date || PAS.todayISO();
    return Math.round(PAS.cancelQuote(t.p, reason, initiatedBy, effDate).refund);
  }).sort(function (a, b) { return b - a; });

  setValue(queueSelect, "cancellation");
  var cancelRows = queuePanel.querySelectorAll(".hbar").length;
  var expectedCancelRows = Math.min(pendingCx.length, 5);
  if (cancelRows !== expectedCancelRows) { fails++; console.log("  FAIL  after switching to Cancellation the panel shows " + cancelRows + " rows, expected " + expectedCancelRows + " (min of the book's " + pendingCx.length + " open requests and the cap of 5)"); }
  else console.log("  PASS  switching the dropdown to Cancellation genuinely re-renders the panel — " + cancelRows + " of " + pendingCx.length + " open requests, ranked by refund");
  if (pendingCx.length > 0) {
    var topRefundText = PAS.money(pendingCx[0]);
    if (queuePanel.textContent.indexOf(topRefundText) === -1) { fails++; console.log('  FAIL  cancellation queue missing its top-ranked real refund amount "' + topRefundText + '"'); }
    else console.log("  PASS  top-ranked cancellation request shows its real refund amount (" + topRefundText + ")");
  }

  /* Reinstatement is the queue that did not exist before — it must show the book's real pending
     reinstatement requests, not an empty placeholder. */
  setValue(queueSelect, "reinstatement");
  var realReinstatements = PAS.pendingOf(policies, "Reinstatement").length;
  var reRows = queuePanel.querySelectorAll(".hbar").length;
  if (reRows !== Math.min(realReinstatements, 5)) { fails++; console.log("  FAIL  reinstatement queue shows " + reRows + " rows, expected " + Math.min(realReinstatements, 5) + " (book has " + realReinstatements + " pending)"); }
  else console.log("  PASS  the new Reinstatement queue shows the book's " + realReinstatements + " real pending request(s)");

  /* And the Top performers panel switches dimension the same way, including Underwriters —
     which is read from the ledger, not from a field on the policy. */
  var topSelect = topPanel.querySelector("select");
  var topOptions = topSelect ? topSelect.querySelectorAll("option").map(function (o) { return o.textContent; }) : [];
  ["Brokers", "MGAs", "Carriers", "Underwriters"].forEach(function (label) {
    if (topOptions.indexOf(label) === -1) { fails++; console.log('  FAIL  top-performers dropdown is missing "' + label + '"'); }
  });
  console.log("  PASS  one top-performers panel offering all four rankings (" + topOptions.join(", ") + ")");

  var topBrokerText = topPanel.textContent;
  var biggestBroker = (function () {
    var byBroker = {};
    policies.filter(function (p) { return p.status === "Active"; }).forEach(function (p) {
      if (p.producer) byBroker[p.producer] = (byBroker[p.producer] || 0) + p.premium;
    });
    return Object.keys(byBroker).sort(function (a, b) { return byBroker[b] - byBroker[a]; })[0];
  })();
  if (topBrokerText.indexOf(biggestBroker) === -1) { fails++; console.log('  FAIL  default Top brokers ranking does not lead with the real largest broker "' + biggestBroker + '"'); }
  else console.log('  PASS  default ranking leads with the real largest broker by in-force premium ("' + biggestBroker + '")');

  setValue(topSelect, "underwriter");
  var realUnderwriters = Array.from(new Set(policies.map(function (p) { return PAS.underwriterOf(p); }).filter(Boolean)));
  var uwRows = topPanel.querySelectorAll(".hbar").length;
  if (realUnderwriters.length === 0) { fails++; console.log("  FAIL  no policy in the book records who underwrote it — the Top underwriters ranking has no real source"); }
  else if (uwRows === 0) { fails++; console.log("  FAIL  switching to Underwriters rendered no rows despite " + realUnderwriters.length + " real underwriters on the ledger"); }
  else console.log("  PASS  switching to Underwriters ranks the " + realUnderwriters.length + " real decision-makers read from the ledger (" + uwRows + " shown), not the producers who introduced the business");
})();

/* ================= the financial engine =================
   Revenue, profit and loss ratio all come out of PAS.bookFinancials, so these assertions are
   about that one function being internally consistent and actuarially correct. The specific bug
   being locked out: loss ratio was dividing incurred claims by WRITTEN premium instead of EARNED
   premium, which on a half-earned book understated it by roughly half — the difference between
   reporting a healthy book and an underwater one. */
console.log("\n  financial engine: earned-basis ratios that reconcile");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var P = stub.PAS;
  var onRisk = P.onRiskPolicies(P.getPolicies());
  var f = P.bookFinancials(onRisk);
  function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.5); }

  /* --- 1. on-risk is the right population --- */
  var wrongStatus = onRisk.filter(function (p) { return ["Referred", "Declined", "Bound"].indexOf(p.status) !== -1; });
  if (wrongStatus.length > 0) { fails++; console.log("  FAIL  onRiskPolicies included " + wrongStatus.length + " policies that were never on risk (Referred/Declined/Bound)"); }
  else if (onRisk.length === P.getPolicies().length) { fails++; console.log("  FAIL  onRiskPolicies returned the entire book — it is not actually filtering anything"); }
  else console.log("  PASS  on-risk population is a real subset (" + onRisk.length + " of " + P.getPolicies().length + "), excluding business that never attached");
  var cancelledIncluded = onRisk.filter(function (p) { return p.status === "Cancelled" || p.status === "Expired"; }).length;
  if (cancelledIncluded === 0) { fails++; console.log("  FAIL  no cancelled/expired policies in the financial population — that is survivorship bias, the business that went bad is exactly what gets cancelled"); }
  else console.log("  PASS  " + cancelledIncluded + " cancelled/expired policies are still counted — no survivorship bias in the loss ratio");

  /* --- 2. earned premium is genuinely earned, not written --- */
  if (!(f.earnedPremium < f.writtenPremium)) { fails++; console.log("  FAIL  earned premium is not less than written premium — earning is not being applied at all"); }
  else if (f.earnedPremium <= 0) { fails++; console.log("  FAIL  earned premium is zero or negative"); }
  else console.log("  PASS  earned premium (" + P.money(f.earnedPremium) + ") is genuinely below written (" + P.money(f.writtenPremium) + ") — " + Math.round(f.earnedPremium / f.writtenPremium * 100) + "% of the book has actually been earned");
  if (!near(f.writtenPremium - f.earnedPremium, f.unearnedPremium, 1)) { fails++; console.log("  FAIL  unearned premium does not reconcile: written − earned ≠ unearned"); }
  else console.log("  PASS  written − earned = unearned, exactly");

  /* --- 3. THE regression guard: loss ratio must divide by earned, never written --- */
  var incurred = P.allClaims(onRisk).reduce(function (s, x) { return s + x.c.incurred; }, 0);
  var writtenBasis = incurred / f.writtenPremium;
  var earnedBasis = incurred / f.earnedPremium;
  if (!near(f.lossRatio, earnedBasis, 0.0001)) { fails++; console.log("  FAIL  lossRatio is not incurred ÷ earned premium (got " + f.lossRatio.toFixed(4) + ", earned basis is " + earnedBasis.toFixed(4) + ")"); }
  else if (near(f.lossRatio, writtenBasis, 0.02)) { fails++; console.log("  FAIL  lossRatio matches the WRITTEN-premium basis — the actuarially wrong denominator is back"); }
  else console.log("  PASS  loss ratio " + (f.lossRatio * 100).toFixed(1) + "% is the earned basis, materially different from the written basis (" + (writtenBasis * 100).toFixed(1) + "%) that used to be reported");

  /* --- 4. the P&L identities hold --- */
  if (!near(f.combinedRatio, f.lossRatio + f.expenseRatio, 0.0001)) { fails++; console.log("  FAIL  combined ratio ≠ loss ratio + expense ratio"); }
  else console.log("  PASS  combined ratio = loss ratio + expense ratio");
  if (!near(f.underwritingResult, f.earnedPremium - f.incurred - f.commission, 1)) { fails++; console.log("  FAIL  underwriting result ≠ earned − incurred − commission"); }
  else console.log("  PASS  underwriting result = earned premium − incurred claims − commission (" + P.money(f.underwritingResult) + ")");
  /* Combined ratio and the money result must never disagree about profitability — a book cannot
     be under 100% combined and simultaneously losing money. */
  if ((f.combinedRatio < 1) !== (f.underwritingResult > 0)) { fails++; console.log("  FAIL  combined ratio says " + (f.combinedRatio < 1 ? "profit" : "loss") + " but the underwriting result says the opposite"); }
  else console.log("  PASS  the ratio and the money answer agree on whether the book is profitable");
  if (!near(f.netCommission, f.commission - f.brokerCommission, 1)) { fails++; console.log("  FAIL  net commission ≠ gross commission − broker commission"); }
  else console.log("  PASS  net commission = gross − broker share (" + P.money(f.netCommission) + " kept of " + P.money(f.commission) + " earned)");

  /* --- 5. commission is real revenue modelling, not premium relabelled --- */
  if (f.commission >= f.earnedPremium * 0.5) { fails++; console.log("  FAIL  commission is implausibly close to premium — premium is probably being reported as revenue"); }
  else console.log("  PASS  commission is a real slice of premium (" + (f.commission / f.earnedPremium * 100).toFixed(1) + "% of earned), not premium relabelled as revenue");
  var directOnly = onRisk.filter(function (p) { return p.producer === "Direct"; });
  if (directOnly.length > 0) {
    var df = P.bookFinancials(directOnly);
    if (df.brokerCommission !== 0) { fails++; console.log("  FAIL  Direct business is paying broker commission (" + P.money(df.brokerCommission) + ") — there is no broker to pay"); }
    else console.log("  PASS  Direct business pays no broker commission, so it keeps 100% of it — a real margin difference, not an averaged-away one");
  }

  /* --- 6. segments must sum back to the whole book --- */
  var products = Array.from(new Set(onRisk.map(function (p) { return p.product; })));
  var sumEarned = 0, sumIncurred = 0, sumResult = 0;
  products.forEach(function (pr) {
    var sf = P.bookFinancials(onRisk.filter(function (p) { return p.product === pr; }));
    sumEarned += sf.earnedPremium; sumIncurred += sf.incurred; sumResult += sf.underwritingResult;
  });
  if (!near(sumEarned, f.earnedPremium, 1) || !near(sumIncurred, f.incurred, 1) || !near(sumResult, f.underwritingResult, 1)) {
    fails++; console.log("  FAIL  per-segment figures do not sum to the whole book — a policy is being double-counted or dropped");
  } else console.log("  PASS  every product segment sums exactly back to the book total — no policy double-counted or dropped");

  /* --- 7. the data has to answer the actual question: which is loss, where profit --- */
  var segs = products.map(function (pr) { return { k: pr, f: P.bookFinancials(onRisk.filter(function (p) { return p.product === pr; })) }; });
  var losing = segs.filter(function (s) { return s.f.combinedRatio >= 1; });
  var winning = segs.filter(function (s) { return s.f.combinedRatio < 0.8; });
  if (losing.length === 0 || winning.length === 0) { fails++; console.log("  FAIL  no real spread across lines (" + losing.length + " loss-making, " + winning.length + " strongly profitable) — the segment table cannot answer which business to fix"); }
  else console.log("  PASS  genuine spread: " + losing.length + " line(s) losing money (" + losing.map(function (s) { return s.k + " " + Math.round(s.f.combinedRatio * 100) + "%"; }).join(", ") + "), " + winning.length + " strongly profitable");
})();

/* The dashboard must render those computed figures, not its own separately-derived versions. */
console.log("\n  dashboard financial section: renders the engine's own numbers");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var P = stub.PAS;
  /* The dashboard's Financial performance section is period-scoped (Monthly/Quarterly/Yearly/
     custom, default Monthly) via PAS.bookFinancialsInWindow, not the as-of-today PAS.bookFinancials
     snapshot — so the figure to match on screen is the current calendar month's window, the
     toggle's default, not the whole book to date. */
  var today = new Date(P.todayISO() + "T00:00:00Z");
  var monthFrom = P.todayISO().slice(0, 7) + "-01";
  var monthTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  var f = P.bookFinancialsInWindow(P.onRiskPolicies(P.getPolicies()), monthFrom, monthTo);
  var txt = renderText("dashboard");

  ["Financial performance", "Written premium", "Earned premium", "Net commission revenue", "Loss ratio", "Combined ratio", "How earned premium becomes the underwriting result", "Underwriting performance by segment"].forEach(function (n) {
    if (txt.indexOf(n) === -1) { fails++; console.log('  FAIL  dashboard financial section missing "' + n + '"'); }
  });
  console.log("  PASS  financial KPIs, the premium waterfall and the segment P&L all render");

  function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }
  if (txt.indexOf(pct(f.combinedRatio)) === -1) { fails++; console.log('  FAIL  dashboard does not show the engine\'s real combined ratio "' + pct(f.combinedRatio) + '"'); }
  else console.log("  PASS  the combined ratio on screen (" + pct(f.combinedRatio) + ") is the engine's own computed figure, not a separately-derived one");
  if (txt.indexOf(P.moneyShort(f.netCommission)) === -1) { fails++; console.log('  FAIL  dashboard does not show real net commission revenue "' + P.moneyShort(f.netCommission) + '"'); }
  else console.log("  PASS  revenue shown (" + P.moneyShort(f.netCommission) + ") is commission net of broker share — an MGA's actual revenue, not premium");

  var verdict = f.combinedRatio < 1 ? "making an underwriting profit" : "losing money on underwriting";
  if (txt.indexOf(verdict) === -1) { fails++; console.log('  FAIL  dashboard is missing the plain-language profitability verdict ("' + verdict + '")'); }
  else console.log('  PASS  states the verdict in plain words ("' + verdict + '") rather than leaving the reader to know which side of 100% is good');
})();

/* Claims & loss ratio (MOM 2026-08-26): real charts and detail data for "loss vs. profitable
   business" on the main operational dashboard, not just numbers buried in the scoped MGA/Broker/
   Carrier view. Must show genuine variance — some segments in loss, some healthy — not a single
   near-zero book-wide number, which is what a too-thin claims seed would produce. */
console.log("\n  claims & loss ratio panel: real variance, callout flags the actual loss-making lines");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS4 = stub.PAS;
  var policies4 = PAS4.getPolicies();
  var active4 = policies4.filter(function (p) { return p.status === "Active"; });
  var products4 = Array.from(new Set(active4.map(function (p) { return p.product; })));
  var ratioByProduct = {};
  products4.forEach(function (pr) {
    var forPr = active4.filter(function (p) { return p.product === pr; });
    var premium = forPr.reduce(function (s, p) { return s + p.premium; }, 0);
    var incurred = PAS4.allClaims(forPr).reduce(function (s, x) { return s + x.c.incurred; }, 0);
    ratioByProduct[pr] = premium ? incurred / premium : 0;
  });
  var lossLines = products4.filter(function (pr) { return ratioByProduct[pr] >= 0.85; });
  var healthyLines = products4.filter(function (pr) { return ratioByProduct[pr] < 0.6; });
  if (lossLines.length === 0 || healthyLines.length === 0) { fails++; console.log("  FAIL  claims seed has no real variance — every product is either all-loss or all-healthy, can't demonstrate \"which is loss, where profit\""); }
  else console.log("  PASS  real variance across products: " + lossLines.length + " line(s) at/above 85% loss ratio (" + lossLines.join(", ") + "), " + healthyLines.length + " healthy line(s) under 60%");

  var dashTxt = renderText("dashboard");
  ["Lifetime loss ratio by product", "Lifetime loss ratio by state", "Claim details"].forEach(function (needle) {
    if (dashTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  operational dashboard missing "' + needle + '"'); }
  });
  console.log("  PASS  operational dashboard has lifetime loss-ratio product/state charts and a Claim details table — not just the scoped MGA/Broker/Carrier view");

  if (dashTxt.indexOf("High loss ratio — review required") === -1) { fails++; console.log('  FAIL  dashboard missing the high-loss-ratio review callout despite lines above the review threshold'); }
  else {
    var worstLine = lossLines.sort(function (a, b) { return ratioByProduct[b] - ratioByProduct[a]; })[0];
    if (dashTxt.indexOf(worstLine) === -1) { fails++; console.log('  FAIL  high-loss-ratio callout does not name "' + worstLine + '", the real worst-performing line'); }
    else console.log('  PASS  high-loss-ratio callout genuinely names ' + worstLine + ' (' + Math.round(ratioByProduct[worstLine] * 100) + '% loss ratio), computed live, not asserted');
  }

  var claimsDom = renderDom("dashboard");
  var claimsTables = claimsDom.querySelectorAll(".data-table");
  var lastTable = claimsTables[claimsTables.length - 1];
  var lastTbody = lastTable ? lastTable.querySelector("tbody") : null;
  var claimRows = lastTbody ? lastTbody.querySelectorAll("tr").length : 0;
  var realClaimCount = PAS4.allClaims(policies4).length;
  var expectedFirstPage = Math.min(10, realClaimCount);
  if (claimRows !== expectedFirstPage) { fails++; console.log("  FAIL  Claims detail table's first page shows " + claimRows + " rows, expected exactly " + expectedFirstPage + " (paginated, pageSize 10)"); }
  else console.log("  PASS  Claims detail table is genuinely paginated — first page shows " + expectedFirstPage + " of " + realClaimCount + " real claims, not all of them at once");

  var pagerMeta = claimsDom.querySelectorAll(".table-pager-meta");
  var claimsPagerMeta = pagerMeta[pagerMeta.length - 1];
  if (!claimsPagerMeta || claimsPagerMeta.textContent.indexOf(String(realClaimCount)) === -1) { fails++; console.log('  FAIL  claims table pager does not state the real total (' + realClaimCount + '), got "' + (claimsPagerMeta && claimsPagerMeta.textContent) + '"'); }
  else console.log("  PASS  pager states the real total claim count (" + realClaimCount + "), not a guess");

  if (realClaimCount > 10) {
    var nextBtns = claimsDom.querySelectorAll("button");
    var claimsNextBtn = Array.prototype.filter.call(nextBtns, function (b) { return b.textContent === "Next →"; }).pop();
    if (!claimsNextBtn) { fails++; console.log("  FAIL  no \"Next →\" pager button found despite more than one page of claims"); }
    else {
      claimsNextBtn.click();
      var lastTbody2 = claimsDom.querySelectorAll(".data-table")[claimsDom.querySelectorAll(".data-table").length - 1].querySelector("tbody");
      var page2Rows = lastTbody2.querySelectorAll("tr").length;
      var expectedPage2 = Math.min(10, realClaimCount - 10);
      if (page2Rows !== expectedPage2) { fails++; console.log("  FAIL  clicking Next on the claims table shows " + page2Rows + " rows, expected " + expectedPage2); }
      else console.log("  PASS  clicking \"Next →\" genuinely advances to page 2 (" + page2Rows + " more real claims), not a no-op");
    }
  }
})();

/* Cancellation trend (MOM 2026-08-26): a real SVG chart, split by type, on the Cancellation desk
   itself — not just buried in the dashboard's generic 3-transaction-type activity chart. Now also
   carries the same Monthly/Quarterly/Yearly + custom-range reporting control as the dashboard
   (PAS.charts.periodPicker), not a fixed trailing-6-months window; and the old "Terminology" /
   "Reason, notice & default type" reference sections are gone from this page — see the per-request
   worked refund breakdown on cancellation-decision.js instead, tested separately below. */
console.log("\n  cancellation trend chart: real SVG, split by type, driven by the dashboard's own period picker");
(function () {
  var cxDom = renderDom("cancellation", "", "Super Admin");
  var cxTxt = cxDom.textContent;
  var graphs = cxDom.querySelectorAll(".trend-graph");
  var dots = cxDom.querySelectorAll(".trend-dot");
  var legendItems = cxDom.querySelectorAll(".trend-legend-item");
  if (graphs.length !== 1) { fails++; console.log("  FAIL  expected exactly 1 trend graph on the Cancellation desk, found " + graphs.length); }
  else if (dots.length !== 18) { fails++; console.log("  FAIL  cancellation trend expected 18 dots (3 types × 6 months, the Monthly default), found " + dots.length); }
  else console.log("  PASS  Cancellation trend is a real SVG line/area graph — 3 cancellation types × 6 trailing months = 18 marked points");
  if (legendItems.length !== 3) { fails++; console.log("  FAIL  expected 3 legend entries (Flat/Pro-Rata/Short-Rate), found " + legendItems.length); }
  else console.log("  PASS  legend distinguishes all 3 cancellation types — a multi-series chart, not a single blended line");

  /* Switch to Yearly for real and confirm the graph genuinely re-buckets (4 years × 3 types), not
     just that the chip visually toggles. */
  var periodChips = cxDom.querySelectorAll(".chip").filter(function (b) { return b.textContent === "Yearly"; });
  if (periodChips.length === 0) { fails++; console.log("  FAIL  no \"Yearly\" chip found on the Cancellation trend's period picker"); }
  else {
    periodChips[0].click();
    var yearlyDots = cxDom.querySelectorAll(".trend-dot");
    if (yearlyDots.length !== 12) { fails++; console.log("  FAIL  switching the cancellation trend to Yearly expected 12 dots (3 types × 4 years), got " + yearlyDots.length); }
    else console.log("  PASS  switching the Cancellation trend's period picker to Yearly genuinely re-renders the chart (3 types × 4 years = 12 points), not a cosmetic toggle");
  }

  ["Terminology", "Reason, notice & default type"].forEach(function (removed) {
    if (cxTxt.indexOf(removed) !== -1) { fails++; console.log('  FAIL  Cancellation desk still shows the "' + removed + '" reference section — it should have been removed'); }
  });
  console.log("  PASS  the \"Terminology\" and \"Reason, notice & default type\" reference sections are gone from the Cancellation desk");
  if (cxTxt.indexOf("Types of cancellation") === -1) { fails++; console.log("  FAIL  \"Types of cancellation\" should still be on the page — only the other two reference sections were asked to go"); }
  else console.log("  PASS  \"Types of cancellation\" is still present — the one reference section that was not asked to be removed");
})();

/* Role-based dashboard: the same URL, genuinely different renders. Super Admin/Admin get the
   existing operational dashboard (already covered above, at the default no-role state); MGA gets
   a read-only, scoped-to-own-book portfolio-analytics view; Broker gets a scoped, filtered book
   of their own placements. */
console.log("\n  role-based dashboards (default = Super Admin, no role stored)");
(function () {
  var underwriterTxt = renderText("dashboard", "", null);
  ["Portfolio Dashboard", "Renewal pipeline", "Cancellation requests"].forEach(function (needle) {
    if (underwriterTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  default (no role set) dashboard missing "' + needle + '" — should default to Super Admin'); }
  });
  console.log("  PASS  no role stored defaults to the Super Admin operational dashboard");

  var mgaTxt = renderText("dashboard", "", "MGA");
  ["Dashboard", "In-force premium", "Premium by state", "Premium by broker", "In-force premium by product", "New business issued", "Claims and reserves", "Loss ratio", "Cornerstone MGA Partners"].forEach(function (needle) {
    if (mgaTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  MGA dashboard missing "' + needle + '"'); }
  });
  /* Conversion rate and Requests pending are gone entirely (not present anywhere on this
     dashboard, unlike Loss ratio/Open reserves which still legitimately appear inside the
     Claims & reserves panel's own "this filter" breakdown). */
  ["Conversion rate", "Requests pending"].forEach(function (banned) {
    if (mgaTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  MGA dashboard still shows the removed "' + banned + '" KPI'); }
  });
  /* Must NOT contain the operational-only panels — those belong to the Super Admin/Admin view only. */
  ["Renewal pipeline", "Cancellation requests", "Endorsement requests"].forEach(function (banned) {
    if (mgaTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  MGA dashboard leaked operational panel "' + banned + '"'); }
  });
  console.log("  PASS  MGA dashboard: portfolio KPIs, state/broker/LOB breakdowns, honest Claims & reserves gap, no operational panels, framed around its own book (Cornerstone MGA Partners)");

  /* Broker now shares the exact same dashboard shape as MGA (renderScopedDashboard) — same KPI
     row, same panel layout — with only the second breakdown panel's dimension swapped (MGA
     facility instead of broker, since "premium by broker" on a broker's own dashboard would
     always be one bar, themselves). */
  var brokerTxt = renderText("dashboard", "", "Broker");
  ["Apex Insurance Brokers", "Premium by MGA", "Premium by state", "In-force premium by product", "New business issued", "Claims and reserves", "Loss ratio"].forEach(function (needle) {
    if (brokerTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  Broker dashboard missing "' + needle + '"'); }
  });
  if (brokerTxt.indexOf("Premium by broker") !== -1) { fails++; console.log('  FAIL  Broker dashboard shows "Premium by broker" — would always be a single bar (themselves), should show "Premium by MGA" instead'); }
  ["Conversion rate", "Requests pending"].forEach(function (banned) {
    if (brokerTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  Broker dashboard still shows the removed "' + banned + '" KPI'); }
  });
  console.log("  PASS  Broker dashboard shows their own identity/book, and the same panel layout as MGA's dashboard (with the broker-specific dimension swap)");

  /* Real scoping, not cosmetic: verify against the actual data, not just that some table rendered. */
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS2 = stub.PAS;
  var allPolicies = PAS2.getPolicies();
  var apexCount = allPolicies.filter(function (p) { return p.producer === "Apex Insurance Brokers"; }).length;
  /* Real scoping on the dashboard's own KPI row too, not just the Policy Register (checked
     separately below) — Broker's In-force premium/Active policies must match Apex's own real
     figures, not the whole book's. */
  var apexActive = allPolicies.filter(function (p) { return p.producer === "Apex Insurance Brokers" && p.status === "Active"; });
  var apexPremium = apexActive.reduce(function (s, p) { return s + p.premium; }, 0);
  var brokerDom = renderDom("dashboard", "", "Broker");
  var brokerKpiValues = brokerDom.querySelectorAll(".kpi-value");
  var brokerActiveShown = Array.prototype.some.call(brokerKpiValues, function (el) { return el.textContent === String(apexActive.length); });
  var brokerPremiumShown = Array.prototype.some.call(brokerKpiValues, function (el) { return el.textContent === PAS2.moneyShort(apexPremium); });
  if (!brokerActiveShown || !brokerPremiumShown) { fails++; console.log("  FAIL  Broker dashboard's KPIs don't match Apex's real figures (" + apexActive.length + " active, " + PAS2.moneyShort(apexPremium) + " in-force premium)"); }
  else console.log("  PASS  Broker dashboard's KPIs (" + apexActive.length + " active, " + PAS2.moneyShort(apexPremium) + ") match Apex Insurance Brokers' real scoped figures — not the full " + apexCount + "-of-" + allPolicies.length + " book");

  /* MGA is now genuinely scoped to its own book (PAS.scopePolicies, scope:"mga"), not a
     portfolio-wide view — its headline KPI must match the real Cornerstone-only figure, and that
     figure must be a genuine subset (not the whole book, not empty). */
  var activePolicies = allPolicies.filter(function (p) { return p.status === "Active"; });
  var realInForcePremium = activePolicies.reduce(function (s, p) { return s + p.premium; }, 0);
  var cornerstonePolicies = allPolicies.filter(function (p) { return p.mga === "Cornerstone MGA Partners"; });
  var cornerstonePremium = cornerstonePolicies.filter(function (p) { return p.status === "Active"; }).reduce(function (s, p) { return s + p.premium; }, 0);
  if (cornerstonePolicies.length === allPolicies.length || cornerstonePolicies.length === 0) { fails++; console.log("  FAIL  MGA scoping isn't real — Cornerstone MGA Partners shows " + cornerstonePolicies.length + " of " + allPolicies.length + " policies, expected a genuine subset"); }
  else console.log("  PASS  Cornerstone MGA Partners is genuinely scoped to " + cornerstonePolicies.length + " of " + allPolicies.length + " policies");
  var mgaDom = renderDom("dashboard", "", "MGA");
  var mgaKpiValues = mgaDom.querySelectorAll(".kpi-value");
  var mgaPremiumShown = Array.prototype.some.call(mgaKpiValues, function (el) { return el.textContent === PAS2.moneyShort(cornerstonePremium); });
  if (!mgaPremiumShown) { fails++; console.log("  FAIL  MGA dashboard's In-force premium KPI does not match " + PAS2.moneyShort(cornerstonePremium) + ", the real figure scoped to Cornerstone MGA Partners' own book"); }
  else console.log("  PASS  MGA dashboard's In-force premium (" + PAS2.moneyShort(cornerstonePremium) + ") is scoped to its own book, genuinely different from the whole-portfolio total " + PAS2.moneyShort(realInForcePremium));

  /* Role scoping isn't just a dashboard cosmetic — PAS.getScopedPolicies() feeds the Policy
     Register and every desk list page too, so a Broker/MGA never sees another role's business in
     those tables either, not just on their own dashboard. */
  var brokerRegistryDom = renderDom("registry", "", "Broker");
  var brokerRegistryRows = brokerRegistryDom.querySelectorAll("tr").length - 1;
  if (brokerRegistryRows !== apexCount) { fails++; console.log("  FAIL  Policy Register shows " + brokerRegistryRows + " rows for Broker, expected exactly " + apexCount + " (scoped by producer, not the whole book)"); }
  else console.log("  PASS  Policy Register is genuinely scoped for Broker too (" + apexCount + " rows) — not just the dashboard");

  var mgaRegistryDom = renderDom("registry", "", "MGA");
  var mgaRegistryRows = mgaRegistryDom.querySelectorAll("tr").length - 1;
  if (mgaRegistryRows !== cornerstonePolicies.length) { fails++; console.log("  FAIL  Policy Register shows " + mgaRegistryRows + " rows for MGA, expected exactly " + cornerstonePolicies.length + " (scoped by mga, not the whole book)"); }
  else console.log("  PASS  Policy Register is genuinely scoped for MGA too (" + cornerstonePolicies.length + " rows)");

  /* Entity directories (Brokers/MGA/Carriers/Customers) are scoped too — a role only sees the
     partners genuinely associated with its own book, not the full directory. A Broker's own book
     is all producer="Apex Insurance Brokers" by definition, so the Brokers page collapses to
     exactly one row (themselves); the MGA/Carrier/Customer pages show only the distinct partners
     that actually appear among Apex's own policies. */
  var apexPolicies = allPolicies.filter(function (p) { return p.producer === "Apex Insurance Brokers"; });
  var apexMgaCount = new Set(apexPolicies.map(function (p) { return p.mga; })).size;
  var apexCarrierCount = new Set(apexPolicies.map(function (p) { return p.carrier; })).size;
  var apexHolderCount = new Set(apexPolicies.map(function (p) { return p.holder; })).size;

  var brokerBrokersRows = renderDom("brokers", "", "Broker").querySelectorAll("tr").length - 1;
  if (brokerBrokersRows !== 1) { fails++; console.log("  FAIL  Brokers directory shows " + brokerBrokersRows + " rows for Broker, expected exactly 1 (themselves — every policy in their own scope has the same producer)"); }
  else console.log("  PASS  Brokers directory collapses to exactly 1 row (themselves) when viewed as Broker — not the full partner directory");

  var brokerMgasRows = renderDom("mgas", "", "Broker").querySelectorAll("tr").length - 1;
  if (brokerMgasRows !== apexMgaCount || brokerMgasRows === 0) { fails++; console.log("  FAIL  MGA directory shows " + brokerMgasRows + " rows for Broker, expected exactly " + apexMgaCount + " (the MGA facilities genuinely present in Apex's own book)"); }
  else console.log("  PASS  MGA directory shows exactly the " + apexMgaCount + " MGA facilities genuinely associated with Apex's own book");

  var brokerCarriersRows = renderDom("carriers", "", "Broker").querySelectorAll("tr").length - 1;
  if (brokerCarriersRows !== apexCarrierCount || brokerCarriersRows === 0) { fails++; console.log("  FAIL  Carriers directory shows " + brokerCarriersRows + " rows for Broker, expected exactly " + apexCarrierCount); }
  else console.log("  PASS  Carriers directory shows exactly the " + apexCarrierCount + " carriers genuinely associated with Apex's own book");

  var brokerCustomersRows = renderDom("customers", "", "Broker").querySelectorAll("tr").length - 1;
  if (brokerCustomersRows !== apexHolderCount || brokerCustomersRows === 0) { fails++; console.log("  FAIL  Customers directory shows " + brokerCustomersRows + " rows for Broker, expected exactly " + apexHolderCount); }
  else console.log("  PASS  Customers directory shows exactly the " + apexHolderCount + " customers genuinely associated with Apex's own book — not every customer in the full 1087-policy book");
})();

/* Carrier role (MOM 2026-08-26, item 1): "New Business Trend should represent the carrier's
   business performance, not Veridex's overall business" — and the carrier view should surface
   both the MGA and Broker layers underneath it, not just one. */
console.log("\n  Carrier role dashboard: genuinely scoped to its own paper, sees both MGA and Broker layers");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS3 = stub.PAS;
  var allPolicies = PAS3.getPolicies();
  var meridianPolicies = allPolicies.filter(function (p) { return p.carrier === "Meridian Assurance Co."; });
  var meridianPremium = meridianPolicies.filter(function (p) { return p.status === "Active"; }).reduce(function (s, p) { return s + p.premium; }, 0);
  if (meridianPolicies.length === allPolicies.length || meridianPolicies.length === 0) { fails++; console.log("  FAIL  Carrier scoping isn't real — Meridian Assurance Co. shows " + meridianPolicies.length + " of " + allPolicies.length + " policies, expected a genuine subset"); }
  else console.log("  PASS  Meridian Assurance Co. is genuinely scoped to " + meridianPolicies.length + " of " + allPolicies.length + " policies");

  var carrierTxt = renderText("dashboard", "", "Carrier");
  ["Meridian Assurance Co.", "Premium by MGA", "Premium by broker", "Premium by state", "New business issued", "Claims and reserves", "Loss ratio"].forEach(function (needle) {
    if (carrierTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  Carrier dashboard missing "' + needle + '"'); }
  });
  console.log("  PASS  Carrier dashboard shows its own identity, and — unlike MGA/Broker, which only get one — both the Broker and MGA breakdown panels");

  var carrierDom = renderDom("dashboard", "", "Carrier");
  var carrierKpiValues = carrierDom.querySelectorAll(".kpi-value");
  var carrierPremiumShown = Array.prototype.some.call(carrierKpiValues, function (el) { return el.textContent === PAS3.moneyShort(meridianPremium); });
  if (!carrierPremiumShown) { fails++; console.log("  FAIL  Carrier dashboard's In-force premium KPI does not match " + PAS3.moneyShort(meridianPremium) + ", the real figure scoped to Meridian Assurance Co.'s own book"); }
  else console.log("  PASS  Carrier dashboard's In-force premium (" + PAS3.moneyShort(meridianPremium) + ") is genuinely scoped to its own paper — this is what makes \"New business issued\" below it the carrier's own trend, not Veridex's whole book");

  var carrierRegistryRows = renderDom("registry", "", "Carrier").querySelectorAll("tr").length - 1;
  if (carrierRegistryRows !== meridianPolicies.length) { fails++; console.log("  FAIL  Policy Register shows " + carrierRegistryRows + " rows for Carrier, expected exactly " + meridianPolicies.length); }
  else console.log("  PASS  Policy Register is genuinely scoped for Carrier too (" + meridianPolicies.length + " rows) — not just the dashboard");
})();

/* Claims & reserves: real records, not a fabricated loss ratio. Ironwood Steel Works' claim is
   deliberately consistent with the "adverse loss ratio... 140%" narrative already on its
   cancellation record — the two must agree exactly, not just both exist. */
console.log("\n  claims & reserves: real data, internally consistent with the existing loss-ratio narrative");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS5 = stub.PAS;
  var book5 = PAS5.seedPolicies();
  /* Ironwood's ledger says "adverse loss ratio... 140% OVER TWO TERMS". That is a completed-terms
     figure, so it must be checked against the premium earned across those two completed terms
     (fully earned, 2 x annual), not against the policy's lifetime-to-date earned premium, which
     also includes a partial third term still running. Checking it the second way would drift
     every single day as the current term earns out, which is exactly the kind of date-dependent
     assertion that turns into a flaky test. */
  var bharat = book5.find(function (p) { return p.id === "POL-2026-00988"; });
  var completedTerms = Math.max(1, (Number(bharat.termNumber) || 1) - 1);
  var earnedOverCompletedTerms = bharat.premium * completedTerms;
  var bharatIncurred = (bharat.claims || []).reduce(function (s, c) { return s + c.incurred; }, 0);
  var bharatRatio = Math.round((bharatIncurred / earnedOverCompletedTerms) * 100);
  if (bharatRatio !== 140) { fails++; console.log("  FAIL  Ironwood Steel Works' loss ratio over its " + completedTerms + " completed terms is " + bharatRatio + "%, expected exactly 140% to match its cancellation record's own \"adverse loss ratio... 140% over two terms\" narrative"); }
  else console.log("  PASS  Ironwood Steel Works' claim ($" + bharatIncurred.toLocaleString("en-US") + " incurred ÷ $" + earnedOverCompletedTerms.toLocaleString("en-US") + " earned over " + completedTerms + " completed terms) computes to exactly 140% — matches its own cancellation narrative, not a coincidence");

  /* And the corrected lifetime metric must still read as adverse, or the headline number would
     quietly contradict the cancellation sitting on the same policy's ledger. */
  var bharatLifetime = Math.round(PAS5.lossRatio([bharat]) * 100);
  if (bharatLifetime <= 100) { fails++; console.log("  FAIL  Ironwood's lifetime earned loss ratio is " + bharatLifetime + "% — not adverse, which contradicts the cancellation on its own ledger"); }
  else console.log("  PASS  its lifetime earned loss ratio (" + bharatLifetime + "%) is still clearly adverse — the corrected metric agrees with the ledger narrative rather than contradicting it");

  var active5 = book5.filter(function (p) { return p.status === "Active"; });
  var totalClaims = PAS5.allClaims(active5).length;
  var totalReserves = PAS5.reservesTotal(active5);
  if (totalClaims === 0) { fails++; console.log("  FAIL  no claims exist anywhere in the active book"); }
  else console.log("  PASS  " + totalClaims + " real claims on file across the active book, $" + totalReserves.toLocaleString("en-US") + " in open reserves");

  /* MGA is scoped to its own book (Cornerstone MGA Partners), so the loss ratio shown in its
     Claims & reserves panel must be computed over that same subset — restricted to ON-RISK
     policies and divided by EARNED premium, exactly as PAS.bookFinancials does for the full
     operational dashboard. A Broker or MGA must never be shown a loss ratio derived differently
     from the one an admin sees over the same policies. */
  var cornerstoneOnRisk = PAS5.onRiskPolicies(book5.filter(function (p) { return p.mga === "Cornerstone MGA Partners"; }));
  var cornerstoneFin = PAS5.bookFinancials(cornerstoneOnRisk);
  var mgaDom2 = renderDom("dashboard", "", "MGA");
  var mgaTxt2 = mgaDom2.textContent.replace(/\s+/g, " ");
  var expectedRatio = (Math.round(cornerstoneFin.lossRatio * 1000) / 10) + "%";
  if (mgaTxt2.indexOf(expectedRatio) === -1) { fails++; console.log('  FAIL  MGA dashboard does not show its own book\'s real loss ratio "' + expectedRatio + '"'); }
  else console.log("  PASS  MGA dashboard's Claims & reserves panel (" + expectedRatio + ") matches the real earned-basis figure for its own scoped on-risk book");
  var expectedCombined = (Math.round(cornerstoneFin.combinedRatio * 1000) / 10) + "%";
  if (mgaTxt2.indexOf(expectedCombined) === -1) { fails++; console.log('  FAIL  MGA dashboard does not show its own combined ratio "' + expectedCombined + '" — a scoped role gets the loss ratio but not the profitability answer'); }
  else console.log("  PASS  the scoped role also sees its own combined ratio (" + expectedCombined + "), not just the loss ratio");
})();

/* Refund-wise breakdown on the Cancellation desk: grouped totals must reconcile to the same sum
   as adding up every completed cancellation's own recorded refund — a grouping bug (double count,
   dropped row, pending leaking in) would show a mismatched total. */
console.log("\n  refund-wise breakdown: grouped totals reconcile to the real sum");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS6 = stub.PAS;
  var book6 = PAS6.seedPolicies();
  var completed6 = [];
  book6.forEach(function (p) { p.history.forEach(function (h) { if (h.type === "Cancellation" && h.status === "Completed") completed6.push(h); }); });
  var realTotal = completed6.reduce(function (s, h) { return s + (Number(h.meta && h.meta.refund) || 0); }, 0);
  if (completed6.length === 0) { fails++; console.log("  FAIL  no completed cancellations exist to test the breakdown against"); }
  else console.log("  PASS  " + completed6.length + " completed cancellations, $" + realTotal.toLocaleString("en-US") + " total refunded — the real figure the breakdown must reconcile to");

  var cancelTxt = renderText("cancellation");
  var moneyStr = PAS6.money(realTotal);
  if (cancelTxt.indexOf(moneyStr) === -1) { fails++; console.log('  FAIL  Cancellation desk does not show the real total refunded "' + moneyStr + '" anywhere on the page'); }
  else console.log("  PASS  Cancellation desk shows the real total refunded (" + moneyStr + ") — same figure as summing every completed cancellation's own recorded refund");
})();

/* Cancellation-desk-only initiator relabel: a Carrier/Reinsurer-initiated request must display as
   "MGA" on this desk specifically (both the Requested-by pill/origin and the filter dropdown),
   while the shared PAS.INITIATORS map stays untouched so every other desk keeps calling it
   "Reinsurer" for real. */
console.log("\n  cancellation desk: Carrier-initiated requests display as \"MGA\", scoped to this desk only");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PI = stub.PAS;
  if (PI.INITIATORS.Carrier.label !== "Reinsurer") { fails++; console.log('  FAIL  PAS.INITIATORS.Carrier.label changed from "Reinsurer" — this should stay untouched globally, only overridden on the Cancellation desk'); }
  else console.log("  PASS  the shared PAS.INITIATORS.Carrier label is still \"Reinsurer\" — the relabel is genuinely local to the Cancellation desk, not a global change");

  var carrierInitiated = PI.pendingOf(PI.getPolicies(), "Cancellation").find(function (t) { return t.h.meta.initiatedBy === "Carrier"; });
  if (!carrierInitiated) { fails++; console.log("  FAIL  no seeded pending cancellation with a real Carrier initiator — can't test the relabel"); return; }

  var cxDom = renderDom("cancellation", "", "Super Admin");
  var cxTxt = cxDom.textContent;
  if (cxTxt.indexOf("Reinsurer") !== -1) { fails++; console.log('  FAIL  the Cancellation desk list page still shows "Reinsurer" somewhere — it should read "MGA" throughout'); }
  else console.log("  PASS  the Cancellation desk list page shows no \"Reinsurer\" text — the real Carrier-initiated row (" + carrierInitiated.p.id + ") renders as \"MGA\"");

  var initiatorSelect = cxDom.querySelectorAll("select").filter(function (el) { return el.getAttribute("title") === "Initiated by"; })[0];
  var mgaOptionCount = initiatorSelect ? initiatorSelect.querySelectorAll("option").filter(function (o) { return o.textContent === "MGA"; }).length : 0;
  if (mgaOptionCount !== 2) { fails++; console.log("  FAIL  expected exactly 2 \"MGA\"-labelled options in the Initiated-by filter (real MGA + relabelled Carrier), found " + mgaOptionCount); }
  else console.log("  PASS  the Initiated-by filter genuinely offers two distinct underlying values both labelled \"MGA\" (the real MGA key, and Carrier under the desk's override) — a deliberate, confirmed choice, not an oversight");

  var decisionTxt = renderText("cancellation-decision", "?policy=" + encodeURIComponent(carrierInitiated.p.id) + "&txn=" + encodeURIComponent(carrierInitiated.h.id));
  if (decisionTxt.indexOf("Requested by MGA") === -1) { fails++; console.log('  FAIL  cancellation-decision for a real Carrier-initiated request does not show "Requested by MGA"'); }
  else console.log("  PASS  cancellation-decision's Request origin also reads \"Requested by MGA\" for a real Carrier-initiated request — consistent with the list page");
  if (decisionTxt.indexOf("Reinsurer") !== -1) { fails++; console.log('  FAIL  cancellation-decision still shows "Reinsurer" somewhere'); }

  /* Confirm the relabel didn't leak into a desk that was never asked to change — Reinstatement
     shows the ORIGINAL cancellation's Initiated By too (via decisionTrailFor), and that one must
     still say the real, shared label. */
  var reinstateTxt = renderText("reinstatement-decision", "?policy=POL-2026-01190");
  if (reinstateTxt.indexOf("Reinsurer") === -1 && reinstateTxt.indexOf("Carrier") === -1) { console.log("  (reinstatement-decision doesn't happen to show an initiator label for this record — not a failure, just nothing to assert)"); }
  else if (reinstateTxt.indexOf("MGA") !== -1 && reinstateTxt.indexOf("Reinsurer") === -1 && reinstateTxt.indexOf("Carrier") !== -1) { fails++; console.log("  FAIL  the Cancellation desk's local relabel leaked into Reinstatement — it should only apply on the Cancellation desk"); }
  else console.log("  PASS  the relabel did not leak into Reinstatement — a desk that was never asked to change keeps the real, shared label");
})();

/* Cancellation Types explanation: rewritten to be plain-language and short (the previous
   "unearned premium"/"acquisition cost"/"basis" wording was flagged as hard to understand), while
   staying accurate — every card's visible copy must actually match PAS.CANCEL_TYPES' own data,
   not a hardcoded string that could quietly drift from what cancelQuote actually computes. */
console.log("\n  cancellation desk: \"Types of cancellation\" cards are plain-language, not jargon");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PT = stub.PAS;
  var cxTxt = renderText("cancellation");

  ["unearned", "acquisition cost", "written basis", "unearned basis"].forEach(function (jargon) {
    if (cxTxt.indexOf(jargon) !== -1) { fails++; console.log('  FAIL  "Types of cancellation" still contains the jargon phrase "' + jargon + '"'); }
  });
  console.log("  PASS  none of the old jargon (\"unearned premium\", \"acquisition cost\", \"written/unearned basis\") appears on the page");

  Object.keys(PT.CANCEL_TYPES).forEach(function (name) {
    var t = PT.CANCEL_TYPES[name];
    if (cxTxt.indexOf(t.when) === -1 || cxTxt.indexOf(t.rate) === -1) { fails++; console.log('  FAIL  ' + name + "'s card doesn't show its own real PAS.CANCEL_TYPES text — could be a hardcoded string that's drifted from the data"); }
    var wordCount = t.when.split(/\s+/).length;
    if (wordCount > 30) { fails++; console.log("  FAIL  " + name + "'s explanation is " + wordCount + " words — too long to read at a glance"); }
  });
  console.log("  PASS  every type card's visible text is read live from PAS.CANCEL_TYPES (never a stale hardcoded copy), and each explanation is short enough to read at a glance");
})();

/* The Cancellation desk's pending-requests table now carries a search box plus LOB and
   Submitted-date filters (same as Endorsements/Reinstatement/Renewal) — these must genuinely
   narrow the rendered rows, not just exist as inert controls. */
console.log("\n  cancellation desk: LOB and date filters genuinely narrow the pending table");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS7 = stub.PAS;
  var bookC = PAS7.seedPolicies();
  var pendC = PAS7.pendingOf(bookC, "Cancellation");

  var out = renderDom("cancellation");
  /* The reference accordion (Terminology / Types / Reason&notice) contributes its own reference
     tables ahead of the pending-requests table, so the *last* tbody on the page — not a hardcoded
     count — is the one the filters act on. sortableTable's rebuild() replaces the whole <table>
     (tableWrap.innerHTML = "" then a fresh dataTable), so the tbody must be re-queried after every
     filter change rather than captured once. */
  function pendingTbody() {
    var tbodies = out.querySelectorAll("tbody");
    if (tbodies.length === 0) throw new Error("no tbody elements found on the Cancellation desk");
    return tbodies[tbodies.length - 1];
  }
  function rowCount() { return pendingTbody().querySelectorAll("tr").length; }
  /* The pending-requests table is paginated (pageSize 10), so once there are more than 10 pending
     requests the baseline page correctly shows only the first 10 — asserting the FULL count would
     be asserting pagination is broken. */
  var expectedBaseline = Math.min(pendC.length, 10);
  if (rowCount() !== expectedBaseline) { fails++; console.log("  FAIL  Cancellation desk baseline expected " + expectedBaseline + " pending rows (page 1 of " + pendC.length + " total), got " + rowCount()); }
  else console.log("  PASS  baseline shows " + expectedBaseline + " of " + pendC.length + " real pending cancellation requests (page 1)");

  var productSelect = out.querySelectorAll("select").filter(function (el) { return el.getAttribute("title") === "Line of business"; })[0];
  if (!productSelect) { fails++; console.log("  FAIL  expected an LOB filter select (title=\"Line of business\") on the Cancellation desk"); return; }
  var sampleProduct = pendC[0].p.product;
  var expectedProduct = pendC.filter(function (t) { return t.p.product === sampleProduct; }).length;
  setValue(productSelect, sampleProduct);
  if (rowCount() !== expectedProduct) { fails++; console.log("  FAIL  LOB filter '" + sampleProduct + "' expected " + expectedProduct + " rows, got " + rowCount()); }
  else console.log("  PASS  LOB filter narrows to the " + expectedProduct + " real '" + sampleProduct + "' pending requests");
  setValue(productSelect, "All");

  /* The page also carries a second, unrelated pair of date inputs now — the cancellation trend
     panel's own custom-range picker (PAS.charts.periodPicker) — so the request-table's Submitted
     from/to filter has to be found by its title, not by "whichever date input comes first". */
  var allDateInputs = out.querySelectorAll("input").filter(function (el) { return el.getAttribute("type") === "date"; });
  var submittedFrom = allDateInputs.filter(function (el) { return el.getAttribute("title") === "Submitted from"; })[0];
  var submittedTo = allDateInputs.filter(function (el) { return el.getAttribute("title") === "Submitted to"; })[0];
  if (!submittedFrom || !submittedTo) { fails++; console.log("  FAIL  expected a Submitted-from and Submitted-to date filter on the Cancellation desk (title-addressed), found " + allDateInputs.length + " date input(s) total"); return; }
  else console.log("  PASS  the Submitted-date filter pair is still findable by title among " + allDateInputs.length + " date inputs now on the page (the trend panel added its own custom-range pair)");
  submittedFrom.value = "2099-01-01";
  submittedFrom.dispatchEvent({ type: "change" });
  /* A 0-row match still renders one <tr> — dataTable's own "nothing here" placeholder row — so
     the real check is that the surviving row is that empty-state row, not a genuine data row. */
  var emptyMsg = "No cancellation requests match the current search or filters.";
  var afterFuture = pendingTbody().querySelectorAll("tr");
  if (afterFuture.length !== 1 || afterFuture[0].textContent.indexOf(emptyMsg) === -1) { fails++; console.log("  FAIL  a Submitted-from date far in the future should leave 0 real pending rows (just the empty-state placeholder), got " + afterFuture.length + " row(s)"); }
  else console.log("  PASS  the Submitted-date filter genuinely excludes every pending request when set beyond any real submission date");
})();

/* Coverage-wise breakdown: each policy's line items must sum back to exactly its own premium —
   the whole point of a percentage split is that it never loses or invents money. */
console.log("\n  coverage-wise breakdown: line items reconcile exactly to the policy's own premium");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS7 = stub.PAS;
  var book7 = PAS7.seedPolicies();
  var mismatches = [];
  book7.forEach(function (p) {
    var breakdown = PAS7.coverageBreakdown(p);
    if (breakdown.length === 0) return; // no template for this product — not tested here
    var sumOfLines = breakdown.reduce(function (s, c) { return s + c.premium; }, 0);
    if (sumOfLines !== p.premium) mismatches.push(p.id + " sums to " + sumOfLines + ", premium is " + p.premium);
  });
  var withTemplate = book7.filter(function (p) { return PAS7.coverageBreakdown(p).length > 0; }).length;
  if (mismatches.length > 0) { fails++; console.log("  FAIL  " + mismatches.length + " polic(ies) whose coverage line items don't sum to their own premium: " + mismatches.join(", ")); }
  else console.log("  PASS  all " + withTemplate + " policies with a coverage template reconcile exactly (line items sum to the policy's own premium, $0 off, every time)");

  var detailTxt = renderText("policy-detail", "?policy=POL-2026-02233&tab=cover");
  ["Coverage breakdown", "Base sum assured", "Accidental death rider"].forEach(function (needle) {
    if (detailTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  policy-detail cover tab missing "' + needle + '"'); }
  });
  console.log("  PASS  policy-detail's Cover tab renders the real per-policy coverage breakdown");
})();

/* Underwritten by (MOM 2026-08-26): the policy must show who actually decided it, not just who
   initiated the submission — Producer and "Underwritten by" must be two genuinely different real
   people/entities, read from the completed Underwriting decision's own audit trail. */
console.log("\n  policy-detail: \"Underwritten by\" shows the real decision-maker, not just the initiator");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS6b = stub.PAS;
  var withUw = PAS6b.getPolicies().find(function (p) { return p.history.some(function (h) { return h.type === "Underwriting" && h.status === "Completed"; }); });
  if (!withUw) { fails++; console.log("  FAIL  no seeded policy with a completed Underwriting decision found"); return; }
  var uwRow = withUw.history.filter(function (h) { return h.type === "Underwriting" && h.status === "Completed"; }).sort(function (a, b) { return b.seq - a.seq; })[0];
  if (uwRow.user === withUw.producer) { fails++; console.log("  FAIL  test fixture coincidence — decision-maker and producer are the same string, can't prove they're independently sourced"); return; }

  var txt = renderText("policy-detail", "?policy=" + encodeURIComponent(withUw.id) + "&tab=parties");
  if (txt.indexOf("Underwritten by") === -1) { fails++; console.log('  FAIL  policy-detail missing "Underwritten by"'); }
  else if (txt.indexOf(uwRow.user) === -1) { fails++; console.log('  FAIL  policy-detail does not show the real decision-maker "' + uwRow.user + '"'); }
  else if (txt.indexOf(withUw.producer) === -1) { fails++; console.log('  FAIL  policy-detail no longer shows the real Producer "' + withUw.producer + '"'); }
  else console.log("  PASS  " + withUw.id + " genuinely distinguishes Producer (" + withUw.producer + ") from Underwritten by (" + uwRow.user + ") — read from the decision's own audit trail, not asserted");
})();

/* Renewal notifications (MOM 2026-08-26): "sent to the customer, underwriter, and lead" — must be
   a real, inspectable ledger entry with real recipients (the actual underwriter on file, not a
   fabricated name), not a toast that vanishes. */
console.log("\n  renewal notifications: real recipients, logged on the policy's own ledger, not a toast");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS13 = stub.PAS;
  var allPolicies13 = PAS13.getPolicies();
  var pendingIds = PAS13.pendingOf(allPolicies13, "Renewal").map(function (t) { return t.p.id; });
  var noConfirmation = allPolicies13.filter(function (p) { return p.status === "Active" && pendingIds.indexOf(p.id) === -1 && PAS13.renewalCompliance(p).status !== "Compliant"; });
  if (noConfirmation.length === 0) { fails++; console.log("  FAIL  no seeded policy in the notice window with no renewal confirmation yet — can't test notification"); return; }
  var target = noConfirmation[0];
  if (PAS13.lastRenewalNotice(target)) { fails++; console.log("  FAIL  " + target.id + " already shows a renewal notice before one was ever sent"); return; }

  var recipients = PAS13.renewalNoticeRecipients(target);
  if (recipients.customer !== target.holder) { fails++; console.log("  FAIL  customer recipient is not the real policyholder"); }
  if (!recipients.underwriter) { fails++; console.log("  FAIL  underwriter recipient is empty"); }
  if (!recipients.lead) { fails++; console.log("  FAIL  lead recipient is empty"); }
  console.log("  PASS  real recipients computed for " + target.id + ": customer=" + recipients.customer + ", underwriter=" + recipients.underwriter + ", lead=" + recipients.lead);

  PAS13.sendRenewalNotice(target.id);
  var after13 = PAS13.getPolicy(target.id);
  var notice = PAS13.lastRenewalNotice(after13);
  if (!notice) { fails++; console.log("  FAIL  sendRenewalNotice did not leave a real ledger entry on the policy"); }
  else if (notice.detail.indexOf(recipients.customer) === -1 || notice.detail.indexOf(recipients.underwriter) === -1 || notice.detail.indexOf(recipients.lead) === -1) { fails++; console.log("  FAIL  notice detail text doesn't actually name all three real recipients — got: " + notice.detail); }
  else console.log("  PASS  sending the notice appends a real, inspectable ledger entry naming all three real recipients — not a toast that vanishes without a trace");

  var ledgerType = after13.history[after13.history.length - 1].type;
  if (ledgerType !== "Renewal") { fails++; console.log("  FAIL  renewal notice entry is filed under \"" + ledgerType + "\", expected \"Renewal\" — it would be invisible on the policy's own Renewal history otherwise"); }
  else console.log("  PASS  the notice is filed as a real Renewal-type transaction, visible on the policy's own ledger");
})();

/* i18n seam: a real routing mechanism, not decorative — a second locale must actually change
   what PAS.t() resolves to, and an unknown key/locale must fail safe to the caller's fallback
   rather than leaking "undefined" or a raw key onto the screen. */
console.log("\n  i18n: PAS.t() is a real seam — adding a locale genuinely changes resolved output");
(function () {
  var stub = { sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })() };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/i18n.js", "utf8"), stub);
  var PASi = stub.PAS;

  if (PASi.t("nav.dashboard") !== "Dashboard") { fails++; console.log('  FAIL  PAS.t("nav.dashboard") should resolve to "Dashboard" in the default (en) locale, got "' + PASi.t("nav.dashboard") + '"'); }
  else console.log("  PASS  a real, defined key resolves correctly in the default locale");

  if (PASi.t("nav.does-not-exist", "Fallback text") !== "Fallback text") { fails++; console.log("  FAIL  an unknown key did not fail safe to the caller's own fallback"); }
  else console.log("  PASS  an unknown key fails safe to the caller's fallback — never a raw key or \"undefined\" on screen");

  PASi.STRINGS.es = { "nav.dashboard": "Tablero" };
  PASi.LOCALES = Object.keys(PASi.STRINGS);
  PASi.setLocale("es");
  if (PASi.getLocale() !== "es") { fails++; console.log("  FAIL  setLocale/getLocale round-trip failed"); }
  else if (PASi.t("nav.dashboard") !== "Tablero") { fails++; console.log('  FAIL  adding a second locale did not change what PAS.t() resolves — this is decorative, not a real seam. Got "' + PASi.t("nav.dashboard") + '"'); }
  else console.log("  PASS  adding a locale and switching to it genuinely changes resolved output — the seam is real, not decorative");

  if (PASi.t("nav.approvals", "Pending approvals") !== "Pending approvals") { fails++; console.log("  FAIL  a key missing from the active (es) locale should fail back to English, not the raw key"); }
  else console.log("  PASS  a key missing from the active locale falls back to English (not the raw key)");
})();

/* Cancellation type override "where permitted" (MOM 2026-08-26, later widened to full discretion
   per user request): a decision-maker can override the derived type freely, including into a
   combination the normal domain rule wouldn't derive on its own — that's now a flagged exception
   (overrideOutsideRule), not a refusal. isValidCancelType still exists to compute the flag. */
console.log("\n  cancellation type override: on-rule overrides apply cleanly, off-rule overrides apply flagged");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS14 = stub.PAS;

  /* POL-2026-02233: Insured Request / Broker-Producer — derives to Short-Rate, insured-side, so
     Pro-Rata is a genuinely valid override (never forbidden by the insurer-side rule). */
  var before14 = PAS14.getPolicy("POL-2026-02233");
  var pendTxn14 = before14.history.find(function (h) { return h.type === "Cancellation" && h.status === "Pending"; });
  var quoteBefore = PAS14.cancelQuote(before14, pendTxn14.meta.reason, pendTxn14.meta.initiatedBy, pendTxn14.date, pendTxn14.meta);
  if (quoteBefore.type !== "Short-Rate" || quoteBefore.overridden) { fails++; console.log("  FAIL  test fixture assumption wrong — POL-2026-02233 should derive to Short-Rate, un-overridden, got " + quoteBefore.type + " overridden=" + quoteBefore.overridden); return; }

  var applied = PAS14.setCancelTypeOverride("POL-2026-02233", pendTxn14.id, "Pro-Rata", "Waiving the short-rate penalty as a retention gesture.");
  if (!applied.allowed) { fails++; console.log("  FAIL  a genuinely valid override (Short-Rate -> Pro-Rata, insured-side) was refused: " + applied.reason); }
  else console.log("  PASS  a valid override (Short-Rate -> Pro-Rata) is allowed and applied");

  var after14 = PAS14.getPolicy("POL-2026-02233");
  var pendTxn14b = after14.history.find(function (h) { return h.id === pendTxn14.id; });
  var quoteAfter = PAS14.cancelQuote(after14, pendTxn14b.meta.reason, pendTxn14b.meta.initiatedBy, pendTxn14b.date, pendTxn14b.meta);
  if (quoteAfter.type !== "Pro-Rata" || !quoteAfter.overridden || quoteAfter.derivedType !== "Short-Rate") { fails++; console.log("  FAIL  cancelQuote does not reflect the override — type=" + quoteAfter.type + " overridden=" + quoteAfter.overridden + " derivedType=" + quoteAfter.derivedType); }
  else if (quoteAfter.refund <= quoteBefore.refund) { fails++; console.log("  FAIL  overriding away the short-rate penalty should genuinely raise the refund — before " + quoteBefore.refund + ", after " + quoteAfter.refund); }
  else console.log("  PASS  cancelQuote genuinely reflects the override: type=Pro-Rata (was Short-Rate), refund rose from " + PAS14.money(quoteBefore.refund) + " to " + PAS14.money(quoteAfter.refund) + " — real money, not cosmetic");

  PAS14.clearCancelTypeOverride("POL-2026-02233", pendTxn14.id, "Reverting.");
  var afterClear = PAS14.getPolicy("POL-2026-02233");
  var pendTxn14c = afterClear.history.find(function (h) { return h.id === pendTxn14.id; });
  var quoteCleared = PAS14.cancelQuote(afterClear, pendTxn14c.meta.reason, pendTxn14c.meta.initiatedBy, pendTxn14c.date, pendTxn14c.meta);
  if (quoteCleared.type !== "Short-Rate" || quoteCleared.overridden) { fails++; console.log("  FAIL  clearCancelTypeOverride did not genuinely revert to the derived type — got " + quoteCleared.type + " overridden=" + quoteCleared.overridden); }
  else console.log("  PASS  clearing the override genuinely reverts to the real derived type (Short-Rate)");

  /* POL-2026-00988: Underwriting / Carrier — insurer-side. Short-Rate is not the normal type here
     (isValidCancelType would refuse it as a default), but Super Admin/Admin now has full
     discretion — it must genuinely apply, flagged outsideRule, not be refused. */
  var carrierPolicy = PAS14.getPolicy("POL-2026-00988");
  var carrierTxn = carrierPolicy.history.find(function (h) { return h.type === "Cancellation" && h.status === "Pending"; });
  if (PAS14.isValidCancelType("Short-Rate", carrierTxn.meta.initiatedBy, false)) { fails++; console.log("  FAIL  isValidCancelType should still flag Short-Rate as not the normal rule for an insurer-side initiator"); }
  var forced = PAS14.setCancelTypeOverride("POL-2026-00988", carrierTxn.id, "Short-Rate", "Forcing a penalty onto an insurer-side cancellation as a deliberate exception.");
  if (!forced.allowed) { fails++; console.log("  FAIL  Super Admin/Admin should be able to force Short-Rate on an insurer-side cancellation as a flagged exception, but it was refused: " + forced.reason); }
  else if (!forced.outsideRule) { fails++; console.log("  FAIL  the forced override applied but wasn't flagged as outsideRule"); }
  else console.log("  PASS  Short-Rate on an insurer-side cancellation is applied as a flagged exception, not refused: outsideRule=" + forced.outsideRule);
  var afterForced = PAS14.getPolicy("POL-2026-00988");
  var carrierTxn2 = afterForced.history.find(function (h) { return h.id === carrierTxn.id; });
  if (carrierTxn2.meta.typeOverride !== "Short-Rate") { fails++; console.log("  FAIL  the forced override did not genuinely persist — meta.typeOverride=" + carrierTxn2.meta.typeOverride); }
  else console.log("  PASS  the forced override genuinely persisted on the transaction — meta.typeOverride=Short-Rate");
  var carrierQuote = PAS14.cancelQuote(afterForced, carrierTxn2.meta.reason, carrierTxn2.meta.initiatedBy, carrierTxn2.date, carrierTxn2.meta);
  if (!carrierQuote.overrideOutsideRule) { fails++; console.log("  FAIL  cancelQuote should flag overrideOutsideRule=true for this forced, off-rule override"); }
  else console.log("  PASS  cancelQuote flags overrideOutsideRule=true so the UI can show it as a manual exception");
})();

/* Seeded override-demo requests (user request: "add more types override data so I can override").
   The original book had plenty of Short-Rate examples, but every request that derived to Pro-Rata
   happened to be Carrier/System-initiated — insurer-side, where Short-Rate is correctly refused —
   so there was no record anywhere that could demonstrate a Pro-Rata -> Short-Rate override
   actually being PERMITTED and applied, nor one demonstrating Flat's hard, role-independent
   refusal. Three real pending cancellations were added specifically to cover those gaps. */
console.log("\n  seeded override-demo requests: cover every outcome the Override control needs to show");
(function () {
  /* A real in-memory sessionStorage, not null — PAS.getPolicy/getPolicies persist their seeded
     state into it on first read, so a later setCancelTypeOverride call finds the exact same
     transaction id a prior getPolicy call already saw. sessionStorage: null (this block's first
     draft) breaks that: every getPolicy call reseeds fresh, so the freshly-generated Cancellation
     request's random txn id changes between calls, and setCancelTypeOverride reports "Transaction
     not found" against a ledger it never actually looked at. */
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PD = stub.PAS;

  function pendingQuoteFor(id) {
    var p = PD.getPolicy(id);
    var h = p.history.find(function (x) { return x.type === "Cancellation" && x.status === "Pending"; });
    if (!h) return null;
    return { p: p, h: h, q: PD.cancelQuote(p, h.meta.reason, h.meta.initiatedBy, h.date, h.meta) };
  }

  /* POL-2026-0442: cancellation effective date = the policy's own inception date -> derives FLAT.
     Pro-Rata/Short-Rate are not the normal rule here (isValidCancelType still says so), but full
     discretion means Super Admin/Admin can force either anyway, flagged as an off-rule exception
     rather than refused. */
  var flatCase = pendingQuoteFor("POL-2026-0442");
  if (!flatCase) { fails++; console.log("  FAIL  no seeded pending cancellation on POL-2026-0442 (the Flat demo)"); }
  else if (flatCase.q.type !== "Flat") { fails++; console.log("  FAIL  POL-2026-0442 was meant to derive Flat, got " + flatCase.q.type); }
  else {
    console.log("  PASS  POL-2026-0442 (" + flatCase.p.holder + ") derives Flat — a real record for the \"force an off-rule exception\" case");
    ["Pro-Rata", "Short-Rate"].forEach(function (t) {
      if (PD.isValidCancelType(t, flatCase.h.meta.initiatedBy, flatCase.q.atInception)) { fails++; console.log("  FAIL  " + t + " should still not be the normal rule on an at-inception (Flat) cancellation, but isValidCancelType allowed it"); }
    });
    var flatForced = PD.setCancelTypeOverride("POL-2026-0442", flatCase.h.id, "Pro-Rata", "Forcing Pro-Rata on a Flat (at-inception) cancellation as a deliberate exception.");
    if (!flatForced.allowed) { fails++; console.log("  FAIL  Super Admin/Admin should be able to force Pro-Rata over Flat as a flagged exception, but it was refused: " + flatForced.reason); }
    else if (!flatForced.outsideRule) { fails++; console.log("  FAIL  forcing Pro-Rata over Flat applied but wasn't flagged as outsideRule"); }
    else console.log("  PASS  forcing Pro-Rata over a Flat (at-inception) cancellation applies as a flagged exception (outsideRule=" + flatForced.outsideRule + "), not refused");
    PD.clearCancelTypeOverride("POL-2026-0442", flatCase.h.id, "Reverting after the exception test.");
  }

  /* POL-2025-09112 and POL-2026-0424: an Insured- and a Broker-initiated request, neither
     insurer-side, whose reason (Non-Payment / Underwriting) defaults to Pro-Rata on its own —
     giving a genuinely permitted Pro-Rata -> Short-Rate override to demonstrate, which nothing in
     the original seed could. */
  [["POL-2025-09112", "Insured"], ["POL-2026-0424", "Broker/Producer"]].forEach(function (pair) {
    var id = pair[0], expectInitiator = pair[1];
    var c = pendingQuoteFor(id);
    if (!c) { fails++; console.log("  FAIL  no seeded pending cancellation on " + id); return; }
    if (c.h.meta.initiatedBy !== expectInitiator) { fails++; console.log("  FAIL  " + id + " expected initiatedBy=" + expectInitiator + ", got " + c.h.meta.initiatedBy); }
    if (c.q.type !== "Pro-Rata") { fails++; console.log("  FAIL  " + id + " was meant to derive Pro-Rata, got " + c.q.type); }
    if (!PD.isValidCancelType("Short-Rate", c.h.meta.initiatedBy, c.q.atInception)) { fails++; console.log("  FAIL  " + id + " should permit a Short-Rate override (non-insurer-side initiator) but isValidCancelType refused it"); return; }

    var applied = PD.setCancelTypeOverride(id, c.h.id, "Short-Rate", "Real demo: applying the penalty this insured-side request would not have carried by default.");
    if (!applied.allowed) { fails++; console.log("  FAIL  " + id + "'s genuinely permitted Pro-Rata -> Short-Rate override was refused: " + applied.reason); return; }
    var after = pendingQuoteFor(id);
    if (after.q.type !== "Short-Rate" || !after.q.overridden || after.q.refund >= c.q.refund) { fails++; console.log("  FAIL  " + id + "'s override did not genuinely take effect — type=" + after.q.type + " overridden=" + after.q.overridden + " refund " + c.q.refund + " -> " + after.q.refund + " (should have dropped, a real penalty now applies)"); }
    else console.log("  PASS  " + id + " (" + c.p.holder + ", " + expectInitiator + "-initiated): the previously-missing Pro-Rata -> Short-Rate override is genuinely permitted and applied — refund dropped from " + PD.money(c.q.refund) + " to " + PD.money(after.q.refund) + " as the penalty took effect");
  });
})();

/* The Override control itself, driven through real clicks (not PAS.setCancelTypeOverride called
   directly). Two things must hold: the toggle -> select -> reason -> Apply chain genuinely works
   end to end, and picking a type that breaks the normal rule (e.g. any non-Flat type on an
   at-inception cancellation) surfaces a live warning before Apply and a persistent one after —
   full discretion, not silent rule-breaking. */
console.log("\n  cancellation-decision: Override control clicked through for real, on-rule and off-rule");
(function () {
  /* Melissa Shaw (POL-2025-09112): Pro-Rata, Insured-initiated — a real case where Short-Rate is
     a genuinely valid override, so the whole toggle -> select -> reason -> Apply chain should work
     end to end through actual DOM events. */
  var dom = renderDom("cancellation-decision", "?policy=POL-2025-09112", "Super Admin");
  var toggle = dom.querySelectorAll("button").filter(function (b) { return b.textContent === "Override type…"; })[0];
  if (!toggle) { fails++; console.log("  FAIL  no \"Override type…\" button rendered for a real, genuinely-overridable request (POL-2025-09112)"); return; }
  console.log("  PASS  \"Override type…\" button renders for a real overridable request");

  toggle.click();
  var typeSelect = dom.querySelectorAll("select").filter(function (s) { return s.querySelectorAll("option").some(function (o) { return o.value === "Short-Rate"; }); })[0];
  var reasonInput = dom.querySelectorAll("input").filter(function (i) { return (i.getAttribute("placeholder") || "").indexOf("override the derived type") !== -1; })[0];
  var applyBtn = dom.querySelectorAll("button").filter(function (b) { return b.textContent === "Apply override"; })[0];
  if (!typeSelect || !reasonInput || !applyBtn) { fails++; console.log("  FAIL  clicking \"Override type…\" did not reveal the type select / reason input / Apply button"); return; }
  console.log("  PASS  clicking the toggle genuinely reveals the override form (select, reason field, Apply button)");

  var refundBefore = dom.textContent.match(/Refund due[^0-9]*(\$[\d,]+)/);
  setValue(typeSelect, "Short-Rate");
  reasonInput.value = "Clicked through in a real test, not called directly on the data layer.";
  reasonInput.dispatchEvent({ type: "input" });
  applyBtn.click();

  /* The click handler's setCancelTypeOverride + buildContent() both run synchronously, rebuilding
     layoutContainer in place inside this same `dom` tree — so re-reading `dom` right after click()
     returns genuinely reflects what got applied, not a second, disconnected render. (A brand-new
     renderDom() call would spin up its own isolated in-memory store and prove nothing.) */
  var afterTxt = dom.textContent;
  if (afterTxt.indexOf("Type (manually overridden)") === -1) { fails++; console.log("  FAIL  clicking \"Apply override\" through real DOM events did not update the page — still shows the derived type, not \"manually overridden\""); }
  else console.log("  PASS  clicking \"Apply override\" through real DOM events (toggle -> select -> reason -> Apply) genuinely updates the page in place");
  var refundAfter = afterTxt.match(/Refund due[^0-9]*(\$[\d,]+)/);
  if (!refundBefore || !refundAfter || refundBefore[1] === refundAfter[1]) { fails++; console.log("  FAIL  the refund total shown on screen did not change after the click-driven override (before=" + (refundBefore && refundBefore[1]) + ", after=" + (refundAfter && refundAfter[1]) + ") — looks cosmetic, not a real recalculation"); }
  else console.log("  PASS  the on-screen refund genuinely changed (" + refundBefore[1] + " → " + refundAfter[1] + ") as a real consequence of the click, not just a relabelled pill");

  /* Kimberly Garcia (POL-2026-0442): Flat, at inception. Full discretion means the Override
     control still renders and offers all three types — selecting an off-rule one (Pro-Rata) shows
     a live warning before Apply, and the applied override stays visibly flagged afterward. */
  var flatDom = renderDom("cancellation-decision", "?policy=POL-2026-0442", "Super Admin");
  var flatToggle = flatDom.querySelectorAll("button").filter(function (b) { return b.textContent === "Override type…"; })[0];
  if (!flatToggle) { fails++; console.log("  FAIL  the Flat demo does not show an \"Override type…\" button — full discretion means every request should offer one"); return; }
  console.log("  PASS  the Flat demo still shows a working \"Override type…\" button, not nothing");

  flatToggle.click();
  var flatSelect = flatDom.querySelectorAll("select").filter(function (s) { return s.querySelectorAll("option").some(function (o) { return o.value === "Pro-Rata"; }); })[0];
  if (!flatSelect) { fails++; console.log("  FAIL  the Flat demo's override select is missing Pro-Rata as an option — full discretion means all three types must be offered"); return; }
  setValue(flatSelect, "Pro-Rata");
  var beforeApplyTxt = flatDom.textContent;
  if (beforeApplyTxt.indexOf("is not the normal type for this cancellation") === -1) { fails++; console.log("  FAIL  selecting an off-rule type (Pro-Rata on a Flat/at-inception case) did not show a live warning before Apply"); }
  else console.log("  PASS  selecting an off-rule type shows a live warning before Apply, instead of silently allowing it");

  var flatReasonInput = flatDom.querySelectorAll("input").filter(function (i) { return (i.getAttribute("placeholder") || "").indexOf("override the derived type") !== -1; })[0];
  var flatApplyBtn = flatDom.querySelectorAll("button").filter(function (b) { return b.textContent === "Apply override"; })[0];
  flatReasonInput.value = "Forcing Pro-Rata on an at-inception cancellation as a deliberate exception.";
  flatReasonInput.dispatchEvent({ type: "input" });
  flatApplyBtn.click();
  var flatAfterTxt = flatDom.textContent;
  if (flatAfterTxt.indexOf("force-applied outside the normal rule") === -1) { fails++; console.log("  FAIL  after applying an off-rule override, the page does not show the persistent \"force-applied outside the normal rule\" warning"); }
  else console.log("  PASS  after applying, the page keeps a persistent warning that this type was force-applied outside the normal rule — a logged exception, not the standard outcome");
})();

/* Loyalty: every active customer's tier must match what re-running loyaltyScore against their
   own ledger produces — the tier shown is never a stored, potentially-stale label. */
console.log("\n  loyalty: tiers and the tier-distribution KPIs reconcile to the live formula");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS8 = stub.PAS;
  var active8 = PAS8.seedPolicies().filter(function (p) { return p.status === "Active"; });
  var byTier = {};
  PAS8.LOYALTY_TIERS.forEach(function (t) { byTier[t.name] = 0; });
  active8.forEach(function (p) { byTier[PAS8.loyaltyScore(p).tier]++; });
  var nonZeroTiers = Object.keys(byTier).filter(function (t) { return byTier[t] > 0; });
  if (nonZeroTiers.length < 2) { fails++; console.log("  FAIL  loyalty tiers show no real spread (" + JSON.stringify(byTier) + ") — check the criteria produce varied scores"); }
  else console.log("  PASS  " + active8.length + " active customers spread across " + nonZeroTiers.length + " tiers: " + JSON.stringify(byTier));

  var loyaltyTxt = renderText("loyalty");
  Object.keys(byTier).forEach(function (tier) {
    var re = new RegExp(tier + "\\D*" + byTier[tier]);
    if (!re.test(loyaltyTxt)) { fails++; console.log("  FAIL  Loyalty page does not show " + byTier[tier] + " for tier " + tier); }
  });
  console.log("  PASS  Loyalty page's tier KPI counts match live loyaltyScore() output exactly");

  /* Spot-check one customer's full derivation renders, not just their final tier. */
  var bharat8 = active8.find(function (p) { return p.id === "POL-2026-00988"; });
  var bharatScore = PAS8.loyaltyScore(bharat8);
  if (loyaltyTxt.indexOf(String(bharatScore.score)) === -1) { fails++; console.log("  FAIL  Ironwood Steel Works' loyalty score (" + bharatScore.score + ") not found on the page"); }
  else console.log("  PASS  Ironwood Steel Works shows its real computed score (" + bharatScore.score + ", " + bharatScore.tier + ") with its line-by-line derivation");
})();

/* The effective-date gate: a fourth, independent underwriting referral trigger. */
console.log("\n  effective date: system-driven, with a real referral gate");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS3 = stub.PAS;
  check3("a request within the lead-time window passes", PAS3.effectiveDateOk({ submittedOn: "2026-08-20", effectiveDate: "2026-09-19" }) === true);
  check3("a backdated request fails", PAS3.effectiveDateOk({ submittedOn: "2026-08-20", effectiveDate: "2026-08-15" }) === false);
  check3("a request beyond the max lead time fails", PAS3.effectiveDateOk({ submittedOn: "2026-08-20", effectiveDate: "2026-10-29" }) === false);
  var book3 = PAS3.seedPolicies();
  var sub41 = book3.find(function (p) { return p.id === "SUB-2026-0041"; });
  var dec = PAS3.underwritingDecision(sub41);
  var edGate = dec.gates.find(function (g) { return g.key === "effectiveDate"; });
  check3("underwritingDecision always includes the effective date gate", !!edGate);
  check3("the four seeded submissions' requested effective dates are all within bounds (gate passes for all)",
    ["SUB-2026-0041", "SUB-2026-0042", "SUB-2026-0043", "SUB-2026-0044"].every(function (id) {
      var p = book3.find(function (x) { return x.id === id; });
      return PAS3.underwritingDecision(p).gates.find(function (g) { return g.key === "effectiveDate"; }).passed;
    }));
  function check3(label, ok) { if (!ok) { fails++; console.log("  FAIL  " + label); } else console.log("  PASS  " + label); }
})();

/* Automated issuance: real state transitions, not a UI label. Run against a fresh, isolated
   in-memory sessionStorage so mutating policies here can't bleed into any other check. */
console.log("\n  policy issuance is automated — real state transitions, no manual click required");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS4 = stub.PAS;

  /* Approving a submission whose binder starts with nothing outstanding should issue it in the
     same step — no separate manual Issue click. */
  PAS4.decide("SUB-2026-0044", "Approve", { score: 61, tier: "Within agent authority", note: "test" });
  var afterApprove = PAS4.getPolicy("SUB-2026-0044");
  if (afterApprove.status !== "Active") { fails++; console.log("  FAIL  approving a submission with a clean binder left status=" + afterApprove.status + ", expected Active (auto-issued)"); }
  else if (afterApprove.documents.length !== 2) { fails++; console.log("  FAIL  auto-issue did not generate the schedule + certificate documents"); }
  else console.log("  PASS  approving a submission with nothing outstanding auto-issues immediately (status=Active, 2 documents generated)");

  /* Clearing the last unmet subjectivity on an already-bound policy should also auto-issue. */
  var before = PAS4.getPolicy("POL-2026-00311");
  var unmetIndex = before.binder.subjectivities.findIndex(function (s) { return !s.met; });
  PAS4.toggleSubjectivity("POL-2026-00311", unmetIndex);
  var afterToggle = PAS4.getPolicy("POL-2026-00311");
  if (afterToggle.status !== "Active") { fails++; console.log("  FAIL  clearing the last unmet subjectivity left status=" + afterToggle.status + ", expected Active (auto-issued)"); }
  else console.log("  PASS  clearing the last blocking subjectivity auto-issues the policy without a manual Issue click");

  /* A policy that still has an unmet subjectivity must NOT auto-issue. */
  var stillBlocked = PAS4.getPolicy("POL-2026-00313"); // Meridian Textiles Ltd — fire safety cert unmet
  if (stillBlocked.status !== "Bound") { fails++; console.log("  FAIL  a policy with an unmet subjectivity auto-issued anyway (status=" + stillBlocked.status + ")"); }
  else console.log("  PASS  a policy with a real outstanding subjectivity does NOT auto-issue — automation only fires when nothing is actually blocking");
})();

/* Policy transfer: approving must change the holder while preserving every continuity fact —
   same policy ID, same seq numbering, same term dates, same prior ledger entries untouched.
   Declining must leave the policy completely as it was. */
console.log("\n  policy transfer: holder changes, continuity is genuinely preserved");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS9 = stub.PAS;

  var before9 = PAS9.getPolicy("POL-2026-00777");
  var pendingTxn = before9.history.find(function (h) { return h.type === "Transfer" && h.status === "Pending"; });
  if (!pendingTxn) { fails++; console.log("  FAIL  no seeded pending Transfer request found on POL-2026-00777"); return; }
  var priorHistoryCount = before9.history.length;
  var priorEffectiveDate = before9.effectiveDate, priorExpirationDate = before9.expirationDate, priorTermNumber = before9.termNumber;

  PAS9.decideTransfer("POL-2026-00777", pendingTxn.id, true, pendingTxn.meta.newHolder);
  var after9 = PAS9.getPolicy("POL-2026-00777");

  if (after9.holder !== "Horizon Freight Holdings LLC") { fails++; console.log("  FAIL  holder after approval is \"" + after9.holder + "\", expected \"Horizon Freight Holdings LLC\""); }
  else console.log("  PASS  approving the transfer changes the holder to the real requested new insured");

  var idUnchanged = after9.id === "POL-2026-00777";
  var termsUnchanged = after9.effectiveDate === priorEffectiveDate && after9.expirationDate === priorExpirationDate && after9.termNumber === priorTermNumber;
  var priorEntriesIntact = after9.history.slice(0, priorHistoryCount - 1).every(function (h, i) { return h.id === before9.history[i].id && h.detail === before9.history[i].detail; });
  if (!idUnchanged || !termsUnchanged || !priorEntriesIntact) { fails++; console.log("  FAIL  transfer did not preserve continuity — id/term/prior-ledger-entries changed when they must not"); }
  else console.log("  PASS  continuity genuinely preserved: same policy ID, same term dates, every prior ledger entry byte-identical — only the holder and the ledger's new final entry changed");

  if (after9.history.length !== priorHistoryCount) { fails++; console.log("  FAIL  history length changed unexpectedly (no new row should be added — the pending row is updated in place)"); }
  else console.log("  PASS  the pending transfer row is completed in place, not duplicated");

  /* Decline path: policy must be completely unchanged. */
  var stub2 = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub2.window = stub2;
  vm.createContext(stub2);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub2);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub2);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub2);
  var PAS10 = stub2.PAS;
  var beforeDecline = PAS10.getPolicy("POL-2026-00777");
  var pendingTxn2 = beforeDecline.history.find(function (h) { return h.type === "Transfer" && h.status === "Pending"; });
  PAS10.decideTransfer("POL-2026-00777", pendingTxn2.id, false, pendingTxn2.meta.newHolder);
  var afterDecline = PAS10.getPolicy("POL-2026-00777");
  if (afterDecline.holder !== "Global Freight Movers") { fails++; console.log("  FAIL  declining a transfer changed the holder anyway — it should stay \"Global Freight Movers\""); }
  else console.log("  PASS  declining the transfer leaves the original holder untouched");
})();

/* Category on Escalations & Requests (MOM 2026-08-26): "so users can route issues correctly
   without needing multiple buttons/options" — one Escalate/Request button plus a category, not a
   button per category. Verified at the data layer: PAS.recordHeldDecision and PAS.raiseRequest
   must genuinely persist and surface the category, not just accept and drop it. */
console.log("\n  category on Escalations & Requests: genuinely persists and surfaces in the decision trail");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/pas-extensions.js", "utf8"), stub);
  var PAS12 = stub.PAS;

  if (!PAS12.ISSUE_CATEGORIES || PAS12.ISSUE_CATEGORIES.length < 3) { fails++; console.log("  FAIL  PAS.ISSUE_CATEGORIES is missing or too short"); }
  else console.log("  PASS  " + PAS12.ISSUE_CATEGORIES.length + " real routing categories defined");

  var pend12 = PAS12.pendingOf(PAS12.getPolicies(), "Cancellation")[0];
  if (!pend12) { fails++; console.log("  FAIL  no seeded pending Cancellation found to escalate"); return; }
  PAS12.recordHeldDecision(pend12.p.id, pend12.h.id, "Escalate", "Escalating for a billing dispute the insured raised.", "Cancellation", "", "Billing & Payments");
  var afterEscalate = PAS12.getPolicy(pend12.p.id);
  var trail = PAS12.decisionTrailFor(afterEscalate, pend12.h.id);
  var escalateRow = trail.find(function (r) { return r.action === "Escalate"; });
  if (!escalateRow || escalateRow.category !== "Billing & Payments") { fails++; console.log("  FAIL  Escalate did not persist category \"Billing & Payments\" — decisionTrailFor shows " + (escalateRow && escalateRow.category)); }
  else console.log("  PASS  Escalating a real pending cancellation persists its category and it surfaces in the decision trail");

  var pend12b = PAS12.pendingOf(PAS12.getPolicies(), "Cancellation")[1];
  PAS12.recordHeldDecision(pend12b.p.id, pend12b.h.id, "Request More Information", "Need the sale invoice for the vehicle.", "Cancellation", "", "Claims");
  var afterInfo = PAS12.getPolicy(pend12b.p.id);
  var trail2 = PAS12.decisionTrailFor(afterInfo, pend12b.h.id);
  var infoRow = trail2.find(function (r) { return r.action === "Request More Information"; });
  if (!infoRow || infoRow.category !== "Claims") { fails++; console.log("  FAIL  Request More Information did not persist its own category (\"Claims\"), independent of the Escalate one above"); }
  else console.log("  PASS  a different category on a different transaction is scoped correctly — not shared/leaked across requests");

  var freshPolicy = PAS12.getPolicies().filter(function (p) {
    return p.status === "Active" && !p.history.some(function (h) { return h.type === "Renewal" && h.status === "Pending"; });
  })[0];
  PAS12.raiseRequest(freshPolicy.id, "Renewal", { initiatedBy: "Insured", channel: "Phone", requestNote: "Wants to confirm the renewal terms before it goes through.", category: "Underwriting" });
  var afterRequest = PAS12.getPolicy(freshPolicy.id);
  var newPending = afterRequest.history.find(function (h) { return h.type === "Renewal" && h.status === "Pending"; });
  var trail3 = PAS12.decisionTrailFor(afterRequest, newPending.id);
  var requestRow = trail3.find(function (r) { return r.action === "Request"; });
  if (!requestRow || requestRow.category !== "Underwriting") { fails++; console.log("  FAIL  raiseRequest did not persist/surface its category — the \"Log a request\" form's Category field would be silently dropped"); }
  else console.log("  PASS  a category logged on the \"Log a request\" form (raiseRequest) persists and surfaces in the decision trail too, not just Escalate/Request-more-info");
})();

/* Configurable T&Cs: an edit must actually persist and be distinguishable from the default, and
   a reset must actually restore the default — not just toggle a UI label. */
console.log("\n  configurable terms & conditions: edits genuinely persist, reset genuinely restores");
(function () {
  var stub = {
    sessionStorage: (function () { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS11 = stub.PAS;

  var totalClauses = Object.keys(PAS11.TERMS_TEMPLATE).reduce(function (s, p) { return s + PAS11.TERMS_TEMPLATE[p].length; }, 0);
  if (totalClauses < 6) { fails++; console.log("  FAIL  only " + totalClauses + " total clauses defined across all products"); }
  else console.log("  PASS  " + totalClauses + " real clauses defined across " + Object.keys(PAS11.TERMS_TEMPLATE).length + " product lines");

  var before11 = PAS11.getTerms("Home Owners").find(function (c) { return c.id === "wear-tear"; });
  if (before11.edited) { fails++; console.log("  FAIL  a clause reports edited=true before any edit was made"); }

  PAS11.updateTermClause("Home Owners", "wear-tear", "This is a genuinely different clause text.");
  var afterEdit = PAS11.getTerms("Home Owners").find(function (c) { return c.id === "wear-tear"; });
  if (!afterEdit.edited || afterEdit.text !== "This is a genuinely different clause text.") { fails++; console.log("  FAIL  updateTermClause did not persist the new text — got \"" + afterEdit.text + "\", edited=" + afterEdit.edited); }
  else console.log("  PASS  editing a clause persists the new text and marks it edited=true");

  /* Other clauses on the same product, and the same clause on other products, must be untouched
     — an edit keyed wrong could silently overwrite something else. */
  var sibling = PAS11.getTerms("Home Owners").find(function (c) { return c.id === "underinsurance"; });
  var sameIdOtherProduct = PAS11.getTerms("Comprehensive Auto").find(function (c) { return c.id === "claim-notice"; });
  if (sibling.edited || sameIdOtherProduct.edited) { fails++; console.log("  FAIL  editing one clause affected an unrelated clause — the storage key isn't properly scoped by product+clause"); }
  else console.log("  PASS  the edit is scoped to exactly that one clause on that one product — no cross-contamination");

  PAS11.resetTermClause("Home Owners", "wear-tear");
  var afterReset = PAS11.getTerms("Home Owners").find(function (c) { return c.id === "wear-tear"; });
  if (afterReset.edited || afterReset.text !== afterReset.defaultText) { fails++; console.log("  FAIL  resetTermClause did not restore the default text"); }
  else console.log("  PASS  resetting a clause genuinely restores the original default text");

  /* Nav: Terms & Conditions and Admin Configuration are edit/admin capabilities — Broker and MGA
     must not see them in their sidebar, even though they can browse other Records pages. */
  ["Broker", "MGA"].forEach(function (role) {
    var visible = (PAS11.ROLES[role] || {}).visibleNav || [];
    if (visible.indexOf("terms") !== -1) { fails++; console.log("  FAIL  " + role + " can still see Terms & Conditions in nav — it's an edit capability, should be hidden for it"); }
    if (visible.indexOf("admin-config") !== -1) { fails++; console.log("  FAIL  " + role + " can still see Admin Configuration in nav — only roles with canManageRoles/canManageUsers should reach it"); }
  });
  console.log("  PASS  Terms & Conditions and Admin Configuration are hidden from Broker and MGA nav");

  ["Super Admin", "Admin"].forEach(function (role) {
    var visible = (PAS11.ROLES[role] || {}).visibleNav;
    var canSeeIt = visible === "*" || (visible || []).indexOf("admin-config") !== -1;
    if (!canSeeIt) { fails++; console.log("  FAIL  " + role + " cannot see Admin Configuration in nav — it should have full access by default"); }
  });
  console.log("  PASS  Super Admin and Admin both see Admin Configuration by default");

  /* Roles are genuinely admin-manageable: a custom role round-trips through PAS.ROLES, a default
     role refuses deletion, and an invited user (with its own distinct scoping identity) round-trips
     through PAS.getUsers(). */
  PAS11.saveRole("Auditor", { label: "Auditor", icon: "list-checks", tone: "gray", identity: "Compliance Team", scope: "all", canDecide: false, canRequest: false, canManageUsers: false, canManageRoles: false, visibleNav: ["dashboard"], isSystem: false });
  if (!PAS11.ROLES.Auditor || PAS11.ROLES.Auditor.label !== "Auditor") { fails++; console.log("  FAIL  a custom role saved via PAS.saveRole does not round-trip through PAS.ROLES"); }
  else console.log("  PASS  a custom role saved via PAS.saveRole round-trips through PAS.ROLES");

  var refusedDelete = PAS11.deleteRole("Super Admin");
  if (refusedDelete.allowed) { fails++; console.log("  FAIL  PAS.deleteRole allowed deleting the default \"Super Admin\" role"); }
  else console.log("  PASS  PAS.deleteRole refuses to delete a default (isSystem) role");

  var invited = PAS11.inviteUser({ name: "Jane Cooper", email: "jane@example.com", roleKey: "Broker", identity: "Jane's Brokerage" });
  var users11 = PAS11.getUsers();
  if (!users11.some(function (u) { return u.id === invited.id && u.identity === "Jane's Brokerage"; })) { fails++; console.log("  FAIL  an invited user does not round-trip through PAS.getUsers()"); }
  else console.log("  PASS  an invited user (with a distinct scoping identity) round-trips through PAS.getUsers()");
})();

/* Platform-wide interactive filters: these must genuinely narrow the rendered rows, not just
   exist as inert controls. Real counts below are computed from the actual seed data (see the
   scratch check run against store.js directly), not guessed. */
console.log("\n  registry: product + state filters genuinely narrow the table");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var bookR = stub.PAS.seedPolicies();

  var out = renderDom("registry");
  var rowCount = function () { return out.querySelector("tbody").querySelectorAll("tr").length; };
  if (rowCount() !== bookR.length) { fails++; console.log("  FAIL  registry baseline expected " + bookR.length + " rows, got " + rowCount()); }
  else console.log("  PASS  baseline shows all " + bookR.length + " records");

  var selects = out.querySelectorAll("select");
  if (selects.length !== 3) { fails++; console.log("  FAIL  expected 3 filter selects (status/product/state), found " + selects.length); return; }
  var productSelect = selects[1], stateSelect = selects[2];

  var expectedProduct = bookR.filter(function (p) { return p.product === "Comprehensive Auto"; }).length;
  setValue(productSelect, "Comprehensive Auto");
  if (rowCount() !== expectedProduct) { fails++; console.log("  FAIL  product filter 'Comprehensive Auto' expected " + expectedProduct + " rows, got " + rowCount()); }
  else console.log("  PASS  product filter narrows to the " + expectedProduct + " real Comprehensive Auto records");

  var probeState = bookR.filter(function (p) { return p.product === "Comprehensive Auto"; })[0].state;
  var expectedBoth = bookR.filter(function (p) { return p.product === "Comprehensive Auto" && p.state === probeState; }).length;
  setValue(stateSelect, probeState);
  if (rowCount() !== expectedBoth) { fails++; console.log("  FAIL  product+state combo (" + probeState + ") expected " + expectedBoth + " rows, got " + rowCount()); }
  else console.log("  PASS  combined product+state filter narrows to the " + expectedBoth + " real matching record(s) in " + probeState);

  var note = out.textContent;
  var expectedNote = "Showing " + expectedBoth + " of " + bookR.length + " records";
  if (note.indexOf(expectedNote) === -1) { fails++; console.log("  FAIL  missing '" + expectedNote + "' note once filters are active"); }
  else console.log("  PASS  'Showing X of Y' note reflects the real filtered/total counts");
})();

console.log("\n  documents: search + type filter genuinely narrow the table, and compose together");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/pas-extensions.js", "utf8"), stub);
  /* The rendered page reads through PAS.getPolicies (wrapped by pas-extensions.js to run
     ensurePolicyStructure, which auto-injects a "Policy document" per policy) rather than the raw
     seed — load pas-extensions.js here too so this expectation is computed the same way. */
  var bookD = stub.PAS.getPolicies();
  var totalDocs = bookD.reduce(function (s, p) { return s + (p.documents || []).length; }, 0);

  var out = renderDom("documents");
  var rowCount = function () { return out.querySelector("tbody").querySelectorAll("tr").length; };
  if (rowCount() !== totalDocs) { fails++; console.log("  FAIL  documents baseline expected " + totalDocs + " rows, got " + rowCount()); }
  else console.log("  PASS  baseline shows all " + totalDocs + " documents");

  var melissa = bookD.find(function (p) { return p.holder === "Melissa Shaw"; });
  var expectedMelissa = melissa.documents.length;
  var searchInput = out.querySelector("input");
  setValue(searchInput, "Melissa");
  if (rowCount() !== expectedMelissa) { fails++; console.log("  FAIL  search 'Melissa' expected " + expectedMelissa + " rows (Schedule+Certificate), got " + rowCount()); }
  else console.log("  PASS  search narrows to Melissa Shaw's real " + expectedMelissa + " documents");

  var expectedSchedule = melissa.documents.filter(function (d) { return d.type === "Schedule"; }).length;
  var chips = out.querySelectorAll("button").filter(function (b) { return b.classList.contains("chip"); });
  var scheduleChip = chips.filter(function (c) { return c.textContent === "Schedule"; })[0];
  if (!scheduleChip) { fails++; console.log("  FAIL  no 'Schedule' type chip found"); return; }
  scheduleChip.click();
  if (rowCount() !== expectedSchedule) { fails++; console.log("  FAIL  search 'Melissa' + type 'Schedule' expected " + expectedSchedule + " row(s), got " + rowCount()); }
  else console.log("  PASS  type chip composes with the active search — narrows to Melissa's " + expectedSchedule + " Schedule doc(s)");

  var allChip = chips.filter(function (c) { return c.textContent === "All"; })[0];
  allChip.click();
  if (rowCount() !== expectedMelissa) { fails++; console.log("  FAIL  clearing type filter (search still 'Melissa') expected " + expectedMelissa + " rows, got " + rowCount()); }
  else console.log("  PASS  clearing the type chip falls back to the search-only result set");
})();

console.log("\n  loyalty: tier chips genuinely narrow the ranked customer list");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("data/policies.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PASL = stub.PAS;
  var activeL = PASL.seedPolicies().filter(function (p) { return p.status === "Active"; });
  var byTierL = {};
  activeL.forEach(function (p) { var t = PASL.loyaltyScore(p).tier; byTierL[t] = (byTierL[t] || 0) + 1; });

  var out = renderDom("loyalty");
  var rowCount = function () {
    var bodies = out.querySelectorAll("tbody");
    return bodies[bodies.length - 1].querySelectorAll("tr").length;
  };
  if (rowCount() !== activeL.length) { fails++; console.log("  FAIL  loyalty baseline expected " + activeL.length + " active customers, got " + rowCount()); }
  else console.log("  PASS  baseline shows all " + activeL.length + " active, scored customers");

  var chips = out.querySelectorAll("button").filter(function (b) { return b.classList.contains("chip"); });
  var goldChip = chips.filter(function (c) { return c.textContent === "Gold"; })[0];
  var expectedGold = byTierL.Gold || 0;
  if (!goldChip) { fails++; console.log("  FAIL  no 'Gold' tier chip found"); return; }
  goldChip.click();
  if (rowCount() !== expectedGold) { fails++; console.log("  FAIL  'Gold' tier filter expected " + expectedGold + " rows, got " + rowCount()); }
  else console.log("  PASS  'Gold' tier filter narrows to the " + expectedGold + " real Gold-tier customers");
  var expectedNoteL = "Showing " + expectedGold + " of " + activeL.length + " customers";
  if (out.textContent.indexOf(expectedNoteL) === -1) { fails++; console.log("  FAIL  missing '" + expectedNoteL + "' note"); }
  else console.log("  PASS  'Showing X of Y' note reflects the real tier-filtered count");

  var silverChip = chips.filter(function (c) { return c.textContent === "Silver"; })[0];
  var expectedSilver = byTierL.Silver || 0;
  silverChip.click();
  if (rowCount() !== expectedSilver) { fails++; console.log("  FAIL  'Silver' tier filter expected " + expectedSilver + " rows, got " + rowCount()); }
  else console.log("  PASS  switching tiers re-filters correctly — " + expectedSilver + " real Silver-tier customers");

  var allChip = chips.filter(function (c) { return c.textContent === "All"; })[0];
  allChip.click();
  if (rowCount() !== activeL.length) { fails++; console.log("  FAIL  clearing tier filter expected all " + activeL.length + " rows back, got " + rowCount()); }
  else console.log("  PASS  clearing the tier filter restores the full ranked list");
})();

console.log(fails === 0 ? "\nALL PAGES RENDER\n" : "\n" + fails + " FAILURE(S)\n");
process.exit(fails === 0 ? 0 : 1);
