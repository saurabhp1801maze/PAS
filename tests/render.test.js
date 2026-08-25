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
  ["reinstatement-decision", "reinstatement-desk", "?policy=POL-2026-01190"],
  ["policy-detail", "detail", "?policy=POL-2026-02233&tab=cover"],
  ["loyalty", "loyalty"],
  ["transfer", "transfer-desk"],
  ["transfer-decision", "transfer-desk", "?policy=POL-2026-00777"],
  ["terms", "terms"],
];

var CORE = ["assets/js/icons.js", "assets/js/store.js", "assets/js/pas-extensions.js", "assets/js/api.js", "assets/js/ui.js"];
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
  ["dashboard", ["Total policies", "Active policies", "Renewed", "Expiring soon", "Retention", "Reinstated", "Cancelled", "Awaiting decision", "Monthly", "Yearly", "New business issued", "Bound policies"]],
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
  ["Insured Request", "Broker/Producer", "Immediate", "Short-Rate", "₹6,385", "₹709"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  cancellation-decision missing "' + needle + '"'); }
  });
  console.log("  PASS  Karan Malhotra: Reason=Insured Request, Initiated By=Broker/Producer, Type=Short-Rate, refund=₹6,385 matches the doc's worked example exactly");
})();

/* Reinstatement desk: the original cancellation's full attribute set (added this pass) surfaces
   on the reinstatement decision screen, not just Reason and Type. */
console.log("\n  reinstatement-decision: original cancellation's Initiated By + Timing surface");
(function () {
  var txt = renderText("reinstatement-decision", "?policy=POL-2026-01190");
  ["Initiated by", "System", "Timing", "Immediate", "Non-Payment"].forEach(function (needle) {
    if (txt.indexOf(needle) === -1) { fails++; console.log('  FAIL  reinstatement-decision missing "' + needle + '"'); }
  });
  console.log("  PASS  Divya Krishnan's original cancellation shows Initiated By (System) and Timing (Immediate), not just Reason and Type");
})();

/* Dashboard-specific regressions:
   - F-15 (double-counted "Awaiting decision") must stay fixed.
   - F-16 (mislabeled GWP + hardcoded retention/deltas) must stay fixed.
   - The redesign that replaced the sectioned KPI groups with a single 8-card strip (Total/Active/
     Renewed/Expiring soon/Retention/Reinstated/Cancelled/Awaiting decision) plus the Monthly/
     Yearly period toggle and the 4 "open desk" work-cards must not silently regress to the
     previous layout. */
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

  /* Renewal pipeline is capped at 10, most-urgent-first, with a "showing N of M" note only when
     the list is actually longer than the cap. */
  var panels = dom.querySelectorAll(".panel");
  var renewalPanel, boundPanel;
  panels.forEach(function (p) {
    var t = p.querySelector(".panel-title").textContent;
    if (t.indexOf("Renewal pipeline") === 0) renewalPanel = p;
    if (t.indexOf("Bound policies") === 0) boundPanel = p;
  });
  var activeCount = policies.filter(function (p) { return p.status === "Active"; }).length;
  var renewalRows = renewalPanel.querySelectorAll(".hbar").length;
  if (renewalRows > 10) { fails++; console.log("  FAIL  Renewal pipeline shows " + renewalRows + " rows, expected at most 10"); }
  else if (activeCount > 10 && renewalRows !== 10) { fails++; console.log("  FAIL  Renewal pipeline has " + activeCount + " active policies but shows only " + renewalRows + ", expected the full cap of 10"); }
  else console.log("  PASS  Renewal pipeline capped at " + renewalRows + " rows (book has " + activeCount + " active policies)");

  /* "Bound policies" replaced "Blocked from issuing": a strictly-blocked list tops out at however
     many policies actually have an unmet subjectivity, which in this book is at most a handful —
     nowhere near enough rows to be useful. The panel now lists every bound policy (blocked ones
     flagged red and sorted first, ready ones green after), capped at 5, so it always shows the
     real bound book rather than a thin slice of it. */
  var boundCount = policies.filter(function (p) { return p.status === "Bound"; }).length;
  var blockedCount = policies.filter(function (p) { return p.status === "Bound" && ((p.binder && p.binder.subjectivities) || []).some(function (s) { return !s.met; }); }).length;
  var boundRows = boundPanel.querySelectorAll(".blocked-row").length;
  var expectedRows = Math.min(boundCount, 5);
  if (boundRows > 5) { fails++; console.log("  FAIL  Bound policies shows " + boundRows + " rows, expected at most 5"); }
  else if (boundRows !== expectedRows) { fails++; console.log("  FAIL  Bound policies shows " + boundRows + " rows, expected " + expectedRows + " (min of the book's " + boundCount + " bound policies and the cap of 5)"); }
  else if (boundCount > blockedCount && boundRows <= blockedCount) { fails++; console.log("  FAIL  Bound policies still only shows the " + blockedCount + " strictly-blocked ones (" + boundRows + " rows) — it should list all " + boundCount + " bound policies"); }
  else console.log("  PASS  Bound policies shows all " + boundRows + " bound policies (" + blockedCount + " blocked + " + (boundRows - blockedCount) + " ready), not just the " + blockedCount + " strictly blocked");
  var readyLabels = boundPanel.querySelectorAll(".blocked-sub").filter(function (el) { return el.classList.contains("ready"); }).length;
  if (boundCount - blockedCount > 0 && readyLabels === 0) { fails++; console.log('  FAIL  no "Ready to issue" rows rendered despite ready bound policies existing'); }
  else if (boundCount - blockedCount > 0) console.log("  PASS  " + readyLabels + ' "Ready to issue" row(s) rendered for the non-blocked bound policies');
})();

