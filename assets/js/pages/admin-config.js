/* Admin Configuration — roles, permissions and invited users. All client-side/simulated: no real
   auth exists in this prototype (see the callout this page renders), so "permission" here means
   nav/page visibility + data scoping (PAS.ROLES / PAS.scopePolicies in store.js), and "invite"
   means a row in a local, sessionStorage-persisted user directory — no email is ever sent. */
(function () {
  "use strict";
  var PAS = window.PAS, ui = PAS.ui;

  var ICON_CHOICES = ["shield-check", "clipboard-check", "users", "building-2", "user", "key-round", "headphones", "list-checks", "layers", "database"];
  var TONE_CHOICES = Object.keys(ui.TONE_HEX);
  var SCOPE_CHOICES = [
    ["all", "All — the whole book"],
    ["producer", "Own book — by Broker (producer)"],
    ["mga", "Own book — by MGA"],
    ["carrier", "Own book — by Carrier"],
    ["holder", "Own policies — by policyholder"],
    ["none", "None — no policy data"],
  ];
  var SCOPE_LABEL = {};
  SCOPE_CHOICES.forEach(function (s) { SCOPE_LABEL[s[0]] = s[1]; });

  function navGroups() { return PAS.NAV; }

  function render() {
    var role = PAS.getRole();
    var spec = PAS.ROLES[role] || {};
    var params = new URLSearchParams(location.search);
    var tab = params.get("tab") === "users" ? "users" : "roles";

    var page = ui.h("div", {});
    page.appendChild(ui.pageHeader({
      icon: "key-round", tone: "violet", title: "Admin Configuration",
      sub: "Roles, permissions and invited users",
      what: "Manage who can see what — the four default roles, any custom roles you add, and the users assigned to them.",
      why: "Nav visibility and data scoping across the whole app read from exactly this configuration.",
    }));

    var root = document.getElementById("page-content");
    root.innerHTML = "";

    if (!spec.canManageRoles && !spec.canManageUsers) {
      page.appendChild(ui.callout("warn", "The current role (" + (spec.label || role) + ") doesn't have access to Admin Configuration. Use \"View platform as\" (top right) to switch to Super Admin or Admin."));
      root.appendChild(ui.screen("admin-config", page));
      return;
    }

    page.appendChild(ui.callout("info", "Client-side only — this prototype has no real authentication or server. Permissions here control nav visibility and data scoping for this browser session (cleared by \"Reset demo data\"); invites are simulated, no email is sent."));

    var tabsRow = ui.h("div", { class: "tabs" });
    [["roles", "Roles & permissions"], ["users", "Users"]].forEach(function (td) {
      var btn = ui.h("button", { class: "tab-btn" + (tab === td[0] ? " active" : "") }, td[1]);
      btn.addEventListener("click", function () { location.href = "admin-config.html?tab=" + td[0]; });
      tabsRow.appendChild(btn);
    });
    page.appendChild(tabsRow);

    var body = ui.h("div", {});
    page.appendChild(body);
    if (tab === "users") buildUsersTab(body, spec);
    else buildRolesTab(body, spec);

    root.appendChild(ui.screen("admin-config", page));
  }

  /* ================= Roles & permissions tab ================= */
  function buildRolesTab(body, currentSpec) {
    var listWrap = ui.h("div", {});
    var formWrap = ui.h("div", {});
    body.appendChild(listWrap);
    body.appendChild(formWrap);

    function buildList() {
      listWrap.innerHTML = "";
      var newBtn = ui.h("button", { class: "btn tone-primary mb-9", type: "button" }, [PAS.icon("plus", { size: 13 }), document.createTextNode(" New role")]);
      newBtn.addEventListener("click", function () { buildForm(null); });
      if (currentSpec.canManageRoles) listWrap.appendChild(newBtn);

      var keys = Object.keys(PAS.ROLES);
      var panel = ui.panel({ title: "Roles", what: keys.length + " role" + (keys.length === 1 ? "" : "s") + " — default and custom.", pad: 0 }, []);
      panel.querySelector(".panel-body").appendChild(ui.dataTable({
        columns: ["Role", "Scope", "Can decide", "Can request", "Nav items", "Type", ""],
        rows: keys.map(function (key) {
          var r = PAS.ROLES[key];
          var actions = ui.h("div", { style: { display: "flex", gap: "6px" } });
          var editBtn = ui.h("button", { class: "btn small", type: "button" }, "Edit");
          editBtn.addEventListener("click", function (e) { e.stopPropagation(); buildForm(key); });
          actions.appendChild(editBtn);
          if (!r.isSystem && currentSpec.canManageRoles) {
            var delBtn = ui.h("button", { class: "btn small", type: "button" }, "Delete");
            delBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              if (!window.confirm('Delete the "' + r.label + '" role? Anyone currently viewing as it falls back to Super Admin.')) return;
              var result = PAS.deleteRole(key);
              if (!result.allowed) { window.alert(result.reason); return; }
              buildList();
            });
            actions.appendChild(delBtn);
          }
          return [
            ui.pill(r.tone, r.label, r.icon), SCOPE_LABEL[r.scope] || r.scope,
            r.canDecide ? ui.pill("green", "Yes") : ui.pill("gray", "No"),
            r.canRequest ? ui.pill("green", "Yes") : ui.pill("gray", "No"),
            r.visibleNav === "*" ? "All (" + navKeyCount() + ")" : String((r.visibleNav || []).length) + " / " + navKeyCount(),
            r.isSystem ? ui.pill("indigo", "Default") : ui.pill("amber", "Custom"),
            actions,
          ];
        }),
      }));
      listWrap.appendChild(panel);
    }

    function navKeyCount() {
      var n = 0;
      navGroups().forEach(function (g) { n += g.items.length; });
      return n;
    }

    function allNavKeysNow() {
      var out = [];
      navGroups().forEach(function (g) { g.items.forEach(function (it) { out.push(it[0]); }); });
      return out;
    }

    function buildForm(key) {
      formWrap.innerHTML = "";
      if (!currentSpec.canManageRoles) return;
      var existing = key ? PAS.ROLES[key] : null;
      var state = existing
        ? Object.assign({}, existing, { visibleNav: existing.visibleNav === "*" ? allNavKeysNow() : (existing.visibleNav || []).slice() })
        : { label: "", icon: "key-round", tone: "gray", identity: "", desc: "", scope: "all", canDecide: false, canRequest: false, canManageUsers: false, canManageRoles: false, visibleNav: ["dashboard"], isSystem: false };
      var keyState = { value: key || "" };

      var panel = ui.panel({ title: key ? "Edit role — " + existing.label : "New role", what: "Changes apply the moment you save — anyone viewing as this role sees them on their next reload." }, []);
      var pb = panel.querySelector(".panel-body");
      var grid = ui.h("div", { class: "two-col-grid" });

      var leftCol = ui.h("div", {});
      var keyInput = ui.h("input", { class: "field-input", value: keyState.value, disabled: !!key });
      keyInput.addEventListener("input", function () { keyState.value = keyInput.value; });
      leftCol.appendChild(ui.field({ label: "Role key", hint: key ? "Fixed once created." : "A short unique identifier, e.g. \"Auditor\"." }, keyInput));

      var labelInput = ui.h("input", { class: "field-input", value: state.label });
      labelInput.addEventListener("input", function () { state.label = labelInput.value; });
      leftCol.appendChild(ui.field({ label: "Label" }, labelInput));

      var iconSelect = ui.h("select", { class: "field-input" });
      ICON_CHOICES.forEach(function (i) { iconSelect.appendChild(ui.h("option", { value: i, selected: i === state.icon }, i)); });
      iconSelect.addEventListener("change", function () { state.icon = iconSelect.value; });
      leftCol.appendChild(ui.field({ label: "Icon" }, iconSelect));

      var toneSelect = ui.h("select", { class: "field-input" });
      TONE_CHOICES.forEach(function (t) { toneSelect.appendChild(ui.h("option", { value: t, selected: t === state.tone }, t)); });
      toneSelect.addEventListener("change", function () { state.tone = toneSelect.value; });
      leftCol.appendChild(ui.field({ label: "Color" }, toneSelect));

      var scopeSelect = ui.h("select", { class: "field-input" });
      SCOPE_CHOICES.forEach(function (s) { scopeSelect.appendChild(ui.h("option", { value: s[0], selected: s[0] === state.scope }, s[1])); });
      scopeSelect.addEventListener("change", function () { state.scope = scopeSelect.value; });
      leftCol.appendChild(ui.field({ label: "Data scope", hint: "Which policies this role's identity can see." }, scopeSelect));

      var identityInput = ui.h("input", { class: "field-input", value: state.identity });
      identityInput.addEventListener("input", function () { state.identity = identityInput.value; });
      leftCol.appendChild(ui.field({ label: "Default identity", hint: "The demo name this role's scope matches against (e.g. a real producer/MGA/carrier name)." }, identityInput));

      var descInput = ui.h("textarea", { class: "field-input", rows: 3 });
      descInput.value = state.desc;
      descInput.addEventListener("input", function () { state.desc = descInput.value; });
      leftCol.appendChild(ui.field({ label: "Description" }, descInput));

      [["canDecide", "Can decide (approve/decline held transactions)"], ["canRequest", "Can raise a request (cancellation, endorsement, etc.)"], ["canManageUsers", "Can invite/manage users"], ["canManageRoles", "Can manage roles & permissions"]].forEach(function (f) {
        leftCol.appendChild(ui.checkboxRow({ label: f[1], checked: !!state[f[0]], onChange: function (checked) { state[f[0]] = checked; } }));
      });
      grid.appendChild(leftCol);

      var rightCol = ui.h("div", {});
      rightCol.appendChild(ui.h("div", { class: "label-11 mb-9" }, "Visible nav items"));
      navGroups().forEach(function (g) {
        rightCol.appendChild(ui.h("div", { style: { fontSize: "11.5px", fontWeight: "700", color: "var(--text-faint)", margin: "10px 0 4px" } }, g.label));
        g.items.forEach(function (it) {
          rightCol.appendChild(ui.checkboxRow({
            label: it[1], checked: state.visibleNav.indexOf(it[0]) !== -1,
            onChange: function (checked) {
              if (checked) { if (state.visibleNav.indexOf(it[0]) === -1) state.visibleNav.push(it[0]); }
              else { state.visibleNav = state.visibleNav.filter(function (k) { return k !== it[0]; }); }
            },
          }));
        });
      });
      grid.appendChild(rightCol);
      pb.appendChild(grid);

      var actions = ui.h("div", { style: { display: "flex", gap: "8px", marginTop: "14px" } });
      var saveBtn = ui.h("button", { class: "btn tone-primary", type: "button" }, key ? "Save changes" : "Create role");
      saveBtn.addEventListener("click", function () {
        var finalKey = key || keyState.value.trim();
        if (!finalKey || !state.label.trim()) { window.alert("Role key and label are both required."); return; }
        if (!key && PAS.ROLES[finalKey]) { window.alert('A role with the key "' + finalKey + '" already exists.'); return; }
        /* Every currently-known nav key checked -> store the "*" sentinel instead of a frozen
           snapshot, so this role keeps seeing any nav item added later too (see store.js). */
        var allKeysNow = allNavKeysNow();
        var finalVisibleNav = allKeysNow.every(function (k) { return state.visibleNav.indexOf(k) !== -1; }) ? "*" : state.visibleNav;
        var payload = Object.assign({}, state, { visibleNav: finalVisibleNav, isSystem: existing ? existing.isSystem : false });
        PAS.api.call("POST", "/api/v1/admin/roles", payload, { module: "Admin", statusCode: key ? 200 : 201, label: (key ? "Role updated — " : "Role created — ") + payload.label, response: { roleKey: finalKey } })
          .then(function () { PAS.saveRole(finalKey, payload); formWrap.innerHTML = ""; buildList(); });
      });
      actions.appendChild(saveBtn);
      var cancelBtn = ui.h("button", { class: "btn small", type: "button" }, "Cancel");
      cancelBtn.addEventListener("click", function () { formWrap.innerHTML = ""; });
      actions.appendChild(cancelBtn);
      pb.appendChild(actions);

      formWrap.appendChild(panel);
    }

    buildList();
  }

  /* ================= Users tab ================= */
  function buildUsersTab(body, currentSpec) {
    var listWrap = ui.h("div", {});
    body.appendChild(listWrap);

    function roleDefaultIdentity(roleKey) { return (PAS.ROLES[roleKey] || {}).identity || ""; }

    function buildInviteForm() {
      var panel = ui.panel({ title: "Invite a user", what: "Simulated — adds a directory row with status \"Invited\"; no email is sent." }, []);
      var pb = panel.querySelector(".panel-body");
      var row = ui.h("div", { class: "three-col-grid" });

      var state = { name: "", email: "", roleKey: Object.keys(PAS.ROLES)[0], identity: roleDefaultIdentity(Object.keys(PAS.ROLES)[0]) };

      var nameInput = ui.h("input", { class: "field-input", type: "text", placeholder: "Full name" });
      nameInput.addEventListener("input", function () { state.name = nameInput.value; });
      row.appendChild(ui.field({ label: "Name" }, nameInput));

      var emailInput = ui.h("input", { class: "field-input", type: "email", placeholder: "name@company.com" });
      emailInput.addEventListener("input", function () { state.email = emailInput.value; });
      row.appendChild(ui.field({ label: "Email" }, emailInput));

      var roleSelect = ui.h("select", { class: "field-input" });
      Object.keys(PAS.ROLES).forEach(function (k) { roleSelect.appendChild(ui.h("option", { value: k, selected: k === state.roleKey }, PAS.ROLES[k].label)); });
      roleSelect.addEventListener("change", function () { state.roleKey = roleSelect.value; state.identity = roleDefaultIdentity(state.roleKey); identityInput.value = state.identity; });
      row.appendChild(ui.field({ label: "Role" }, roleSelect));
      pb.appendChild(row);

      var row2 = ui.h("div", { class: "three-col-grid" });
      var identityInput = ui.h("input", { class: "field-input", type: "text", value: state.identity });
      identityInput.addEventListener("input", function () { state.identity = identityInput.value; });
      row2.appendChild(ui.field({ label: "Scoping identity", hint: "Which producer/MGA/carrier/holder name this user's own book matches — \"View as\" uses this instead of the role's shared default." }, identityInput));
      pb.appendChild(row2);

      var inviteBtn = ui.h("button", { class: "btn tone-primary mt-9", type: "button" }, [PAS.icon("plus", { size: 13 }), document.createTextNode(" Send invite")]);
      inviteBtn.addEventListener("click", function () {
        if (!state.name.trim() || !state.email.trim()) { window.alert("Name and email are both required."); return; }
        PAS.api.call("POST", "/api/v1/admin/users/invite", state, { module: "Admin", statusCode: 201, label: "User invited — " + state.name, response: { status: "Invited" } })
          .then(function () { PAS.inviteUser(state); buildList(); });
      });
      pb.appendChild(inviteBtn);

      return panel;
    }

    function buildList() {
      listWrap.innerHTML = "";
      if (currentSpec.canManageUsers) listWrap.appendChild(buildInviteForm());

      var users = PAS.getUsers();
      var panel = ui.panel({ title: "Users", what: users.length + " invited user" + (users.length === 1 ? "" : "s") + ".", pad: 0 }, []);
      panel.querySelector(".panel-body").appendChild(ui.dataTable({
        columns: ["Name", "Email", "Role", "Identity", "Status", "Invited", ""],
        rows: users.map(function (u) {
          var r = PAS.ROLES[u.roleKey];
          var actions = ui.h("div", { style: { display: "flex", gap: "6px" } });
          var viewBtn = ui.h("button", { class: "btn small", type: "button" }, "View as");
          viewBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            PAS.setRole(u.roleKey);
            PAS.setActingIdentity(u.identity);
            location.href = "index.html";
          });
          actions.appendChild(viewBtn);
          if (currentSpec.canManageUsers) {
            var revokeBtn = ui.h("button", { class: "btn small", type: "button" }, "Revoke");
            revokeBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              if (!window.confirm("Revoke " + u.name + "'s invite?")) return;
              PAS.revokeUser(u.id);
              buildList();
            });
            actions.appendChild(revokeBtn);
          }
          return [ui.cellName(u.name), u.email, r ? ui.pill(r.tone, r.label, r.icon) : u.roleKey, u.identity || "—", ui.pill(u.status === "Invited" ? "amber" : "green", u.status), u.invitedOn, actions];
        }),
        emptyText: "No users invited yet.",
      }));
      listWrap.appendChild(panel);
    }

    buildList();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
