// Backend test-suite: exercises the real function handlers end-to-end (no network).
import assert from "node:assert/strict";
import { setStoreFactory, createToken, verifyToken, compareVersions, sortReleases } from "../netlify/functions/_lib.js";
import { memoryStoreFactory } from "./memory-store.mjs";
import auth from "../netlify/functions/auth.js";
import releases from "../netlify/functions/releases.js";
import platforms from "../netlify/functions/platforms.js";

process.env.ADMIN_PASSWORD = "test-password-123";
setStoreFactory(memoryStoreFactory());

const BASE = "https://hb.example";
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };
const call = (h, method, path, { body, cookie, origin, ip = "1.1.1.1" } = {}) =>
  h(new Request(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), { ip });
const j = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });
const login = async (ip = "9.9.9.9", pw = process.env.ADMIN_PASSWORD) => {
  const r = await j(await call(auth, "POST", "/api/auth/login", { body: { password: pw }, ip }));
  return r;
};
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

const goodRelease = (o = {}) => ({
  version: "1.3.0", title: "Happy Bird 1.3.0", releaseDate: "2026-12-01", platform: "Windows",
  description: "Bigger update.", compatibility: "Windows 7 and later",
  downloads: { exe: "https://github.com/x/y/releases/download/r/v1.3.0.exe", zip: "https://github.com/x/y/releases/download/r/v1.3.0.zip" },
  changelog: ["Added new features.", "Improved performance."], status: "published", ...o,
});

console.log("Auth");
let cookie;
await t("rejects wrong password", async () => {
  const r = await login("2.2.2.2", "nope");
  assert.equal(r.status, 401);
  assert.ok(!JSON.stringify(r.body).includes(process.env.ADMIN_PASSWORD));
});
await t("accepts right password, sets HttpOnly SameSite=Strict cookie", async () => {
  const r = await login();
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/);
  assert.ok(!sc.includes(process.env.ADMIN_PASSWORD));
  cookie = cookieOf(r);
});
await t("session endpoint reports authenticated", async () => {
  const r = await j(await call(auth, "GET", "/api/auth/session", { cookie }));
  assert.equal(r.body.authenticated, true);
  const r2 = await j(await call(auth, "GET", "/api/auth/session"));
  assert.equal(r2.body.authenticated, false);
});
await t("rate limit locks out after 5 failures", async () => {
  for (let i = 0; i < 5; i++) await login("7.7.7.7", "bad");
  const r = await login("7.7.7.7", process.env.ADMIN_PASSWORD);
  assert.equal(r.status, 429);
  const other = await login("8.8.8.8");
  assert.equal(other.status, 200);
});
await t("tampered / expired / garbage tokens rejected", async () => {
  const { token } = createToken();
  assert.ok(verifyToken(token));
  const [b, s] = token.split(".");
  assert.equal(verifyToken(b + "." + s.slice(0, -2) + "AA"), null);
  assert.equal(verifyToken(Buffer.from('{"exp":9999999999}').toString("base64url") + "." + s), null);
  assert.equal(verifyToken(createToken(Date.now() - 9 * 3600 * 1000).token), null);
  assert.equal(verifyToken("a.b.c"), null);
  assert.equal(verifyToken(""), null);
});
await t("changing ADMIN_PASSWORD invalidates old sessions", async () => {
  const old = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "different-password";
  const r = await j(await call(auth, "GET", "/api/auth/session", { cookie }));
  assert.equal(r.body.authenticated, false);
  process.env.ADMIN_PASSWORD = old;
});
await t("503 when ADMIN_PASSWORD is not configured", async () => {
  const old = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  const r = await j(await call(auth, "POST", "/api/auth/login", { body: { password: "x" }, ip: "5.5.5.5" }));
  assert.equal(r.status, 503);
  process.env.ADMIN_PASSWORD = old;
});
await t("logout clears the cookie", async () => {
  const r = await call(auth, "POST", "/api/auth/logout", { cookie });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});

