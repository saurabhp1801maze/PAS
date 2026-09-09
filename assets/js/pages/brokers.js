(function () {
  "use strict";
  var PAS = window.PAS;
  function render() {
    PAS.renderEntityBook({
      pageKey: "brokers", href: "brokers.html", paramName: "broker", fieldName: "producer",
      typeMap: PAS.BROKER_TYPE,
      icon: "users", tone: "amber",
      title: "Brokers", titleUpper: "Brokers", titleLower: "brokers", singularLower: "broker", article: "a",
      sub: "Every broker and individual producer placing business with Southlake",
      what: "Distribution partners — agencies and individual producers alike.",
      why: "Where the book's business actually comes from, and how much each one carries.",
      showFinancials: true,
      showCommission: true,
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
