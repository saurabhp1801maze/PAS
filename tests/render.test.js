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

var CORE = ["assets/js/icons.js", "data/policies.js", "assets/js/store.js", "assets/js/pas-extensions.js", "assets/js/api.js", "assets/js/ui.js", "assets/js/entity-book.js"];
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
  ["architecture", ["At-least-once", "Camunda 8", "outbox", "Not yet", "Connected carriers", "Meridian Assurance Co.", "Composable modules"]],
  ["underwriting", ["Referred on", "Authority", "Score"]],
  ["dashboard", ["Total policies", "Active policies", "Renewed", "Expiring soon", "Endorsement requests", "Reinstated", "Cancelled", "Awaiting decision", "Monthly", "Yearly", "New business issued", "Cancelled policy requests"]],
  ["cancellation", ["Auto-cancelled (non-payment)", "Reason, notice & default type", "Sold Vehicle/Business", "Non-Payment", "Refunds by type", "Refunds by reason"]],
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
   - F-15 (double-counted "Awaiting decision") must stay fixed.
   - F-16 (mislabeled GWP + hardcoded retention/deltas) must stay fixed.
   - The redesign that replaced the sectioned KPI groups with a single 8-card strip (Total/Active/
     Renewed/Expiring soon/Endorsement requests/Reinstated/Cancelled/Awaiting decision) plus the
     Monthly/Yearly period toggle and the 4 "open desk" work-cards must not silently regress to
     the previous layout. */