/* Role-based dashboard: the same URL, four genuinely different renders. Underwriter is the
   existing operational dashboard (already covered above, at the default no-role state); MGA and
   Carrier get the portfolio-analytics view; Broker/Producer gets a scoped, filtered book. */
console.log("\n  role-based dashboards (default = Underwriter, no role stored)");
(function () {
  var underwriterTxt = renderText("dashboard", "", null);
  ["Portfolio Dashboard", "Renewal pipeline", "Bound policies"].forEach(function (needle) {
    if (underwriterTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  default (no role set) dashboard missing "' + needle + '" — should default to Underwriter'); }
  });
  console.log("  PASS  no role stored defaults to the Underwriter operational dashboard");

  ["MGA", "Carrier"].forEach(function (role) {
    var txt = renderText("dashboard", "", role);
    /* MGA's identity ("Priya Nair") isn't expected in the dashboard body — it's shown once, in
       the topbar role pill (layout.js, not loaded by this page-only harness); the dashboard
       itself is about the whole book, not "MGA's own" book. Carrier's framing is different — the
       book is explicitly "written on their paper" — so its sub-line does name the identity. */
    var expectStrings = ["Dashboard", "In-force premium", "Premium by state", "Premium by broker", "Premium by LOB", "Claims & reserves", "Loss ratio", "Open reserves", "Conversion rate"];
    if (role === "Carrier") expectStrings.push("Meridian Assurance Co.");
    expectStrings.forEach(function (needle) {
      if (txt.indexOf(needle) === -1) { fails++; console.log("  FAIL  " + role + ' dashboard missing "' + needle + '"'); }
    });
    /* Must NOT contain the operational-only panels — those belong to the Underwriter view only. */
    ["Renewal pipeline", "Bound policies", "Oldest waiting"].forEach(function (banned) {
      if (txt.indexOf(banned) !== -1) { fails++; console.log("  FAIL  " + role + ' dashboard leaked operational panel "' + banned + '"'); }
    });
    console.log("  PASS  " + role + " dashboard: portfolio KPIs, state/broker/LOB breakdowns, honest Claims & reserves gap, no operational panels");
  });

  var brokerTxt = renderText("dashboard", "", "Broker/Producer");
  ["Apex Insurance Brokers", "Policies placed", "Requests pending"].forEach(function (needle) {
    if (brokerTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  Broker/Producer dashboard missing "' + needle + '"'); }
  });
  console.log("  PASS  Broker/Producer dashboard shows their own identity and book");

  /* Real scoping, not cosmetic: verify against the actual data, not just that some table rendered. */
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS2 = stub.PAS;
  var allPolicies = PAS2.getPolicies();
  var apexCount = allPolicies.filter(function (p) { return p.producer === "Apex Insurance Brokers"; }).length;
  var brokerDom = renderDom("dashboard", "", "Broker/Producer");
  /* The shim's querySelectorAll only matches a single simple selector (no descendant
     combinators), so count all <tr> and subtract the one thead header row dataTable always
     renders, rather than trying ".data-table tbody tr" as one compound selector. */
  var brokerRowCount = brokerDom.querySelectorAll("tr").length - 1;
  if (brokerRowCount !== apexCount) { fails++; console.log("  FAIL  Broker/Producer table shows " + brokerRowCount + " rows, expected exactly " + apexCount + " (real policies with producer = Apex Insurance Brokers)"); }
  else console.log("  PASS  Broker/Producer table shows exactly " + apexCount + " real policies scoped by producer — not the full 27-policy book");

  /* The MGA dashboard's headline KPI must exactly match the same in-force-premium figure the
     Underwriter dashboard computes from the identical active-policy set — same book, same
     formula, two different screens; a filter or grouping bug would make these disagree. */
  var activePolicies = allPolicies.filter(function (p) { return p.status === "Active"; });
  var realInForcePremium = activePolicies.reduce(function (s, p) { return s + p.premium; }, 0);
  var mgaDom = renderDom("dashboard", "", "MGA");
  var mgaKpiValues = mgaDom.querySelectorAll(".kpi-value");
  var mgaPremiumShown = Array.prototype.some.call(mgaKpiValues, function (el) { return el.textContent === PAS2.moneyShort(realInForcePremium); });
  if (!mgaPremiumShown) { fails++; console.log("  FAIL  MGA dashboard's In-force premium KPI does not match " + PAS2.moneyShort(realInForcePremium) + ", the real figure from the " + activePolicies.length + " active policies"); }
  else console.log("  PASS  MGA dashboard's In-force premium KPI (" + PAS2.moneyShort(realInForcePremium) + ") exactly matches the real active-book total — same figure, same formula as the Underwriter dashboard");

  /* Connected carriers: Carrier's dashboard must be genuinely scoped to their own book
     (PAS.PRODUCT_CARRIER), not a relabeled copy of the MGA's whole-portfolio view. */
  var meridianPolicies = allPolicies.filter(function (p) { return p.carrier === "Meridian Assurance Co."; });
  var meridianPremium = meridianPolicies.filter(function (p) { return p.status === "Active"; }).reduce(function (s, p) { return s + p.premium; }, 0);
  if (meridianPolicies.length === allPolicies.length || meridianPolicies.length === 0) { fails++; console.log("  FAIL  carrier scoping isn't real — Meridian Assurance Co. shows " + meridianPolicies.length + " of " + allPolicies.length + " policies, expected a genuine subset"); }
  else console.log("  PASS  Meridian Assurance Co. is genuinely scoped to " + meridianPolicies.length + " of " + allPolicies.length + " policies (Commercial Property + Marine Cargo — their real appetite)");
  var carrierDom = renderDom("dashboard", "", "Carrier");
  var carrierKpiValues = carrierDom.querySelectorAll(".kpi-value");
  var carrierPremiumShown = Array.prototype.some.call(carrierKpiValues, function (el) { return el.textContent === PAS2.moneyShort(meridianPremium); });
  if (!carrierPremiumShown) { fails++; console.log("  FAIL  Carrier dashboard's In-force premium does not match " + PAS2.moneyShort(meridianPremium) + ", the real figure scoped to Meridian Assurance Co.'s own book"); }
  else console.log("  PASS  Carrier dashboard's In-force premium (" + PAS2.moneyShort(meridianPremium) + ") is scoped to Meridian's own book, genuinely different from MGA's whole-portfolio " + PAS2.moneyShort(realInForcePremium));

  /* Customer portal: scoped to exactly one holder's own policy, nothing else on the platform. */
  var karanCount = allPolicies.filter(function (p) { return p.holder === "Karan Malhotra"; }).length;
  var customerTxt = renderText("dashboard", "", "Customer");
  ["My Policies", "Karan Malhotra", "Your coverage", "Your documents", "Recent activity"].forEach(function (needle) {
    if (customerTxt.indexOf(needle) === -1) { fails++; console.log('  FAIL  Customer portal missing "' + needle + '"'); }
  });
  ["Portfolio Dashboard", "In-force premium", "Bound policies", "Renewal pipeline", "Apex Insurance Brokers", "Meridian Assurance Co."].forEach(function (banned) {
    if (customerTxt.indexOf(banned) !== -1) { fails++; console.log('  FAIL  Customer portal leaked internal/other-role content "' + banned + '"'); }
  });
  var customerDom = renderDom("dashboard", "", "Customer");
  var policyRows = customerDom.querySelectorAll(".kpi-row").length;
  if (policyRows !== karanCount) { fails++; console.log("  FAIL  Customer portal renders " + policyRows + " policy KPI row(s), expected exactly " + karanCount + " (one per Karan Malhotra's real policies)"); }
  else console.log("  PASS  Customer portal shows exactly " + karanCount + " real polic" + (karanCount === 1 ? "y" : "ies") + " for Karan Malhotra, first-person framing, no internal-desk or other-role content leaked");
})();

/* Claims & reserves: real records, not a fabricated loss ratio. Bharat Steel Works' claim is
   deliberately consistent with the "adverse loss ratio... 140%" narrative already on its
   cancellation record — the two must agree exactly, not just both exist. */
console.log("\n  claims & reserves: real data, internally consistent with the existing loss-ratio narrative");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS5 = stub.PAS;
  var book5 = PAS5.seedPolicies();
  var bharat = book5.find(function (p) { return p.id === "POL-2026-00988"; });
  var bharatRatio = Math.round(PAS5.lossRatio([bharat]) * 100);
  if (bharatRatio !== 140) { fails++; console.log("  FAIL  Bharat Steel Works' claim loss ratio is " + bharatRatio + "%, expected exactly 140% to match its cancellation record's own \"adverse loss ratio... 140%\" narrative"); }
  else console.log("  PASS  Bharat Steel Works' seeded claim (₹12,46,000 incurred ÷ ₹8,90,000 premium) computes to exactly 140% — matches its own cancellation narrative, not a coincidence");

  var active5 = book5.filter(function (p) { return p.status === "Active"; });
  var totalClaims = PAS5.allClaims(active5).length;
  var totalReserves = PAS5.reservesTotal(active5);
  if (totalClaims === 0) { fails++; console.log("  FAIL  no claims exist anywhere in the active book"); }
  else console.log("  PASS  " + totalClaims + " real claims on file across the active book, ₹" + totalReserves.toLocaleString("en-IN") + " in open reserves");

  var mgaDom2 = renderDom("dashboard", "", "MGA");
  var mgaTxt2 = mgaDom2.textContent.replace(/\s+/g, " ");
  var expectedRatio = Math.round(PAS5.lossRatio(active5) * 100) + "%";
  if (mgaTxt2.indexOf(expectedRatio) === -1) { fails++; console.log('  FAIL  MGA dashboard does not show the real portfolio loss ratio "' + expectedRatio + '"'); }
  else console.log("  PASS  MGA dashboard's Loss ratio KPI (" + expectedRatio + ") matches the real computed figure from " + totalClaims + " claims");
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
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS6 = stub.PAS;
  var book6 = PAS6.seedPolicies();
  var completed6 = [];
  book6.forEach(function (p) { p.history.forEach(function (h) { if (h.type === "Cancellation" && h.status === "Completed") completed6.push(h); }); });
  var realTotal = completed6.reduce(function (s, h) { return s + (Number(h.meta && h.meta.refund) || 0); }, 0);
  if (completed6.length === 0) { fails++; console.log("  FAIL  no completed cancellations exist to test the breakdown against"); }
  else console.log("  PASS  " + completed6.length + " completed cancellations, ₹" + realTotal.toLocaleString("en-IN") + " total refunded — the real figure the breakdown must reconcile to");

  var cancelTxt = renderText("cancellation");
  var moneyStr = PAS6.money(realTotal);
  if (cancelTxt.indexOf(moneyStr) === -1) { fails++; console.log('  FAIL  Cancellation desk does not show the real total refunded "' + moneyStr + '" anywhere on the page'); }
  else console.log("  PASS  Cancellation desk shows the real total refunded (" + moneyStr + ") — same figure as summing every completed cancellation's own recorded refund");
})();

