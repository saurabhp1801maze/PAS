/* Ported from PolicyDetailPage in the original App.jsx. Click-through tabs — cover, money split,
   vehicles, every lifecycle decision, documents, ledger — rather than one long scrolling page, so
   each section stays a manageable size and the URL (?tab=) still names where you are. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var RISK_LABELS = {
    claimFreeYears: "Claim-free years", otherClaims: "Other claims (non-fault)", atFaultClaims: "At-fault claims",
    priorCancellations: "Prior cancellations", nonPayment: "Non-payment history", newBusiness: "New business",
    infoPending: "Information pending",
  };

  var ACTIVITY_LABEL = {
    Issuance: "Issuance", Underwriting: "Underwriting decision", Endorsement: "Endorsement",
    Renewal: "Renewal", Cancellation: "Cancellation", Reinstatement: "Reinstatement",
    Transfer: "Transfer", Servicing: "Servicing note",
  };

  function money(n) { return PAS.money(n); }
  function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }

  function sectionHead(title, sub) {
    var head = ui.h("div", { class: "kpi-section-head", style: { marginTop: "4px" } }, [
      ui.h("span", { class: "kpi-section-label" }, title),
    ]);
    if (sub) head.appendChild(ui.h("span", { class: "kpi-section-sub" }, sub));
    return head;
  }
  function section(id, title, sub, body) {
    var wrap = ui.h("section", { class: "pd-section", id: "pd-" + id }, [sectionHead(title, sub)]);
    (Array.isArray(body) ? body : [body]).forEach(function (n) { wrap.appendChild(n); });
    return wrap;
  }

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var policy = PAS.getPolicy(sp.get("policy"));
    if (!policy) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }
    var tab = sp.get("tab") || "cover";

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Policy register", function () { location.href = "registry.html"; }));
    page.appendChild(ui.recordHead(policy));
    var overviewKpis = ui.kpiRow([
      { label: "Term", value: PAS.fmtDate(policy.effectiveDate) + " → " + PAS.fmtDate(policy.expirationDate), tip: "Current coverage period." },
      { label: "Premium", value: PAS.money(policy.premium), tip: "Annual written premium." },
      { label: "Sum insured", value: policy.sumInsured || "—", tip: "Total limit of indemnity." },
      { label: "Transactions", value: policy.history.length, tip: "Entries in the append-only ledger." },
      { label: "Documents", value: (policy.documents && policy.documents.length) || 0, tip: "Stored document versions." },
    ]);
    overviewKpis.classList.add("pd-overview-kpis");
    page.appendChild(overviewKpis);

    var fleet = PAS.vehicleFleetFor(policy);
    /* A quote-imported policy's real driver roster (issuedQuoteMeta.drivers — name/DOB/DL number/
       license class/experience/verification status) is a genuinely different, richer shape than
       the synthetic hash-generated fleet above, and most imported LOBs (e.g. Commercial Trucking)
       don't match vehicleFleetFor's "Comprehensive Auto" gate anyway. Kept as its own tab rather
       than forced into vehicleCard's make/model/VIN shape, which has no real data to show here. */
    var importedDrivers = policy.quote && policy.quote.issuedQuoteMeta && Array.isArray(policy.quote.issuedQuoteMeta.drivers) && policy.quote.issuedQuoteMeta.drivers.length
      ? policy.quote.issuedQuoteMeta.drivers : null;

    var tabDefs = [
      ["cover", "Cover"],
      ["parties", "Parties"],
      ["financial", "Financial performance"],
      ["distribution", "Where the premium goes"],
    ];
    if (fleet) tabDefs.push(["vehicles", fleet.isFleet ? "Vehicles & drivers" : "Vehicle & drivers"]);
    if (importedDrivers) tabDefs.push(["drivers", "Drivers"]);
    tabDefs.push(
      ["claims", "Claims & risk"],
      ["activity", "Activity & decisions"],
      ["documents", "Documents"],
      ["ledger", "Transaction ledger"],
      ["terms", "Term history"],
      ["xref", "Cross-references"]
    );

    var sectionFns = {
      cover: coverSection, parties: partiesSection, financial: financialSection, distribution: distributionSection,
      claims: claimsSection, activity: activitySection, ledger: ledgerSection, terms: termsSection,
      xref: xrefSection,
      documents: function (p) { return documentsSection(p, render); },
    };
    if (fleet) sectionFns.vehicles = function () { return vehiclesSection(fleet); };
    if (importedDrivers) sectionFns.drivers = function () { return driversSection(importedDrivers); };
    var activeTab = sectionFns[tab] ? tab : "cover";

    var tabsRow = ui.h("div", { class: "tabs pd-tabs", role: "tablist" });
    tabDefs.forEach(function (td) {
      var btn = ui.h("button", { class: "tab-btn" + (activeTab === td[0] ? " active" : ""), role: "tab", "aria-selected": activeTab === td[0] ? "true" : "false" }, td[1]);
      btn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=" + td[0]; });
      tabsRow.appendChild(btn);
    });
    page.appendChild(tabsRow);
    page.appendChild(sectionFns[activeTab](policy));

    root.appendChild(ui.screen("detail", page));
  }

  /* ================= financial performance ================= */
  function financialSection(policy) {
    var claims = policy.claims || [];
    var incurred = claims.reduce(function (s, c) { return s + (c.incurred || 0); }, 0);
    var openReserve = claims.filter(function (c) { return c.status === "Open"; }).reduce(function (s, c) { return s + (c.reserved || 0); }, 0);
    var f = PAS.bookFinancials([policy]);
    var lossRatio = PAS.lossRatio([policy]);
    var lossTone = lossRatio >= 0.85 ? "red" : lossRatio >= 0.6 ? "amber" : "green";
    var combinedTone = f.combinedRatio >= 1 ? "red" : f.combinedRatio >= 0.95 ? "amber" : "green";
    return section("financial", "Financial performance", "Earned basis, as of today", [
      ui.kpiRow([
        { label: "Earned premium", value: PAS.moneyShort(f.earnedPremium), tone: "blue", tip: "This policy's share of premium actually on risk to date, across its whole life." },
        { label: "Incurred claims", value: PAS.moneyShort(incurred - openReserve), tone: "red", tip: "Claims actually paid out, of " + claims.length + " claim" + (claims.length === 1 ? "" : "s") + " on file — reserved amounts are shown separately, in Open reserves." },
        { label: "Open reserves", value: PAS.moneyShort(openReserve), tone: "amber", tip: "Set aside for claims not yet closed. Open reserves + Incurred (paid) = total incurred claims, the figure Loss ratio is actually computed from." },
        { label: "Loss ratio", value: pct(lossRatio), tone: lossTone, tip: "Incurred ÷ earned premium — the earned, not written, basis." },
        { label: "Combined ratio", value: pct(f.combinedRatio), tone: combinedTone, tip: pct(lossRatio) + " loss ratio + " + pct(f.expenseRatio) + " acquisition cost." },
      ]),
    ]);
  }

  /* ================= where the premium goes ================= */
  /* Three paid parties, not four: Broker (retail commission), MGA facility (the override —
     everything left after the broker's cut), and Carrier (what's left of premium once commission
     is carved out; this app calls the same field "Reinsurer" on the entity-book pages). No
     separate "Vikram & Sons platform margin" line — Vikram & Sons's revenue is a portfolio-level P&L question
     (PAS.bookFinancials' netCommission, what the Dashboard reports), not a party on any one
     transaction, so it doesn't belong in a per-policy "who gets paid" view. */
  function distributionSection(policy) {
    var rate = PAS.commissionRateOf(policy);
    var direct = PAS.isDirect(policy);
    var gross = policy.premium * rate;
    var brokerShare = direct ? 0 : gross * PAS.BROKER_COMMISSION_SHARE;
    var mgaShare = gross - brokerShare;
    var carrierRetention = policy.premium - gross;
    var carrierPct = policy.premium ? carrierRetention / policy.premium : 0;
    var brokerPct = policy.premium ? brokerShare / policy.premium : 0;
    var mgaPct = policy.premium ? mgaShare / policy.premium : 0;

    var bar = ui.h("div", { class: "split-bar" }, [
      ui.h("div", { class: "split-seg carrier", style: { width: (carrierPct * 100) + "%" } }, carrierPct > 0.12 ? pct(carrierPct) : ""),
      ui.h("div", { class: "split-seg broker", style: { width: (brokerPct * 100) + "%" } }, brokerPct > 0.06 ? pct(brokerPct) : ""),
      ui.h("div", { class: "split-seg mga", style: { width: (mgaPct * 100) + "%" } }, mgaPct > 0.06 ? pct(mgaPct) : ""),
    ]);

    function legendItem(dotClass, name, value, sub) {
      return ui.h("div", { class: "split-legend-item" }, [
        ui.h("span", { class: "split-legend-dot " + dotClass }),
        ui.h("span", { class: "split-legend-name" }, name),
        ui.h("div", { class: "split-legend-val" }, value),
        ui.h("div", { class: "split-legend-sub" }, sub),
      ]);
    }
    var legend = ui.h("div", { class: "split-legend" }, [
      legendItem("carrier", "Carrier / reinsurer", money(carrierRetention), pct(carrierPct) + " · " + (policy.carrier || "—")),
      legendItem("broker", "Broker commission", money(brokerShare), direct ? "Direct business — no broker to pay" : pct(brokerPct) + " of premium · " + policy.producer),
      legendItem("mga", "MGA commission", money(mgaShare), pct(mgaPct) + " of premium · " + (policy.mga || "no MGA on this policy")),
    ]);

    var panel = ui.panel({ title: "Premium split", what: "Who is actually paid on this policy's written premium." }, []);
    var body = panel.querySelector(".panel-body");
    body.appendChild(bar);
    body.appendChild(legend);
    body.appendChild(ui.h("div", { class: "faint-note", style: { marginTop: "10px" } },
      "Gross commission " + money(gross) + " (" + pct(rate) + " of premium, this product's rate) splits " +
      Math.round(PAS.BROKER_COMMISSION_SHARE * 100) + "/" + Math.round((1 - PAS.BROKER_COMMISSION_SHARE) * 100) +
      " broker/MGA. That MGA figure is the same 45%-of-commission bucket the portfolio Dashboard and the MGA pages report as Vikram & Sons's own net revenue (PAS.bookFinancials' netCommission) — recharacterized here as the named MGA facility's override, since that's the party actually paid in a real distribution chain. The two views disagree on whose money this is; the MGA list/detail pages still show $0 commission for MGA facilities. Reconciling that needs a decision on whether this is Vikram & Sons's margin or an MGA override, not just a label change on this one page."));

    return section("distribution", "Where the premium goes", money(policy.premium) + " written premium, split by who is actually paid on it", panel);
  }

  /* ================= cover ================= */
  function coverSection(policy) {
    var panel = ui.panel({ title: "Cover", what: "What the policy insures." }, []);
    var cb = panel.querySelector(".panel-body");
    cb.appendChild(ui.kv({ k: "Product", v: policy.product }));
    cb.appendChild(ui.kv({ k: "Sum insured", v: policy.sumInsured || "—" }));
    cb.appendChild(ui.kv({ k: "Premium", v: PAS.money(policy.premium) }));
    cb.appendChild(ui.kv({ k: "Term number", v: policy.termNumber, what: "How many times this policy has renewed." }));
    cb.appendChild(ui.kv({ k: "State", v: policy.state || "—", what: "Jurisdiction this risk is written in." }));
    cb.appendChild(ui.kv({ k: "Submitted", v: (policy.submittedOn || policy.effectiveDate) ? PAS.fmtDate(policy.submittedOn || policy.effectiveDate) : "—", what: "When this record first entered the book.", why: policy.submittedOn ? "" : "Not separately recorded for this record — falls back to its effective date." }));
    /* Historical, not a live blocking state: this is what the source quote flagged to underwriting
       at QUOTE TIME. It never gets "cleared" — PAS.importQuote activates the policy immediately
       regardless of it — so keeping the old "not yet cleared" warning phrasing read as an
       outstanding problem on an already-Active policy, forever. Framed as a quote-time fact
       (info tone, explicit "at quote time" + the current-status caveat), the same way the Source
       quote details block below separates the source system's own status from this record's. */
    if (policy.quote && policy.quote.eligibility && (policy.quote.eligibility.refers || []).length) {
      cb.appendChild(ui.callout("info", "This quote referred to underwriting at quote time for: " + policy.quote.eligibility.refers.join(", ") + ". Informational only — PAS activated this policy immediately on import regardless of this flag."));
    }
    /* Everything below is the source rating-engine quote's own reported metadata — read straight
       off policy.quote.issuedQuoteMeta (never copied onto the policy record itself, so it always
       reflects exactly what was imported). Its bind/policy status text describes the UPSTREAM
       system's state at export time, which is deliberately NOT the same thing as this record's own
       `status` field above (PAS activates an imported quote immediately on import) — labelled as
       such so the two are never mistaken for one another. */
    var iqm = policy.quote && policy.quote.issuedQuoteMeta;
    if (iqm) {
      var qmWrap = ui.h("div", { class: "mt-13" });
      qmWrap.appendChild(ui.tipLabel({ text: "Source quote details", what: "Metadata reported by the rating engine that produced this quote — not fields on the policy record itself.", className: "label-11 block mb-9" }));
      if (iqm.quoteNumber) qmWrap.appendChild(ui.kv({ k: "Quote number", v: iqm.quoteNumber, mono: true }));
      if (iqm.quoteDate) qmWrap.appendChild(ui.kv({ k: "Quote date", v: PAS.fmtDate(iqm.quoteDate) }));
      if (iqm.bindDate) qmWrap.appendChild(ui.kv({ k: "Bind date", v: PAS.fmtDate(iqm.bindDate) }));
      if (iqm.bindStatus) qmWrap.appendChild(ui.kv({ k: "Bind status (source system)", v: iqm.bindStatus, why: "As reported by the rating engine at export time — separate from this record's own Status above, which PAS sets on import." }));
      if (iqm.policyStatus) qmWrap.appendChild(ui.kv({ k: "Policy status (source system)", v: iqm.policyStatus, why: "As reported by the rating engine at export time — separate from this record's own Status above, which PAS sets on import." }));
      if (iqm.product) qmWrap.appendChild(ui.kv({ k: "Program", v: iqm.product, what: "The rating engine's own product/program name — may be more specific than the LOB above." }));
      /* issuedQuoteMeta isn't a fixed schema — a rating engine can (and does) add fields this page
         has never seen before (e.g. fleetSizeMinimum, radiusOfOperation — the underwriting.refers
         reasons' own trigger values). Rather than hand-coding every field name as it shows up and
         silently dropping whatever hasn't been coded yet, anything not already rendered above (or
         handled elsewhere — parties/drivers/issuedBy) is shown automatically below. */
      var IQM_HANDLED_KEYS = { quoteNumber: 1, quoteDate: 1, bindDate: 1, bindStatus: 1, policyStatus: 1, product: 1, parties: 1, drivers: 1, issuedBy: 1 };
      var extraKeys = Object.keys(iqm).filter(function (k) { return !IQM_HANDLED_KEYS[k] && iqm[k] != null && iqm[k] !== ""; });
      if (extraKeys.length) {
        extraKeys.forEach(function (k) {
          var label = k.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }).trim();
          var val = iqm[k];
          var display = Array.isArray(val)
            ? val.map(function (v) { return typeof v === "object" && v ? JSON.stringify(v) : String(v); }).join(", ")
            : (typeof val === "object" ? JSON.stringify(val) : String(val));
          qmWrap.appendChild(ui.kv({ k: label, v: display, why: "Reported by the rating engine — not a field this page specifically knows about, shown automatically." }));
        });
      }
      cb.appendChild(qmWrap);
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
    return section("cover", "Cover", null, panel);
  }

  /* ================= parties ================= */
  function partiesSection(policy) {
    var panel = ui.panel({ title: "Parties & distribution", what: "Who is insured and who placed the business." }, []);
    var pb = panel.querySelector(".panel-body");
    pb.appendChild(ui.kv({ k: "Named insured", v: policy.holder }));
    (policy.parties && policy.parties.additionalInsureds || []).forEach(function (n, i) {
      pb.appendChild(ui.kv({ k: "Additional insured " + (i + 1), v: n }));
    });
    (policy.parties && policy.parties.certificateHolders || []).forEach(function (n, i) {
      pb.appendChild(ui.kv({ k: "Certificate holder " + (i + 1), v: n }));
    });
    pb.appendChild(ui.kv({ k: "Producer", v: policy.producer, what: "Broker or channel that placed the risk — the initiator, not the decision-maker." }));
    /* Underwritten by: who accepted the risk — PAS.underwriterOf, the one shared source every
       screen that names this reads from (also the renewal pipeline's owner column, requestedByCell
       on Pending Approvals). Normally a real completed Underwriting decision; for a quote-imported
       policy (no separate underwriting step at all) it's the source quote's own issuedBy. */
    var uwDecision = policy.history.filter(function (h) { return h.type === "Underwriting" && h.status === "Completed"; }).sort(function (a, b) { return b.seq - a.seq; })[0];
    var uwName = PAS.underwriterOf(policy);
    pb.appendChild(ui.kv({
      k: "Underwritten by", v: uwName || "—",
      what: uwDecision ? "Who actually approved or declined this risk — read from that decision's own audit trail, not the initiator."
        : uwName ? "No separate underwriting decision on this record — it was issued directly from an imported quote, so this is who/what issued it, per the source rating engine."
        : "No completed underwriting decision on file yet.",
      why: "Producer is who asked; this is who accepted the risk and is accountable for it.",
    }));
    pb.appendChild(ui.kv({ k: "MGA", v: policy.mga || "—", what: "Wholesale facility holding binding authority on this risk." }));
    pb.appendChild(ui.kv({ k: "Carrier", v: policy.carrier || "—", what: "Risk-bearing partner this policy is actually written on." }));
    pb.appendChild(ui.kv({ k: "ETag", v: policy.etag || PAS.getPolicyEtag(policy.id), mono: true, what: "Concurrency token for PAS API writes." }));
    pb.appendChild(ui.kv({ k: "Auto-renew", v: policy.autoRenew ? "Yes" : "No" }));
    pb.appendChild(ui.kv({ k: "Status", v: ui.badge(policy.status) }));
    if (policy.binder) {
      pb.appendChild(ui.tipLabel({ text: "Binder", what: "Provisional cover note — legal evidence of cover until formal issue.", className: "label-11 block mt-13 mb-9" }));
      pb.appendChild(ui.kv({ k: "Binder number", v: policy.binder.number, mono: true }));
      pb.appendChild(ui.kv({ k: "Bound on", v: policy.binder.boundOn ? PAS.fmtDate(policy.binder.boundOn) : "—" }));
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
    return section("parties", "Parties", null, panel);
  }

  /* ================= vehicles & drivers ================= */
  function vehicleCard(v) {
    var card = ui.h("div", { class: "veh-card" }, [
      ui.h("div", { class: "veh-unit" }, v.unit),
      ui.h("div", { class: "veh-meta" }, v.type + " · " + v.make + " " + v.model + " · " + v.year),
      ui.h("div", { class: "veh-vin" }, v.vin),
    ]);
    if (v.drivers.length) {
      card.appendChild(ui.h("div", { class: "veh-drivers-label" }, "Drivers (" + v.drivers.length + ")"));
      var row = ui.h("div", { class: "driver-chip-row" });
      v.drivers.forEach(function (d, i) {
        var initials = d.name.trim().split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join("").toUpperCase();
        row.appendChild(ui.h("span", { class: "driver-chip" + (i === 0 ? " lead" : "") }, [
          ui.h("span", { class: "driver-avatar" }, initials),
          document.createTextNode(d.name + " "),
          ui.h("span", { class: "role" }, "· " + d.contextRole),
        ]));
      });
      card.appendChild(row);
    } else {
      card.appendChild(ui.h("div", { class: "faint-note", style: { marginTop: "11px" } }, "No named driver — trailer, towed by an assigned truck."));
    }
    return card;
  }
  function vehiclesSection(fleet) {
    var grid = ui.h("div", { class: "veh-grid" }, fleet.vehicles.map(vehicleCard));
    var sub = fleet.vehicles.length > 1 ? "Every unit on this policy, with the driver(s) assigned to it" : "This vehicle, with every driver who operates it";
    return section("vehicles", fleet.isFleet ? "Vehicles & drivers" : "Vehicle & drivers", sub, grid);
  }

  /* Real driver data straight from the imported quote — its own shape (age, DOB, DL number,
     verification status), never forced into the synthetic fleet's make/model/VIN card layout,
     which has nothing real to show for these fields anyway. */
  function driversSection(drivers) {
    var table = ui.dataTable({
      columns: ["Name", "Age", "Sex", "DOB", "License #", "License state", "License class", "Experience", "Status"],
      rows: drivers.map(function (d) {
        return [
          d.name || "—", d.age != null ? String(d.age) : "—", d.sex || "—",
          d.dob || "—", d.dlNumber || "—", d.licenseState || "—", d.licenseClass || "—",
          d.experience || "—",
          d.status ? ui.pill(/pending/i.test(d.status) ? "amber" : /verified|confirmed/i.test(d.status) ? "green" : "gray", d.status) : "—",
        ];
      }),
      emptyText: "No drivers on the imported quote.",
    });
    return section("drivers", "Drivers", "As reported on the imported rating-engine quote, not the synthetic fleet model", table);
  }

  /* ================= claims & risk ================= */
  function claimsSection(policy) {
    var claims = policy.claims || [];
    var body = [];
    body.push(ui.tipLabel({ text: "Claims", what: "Every claim reported against this policy.", className: "label-11 block mb-9" }));
    body.push(ui.dataTable({
      columns: ["Type", "Status", "Reported", "Incurred", "Paid", "Reserved"],
      rows: claims.map(function (c) {
        return [c.type, ui.pill(c.status === "Open" ? "amber" : "gray", c.status), c.reportedOn, PAS.money(c.incurred), PAS.money(c.paid), PAS.money(c.reserved)];
      }),
      emptyText: "No claims on file for this policy.",
    }));

    var risk = policy.risk || {};
    var riskKeys = Object.keys(RISK_LABELS).filter(function (k) { return risk[k] !== undefined && risk[k] !== false; });
    if (riskKeys.length) {
      var riskPanel = ui.h("div", { class: "mt-18" });
      riskPanel.appendChild(ui.tipLabel({ text: "Underwriting factors", what: "The risk inputs behind this policy's underwriting decision.", className: "label-11 block mb-9" }));
      riskKeys.forEach(function (k) {
        riskPanel.appendChild(ui.kv({ k: RISK_LABELS[k], v: typeof risk[k] === "boolean" ? "Yes" : String(risk[k]) }));
      });
      if (risk.infoPendingNote) riskPanel.appendChild(ui.kv({ k: "Note", v: risk.infoPendingNote }));
      body.push(riskPanel);
    }

    var policyAudit = PAS.getGlobalAuditLog().filter(function (a) { return a.policyId === policy.id; });
    body.push(ui.tipLabel({ text: "Admin audit trail (" + policyAudit.length + ")", what: "Every PAS-admin-level write against this specific record.", why: "Separate from the transaction ledger below — this is the security/compliance log, not the business history.", className: "label-11 block mt-18 mb-9" }));
    body.push(ui.dataTable({
      columns: ["When", "User", "Action", "Detail"],
      rows: policyAudit.map(function (a) { return [(a.at || "").slice(0, 19), a.user, a.action, a.detail || "—"]; }),
      emptyText: "No admin-level writes recorded against this record yet.",
    }));
    return section("claims", "Claims & risk", null, body);
  }

  /* ================= activity & decisions ================= */
  function activityField(k, v, kTitle) {
    return ui.h("div", {}, [ui.h("div", { class: "af-k", title: kTitle || null }, k), ui.h("div", { class: "af-v" }, v)]);
  }
  function activityCard(h) {
    var meta = h.meta || {};
    var fields = [];
    if (h.type === "Issuance") {
      fields = [activityField("Bound by", h.approvedBy || h.user || "System")];
    } else if (h.type === "Underwriting") {
      var outcome = (h.title || "").replace(/^Underwriting:\s*/, "") || "—";
      fields = [
        activityField("Outcome", outcome),
        activityField("Risk score", meta.score != null ? String(meta.score) : "—"),
        activityField("Authority tier", meta.tier || "—"),
        activityField("Decided by", h.user || "—"),
      ];
    } else if (h.type === "Endorsement") {
      var impact = meta.premiumImpact || 0;
      fields = [
        activityField("Change type", meta.changeType || "—"),
        activityField("Materiality", meta.materiality || "—"),
        activityField("Premium impact", impact ? (impact >= 0 ? "+" : "") + money(impact) : "No premium impact"),
        activityField("Initiated by", meta.initiatedBy || "—"),
      ];
    } else if (h.type === "Renewal") {
      if (meta.renewalNotice) {
        var r = meta.recipients || {};
        fields = [activityField("Notified", [r.customer, r.underwriter, r.lead].filter(Boolean).join(", ") || "—")];
      } else if (meta.previousPremium != null) {
        var delta = meta.newPremium - meta.previousPremium;
        fields = [
          activityField("Premium before", money(meta.previousPremium)),
          activityField("Premium after", money(meta.newPremium)),
          activityField("Change", (delta >= 0 ? "+" : "") + money(delta) + (meta.previousPremium ? " (" + pct(delta / meta.previousPremium) + ")" : "")),
        ];
      }
    } else if (h.type === "Cancellation") {
      fields = [
        activityField("Reason", meta.reason || "—"),
        activityField("Initiated by", meta.initiatedBy || "—"),
        activityField("Type", meta.cancelType || "—"),
        activityField("Refund", meta.refund != null ? money(meta.refund) : "—"),
      ];
    } else if (h.type === "Reinstatement") {
      fields = [
        activityField("Days since cancellation", meta.gapDays != null ? meta.gapDays + "d" : "—"),
        activityField("Outstanding collected", meta.outstanding != null ? money(meta.outstanding) : "—"),
        activityField("Decided by", h.user || "—"),
      ];
    } else if (h.type === "Transfer") {
      fields = [activityField("Previous holder", meta.previousHolder || "—"), activityField("New holder", meta.newHolder || "—")];
    } else if (h.type === "Servicing") {
      fields = [activityField("Category", meta.category || "—"), activityField("Channel", meta.channel || "—"), activityField("SLA", meta.sla || "—", "SLA = Service Level Agreement: the turnaround commitment for this category.")];
    }

    var card = ui.h("div", { class: "activity-card", dataset: { kind: h.type } }, [
      ui.h("div", { class: "activity-head" }, [
        ui.h("span", { class: "activity-kind" }, ACTIVITY_LABEL[h.type] || h.type),
        ui.h("span", { class: "activity-date" }, h.date),
      ]),
    ]);
    if (fields.length) card.appendChild(ui.h("div", { class: "activity-fields" }, fields));
    card.appendChild(ui.h("div", { class: "activity-detail" }, h.detail));
    return card;
  }
  function activitySection(policy) {
    var sorted = policy.history.slice().sort(function (a, b) { return b.seq - a.seq; });
    var list = ui.h("div", { class: "activity-list" }, sorted.map(activityCard));
    return section("activity", "Activity & decisions", "Every issuance, underwriting call, endorsement, renewal, cancellation and reinstatement on this policy", list);
  }

  /* ================= documents ================= */
  function documentsSection(policy, rerender) {
    var headRow = ui.h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "11px" } });
    headRow.appendChild(ui.tipLabel({ text: "Generated documents", what: "Versioned PDFs produced by the platform and stored against the policy.", why: "Every issue, endorsement and cancellation regenerates the pack so the customer's copy matches the system of record." }));
    var genBtn = ui.h("button", { class: "btn tone-primary" }, [PAS.icon("plus", { size: 13 }), document.createTextNode(" Generate schedule")]);
    genBtn.addEventListener("click", function () {
      PAS.api.call("POST", "/api/v1/policies/" + policy.id + "/documents", { template: "policySchedule" },
        { module: "Issuance", policyId: policy.id, statusCode: 201, label: "Generate schedule — " + policy.holder, response: { documentId: PAS.uid("DOC"), name: "Policy schedule", version: ((policy.documents && policy.documents.length) || 0) + 1, events: ["documentGenerated"] } })
        .then(function () { PAS.generateDoc(policy.id, "Policy schedule", "Schedule"); rerender(); });
    });
    headRow.appendChild(genBtn);
    if (policy.quote) {
      var invBtn = ui.h("button", { class: "btn" }, [PAS.icon("file-text", { size: 13 }), document.createTextNode(" Generate invoice")]);
      invBtn.addEventListener("click", function () {
        PAS.api.call("POST", "/api/v1/policies/" + policy.id + "/documents", { template: "invoice" },
          { module: "Servicing", policyId: policy.id, statusCode: 201, label: "Generate invoice — " + policy.holder, response: { documentId: PAS.uid("DOC"), name: "Invoice", events: ["documentGenerated"] } })
          .then(function () {
            var updated = PAS.generateInvoice(policy.id);
            var newDoc = updated.documents.filter(function (d) { return d.type === "Invoice"; }).pop();
            location.href = "invoice.html?policy=" + encodeURIComponent(policy.id) + "&doc=" + encodeURIComponent(newDoc.id);
          });
      });
      headRow.appendChild(invBtn);
    }
    var table = ui.dataTable({
      columns: ["Document", { label: "Type", what: "Schedule, certificate, invoice, notice or evidence." }, { label: "Version", what: "Incremented each regeneration.", why: "Lets you prove what the customer held on any date." }, "Generated", { label: "Delivery", what: "PAS document delivery status — or, for evidence received from the insured/broker, when it arrived." }, { label: "Txn", what: "Ledger row that triggered generation, or that this evidence supports." }, ""],
      rows: (policy.documents || []).map(function (d) {
        var nameSpan = ui.h("span", { style: { display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: "600" } }, [PAS.icon("file-text", { size: 13, color: "var(--color-link)" }), document.createTextNode(d.name)]);
        var actions = ui.h("span", { style: { display: "inline-flex", gap: "6px" } });
        if (d.type === "Invoice") {
          var viewBtn = ui.h("button", { class: "btn small" }, "View");
          viewBtn.addEventListener("click", function (e) { e.stopPropagation(); location.href = "invoice.html?policy=" + encodeURIComponent(policy.id) + "&doc=" + encodeURIComponent(d.id); });
          actions.appendChild(viewBtn);
          var downloadBtn = ui.h("button", { class: "btn small" }, [PAS.icon("download", { size: 12 }), document.createTextNode(" Download")]);
          downloadBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var payload = PAS.invoicePayload(policy, d);
            PAS.api.call("GET", "/api/v1/policies/" + policy.id + "/invoices/" + d.id, {},
              { module: "Servicing", policyId: policy.id, statusCode: 200, label: "Download invoice — " + policy.holder, response: payload })
              .then(function () { PAS.downloadJson((payload.invoiceNumber || d.name) + ".json", payload); });
          });
          actions.appendChild(downloadBtn);
        } else if (d.type === "Policy Document" && d.payload) {
          /* Policy documents leave PAS as a PDF (browser print-to-PDF on the formatted view),
             matching how a customer actually receives one — unlike the invoice, which stays JSON
             for the Billing module to consume programmatically. */
          var viewDocBtn = ui.h("button", { class: "btn small" }, "View");
          viewDocBtn.addEventListener("click", function (e) { e.stopPropagation(); location.href = "policy-document.html?policy=" + encodeURIComponent(policy.id) + "&doc=" + encodeURIComponent(d.id); });
          actions.appendChild(viewDocBtn);
        }
        /* "Received" means this arrived FROM the insured/broker as evidence for a request (a
           driver's license, a signed renewal declaration, proof of payment) — there is nothing
           for PAS to deliver onward, so the outbound "Mark delivered"/"Mark sent" action doesn't
           apply to it, unlike every other document type here which PAS itself generates and sends. */
        if (d.deliveryStatus !== "Received") {
          var delBtn = ui.h("button", { class: "btn small" }, d.type === "Invoice" ? "Mark sent" : "Mark delivered");
          delBtn.addEventListener("click", function (e) { e.stopPropagation(); PAS.markDocumentDelivered(policy.id, d.id); rerender(); });
          actions.appendChild(delBtn);
        }
        var deliveryTone = (d.deliveryStatus === "Delivered" || d.deliveryStatus === "Received") ? "green" : "amber";
        return [nameSpan, d.type, ui.pill("gray", "v" + d.version), PAS.fmtDate(d.generatedAt), ui.pill(deliveryTone, d.deliveryStatus || "Generated"), d.transactionId ? d.transactionId.slice(0, 12) : "—", actions];
      }),
      emptyText: "No documents yet. Issuing the policy generates the schedule and certificate.",
    });
    return section("documents", "Documents", "Every generated version, not just the latest", [headRow, table]);
  }

  /* ================= transaction ledger ================= */
  function ledgerSection(policy) {
    var sorted = policy.history.slice().sort(function (a, b) { return b.seq - a.seq; });
    var table = ui.dataTable({
      columns: [{ label: "Seq", what: "Order within this policy's ledger." }, "Date", "Type", { label: "Status", what: "Whether this transaction has been applied." }, "Detail", "By"],
      rows: sorted.map(function (h) {
        return [ui.h("span", { style: { fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--color-muted)" } }, "#" + h.seq), h.date, ui.modulePill(h.type), ui.txnStatusBadge(h.status, h.type, h.meta),
          ui.h("span", { style: { fontSize: "12px", color: "var(--color-ink-secondary)", whiteSpace: "normal", display: "inline-block", maxWidth: "420px" } }, h.detail), (h.approvedBy || h.user)];
      }),
    });
    return section("ledger", "Transaction ledger", "The raw append-only log the Activity & decisions tab is built from", table);
  }

  /* ================= term history ================= */
  function termsSection(policy) {
    var table = ui.dataTable({
      columns: ["Term", "Effective", "Expiration", "Premium", "Status"],
      rows: (policy.terms || []).map(function (t) {
        return [t.termNumber, PAS.fmtDate(t.effectiveDate), PAS.fmtDate(t.expirationDate), PAS.money(t.premium), PAS.statusLabel(t.status || policy.status)];
      }),
    });
    return section("terms", "Term history", null, table);
  }

  /* ================= as-of view ================= */
  /* ================= cross-references ================= */
  function xrefSection(policy) {
    var body = ui.h("div", {});
    var refs = policy.relatedPolicies || [];
    if (!refs.length) body.appendChild(ui.h("div", { class: "faint-note" }, "No related policies (rewrite, split, merge links appear here)."));
    else refs.forEach(function (rid) {
      var btn = ui.h("button", { class: "btn ghost-link" }, rid);
      btn.addEventListener("click", function () { location.href = "policy-detail.html?policy=" + encodeURIComponent(rid); });
      body.appendChild(btn);
    });
    return section("xref", "Cross-references", null, body);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
