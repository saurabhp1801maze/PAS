/* Ported from ServicingDecision in the original App.jsx. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;
  var SLA = { "Document request": 24, Inquiry: 8, "Contact update": 24, Billing: 48, Correspondence: 72 };

  function render() {
    var sp = new URLSearchParams(location.search);
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var p = PAS.getPolicy(sp.get("policy"));
    if (!p) { root.appendChild(ui.h("div", { class: "faint-note" }, "Policy not found.")); return; }

    var category = "Document request";
    var channel = "Phone";

    var page = ui.h("div", {});
    page.appendChild(ui.backLink("Servicing desk", function () { location.href = "servicing.html"; }));
    page.appendChild(ui.recordHead(p));
    var layoutContainer = ui.h("div", {});
    page.appendChild(layoutContainer);

    function buildContent() {
      var escalate = category === "Contact update";

      var left = [];
      left.push(ui.tipLabel({ text: "New request", what: "Log an operational request against this policy.", className: "label-11 block mb-10" }));

      var catSel = ui.h("select", { class: "field-input" });
      Object.keys(SLA).forEach(function (k) { catSel.appendChild(ui.h("option", { value: k }, k)); });
      catSel.value = category;
      catSel.addEventListener("change", function () { category = catSel.value; buildContent(); });
      left.push(ui.field({ label: "Category", hint: "Drives the SLA and whether this can stay a note." }, catSel));

      var chanSel = ui.h("select", { class: "field-input" });
      ["Phone", "Email", "Portal", "Branch"].forEach(function (c) { chanSel.appendChild(ui.h("option", { value: c }, c)); });
      chanSel.value = channel;
      chanSel.addEventListener("change", function () { channel = chanSel.value; });
      left.push(ui.field({ label: "Channel" }, chanSel));

      var notesArea = ui.h("textarea", { class: "field-input", placeholder: "What did the customer ask for?" });
      left.push(ui.field({ label: "Notes" }, notesArea));

      if (escalate) {
        var esc = ui.h("div", {});
        esc.appendChild(document.createTextNode("A contact update can change a rating factor. Log it here for the trail, but raise an "));
        esc.appendChild(ui.h("b", {}, "endorsement"));
        esc.appendChild(document.createTextNode(" to actually change the policy."));
        left.push(ui.callout("warn", esc));
      }

      var right = [];
      right.push(ui.tipLabel({ text: "Handling", what: "Commitments attached to this request.", className: "label-11 block mb-10" }));
      right.push(ui.kv({ k: "SLA target", v: SLA[category] + " hours", what: "Turnaround commitment for this category.", why: "Each category has its own — they are not uniform." }));
      right.push(ui.kv({ k: "Rating relevant", v: escalate ? "Yes — escalate" : "No", what: "Whether this touches a rating factor.", rule: "Rating-relevant requests must become endorsements, not notes." }));
      right.push(ui.kv({ k: "Channel", v: channel, what: "How the customer got in touch.", why: "All channels write to one ledger." }));

      var existingWrap = ui.h("div", { class: "mt-15" });
      existingWrap.appendChild(ui.tipLabel({ text: "Existing requests", what: "Servicing already logged against this policy.", className: "label-11 block mb-9" }));
      var svcHist = p.history.filter(function (h) { return h.type === "Servicing"; });
      if (svcHist.length === 0) existingWrap.appendChild(ui.h("div", { class: "faint-note" }, "None yet."));
      svcHist.forEach(function (h) {
        var row = ui.h("div", { class: "service-existing-row" });
        var head = ui.h("div", { class: "service-existing-head" });
        head.appendChild(ui.h("span", { class: "service-existing-cat" }, h.meta.category));
        head.appendChild(ui.h("span", { class: "service-existing-date" }, h.date));
        row.appendChild(head);
        row.appendChild(ui.h("div", { class: "service-existing-detail" }, h.detail));
        existingWrap.appendChild(row);
      });
      right.push(existingWrap);

      function doLog() {
        var notes = notesArea.value;
        return PAS.api.call("POST", "/api/v1/policies/" + p.id + "/service-requests", { category: category, channel: channel, notes: notes },
          { module: "Servicing", policyId: p.id, statusCode: 201, label: "Service request — " + p.holder, response: { serviceRequestId: PAS.uid("SRV"), status: "logged", slaTargetHours: SLA[category] } })
          .then(function () { PAS.logService(p.id, { category: category, channel: channel, notes: notes, sla: SLA[category] }); location.href = "servicing.html"; });
      }
      function actionsFor() {
        return [{ label: "Log request", tone: "primary", icon: "headphones", onRun: doLog, disabled: !notesArea.value.trim(), disabledReason: "A servicing entry needs a note — it becomes part of the permanent record." }];
      }

      layoutContainer.innerHTML = "";
      var layoutEl = ui.decisionLayout(left, right, actionsFor());
      notesArea.addEventListener("input", function () { layoutEl.actionBar.updateActions(actionsFor()); });
      layoutContainer.appendChild(layoutEl);
    }
    buildContent();

    root.appendChild(ui.screen("servicing-desk", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
