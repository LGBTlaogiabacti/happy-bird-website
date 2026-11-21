// Shared helpers for all Happy Bird Netlify Functions.
// Contains: storage, seeding, validation, semver sorting, signed sessions, rate limiting.
import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/* Storage (Netlify Blobs)                                             */
/* ------------------------------------------------------------------ */

let storeFactory = null;
/** Test / local-dev hook: inject a store with get(key,{type:'json'}) and setJSON(key,value). */
export function setStoreFactory(fn) {
  storeFactory = fn;
}

export async function getDb(name = "happybird") {
  if (storeFactory) return storeFactory(name);
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name, consistency: "strong" });
}

export const SEED_RELEASE_DOWNLOADS = {
  exe: "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.exe",
  zip: "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.zip",
};

function seedReleases() {
  const now = new Date().toISOString();
  return [
    {
      id: "seed-1-2-0",
      version: "1.2.0",
      title: "Happy Bird 1.2.0",
      releaseDate: "2026-11-20",
      platform: "Windows",
      compatibility: "Windows 7 and later",
      description: "The current stable build of Happy Bird for Windows.",
      downloads: { ...SEED_RELEASE_DOWNLOADS },
      extraDownloads: [],
      changelog: [
        "Current stable build of Happy Bird.",
        "One universal Windows build — Windows 7 and later.",
      ],
      status: "published",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedPlatforms() {
  const now = new Date().toISOString();
  return [
    {
      id: "seed-windows",
      name: "Windows",
      compatibility: "Windows 7 and later",
      description: "One universal Windows build that runs on every supported Windows version.",
      supportedVersion: "1.2.0",
      downloadAvailable: true,
      formats: ["EXE", "ZIP"],
      status: "published",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Reads a collection; initialises it with seed data on first use. */
async function readCollection(key, seed) {
  const db = await getDb();
  let data = await db.get(key, { type: "json" });
  if (!Array.isArray(data)) {
    data = seed();
    await db.setJSON(key, data);
  }
  return data;
}
async function writeCollection(key, data) {
  const db = await getDb();
  await db.setJSON(key, data);
}
export const readReleases = () => readCollection("releases", seedReleases);
export const writeReleases = (d) => writeCollection("releases", d);
export const readPlatforms = () => readCollection("platforms", seedPlatforms);
export const writePlatforms = (d) => writeCollection("platforms", d);

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
export const fail = (status, message, extra = {}) => json({ ok: false, error: message, ...extra }, status);

export async function readBody(req) {
  const text = await req.text();
  if (text.length > 100_000) throw new HttpError(413, "Request body too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Wraps a handler so thrown HttpErrors / storage failures become tidy JSON errors. */
export function safe(handler) {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
      console.error("Function error:", err);
      return fail(500, "Server error. The storage backend may be unavailable — please try again.");
    }
  };
}

export function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/* ------------------------------------------------------------------ */
/* Authentication — signed, expiring session tokens in an HttpOnly cookie */
/* ------------------------------------------------------------------ */

export const COOKIE_NAME = "hb_session";
export const SESSION_SECONDS = 60 * 60 * 8; // 8 hours

function b64u(buf) {
  return Buffer.from(buf).toString("base64url");
}

/** The signing key is derived from SESSION_SECRET (if set) or ADMIN_PASSWORD.
 *  Changing either one instantly invalidates every existing session. */
function signingKey() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new HttpError(503, "Administrator access is not configured. Set the ADMIN_PASSWORD environment variable in Netlify.");
  const base = process.env.SESSION_SECRET || pw;
  return crypto.createHmac("sha256", "happybird-session-key-v1").update(base).digest();
}

export function verifyPassword(candidate) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new HttpError(503, "Administrator access is not configured. Set the ADMIN_PASSWORD environment variable in Netlify.");
  const a = crypto.createHash("sha256").update(String(candidate ?? "")).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createToken(now = Date.now()) {
  const payload = { iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_SECONDS, sid: crypto.randomUUID() };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac("sha256", signingKey()).update(body).digest());
  return { token: `${body}.${sig}`, payload };
}

export function verifyToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", signingKey()).update(body).digest();
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(token, req, maxAge = SESSION_SECONDS) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** Returns the session payload or null. */
export function getSession(req) {
  const token = parseCookies(req.headers.get("cookie"))[COOKIE_NAME];
  return token ? verifyToken(token) : null;
}

/** Throws 401 unless the request carries a valid session. Also blocks cross-site writes. */
export function requireAdmin(req) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "Cross-origin request blocked.");
  }
  const session = getSession(req);
  if (!session) throw new HttpError(401, "Your session has expired or is invalid. Please sign in again.", { code: "unauthorized" });
  return session;
}

/* ------------------------------------------------------------------ */
/* Login rate limiting (persistent, per hashed IP)                      */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const rlKey = (ip) => "ip-" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);

