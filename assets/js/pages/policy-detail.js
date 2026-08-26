/* Ported from PolicyDetailPage in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var RISK_LABELS = {
    claimFreeYears: "Claim-free years", otherClaims: "Other claims (non-fault)", atFaultClaims: "At-fault claims",
    priorCancellations: "Prior cancellations", nonPayment: "Non-payment history", newBusiness: "New business",
    infoPending: "Information pending",
  };

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

    var endorsements = policy.history.filter(function (h) { return h.type === "Endorsement"; }).sort(function (a, b) { return b.seq - a.seq; });
    var fleet = PAS.vehicleFleetFor(policy);

    var tabsRow = ui.h("div", { class: "tabs" });
    var tabDefs = [["ledger", "Transaction ledger"], ["docs", "Documents (" + ((policy.documents && policy.documents.length) || 0) + ")"], ["cover", "Cover & parties"], ["claims", "Claims & risk (" + ((policy.claims && policy.claims.length) || 0) + ")"], ["endorsements", "Endorsements (" + endorsements.length + ")"]];
    if (fleet) tabDefs.push(["fleet", (fleet.isFleet ? "Fleet" : "Vehicle") + " (" + fleet.vehicles.length + ")"]);
    tabDefs.push(["asof", "As-of view"], ["terms", "Term history"], ["xref", "Cross-references"]);
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
      cb.appendChild(ui.kv({ k: "State", v: policy.state || "—", what: "Jurisdiction this risk is written in." }));
      cb.appendChild(ui.kv({ k: "Submitted", v: policy.submittedOn || policy.effectiveDate || "—", what: "When this record first entered the book.", why: policy.submittedOn ? "" : "Not separately recorded for this record — falls back to its effective date." }));
      if (policy.status === "Active") {
        var loyalty = PAS.loyaltyScore(policy);
        cb.appendChild(ui.kv({ k: "Loyalty tier", v: ui.pill(loyalty.tone, loyalty.tier + " · " + loyalty.score + " pts"), what: "Computed from renewal count, claims and cancellation history.", why: "Same formula the Loyalty page uses — nothing here is a stored points balance." }));
      }
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
      (policy.parties && policy.parties.certificateHolders || []).forEach(function (n, i) {
        pb.appendChild(ui.kv({ k: "Certificate holder " + (i + 1), v: n }));
      });
      pb.appendChild(ui.kv({ k: "Producer", v: policy.producer, what: "Broker or channel." }));
      pb.appendChild(ui.kv({ k: "MGA", v: policy.mga || "—", what: "Wholesale facility holding binding authority on this risk." }));
      pb.appendChild(ui.kv({ k: "Carrier", v: policy.carrier || "—", what: "Risk-bearing partner this policy is actually written on." }));
      pb.appendChild(ui.kv({ k: "ETag", v: policy.etag || PAS.getPolicyEtag(policy.id), mono: true, what: "Concurrency token for PAS API writes." }));
      pb.appendChild(ui.kv({ k: "Auto-renew", v: policy.autoRenew ? "Yes" : "No" }));
      pb.appendChild(ui.kv({ k: "Status", v: ui.badge(policy.status) }));
      if (policy.binder) {
        pb.appendChild(ui.tipLabel({ text: "Binder", what: "Provisional cover note — legal evidence of cover until formal issue.", className: "label-11 block mt-13 mb-9" }));
        pb.appendChild(ui.kv({ k: "Binder number", v: policy.binder.number, mono: true }));
        pb.appendChild(ui.kv({ k: "Bound on", v: policy.binder.boundOn || "—" }));
        pb.appendChild(ui.kv({ k: "Expiry", v: policy.binder.expiryDate || "—", rule: "Issuing after binder expiry is not permitted — the risk must be re-bound." }));
        (policy.binder.subjectivities || []).forEach(function (s) {
          pb.appendChild(ui.kv({ k: s.label, v: ui.pill(s.met ? "green" : "amber", s.met ? "Met" : "Outstanding") }));
        });
      }
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
    } else if (tab === "claims") {
      var claims = policy.claims || [];
      body.appendChild(ui.kpiRow([
        { label: "Claims on file", value: claims.length, tip: "Every claim recorded against this policy." },
        { label: "Total incurred", value: PAS.money(claims.reduce(function (s, c) { return s + (c.incurred || 0); }, 0)), tip: "Reported + paid + reserved, whichever the claim is at." },
        { label: "Open reserves", value: PAS.money(claims.filter(function (c) { return c.status === "Open"; }).reduce(function (s, c) { return s + (c.reserved || 0); }, 0)), tone: "amber", tip: "Money set aside for claims not yet closed." },
        { label: "Loss ratio", value: Math.round(PAS.lossRatio([policy]) * 100) + "%", tip: "Incurred ÷ premium for this policy alone.", why: "Same formula the MGA/Carrier dashboards use, just scoped to one record." },
      ]));
      body.appendChild(ui.tipLabel({ text: "Claims", what: "Every claim reported against this policy.", className: "label-11 block mt-15 mb-9" }));
      body.appendChild(ui.dataTable({
        columns: ["Type", "Status", "Reported", "Incurred", "Paid", "Reserved"],
        rows: claims.map(function (c) {
          return [c.type, ui.pill(c.status === "Open" ? "amber" : "gray", c.status), c.reportedOn, PAS.money(c.incurred), PAS.money(c.paid), PAS.money(c.reserved)];
        }),
        emptyText: "No claims on file for this policy.",
      }));

      var risk = policy.risk || {};
      var riskKeys = Object.keys(RISK_LABELS).filter(function (k) { return risk[k] !== undefined && risk[k] !== false; });
      if (riskKeys.length) {
        body.appendChild(ui.tipLabel({ text: "Underwriting factors", what: "The risk inputs behind this policy's underwriting decision.", className: "label-11 block mt-18 mb-9" }));
        riskKeys.forEach(function (k) {
          body.appendChild(ui.kv({ k: RISK_LABELS[k], v: typeof risk[k] === "boolean" ? "Yes" : String(risk[k]) }));
        });
        if (risk.infoPendingNote) body.appendChild(ui.kv({ k: "Note", v: risk.infoPendingNote }));
      }

      var policyAudit = PAS.getGlobalAuditLog().filter(function (a) { return a.policyId === policy.id; });
      body.appendChild(ui.tipLabel({ text: "Admin audit trail (" + policyAudit.length + ")", what: "Every PAS-admin-level write against this specific record.", why: "Separate from the transaction ledger above — this is the security/compliance log, not the business history.", className: "label-11 block mt-18 mb-9" }));
      body.appendChild(ui.dataTable({
        columns: ["When", "User", "Action", "Detail"],
        rows: policyAudit.map(function (a) { return [(a.at || "").slice(0, 19), a.user, a.action, a.detail || "—"]; }),
        emptyText: "No admin-level writes recorded against this record yet.",
      }));
    } else if (tab === "endorsements") {
      body.appendChild(ui.tipLabel({ text: "Endorsement trail", what: "Every mid-term change request raised against this policy, in order.", why: "The Transaction ledger mixes every event type together — this is just the endorsements.", className: "label-11 block mb-9" }));
      body.appendChild(ui.dataTable({
        columns: ["Date", "Status", "Change type", "Materiality", "Premium impact", "Requested by", "Detail"],
        rows: endorsements.map(function (h) {
          var impact = (h.meta && h.meta.premiumImpact) || 0;
          var impactSpan = ui.h("span", { style: { color: impact >= 0 ? "var(--green)" : "var(--red)", fontWeight: "700" } }, impact ? (impact >= 0 ? "+" : "") + PAS.money(impact) : "—");
          return [h.date, ui.txnStatusBadge(h.status), (h.meta && h.meta.changeType) || "—",
            h.meta && h.meta.materiality ? ui.pill(h.meta.materiality === "Material" ? "red" : "gray", h.meta.materiality) : "—",
            impactSpan, h.meta ? ui.initiatorPill(h.meta) : "—",
            ui.h("span", { style: { fontSize: "12px", color: "var(--text-soft)" } }, h.detail)];
        }),
        onRowClick: function (i) { location.href = "endorsement-decision.html?policy=" + encodeURIComponent(policy.id) + "&txn=" + encodeURIComponent(endorsements[i].id); },
        emptyText: "No endorsements have been requested on this policy.",
      }));
    } else if (tab === "fleet") {
      body.appendChild(ui.kpiRow([
        { label: fleet.isFleet ? "Vehicles" : "Vehicle", value: fleet.vehicles.length, tip: "Units on this policy." },
        { label: "Drivers", value: fleet.drivers.length, tip: "Named drivers on this policy." },
      ]));
      body.appendChild(ui.tipLabel({ text: (fleet.isFleet ? "Fleet" : "Vehicle") + " roster", what: "Every vehicle/trailer scheduled on this policy.", why: "Derived deterministically from the policy's own id and premium — the same way MGA assignment is — since the seed book carries premium and sum insured but not a separately-authored roster for every auto policy.", className: "label-11 block mb-9" }));
      body.appendChild(ui.dataTable({
        columns: ["Unit", "Type", "Make / Model", "Year", { label: "VIN", what: "Vehicle identification number." }],
        rows: fleet.vehicles.map(function (v) { return [v.unit, v.type, v.make + " " + v.model, String(v.year), ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11px" } }, v.vin)]; }),
      }));
      body.appendChild(ui.tipLabel({ text: "Drivers", what: "Every named driver on this policy.", className: "label-11 block mt-18 mb-9" }));
      body.appendChild(ui.dataTable({
        columns: ["Name", "Role", "License class", "License state", "Years licensed"],
        rows: fleet.drivers.map(function (d) { return [d.name, d.role, d.licenseClass, d.licenseState, String(d.yearsLicensed)]; }),
      }));
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