console.log("Releases — public");
await t("empty DB is seeded with v1.2.0 and the two supplied URLs", async () => {
  const r = await j(await call(releases, "GET", "/api/releases"));
  assert.equal(r.body.releases.length, 1);
  assert.equal(r.body.latest.version, "1.2.0");
  assert.equal(r.body.latest.downloads.exe, "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.exe");
  assert.equal(r.body.latest.downloads.zip, "https://github.com/LGBTlaogiabacti/Happy-Bird/releases/download/releases/v1.2.0.zip");
});
await t("public cannot write or read drafts", async () => {
  assert.equal((await call(releases, "POST", "/api/releases", { body: goodRelease() })).status, 401);
  assert.equal((await call(releases, "GET", "/api/releases?all=1")).status, 401);
  assert.equal((await call(releases, "DELETE", "/api/releases/seed-1-2-0")).status, 401);
  assert.equal((await call(platforms, "POST", "/api/platforms", { body: {} })).status, 401);
});
await t("cross-origin write is blocked even with a valid cookie", async () => {
  const r = await call(releases, "POST", "/api/releases", { body: goodRelease(), cookie, origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

console.log("Releases — admin CRUD");
cookie = cookieOf(await login("3.3.3.3"));
let created;
await t("create valid release", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { body: goodRelease(), cookie }));
  assert.equal(r.status, 201); created = r.body.release;
  assert.ok(created.id);
});
await t("duplicate version rejected", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { body: goodRelease(), cookie }));
  assert.equal(r.status, 422); assert.ok(r.body.fields.version);
});
await t("v prefix is normalised and still counts as duplicate", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { body: goodRelease({ version: "v1.3.0" }), cookie }));
  assert.equal(r.status, 422);
});
await t("validation: bad version, bad urls, wrong extension, missing links, no changelog", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({
    version: "abc", releaseDate: "nope", title: "", description: "",
    downloads: { exe: "javascript:alert(1)", zip: "https://x.y/file.exe" }, changelog: [] }) }));
  assert.equal(r.status, 422);
  for (const k of ["version", "releaseDate", "title", "description", "downloads.exe", "downloads.zip", "changelog"]) assert.ok(r.body.fields[k], "missing error for " + k);
  const r2 = await j(await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "1.4.0", downloads: { exe: "", zip: "" } }) }));
  assert.ok(r2.body.fields["downloads.exe"] && r2.body.fields["downloads.zip"]);
});
await t("drafts may be incomplete and are hidden from the public", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "1.4.0", status: "draft", downloads: { exe: "", zip: "" }, changelog: [] }) }));
  assert.equal(r.status, 201);
  const pub = await j(await call(releases, "GET", "/api/releases"));
  assert.ok(!pub.body.releases.some((x) => x.version === "1.4.0"));
  const adm = await j(await call(releases, "GET", "/api/releases?all=1", { cookie }));
  assert.ok(adm.body.releases.some((x) => x.version === "1.4.0"));
});
await t("published release becomes latest immediately for everyone", async () => {
  const pub = await j(await call(releases, "GET", "/api/releases"));
  assert.equal(pub.body.latest.version, "1.3.0");
  assert.equal(pub.body.releases.length, 2);
});
await t("semantic sorting (1.10.0 > 1.9.0 > 1.2.0)", async () => {
  await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "1.10.0" }) });
  await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "1.9.0" }) });
  const pub = await j(await call(releases, "GET", "/api/releases"));
  assert.deepEqual(pub.body.releases.map((r) => r.version), ["1.10.0", "1.9.0", "1.3.0", "1.2.0"]);
  assert.ok(compareVersions("1.0.0", "1.0.0-beta") > 0);
  assert.deepEqual(sortReleases([{version:"2.0.0"},{version:"10.0.0"}]).map(x=>x.version), ["10.0.0","2.0.0"]);
});
await t("edit replaces URLs / changelog and is reflected publicly", async () => {
  const body = goodRelease({ version: "1.3.0", description: "Edited!", downloads: { exe: "https://example.com/new.exe", zip: "https://example.com/new.zip" }, changelog: ["Only one entry"] });
  const r = await j(await call(releases, "PUT", `/api/releases/${created.id}`, { cookie, body }));
  assert.equal(r.status, 200);
  const pub = await j(await call(releases, "GET", "/api/releases"));
  const x = pub.body.releases.find((r) => r.version === "1.3.0");
  assert.equal(x.description, "Edited!"); assert.equal(x.downloads.exe, "https://example.com/new.exe"); assert.deepEqual(x.changelog, ["Only one entry"]);
});
await t("edit may keep own version but not collide with another", async () => {
  const r = await j(await call(releases, "PUT", `/api/releases/${created.id}`, { cookie, body: goodRelease({ version: "1.9.0" }) }));
  assert.equal(r.status, 422);
});
await t("unpublishing hides a release", async () => {
  await call(releases, "PUT", `/api/releases/${created.id}`, { cookie, body: goodRelease({ status: "draft" }) });
  const pub = await j(await call(releases, "GET", "/api/releases"));
  assert.ok(!pub.body.releases.some((r) => r.version === "1.3.0"));
});
await t("delete works and 404s afterwards", async () => {
  assert.equal((await call(releases, "DELETE", `/api/releases/${created.id}`, { cookie })).status, 200);
  assert.equal((await call(releases, "DELETE", `/api/releases/${created.id}`, { cookie })).status, 404);
});
await t("HTML in text fields is stored as plain text (frontend renders via textContent)", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "2.0.0", title: "<img src=x onerror=alert(1)>" }) }));
  assert.equal(r.status, 201); // stored verbatim as text; never injected as HTML
});

