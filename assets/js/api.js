/* Simulated API + domain-event layer. Ported from the React app's useApiLog() hook.
   One call() produces a whole lifecycle: request out -> response in -> domain event ->
   consumers, exactly like the original — but since each page load is a fresh JS context here,
   the log/events/flows/notes are persisted to sessionStorage so the notification bell and the
   "API & event lifecycle" panel keep their history across a real page navigation. */
(function (global) {
  "use strict";
  var PAS = global.PAS = global.PAS || {};
  var STORAGE_KEY = "pas.api.v1";

  function loadState() {
    var raw;
    try { raw = sessionStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through */ } }
    return { log: [], events: [], flows: [], notes: [] };
  }
  function saveState(s) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  var api = {};
  /* Optional hook a page can set to render a live toast / bump the bell badge the moment a
     notification is raised, for actions that don't immediately navigate away. */
  api.onNotify = null;

  api.getLog = function () { return loadState().log; };
  api.getEvents = function () { return loadState().events; };
  api.getFlows = function () { return loadState().flows; };
  api.getNotes = function () { return loadState().notes; };

  api.notify = function (n) {
    var s = loadState();
    var note = Object.assign({ id: PAS.uid("N"), at: Date.now() }, n);
    s.notes = [note].concat(s.notes).slice(0, 60);
    saveState(s);
    if (typeof api.onNotify === "function") api.onNotify(note);
    return note;
  };

  api.clearNotes = function () {
    var s = loadState();
    s.notes = [];
    saveState(s);
  };

  /** method, endpoint, requestBody, meta:{module,policyId,label,statusCode,response,ledger} */
  api.call = function (method, endpoint, requestBody, meta) {
    meta = meta || {};
    return new Promise(function (resolve) {
      var start = Date.now();
      var flowId = PAS.uid("FLOW");
      var short = endpoint.split("?")[0];
      api.notify({ dir: "out", kind: "request", title: method + " " + short.split("/").slice(-2).join("/"), detail: meta.label || "Request sent to Policy API", tone: "blue" });

      setTimeout(function () {
        var responseBody = meta.response || { ok: true, requestId: PAS.uid("REQ") };
        var statusCode = meta.statusCode || (method === "GET" ? 200 : method === "POST" ? 201 : 200);
        var latency = Date.now() - start;
        var entry = { id: PAS.uid("LOG"), flowId: flowId, time: new Date().toISOString(), method: method, endpoint: endpoint, requestBody: requestBody, responseBody: responseBody, statusCode: statusCode, latency: latency, module: meta.module, policyId: meta.policyId, label: meta.label };

        var s = loadState();
        s.log = [entry].concat(s.log).slice(0, 200);
        saveState(s);

        api.notify({ dir: "in", kind: "response", title: statusCode + " · " + latency + "ms", detail: short, tone: statusCode >= 400 ? "red" : statusCode === 202 ? "violet" : "green" });

        var et = method !== "GET" && PAS.eventTypeFor(endpoint);
        var ev = null;
        if (et) {
          var consumers = PAS.CONSUMERS[et] || ["Billing"];
          ev = { eventId: PAS.uid("EVT").toLowerCase(), flowId: flowId, eventType: et, eventVersion: 1, occurredAt: new Date().toISOString(), tenantId: PAS.TENANT, aggregateType: "policy", aggregateId: meta.policyId || "—", producer: "southlake-policy", consumers: consumers, data: responseBody };
          var s2 = loadState();
          s2.events = [ev].concat(s2.events).slice(0, 200);
          saveState(s2);
          setTimeout(function () { api.notify({ dir: "out", kind: "event", title: et, detail: "Published to " + consumers.join(", "), tone: "violet" }); }, 260);
        }

        var s3 = loadState();
        s3.flows = [{ id: flowId, at: new Date().toISOString(), action: meta.label || (method + " " + short), policyId: meta.policyId, call: entry, event: ev, ledger: meta.ledger }].concat(s3.flows).slice(0, 40);
        saveState(s3);

        resolve(responseBody);
      }, 260 + Math.random() * 240);
    });
  };

  PAS.api = api;
})(window);
