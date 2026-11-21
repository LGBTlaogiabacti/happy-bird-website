import crypto from "node:crypto";
// GET    /api/releases            public: published releases only (newest first) + latest
// GET    /api/releases?all=1      admin : every release incl. drafts
// POST   /api/releases            admin : create
// PUT    /api/releases/:id        admin : update
// DELETE /api/releases/:id        admin : delete
import {
  safe, json, fail, readBody, requireAdmin, getSession, readReleases, writeReleases, readPlatforms,
  validateRelease, sortReleases, HttpError,
} from "./_lib.js";

export const config = { path: ["/api/releases", "/api/releases/*"] };

export default safe(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/"); // ['', 'api', 'releases', id?]
  const id = parts[3] ? decodeURIComponent(parts[3]) : null;

  if (req.method === "GET") {
    const all = await readReleases();
    if (url.searchParams.get("all") === "1") {
      requireAdmin(req);
      return json({ ok: true, releases: sortReleases(all) });
    }
    const releases = sortReleases(all.filter((r) => r.status === "published"));
    return json({ ok: true, releases, latest: releases[0] || null, generatedAt: new Date().toISOString() }, 200, {
      "cache-control": "no-cache, must-revalidate",
    });
  }

  requireAdmin(req);
  const releases = await readReleases();
  const platforms = await readPlatforms();

  if (req.method === "POST" && !id) {
    const { value, errors } = validateRelease(await readBody(req), { existing: releases, platforms });
    if (Object.keys(errors).length) return fail(422, "Please fix the highlighted fields.", { fields: errors });
    const now = new Date().toISOString();
    const release = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
    await writeReleases([...releases, release]);
    return json({ ok: true, release }, 201);
  }

  if (req.method === "PUT" && id) {
    const current = releases.find((r) => r.id === id);
    if (!current) throw new HttpError(404, "Release not found.");
    const { value, errors } = validateRelease(await readBody(req), { existing: releases, selfId: id, platforms });
    if (Object.keys(errors).length) return fail(422, "Please fix the highlighted fields.", { fields: errors });
    const updated = { ...current, ...value, id, updatedAt: new Date().toISOString() };
    await writeReleases(releases.map((r) => (r.id === id ? updated : r)));
    return json({ ok: true, release: updated });
  }

  if (req.method === "DELETE" && id) {
    if (!releases.some((r) => r.id === id)) throw new HttpError(404, "Release not found.");
    await writeReleases(releases.filter((r) => r.id !== id));
    return json({ ok: true });
  }

  return fail(405, "Method not allowed.");
});
