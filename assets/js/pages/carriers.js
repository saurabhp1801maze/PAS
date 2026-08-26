(function () {
  "use strict";
  var PAS = window.PAS;
  function render() {
    PAS.renderEntityBook({
      pageKey: "carriers", href: "carriers.html", paramName: "carrier", fieldName: "carrier",
      typeMap: null,
      icon: "shield-check", tone: "green",
      title: "Carriers", titleUpper: "Carriers", titleLower: "carriers", singularLower: "carrier", article: "a",
      sub: "Every risk-bearing partner Veridex places business with",
      what: "The insurer whose paper each policy is actually written on.",
      why: "Concentration on one carrier's paper is a placement risk worth watching.",
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
