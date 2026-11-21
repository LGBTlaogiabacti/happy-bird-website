/* Happy Bird Console — release + platform management.
   All authority lives on the server (Netlify Functions); this file only talks to /api/*. */
(function () {
  "use strict";
  const { h, api, fmtDate, releaseCard } = window.HB;
  const $ = (s, r = document) => r.querySelector(s);
  const MODE = location.pathname.replace(/\/+$/, "").endsWith("/base") ? "base" : "releases";
  const S = { releases: [], platforms: [], expiresAt: 0 };

  /* ---------------------------------------------------------- helpers */
  const toastEl = $("#toast");
  let toastT;
  function toast(msg, ms = 3600) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("is-on"), ms);
  }
  const show = (v) => { $("#login").hidden = v !== "login"; $("#dash").hidden = v !== "dash"; };
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /** API call that bounces to the sign-in screen when the session is gone. */
  async function call(path, opts) {
    try {
      return await api(path, opts);
    } catch (e) {
      if (e.status === 401 && e.code === "unauthorized") expired();
      throw e;
    }
  }
  function expired() {
    closeAll();
    stopSession();
    show("login");
    loginMsg("Your session has expired. Please sign in again.", "info");
  }
  function closeAll() { ["#modal", "#modal2"].forEach((s) => { const d = $(s); if (d.open) d.close(); }); }

  /* ---------------------------------------------------------- login */
  const loginForm = $("#loginForm"), pw = $("#pw"), loginBtn = $("#loginBtn");
  function loginMsg(text, kind = "err") {
    const m = $("#loginMsg");
    m.hidden = !text;
    m.className = "msg msg--" + kind;
    m.textContent = text || "";
  }
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pw.value) { loginMsg("Enter the administrator password."); return; }
    loginBtn.disabled = true; loginBtn.textContent = "CHECKING…"; loginMsg("");
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { password: pw.value } });
      pw.value = "";
      S.expiresAt = r.expiresAt;
      await enter();
    } catch (err) {
      loginMsg(err.message);
      pw.select();
    } finally {
      loginBtn.disabled = false; loginBtn.textContent = "SIGN IN";
    }
  });
  $("#logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* cookie may already be gone */ }
    stopSession();
    show("login");
    loginMsg("You have been signed out.", "ok");
    toast("Signed out");
  });

  let sessTimer;
  function startSession() {
    stopSession();
    const upd = () => {
      const left = S.expiresAt - Date.now();
      if (left <= 0) { expired(); return; }
      const m = Math.floor(left / 60000);
      $("#sess").textContent = `Session expires in ${Math.floor(m / 60)}h ${m % 60}m`;
    };
    upd();
    sessTimer = setInterval(upd, 30000);
  }
  function stopSession() { clearInterval(sessTimer); }

  /* ---------------------------------------------------------- boot */
  async function enter() {
    show("dash");
    document.querySelectorAll(".side__nav a").forEach((a) => (a.dataset.mode === MODE ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    startSession();
    await refresh();
  }
  async function refresh() {
    const view = $("#view");
    try {
      const [r, p] = await Promise.all([call("/api/releases?all=1"), call("/api/platforms?all=1")]);
      S.releases = r.releases; S.platforms = p.platforms;
      MODE === "base" ? renderPlatforms() : renderReleases();
    } catch (e) {
      if (e.status === 401) return;
      view.replaceChildren(h("div", { class: "panel glass" }, h("p", { class: "msg msg--err", text: "Could not load data: " + e.message }), h("button", { class: "btn btn--sm btn--cyan", onclick: refresh }, "RETRY")));
    }
  }
  (async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (s.authenticated) { S.expiresAt = s.expiresAt; await enter(); return; }
    } catch (e) {
      show("login");
      loginMsg(e.message);
      return;
    }
    show("login");
  })();

  /* ---------------------------------------------------------- modal plumbing */
  function openModal(dlg, title, body, foot) {
    dlg.replaceChildren(
      h("div", { class: "modal__head" }, h("h2", { id: dlg.id + "Title", text: title }), h("button", { class: "ibtn", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
      h("div", { class: "modal__body" }, body),
      h("div", { class: "modal__foot" }, foot)
    );
    dlg.showModal();
  }
  ["#modal", "#modal2"].forEach((s) => $(s).addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }));

  function confirmDialog(title, message, okLabel) {
    return new Promise((resolve) => {
      const dlg = $("#modal2");
      let result = false;
      dlg.addEventListener("close", () => resolve(result), { once: true });
      openModal(dlg, title, h("p", { text: message }), [
        h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: () => dlg.close() }, "CANCEL"),
        h("button", { class: "btn btn--sm", style: "--c1:#ff8aa0;--c2:#ff3d5e;--edge:#8f1230;--fg:#fff;--glow:rgba(255,61,94,.6)", type: "button", onclick: () => { result = true; dlg.close(); } }, okLabel),
      ]);
    });
  }

  function field(label, input, { hint, key } = {}) {
    const id = "f-" + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h("div", { class: "field", "data-key": key || "" },
      h("label", { for: id, text: label }), input, hint ? h("small", { text: hint }) : null, h("span", { class: "err", "data-err": key || "", role: "alert" }));
  }
  function showErrors(root, fields) {
    root.querySelectorAll(".field").forEach((f) => f.classList.remove("has-err"));
    root.querySelectorAll("[data-err]").forEach((e) => (e.textContent = ""));
    let first = null;
    for (const [k, msg] of Object.entries(fields || {})) {
      const slot = root.querySelector(`[data-err="${CSS.escape(k)}"]`);
      if (slot) { slot.textContent = msg; slot.closest(".field,fieldset")?.classList.add("has-err"); first ||= slot; }
    }
    if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ---------------------------------------------------------- RELEASES view */
  function renderReleases() {
    $("#viewKicker").textContent = "/NEW/RELEASES";
    $("#viewTitle").textContent = "Releases";
    $("#viewActions").replaceChildren(h("button", { class: "btn btn--sun btn--sm", onclick: () => releaseForm() }, "＋ NEW RELEASE"));

    const pub = S.releases.filter((r) => r.status === "published");
    const latest = pub[0];
    const stat = (k, v, cls) => h("div", { class: "stat glass" }, h("dt", { text: k }), h("dd", { class: cls || "", text: String(v) }));
    const view = [
      h("dl", { class: "stats", style: "margin:0" },
        stat("TOTAL RELEASES", S.releases.length),
        stat("PUBLISHED", pub.length),
        stat("DRAFTS", S.releases.length - pub.length),
        stat("LATEST VERSION", latest ? "v" + latest.version : "—", "sun"),
        stat("PLATFORMS", S.platforms.filter((p) => p.status === "published").length)),
    ];

    if (!S.releases.length) {
      view.push(h("div", { class: "panel glass empty" }, "No releases yet. Click “New release” to add the first one."));
    } else {
      const rows = S.releases.map((r) => {
        const isLatest = latest && latest.id === r.id;
        return h("tr", { class: isLatest ? "is-latest" : "" },
          h("td", {}, h("div", { class: "v", text: "v" + r.version }), isLatest ? h("span", { class: "badge badge--new", text: "LATEST" }) : null),
          h("td", {}, h("div", { text: r.title }), h("div", { class: "sub", text: r.platform + " · " + r.compatibility })),
          h("td", { text: fmtDate(r.releaseDate) }),
          h("td", {}, h("span", { class: "pillx " + (r.status === "published" ? "pillx--ok" : "pillx--draft"), text: r.status === "published" ? "Published" : "Draft" })),
          h("td", {}, h("span", { class: "pillx " + (r.downloads.exe ? "pillx--ok" : "pillx--off"), text: "EXE" }), h("span", { class: "pillx " + (r.downloads.zip ? "pillx--ok" : "pillx--off"), text: "ZIP" }), (r.extraDownloads || []).length ? h("span", { class: "pillx", text: `+${r.extraDownloads.length}` }) : null),
          h("td", {}, h("div", { class: "acts" },
            h("button", { class: "ibtn", onclick: () => previewRelease(r, isLatest) }, "Preview"),
            h("button", { class: "ibtn", onclick: () => releaseForm(r) }, "Edit"),
            h("button", { class: "ibtn ibtn--del", onclick: () => deleteRelease(r) }, "Delete"))));
      });
      view.push(h("section", { class: "panel glass" }, h("h2", { text: "All releases" }),
        h("table", { class: "tbl" },
          h("thead", {}, h("tr", {}, ["VERSION", "RELEASE", "DATE", "STATUS", "FILES", ""].map((t) => h("th", { text: t })))),
          h("tbody", {}, rows))));
    }
    $("#view").replaceChildren(...view);
  }

  function previewRelease(r, isLatest) {
    const dlg = $("#modal");
    openModal(dlg, "Preview — how visitors see it", h("div", { class: "preview-wrap" }, releaseCard(r, { latest: !!isLatest })), [
      h("p", { class: "msg msg--info", style: "margin-right:auto", text: r.status === "published" ? "This release is public." : "Draft — not visible to visitors." }),
      h("button", { class: "btn btn--ghost btn--sm", onclick: () => dlg.close() }, "CLOSE")]);
  }

  async function deleteRelease(r) {
    const ok = await confirmDialog("Delete release?", `v${r.version} “${r.title}” will be permanently removed from the website and from version history. This cannot be undone.`, "DELETE");
    if (!ok) return;
    try { await call("/api/releases/" + encodeURIComponent(r.id), { method: "DELETE" }); toast(`Deleted v${r.version}`); await refresh(); }
    catch (e) { toast("Delete failed: " + e.message, 6000); }
  }

  function releaseForm(existing) {
    const r = existing || { version: "", title: "", releaseDate: todayISO(), platform: "Windows", compatibility: "", description: "", downloads: { exe: "", zip: "" }, extraDownloads: [], changelog: [""], status: "published" };
    const dlg = $("#modal");
    const f = {
      version: h("input", { value: r.version, placeholder: "1.3.0", inputmode: "text", maxlength: 40, autocomplete: "off" }),
      date: h("input", { type: "date", value: r.releaseDate }),
      title: h("input", { value: r.title, placeholder: "Happy Bird 1.3.0", maxlength: 120 }),
      platform: h("select", {}, S.platforms.map((p) => h("option", { value: p.name, selected: p.name.toLowerCase() === r.platform.toLowerCase() }, p.name + (p.status === "published" ? "" : " (draft)")))),
      compat: h("input", { value: r.compatibility, placeholder: "Windows 7 and later", maxlength: 120 }),
      desc: h("textarea", { maxlength: 500, placeholder: "One or two sentences about this release." }),
      exe: h("input", { type: "url", value: r.downloads.exe, placeholder: "https://github.com/…/releases/download/…/v1.3.0.exe", autocomplete: "off" }),
      zip: h("input", { type: "url", value: r.downloads.zip, placeholder: "https://github.com/…/releases/download/…/v1.3.0.zip", autocomplete: "off" }),
      status: h("select", {}, h("option", { value: "published", selected: r.status === "published" }, "Published — visible to everyone"), h("option", { value: "draft", selected: r.status !== "published" }, "Draft — hidden from visitors")),
    };
    f.desc.value = r.description;
    if (!S.platforms.length) f.platform.append(h("option", { value: "Windows" }, "Windows"));
    // compat auto-fill from the platform until the admin types their own
    let autoCompat = !r.compatibility;
    const platCompat = () => (S.platforms.find((p) => p.name === f.platform.value) || {}).compatibility || "";
    if (!r.compatibility) f.compat.value = platCompat();
    f.compat.addEventListener("input", () => { autoCompat = false; });
    f.platform.addEventListener("change", () => { if (autoCompat) f.compat.value = platCompat(); });

    /* changelog editor */
    const chgList = h("div", { class: "chg", "data-err-wrap": "" });
    const entries = (r.changelog.length ? r.changelog : [""]).map((t) => ({ t }));
    function drawChg(focusIdx) {
      chgList.replaceChildren(...entries.map((en, i) => {
        const inp = h("input", { value: en.t, maxlength: 300, placeholder: i === 0 ? "e.g. Added new features" : "Another change…", "aria-label": `Changelog entry ${i + 1}` });
        inp.addEventListener("input", () => (en.t = inp.value));
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); entries.splice(i + 1, 0, { t: "" }); drawChg(i + 1); }
          else if (e.key === "Backspace" && !inp.value && entries.length > 1) { e.preventDefault(); entries.splice(i, 1); drawChg(Math.max(0, i - 1)); }
        });
        inp.addEventListener("paste", (e) => {
          const text = (e.clipboardData || window.clipboardData).getData("text");
          if (!/\r?\n/.test(text)) return;
          e.preventDefault();
          const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
          entries.splice(i, 1, ...lines.map((t) => ({ t })));
          drawChg(i + lines.length - 1);
        });
        const mv = (d) => () => { const j = i + d; if (j < 0 || j >= entries.length) return; [entries[i], entries[j]] = [entries[j], entries[i]]; drawChg(j); };
        return h("div", { class: "chg__row" }, inp,
          h("button", { type: "button", class: "ibtn", "aria-label": "Move up", disabled: i === 0, onclick: mv(-1) }, "↑"),
          h("button", { type: "button", class: "ibtn", "aria-label": "Move down", disabled: i === entries.length - 1, onclick: mv(1) }, "↓"),
          h("button", { type: "button", class: "ibtn ibtn--del", "aria-label": "Remove entry", onclick: () => { entries.splice(i, 1); if (!entries.length) entries.push({ t: "" }); drawChg(Math.max(0, i - 1)); } }, "✕"));
      }));
      if (focusIdx != null) chgList.querySelectorAll("input")[focusIdx]?.focus();
    }
    drawChg();
    const chgField = h("fieldset", { "data-key": "changelog" },
      h("legend", { text: "Changelog / What's new" }),
      chgList,
      h("button", { type: "button", class: "btn btn--ghost btn--sm", style: "justify-self:start", onclick: () => { entries.push({ t: "" }); drawChg(entries.length - 1); } }, "＋ ADD ENTRY"),
      h("p", { class: "chg__hint", text: "Enter adds a line · Backspace on an empty line removes it · paste a bullet list to split it into entries." }),
      h("span", { class: "err", "data-err": "changelog", role: "alert" }));

    /* extra downloads */
    const extras = (r.extraDownloads || []).map((x) => ({ ...x }));
    const exWrap = h("div", { class: "chg" });
    function drawEx() {
      exWrap.replaceChildren(...extras.map((x, i) => {
        const l = h("input", { value: x.label, placeholder: "Label (e.g. Portable)", maxlength: 40 }), u = h("input", { value: x.url, placeholder: "https://…", type: "url" });
        l.addEventListener("input", () => (x.label = l.value)); u.addEventListener("input", () => (x.url = u.value));
        return h("div", {}, h("div", { class: "xrow" }, l, u, h("button", { type: "button", class: "ibtn ibtn--del", "aria-label": "Remove link", onclick: () => { extras.splice(i, 1); drawEx(); } }, "✕")), h("span", { class: "err", "data-err": "extraDownloads." + i, role: "alert" }));
      }));
    }
    drawEx();

    const body = h("form", { id: "relForm", novalidate: true, style: "display:grid;gap:1rem" },
      h("div", { class: "grid2" }, field("Version number", f.version, { key: "version", hint: "Semantic version, e.g. 1.3.0" }), field("Release date", f.date, { key: "releaseDate" })),
      field("Release title", f.title, { key: "title" }),
      h("div", { class: "grid2" }, field("Platform", f.platform, { key: "platform" }), field("Compatibility", f.compat, { key: "compatibility" })),
      field("Short description", f.desc, { key: "description" }),
      h("fieldset", {}, h("legend", { text: "Direct download links" }),
        field("EXE direct download URL", f.exe, { key: "downloads.exe", hint: "Must be http(s) and end in .exe — the exact GitHub asset URL." }),
        field("ZIP direct download URL", f.zip, { key: "downloads.zip", hint: "Must be http(s) and end in .zip." }),
        h("details", {}, h("summary", { style: "cursor:pointer;font-weight:800;color:var(--cyan)", text: "Additional download links (optional)" }), h("div", { style: "display:grid;gap:.6rem;margin-top:.8rem" }, exWrap, h("button", { type: "button", class: "btn btn--ghost btn--sm", style: "justify-self:start", onclick: () => { extras.push({ label: "", url: "" }); drawEx(); } }, "＋ ADD LINK")))),
      chgField,
      field("Release status", f.status, { key: "status", hint: "Only published releases appear on the public website." }),
      h("p", { class: "msg msg--err", id: "relMsg", hidden: true, role: "alert" }));

    const collect = () => ({
      version: f.version.value, title: f.title.value, releaseDate: f.date.value, platform: f.platform.value, compatibility: f.compat.value,
      description: f.desc.value, downloads: { exe: f.exe.value.trim(), zip: f.zip.value.trim() },
      extraDownloads: extras.filter((x) => x.label || x.url), changelog: entries.map((e) => e.t).filter((t) => t.trim()), status: f.status.value,
    });

    const saveBtn = h("button", { class: "btn btn--sun btn--sm", type: "submit", form: "relForm" }, existing ? "SAVE CHANGES" : "PUBLISH / SAVE");
    const submit = async (e) => {
      e.preventDefault();
      const msg = $("#relMsg"); msg.hidden = true; showErrors(body, {});
      saveBtn.disabled = true; saveBtn.textContent = "SAVING…";
      try {
        const data = collect();
        const res = existing
          ? await call("/api/releases/" + encodeURIComponent(existing.id), { method: "PUT", body: data })
          : await call("/api/releases", { method: "POST", body: data });
        dlg.close();
        toast(`${res.release.status === "published" ? "Published" : "Saved draft"} v${res.release.version}`);
        await refresh();
      } catch (err) {
        if (err.status === 401) return;
        msg.hidden = false; msg.textContent = err.message;
        if (err.fields) showErrors(body, err.fields);
      } finally { saveBtn.disabled = false; saveBtn.textContent = existing ? "SAVE CHANGES" : "PUBLISH / SAVE"; }
    };
    body.addEventListener("submit", submit);

    openModal(dlg, existing ? `Edit v${existing.version}` : "New release", body, [
      h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: () => dlg.close() }, "CANCEL"),
      h("button", { class: "btn btn--cyan btn--sm", type: "button", onclick: () => {
        const d = collect();
        const prev = { id: "preview", ...d, version: d.version.replace(/^v/i, "") || "?" };
        const d2 = $("#modal2");
        openModal(d2, "Preview", h("div", { class: "preview-wrap", style: "padding:0" }, releaseCard(prev, { latest: true })), [h("button", { class: "btn btn--ghost btn--sm", onclick: () => d2.close() }, "CLOSE")]);
      } }, "PREVIEW"),
      saveBtn]);
  }

  /* ---------------------------------------------------------- PLATFORMS view */
  function renderPlatforms() {
    $("#viewKicker").textContent = "/NEW/BASE";
    $("#viewTitle").textContent = "Platforms";
    $("#viewActions").replaceChildren(h("button", { class: "btn btn--sun btn--sm", onclick: () => platformForm() }, "＋ ADD PLATFORM"));
    const view = [
      h("p", { class: "msg msg--info", text: "A platform appears on the public website only after you add it AND set it to Published. Windows ships as one universal build for Windows 7 and later." }),
    ];
    if (!S.platforms.length) view.push(h("div", { class: "panel glass empty" }, "No platforms configured."));
    else view.push(h("div", { class: "plist" }, S.platforms.map((p) => {
      const used = S.releases.filter((r) => r.platform.toLowerCase() === p.name.toLowerCase()).length;
      return h("article", { class: "pcard glass" },
        h("h3", {}, p.name, h("span", { class: "pillx " + (p.status === "published" ? "pillx--ok" : "pillx--draft"), text: p.status === "published" ? "Published" : "Draft" })),
        h("p", { text: p.description }),
        h("div", { class: "kv" },
          h("span", { class: "pillx", text: p.compatibility }),
          p.supportedVersion ? h("span", { class: "pillx", text: "v" + p.supportedVersion }) : null,
          h("span", { class: "pillx " + (p.downloadAvailable ? "pillx--ok" : "pillx--off"), text: p.downloadAvailable ? "Downloads available" : "No downloads" }),
          ...p.formats.map((x) => h("span", { class: "pillx", text: x })),
          h("span", { class: "pillx", text: `${used} release${used === 1 ? "" : "s"}` })),
        h("div", { class: "acts", style: "justify-content:flex-start;margin-top:.4rem" },
          h("button", { class: "ibtn", onclick: () => platformForm(p) }, "Edit"),
          h("button", { class: "ibtn ibtn--del", onclick: () => deletePlatform(p) }, "Delete")));
    })));
    $("#view").replaceChildren(...view);
  }

  async function deletePlatform(p) {
    const ok = await confirmDialog("Delete platform?", `“${p.name}” will be removed. Platforms that still have releases cannot be deleted.`, "DELETE");
    if (!ok) return;
    try { await call("/api/platforms/" + encodeURIComponent(p.id), { method: "DELETE" }); toast(`Deleted ${p.name}`); await refresh(); }
    catch (e) { toast(e.message, 6500); }
  }

  function platformForm(existing) {
    const p = existing || { name: "", compatibility: "", description: "", supportedVersion: "", downloadAvailable: false, formats: [], status: "draft" };
    const dlg = $("#modal");
    const f = {
      name: h("input", { value: p.name, placeholder: "Linux", maxlength: 60 }),
      compat: h("input", { value: p.compatibility, placeholder: "e.g. Ubuntu 22.04 and later", maxlength: 160 }),
      desc: h("textarea", { maxlength: 500, placeholder: "What visitors should know about this platform build." }),
      ver: h("input", { value: p.supportedVersion, placeholder: "1.2.0" }),
      formats: h("input", { value: (p.formats || []).join(", "), placeholder: "EXE, ZIP" }),
      avail: h("input", { type: "checkbox", checked: p.downloadAvailable }),
      status: h("select", {}, h("option", { value: "draft", selected: p.status !== "published" }, "Draft — hidden from visitors"), h("option", { value: "published", selected: p.status === "published" }, "Published — shown on the website")),
    };
    f.desc.value = p.description;
    const body = h("form", { id: "platForm", novalidate: true, style: "display:grid;gap:1rem" },
      h("div", { class: "grid2" }, field("Platform name", f.name, { key: "name" }), field("Supported version", f.ver, { key: "supportedVersion", hint: "Optional, e.g. 1.2.0" })),
      field("Compatibility information", f.compat, { key: "compatibility" }),
      field("Description", f.desc, { key: "description" }),
      h("div", { class: "grid2" }, field("Download formats", f.formats, { key: "formats", hint: "Comma separated, e.g. EXE, ZIP, APK" }), h("div", { class: "field" }, h("span", { text: "Download availability" }), h("label", { class: "check", style: "padding:.6rem 0" }, f.avail, "Downloads are available"))),
      field("Platform status", f.status, { key: "status" }),
      h("p", { class: "msg msg--err", id: "platMsg", hidden: true, role: "alert" }));
    const saveBtn = h("button", { class: "btn btn--sun btn--sm", type: "submit", form: "platForm" }, existing ? "SAVE CHANGES" : "ADD PLATFORM");
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#platMsg"); msg.hidden = true; showErrors(body, {});
      saveBtn.disabled = true;
      const data = { name: f.name.value, compatibility: f.compat.value, description: f.desc.value, supportedVersion: f.ver.value, downloadAvailable: f.avail.checked, formats: f.formats.value.split(","), status: f.status.value };
      try {
        existing ? await call("/api/platforms/" + encodeURIComponent(existing.id), { method: "PUT", body: data }) : await call("/api/platforms", { method: "POST", body: data });
        dlg.close(); toast(existing ? "Platform updated" : "Platform added"); await refresh();
      } catch (err) {
        if (err.status === 401) return;
        msg.hidden = false; msg.textContent = err.message; if (err.fields) showErrors(body, err.fields);
      } finally { saveBtn.disabled = false; }
    });
    openModal(dlg, existing ? `Edit ${existing.name}` : "Add platform", body, [h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: () => dlg.close() }, "CANCEL"), saveBtn]);
  }
})();