console.log("Platforms");
let plat;
await t("public sees only Windows by default", async () => {
  const r = await j(await call(platforms, "GET", "/api/platforms"));
  assert.deepEqual(r.body.platforms.map((p) => p.name), ["Windows"]);
  assert.equal(r.body.platforms[0].compatibility, "Windows 7 and later");
});
await t("add Linux as draft: not public; publish: public", async () => {
  const body = { name: "Linux", compatibility: "Ubuntu 22.04+", description: "Coming soon", supportedVersion: "1.2.0", downloadAvailable: true, formats: "AppImage, TAR.GZ", status: "draft" };
  const r = await j(await call(platforms, "POST", "/api/platforms", { cookie, body }));
  assert.equal(r.status, 201); plat = r.body.platform;
  assert.deepEqual(plat.formats, ["APPIMAGE", "TAR.GZ"]);
  assert.ok(!(await j(await call(platforms, "GET", "/api/platforms"))).body.platforms.some((p) => p.name === "Linux"));
  await call(platforms, "PUT", `/api/platforms/${plat.id}`, { cookie, body: { ...body, status: "published" } });
  assert.ok((await j(await call(platforms, "GET", "/api/platforms"))).body.platforms.some((p) => p.name === "Linux"));
});
await t("duplicate platform + invalid input rejected", async () => {
  const r = await j(await call(platforms, "POST", "/api/platforms", { cookie, body: { name: "linux", compatibility: "x", description: "y" } }));
  assert.equal(r.status, 422);
  const r2 = await j(await call(platforms, "POST", "/api/platforms", { cookie, body: { name: "" } }));
  assert.ok(r2.body.fields.name && r2.body.fields.compatibility && r2.body.fields.description);
});
await t("release for an unknown platform is rejected; platform in use cannot be deleted", async () => {
  const r = await j(await call(releases, "POST", "/api/releases", { cookie, body: goodRelease({ version: "3.0.0", platform: "Amiga" }) }));
  assert.ok(r.body.fields.platform);
  const win = (await j(await call(platforms, "GET", "/api/platforms?all=1", { cookie }))).body.platforms.find((p) => p.name === "Windows");
  assert.equal((await call(platforms, "DELETE", `/api/platforms/${win.id}`, { cookie })).status, 409);
});
await t("unused platform can be deleted", async () => {
  assert.equal((await call(platforms, "DELETE", `/api/platforms/${plat.id}`, { cookie })).status, 200);
});
await t("storage failure returns a clean 500 (not a stack trace)", async () => {
  setStoreFactory(() => ({ async get() { throw new Error("blob outage"); }, async setJSON() { throw new Error("blob outage"); } }));
  const r = await j(await call(releases, "GET", "/api/releases"));
  assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.body).includes("blob outage"));
});

console.log(`\nAll ${passed} backend tests passed.`);