export async function checkRateLimit(ip) {
  const db = await getDb("happybird-ratelimit");
  const rec = await db.get(rlKey(ip), { type: "json" });
  if (rec && Date.now() - rec.first < WINDOW_MS && rec.count >= MAX_FAILS) {
    const retry = Math.ceil((rec.first + WINDOW_MS - Date.now()) / 1000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`, { retryAfter: retry });
  }
}
export async function recordFailure(ip) {
  const db = await getDb("happybird-ratelimit");
  const k = rlKey(ip);
  let rec = await db.get(k, { type: "json" });
  if (!rec || Date.now() - rec.first >= WINDOW_MS) rec = { first: Date.now(), count: 0 };
  rec.count += 1;
  await db.setJSON(k, rec);
  return MAX_FAILS - rec.count;
}
export async function clearFailures(ip) {
  const db = await getDb("happybird-ratelimit");
  await db.setJSON(rlKey(ip), { first: Date.now(), count: 0 });
}

/* ------------------------------------------------------------------ */
/* Semantic version helpers                                            */
/* ------------------------------------------------------------------ */

export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

export function compareVersions(a, b) {
  const [ca, pa = ""] = String(a).split("-");
  const [cb, pb = ""] = String(b).split("-");
  const na = ca.split(".").map(Number);
  const nb = cb.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
  }
  if (pa === pb) return 0;
  if (!pa) return 1; // 1.0.0 > 1.0.0-beta
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}
/** Newest first. Ties on version fall back to release date. */
export const sortReleases = (list) =>
  [...list].sort((x, y) => compareVersions(y.version, x.version) || String(y.releaseDate).localeCompare(String(x.releaseDate)));

/* ------------------------------------------------------------------ */
/* Validation & sanitising                                             */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-control-regex
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanMultiline = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

function validUrl(raw, ext) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return "is not a valid URL";
  }
  if (!["http:", "https:"].includes(u.protocol)) return "must start with http:// or https://";
  if (ext && !u.pathname.toLowerCase().endsWith(ext)) return `must point to a ${ext} file`;
  return null;
}

/** Validates + normalises a release payload. Returns { value, errors }. */
export function validateRelease(input, { existing = [], selfId = null, platforms = [] } = {}) {
  const errors = {};
  const v = {
    version: clean(input.version, 40).replace(/^v/i, ""),
    title: clean(input.title, 120),
    releaseDate: clean(input.releaseDate, 10),
    platform: clean(input.platform || "Windows", 60),
    compatibility: clean(input.compatibility, 120),
    description: clean(input.description, 500),
    downloads: {
      exe: clean(input.downloads?.exe, 600),
      zip: clean(input.downloads?.zip, 600),
    },
    extraDownloads: [],
    changelog: [],
    status: input.status === "published" ? "published" : "draft",
  };

  if (!v.version) errors.version = "Version number is required.";
  else if (!VERSION_RE.test(v.version)) errors.version = "Use a version like 1.3.0 (optionally 1.3.0-beta.1).";
  else if (existing.some((r) => r.id !== selfId && r.platform.toLowerCase() === v.platform.toLowerCase() && r.version.toLowerCase() === v.version.toLowerCase()))
    errors.version = `Version ${v.version} already exists for ${v.platform}.`;

  if (!v.title) errors.title = "Release title is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.releaseDate) || Number.isNaN(Date.parse(v.releaseDate))) errors.releaseDate = "Release date is required (YYYY-MM-DD).";
  if (!v.description) errors.description = "Short description is required.";
  if (!v.platform) errors.platform = "Platform is required.";
  else if (platforms.length && !platforms.some((p) => p.name.toLowerCase() === v.platform.toLowerCase()))
    errors.platform = `Platform “${v.platform}” has not been added yet (see /new/base).`;
  if (!v.compatibility) {
    const p = platforms.find((p) => p.name.toLowerCase() === v.platform.toLowerCase());
    v.compatibility = p?.compatibility || "";
  }
  if (!v.compatibility) errors.compatibility = "Compatibility text is required.";

  for (const [key, ext] of [["exe", ".exe"], ["zip", ".zip"]]) {
    if (v.downloads[key]) {
      const e = validUrl(v.downloads[key], ext);
      if (e) errors[`downloads.${key}`] = `${key.toUpperCase()} URL ${e}.`;
    }
  }

  const extras = Array.isArray(input.extraDownloads) ? input.extraDownloads.slice(0, 10) : [];
  extras.forEach((x, i) => {
    const label = clean(x?.label, 40);
    const url = clean(x?.url, 600);
    if (!label && !url) return;
    if (!label) errors[`extraDownloads.${i}`] = "Extra download needs a label.";
    else {
      const e = validUrl(url);
      if (e) errors[`extraDownloads.${i}`] = `Extra download URL ${e}.`;
    }
    v.extraDownloads.push({ label, url });
  });

  const log = Array.isArray(input.changelog) ? input.changelog : [];
  v.changelog = log.map((s) => clean(s, 300)).filter(Boolean).slice(0, 60);
  if (v.status === "published" && v.changelog.length === 0) errors.changelog = "Add at least one changelog entry before publishing.";

  if (v.status === "published") {
    const isWindows = v.platform.toLowerCase() === "windows";
    const hasAny = v.downloads.exe || v.downloads.zip || v.extraDownloads.length;
    if (isWindows) {
      if (!v.downloads.exe) errors["downloads.exe"] ||= "EXE download URL is required to publish.";
      if (!v.downloads.zip) errors["downloads.zip"] ||= "ZIP download URL is required to publish.";
    } else if (!hasAny) errors["downloads.exe"] ||= "Add at least one download link to publish.";
  }
  return { value: v, errors };
}

export function validatePlatform(input, { existing = [], selfId = null } = {}) {
  const errors = {};
  const v = {
    name: clean(input.name, 60),
    compatibility: clean(input.compatibility, 160),
    description: clean(input.description, 500),
    supportedVersion: clean(input.supportedVersion, 40).replace(/^v/i, ""),
    downloadAvailable: input.downloadAvailable === true,
    formats: (Array.isArray(input.formats) ? input.formats : String(input.formats || "").split(","))
      .map((f) => clean(f, 20).toUpperCase())
      .filter(Boolean)
      .filter((f, i, a) => a.indexOf(f) === i)
      .slice(0, 8),
    status: input.status === "published" ? "published" : "draft",
  };
  if (!v.name) errors.name = "Platform name is required.";
  else if (existing.some((p) => p.id !== selfId && p.name.toLowerCase() === v.name.toLowerCase())) errors.name = `Platform “${v.name}” already exists.`;
  if (!v.compatibility) errors.compatibility = "Compatibility information is required.";
  if (!v.description) errors.description = "Description is required.";
  if (v.supportedVersion && !VERSION_RE.test(v.supportedVersion)) errors.supportedVersion = "Use a version like 1.2.0.";
  if (v.status === "published" && v.downloadAvailable && v.formats.length === 0) errors.formats = "List at least one download format (e.g. EXE, ZIP) or mark downloads as unavailable.";
  return { value: v, errors };
}
