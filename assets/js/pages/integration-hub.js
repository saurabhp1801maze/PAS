/* PAS integration hub — inbound from UW, outbound query API, ETag, idempotency */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function render() {
    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "braces", tone: "blue", title: "PAS Integration Hub",
      sub: "How other ERP modules connect to the Policy Administration module",
      what: "Inbound bind intake, policy query with ETag, idempotent writes.",
      why: "PAS is the policy of record — every other module reads from and writes through these contracts.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Tenant", value: PAS.TENANT.slice(0, 8) + "…", mono: true },
      { label: "Event types", value: Object.keys(PAS.CONSUMERS).length, tone: "violet" },
      { label: "Audit entries", value: PAS.getGlobalAuditLog().length, tone: "amber" },
      { label: "Policies", value: PAS.getPolicies().length },
    ]));

    var inbound = ui.panel({ title: "Inbound — receive bound policy (from UW module)", what: "Simulates POST /api/v1/inbound/bind" }, []);
    var ib = inbound.querySelector(".panel-body");
    var sample = { holder: "Demo Industries LLC", product: "Commercial Property", premium: 145000, state: "Texas", sumInsured: "$4,200,000" };
    ib.appendChild(ui.kv({ k: "Payload", v: JSON.stringify(sample), mono: true }));
    var recvBtn = ui.h("button", { class: "btn tone-primary" }, "Receive bound policy");
    recvBtn.addEventListener("click", function () {
      PAS.api.call("POST", "/api/v1/inbound/bind", sample, { module: "Bind", statusCode: 201, label: "Inbound bind — " + sample.holder, response: { status: "bound" } })
        .then(function () {
          var pol = PAS.receiveBoundPolicy(sample);
          alert("Bound policy received: " + pol.id + ". Check Issue desk.");
          render();
        });
    });
    ib.appendChild(recvBtn);
    page.appendChild(inbound);

    var query = ui.panel({ title: "Outbound — policy query API", what: "GET /api/v1/policies/{id} with ETag" }, []);
    var qb = query.querySelector(".panel-body");
    var polSel = ui.h("select", { class: "field-input" });
    PAS.getPolicies().slice(0, 10).forEach(function (p) { polSel.appendChild(ui.h("option", { value: p.id }, p.id)); });
    qb.appendChild(ui.field({ label: "Policy ID" }, polSel));
    var resultEl = ui.h("pre", { class: "mono", style: { fontSize: "11px", background: "var(--color-panel-alt)", padding: "12px", borderRadius: "8px", marginTop: "10px" } }, "Click Query…");
    qb.appendChild(resultEl);
    var qBtn = ui.h("button", { class: "btn" }, "Query policy");
    qBtn.addEventListener("click", function () {
      var res = PAS.queryPolicyApi(polSel.value);
      resultEl.textContent = JSON.stringify(res, null, 2);
    });
    qb.appendChild(qBtn);
    page.appendChild(query);

    var audit = ui.panel({ title: "PAS audit log (immutable)", pad: 0 }, []);
    audit.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["When", "User", "Action", "Policy", "Detail"],
      rows: PAS.getGlobalAuditLog().slice(0, 15).map(function (a) {
        return [(a.at || "").slice(0, 19), a.user, a.action, a.policyId || "—", a.detail || ""];
      }),
      emptyText: "No audit entries yet.",
    }));
    page.appendChild(audit);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("integration-hub", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
