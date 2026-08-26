(function () {
  "use strict";
  var PAS = window.PAS;
  function render() {
    PAS.renderEntityBook({
      pageKey: "customers", href: "customers.html", paramName: "customer", fieldName: "holder",
      typeMap: null, searchable: true,
      icon: "user", tone: "blue",
      title: "Customers", titleUpper: "Customers", titleLower: "customers", singularLower: "customer", article: "a",
      sub: "Search any insured to see every policy on file for them",
      what: "Every named insured across the book — search by name.",
      why: "A customer's full relationship with Veridex, not just the one policy you started from.",
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
