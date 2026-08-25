/* Configurable terms & conditions — per-product clauses, genuinely editable and persisted, not
   static copy. See PAS.TERMS_TEMPLATE / getTerms / updateTermClause / resetTermClause. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var products = Object.keys(PAS.TERMS_TEMPLATE);
    var totalClauses = products.reduce(function (s, p) { return s + PAS.TERMS_TEMPLATE[p].length; }, 0);

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "edit-3", tone: "indigo", title: "Terms & Conditions",
      sub: "Configurable clauses, per product line",
      what: "Illustrative standard clauses per product — generic placeholder wording, not any real insurer's filed policy language.",
      why: "Every clause below is editable and the edit persists across the session — this is what makes it \"configurable\" rather than static copy.",
    }));

    function countEdited() {
      var n = 0;
      products.forEach(function (p) { PAS.getTerms(p).forEach(function (c) { if (c.edited) n++; }); });
      return n;
    }

    var kpiContainer = ui.h("div", {});
    page.appendChild(kpiContainer);

    var groupsContainer = ui.h("div", {});
    page.appendChild(groupsContainer);

    function buildKpis() {
      kpiContainer.innerHTML = "";
      kpiContainer.appendChild(ui.kpiRow([
        { label: "Product lines", value: products.length, tip: "Every product with a configured clause set." },
        { label: "Total clauses", value: totalClauses, tip: "Across all product lines." },
        { label: "Edited from default", value: countEdited(), tone: countEdited() > 0 ? "amber" : "gray", tip: "Clauses changed from their template text this session." },
      ]));
    }

    function buildClauseRow(product, clause) {
      var row = ui.h("div", { class: "term-row" });
      var head = ui.h("div", { class: "term-row-head" });
      head.appendChild(ui.h("span", { class: "term-row-title" }, clause.title));
      if (clause.edited) head.appendChild(ui.pill("amber", "Edited"));
      row.appendChild(head);

      var textArea = ui.h("textarea", { class: "field-input term-textarea" });
      textArea.value = clause.text;
      row.appendChild(textArea);

      var actions = ui.h("div", { class: "term-row-actions" });
      var saveBtn = ui.h("button", { class: "btn small" }, "Save");
      saveBtn.addEventListener("click", function () {
        PAS.updateTermClause(product, clause.id, textArea.value);
        buildKpis();
        buildGroup(product);
      });
      actions.appendChild(saveBtn);
      if (clause.edited) {
        var resetBtn = ui.h("button", { class: "btn small" }, "Reset to default");
        resetBtn.addEventListener("click", function () {
          PAS.resetTermClause(product, clause.id);
          buildKpis();
          buildGroup(product);
        });
        actions.appendChild(resetBtn);
      }
      row.appendChild(actions);
      return row;
    }

    var groupBodies = {};
    function buildGroup(product) {
      var body = groupBodies[product];
      body.innerHTML = "";
      PAS.getTerms(product).forEach(function (c) { body.appendChild(buildClauseRow(product, c)); });
    }

    products.forEach(function (product) {
      var panel = ui.panel({ title: product, what: PAS.getTerms(product).length + " clauses.", pad: 0 }, []);
      var body = panel.querySelector(".panel-body");
      body.classList.add("term-group-body");
      groupBodies[product] = body;
      groupsContainer.appendChild(panel);
      buildGroup(product);
    });

    buildKpis();

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("terms", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
