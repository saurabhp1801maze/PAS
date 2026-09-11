/* Invoice — a real, itemized printable invoice rendered from a policy's stored quote payload
   (policy.quote, set by PAS.importQuote). Every number here is read straight off that payload;
   nothing is recomputed. See PAS.generateInvoice / PAS.sendInvoiceToAccounts in pas-extensions.js. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function money(n) { return PAS.money(n); }

  function feeDetail(f) {
    if (f.valueType === "Percent") {
      var s = f.pct + "% of " + (f.percentOf || "premium");
      if (f.capped) s += " (capped, min " + money(f.minFee) + (f.maxFee ? ", max " + money(f.maxFee) : "") + ")";
      return s;
    }
    return f.qty + " × " + money(f.unit) + (f.chargeType ? " · " + f.chargeType : "");
  }

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policy = PAS.getPolicy(sp.get("policy"));
    var doc = policy && (policy.documents || []).find(function (d) { return d.id === sp.get("doc"); });
    if (!policy || !doc || !policy.quote) {
      root.appendChild(ui.h("div", { class: "faint-note" }, "Invoice not found."));
      return;
    }
    var q = policy.quote.quote || {};
    /* Everything Accounting-specific (remittance split, reference/audit fields, due date) is read
       from PAS.invoicePayload rather than re-derived here, so this page and the downloaded JSON
       can never disagree about who gets paid or what the reconciled totals are. */
    var inv = PAS.invoicePayload(policy, doc);

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Back to policy", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=documents"; }));
    page.appendChild(ui.pageHeader({
      icon: "file-text", tone: "indigo", title: "Invoice " + (doc.invoiceNumber || doc.name),
      sub: policy.holder + " · " + policy.id,
      what: "Itemized from the quote imported for this policy — coverage premium, discounts, surcharges, fees and tax.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Invoice date", value: PAS.fmtDate(doc.generatedAt) },
      { label: "Due date", value: PAS.fmtDate(inv.dueDate), tip: inv.paymentTerms + " from the invoice date — a stated convention, not billed data this prototype has anywhere else to read." },
      { label: "Policy term", value: PAS.fmtDate(policy.effectiveDate) + " → " + PAS.fmtDate(policy.expirationDate) },
      { label: "Total premium", value: money(q.finalPremium), tone: "blue" },
      { label: "Status", value: doc.deliveryStatus === "Delivered" ? "Sent to accounts" : "Not yet sent", tone: doc.deliveryStatus === "Delivered" ? "green" : "amber" },
    ]));

    var panelRow = ui.h("div", { class: "mt-13", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "13px" } });

    var billTo = ui.panel({ title: "Bill to" }, []);
    var bb = billTo.querySelector(".panel-body");
    bb.appendChild(ui.kv({ k: "Named insured", v: policy.holder }));
    bb.appendChild(ui.kv({ k: "Producer", v: policy.producer || "—" }));
    bb.appendChild(ui.kv({ k: "State", v: policy.state || "—" }));
    bb.appendChild(ui.kv({ k: "Line of business", v: q.lob || policy.product }));
    panelRow.appendChild(billTo);

    /* Reference/audit trail — lets Accounting trace this invoice back to the exact source quote
       and the record of who accepted the risk, without a separate lookup on the policy record. */
    var reference = ui.panel({ title: "Reference", what: "Audit trail back to the source quote and underwriting record." }, []);
    var rb = reference.querySelector(".panel-body");
    rb.appendChild(ui.kv({ k: "Policy ID", v: policy.id, mono: true }));
    rb.appendChild(ui.kv({ k: "Term number", v: inv.termNumber }));
    rb.appendChild(ui.kv({ k: "Quote number", v: inv.quoteNumber || "—", mono: !!inv.quoteNumber }));
    rb.appendChild(ui.kv({ k: "Rating version", v: inv.ratingVersion || "—" }));
    rb.appendChild(ui.kv({ k: "Underwritten by", v: inv.underwrittenBy || "—" }));
    rb.appendChild(ui.kv({ k: "Carrier", v: inv.carrier || "—" }));
    rb.appendChild(ui.kv({ k: "MGA", v: inv.mga || "—" }));
    panelRow.appendChild(reference);
    page.appendChild(panelRow);

    /* Remittance — who actually gets paid out of the collected premium, and how much. Same
       computation as policy-detail's "Where the premium goes" tab (PAS.commissionRateOf +
       PAS.BROKER_COMMISSION_SHARE via PAS.invoicePayload), so the two can never disagree. */
    var remit = ui.panel({ title: "Remittance", what: "How the collected premium is disbursed — same split as the policy's own Where the premium goes tab.", pad: 0 }, []);
    remit.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Party", "Detail", "Amount"],
      rows: [
        [ui.h("strong", {}, "Gross commission"), Math.round(inv.remittance.commissionRate * 1000) / 10 + "% of premium", money(inv.remittance.grossCommission)],
        ["Broker — " + (policy.producer || "—"), policy.producer && policy.producer !== "Direct" ? "Retail commission" : "Direct business — no broker to pay", money(inv.remittance.brokerCommission)],
        ["MGA — " + (policy.mga || "—"), "Facility override", money(inv.remittance.mgaCommission)],
        ["Carrier — " + (policy.carrier || "—"), "Net of commission", money(inv.remittance.carrierNet)],
      ],
    }));
    page.appendChild(remit);

    var rows = [];
    (policy.quote.coverages || []).forEach(function (c) {
      rows.push(["Coverage — " + c.name, "", money(c.subtotal)]);
    });
    rows.push([ui.h("strong", {}, "Coverage premium"), "", ui.h("strong", {}, money(q.coveragePremium))]);
    (q.discounts || []).forEach(function (d) {
      rows.push([d.name, d.why || "", money(d.amt)]);
    });
    (q.surcharges || []).forEach(function (s) {
      rows.push([s.name, s.why || "", money(s.amt)]);
    });
    rows.push([ui.h("strong", {}, "Premium before fees"), "", ui.h("strong", {}, money(inv.premiumBeforeFees))]);
    (q.fees || []).forEach(function (f) {
      rows.push([f.name, feeDetail(f), money(f.amt)]);
    });
    if ((q.fees || []).length > 1) rows.push([ui.h("strong", {}, "Total fees"), "", ui.h("strong", {}, money(inv.totalFees))]);
    /* Not every payload carries taxPct/countyRate (percentages) alongside the tax amounts — some
       instead spell the rate into a richer itemized_taxes name/amount list. Prefer that when it's
       there; otherwise reconstruct from the flatter fields, but key off the amount being present
       (not the percent) so a missing percent never silently drops the whole line — it just shows
       the amount with no rate. */
    var itemizedTaxes = (policy.quote.rating_engine_breakdown && policy.quote.rating_engine_breakdown.itemized_taxes) || policy.quote.itemized_taxes || null;
    if (itemizedTaxes && itemizedTaxes.length) {
      itemizedTaxes.forEach(function (t) { rows.push([t.name, "", money(t.amount)]); });
    } else {
      /* taxPct is a plain percentage number (4.5 meaning 4.5%), same convention as countyRate right
         below, fee.pct in feeDetail() above, and policy-document.js's own identical tax.pct field
         for this same quote — not a fraction. This used to multiply by 100 on top of that, showing
         a 4.5% rate as "450%". */
      if (q.tax != null) rows.push(["Tax", q.taxPct != null ? q.taxPct + "%" : "", money(q.tax)]);
      if (q.countyName) rows.push([q.countyName + " county tax", q.countyRate != null ? q.countyRate + "%" : "", money(q.countyTax)]);
    }
    rows.push([ui.h("strong", {}, "Total premium"), "", ui.h("strong", {}, money(q.finalPremium))]);

    var lineItems = ui.panel({ title: "Line items", pad: 0 }, []);
    lineItems.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Description", "Detail", "Amount"],
      rows: rows,
    }));
    page.appendChild(lineItems);

    var actionBar = ui.h("div", { class: "action-bar", style: { marginTop: "18px", display: "flex", gap: "10px", alignItems: "center" } });
    var printBtn = ui.h("button", { class: "btn" }, [PAS.icon("file-text", { size: 13 }), document.createTextNode(" Print")]);
    printBtn.addEventListener("click", function () { window.print(); });
    actionBar.appendChild(printBtn);
    if (doc.deliveryStatus === "Delivered") {
      actionBar.appendChild(ui.pill("green", "Sent to accounts on " + PAS.fmtDate(doc.deliveredAt)));
    } else {
      var sendBtn = ui.h("button", { class: "btn tone-primary" }, [PAS.icon("send", { size: 13 }), document.createTextNode(" Send to accounts")]);
      sendBtn.addEventListener("click", function () {
        PAS.api.call("POST", "/api/v1/policies/" + policy.id + "/invoices/" + doc.id + "/send", {},
          { module: "Servicing", policyId: policy.id, statusCode: 200, label: "Send invoice to accounts — " + policy.holder, response: { events: [] } })
          .then(function () { PAS.sendInvoiceToAccounts(policy.id, doc.id); render(); });
      });
      actionBar.appendChild(sendBtn);
    }
    page.appendChild(actionBar);

    root.appendChild(ui.screen("invoice", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
