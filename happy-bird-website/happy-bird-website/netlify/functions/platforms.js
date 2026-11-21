import crypto from "node:crypto";
// GET    /api/platforms            public: published platforms only
// GET    /api/platforms?all=1      admin : all platforms
// POST   /api/platforms            admin : create
// PUT    /api/platforms/:id        admin : update
// DELETE /api/platforms/:id        admin : delete (blocked while releases reference it)
import {
  safe, json, fail, readBody, requireAdmin, readPlatforms, writePlatforms, readReleases,
  validatePlatform, HttpError,
} from "./_lib.js";

export const config = { path: ["/api/platforms", "/api/platforms/*"] };

export default safe(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/");
  const id = parts[3] ? decodeURIComponent(parts[3]) : null;

  if (req.method === "GET") {
    const all = await readPlatforms();
    if (url.searchParams.get("all") === "1") {
      requireAdmin(req);
      return json({ ok: true, platforms: all });
    }
    return json({ ok: true, platforms: all.filter((p) => p.status === "published") }, 200, { "cache-control": "no-cache, must-revalidate" });
  }

  requireAdmin(req);
  const platforms = await readPlatforms();

  if (req.method === "POST" && !id) {
    const { value, errors } = validatePlatform(await readBody(req), { existing: platforms });
    if (Object.keys(errors).length) return fail(422, "Please fix the highlighted fields.", { fields: errors });
    const now = new Date().toISOString();
    const platform = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
    await writePlatforms([...platforms, platform]);
    return json({ ok: true, platform }, 201);
  }

  if (req.method === "PUT" && id) {
    const current = platforms.find((p) => p.id === id);
    if (!current) throw new HttpError(404, "Platform not found.");
    const { value, errors } = validatePlatform(await readBody(req), { existing: platforms, selfId: id });
    if (Object.keys(errors).length) return fail(422, "Please fix the highlighted fields.", { fields: errors });
    // Renaming would orphan releases that reference the old name.
    if (value.name.toLowerCase() !== current.name.toLowerCase()) {
      const used = (await readReleases()).some((r) => r.platform.toLowerCase() === current.name.toLowerCase());
      if (used) return fail(409, `Cannot rename “${current.name}” while releases use it.`, { fields: { name: "Platform is used by existing releases." } });
    }
    const updated = { ...current, ...value, id, updatedAt: new Date().toISOString() };
    await writePlatforms(platforms.map((p) => (p.id === id ? updated : p)));
    return json({ ok: true, platform: updated });
  }

  if (req.method === "DELETE" && id) {
    const current = platforms.find((p) => p.id === id);
    if (!current) throw new HttpError(404, "Platform not found.");
    const used = (await readReleases()).some((r) => r.platform.toLowerCase() === current.name.toLowerCase());
    if (used) return fail(409, `“${current.name}” still has releases. Delete or move them first — or set the platform to Draft to hide it.`);
    await writePlatforms(platforms.filter((p) => p.id !== id));
    return json({ ok: true });
  }

  return fail(405, "Method not allowed.");
});