console.log("\n  dashboard regression checks (F-15, F-16, KPI redesign)");
(function () {
  var txt = renderText("dashboard");
  [
    "Gross written premium", "91%", "+8.2%", "-1.4%",           /* original hardcoded literals */
    "In-force premium", "Avg premium", "Product lines",          /* superseded KPI tiles */
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
  var pending = PAS.allTxns(policies).map(function (t) { return t.h; }).filter(function (h) { return h.status === "Pending"; });
  var fixedTotal = pending.length + bound.length;
  var oldDoubleCountedTotal = referred.length + bound.length + pending.length;
  if (fixedTotal === oldDoubleCountedTotal) { fails++; console.log("  FAIL  fixed formula coincides with the old double-counted one — test is not discriminating"); }
  var m = txt.match(/Awaiting decision(\d+)/);
  if (!m) { fails++; console.log('  FAIL  could not find rendered "Awaiting decision" value'); }
  else if (Number(m[1]) !== fixedTotal) { fails++; console.log("  FAIL  Awaiting decision renders " + m[1] + ", expected " + fixedTotal + " (pending " + pending.length + " + bound " + bound.length + ", NOT +referred " + referred.length + ")"); }
  else console.log("  PASS  Awaiting decision = " + fixedTotal + " (pending " + pending.length + " + bound " + bound.length + "), not the old double-counted " + oldDoubleCountedTotal);

  var dom = renderDom("dashboard");
  var kpiRow = dom.querySelector(".kpi-row");
  if (!kpiRow || !kpiRow.classList.contains("wrap")) { fails++; console.log("  FAIL  KPI row is missing the 4-per-row \"wrap\" layout class"); }
  else console.log('  PASS  KPI row uses the fixed 4-per-row grid (".kpi-row.wrap")');
  var kpiCards = dom.querySelectorAll(".kpi-card");
  if (kpiCards.length !== 8) { fails++; console.log("  FAIL  expected exactly 8 KPI cards, found " + kpiCards.length); }
  else console.log("  PASS  exactly 8 KPI cards render (2 rows of 4)");
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

  /* Renewal pipeline is capped at 5, most-urgent-first, with a "showing N of M" note and a
     "View more" link to renewal.html only when the list is actually longer than the cap. */
  var panels = dom.querySelectorAll(".panel");
  var renewalPanel, cancelPanel;
  panels.forEach(function (p) {
    var t = p.querySelector(".panel-title").textContent;
    if (t.indexOf("Renewal pipeline") === 0) renewalPanel = p;
    if (t.indexOf("Cancelled policy requests") === 0) cancelPanel = p;
  });
  var activeCount = policies.filter(function (p) { return p.status === "Active"; }).length;
  var renewalRows = renewalPanel.querySelectorAll(".hbar").length;
  if (renewalRows > 5) { fails++; console.log("  FAIL  Renewal pipeline shows " + renewalRows + " rows, expected at most 5"); }
  else if (activeCount > 5 && renewalRows !== 5) { fails++; console.log("  FAIL  Renewal pipeline has " + activeCount + " active policies but shows only " + renewalRows + ", expected the full cap of 5"); }
  else if (activeCount > 5 && renewalPanel.textContent.indexOf("View more") === -1) { fails++; console.log('  FAIL  Renewal pipeline exceeds the cap but is missing its "View more" link'); }
  else console.log("  PASS  Renewal pipeline capped at " + renewalRows + " rows (book has " + activeCount + " active policies), with a View more link to renewal.html");

  /* "Cancelled policy requests" replaced "Bound policies": open cancellation requests (not yet
     decided), ranked by their live refund quote — the same cancelQuote the Cancellation desk
     itself shows for these same rows, so the two screens can never disagree — biggest exposure
     first, capped at 5 with a "View more" link to cancellation.html only when there are more. */
  var pendingCx = PAS.pendingOf(policies, "Cancellation").map(function (t) {
    var meta = t.h.meta || {};
    var reason = meta.reason || "Insured Request";
    var initiatedBy = meta.initiatedBy || "Insured";
    var effDate = t.h.date || PAS.todayISO();
    return Math.round(PAS.cancelQuote(t.p, reason, initiatedBy, effDate).refund);
  }).sort(function (a, b) { return b - a; });
  var cancelRows = cancelPanel.querySelectorAll(".hbar").length;
  var expectedCancelRows = Math.min(pendingCx.length, 5);
  if (cancelRows > 5) { fails++; console.log("  FAIL  Cancelled policy requests shows " + cancelRows + " rows, expected at most 5"); }
  else if (cancelRows !== expectedCancelRows) { fails++; console.log("  FAIL  Cancelled policy requests shows " + cancelRows + " rows, expected " + expectedCancelRows + " (min of the book's " + pendingCx.length + " open requests and the cap of 5)"); }
  else console.log("  PASS  Cancelled policy requests shows " + cancelRows + " of " + pendingCx.length + " open requests, ranked by refund amount");
  if (pendingCx.length > 0) {
    var topRefundText = PAS.money(pendingCx[0]);
    if (cancelPanel.textContent.indexOf(topRefundText) === -1) { fails++; console.log('  FAIL  Cancelled policy requests missing its top-ranked real refund amount "' + topRefundText + '"'); }
    else console.log("  PASS  top-ranked cancellation request shows its real refund amount (" + topRefundText + ")");
  }
  if (pendingCx.length > 5 && cancelPanel.textContent.indexOf("View more") === -1) { fails++; console.log('  FAIL  Cancelled policy requests exceeds the cap but is missing its "View more" link'); }
})();

/* Role-based dashboard: the same URL, genuinely different renders. Super Admin/Admin get the
   existing operational dashboard (already covered above, at the default no-role state); MGA gets
   a read-only, scoped-to-own-book portfolio-analytics view; Broker gets a scoped, filtered book
   of their own placements. */
console.log("\n  role-based dashboards (default = Super Admin, no role stored)");
(function () {
  var underwriterTxt = renderText("dashboard", "", null);
  ["Portfolio Dashboard", "Renewal pipeline", "Cancelled policy requests"].forEach(function (needle) {
    if (underwriterTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  default (no role set) dashboard missing "' + needle + '" — should default to Super Admin'); }
  });
  console.log("  PASS  no role stored defaults to the Super Admin operational dashboard");

  var mgaTxt = renderText("dashboard", "", "MGA");
  ["Dashboard", "In-force premium", "Premium by state", "Premium by broker", "Written premium by product", "New business issued", "Claims & reserves", "Loss ratio", "Cornerstone MGA Partners"].forEach(function (needle) {
    if (mgaTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  MGA dashboard missing "' + needle + '"'); }
  });
  /* Conversion rate and Requests pending are gone entirely (not present anywhere on this
     dashboard, unlike Loss ratio/Open reserves which still legitimately appear inside the
     Claims & reserves panel's own "this filter" breakdown). */
  ["Conversion rate", "Requests pending"].forEach(function (banned) {
    if (mgaTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  MGA dashboard still shows the removed "' + banned + '" KPI'); }
  });
  /* Must NOT contain the operational-only panels — those belong to the Super Admin/Admin view only. */
  ["Renewal pipeline", "Cancelled policy requests", "Endorsement requests"].forEach(function (banned) {
    if (mgaTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  MGA dashboard leaked operational panel "' + banned + '"'); }
  });
  console.log("  PASS  MGA dashboard: portfolio KPIs, state/broker/LOB breakdowns, honest Claims & reserves gap, no operational panels, framed around its own book (Cornerstone MGA Partners)");

  /* Broker now shares the exact same dashboard shape as MGA (renderScopedDashboard) — same KPI
     row, same panel layout — with only the second breakdown panel's dimension swapped (MGA
     facility instead of broker, since "premium by broker" on a broker's own dashboard would
     always be one bar, themselves). */
  var brokerTxt = renderText("dashboard", "", "Broker");
  ["Apex Insurance Brokers", "Premium by MGA", "Premium by state", "Written premium by product", "New business issued", "Claims & reserves", "Loss ratio"].forEach(function (needle) {
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
  var bharat = book5.find(function (p) { return p.id === "POL-2026-00988"; });
  var bharatRatio = Math.round(PAS5.lossRatio([bharat]) * 100);
  if (bharatRatio !== 140) { fails++; console.log("  FAIL  Ironwood Steel Works' claim loss ratio is " + bharatRatio + "%, expected exactly 140% to match its cancellation record's own \"adverse loss ratio... 140%\" narrative"); }
  else console.log("  PASS  Ironwood Steel Works' seeded claim ($140,000 incurred ÷ $100,000 premium) computes to exactly 140% — matches its own cancellation narrative, not a coincidence");

  var active5 = book5.filter(function (p) { return p.status === "Active"; });
  var totalClaims = PAS5.allClaims(active5).length;
  var totalReserves = PAS5.reservesTotal(active5);
  if (totalClaims === 0) { fails++; console.log("  FAIL  no claims exist anywhere in the active book"); }
  else console.log("  PASS  " + totalClaims + " real claims on file across the active book, $" + totalReserves.toLocaleString("en-US") + " in open reserves");

  /* MGA is scoped to its own book (Cornerstone MGA Partners), so the loss ratio shown in its
     Claims & reserves panel must be computed over that same subset — the panel's own "this
     filter" figure covers every status (not just Active, since the state/LOB filters default to
     unrestricted), so the expectation matches that same unfiltered-by-status scope. */
  var cornerstoneAll5 = book5.filter(function (p) { return p.mga === "Cornerstone MGA Partners"; });
  var mgaDom2 = renderDom("dashboard", "", "MGA");
  var mgaTxt2 = mgaDom2.textContent.replace(/\s+/g, " ");
  var expectedRatio = Math.round(PAS5.lossRatio(cornerstoneAll5) * 100) + "%";
  if (mgaTxt2.indexOf(expectedRatio) === -1) { fails++; console.log('  FAIL  MGA dashboard does not show its own book\'s real loss ratio "' + expectedRatio + '"'); }
  else console.log("  PASS  MGA dashboard's Claims & reserves panel (" + expectedRatio + ") matches the real computed figure for its own scoped book");
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
  /* Two tables exist on this page — the static Reason/notice reference table first, then the
     pending-requests table — so the *second* tbody is the one the filters act on. sortableTable's
     rebuild() replaces the whole <table> (tableWrap.innerHTML = "" then a fresh dataTable), so
     the tbody must be re-queried after every filter change rather than captured once. */
  function rowCount() {
    var tbodies = out.querySelectorAll("tbody");
    if (tbodies.length !== 2) throw new Error("expected exactly 2 tables (reference + pending requests), found " + tbodies.length + " tbody elements");
    return tbodies[1].querySelectorAll("tr").length;
  }
  if (rowCount() !== pendC.length) { fails++; console.log("  FAIL  Cancellation desk baseline expected " + pendC.length + " pending rows, got " + rowCount()); }
  else console.log("  PASS  baseline shows all " + pendC.length + " pending cancellation requests");

  var selects = out.querySelectorAll("select");
  if (selects.length !== 1) { fails++; console.log("  FAIL  expected exactly 1 LOB filter select on the Cancellation desk, found " + selects.length); return; }
  var productSelect = selects[0];
  var sampleProduct = pendC[0].p.product;
  var expectedProduct = pendC.filter(function (t) { return t.p.product === sampleProduct; }).length;
  setValue(productSelect, sampleProduct);
  if (rowCount() !== expectedProduct) { fails++; console.log("  FAIL  LOB filter '" + sampleProduct + "' expected " + expectedProduct + " rows, got " + rowCount()); }
  else console.log("  PASS  LOB filter narrows to the " + expectedProduct + " real '" + sampleProduct + "' pending requests");
  setValue(productSelect, "All");

  var dateInputs = out.querySelectorAll("input").filter(function (el) { return el.getAttribute("type") === "date"; });
  if (dateInputs.length !== 2) { fails++; console.log("  FAIL  expected exactly 2 (from/to) date filter inputs on the Cancellation desk, found " + dateInputs.length); return; }
  dateInputs[0].value = "2099-01-01";
  dateInputs[0].dispatchEvent({ type: "change" });
  /* A 0-row match still renders one <tr> — dataTable's own "nothing here" placeholder row — so
     the real check is that the surviving row is that empty-state row, not a genuine data row. */
  var emptyMsg = "No cancellation requests match that search.";
  var afterFuture = out.querySelectorAll("tbody")[1].querySelectorAll("tr");
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
  var bookD = stub.PAS.seedPolicies();
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
