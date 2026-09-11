/* Import quote — pastes a rating-engine quote payload ({ quote, coverages, eligibility, adapter })
   and turns it into a real policy via PAS.importQuote. See assets/js/pas-extensions.js Section D. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  /* Quote payloads don't follow one fixed schema for "who is insured" — checks a handful of
     plausible field names/shapes (a bare string, or an object with a .name) and returns the
     first real one found. */
  function firstString(vals) {
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object" && typeof v.name === "string" && v.name.trim()) return v.name.trim();
    }
    return null;
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* Modal shell around ui.stepper — re-renders it as the create-policy flow advances through
     "Verifying details" -> "Generating policy document" -> "Issuing policy" so the user sees
     the same three stages the backend calls below actually run through, not just a spinner. */
  function showProgressModal(steps) {
    var overlay = ui.h("div", { class: "decision-modal-overlay", role: "presentation" });
    var modal = ui.h("div", { class: "decision-modal", role: "dialog", "aria-modal": "true" });
    modal.appendChild(ui.h("div", { class: "decision-modal-head" }, [
      ui.h("div", { class: "decision-modal-kicker" }, "Generating policy"),
      ui.h("h2", { class: "decision-modal-title" }, "Please wait…"),
    ]));
    var stepperHost = ui.h("div", { class: "mt-13" });
    modal.appendChild(stepperHost);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function setActive(i) {
      stepperHost.innerHTML = "";
      stepperHost.appendChild(ui.stepper({ steps: steps, activeIndex: i }));
    }
    setActive(0);
    return {
      advance: setActive,
      close: function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); },
    };
  }

  function render() {
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "arrow-down-left", tone: "blue", title: "Import quote",
      sub: "Turn a rating-engine quote payload into a policy",
      what: "Paste the JSON a rating engine produces (coverage factors, discounts, surcharges, fees, tax, eligibility, and — when present — an issuedQuoteMeta block naming the insured, broker, carrier and MGA) and PAS creates a policy from it.",
      why: "Named insured, producer, carrier and MGA are pre-filled whenever the quote names them (issuedQuoteMeta.parties, when present); anything the quote doesn't carry, or that needs correcting, you fill in or edit by hand below.",
    }));

    var panel = ui.panel({ title: "Quote payload", what: "Simulates POST /api/v1/inbound/quote" }, []);
    var pb = panel.querySelector(".panel-body");

    var textarea = ui.h("textarea", { class: "field-input mono", rows: 14, style: { fontSize: "11.5px", resize: "vertical" }, placeholder: "Paste the quote JSON here…" });
    pb.appendChild(ui.field({ label: "Quote JSON", hint: "The full { quote, coverages, eligibility, adapter } payload from the rating engine." }, textarea));

    var fileInput = ui.h("input", { class: "field-input", type: "file", accept: ".json,application/json" });
    pb.appendChild(ui.field({ label: "Or upload a JSON file", hint: "Pick a .json file from disk instead of pasting — it fills the field above." }, fileInput));

    var errorBox = ui.h("div", {});
    pb.appendChild(errorBox);
    var previewBox = ui.h("div", { style: { marginTop: "4px" } });
    pb.appendChild(previewBox);

    var holderInput = ui.h("input", { class: "field-input", type: "text", placeholder: "e.g. Whitfield Manufacturing Co." });
    var producerInput = ui.h("input", { class: "field-input", type: "text", value: "Direct" });
    var effDateInput = ui.h("input", { class: "field-input", type: "date", value: PAS.todayISO() });
    var stateInput = ui.h("input", { class: "field-input", type: "text" });
    var carrierSelect = ui.h("select", { class: "field-input" });
    PAS.CARRIERS.forEach(function (c) { carrierSelect.appendChild(ui.h("option", { value: c }, c)); });
    var mgaInput = ui.h("input", { class: "field-input", type: "text" });

    /* effDateInput, producerInput and carrierSelect always carry a value (today's date; "Direct";
       the first carrier), so — unlike the empty text inputs — "is it still empty" can't tell us
       whether the quote should be allowed to fill them. Track an explicit touch instead, same
       reasoning either way: never clobber something the user set. */
    var effDateTouched = false;
    effDateInput.addEventListener("input", function () { effDateTouched = true; });
    var producerTouched = false;
    producerInput.addEventListener("input", function () { producerTouched = true; });
    var carrierTouched = false;
    carrierSelect.addEventListener("change", function () { carrierTouched = true; });

    var formRow = ui.h("div", { class: "mt-13", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "13px" } });
    formRow.appendChild(ui.field({ label: "Named insured", hint: "Pre-filled when the quote names an insured; otherwise enter it by hand." }, holderInput));
    formRow.appendChild(ui.field({ label: "Producer", hint: "Pre-filled from the quote's broker/agency when present." }, producerInput));
    formRow.appendChild(ui.field({ label: "Effective date", hint: "Pre-filled from the quote if it specifies one; otherwise defaults to today." }, effDateInput));
    formRow.appendChild(ui.field({ label: "State", hint: "Pre-filled from the quote; edit if it needs to match your state-naming convention." }, stateInput));
    formRow.appendChild(ui.field({ label: "Carrier", hint: "Pre-selected when the quote names a carrier PAS already knows." }, carrierSelect));
    formRow.appendChild(ui.field({ label: "MGA", hint: "Pre-filled from the quote's MGA/wholesale facility when present; otherwise enter it by hand." }, mgaInput));
    pb.appendChild(formRow);

    var createBtn = ui.h("button", { class: "btn tone-primary mt-13" }, [PAS.icon("arrow-down-left", { size: 13 }), document.createTextNode(" Generate policy")]);
    pb.appendChild(createBtn);

    var parsed = null;
    function reparse() {
      errorBox.innerHTML = "";
      previewBox.innerHTML = "";
      parsed = null;
      var raw = textarea.value.trim();
      if (!raw) return;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        errorBox.appendChild(ui.callout("bad", "That isn't valid JSON: " + e.message));
        return;
      }
      var q = (parsed && parsed.quote) || null;
      if (!q) {
        errorBox.appendChild(ui.callout("bad", "No \"quote\" object found at the top level of this payload."));
        parsed = null;
        return;
      }
      if (q.state && !stateInput.value) stateInput.value = q.state;

      /* issuedQuoteMeta.parties — when present, this is the richest, most authoritative source for
         who's who on this quote (a real rating-engine export names customer/broker/carrier/mga
         explicitly, rather than this function having to guess at field names), so it's checked
         first in every candidate list below, ahead of the older loose guesses that exist for
         payload shapes that don't carry it. */
      var iqm = parsed.issuedQuoteMeta || {};
      var iqmParties = iqm.parties || {};

      var insuredInfo = parsed.insured_information || {};
      var namedInsured = firstString([
        iqmParties.customer,
        parsed.namedInsured, parsed.insuredName, parsed.insured, parsed.applicant, parsed.policyHolder, parsed.holder,
        insuredInfo.entity_name, insuredInfo.dba,
        q.namedInsured, q.insuredName, q.insured, q.applicant, q.policyHolder, q.holder,
      ]);
      if (namedInsured && !holderInput.value) holderInput.value = namedInsured;

      var quoteHeader = parsed.quote_header || {};
      var effDate = parsed.effectiveDate || parsed.policyEffectiveDate || q.effectiveDate || q.policyEffectiveDate || q.termEffectiveDate ||
        (parsed.term && parsed.term.effectiveDate) || (parsed.policy && parsed.policy.effectiveDate) || quoteHeader.effective_date || null;
      if (effDate && !effDateTouched) effDateInput.value = String(effDate).slice(0, 10);

      var broker = parsed.producing_broker || {};
      var producerName = firstString([iqmParties.broker, broker.agency_name, broker.producer_name, parsed.producer, q.producer]);
      if (producerName && !producerTouched) producerInput.value = producerName;

      var mgaName = firstString([iqmParties.mga, parsed.mga, q.mga]);
      if (mgaName && !mgaInput.value) mgaInput.value = mgaName;

      var carrierName = firstString([iqmParties.carrier, parsed.carrier, q.carrier]);
      if (carrierName && !carrierTouched) {
        var matchOpt = Array.prototype.slice.call(carrierSelect.options).filter(function (o) { return o.value === carrierName; })[0];
        if (matchOpt) carrierSelect.value = carrierName;
        /* No matching <option> — leave the dropdown on its default rather than silently ignoring a
           real carrier name the quote actually gave us; the preview below still surfaces it. */
      }

      var kvWrap = ui.h("div", {});
      kvWrap.appendChild(ui.kv({ k: "Line of business", v: q.lob || "—" }));
      kvWrap.appendChild(ui.kv({ k: "State", v: q.state || "—" }));
      kvWrap.appendChild(ui.kv({ k: "Rating version", v: q.ratingVersion || "—" }));
      kvWrap.appendChild(ui.kv({ k: "Final premium", v: PAS.money(q.finalPremium) }));
      if (iqm.quoteNumber) kvWrap.appendChild(ui.kv({ k: "Quote number", v: iqm.quoteNumber, mono: true }));
      if (iqm.issuedBy) kvWrap.appendChild(ui.kv({ k: "Issued by (source quote)", v: iqm.issuedBy, why: "Will show as \"Underwritten by\" on the created policy — an imported quote has no separate underwriting step, so this is who accepted the risk." }));
      if (carrierName && !Array.prototype.slice.call(carrierSelect.options).some(function (o) { return o.value === carrierName; })) {
        previewBox.appendChild(ui.callout("warn", "Quote names carrier \"" + carrierName + "\", which PAS doesn't have as an option — pick the closest match above; the real name is still preserved on the imported quote record."));
      }
      previewBox.appendChild(kvWrap);
      var refers = parsed.eligibility && parsed.eligibility.refers;
      if (refers && refers.length) previewBox.appendChild(ui.callout("warn", "Refers on this quote: " + refers.join(", ") + "."));
      if (iqm.bindStatus || iqm.policyStatus) {
        previewBox.appendChild(ui.callout("info", "Source system status — " +
          [iqm.bindStatus, iqm.policyStatus].filter(Boolean).join(" · ") +
          ". PAS will still activate this policy immediately on import, regardless of this upstream status text."));
      }
    }
    textarea.addEventListener("input", reparse);

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        textarea.value = String(reader.result);
        reparse();
      };
      reader.onerror = function () {
        errorBox.innerHTML = "";
        errorBox.appendChild(ui.callout("bad", "Couldn't read " + file.name + " — " + (reader.error && reader.error.message ? reader.error.message : "unknown error") + "."));
      };
      reader.readAsText(file);
    });

    createBtn.addEventListener("click", function () {
      reparse();
      if (!parsed) { errorBox.innerHTML = ""; errorBox.appendChild(ui.callout("bad", "Paste a valid quote JSON before creating the policy.")); return; }
      if (!holderInput.value.trim()) { errorBox.innerHTML = ""; errorBox.appendChild(ui.callout("bad", "Named insured is required.")); return; }
      var q = parsed.quote || {};
      var extra = {
        holder: holderInput.value.trim(), producer: producerInput.value.trim() || "Direct",
        effectiveDate: effDateInput.value || PAS.todayISO(), state: stateInput.value.trim(), carrier: carrierSelect.value,
        mga: mgaInput.value.trim() || null,
        /* The quote payload has no separate "sum insured" field — coveragePremium (the rated
           premium for the coverage layer) is what this demo treats as the sum assured. */
        sumInsured: q.coveragePremium != null ? PAS.money(q.coveragePremium) : "—",
      };

      var steps = ["Verifying details", "Generating policy document", "Issuing policy"];
      var progress = showProgressModal(steps);
      var policy = null;

      wait(600)
        .then(function () {
          return PAS.api.call("POST", "/api/v1/inbound/quote", { quote: extra }, {
            module: "Bind", statusCode: 201, label: "Import quote — " + extra.holder,
            response: { events: ["policyIssued"] },
          });
        })
        .then(function () {
          progress.advance(1);
          return wait(700);
        })
        .then(function () {
          policy = PAS.importQuote(parsed, extra);
          PAS.generateQuoteDocuments(policy.id);
          progress.advance(2);
          return wait(600);
        })
        .then(function () {
          progress.advance(3);
          return wait(400);
        })
        .then(function () {
          progress.close();
          ui.flashThenGo("policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=documents",
            { title: "Policy created", detail: policy.id + " created from imported quote.", tone: "green" });
        });
    });

    page.appendChild(panel);
    root.appendChild(ui.screen("import-quote", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
