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
    var tabDefs = [["ledger", "Transaction ledger"], ["docs", "Documents (" + ((policy.documents && policy.documents.length) || 0) + ")"], ["cover", "Cover & parties"], ["asof", "As-of view"], ["terms", "Term history"], ["xref", "Cross-references"]];
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
            ui.h("span", { style: { fontSize: "12px", color: "var(--text-soft)", whiteSpace: "normal", display: "inline-block", maxWidth: "420px" } }, h.detail), (h.approvedBy || h.user)];
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
        columns: ["Document", { label: "Type", what: "Schedule, certificate or notice." }, { label: "Version", what: "Incremented each regeneration.", why: "Lets you prove what the customer held on any date." }, "Generated", { label: "Delivery", what: "PAS document delivery status." }, { label: "Txn", what: "Ledger row that triggered generation." }, ""],
        rows: (policy.documents || []).map(function (d) {
          var nameSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: "600" } }, [PAS.icon("file-text", { size: 13, color: "var(--primary)" }), document.createTextNode(d.name)]);
          var dlSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--primary)", fontSize: "12px", fontWeight: "700" } }, [PAS.icon("download", { size: 12 }), document.createTextNode("PDF")]);
          var delBtn = ui.h("button", { class: "btn small" }, "Mark delivered");
          delBtn.addEventListener("click", function (e) { e.stopPropagation(); PAS.markDocumentDelivered(policy.id, d.id); render(); });
          return [nameSpan, d.type, ui.pill("gray", "v" + d.version), d.generatedAt, ui.pill(d.deliveryStatus === "Delivered" ? "green" : "amber", d.deliveryStatus || "Generated"), d.transactionId ? d.transactionId.slice(0, 12) : "—", delBtn];
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
      var breakdown = PAS.coverageBreakdown(policy);
      if (breakdown.length) {
        var covWrap = ui.h("div", { class: "mt-13" });
        covWrap.appendChild(ui.tipLabel({ text: "Coverage breakdown", what: "Premium split across this product's layers of cover.", why: "A fixed percentage split (PAS.COVERAGE_TEMPLATE) applied to this policy's own premium — a documented modeling simplification, not a live-rated figure per layer.", className: "label-11 block mb-9" }));
        var maxShare = Math.max.apply(null, breakdown.map(function (c) { return c.premium; }));
        breakdown.forEach(function (c) {
          covWrap.appendChild(ui.hbar({ label: c.name, value: c.premium, max: maxShare, note: PAS.money(c.premium) + " · " + Math.round(c.share * 100) + "%", tone: c.premium === maxShare ? "indigo" : "blue" }));
        });
        cb.appendChild(covWrap);
      }
      grid.appendChild(coverPanel);
      var partiesPanel = ui.panel({ title: "Parties & distribution", what: "Who is insured and who placed the business." }, []);
      var pb = partiesPanel.querySelector(".panel-body");
      pb.appendChild(ui.kv({ k: "Named insured", v: policy.holder }));
      (policy.parties && policy.parties.additionalInsureds || []).forEach(function (n, i) {
        pb.appendChild(ui.kv({ k: "Additional insured " + (i + 1), v: n }));
      });
      pb.appendChild(ui.kv({ k: "Producer", v: policy.producer, what: "Broker or channel." }));
      pb.appendChild(ui.kv({ k: "ETag", v: policy.etag || PAS.getPolicyEtag(policy.id), mono: true, what: "Concurrency token for PAS API writes." }));
      pb.appendChild(ui.kv({ k: "Auto-renew", v: policy.autoRenew ? "Yes" : "No" }));
      pb.appendChild(ui.kv({ k: "Binder", v: (policy.binder && policy.binder.number) || "—", mono: true, what: "Provisional cover reference, if bound." }));
      pb.appendChild(ui.kv({ k: "Status", v: ui.badge(policy.status) }));
      if (policy.packageLines) {
        pb.appendChild(ui.tipLabel({ text: "Package lines", className: "label-11 block mt-13 mb-9" }));
        policy.packageLines.forEach(function (ln) {
          pb.appendChild(ui.kv({ k: ln.line, v: Math.round(ln.premiumShare * 100) + "% of premium" }));
        });
      }
      var dupes = PAS.findDuplicatePolicies(policy.holder, policy.product);
      if (dupes.length > 1) pb.appendChild(ui.callout("warn", "Possible duplicate: " + dupes.length + " active policies for same insured and product."));
      grid.appendChild(partiesPanel);
      body.appendChild(grid);
    } else if (tab === "asof") {
      var asofInput = ui.h("input", { class: "field-input", type: "date", value: PAS.todayISO() });
      var asofResult = ui.h("div", { class: "mt-13" });
      body.appendChild(ui.field({ label: "View policy as-of date", hint: "Point-in-time reconstruction from the ledger." }, asofInput));
      body.appendChild(asofResult);
      function renderAsOf() {
        var snap = PAS.policyAsOf(policy, asofInput.value);
        var diff = PAS.policyDiff(policy, asofInput.value, PAS.todayISO());
        asofResult.innerHTML = "";
        asofResult.appendChild(ui.kpiRow([
          { label: "Status", value: snap.status }, { label: "Premium", value: PAS.money(snap.premium) },
          { label: "Holder", value: snap.holder }, { label: "Term", value: snap.termNumber },
        ]));
        if (diff.length) {
          asofResult.appendChild(ui.tipLabel({ text: "Changes since " + asofInput.value, className: "label-11 block mt-13 mb-9" }));
          asofResult.appendChild(ui.dataTable({
            columns: ["Field", "As-of value", "Today"],
            rows: diff.map(function (d) { return [d.field, String(d.before), String(d.after)]; }),
          }));
        }
      }
      asofInput.addEventListener("input", renderAsOf);
      renderAsOf();
    } else if (tab === "terms") {
      body.appendChild(ui.dataTable({
        columns: ["Term", "Effective", "Expiration", "Premium", "Status"],
        rows: (policy.terms || []).map(function (t) {
          return [t.termNumber, t.effectiveDate, t.expirationDate, PAS.money(t.premium), t.status || policy.status];
        }),
      }));
    } else if (tab === "xref") {
      var refs = policy.relatedPolicies || [];
      if (!refs.length) body.appendChild(ui.h("div", { class: "faint-note" }, "No related policies (rewrite, split, merge links appear here)."));
      else refs.forEach(function (rid) {
        var btn = ui.h("button", { class: "btn ghost-link" }, rid);
        btn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(rid); });
        body.appendChild(btn);
      });
    }
    page.appendChild(body);

    root.appendChild(ui.screen("detail", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