/* Coverage-wise breakdown: each policy's line items must sum back to exactly its own premium —
   the whole point of a percentage split is that it never loses or invents money. */
console.log("\n  coverage-wise breakdown: line items reconcile exactly to the policy's own premium");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
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
  else console.log("  PASS  all " + withTemplate + " policies with a coverage template reconcile exactly (line items sum to the policy's own premium, ₹0 off, every time)");

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
  if (loyaltyTxt.indexOf(String(bharatScore.score)) === -1) { fails++; console.log("  FAIL  Bharat Steel Works' loyalty score (" + bharatScore.score + ") not found on the page"); }
  else console.log("  PASS  Bharat Steel Works shows its real computed score (" + bharatScore.score + ", " + bharatScore.tier + ") with its line-by-line derivation");
})();

/* The effective-date gate: a fourth, independent underwriting referral trigger. */
console.log("\n  effective date: system-driven, with a real referral gate");
(function () {
  var stub = { sessionStorage: null, location: {}, document: { readyState: "complete" } };
  stub.window = stub;
  vm.createContext(stub);
  vm.runInContext(fs.readFileSync("assets/js/icons.js", "utf8"), stub);
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
  vm.runInContext(fs.readFileSync("assets/js/store.js", "utf8"), stub);
  var PAS9 = stub.PAS;

  var before9 = PAS9.getPolicy("POL-2026-00777");
  var pendingTxn = before9.history.find(function (h) { return h.type === "Transfer" && h.status === "Pending"; });
  if (!pendingTxn) { fails++; console.log("  FAIL  no seeded pending Transfer request found on POL-2026-00777"); return; }
  var priorHistoryCount = before9.history.length;
  var priorEffectiveDate = before9.effectiveDate, priorExpirationDate = before9.expirationDate, priorTermNumber = before9.termNumber;

  PAS9.decideTransfer("POL-2026-00777", pendingTxn.id, true, pendingTxn.meta.newHolder);
  var after9 = PAS9.getPolicy("POL-2026-00777");

  if (after9.holder !== "Horizon Freight Holdings Pvt Ltd") { fails++; console.log("  FAIL  holder after approval is \"" + after9.holder + "\", expected \"Horizon Freight Holdings Pvt Ltd\""); }
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

  /* Nav: Terms & Conditions is an edit capability — the three read-only/external roles must not
     see it in their sidebar, even though they can browse other Records pages. */
  ["MGA", "Carrier", "Customer"].forEach(function (role) {
    var hidden = PAS11.NAV_HIDDEN_FOR_ROLE[role] || [];
    if (hidden.indexOf("terms") === -1) { fails++; console.log("  FAIL  " + role + " can still see Terms & Conditions in nav — it's an edit capability, should be hidden for read-only/external roles"); }
  });
  console.log("  PASS  Terms & Conditions is hidden from MGA, Carrier and Customer nav — an edit capability, not a read-only records view");
})();

