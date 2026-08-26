/* PAS module extensions — industry-standard policy administration capabilities (sections A–K).
   Loaded after store.js; extends the PAS namespace without modifying the core seed/mutation port. */
(function (global) {
  "use strict";
  var PAS = global.PAS;
  if (!PAS) return;

  var uid = PAS.uid;
  var todayISO = PAS.todayISO;
  var addDays = PAS.addDays;
  var addYears = PAS.addYears;
  var daysBetween = PAS.daysBetween;
  var money = PAS.money;

  /* =============================================================================
     SECTION A — Advanced PAS transaction types
     ============================================================================= */
  PAS.ADVANCED_TXN_TYPES = {
    Rewrite: {
      label: "Rewrite", icon: "refresh-cw", tone: "blue",
      desc: "Replace the policy with a new contract while preserving continuity (new ID, linked ledger).",
      statuses: ["Active", "Cancelled", "Expired"],
    },
    Reissue: {
      label: "Reissue", icon: "stamp", tone: "indigo",
      desc: "Regenerate policy documents without changing coverage terms.",
      statuses: ["Active"],
    },
    Rescind: {
      label: "Rescind", icon: "corner-up-left", tone: "violet",
      desc: "Undo a recent transaction within the admin rescind window.",
      statuses: ["Active", "Cancelled", "Bound"],
    },
    Audit: {
      label: "Premium audit", icon: "clipboard-check", tone: "amber",
      desc: "Record a mid-term premium adjustment on the policy (amount supplied by Rating module).",
      statuses: ["Active"],
    },
    Lapse: {
      label: "Lapse", icon: "ban", tone: "red",
      desc: "Admin status change when a policy expires unpaid or binder expires.",
      statuses: ["Bound", "Active"],
    },
    Split: {
      label: "Policy split", icon: "git-branch", tone: "green",
      desc: "Divide one policy into two separate policies (corporate restructuring).",
      statuses: ["Active"],
    },
    Merge: {
      label: "Policy merge", icon: "layers", tone: "green",
      desc: "Combine two policies into one while preserving ledger history.",
      statuses: ["Active"],
    },
  };

  Object.keys(PAS.ADVANCED_TXN_TYPES).forEach(function (k) {
    PAS.MODULE_TONE[k] = PAS.ADVANCED_TXN_TYPES[k].tone;
    PAS.MODULE_ICON[k] = PAS.ADVANCED_TXN_TYPES[k].icon;
    PAS.TYPE_TO_DESK[k] = "advanced-desk";
  });
  PAS.DETAIL_URL_OF["advanced-desk"] = "advanced-admin-decision.html";
  PAS.DESK_URL_OF["advanced-desk"] = "advanced-admin.html";

  PAS.EVENT_FOR["/rewrites"] = "policyRewritten";
  PAS.EVENT_FOR["/reissues"] = "policyReissued";
  PAS.EVENT_FOR["/rescinds"] = "transactionRescinded";
  PAS.EVENT_FOR["/audits"] = "premiumAudited";
  PAS.EVENT_FOR["/lapses"] = "policyLapsed";
  PAS.EVENT_FOR["/splits"] = "policySplit";
  PAS.EVENT_FOR["/merges"] = "policyMerged";
  PAS.CONSUMERS.policyRewritten = ["Billing", "Documents", "Reinsurance"];
  PAS.CONSUMERS.policyReissued = ["Documents"];
  PAS.CONSUMERS.transactionRescinded = ["Billing"];
  PAS.CONSUMERS.premiumAudited = ["Billing"];
  PAS.CONSUMERS.policyLapsed = ["Billing", "CRM"];
  PAS.CONSUMERS.policySplit = ["Billing", "Documents"];
  PAS.CONSUMERS.policyMerged = ["Billing", "Documents"];

  var RESCIND_WINDOW_DAYS = 7;
  PAS.RESCIND_WINDOW_DAYS = RESCIND_WINDOW_DAYS;

  function endorsementOrderingWarning(policy, effectiveDate) {
    var pending = policy.history.filter(function (h) {
      return h.status === "Pending" && (h.type === "Endorsement" || PAS.ADVANCED_TXN_TYPES[h.type]);
    });
    var later = policy.history.filter(function (h) {
      return h.status === "Completed" && h.date > effectiveDate;
    });
    return {
      outOfSequence: later.length > 0,
      futureDated: effectiveDate > todayISO(),
      pendingCount: pending.length,
      warning: later.length > 0 ? ("A completed transaction exists after " + effectiveDate + " — out-of-sequence processing required.") : null,
    };
  }
  PAS.endorsementOrderingWarning = endorsementOrderingWarning;

  PAS.raiseAdvancedTxn = function (policyId, type, meta) {
    var spec = PAS.ADVANCED_TXN_TYPES[type];
    if (!spec) return null;
    var policies = PAS.getPolicies();
    var p = policies.find(function (x) { return x.id === policyId; });
    if (!p || spec.statuses.indexOf(p.status) === -1) return null;
    return PAS._patchPolicy(policyId, function (pol) {
      var effDate = meta.effectiveDate || todayISO();
      var titles = {
        Rewrite: "Rewrite requested — awaiting decision",
        Reissue: "Reissue requested — awaiting decision",
        Rescind: "Rescind requested — awaiting decision",
        Audit: "Premium audit requested — awaiting decision",
        Lapse: "Lapse requested — awaiting decision",
        Split: "Policy split requested — awaiting decision",
        Merge: "Policy merge requested — awaiting decision",
      };
      return PAS._pushTxn(pol, {
        date: effDate, type: type, status: "Pending",
        title: titles[type] || (type + " requested"),
        detail: (meta.requestNote || "") + (meta.targetTxnId ? (" Targets txn #" + meta.targetTxnSeq + ".") : ""),
        meta: Object.assign({ initiatedBy: meta.initiatedBy || "Underwriter", channel: meta.channel || "Internal review", submittedOn: todayISO() }, meta),
      });
    });
  };

  PAS.decideAdvancedTxn = function (policyId, txnId, approve) {
    return PAS._patchPolicy(policyId, function (p) {
      var txn = p.history.find(function (h) { return h.id === txnId; });
      if (!txn || txn.status !== "Pending") return p;
      var type = txn.type;
      var meta = txn.meta || {};
      var history = p.history.map(function (h) {
        if (h.id !== txnId) return h;
        return Object.assign({}, h, {
          status: approve ? "Completed" : "Rejected",
          approvedBy: PAS.getPasAdminIdentity(),
          title: approve ? (type + " approved") : (type + " declined"),
          detail: approve ? (h.detail + " Approved and applied to the policy record.") : (h.detail + " Declined — policy unchanged."),
        });
      });
      if (!approve) return Object.assign({}, p, { history: history });

      var next = Object.assign({}, p, { history: history });
      if (type === "Rewrite") {
        var newId = uid("POL");
        var rewritten = Object.assign({}, next, {
          id: newId, status: "Active",
          history: next.history.concat([{
            id: uid("TXN"), seq: next.history.length + 1, date: todayISO(), recordedAt: new Date().toISOString(),
            status: "Completed", user: PAS.getPasAdminIdentity(), type: "Rewrite",
            title: "Rewrite completed — new policy " + newId,
            detail: "Replaced " + policyId + ". Continuity link preserved in meta.",
            meta: { previousPolicyId: policyId, newPolicyId: newId },
          }]),
          relatedPolicies: (next.relatedPolicies || []).concat([policyId]),
        });
        PAS._addPolicyToBook(rewritten);
        return Object.assign({}, next, { status: "Expired", relatedPolicies: (next.relatedPolicies || []).concat([newId]) });
      }
      if (type === "Reissue") {
        var ver = ((next.documents || []).filter(function (d) { return d.name === "Policy schedule"; }).length) + 1;
        return Object.assign({}, next, {
          documents: (next.documents || []).concat([
            PAS._docRecord("Policy schedule", "Schedule", ver, txnId),
            PAS._docRecord("Certificate of insurance", "Certificate", ver, txnId),
          ]),
        });
      }
      if (type === "Rescind" && meta.targetTxnId) {
        return PAS._rescindTxnOnPolicy(next, meta.targetTxnId, txnId);
      }
      if (type === "Audit") {
        var delta = Number(meta.premiumDelta) || 0;
        return Object.assign({}, next, { premium: next.premium + delta });
      }
      if (type === "Lapse") {
        return Object.assign({}, next, { status: meta.lapseType === "binder" ? "Expired" : "Expired" });
      }
      if (type === "Split" && meta.newHolder) {
        var splitId = uid("POL");
        var splitPol = Object.assign({}, next, {
          id: splitId, holder: meta.newHolder, premium: Math.round(next.premium * (meta.splitPct || 0.5)),
          history: [{ id: uid("TXN"), seq: 1, date: todayISO(), recordedAt: new Date().toISOString(), status: "Completed", user: PAS.getPasAdminIdentity(), type: "Split", title: "Split from " + policyId, detail: "Created from parent policy split.", meta: { parentPolicyId: policyId } }],
          relatedPolicies: [policyId],
        });
        PAS._addPolicyToBook(splitPol);
        return Object.assign({}, next, {
          premium: next.premium - splitPol.premium,
          relatedPolicies: (next.relatedPolicies || []).concat([splitId]),
        });
      }
      if (type === "Merge" && meta.mergePolicyId) {
        var other = PAS.getPolicy(meta.mergePolicyId);
        if (other) {
          return Object.assign({}, next, {
            premium: next.premium + other.premium,
            history: next.history.concat(other.history.map(function (h, i) {
              return Object.assign({}, h, { seq: next.history.length + i + 1, title: "[Merged " + other.id + "] " + h.title, meta: Object.assign({}, h.meta, { mergedFrom: other.id }) });
            })),
            relatedPolicies: (next.relatedPolicies || []).concat([other.id]),
          });
        }
      }
      return next;
    });
  };

  PAS.raiseEndorsement = function (policyId, meta) {
    var effDate = meta.effectiveDate || todayISO();
    var ordering = endorsementOrderingWarning(PAS.getPolicy(policyId), effDate);
    var material = meta.materiality === "Material";
    var status = material || ordering.outOfSequence ? "Pending" : "Completed";
    return PAS._patchPolicy(policyId, function (p) {
      var before = { premium: p.premium, sumInsured: p.sumInsured, coverage: PAS.coverageBreakdown(p) };
      var entry = {
        date: effDate, type: "Endorsement", status: status,
        title: status === "Pending" ? "Endorsement requested — awaiting decision" : "Endorsement applied — immaterial",
        detail: meta.requestNote + (ordering.futureDated ? " Future-dated." : "") + (ordering.outOfSequence ? " OUT-OF-SEQUENCE." : ""),
        meta: Object.assign({}, meta, {
          submittedOn: todayISO(), effectiveDate: effDate,
          futureDated: ordering.futureDated, outOfSequence: ordering.outOfSequence,
          coverageBefore: before, materiality: meta.materiality || "Minor",
        }),
      };
      var updated = PAS._pushTxn(p, entry);
      if (status === "Completed") {
        var delta = Number(meta.premiumImpact) || 0;
        updated.premium = updated.premium + delta;
        updated.meta = Object.assign({}, entry.meta, { coverageAfter: { premium: updated.premium, sumInsured: updated.sumInsured } });
      }
      return updated;
    });
  };

  /* =============================================================================
     SECTION B — Policy record & term management
     ============================================================================= */
  PAS.ensurePolicyStructure = function (p) {
    if (!p.terms) {
      p.terms = [{ termNumber: p.termNumber || 1, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, premium: p.premium, status: p.status, createdAt: p.effectiveDate }];
    }
    if (!p.parties) {
      p.parties = {
        namedInsured: p.holder,
        additionalInsureds: [],
        certificateHolders: [],
      };
    }
    if (!p.etag) p.etag = PAS.computeEtag(p);
    if (p.autoRenew === undefined) p.autoRenew = true;
    if (!p.relatedPolicies) p.relatedPolicies = [];
    if (!p.auditLog) p.auditLog = [];
    if (p.archived === undefined) p.archived = false;
    if (!p.packageLines) p.packageLines = p.product.indexOf("Commercial") !== -1 ? [{ line: "Property", premiumShare: 0.6 }, { line: "Liability", premiumShare: 0.4 }] : null;
    return p;
  };

  PAS.policyAsOf = function (policy, asOfDate) {
    PAS.ensurePolicyStructure(policy);
    var snap = {
      id: policy.id, holder: policy.holder, status: policy.status, premium: policy.premium,
      effectiveDate: policy.effectiveDate, expirationDate: policy.expirationDate,
      termNumber: policy.termNumber, sumInsured: policy.sumInsured,
    };
    policy.history.filter(function (h) {
      return h.status === "Completed" && h.date <= asOfDate;
    }).sort(function (a, b) { return a.seq - b.seq; }).forEach(function (h) {
      if (h.type === "Issuance") snap.status = "Active";
      if (h.type === "Cancellation") snap.status = "Cancelled";
      if (h.type === "Renewal" && h.meta && h.meta.newPremium) { snap.premium = h.meta.newPremium; snap.termNumber += 1; }
      if (h.type === "Endorsement" && h.meta && h.meta.premiumImpact) snap.premium += h.meta.premiumImpact;
      if (h.type === "Transfer" && h.meta && h.meta.newHolder) snap.holder = h.meta.newHolder;
    });
    return snap;
  };

  PAS.policyDiff = function (policy, dateA, dateB) {
    var a = PAS.policyAsOf(policy, dateA);
    var b = PAS.policyAsOf(policy, dateB);
    var changes = [];
    ["holder", "status", "premium", "termNumber"].forEach(function (k) {
      if (a[k] !== b[k]) changes.push({ field: k, before: a[k], after: b[k] });
    });
    return changes;
  };

  PAS.findDuplicatePolicies = function (holder, product) {
    return PAS.getPolicies().filter(function (p) {
      return p.holder.toLowerCase() === holder.toLowerCase() && p.product === product && p.status === "Active";
    });
  };

  PAS.addParty = function (policyId, partyType, name) {
    return PAS._patchPolicy(policyId, function (p) {
      PAS.ensurePolicyStructure(p);
      if (partyType === "additionalInsured") p.parties.additionalInsureds.push(name);
      if (partyType === "certificateHolder") p.parties.certificateHolders.push(name);
      return p;
    });
  };

  /* =============================================================================
     SECTION C — Held transaction workflow
     ============================================================================= */
  PAS.APPROVAL_LEVELS = ["Standard", "Supervisor", "Carrier"];
  PAS.SLA_HOURS = { default: 48, Material: 24, Fraud: 4, authority: 12 };

  PAS.getApprovalRequirement = function (txn) {
    if (!txn || txn.status !== "Pending") return null;
    var m = txn.meta || {};
    if (m.materiality === "Material" || txn.type === "Cancellation" && m.reason === "Fraud") return { level: "Supervisor", steps: 2, current: m.approvalStep || 0 };
    if ((m.premiumImpact || 0) > 500000 || (m.premiumDelta || 0) > 500000) return { level: "Carrier", steps: 2, current: m.approvalStep || 0 };
    return { level: "Standard", steps: 1, current: m.approvalStep || 0 };
  };

  PAS.getTxnSla = function (txn) {
    var hours = PAS.SLA_HOURS[txn.meta && txn.meta.reason] || PAS.SLA_HOURS[txn.meta && txn.meta.materiality] || PAS.SLA_HOURS.default;
    var recorded = new Date(txn.recordedAt || txn.date).getTime();
    var deadline = recorded + hours * 3600000;
    /* Demo clock — wall-clock Date.now() would mark every seeded pending txn breached years early. */
    var nowMs = new Date(PAS.todayISO() + "T12:00:00").getTime();
    var remaining = Math.round((deadline - nowMs) / 3600000);
    return { hours: hours, deadline: new Date(deadline).toISOString(), remainingHours: remaining, breached: remaining < 0 };
  };

  /* Phase 3 — return-to-queue when a decision desk was opened from Pending Approvals. */
  PAS.fromApprovalsQueue = function () {
    try { return new URLSearchParams(location.search || "").get("from") === "approvals"; }
    catch (e) { return false; }
  };
  PAS.afterDecisionHref = function (deskHome) {
    return PAS.fromApprovalsQueue() ? "approvals.html" : deskHome;
  };
  PAS.pendingQueueSorted = function () {
    var pending = PAS.allTxns(PAS.getPolicies()).filter(function (t) { return t.h.status === "Pending"; });
    return pending.slice().sort(function (a, b) {
      var sa = PAS.getTxnSla(a.h), sb = PAS.getTxnSla(b.h);
      if (sa.breached !== sb.breached) return sa.breached ? -1 : 1;
      if (sa.remainingHours !== sb.remainingHours) return sa.remainingHours - sb.remainingHours;
      var da = a.h.recordedAt || a.h.date || "";
      var db = b.h.recordedAt || b.h.date || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return (a.h.seq || 0) - (b.h.seq || 0);
    });
  };
  PAS.reviewHrefFor = function (t) {
    var desk = PAS.TYPE_TO_DESK[t.h.type];
    var base = desk && PAS.DETAIL_URL_OF[desk] ? PAS.DETAIL_URL_OF[desk] : "advanced-admin-decision.html";
    return base + "?policy=" + encodeURIComponent(t.p.id) + "&txn=" + encodeURIComponent(t.h.id) + "&from=approvals";
  };
  PAS.nextPendingReviewHref = function (policyId, txnId) {
    var list = PAS.pendingQueueSorted();
    var others = list.filter(function (t) { return !(t.p.id === policyId && t.h.id === txnId); });
    if (!others.length) return "approvals.html";
    return PAS.reviewHrefFor(others[0]);
  };

  PAS.approveTxnStep = function (policyId, txnId) {
    return PAS._patchPolicy(policyId, function (p) {
      var txn = p.history.find(function (h) { return h.id === txnId; });
      var req = PAS.getApprovalRequirement(txn);
      if (!txn || !req) return p;
      var step = (txn.meta.approvalStep || 0) + 1;
      var meta = Object.assign({}, txn.meta, { approvalStep: step, approvalTrail: (txn.meta.approvalTrail || []).concat([{ by: PAS.getPasAdminIdentity(), at: new Date().toISOString(), level: req.level }]) });
      if (step < req.steps) {
        return Object.assign({}, p, { history: p.history.map(function (h) { return h.id === txnId ? Object.assign({}, h, { meta: meta, detail: h.detail + " Awaiting " + PAS.APPROVAL_LEVELS[step] + " approval." }) : h; }) });
      }
      return p;
    });
  };

  PAS.bulkApprove = function (items) {
    items.forEach(function (it) {
      var p = PAS.getPolicy(it.policyId);
      var txn = p && p.history.find(function (h) { return h.id === it.txnId; });
      if (!txn) return;
      if (txn.type === "Endorsement") PAS.decideTxn(it.policyId, it.txnId, true);
      else if (PAS.TYPE_TO_DESK[txn.type] === "advanced-desk") PAS.decideAdvancedTxn(it.policyId, it.txnId, true);
      else if (txn.type === "Cancellation") { /* needs quote — skip bulk */ }
      else if (txn.type === "Renewal") PAS.decideRenewal(it.policyId, it.txnId, true, p.premium);
      else if (txn.type === "Transfer") PAS.decideTransfer(it.policyId, it.txnId, true, txn.meta.newHolder);
    });
  };

  /* =============================================================================
     SECTION D — Issue & bind handoff
     ============================================================================= */
  PAS.receiveBoundPolicy = function (data) {
    var policies = PAS.getPolicies();
    var id = data.id || uid("SUB");
    var policy = PAS.ensurePolicyStructure({
      id: id, holder: data.holder, product: data.product, status: "Bound",
      effectiveDate: data.effectiveDate || todayISO(), expirationDate: data.expirationDate || addYears(todayISO(), 1),
      premium: data.premium, producer: data.producer || "Direct", state: data.state || "Maharashtra",
      sumInsured: data.sumInsured || "—", carrier: data.carrier || PAS.CARRIERS[0],
      binder: { number: uid("BN"), boundOn: todayISO(), expiryDate: addDays(todayISO(), 30), subjectivities: data.subjectivities || [{ label: "Signed proposal form", met: false }] },
      documents: [], history: [{ id: uid("TXN"), seq: 1, date: todayISO(), recordedAt: new Date().toISOString(), status: "Completed", user: "UW Module", type: "Bind", title: "Bound by underwriting module", detail: "Received from external UW module via PAS inbound API.", meta: { source: "underwriting-module" } }],
      risk: {}, claims: [],
    });
    policies.push(policy);
    PAS._savePolicies(policies);
    PAS.appendAuditLog({ action: "inbound.bind", policyId: id, detail: "Bound policy received from UW module" });
    return policy;
  };

  PAS.checkBinderExpiries = function () {
    var lapsed = [];
    PAS.getPolicies().forEach(function (p) {
      if (p.status === "Bound" && p.binder && daysBetween(todayISO(), p.binder.expiryDate) < 0) {
        PAS.raiseAdvancedTxn(p.id, "Lapse", { lapseType: "binder", requestNote: "Binder expired — automatic lapse.", initiatedBy: "System", channel: "Binder expiry job" });
        lapsed.push(p.id);
      }
    });
    return lapsed;
  };

  PAS.issueCOI = function (policyId, certificateHolder) {
    return PAS._patchPolicy(policyId, function (p) {
      PAS.ensurePolicyStructure(p);
      p.parties.certificateHolders.push(certificateHolder);
      var doc = PAS._docRecord("Certificate of insurance — " + certificateHolder, "COI", 1, null);
      doc.certificateHolder = certificateHolder;
      doc.deliveryStatus = "Generated";
      return Object.assign({}, p, { documents: (p.documents || []).concat([doc]) });
    });
  };

  /* =============================================================================
     SECTION F — Cancellation rescind
     ============================================================================= */
  PAS.rescindCancellation = function (policyId, cancelTxnId) {
    return PAS._patchPolicy(policyId, function (p) {
      var txn = p.history.find(function (h) { return h.id === cancelTxnId && h.type === "Cancellation" && h.status === "Completed"; });
      if (!txn || daysBetween(txn.date, todayISO()) > RESCIND_WINDOW_DAYS) return p;
      if (p.status !== "Cancelled") return p;
      return Object.assign({}, p, {
        status: "Active",
        history: p.history.concat([{
          id: uid("TXN"), seq: p.history.length + 1, date: todayISO(), recordedAt: new Date().toISOString(),
          status: "Completed", user: PAS.getPasAdminIdentity(), type: "Rescind",
          title: "Cancellation rescinded", detail: "Cancellation txn #" + txn.seq + " rescinded within " + RESCIND_WINDOW_DAYS + "-day window.",
          meta: { rescindsTxnId: cancelTxnId },
        }]),
      });
    });
  };

  /* =============================================================================
     SECTION G — Renewal administration
     ============================================================================= */
  PAS.createRenewalOffer = function (policyId, offeredPremium) {
    return PAS._patchPolicy(policyId, function (p) {
      return PAS._pushTxn(p, {
        date: todayISO(), type: "Renewal", status: "Pending",
        title: "Renewal offer issued",
        detail: "Offered premium " + money(offeredPremium || p.premium) + ". Awaiting insured acceptance.",
        meta: { phase: "offer", offeredPremium: offeredPremium || p.premium, offerDate: todayISO(), autoRenew: p.autoRenew },
      });
    });
  };

  PAS.setAutoRenew = function (policyId, flag) {
    return PAS._patchPolicy(policyId, function (p) { return Object.assign({}, p, { autoRenew: !!flag }); });
  };

  PAS.renewFromExpired = function (policyId, premium) {
    var p = PAS.getPolicy(policyId);
    if (!p || p.status !== "Expired") return null;
    return PAS._patchPolicy(policyId, function (pol) {
      return Object.assign({}, pol, {
        status: "Active", termNumber: pol.termNumber + 1,
        effectiveDate: pol.expirationDate, expirationDate: addYears(pol.expirationDate, 1), premium: premium || pol.premium,
        history: pol.history.concat([{
          id: uid("TXN"), seq: pol.history.length + 1, date: todayISO(), recordedAt: new Date().toISOString(),
          status: "Completed", user: PAS.getPasAdminIdentity(), type: "Renewal",
          title: "Expired policy renewed", detail: "Renewal from expired status (distinct from reinstatement).",
          meta: { fromExpired: true, newPremium: premium || pol.premium },
        }]),
      });
    });
  };

  /* =============================================================================
     SECTION H — Document administration
     ============================================================================= */
  PAS._docRecord = function (name, type, version, txnId) {
    return {
      id: uid("DOC"), name: name, type: type, version: version || 1,
      generatedAt: todayISO(), transactionId: txnId || null,
      deliveryStatus: "Generated", deliveredAt: null,
    };
  };

  PAS.generatePolicyDocument = function (policyId, name, type, txnId) {
    return PAS._patchPolicy(policyId, function (p) {
      var ver = ((p.documents || []).filter(function (d) { return d.name === name; }).length) + 1;
      return Object.assign({}, p, { documents: (p.documents || []).concat([PAS._docRecord(name, type, ver, txnId)]) });
    });
  };

  PAS.markDocumentDelivered = function (policyId, docId) {
    return PAS._patchPolicy(policyId, function (p) {
      return Object.assign({}, p, {
        documents: (p.documents || []).map(function (d) {
          return d.id === docId ? Object.assign({}, d, { deliveryStatus: "Delivered", deliveredAt: todayISO() }) : d;
        }),
      });
    });
  };

  PAS.reprintDocument = function (policyId, docName) {
    return PAS.generatePolicyDocument(policyId, docName, "Reprint", null);
  };

  /* =============================================================================
     SECTION I — Register & inquiry
     ============================================================================= */
  PAS.advancedSearch = function (filters) {
    filters = filters || {};
    return PAS.getPolicies().filter(function (p) {
      if (filters.status && filters.status !== "All" && p.status !== filters.status) return false;
      if (filters.product && filters.product !== "All" && p.product !== filters.product) return false;
      if (filters.state && filters.state !== "All" && p.state !== filters.state) return false;
      if (filters.archived && !p.archived) return false;
      if (filters.effectiveFrom && p.effectiveDate < filters.effectiveFrom) return false;
      if (filters.effectiveTo && p.effectiveDate > filters.effectiveTo) return false;
      if (filters.q) {
        var q = filters.q.toLowerCase();
        if (p.id.toLowerCase().indexOf(q) === -1 && p.holder.toLowerCase().indexOf(q) === -1 && (p.producer || "").toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
  };

  PAS.exportRegisterCsv = function (policies) {
    var rows = [["Policy ID", "Insured", "Product", "Status", "Premium", "Effective", "Expiration", "Term"]];
    policies.forEach(function (p) {
      rows.push([p.id, p.holder, p.product, p.status, p.premium, p.effectiveDate, p.expirationDate, p.termNumber]);
    });
    return rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
  };

  PAS.archivePolicy = function (policyId) {
    return PAS._patchPolicy(policyId, function (p) { return Object.assign({}, p, { archived: true }); });
  };

  /* =============================================================================
     SECTION J — Integration contracts
     ============================================================================= */
  PAS.computeEtag = function (policy) {
    var sig = policy.id + "|" + policy.status + "|" + policy.premium + "|" + policy.history.length + "|" + policy.termNumber;
    var h = 0;
    for (var i = 0; i < sig.length; i++) h = ((h << 5) - h + sig.charCodeAt(i)) | 0;
    return '"' + Math.abs(h).toString(16) + '"';
  };

  PAS.getPolicyEtag = function (policyId) {
    var p = PAS.getPolicy(policyId);
    return p ? (p.etag || PAS.computeEtag(p)) : null;
  };

  var idempotencyStore = {};
  PAS.callWithIdempotency = function (key, fn) {
    if (idempotencyStore[key]) return idempotencyStore[key];
    var result = fn();
    idempotencyStore[key] = result;
    return result;
  };

  PAS.queryPolicyApi = function (policyId) {
    var p = PAS.getPolicy(policyId);
    if (!p) return { status: 404 };
    PAS.ensurePolicyStructure(p);
    return { status: 200, etag: PAS.getPolicyEtag(policyId), policy: { id: p.id, holder: p.holder, status: p.status, premium: p.premium, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate, termNumber: p.termNumber } };
  };

  /* =============================================================================
     SECTION K — PAS admin security & audit
     ============================================================================= */
  PAS.PAS_ADMIN_ROLES = ["Underwriter"];
  PAS.PAS_AUTHORITY = { cancellation: 10000000, endorsement: 5000000, renewal: 20000000 };

  PAS.getPasAdminIdentity = function () {
    var role = PAS.getRole();
    return PAS.ROLES[role] ? PAS.ROLES[role].identity : "PAS Admin";
  };

  PAS.canPasAdminAct = function (action, amount) {
    if (PAS.PAS_ADMIN_ROLES.indexOf(PAS.getRole()) === -1) return { allowed: false, reason: "Role cannot perform PAS admin actions." };
    var limit = PAS.PAS_AUTHORITY[action];
    if (limit && amount > limit) return { allowed: false, reason: "Exceeds PAS admin authority limit of " + money(limit) + "." };
    return { allowed: true };
  };

  PAS.appendAuditLog = function (entry) {
    var log = PAS.getGlobalAuditLog();
    log.unshift(Object.assign({ id: uid("AUD"), at: new Date().toISOString(), user: PAS.getPasAdminIdentity(), role: PAS.getRole() }, entry));
    try { sessionStorage.setItem("pas.audit.v1", JSON.stringify(log.slice(0, 500))); } catch (e) { /* ignore */ }
  };

  PAS.getGlobalAuditLog = function () {
    try { var raw = sessionStorage.getItem("pas.audit.v1"); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    return [];
  };

  PAS.checkSegregationOfDuties = function (txn) {
    if (!txn || !txn.meta) return true;
    return txn.meta.initiatedBy !== PAS.getPasAdminIdentity();
  };

  /* =============================================================================
     Internal helpers (use existing store persistence)
     ============================================================================= */
  PAS._patchPolicy = function (id, fn) {
    var list = PAS.getPolicies().map(function (p) {
      if (p.id !== id) return PAS.ensurePolicyStructure(p);
      var next = fn(PAS.ensurePolicyStructure(Object.assign({}, p)));
      next.etag = PAS.computeEtag(next);
      PAS.appendAuditLog({ action: "policy.update", policyId: id, detail: "Policy record updated", status: next.status });
      return next;
    });
    PAS._savePolicies(list);
    return list.find(function (p) { return p.id === id; });
  };

  PAS._savePolicies = function (list) {
    try { sessionStorage.setItem("pas.policies.v1", JSON.stringify(list)); } catch (e) { /* ignore */ }
  };

  PAS._pushTxn = function (p, e) {
    var entry = Object.assign({
      id: uid("TXN"), seq: p.history.length + 1, recordedAt: new Date().toISOString(),
      status: e.status || "Completed", user: PAS.getPasAdminIdentity(),
    }, e);
    return Object.assign({}, p, { history: p.history.concat([entry]) });
  };

  PAS._addPolicyToBook = function (policy) {
    var list = PAS.getPolicies();
    list.push(PAS.ensurePolicyStructure(policy));
    PAS._savePolicies(list);
  };

  PAS._rescindTxnOnPolicy = function (p, targetTxnId, rescindTxnId) {
    var target = p.history.find(function (h) { return h.id === targetTxnId; });
    if (!target || daysBetween(target.date, todayISO()) > RESCIND_WINDOW_DAYS) return p;
    var history = p.history.map(function (h) {
      if (h.id === targetTxnId) return Object.assign({}, h, { status: "Reversed" });
      return h;
    });
    history = history.map(function (h) {
      if (h.id === rescindTxnId) return h;
      return h;
    });
    return Object.assign({}, p, { history: history });
  };

  /* Wrap getPolicies to ensure structure on read */
  var _origGetPolicies = PAS.getPolicies;
  PAS.getPolicies = function () {
    return _origGetPolicies().map(function (p) { return PAS.ensurePolicyStructure(p); });
  };
  var _origGetPolicy = PAS.getPolicy;
  PAS.getPolicy = function (id) {
    var p = _origGetPolicy(id);
    return p ? PAS.ensurePolicyStructure(p) : null;
  };

  /* Extend NAV */
  if (PAS.NAV) {
    var deskGroup = PAS.NAV.find(function (g) { return g.label === "Decision desks"; });
    if (deskGroup && !deskGroup.items.some(function (it) { return it[0] === "advanced-desk"; })) {
      deskGroup.items.push(["advanced-desk", "Advanced PAS", "layers", "advanced-admin.html"]);
    }
    if (!PAS.NAV.some(function (g) { return g.label === "Integration"; })) {
      PAS.NAV.push({ label: "Integration", items: [["integration-hub", "PAS integration hub", "braces", "integration-hub.html"]] });
    }
  }
  PAS.PAGE_META["advanced-desk"] = { nav: "advanced-desk", title: "Decision desks / Advanced PAS" };
  PAS.PAGE_META["advanced-detail"] = { nav: "advanced-desk", title: "Decision desks / Advanced PAS" };
  PAS.PAGE_META["integration-hub"] = { nav: "integration-hub", title: "Integration / PAS hub" };
  PAS.PAGE_APIS["advanced-desk"] = [["GET", "/api/v1/advanced-transactions", "Advanced PAS transaction queue"], ["POST", "/api/v1/policies/{id}/rewrites", "Rewrite policy"]];
  PAS.PAGE_APIS["integration-hub"] = [["GET", "/api/v1/policies/{id}", "Policy query with ETag"], ["POST", "/api/v1/inbound/bind", "Receive bound policy from UW module"]];

  /* Wrap decideRenewal to maintain term history */
  var _decideRenewal = PAS.decideRenewal;
  PAS.decideRenewal = function (id, txnId, approve, prem) {
    var result = _decideRenewal(id, txnId, approve, prem);
    if (approve) {
      PAS._patchPolicy(id, function (p) {
        var terms = (p.terms || []).concat([{
          termNumber: p.termNumber, effectiveDate: p.effectiveDate, expirationDate: p.expirationDate,
          premium: prem, status: "Active", createdAt: todayISO(),
        }]);
        return Object.assign({}, p, { terms: terms, autoRenew: p.autoRenew });
      });
    }
    return result;
  };

  /* Full reversal — unwind policy status when reversing issuance/cancellation */
  var _reverseTxn = PAS.reverseTxn;
  PAS.reverseTxn = function (pid, tid) {
    var p = PAS.getPolicy(pid);
    var o = p && p.history.find(function (h) { return h.id === tid; });
    _reverseTxn(pid, tid);
    if (o && o.type === "Cancellation" && p.status === "Cancelled") {
      PAS._patchPolicy(pid, function (pol) { return Object.assign({}, pol, { status: "Active" }); });
    }
  };

  PAS.checkBinderExpiries();
})(window);
