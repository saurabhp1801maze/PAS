/* Regenerates the sidebar nav + topbar title in every *.html file from the single source of
   truth (PAS.NAV / PAS.PAGE_META in store.js). The sidebar is baked per-file (no includes, no
   build step, so file:// keeps working), which means it silently drifts whenever PAS.NAV changes
   and only some pages get regenerated. This script removes that drift by construction — run it
   after any PAS.NAV/PAGE_META edit. */
var fs = require("fs"), vm = require("vm"), path = require("path");
var ROOT = path.join(__dirname, "..");

var stub = {
  sessionStorage: (function () {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  })(),
  console: console,
};
stub.window = stub;
vm.createContext(stub);
["assets/js/icons.js", "data/policies.js", "assets/js/store.js", "assets/js/pas-extensions.js", "assets/js/i18n.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), stub, { filename: f });
});
var PAS = stub.PAS;

function navItemHtml(pageKey, label, icon, href, active) {
  return '    <a class="nav-item' + (active ? " active" : "") + '" href="' + href + '">' +
    PAS.iconHtml(icon, { size: 13 }) + " " + label + "</a>";
}

function sidebarHtml(activeNavKey) {
  var out = ['    <nav class="sidebar" id="sidebar" role="navigation" aria-label="Primary">'];
  out.push('  <div class="sidebar-brand">');
  /* The S monogram mark (framework §2/§23) — a lettermark, not a Phosphor icon glyph, so it's
     inlined directly rather than routed through PAS.iconHtml/ICONS. Matches assets/favicon.svg's
     "S" letterform so the shell mark and the browser-tab mark are the same brand asset. */
  out.push('    <div class="sidebar-brand-mark" aria-hidden="true">S</div>');
  out.push('    <div class="sidebar-brand-text">');
  out.push('      <div class="sidebar-brand-name">Vikram &amp; Sons PAS</div>');
  out.push('      <div class="sidebar-brand-sub">Policy administration</div>');
  out.push("    </div>");
  out.push("  </div>");
  PAS.NAV.forEach(function (group) {
    out.push('  <div class="nav-group">');
    out.push('    <div class="nav-group-label">' + group.label + "</div>");
    group.items.forEach(function (it) {
      var label = PAS.t("nav." + it[0], it[1]);
      out.push(navItemHtml(it[0], label, it[2], it[3], it[0] === activeNavKey));
    });
    out.push("  </div>");
  });
  out.push('  <div class="sidebar-footer">');
  out.push('    <button class="reset-demo-btn" id="reset-demo-btn" type="button">' + PAS.iconHtml("rotate-ccw", { size: 12 }) + ' <span class="reset-demo-label">Reset demo data</span></button>');
  out.push('    <button class="nav-collapse-btn" id="nav-collapse-btn" type="button" aria-label="Collapse navigation" aria-expanded="true">' + PAS.iconHtml("arrow-left", { size: 12 }) + ' <span class="nav-collapse-label">Collapse nav</span></button>');
  out.push("  </div>");
  out.push("</nav>");
  return out.join("\n");
}

var files = fs.readdirSync(ROOT).filter(function (f) { return /\.html$/.test(f); });
var changed = 0, skipped = [];
files.forEach(function (file) {
  var full = path.join(ROOT, file);
  var html = fs.readFileSync(full, "utf8");
  var pageMatch = html.match(/data-page="([^"]+)"/);
  if (!pageMatch) { skipped.push(file + " (no data-page attribute)"); return; }
  var pageKey = pageMatch[1];
  var meta = PAS.PAGE_META[pageKey];
  if (!meta) { skipped.push(file + " (data-page=\"" + pageKey + "\" has no PAS.PAGE_META entry)"); return; }

  var navBlock = sidebarHtml(meta.nav);
  var navRe = /    <nav class="sidebar" id="sidebar"[^>]*>[\s\S]*?\n<\/nav>/;
  if (!navRe.test(html)) { skipped.push(file + " (sidebar block not found/matched)"); return; }
  var next = html.replace(navRe, navBlock);

  var titleRe = /(<span class="topbar-title">)([^<]*)(<\/span>)/;
  next = next.replace(titleRe, "$1" + meta.title + "$3");

  if (next !== html) { fs.writeFileSync(full, next); changed++; }
});

console.log("synced " + changed + " of " + files.length + " html files");
if (skipped.length) { console.log("skipped:"); skipped.forEach(function (s) { console.log("  " + s); }); }