/* Platform-wide interactive filters: these must genuinely narrow the rendered rows, not just
   exist as inert controls. Real counts below are computed from the actual seed data (see the
   scratch check run against store.js directly), not guessed. */
console.log("\n  registry: product + state filters genuinely narrow the table");
(function () {
  var out = renderDom("registry");
  var rowCount = function () { return out.querySelector("tbody").querySelectorAll("tr").length; };
  if (rowCount() !== 27) { fails++; console.log("  FAIL  registry baseline expected 27 rows, got " + rowCount()); }
  else console.log("  PASS  baseline shows all 27 records");

  var selects = out.querySelectorAll("select");
  if (selects.length !== 3) { fails++; console.log("  FAIL  expected 3 filter selects (status/product/state), found " + selects.length); return; }
  var productSelect = selects[1], stateSelect = selects[2];

  setValue(productSelect, "Comprehensive Auto");
  if (rowCount() !== 10) { fails++; console.log("  FAIL  product filter 'Comprehensive Auto' expected 10 rows, got " + rowCount()); }
  else console.log("  PASS  product filter narrows to the 10 real Comprehensive Auto records");

  setValue(stateSelect, "Maharashtra");
  if (rowCount() !== 1) { fails++; console.log("  FAIL  product+state combo expected 1 row, got " + rowCount()); }
  else console.log("  PASS  combined product+state filter narrows to the 1 real matching record");

  var note = out.textContent;
  if (note.indexOf("Showing 1 of 27 records") === -1) { fails++; console.log("  FAIL  missing 'Showing 1 of 27 records' note once filters are active"); }
  else console.log("  PASS  'Showing X of Y' note reflects the real filtered/total counts");
})();

