/* node tests/run.js — runs every harness from the project root. No dependencies. */
var cp = require("child_process"), path = require("path");
var suites = ["domain-rules", "references", "render"];
var failed = [];
suites.forEach(function (s) {
  console.log("\n\u2500\u2500 " + s + " " + Array(60 - s.length).join("\u2500"));
  var r = cp.spawnSync(process.execPath, [path.join("tests", s + ".test.js")], { stdio: "inherit" });
  if (r.status !== 0) failed.push(s);
});
console.log("\n" + (failed.length ? failed.length + " suite(s) failed: " + failed.join(", ") : "all " + suites.length + " suites passed"));
process.exit(failed.length ? 1 : 0);
