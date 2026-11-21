/* Happy Bird — helpers shared by the public site and the admin dashboard.
   Everything user-supplied is rendered with textContent (never innerHTML). */
(function () {
  "use strict";

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name) {
    const paths = {
      exe: "M4 4h16v12H4zM8 20h8M12 16v4",
      zip: "M6 3h9l3 3v15H6zM11 3v3M11 8v2M11 12v2M11 16h2v3h-2z",
      link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
      download: "M12 3v12M7 10l5 5 5-5M4 20h16",
    };
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", "22");
    s.setAttribute("height", "22");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", paths[name] || paths.download);
    s.append(p);
    return s;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  }

  /** Only ever hands out http(s) URLs. */
  function safeUrl(u) {
    try {
      const x = new URL(u);
      return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
    } catch {
      return null;
    }
  }

  /** A direct-download anchor. The href is the real asset URL — no redirect page in between. */
  function dlButton(kind, url, version) {
    const meta = {
      exe: { title: "Windows Executable", ext: ".EXE", cls: "dl--exe" },
      zip: { title: "ZIP Archive", ext: ".ZIP", cls: "dl--zip" },
    }[kind] || { title: kind, ext: "", cls: "dl--extra" };
    const href = safeUrl(url);
    const body = [
      h("span", { class: "dl__icon" }, icon(kind === "exe" || kind === "zip" ? kind : "link")),
      h("span", { class: "dl__text" }, h("strong", { text: meta.title }), h("small", { text: `${meta.ext} · v${version}`.replace(/^ · /, "") })),
      h("span", { class: "dl__go", "aria-hidden": "true" }, icon("download")),
    ];
    if (!href) {
      return h("span", { class: `dl ${meta.cls} is-disabled`, role: "link", "aria-disabled": "true", title: `No ${meta.ext} file for this release` }, body);
    }
    return h("a", { class: `dl ${meta.cls}`, href, download: "", rel: "noopener", "data-dl": kind, "aria-label": `Download ${meta.title} version ${version}` }, body);
  }

  function downloadButtons(r) {
    const row = h("div", { class: "dl-row" });
    row.append(dlButton("exe", r.downloads && r.downloads.exe, r.version));
    row.append(dlButton("zip", r.downloads && r.downloads.zip, r.version));
    (r.extraDownloads || []).forEach((x) => row.append(dlButton(x.label, x.url, r.version)));
    return row;
  }

  function changelogList(entries) {
    return h("ul", { class: "changelog" }, (entries || []).map((t) => h("li", { text: t })));
  }

  /** Full release card (used for version history, admin preview). */
  function releaseCard(r, opts = {}) {
    const card = h("article", { class: "rel" + (opts.latest ? " rel--latest" : "") + (r.status !== "published" ? " rel--draft" : "") });
    card.append(
      h("header", { class: "rel__head" },
        h("div", { class: "rel__ver" }, h("span", { class: "rel__v", text: "v" + r.version }),
          opts.latest ? h("span", { class: "badge badge--new", text: "LATEST" }) : null,
          r.status !== "published" ? h("span", { class: "badge badge--draft", text: "DRAFT" }) : null),
        h("div", { class: "rel__meta" },
          h("span", { text: fmtDate(r.releaseDate) }),
          h("span", { text: r.platform }),
          h("span", { text: r.compatibility }))),
      h("h4", { class: "rel__title", text: r.title }),
      r.description ? h("p", { class: "rel__desc", text: r.description }) : null,
      h("h5", { class: "rel__sub", text: "What's new" }),
      changelogList(r.changelog),
      h("p", { class: "rel__formats" }, "Formats: ", [r.downloads && r.downloads.exe ? "EXE" : null, r.downloads && r.downloads.zip ? "ZIP" : null, ...(r.extraDownloads || []).map((x) => x.label)].filter(Boolean).join(" · ") || "—"),
      downloadButtons(r)
    );
    return card;
  }

  /** fetch JSON with a timeout and a readable error. */
  async function api(path, opts = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeout || 12000);
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || "GET",
        credentials: "same-origin",
        headers: opts.body ? { "content-type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal,
        cache: "no-store",
      });
    } catch (e) {
      const err = new Error(e.name === "AbortError" ? "The server took too long to respond." : "Network error — could not reach the server.");
      err.network = true;
      throw err;
    } finally {
      clearTimeout(t);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      err.fields = data && data.fields;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  window.HB = { h, icon, fmtDate, safeUrl, dlButton, downloadButtons, changelogList, releaseCard, api };
})();
