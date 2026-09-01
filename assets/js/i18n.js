/* Minimal, real i18n seam — not a fully-translated app (this prototype's copy is English-only
   today), but a genuine mechanism a second locale can be dropped into without touching call
   sites: every PAS.t("nav.dashboard", "Dashboard") call already routes through PAS.STRINGS, it
   just resolves to the same English text `en` already had, until a second locale table exists.
   Wired into the sidebar nav (see scripts/sync-nav.js) and the common decision-action labels
   used across every desk, as the real, testable slice — not decorative infrastructure nobody
   calls. Locale choice is per-session (sessionStorage), same persistence pattern as role/theme. */
(function (global) {
  "use strict";
  var PAS = global.PAS;

  var STRINGS = {
    en: {
      "nav.dashboard": "Dashboard", "nav.approvals": "Pending approvals",
      "nav.endorsement-desk": "Endorsements", "nav.cancellation-desk": "Cancellation",
      "nav.reinstatement-desk": "Reinstatement", "nav.renewal-desk": "Renewal",
      "nav.registry": "Policy register", "nav.brokers": "Brokers", "nav.mgas": "MGA",
      "nav.carriers": "Carriers", "nav.customers": "Customers", "nav.workbench": "Transaction workbench",
      "nav.domain-model": "Domain model", "nav.data-model": "Data model",
      "nav.api-reference": "API reference", "nav.architecture": "Architecture",
      "nav.integration-hub": "PAS integration hub", "nav.admin-config": "Admin Configuration",

      "action.approve": "Approve", "action.decline": "Decline", "action.escalate": "Escalate",
      "action.requestInfo": "Request more information", "action.cancel": "Cancel",
      "action.submit": "Submit request", "action.confirm": "Confirm",
    },
  };
  PAS.LOCALES = Object.keys(STRINGS);
  PAS.STRINGS = STRINGS;

  var LOCALE_KEY = "pas.locale.v1";
  PAS.getLocale = function () {
    var l;
    try { l = sessionStorage.getItem(LOCALE_KEY); } catch (e) { l = null; }
    return (l && STRINGS[l]) ? l : "en";
  };
  PAS.setLocale = function (l) {
    if (!STRINGS[l]) return;
    try { sessionStorage.setItem(LOCALE_KEY, l); } catch (e) { /* storage unavailable */ }
  };
  /** Resolve a string by key against the active locale, falling back to English, then to the
      caller's own fallback text (so a missing key never renders a raw "undefined" or the key
      itself in front of a user). */
  PAS.t = function (key, fallback) {
    var table = STRINGS[PAS.getLocale()] || STRINGS.en;
    return table[key] || STRINGS.en[key] || fallback || key;
  };
})(window);
