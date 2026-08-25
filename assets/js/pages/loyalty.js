/* Loyalty — identifies and ranks loyal customers from real ledger data (renewal count, claims,
   cancellation history, premium value), against a configurable weight table rather than a
   fabricated points balance. See PAS.LOYALTY_CRITERIA / PAS.loyaltyScore in store.js. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies().filter(function (p) { return p.status === "Active"; });
    var scored = policies.map(function (p) { return { p: p, s: PAS.loyaltyScore(p) }; })
      .sort(function (a, b) { return b.s.score - a.s.score; });

    var byTier = {};
    PAS.LOYALTY_TIERS.forEach(function (t) { byTier[t.name] = 0; });
    scored.forEach(function (x) { byTier[x.s.tier]++; });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "award", tone: "amber", title: "Loyalty",
      sub: "Every active customer, ranked by a configurable, transparent score",
      what: "Renewal count, claims-free history, cancellation history and premium value — the same four real signals every customer's tier is built from.",
      why: "A loyalty program that can't show its own math trains customers to distrust it.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Active customers", value: scored.length, tip: "Every in-force policy scored." },
    ].concat(PAS.LOYALTY_TIERS.map(function (t) {
      return { label: t.name, value: byTier[t.name], tone: t.tone, tip: byTier[t.name] + " customer(s) at " + t.min + "+ points." };
    }))));

    var critPanel = ui.panel({
      title: "Scoring criteria",
      what: "The full weight table — configurable, and shown here exactly as the scoring function reads it.",
      why: "Every customer's score below is this table applied to their own ledger — nothing hidden between the two.",
      pad: 0,
    }, []);
    var w = PAS.LOYALTY_CRITERIA;
    critPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Criterion", { label: "Points", what: "Added when the criterion is met." }],
      rows: [
        ["Per completed renewal", "+" + w.perRenewalTerm],
        ["Claim-free (no claims on file)", "+" + w.claimFreeBonus],
        ["Never cancelled (no completed cancellation on record)", "+" + w.noCancellationBonus],
        ["High-value policy (premium ≥ " + PAS.money(w.highValuePremium) + ")", "+" + w.highValueBonus],
      ],
      wrapCells: true,
    }));
    page.appendChild(critPanel);

    var tierPanel = ui.panel({ title: "Tiers", what: "Score thresholds.", pad: 0 }, []);
    tierPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Tier", "Minimum score"],
      rows: PAS.LOYALTY_TIERS.map(function (t) { return [ui.pill(t.tone, t.name), t.min + "+"]; }),
      wrapCells: true,
    }));
    page.appendChild(tierPanel);

    var listPanel = ui.panel({
      title: "Customers, ranked",
      what: "Every active policy, highest score first. Click a row to open the policy.",
      pad: 0,
    }, []);
    listPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Policy", "Insured", "Product", { label: "Tier", what: "Derived from the score — never set by hand." },
        { label: "Score", what: "Sum of every criterion this customer meets." },
        { label: "Why", what: "The line-by-line derivation." }],
      rows: scored.map(function (x) {
        var whyCell = ui.h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } });
        if (x.s.lines.length === 0) whyCell.appendChild(ui.h("span", { class: "faint-note" }, "No criteria met yet"));
        x.s.lines.forEach(function (l) { whyCell.appendChild(ui.pill("gray", l.label + " +" + l.value)); });
        return [ui.cellId(x.p.id), ui.cellName(x.p.holder), x.p.product, ui.pill(x.s.tone, x.s.tier), x.s.score, whyCell];
      }),
      wrapCells: true,
      onRowClick: function (i) { location.href = "policy-detail.html?policy=" + encodeURIComponent(scored[i].p.id); },
    }));
    page.appendChild(listPanel);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("loyalty", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
