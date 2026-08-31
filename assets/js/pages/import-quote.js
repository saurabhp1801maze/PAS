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

  function render() {
    var root = document.getElementById("page-content");
    root.innerHTML = "";
    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "arrow-down-left", tone: "blue", title: "Import quote",
      sub: "Turn a rating-engine quote payload into a policy",
      what: "Paste the JSON a rating engine produces (coverage factors, discounts, surcharges, fees, tax, eligibility) and PAS creates a policy from it.",
      why: "The quote itself never carries who the insured is or who placed it — those two fields are the only things you supply by hand.",
    }));

    var panel = ui.panel({ title: "Quote payload", what: "Simulates POST /api/v1/inbound/quote" }, []);
    var pb = panel.querySelector(".panel-body");

    var textarea = ui.h("textarea", { class: "field-input mono", rows: 14, style: { fontSize: "11.5px", resize: "vertical" }, placeholder: "Paste the quote JSON here…" });
    pb.appendChild(ui.field({ label: "Quote JSON", hint: "The full { quote, coverages, eligibility, adapter } payload from the rating engine." }, textarea));

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

    /* effDateInput and producerInput always carry a value (today's date; "Direct"), so — unlike the
       empty text inputs — "is it still empty" can't tell us whether the quote should be allowed to
       fill them. Track an explicit touch instead, same reasoning either way: never clobber
       something the user set. */
    var effDateTouched = false;
    effDateInput.addEventListener("input", function () { effDateTouched = true; });
    var producerTouched = false;
    producerInput.addEventListener("input", function () { producerTouched = true; });

    var formRow = ui.h("div", { class: "mt-13", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "13px" } });
    formRow.appendChild(ui.field({ label: "Named insured", hint: "Pre-filled when the quote names an insured; otherwise enter it by hand." }, holderInput));
    formRow.appendChild(ui.field({ label: "Producer", hint: "Pre-filled from the quote's broker/agency when present." }, producerInput));
    formRow.appendChild(ui.field({ label: "Effective date", hint: "Pre-filled from the quote if it specifies one; otherwise defaults to today." }, effDateInput));
    formRow.appendChild(ui.field({ label: "State", hint: "Pre-filled from the quote; edit if it needs to match your state-naming convention." }, stateInput));
    formRow.appendChild(ui.field({ label: "Carrier" }, carrierSelect));
    pb.appendChild(formRow);

    var createBtn = ui.h("button", { class: "btn tone-primary mt-13" }, [PAS.icon("arrow-down-left", { size: 13 }), document.createTextNode(" Create policy")]);
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

      var insuredInfo = parsed.insured_information || {};
      var namedInsured = firstString([
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
      var producerName = firstString([broker.agency_name, broker.producer_name, parsed.producer, q.producer]);
      if (producerName && !producerTouched) producerInput.value = producerName;

      var kvWrap = ui.h("div", {});
      kvWrap.appendChild(ui.kv({ k: "Line of business", v: q.lob || "—" }));
      kvWrap.appendChild(ui.kv({ k: "State", v: q.state || "—" }));
      kvWrap.appendChild(ui.kv({ k: "Rating version", v: q.ratingVersion || "—" }));
      kvWrap.appendChild(ui.kv({ k: "Final premium", v: PAS.money(q.finalPremium) }));
      previewBox.appendChild(kvWrap);
      var refers = parsed.eligibility && parsed.eligibility.refers;
      if (refers && refers.length) previewBox.appendChild(ui.callout("warn", "Refers on this quote: " + refers.join(", ") + "."));
    }
    textarea.addEventListener("input", reparse);

    createBtn.addEventListener("click", function () {
      reparse();
      if (!parsed) { errorBox.innerHTML = ""; errorBox.appendChild(ui.callout("bad", "Paste a valid quote JSON before creating the policy.")); return; }
      if (!holderInput.value.trim()) { errorBox.innerHTML = ""; errorBox.appendChild(ui.callout("bad", "Named insured is required.")); return; }
      var extra = {
        holder: holderInput.value.trim(), producer: producerInput.value.trim() || "Direct",
        effectiveDate: effDateInput.value || PAS.todayISO(), state: stateInput.value.trim(), carrier: carrierSelect.value,
      };
      PAS.api.call("POST", "/api/v1/inbound/quote", { quote: extra }, {
        module: "Bind", statusCode: 201, label: "Import quote — " + extra.holder,
        response: { events: ["policyIssued"] },
      }).then(function () {
        var policy = PAS.importQuote(parsed, extra);
        ui.flashThenGo("policy-detail.html?policy=" + encodeURIComponent(policy.id) + "&tab=cover",
          { title: "Policy created", detail: policy.id + " created from imported quote.", tone: "green" });
      });
    });

    page.appendChild(panel);
    root.appendChild(ui.screen("import-quote", page));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