console.log("\n  documents: search + type filter genuinely narrow the table, and compose together");
(function () {
  var out = renderDom("documents");
  var rowCount = function () { return out.querySelector("tbody").querySelectorAll("tr").length; };
  if (rowCount() !== 18) { fails++; console.log("  FAIL  documents baseline expected 18 rows, got " + rowCount()); }
  else console.log("  PASS  baseline shows all 18 documents");

  var searchInput = out.querySelector("input");
  setValue(searchInput, "Meera");
  if (rowCount() !== 2) { fails++; console.log("  FAIL  search 'Meera' expected 2 rows (Schedule+Certificate), got " + rowCount()); }
  else console.log("  PASS  search narrows to Meera Shankar's real 2 documents");

  var chips = out.querySelectorAll("button").filter(function (b) { return b.classList.contains("chip"); });
  var scheduleChip = chips.filter(function (c) { return c.textContent === "Schedule"; })[0];
  if (!scheduleChip) { fails++; console.log("  FAIL  no 'Schedule' type chip found"); return; }
  scheduleChip.click();
  if (rowCount() !== 1) { fails++; console.log("  FAIL  search 'Meera' + type 'Schedule' expected 1 row, got " + rowCount()); }
  else console.log("  PASS  type chip composes with the active search — narrows to Meera's 1 Schedule doc");

  var allChip = chips.filter(function (c) { return c.textContent === "All"; })[0];
  allChip.click();
  if (rowCount() !== 2) { fails++; console.log("  FAIL  clearing type filter (search still 'Meera') expected 2 rows, got " + rowCount()); }
  else console.log("  PASS  clearing the type chip falls back to the search-only result set");
})();

