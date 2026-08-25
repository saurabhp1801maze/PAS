/* Ported from ServicingList in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var policies = PAS.getPolicies();
    var log = policies.reduce(function (acc, x) {
      x.history.filter(function (h) { return h.type === "Servicing"; }).forEach(function (h) { acc.push({ x: x, h: h }); });
      return acc;
    }, []);
    var page = ui.deskList({
      icon: "headphones", tone: "violet", title: "Servicing Desk", sub: "Operational requests against existing policies",
      what: "Requests that do not rise to a formal endorsement.",
      why: "Anything that moves a rating factor must become an endorsement, not stay a note.",
      kpis: [
        { label: "Requests logged", value: log.length, tip: "Servicing entries across the book." },
        { label: "Serviceable", value: policies.length, tip: "Any policy in any status can receive a request." },
        { label: "Channels", value: "4", tip: "Phone, email, portal, branch — all writing to one ledger." },
        { label: "Open SLA breaches", value: 0, tone: "green", tip: "Requests past their category SLA target." },
      ],
      columns: ["Policy", "Insured", { label: "Status", what: "Servicing is available in any lifecycle state." }, "Product", { label: "Requests", what: "Servicing entries already logged against this policy." }],
      rows: policies.map(function (x) { return [ui.cellId(x.id), ui.cellName(x.holder), ui.badge(x.status), x.product, x.history.filter(function (h) { return h.type === "Servicing"; }).length]; }),
      empty: "No policies.",
      onOpen: function (i) { location.href = "servicing-decision.html?policy=" + encodeURIComponent(policies[i].id); },
    });
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("servicing-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
