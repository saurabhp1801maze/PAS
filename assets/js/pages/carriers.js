(function () {
  "use strict";
  var PAS = window.PAS;
  function render() {
    PAS.renderEntityBook({
      pageKey: "carriers", href: "carriers.html", paramName: "carrier", fieldName: "carrier",
      typeMap: null, showFinancials: true, showCession: true,
      icon: "shield-check", tone: "green",
      title: "Reinsurers", titleUpper: "Reinsurers", titleLower: "reinsurers", singularLower: "reinsurer", article: "a",
      sub: "Every risk-bearing partner Vikram & Sons places business with",
      what: "The insurer whose paper each policy is actually written on.",
      why: "Concentration on one reinsurer's paper is a placement risk worth watching.",
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