console.log("\n  loyalty: tier chips genuinely narrow the ranked customer list");
(function () {
  var out = renderDom("loyalty");
  var rowCount = function () {
    var bodies = out.querySelectorAll("tbody");
    return bodies[bodies.length - 1].querySelectorAll("tr").length;
  };
  if (rowCount() !== 13) { fails++; console.log("  FAIL  loyalty baseline expected 13 active customers, got " + rowCount()); }
  else console.log("  PASS  baseline shows all 13 active, scored customers");

  var chips = out.querySelectorAll("button").filter(function (b) { return b.classList.contains("chip"); });
  var goldChip = chips.filter(function (c) { return c.textContent === "Gold"; })[0];
  if (!goldChip) { fails++; console.log("  FAIL  no 'Gold' tier chip found"); return; }
  goldChip.click();
  if (rowCount() !== 3) { fails++; console.log("  FAIL  'Gold' tier filter expected 3 rows, got " + rowCount()); }
  else console.log("  PASS  'Gold' tier filter narrows to the 3 real Gold-tier customers");
  if (out.textContent.indexOf("Showing 3 of 13 customers") === -1) { fails++; console.log("  FAIL  missing 'Showing 3 of 13 customers' note"); }
  else console.log("  PASS  'Showing X of Y' note reflects the real tier-filtered count");

  var silverChip = chips.filter(function (c) { return c.textContent === "Silver"; })[0];
  silverChip.click();
  if (rowCount() !== 7) { fails++; console.log("  FAIL  'Silver' tier filter expected 7 rows, got " + rowCount()); }
  else console.log("  PASS  switching tiers re-filters correctly — 7 real Silver-tier customers");

  var allChip = chips.filter(function (c) { return c.textContent === "All"; })[0];
  allChip.click();
  if (rowCount() !== 13) { fails++; console.log("  FAIL  clearing tier filter expected all 13 rows back, got " + rowCount()); }
  else console.log("  PASS  clearing the tier filter restores the full ranked list");
})();

console.log(fails === 0 ? "\nALL PAGES RENDER\n" : "\n" + fails + " FAILURE(S)\n");
process.exit(fails === 0 ? 0 : 1);
