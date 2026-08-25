/* Ported from PolicyDetailPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policy = PAS.getPolicy(sp.get("policy"));
    if (!policy) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var tab = sp.get("tab") || "ledger";

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Policy register", function () { location.href = "registry.html"; }));
    page.appendChild(ui.recordHead(policy));
    page.appendChild(ui.kpiRow([
      { label: "Term", value: policy.effectiveDate + " → " + policy.expirationDate, tip: "Current coverage period." },
      { label: "Premium", value: PAS.money(policy.premium), tip: "Annual written premium." },
      { label: "Sum insured", value: policy.sumInsured || "—", tip: "Total limit of indemnity." },
      { label: "Transactions", value: policy.history.length, tip: "Entries in the append-only ledger." },
      { label: "Documents", value: (policy.documents && policy.documents.length) || 0, tip: "Stored document versions." },
    ]));

    var tabsRow = ui.h("div", { class: "tabs" });
    var tabDefs = [["ledger", "Transaction ledger"], ["docs", "Documents (" + ((policy.documents && policy.documents.length) || 0) + ")"], ["cover", "Cover & parties"]];
    tabDefs.forEach(function (td) {
      var btn = ui.h("button", { class: "tab-btn" + (tab === td[0] ? " active" : "") }, td[1]);
      btn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=" + td[0]; });
      tabsRow.appendChild(btn);
    });
    page.appendChild(tabsRow);

    var body = ui.h("div", {});
    if (tab === "ledger") {
      var sorted = policy.history.slice().sort(function (a, b) { return b.seq - a.seq; });
      body.appendChild(ui.dataTable({
        columns: [{ label: "Seq", what: "Order within this policy's ledger." }, "Date", "Type", { label: "Status", what: "Whether this transaction has been applied." }, "Detail", "By"],
        rows: sorted.map(function (h) {
          return [ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--text-faint)" } }, "#" + h.seq), h.date, ui.modulePill(h.type), ui.txnStatusBadge(h.status),
            ui.h("span", { style: { fontSize: "12px", color: "var(--text-soft)", whiteSpace: "normal", display: "inline-block", maxWidth: "420px" } }, h.detail), h.user];
        }),
      }));
    } else if (tab === "docs") {
      var headRow = ui.h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "11px" } });
      headRow.appendChild(ui.tipLabel({ text: "Generated documents", what: "Versioned PDFs produced by the platform and stored against the policy.", why: "Every issue, endorsement and cancellation regenerates the pack so the customer's copy matches the system of record." }));
      var genBtn = ui.h("button", { class: "btn tone-primary" }, [PAS.icon("plus", { size: 13 }), document.createTextNode(" Generate schedule")]);
      genBtn.addEventListener("click", function () {
        PAS.api.call("POST", "/api/v1/policies/" + policy.id + "/documents", { template: "policySchedule" },
          { module: "Issuance", policyId: policy.id, statusCode: 201, label: "Generate schedule — " + policy.holder, response: { documentId: PAS.uid("DOC"), name: "Policy schedule", version: ((policy.documents && policy.documents.length) || 0) + 1, events: ["documentGenerated"] } })
          .then(function () { PAS.generateDoc(policy.id, "Policy schedule", "Schedule"); render(); });
      });
      headRow.appendChild(genBtn);
      body.appendChild(headRow);
      body.appendChild(ui.dataTable({
        columns: ["Document", { label: "Type", what: "Schedule, certificate or notice." }, { label: "Version", what: "Incremented each regeneration.", why: "Lets you prove what the customer held on any date." }, "Generated", ""],
        rows: (policy.documents || []).map(function (d) {
          var nameSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: "600" } }, [PAS.icon("file-text", { size: 13, color: "var(--primary)" }), document.createTextNode(d.name)]);
          var dlSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--primary)", fontSize: "12px", fontWeight: "700" } }, [PAS.icon("download", { size: 12 }), document.createTextNode("PDF")]);
          return [nameSpan, d.type, ui.pill("gray", "v" + d.version), d.generatedAt, dlSpan];
        }),
        emptyText: "No documents yet. Issuing the policy generates the schedule and certificate.",
      }));
    } else if (tab === "cover") {
      var grid = ui.h("div", { class: "cover-grid" });
      var coverPanel = ui.panel({ title: "Cover", what: "What the policy insures." }, []);
      var cb = coverPanel.querySelector(".panel-body");
      cb.appendChild(ui.kv({ k: "Product", v: policy.product }));
      cb.appendChild(ui.kv({ k: "Sum insured", v: policy.sumInsured || "—" }));
      cb.appendChild(ui.kv({ k: "Premium", v: PAS.money(policy.premium) }));
      cb.appendChild(ui.kv({ k: "Term number", v: policy.termNumber, what: "How many times this policy has renewed." }));
      grid.appendChild(coverPanel);
      var partiesPanel = ui.panel({ title: "Parties & distribution", what: "Who is insured and who placed the business." }, []);
      var pb = partiesPanel.querySelector(".panel-body");
      pb.appendChild(ui.kv({ k: "Named insured", v: policy.holder }));
      pb.appendChild(ui.kv({ k: "Producer", v: policy.producer, what: "Broker or channel." }));
      pb.appendChild(ui.kv({ k: "Binder", v: (policy.binder && policy.binder.number) || "—", mono: true, what: "Provisional cover reference, if bound." }));
      pb.appendChild(ui.kv({ k: "Status", v: ui.badge(policy.status) }));
      grid.appendChild(partiesPanel);
      body.appendChild(grid);
    }
    page.appendChild(body);

    root.appendChild(ui.screen("detail", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
