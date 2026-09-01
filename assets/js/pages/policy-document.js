/* Policy document — a formatted, printable rendering of a generated "Policy document" record
   (doc.payload, frozen at generation time by PAS.generateQuoteDocuments / PAS.policyDocumentPayload
   in pas-extensions.js). Unlike the invoice, this document is meant to leave PAS as a PDF, not
   JSON — same convention invoice.js already uses for that (window.print() -> browser's own
   Save-as-PDF), just applied to a different payload. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function money(n) { return PAS.money(n); }

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policy = PAS.getPolicy(sp.get("policy"));
    var doc = policy && (policy.documents || []).find(function (d) { return d.id === sp.get("doc"); });
    if (!policy || !doc || !doc.payload) {
      root.appendChild(ui.h("div", { class: "faint-note" }, "Policy document not found."));
      return;
    }
    var p = doc.payload;

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Back to policy", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=documents"; }));
    page.appendChild(ui.pageHeader({
      icon: "file-text", tone: "indigo", title: "Policy document — " + policy.id,
      sub: p.namedInsured + " · v" + doc.version,
      what: "The full policy record as issued — cover, term and premium composition — frozen at the moment this version was generated.",
      why: "Use Download PDF for the customer's copy; the on-screen policy record can keep moving after this snapshot was taken.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Term", value: PAS.fmtDate(p.term.effectiveDate) + " → " + PAS.fmtDate(p.term.expirationDate) },
      { label: "Sum insured", value: p.sumInsured || "—", tone: "blue" },
      { label: "Premium", value: money(p.premium) },
      { label: "Status", value: p.status },
    ]));

    var about = ui.panel({ title: "Named insured & placement" }, []);
    var ab = about.querySelector(".panel-body");
    ab.appendChild(ui.kv({ k: "Named insured", v: p.namedInsured }));
    ab.appendChild(ui.kv({ k: "Producer", v: p.producer || "—" }));
    ab.appendChild(ui.kv({ k: "Carrier", v: p.carrier || "—" }));
    ab.appendChild(ui.kv({ k: "State", v: p.state || "—" }));
    ab.appendChild(ui.kv({ k: "Product", v: p.product || "—" }));
    if (p.ratingVersion) ab.appendChild(ui.kv({ k: "Rating version", v: p.ratingVersion }));
    page.appendChild(about);

    if (p.coverages && p.coverages.length) {
      var coverRows = p.coverages.map(function (c) {
        return [c.name, c.share != null ? (Math.round(c.share * 1000) / 10) + "%" : "", money(c.premium)];
      });
      var coverPanel = ui.panel({ title: "Coverage breakdown", what: "How the final premium splits across lines of cover." }, []);
      coverPanel.querySelector(".panel-body").appendChild(ui.dataTable({ columns: ["Coverage", "Share", "Premium"], rows: coverRows }));
      page.appendChild(coverPanel);
    }

    /* Only a policy with a stored rating-quote payload (imported via Import quote) carries a raw
       coveragePremium/discounts/surcharges/fees/tax to build this from — most of the seeded book
       doesn't, since it was never rated through that path. Showing the table anyway would render
       "Coverage premium: $0" with no adjustments to explain the gap to the real premium, so skip
       it entirely rather than fake a composition that was never computed. */
    if (p.coveragePremium != null) {
      var rows = [];
      rows.push([ui.h("strong", {}, "Coverage premium"), "", ui.h("strong", {}, money(p.coveragePremium))]);
      (p.discounts || []).forEach(function (d) { rows.push([d.label || d.name, "", money(d.amt)]); });
      (p.surcharges || []).forEach(function (s) { rows.push([s.label || s.name, "", money(s.amt)]); });
      (p.fees || []).forEach(function (f) { rows.push([f.label || f.name, "", money(f.amt)]); });
      if (p.tax && p.tax.amount != null) rows.push(["Tax", p.tax.pct != null ? p.tax.pct + "%" : "", money(p.tax.amount)]);
      rows.push([ui.h("strong", {}, "Total premium"), "", ui.h("strong", {}, money(p.premium))]);

      var lineItems = ui.panel({ title: "Premium composition", pad: 0 }, []);
      lineItems.querySelector(".panel-body").appendChild(ui.dataTable({ columns: ["Description", "Rate", "Amount"], rows: rows }));
      page.appendChild(lineItems);
    }

    var actionBar = ui.h("div", { class: "action-bar", style: { marginTop: "18px", display: "flex", gap: "10px", alignItems: "center" } });
    var printBtn = ui.h("button", { class: "btn tone-primary" }, [PAS.icon("file-text", { size: 13 }), document.createTextNode(" Download PDF")]);
    printBtn.addEventListener("click", function () { window.print(); });
    actionBar.appendChild(printBtn);
    actionBar.appendChild(ui.h("span", { class: "field-hint" }, "Opens the browser print dialog — choose \"Save as PDF\" as the destination."));
    page.appendChild(actionBar);

    root.appendChild(ui.screen("policy-document", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
