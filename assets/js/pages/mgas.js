(function () {
  "use strict";
  var PAS = window.PAS;
  function render() {
    PAS.renderEntityBook({
      pageKey: "mgas", href: "mgas.html", paramName: "mga", fieldName: "mga",
      typeMap: PAS.MGA_TYPE,
      icon: "building-2", tone: "indigo",
      title: "MGAs", titleUpper: "MGAs", titleLower: "MGAs", singularLower: "MGA", article: "an",
      sub: "Every wholesale facility and individual MGA holding binding authority on the book",
      what: "The wholesale layer between Broker and Reinsurer — agency facilities and individual MGAs alike.",
      why: "Which facilities are carrying the most bound risk, and how concentrated that is.",
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
