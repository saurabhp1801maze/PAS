/* Reference / API reference. Generated from PAS.API_CATALOGUE, PAS.EVENT_FOR and PAS.CONSUMERS
   rather than transcribed, so an endpoint cannot be added to the app without appearing here — and
   the event fan-out documented on this page is literally the map the api layer dispatches on. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  function eventFor(method, path) {
    if (method === "GET") return null;
    return PAS.eventTypeFor(path);
  }

  function render() {
    var catalogue = PAS.API_CATALOGUE || [];
    var all = catalogue.reduce(function (acc, g) { return acc.concat(g.endpoints); }, []);
    var writes = all.filter(function (e) { return e[0] !== "GET"; });
    var publishing = writes.filter(function (e) { return eventFor(e[0], e[1]); });

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "braces", tone: "violet", title: "API reference",
      sub: "Every endpoint the desks call, and the domain event each write publishes",
      what: "The contract between these screens and the Policy API.",
      why: "Generated from the same constants the app dispatches on, so it cannot drift out of date.",
    }));

    page.appendChild(ui.kpiRow([
      { label: "Endpoints", value: all.length, tip: "Across every resource group." },
      { label: "Reads", value: all.length - writes.length, tone: "blue", tip: "GET only. A read never publishes an event." },
      { label: "Writes", value: writes.length, tone: "amber", tip: "POST. Each one commits a ledger row and an outbox row together." },
      { label: "Publishing", value: publishing.length, tone: "violet", tip: "Writes that resolve to a domain event." },
      { label: "Event types", value: Object.keys(PAS.CONSUMERS).length, tone: "violet", tip: "Distinct events on the bus." },
    ]));

    /* --- conventions that apply to every call --- */
    var convPanel = ui.panel({
      title: "Conventions",
      what: "Rules that hold for every endpoint below.",
      why: "These are the parts that are easy to get wrong on the client side.",
    }, []);
    var convBody = convPanel.querySelector(".panel-body");
    [
      ["Base path", "/api/v1", "Version is in the path. A breaking change ships as /api/v2, never as a change here."],
      ["Auth", "Authorization: Bearer <token>", "Every call, including reads."],
      ["Tenant", "X-Tenant-Id: " + PAS.TENANT, "Every query is scoped to it server-side. A missing header is a 400, never a cross-tenant read."],
      ["Concurrency", "If-Match: <etag>", "GET on an aggregate returns an ETag; a write without a matching If-Match gets 412 Precondition Failed."],
      ["Idempotency", "Idempotency-Key: <uuid>", "On writes. A retry with the same key returns the original response rather than repeating the effect."],
      ["Paging", "?limit=50&cursor=<opaque>", "Cursor-based, not offset — the register changes underneath a paging client."],
    ].forEach(function (c) {
      convBody.appendChild(ui.kv({ k: c[0], v: ui.h("span", { class: "mono" }, c[1]), what: c[2] }));
    });
    page.appendChild(convPanel);

    /* --- status codes --- */
    var codePanel = ui.panel({
      title: "Status codes",
      what: "What each response means for the transaction you just attempted.",
      pad: 0,
    }, []);
    codePanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: ["Code", "Meaning", "When"],
      rows: [
        [ui.statusCodeBadge(200), "OK", "A read succeeded, or a decision was recorded against an existing transaction."],
        [ui.statusCodeBadge(201), "Created", "A new transaction row was appended."],
        [ui.statusCodeBadge(202), "Accepted", "Held for approval. The policy is unchanged — this is the response every material endorsement gets."],
        [ui.statusCodeBadge(409), "Conflict", "The transition is not legal from the policy's current state, e.g. issuing a policy that is already Active."],
        [ui.statusCodeBadge(412), "Precondition Failed", "The ETag did not match. Someone else wrote to this aggregate since you read it."],
        [ui.statusCodeBadge(422), "Unprocessable", "A domain invariant refused the write, e.g. reinstating a fraud-flagged cancellation."],
      ],
      wrapCells: true,
    }));
    page.appendChild(codePanel);

    /* --- the catalogue --- */
    catalogue.forEach(function (group) {
      var p = ui.panel({
        title: group.resource,
        what: "Endpoints under " + group.base + ".",
        pad: 0,
      }, []);
      p.querySelector(".panel-body").appendChild(ui.dataTable({
        columns: ["", "Path",
          { label: "Purpose", what: "What the call does." },
          { label: "Publishes", what: "The domain event this write puts on the outbox.", rule: "Reads never publish. Only state changes reach the bus." },
          { label: "Notes", what: "Behaviour worth knowing before calling it." }],
        rows: group.endpoints.map(function (e) {
          var et = eventFor(e[0], e[1]);
          var evCell;
          if (et) {
            evCell = ui.h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } });
            evCell.appendChild(ui.pill("violet", et));
            evCell.appendChild(ui.h("span", { class: "faint-note" }, "→ " + (PAS.CONSUMERS[et] || []).join(", ")));
          } else {
            evCell = ui.h("span", { class: "faint-note" }, e[0] === "GET" ? "—" : "no event");
          }
          return [ui.methodBadge(e[0]), ui.h("span", { class: "endpoint-path" }, e[1]), e[2], evCell, e[3] || ""];
        }),
        wrapCells: true,
      }));
      page.appendChild(p);
    });

    /* --- fan-out, straight off the live constant --- */
    var fanPanel = ui.panel({
      title: "Event to consumer map",
      what: "Which downstream systems each event reaches.",
      why: "The outbox guarantees at-least-once delivery, so every consumer here must be idempotent — typically by keying on eventId and ignoring one it has already processed.",
      pad: 0,
    }, []);
    var consumerNames = {};
    Object.keys(PAS.CONSUMERS).forEach(function (k) {
      PAS.CONSUMERS[k].forEach(function (c) { consumerNames[c] = (consumerNames[c] || 0) + 1; });
    });
    fanPanel.querySelector(".panel-body").appendChild(ui.dataTable({
      columns: [{ label: "Event", what: "The envelope type published from the outbox." },
        { label: "Consumers", what: "Subscriptions on the Service Bus topic." }],
      rows: Object.keys(PAS.CONSUMERS).map(function (k) {
        var pills = ui.h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap" } });
        PAS.CONSUMERS[k].forEach(function (c) { pills.appendChild(ui.pill("blue", c)); });
        return [ui.h("span", { class: "mono" }, k), pills];
      }),
      wrapCells: true,
    }));
    /* Stated in the body, not only in the column tooltip: it is the single most consequential
       thing an integrator needs to know before writing a consumer. */
    var fanNote = ui.h("div", { class: "mt-13" });
    fanNote.appendChild(ui.callout("warn",
      "Delivery is at-least-once, not exactly-once. The relay can publish and then crash before marking the outbox row dispatched, so it will publish again on restart. Every consumer above must be idempotent — key on eventId and ignore one already processed. Ordering is only meaningful per aggregate, never across policies."));
    fanNote.appendChild(ui.h("div", { class: "faint-note mt-13" },
      "Busiest consumers: " + Object.keys(consumerNames).sort(function (a, b) { return consumerNames[b] - consumerNames[a]; })
        .map(function (c) { return c + " (" + consumerNames[c] + ")"; }).join(", ") + "."));
    fanPanel.querySelector(".panel-body").appendChild(fanNote);
    page.appendChild(fanPanel);

    /* --- envelope --- */
    var envPanel = ui.panel({
      title: "Event envelope",
      what: "The shape every published event takes.",
      why: "eventVersion is what lets a consumer keep working when the payload grows.",
    }, []);
    envPanel.querySelector(".panel-body").appendChild(ui.codeBlock({
      eventId: "evt-a91f3",
      eventType: "policyCancelled",
      eventVersion: 1,
      occurredAt: "2026-08-20T09:30:00.000Z",
      tenantId: PAS.TENANT,
      aggregateType: "policy",
      aggregateId: "POL-2026-02233",
      producer: "veridex-policy",
      consumers: PAS.CONSUMERS.policyCancelled,
      data: { txnId: "TXN-4K2P9", status: "completed", premiumMethod: "Short-Rate", refundAmount: 6385 },
    }));
    page.appendChild(envPanel);

    var root = document.getElementById("page-content");
    root.innerHTML = "";
    root.appendChild(ui.screen("api-reference", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
