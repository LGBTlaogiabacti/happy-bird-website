/* Happy Bird — public site
   Bird/scroll engine · world transitions · gallery · web demo · live release centre */
(function () {
  "use strict";
  const { h, api, fmtDate, releaseCard, dlButton } = window.HB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const guard = (name, fn) => { try { return fn(); } catch (e) { console.error(`[HappyBird] ${name} failed:`, e); } };

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE_POINTER = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isMobile = () => innerWidth < 760;
  if (REDUCED) document.documentElement.classList.add("reduced");
  const HAS_GSAP = !!(window.gsap && window.ScrollTrigger);
  if (HAS_GSAP) gsap.registerPlugin(ScrollTrigger);

  const REPO = "https://github.com/LGBTlaogiabacti/Happy-Bird";
  // Shown ONLY when the live release API is unreachable, and clearly labelled "last known".
  const FALLBACK = {
    version: "1.2.0",
    downloads: {
      exe: "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.exe",
      zip: "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.zip",
    },
  };

  /* ------------------------------------------------------------ toast */
  const toastEl = $("#toast");
  let toastT;
  function toast(msg, ms = 4200) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("is-on"), ms);
  }

  /* ------------------------------------------------------------ audio */
  const audioCache = {};
  const oggOk = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { return false; } })();
  function sfx(name, vol = 0.6) {
    try {
      const ext = oggOk ? "ogg" : "wav";
      const a = (audioCache[name] ||= new Audio(`/assets/audio/${name}.${ext}`));
      a.volume = vol;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch { /* audio is optional */ }
  }

  /* ------------------------------------------------------------ scroll engine (Lenis) */
  let lenis = null;
  if (HAS_GSAP && !REDUCED && window.Lenis) {
    guard("lenis", () => {
      lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, anchors: false });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    });
  }
  function scrollToTarget(target) {
    const el = typeof target === "string" ? $(target) : target;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: el.id === "hero" ? 0 : 0, duration: 1.5 });
    else el.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", "#" + el.id);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    if (id.length > 1 && $(id)) { e.preventDefault(); closeMenu(); scrollToTarget(id); }
  });

  /* ------------------------------------------------------------ layout cache */
  const SECTIONS = ["hero", "about", "gameplay", "features", "download", "github"].map((id) => $("#" + id));
  const L = { vw: innerWidth, vh: innerHeight, top: [], h: [], cen: [] };
  function layout() {
    L.vw = innerWidth; L.vh = innerHeight;
    const sy = scrollY;
    L.top = SECTIONS.map((s) => s.getBoundingClientRect().top + sy);
    L.h = SECTIONS.map((s) => s.offsetHeight);
    L.cen = L.top.map((t, i) => t + L.h[i] / 2);
  }
  layout();
  let roT;
  new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(() => { layout(); if (HAS_GSAP) ScrollTrigger.refresh(); }, 120); }).observe(document.body);
  addEventListener("resize", layout, { passive: true });

  /* ------------------------------------------------------------ nav */
  const nav = $("#nav"), navLinks = $("#navLinks"), pill = $("#navPill"), burger = $("#burger");
  const navAnchors = $$("a[data-nav]", navLinks);
  function closeMenu() { navLinks.classList.remove("is-open"); burger.setAttribute("aria-expanded", "false"); burger.setAttribute("aria-label", "Open menu"); }
  burger.addEventListener("click", () => {
    const open = !navLinks.classList.contains("is-open");
    navLinks.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#nav")) closeMenu(); });
  let activeIdx = -1;
  function setActive(i) {
    if (i === activeIdx) return;
    activeIdx = i;
    const id = SECTIONS[i].id;
    let found = null;
    navAnchors.forEach((a) => {
      const on = a.getAttribute("href") === "#" + id;
      a.classList.toggle("is-active", on);
      if (on) { a.setAttribute("aria-current", "true"); found = a; } else a.removeAttribute("aria-current");
    });
    if (found && innerWidth > 820) {
      pill.style.opacity = "1";
      pill.style.width = found.offsetWidth + "px";
      pill.style.transform = `translateX(${found.offsetLeft}px)`;
    } else pill.style.opacity = "0";
  }
  addEventListener("resize", () => { const i = activeIdx; activeIdx = -1; setActive(i < 0 ? 0 : i); }, { passive: true });

  /* ------------------------------------------------------------ world: env fade, bird, particles, clouds */
  const envEls = { day: $(".env--day"), dusk: $(".env--dusk"), night: $(".env--night"), focus: $(".env--focus"), grid: $(".env--grid") };
  const envOp = { day: 1, dusk: 0, night: 0, focus: 0, grid: 0 };
  const FG_OP = { day: 0.92, dusk: 0.7, night: 0.32, focus: 0.14, grid: 0.1 };
  const envOf = (i) => SECTIONS[i].dataset.env;

  const birdEl = $("#bird"), birdSprite = $("#birdSprite");
  const BIRD_PATH = {
    desk: [
      { x: 0.76, y: 0.46, s: 7 },   // hero
      { x: 0.5, y: 0.3, s: 3.6 },   // about
      { x: 0.93, y: 0.34, s: 3.4 }, // gameplay
      { x: 0.05, y: 0.82, s: 3.6 }, // features
      { x: 0.94, y: 0.18, s: 3.6 }, // download
      { x: 0.5, y: 0.09, s: 3.2 },  // github
    ],
    mob: [
      { x: 0.76, y: 0.6, s: 4.2 },
      { x: 0.84, y: 0.14, s: 2.3 },
      { x: 0.14, y: 0.16, s: 2.3 },
      { x: 0.86, y: 0.88, s: 2.3 },
      { x: 0.14, y: 0.12, s: 2.3 },
      { x: 0.84, y: 0.1, s: 2.2 },
    ],
  };
  const B = { x: -200, y: 300, s: 4, dir: 1, dirT: 1, rot: 0, intro: 1, phase: 0, frame: -1, lastX: 0, lastY: 0, sv: 0, lastSy: scrollY, vy: 0, trail: 0, ready: false };
  const mouse = { x: 0, y: 0, nx: 0, ny: 0, active: false };
  if (FINE_POINTER && !REDUCED) {
    addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.nx = (e.clientX / L.vw - 0.5) * 2; mouse.ny = (e.clientY / L.vh - 0.5) * 2; mouse.active = true; }, { passive: true });
    document.addEventListener("pointerleave", () => { mouse.active = false; });
  }

  function setBirdColour(c) {
    const url = `/assets/sprites/${c}bird-sheet.png`;
    birdSprite.style.backgroundImage = `url(${url})`;
    $$(".sw").forEach((b) => { const on = b.dataset.bird === c; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    try { localStorage.setItem("hb-bird", c); } catch { /* ignore */ }
  }
  guard("bird colour", () => {
    let c = "yellow";
    try { const s = localStorage.getItem("hb-bird"); if (["yellow", "red", "blue"].includes(s)) c = s; } catch { /* ignore */ }
    setBirdColour(c);
    $$(".sw").forEach((b) => b.addEventListener("click", () => { setBirdColour(b.dataset.bird); sfx("wing", 0.4); B.sv += 2500; }));
  });

  // ---- particles
  const cv = $("#particles"), ctx = cv.getContext("2d");
  let dpr = 1;
  const parts = [];
  const PCOL = { day: ["#ffffff", "#fff7b0"], dusk: ["#ffd6a8", "#ffffff"], night: ["#37f2ff", "#ffffff", "#9b5cff"], focus: ["#37f2ff", "#5dff9d"], grid: ["#37f2ff", "#9b5cff", "#5dff9d"] };
  function sizeCanvas() { dpr = Math.min(devicePixelRatio || 1, 1.5); cv.width = Math.round(L.vw * dpr); cv.height = Math.round(L.vh * dpr); }
  sizeCanvas();
  addEventListener("resize", sizeCanvas, { passive: true });
  function seedParticles() {
    parts.length = 0;
    if (REDUCED) return;
    const n = isMobile() ? 20 : 54;
    for (let i = 0; i < n; i++) parts.push({ x: Math.random() * L.vw, y: Math.random() * L.vh, z: 0.3 + Math.random() * 0.9, s: Math.random() < 0.5 ? 3 : 5, c: Math.random(), life: -1 });
  }
  seedParticles();
  addEventListener("resize", () => { clearTimeout(seedParticles._t); seedParticles._t = setTimeout(seedParticles, 200); }, { passive: true });
  const trail = [];
  function drawParticles(dt, sv, dom) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.vw, L.vh);
    const pal = PCOL[dom] || PCOL.day;
    ctx.globalAlpha = dom === "day" ? 0.7 : 0.85;
    for (const p of parts) {
      p.y -= (14 * p.z + sv * 0.02 * p.z) * dt;
      p.x -= 8 * p.z * dt;
      if (p.y < -10) { p.y = L.vh + 10; p.x = Math.random() * L.vw; }
      if (p.y > L.vh + 20) p.y = -10;
      if (p.x < -10) p.x = L.vw + 10;
      ctx.fillStyle = pal[Math.floor(p.c * pal.length) % pal.length];
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i];
      t.life -= dt;
      if (t.life <= 0) { trail.splice(i, 1); continue; }
      t.x += t.vx * dt; t.y += t.vy * dt;
      ctx.globalAlpha = clamp(t.life / 0.7, 0, 1) * 0.9;
      ctx.fillStyle = t.c;
      ctx.fillRect(Math.round(t.x), Math.round(t.y), t.s, t.s);
    }
    ctx.globalAlpha = 1;
  }

  // ---- foreground clouds (pass IN FRONT of the bird, so it ducks behind them)
  const fgWrap = $("#fgClouds");
  const fg = $$("#fgClouds img").map((el, i) => ({ el, k: +el.dataset.k, x0: +el.dataset.x / 100, w: +el.dataset.w, top: [0.24, 0.57, 0.8][i] }));

  // ---- the single animation loop (GSAP ticker -> one rAF)
  let sectionIdx = 0;
  let tickDead = false;
  function tick(time, deltaMs) {
    if (tickDead) return;
    try {
      const dt = Math.min(deltaMs / 1000, 0.05) || 0.016;
      const sy = scrollY, vw = L.vw, vh = L.vh;

      // scroll velocity (px/s), smoothed
      const raw = (sy - B.lastSy) / dt;
      B.lastSy = sy;
      B.sv += (raw - B.sv) * (1 - Math.exp(-dt * 9));
      const sv = REDUCED ? 0 : B.sv;

      // active section + environment cross-fade
      const mid = sy + vh * 0.5;
      let idx = 0;
      for (let i = 0; i < SECTIONS.length; i++) if (L.top[i] <= mid) idx = i;
      if (idx !== sectionIdx) { sectionIdx = idx; }
      setActive(idx);
      const next = Math.min(idx + 1, SECTIONS.length - 1);
      const blend = next === idx ? 0 : smooth(0.72, 1, (mid - L.top[idx]) / L.h[idx]);
      const target = { day: 0, dusk: 0, night: 0, focus: 0, grid: 0 };
      target[envOf(idx)] += 1 - blend;
      target[envOf(next)] += blend;
      let fgOp = 0, dom = envOf(idx);
      if (blend > 0.5) dom = envOf(next);
      for (const k in target) {
        if (Math.abs(envOp[k] - target[k]) > 0.002) { envOp[k] = target[k]; envEls[k].style.opacity = target[k].toFixed(3); }
        fgOp += target[k] * FG_OP[k];
      }
      fgWrap.style.opacity = fgOp.toFixed(3);

      nav.classList.toggle("is-stuck", sy > 30);
      hudDist.textContent = String(Math.floor(sy / 8)).padStart(4, "0");

      // bird waypoints (interpolated between section centres)
      const path = isMobile() ? BIRD_PATH.mob : BIRD_PATH.desk;
      let j = 0;
      for (let i = 0; i < SECTIONS.length; i++) if (L.cen[i] <= mid) j = i;
      const k = Math.min(j + 1, SECTIONS.length - 1);
      let u = k === j ? 0 : clamp((mid - L.cen[j]) / (L.cen[k] - L.cen[j]), 0, 1);
      const e = u * u * (3 - 2 * u);
      const A = path[j], C = path[k];
      let tx = lerp(A.x, C.x, e) * vw;
      let ty = lerp(A.y, C.y, e) * vh - Math.sin(Math.PI * u) * vh * 0.09; // arc between sections
      let ts = lerp(A.s, C.s, e);
      const heroness = clamp(1 - (sy / (L.h[0] * 0.8)), 0.35, 1);
      if (!REDUCED) {
        ty += Math.sin(time * 2.1) * 9 * heroness;
        tx += Math.cos(time * 1.3) * 6;
        tx += clamp(sv * 0.018, -46, 46); // lean into the scroll
        if (mouse.active) { tx += mouse.nx * 24 * heroness; ty += mouse.ny * 16 * heroness; }
      }
      tx -= B.intro * vw * 0.7;
      ty += B.intro * vh * 0.15;

      const follow = REDUCED ? 1 : 1 - Math.exp(-dt * 4.6);
      B.x += (tx - B.x) * follow;
      B.y += (ty - B.y) * follow;
      B.s += (ts - B.s) * (REDUCED ? 1 : 1 - Math.exp(-dt * 4));
      const vx = (B.x - B.lastX) / dt, vy = (B.y - B.lastY) / dt;
      B.lastX = B.x; B.lastY = B.y;

      // facing direction: scrolling up turns the bird around
      if (sv < -60) B.dirT = -1; else if (sv > 60) B.dirT = 1;
      B.dir += (B.dirT - B.dir) * (REDUCED ? 1 : 1 - Math.exp(-dt * 10));

      // tilt: velocity + a little glance toward the cursor
      let tilt = clamp(vy * 0.016, -24, 30) * B.dirT;
      if (mouse.active && !REDUCED) {
        const ang = Math.atan2(mouse.y - B.y, Math.abs(mouse.x - B.x) + 120) * (180 / Math.PI);
        tilt += clamp(ang * 0.16, -9, 9) * heroness * B.dirT;
      }
      if (REDUCED) tilt = 0;
      B.rot += (tilt - B.rot) * (1 - Math.exp(-dt * 8));

      // wings: faster when the page moves faster
      const speed = Math.abs(sv) + Math.hypot(vx, vy) * 0.25;
      B.phase += dt * (REDUCED ? 0 : 2.4 + Math.min(speed / 140, 9));
      const frame = REDUCED ? 1 : Math.floor(B.phase * 4) % 4;
      if (frame !== B.frame) { B.frame = frame; birdSprite.style.backgroundPositionX = -frame * 34 + "px"; }

      const sc = B.s * (isMobile() ? clamp(vw / 420, 0.7, 1) : clamp(vw / 1400, 0.7, 1.15));
      birdEl.style.transform = `translate3d(${B.x.toFixed(1)}px,${B.y.toFixed(1)}px,0) rotate(${B.rot.toFixed(2)}deg) scale(${(B.dir * sc).toFixed(3)},${sc.toFixed(3)})`;

      // pixel trail
      if (!REDUCED && B.ready) {
        B.trail -= dt;
        if (speed > 220 && B.trail <= 0 && trail.length < 70) {
          B.trail = 0.035;
          const back = -B.dir * 15 * sc;
          trail.push({ x: B.x + back + (Math.random() - 0.5) * 10, y: B.y + (Math.random() - 0.5) * 16 * sc * 0.5, vx: back * 0.6 + (Math.random() - 0.5) * 20, vy: (Math.random() - 0.3) * 24, s: Math.random() < 0.5 ? 4 : 6, life: 0.7, c: ["#ffffff", "#37f2ff", "#ffd23f"][Math.floor(Math.random() * 3)] });
        }
      }

      // foreground clouds: drift + scroll parallax, wrapped
      if (!REDUCED) {
        for (const c of fg) {
          const w = c.w * (isMobile() ? 0.55 : 1);
          const span = vw + w * 2;
          let x = (c.x0 * vw - sy * 0.35 * c.k - time * 9 * c.k) % span;
          if (x < 0) x += span;
          c.el.style.width = w + "px";
          c.el.style.transform = `translate3d(${(x - w).toFixed(1)}px,${(c.top * vh + Math.sin(time * 0.4 + c.k * 5) * 8).toFixed(1)}px,0)`;
        }
        drawParticles(dt, sv, dom);
      } else {
        fg.forEach((c) => { c.el.style.display = "none"; });
      }
    } catch (err) {
      tickDead = true;
      console.error("[HappyBird] animation loop stopped:", err);
    }
  }
  const hudDist = $("#hudDist");
  if (HAS_GSAP) gsap.ticker.add(tick);
  else addEventListener("scroll", () => tick(performance.now() / 1000, 16), { passive: true });

  /* ------------------------------------------------------------ title, reveals, parallax, tilt */
  $$("[data-split]").forEach((el) => {
    const txt = el.textContent.trim();
    el.textContent = "";
    el.setAttribute("aria-hidden", "true");
    [...txt].forEach((ch) => el.append(h("span", { class: "ch", text: ch })));
  });

  function introAnimations() {
    B.ready = true;
    birdEl.classList.add("is-on");
    if (!HAS_GSAP || REDUCED) { B.intro = 0; return; }
    gsap.to(B, { intro: 0, duration: 2.1, ease: "power3.out", delay: 0.1 });
    const chars = $$(".title .ch");
    gsap.from(chars, { yPercent: -140, rotation: () => gsap.utils.random(-25, 25), opacity: 0, duration: 0.9, ease: "bounce.out", stagger: 0.07 });
    gsap.from("[data-hero]", { y: 30, opacity: 0, duration: 0.8, stagger: 0.12, delay: 0.6, ease: "power3.out" });
    gsap.to(chars, { y: -7, duration: 1.1, ease: "sine.inOut", yoyo: true, repeat: -1, stagger: { each: 0.09, repeat: -1, yoyo: true }, delay: 1.6 });
    if (FINE_POINTER) chars.forEach((c) => c.addEventListener("pointerenter", () => { if (!c._j) { c._j = true; gsap.fromTo(c, { scale: 1 }, { scale: 1.25, rotation: gsap.utils.random(-12, 12), duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out", onComplete: () => { c._j = false; } }); } }));
  }

  // moving pipes band (built always; animated by scroll when motion is allowed)
  guard("pipe build", () => {
    const run = $("#pipeRun");
    const inner = h("div", { class: "pipe-run__in", style: "position:absolute;top:0;left:0;height:100%" });
    const mob = isMobile();
    const gap = mob ? 104 : 150, spacing = mob ? 250 : 380, count = mob ? 9 : 10;
    for (let i = 0; i < count; i++) {
      const gt = (mob ? 18 : 28) + ((i * 37) % (mob ? 46 : 100));
      inner.append(h("div", { class: "pp", style: `left:${160 + i * spacing}px;--gap:${gap}px;--gap-top:${gt}px` }, h("i"), h("i")));
    }
    inner.style.width = 160 + count * spacing + "px";
    inner._cfg = { count, spacing };
    run.append(inner);
    if (REDUCED) inner.style.transform = "translateX(-80px)";
  });

  if (HAS_GSAP && !REDUCED) {
    guard("reveals", () => {
      gsap.set("[data-reveal]", { opacity: 0, y: 46 });
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 90%", once: true,
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, stagger: 0.12, ease: "power3.out", overwrite: "auto" }),
      });
    });
    guard("parallax", () => {
      $$("[data-par]").forEach((el) => {
        gsap.to(el, { y: +el.dataset.par, ease: "none", scrollTrigger: { trigger: el.closest(".sec"), start: "top bottom", end: "bottom top", scrub: true } });
      });
      $$("[data-drift]").forEach((el, i) => gsap.to(el, { x: +el.dataset.drift, duration: 14 + i * 3, ease: "sine.inOut", yoyo: true, repeat: -1 }));
      $$(".cloud:not([data-par])").forEach((el, i) => gsap.to(el, { x: 40, duration: 16 + i * 2, ease: "sine.inOut", yoyo: true, repeat: -1 }));
    });
    // scenery shifts: the ground/skyline slide away with the hero
    guard("hero scenery", () => {
      gsap.to(".hero__land", { y: 160, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
      gsap.to(".hero__inner", { y: -60, opacity: 0.2, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom 30%", scrub: true } });
      gsap.to(".skyline", { backgroundPositionX: -260, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    });
    guard("pipe run", () => {
      const inner = $(".pipe-run__in");
      const { count, spacing } = inner._cfg;
      gsap.fromTo(inner, { x: () => L.vw * 0.3 }, { x: () => -(160 + count * spacing - L.vw * 0.7), ease: "none", invalidateOnRefresh: true, scrollTrigger: { trigger: ".gameplay", start: "top bottom", end: "top top-=400", scrub: 0.6 } });
      gsap.fromTo(".gallery .shot", { rotate: (i) => (i % 2 ? 3 : -3) }, { rotate: 0, ease: "none", scrollTrigger: { trigger: ".gallery", start: "top 90%", end: "top 40%", scrub: true } });
    });
    if (FINE_POINTER) {
      guard("tilt", () => {
        $$("[data-tilt]").forEach((el) => {
          el.addEventListener("pointermove", (e) => {
            const r = el.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
            gsap.to(el, { rotationY: px * 9, rotationX: -py * 9, transformPerspective: 900, duration: 0.4, ease: "power2.out", overwrite: "auto" });
          });
          el.addEventListener("pointerleave", () => gsap.to(el, { rotationY: 0, rotationX: 0, duration: 0.6, ease: "power3.out", overwrite: "auto" }));
        });
      });
    }
  }

  // button burst
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fx]");
    if (!b || REDUCED || !HAS_GSAP) return;
    const r = b.getBoundingClientRect();
    const cx = e.clientX || r.left + r.width / 2, cy = e.clientY || r.top + r.height / 2;
    for (let i = 0; i < 10; i++) {
      const d = h("i", { class: "fx-dot", style: `left:${cx}px;top:${cy}px;background:${["#ffd23f", "#37f2ff", "#fff", "#5dff9d"][i % 4]}` });
      document.body.append(d);
      gsap.to(d, { x: gsap.utils.random(-70, 70), y: gsap.utils.random(-70, 40), rotation: gsap.utils.random(-90, 90), opacity: 0, scale: 0.3, duration: 0.7, ease: "power2.out", onComplete: () => d.remove() });
    }
  });

  /* ------------------------------------------------------------ gallery + lightbox */
  const shots = $$("#gallery .shot");
  const lb = $("#lb"), lbImg = $("#lbImg"), lbCap = $("#lbCap");
  let lbI = 0, lbOpener = null;
  function lbShow(i) {
    lbI = (i + shots.length) % shots.length;
    const img = $("img", shots[lbI]);
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt;
    lbCap.textContent = `${$("b", shots[lbI]).textContent} — sprite scene built from the game's art (${lbI + 1}/${shots.length})`;
  }
  function lbOpen(i, opener) {
    lbOpener = opener;
    lbShow(i);
    lb.hidden = false;
    lenis ? lenis.stop() : (document.body.style.overflow = "hidden");
    $("#lbX").focus();
  }
  function lbClose() {
    lb.hidden = true;
    lenis ? lenis.start() : (document.body.style.overflow = "");
    lbOpener && lbOpener.focus();
  }
  shots.forEach((s, i) => s.addEventListener("click", () => lbOpen(i, s)));
  $("#lbX").addEventListener("click", lbClose);
  $("#lbP").addEventListener("click", () => lbShow(lbI - 1));
  $("#lbN").addEventListener("click", () => lbShow(lbI + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) lbClose(); });
  addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") lbClose();
    else if (e.key === "ArrowLeft") lbShow(lbI - 1);
    else if (e.key === "ArrowRight") lbShow(lbI + 1);
    else if (e.key === "Tab") {
      const f = $$("button", lb), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ------------------------------------------------------------ sfx chips */
  $$("[data-sfx]").forEach((b) => b.addEventListener("click", () => sfx(b.dataset.sfx)));

  /* ------------------------------------------------------------ web demo: Sky Practice */
  guard("demo", () => {
    const cvs = $("#demoCanvas"), g = cvs.getContext("2d");
    g.imageSmoothingEnabled = false;
    const W = 288, H = 512, GROUND = 400;
    const imgs = {};
    const names = ["background-day", "base", "pipe-green", "message", "gameover", "yellowbird-upflap", "yellowbird-midflap", "yellowbird-downflap", ...Array.from({ length: 10 }, (_, i) => String(i))];
    let loaded = 0;
    names.forEach((n) => { const im = new Image(); im.onload = () => { loaded++; }; im.src = `/assets/sprites/${n}.png`; imgs[n] = im; });
    let sound = false, best = 0, state = "ready", t0 = 0, visible = false, raf = 0, last = 0;
    try { best = +localStorage.getItem("hb-best") || 0; } catch { /* ignore */ }
    const bestEl = $("#demoBest"); bestEl.textContent = best;
    const bird = { x: 64, y: 240, v: 0, a: 0 };
    let pipes = [], score = 0, groundX = 0, flapT = 0;
    const GAP = 108, SPEED = 130, SPACING = 170, GRAV = 1500, FLAP = -430;

    function reset() { bird.y = 240; bird.v = 0; bird.a = 0; pipes = []; score = 0; state = "ready"; }
    function addPipe(x) { pipes.push({ x, top: 90 + Math.random() * 170, scored: false }); }
    function flap() {
      if (state === "dead") { if (performance.now() - t0 > 500) reset(); return; }
      if (state === "ready") { state = "play"; pipes = []; addPipe(W + 40); addPipe(W + 40 + SPACING); }
      bird.v = FLAP; if (sound) sfx("wing", 0.35);
    }
    function die() { state = "dead"; t0 = performance.now(); if (sound) { sfx("hit", 0.5); setTimeout(() => sfx("die", 0.5), 250); } if (score > best) { best = score; bestEl.textContent = best; try { localStorage.setItem("hb-best", best); } catch { /* ignore */ } } }
    function update(dt) {
      groundX = (groundX - SPEED * dt * (state === "dead" ? 0 : 1)) % 24;
      flapT += dt * (state === "dead" ? 0 : 10);
      if (state === "ready") { bird.y = 240 + Math.sin(performance.now() / 260) * 8; return; }
      bird.v += GRAV * dt; bird.y += bird.v * dt;
      bird.a = clamp(bird.v / 600, -0.45, 1.2);
      if (state === "dead") { if (bird.y > GROUND - 12) { bird.y = GROUND - 12; bird.v = 0; } return; }
      for (const p of pipes) p.x -= SPEED * dt;
      if (pipes[0].x < -60) pipes.shift();
      if (pipes[pipes.length - 1].x < W - SPACING + 30) addPipe(pipes[pipes.length - 1].x + SPACING);
      for (const p of pipes) {
        if (!p.scored && p.x + 52 < bird.x - 12) { p.scored = true; score++; if (sound) sfx("point", 0.4); }
        if (bird.x + 14 > p.x && bird.x - 14 < p.x + 52 && (bird.y - 10 < p.top || bird.y + 10 > p.top + GAP)) return die();
      }
      if (bird.y + 12 > GROUND) { bird.y = GROUND - 12; return die(); }
      if (bird.y < -20) bird.y = -20;
    }
    function drawNum(n, y) {
      const s = String(n), ws = [...s].map((d) => (d === "1" ? 16 : 24)), tw = ws.reduce((a, b) => a + b, 0);
      let x = (W - tw) / 2;
      [...s].forEach((d, i) => { g.drawImage(imgs[d], x, y); x += ws[i]; });
    }
    function draw() {
      if (loaded < names.length) { g.fillStyle = "#4ec0ca"; g.fillRect(0, 0, W, H); return; }
      g.drawImage(imgs["background-day"], 0, 0);
      for (const p of pipes) {
        g.save(); g.translate(p.x + 52, p.top); g.rotate(Math.PI); g.drawImage(imgs["pipe-green"], 0, 0); g.restore();
        g.drawImage(imgs["pipe-green"], p.x, p.top + GAP);
      }
      g.drawImage(imgs.base, groundX, GROUND); g.drawImage(imgs.base, groundX + 336, GROUND);
      const f = ["upflap", "midflap", "downflap", "midflap"][Math.floor(flapT) % 4];
      g.save(); g.translate(bird.x, bird.y); g.rotate(bird.a); g.drawImage(imgs["yellowbird-" + f], -17, -12); g.restore();
      if (state === "ready") g.drawImage(imgs.message, 52, 60);
      if (state !== "ready") drawNum(score, 40);
      if (state === "dead") g.drawImage(imgs.gameover, 48, 190);
    }
    function loop(ts) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min((ts - last) / 1000 || 0.016, 0.034);
      last = ts;
      update(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function run() { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) run(); else if (state === "play") state = "ready", reset(); }, { threshold: 0.2 }).observe(cvs);
    cvs.addEventListener("pointerdown", (e) => { e.preventDefault(); cvs.focus({ preventScroll: true }); flap(); });
    cvs.addEventListener("keydown", (e) => { if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); flap(); } });
    $("#demoStart").addEventListener("click", () => { cvs.focus({ preventScroll: true }); if (state === "dead") reset(); if (state === "ready") flap(); });
    const sb = $("#demoSound");
    sb.addEventListener("click", () => { sound = !sound; sb.setAttribute("aria-pressed", String(sound)); sb.textContent = "SOUND: " + (sound ? "ON" : "OFF"); if (sound) sfx("point", 0.3); });
    draw();
  });

  /* ------------------------------------------------------------ release centre */
  const dlApp = $("#dlApp"), histWrap = $("#histWrap"), histEl = $("#hist");
  let selPlatform = null, data = null;

  const factRow = (k, v, cls) => h("div", { class: "fact" }, h("dt", { text: k }), h("dd", { class: cls || "", text: v }));

  function setVersionLabels(latest) {
    const v = latest ? "v" + latest.version : "v—";
    $("#heroVersion").textContent = v;
    $("#footVersion").textContent = latest ? `Latest version ${v}` : "Latest version unavailable";
  }

  function renderError(err) {
    setVersionLabels(null);
    histWrap.hidden = true;
    dlApp.replaceChildren(
      h("div", { class: "state state--err glass" },
        h("strong", { text: "We couldn't load the live release list." }),
        h("span", { text: (err && err.message) || "Unknown error." }),
        h("div", {}, h("button", { class: "btn btn--sm btn--cyan", onclick: () => loadReleases() }, "TRY AGAIN")),
        h("p", { class: "dl-help", text: `Last known build (v${FALLBACK.version}) — this may not be the newest version:` }),
        h("div", { class: "dl-row" }, dlButton("exe", FALLBACK.downloads.exe, FALLBACK.version), dlButton("zip", FALLBACK.downloads.zip, FALLBACK.version)),
        h("p", { class: "dl-help" }, "Or browse every build on ", h("a", { href: REPO + "/releases", target: "_blank", rel: "noopener" }, "GitHub Releases"), ".")));
  }

  function groupVisible(releases, platforms) {
    // Only platforms the admin explicitly published are shown. If the platform list is
    // unavailable we fall back to Windows (the one officially supported platform).
    const pubNames = platforms ? platforms.map((p) => p.name) : ["Windows"];
    const groups = new Map(pubNames.map((n) => [n.toLowerCase(), { name: n, info: (platforms || []).find((p) => p.name === n) || null, list: [] }]));
    releases.forEach((r) => { const g = groups.get(r.platform.toLowerCase()); if (g) g.list.push(r); });
    return [...groups.values()].filter((g) => g.list.length);
  }

  function render() {
    const groups = groupVisible(data.releases, data.platforms);
    if (!groups.length) {
      setVersionLabels(null);
      histWrap.hidden = true;
      dlApp.replaceChildren(h("div", { class: "state glass" }, "No releases have been published yet. Check ", h("a", { href: REPO + "/releases", target: "_blank", rel: "noopener", style: "color:var(--cyan);margin:0 .3em" }, "GitHub Releases"), " for builds."));
      return;
    }
    if (!selPlatform || !groups.some((g) => g.name === selPlatform)) selPlatform = groups[0].name;
    const grp = groups.find((g) => g.name === selPlatform);
    const latest = grp.list[0];
    setVersionLabels(groups[0].list[0]);
    const windows = grp.name.toLowerCase() === "windows";

    const kids = [];
    if (groups.length > 1) {
      kids.push(h("div", { class: "tabs", role: "tablist", "aria-label": "Platform" }, groups.map((g) =>
        h("button", { class: "tab", role: "tab", "aria-selected": String(g.name === selPlatform), onclick: () => { selPlatform = g.name; render(); } }, g.name))));
    }
    kids.push(
      h("article", { class: "dlcard glass", "aria-label": `Download Happy Bird for ${grp.name}` },
        h("dl", { class: "dlcard__facts" },
          factRow("GAME", "Happy Bird"),
          factRow("LATEST VERSION", "v" + latest.version, "ver"),
          factRow("PLATFORM", grp.name),
          factRow("COMPATIBILITY", latest.compatibility),
          factRow("BUILD TYPE", windows ? "One universal Windows build" : `${grp.name} build`)),
        h("div", { class: "dlcard__get" },
          h("h3", { text: latest.title }),
          h("p", { text: latest.description || (grp.info && grp.info.description) || "" }),
          h("p", { class: "rel__meta" }, h("span", { text: "Released " + fmtDate(latest.releaseDate) })),
          h("div", { class: "dl-row" }, [dlButton("exe", latest.downloads.exe, latest.version), dlButton("zip", latest.downloads.zip, latest.version), ...(latest.extraDownloads || []).map((x) => dlButton(x.label, x.url, latest.version))]),
          h("p", { class: "dl-help" }, windows ? "One build for every supported Windows version — Windows 7 and later. " : "", "Download didn't start? ", h("a", { href: REPO + "/releases", target: "_blank", rel: "noopener" }, "Open the file on GitHub"), ".")),
        h("div", { class: "dlcard__new", style: "grid-column:1/-1;padding:0 clamp(1.4rem,3vw,2.4rem) clamp(1.4rem,3vw,2.4rem)" },
          h("h5", { class: "rel__sub", text: `WHAT'S NEW IN v${latest.version}` }),
          h("ul", { class: "changelog", style: "margin-top:.8rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));column-gap:2rem" }, latest.changelog.map((t) => h("li", { text: t })))))
    );
    dlApp.replaceChildren(...kids);

    histEl.replaceChildren(...grp.list.map((r, i) => {
      const d = h("details", { class: "hi" + (i === 0 ? " hi--latest" : "") },
        h("summary", {},
          h("span", { class: "hi__v", text: "v" + r.version }),
          i === 0 ? h("span", { class: "badge badge--new", text: "LATEST" }) : null,
          h("span", { class: "hi__d", text: fmtDate(r.releaseDate) }),
          h("span", { class: "hi__p", text: `${r.platform} · ${[r.downloads.exe && "EXE", r.downloads.zip && "ZIP"].filter(Boolean).join(" + ")}` })),
        h("div", { class: "hi__body" }, releaseCard(r, { latest: i === 0 })));
      if (i === 0) d.open = true;
      return d;
    }));
    histWrap.hidden = false;
  }

  async function loadReleases() {
    dlApp.replaceChildren(h("div", { class: "state glass" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading the latest release…"));
    try {
      const [rel, plat] = await Promise.all([api("/api/releases"), api("/api/platforms").catch(() => null)]);
      data = { releases: rel.releases, platforms: plat ? plat.platforms : null };
      render();
      if (HAS_GSAP) setTimeout(() => ScrollTrigger.refresh(), 60);
    } catch (e) {
      renderError(e);
    }
  }

  // Friendly confirmation when a download link is used (the link itself is a plain direct anchor).
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.dl[data-dl]");
    if (a) toast("Your download is starting… If nothing happens, check your browser's downloads.");
  });

  /* ------------------------------------------------------------ GitHub card (optional, fails quietly) */
  guard("github", () => {
    const cacheKey = "hb-gh";
    const apply = (d) => {
      if (d.description) $("#ghDesc").textContent = d.description;
      const stats = $("#ghStats");
      const rows = [["Stars", d.stargazers_count], ["Forks", d.forks_count], ["Issues", d.open_issues_count], ["Language", d.language], ["Updated", d.pushed_at ? new Date(d.pushed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null]].filter((r) => r[1] != null && r[1] !== "");
      if (!rows.length) return;
      stats.replaceChildren(...rows.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: String(v) }))));
      stats.hidden = false;
    };
    try { const c = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); if (c && Date.now() - c.t < 600000) { apply(c.d); return; } } catch { /* ignore */ }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 7000);
    fetch("https://api.github.com/repos/LGBTlaogiabacti/Happy-Bird", { signal: ctl.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("GitHub API " + r.status))))
      .then((d) => { apply(d); try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d })); } catch { /* ignore */ } })
      .catch(() => { /* rate-limited or offline: the static card is enough */ })
      .finally(() => clearTimeout(to));
  });

  $("#year").textContent = new Date().getFullYear();
  loadReleases();

  /* ------------------------------------------------------------ boot: loader -> intro */
  const loader = $("#loader");
  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    loader.classList.add("is-done");
    setTimeout(() => loader.remove(), 700);
    layout();
    if (HAS_GSAP) ScrollTrigger.refresh();
    introAnimations();
  }
  const minWait = new Promise((r) => setTimeout(r, REDUCED ? 100 : 900));
  const loaded = new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", r, { once: true })));
  const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  Promise.all([minWait, Promise.race([Promise.all([loaded, fontsReady]), new Promise((r) => setTimeout(r, 2200))])]).then(boot);
  setTimeout(boot, 3500); // absolute safety net
})();
