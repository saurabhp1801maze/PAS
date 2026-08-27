/* Static reference check: every ui.* and PAS.* the page files touch must actually exist on the
   loaded modules, and every nav href must point at a real file with a real page script. */
var fs = require("fs"), vm = require("vm");

var stub = {
  sessionStorage: null,
  location: { search: "" },
  document: { readyState: "complete", createElement: function () { return {}; }, addEventListener: function () {} },
};
stub.window = stub;
vm.createContext(stub);
["assets/js/icons.js", "data/policies.js", "assets/js/store.js", "assets/js/pas-extensions.js", "assets/js/i18n.js", "assets/js/entity-book.js", "assets/js/api.js", "assets/js/ui.js", "assets/js/charts.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(f, "utf8"), stub, { filename: f });
});
var PAS = stub.PAS, ui = PAS.ui;

var fails = 0;
function fail(m) { fails++; console.log("  FAIL  " + m); }

/* --- 1. every ui.* / PAS.* symbol used by a page exists --- */
var pageFiles = fs.readdirSync("assets/js/pages").filter(function (f) { return /\.js$/.test(f); });
var checked = 0;
pageFiles.forEach(function (f) {
  var src = fs.readFileSync("assets/js/pages/" + f, "utf8");
  var seen = {};
  (src.match(/\bui\.([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) {
    var name = m.slice(3);
    if (seen["ui." + name]) return;
    seen["ui." + name] = 1; checked++;
    if (!(name in ui)) fail(f + " uses ui." + name + " — not exported by ui.js");
  });
  (src.match(/\bPAS\.([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) {
    var name = m.slice(4);
    if (seen["PAS." + name]) return;
    seen["PAS." + name] = 1; checked++;
    if (!(name in PAS)) fail(f + " uses PAS." + name + " — not present on the data layer");
  });
});
console.log("  " + checked + " distinct symbol references checked across " + pageFiles.length + " page files");

/* --- 2. every icon name referenced actually exists in the icon set --- */
var iconNames = {};
Object.keys(PAS).length;
var iconSrc = fs.readFileSync("assets/js/icons.js", "utf8");
(iconSrc.match(/^\s{4}"[a-z0-9-]+":/gm) || []).forEach(function (m) {
  iconNames[m.replace(/[\s":]/g, "")] = 1;
});
var iconRefs = 0;
pageFiles.concat(["../layout.js"]).forEach(function (f) {
  var path = f === "../layout.js" ? "assets/js/layout.js" : "assets/js/pages/" + f;
  var src = fs.readFileSync(path, "utf8");
  (src.match(/PAS\.icon(?:Html)?\(\s*"([a-z0-9-]+)"/g) || []).forEach(function (m) {
    var name = m.match(/"([a-z0-9-]+)"/)[1];
    iconRefs++;
    if (!iconNames[name]) fail(path + ' references icon "' + name + '" which does not exist');
  });
});
console.log("  " + iconRefs + " icon references checked against " + Object.keys(iconNames).length + " defined icons");

/* --- 3. nav integrity: every href resolves to a file, with a page script and a PAGE_META entry --- */
PAS.NAV.forEach(function (group) {
  group.items.forEach(function (it) {
    var key = it[0], icon = it[2], href = it[3];
    if (!fs.existsSync(href)) fail('nav "' + it[1] + '" -> ' + href + " does not exist");
    if (!iconNames[icon]) fail('nav "' + it[1] + '" uses missing icon "' + icon + '"');
    if (!PAS.PAGE_META[key]) fail('nav key "' + key + '" has no PAGE_META entry');
    if (!(key in PAS.PAGE_APIS)) fail('nav key "' + key + '" has no PAGE_APIS entry (the lifecycle panel will read undefined)');
  });
});
var navCount = PAS.NAV.reduce(function (t, g) { return t + g.items.length; }, 0);
console.log("  " + navCount + " nav items checked (file, icon, PAGE_META, PAGE_APIS)");

/* --- 4. every PAGE_META key referenced by an html file resolves, and its script tag matches --- */
fs.readdirSync(".").filter(function (f) { return /\.html$/.test(f); }).forEach(function (file) {
  var s = fs.readFileSync(file, "utf8");
  var pk = (s.match(/<body data-page="([^"]*)"/) || [])[1];
  if (!PAS.PAGE_META[pk]) { fail(file + ': data-page="' + pk + '" has no PAGE_META entry'); return; }
  var scripts = s.match(/assets\/js\/pages\/([\w-]+)\.js/g) || [];
  if (scripts.length !== 1) fail(file + " loads " + scripts.length + " page scripts, expected 1");
  else if (!fs.existsSync("assets/js/pages/" + scripts[0].split("/").pop())) fail(file + " -> missing " + scripts[0]);
  if (s.indexOf(">" + PAS.PAGE_META[pk].title + "<") === -1) fail(file + " topbar title does not match PAGE_META");
});
console.log("  every html page checked for meta, script and topbar title");

/* --- 5. the new reference screens call real generated data --- */
if (!Array.isArray(PAS.API_CATALOGUE) || PAS.API_CATALOGUE.length === 0) fail("PAS.API_CATALOGUE is empty");
var epCount = (PAS.API_CATALOGUE || []).reduce(function (t, g) { return t + g.endpoints.length; }, 0);
var evResolved = 0;
(PAS.API_CATALOGUE || []).forEach(function (g) {
  g.endpoints.forEach(function (e) { if (e[0] !== "GET" && PAS.eventTypeFor(e[1])) evResolved++; });
});
console.log("  API catalogue: " + epCount + " endpoints, " + evResolved + " writes resolve to a domain event");
if (typeof ui.lifecycleStage !== "function") fail("ui.lifecycleStage not exported — architecture and domain-model need it");

console.log(fails === 0 ? "\nALL CHECKS PASSED\n" : "\n" + fails + " CHECK(S) FAILED\n");
process.exit(fails === 0 ? 0 : 1);
