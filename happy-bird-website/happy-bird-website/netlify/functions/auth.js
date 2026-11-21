// POST /api/auth/login   { password }  -> sets signed HttpOnly session cookie
// POST /api/auth/logout                -> clears cookie
// GET  /api/auth/session               -> { authenticated, expiresAt }
import {
  safe, json, fail, readBody, clientIp, verifyPassword, createToken, sessionCookie,
  getSession, checkRateLimit, recordFailure, clearFailures, HttpError,
} from "./_lib.js";

export const config = { path: "/api/auth/*" };

export default safe(async (req, context) => {
  const action = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();

  if (action === "session" && req.method === "GET") {
    const s = getSession(req);
    return json({ ok: true, authenticated: !!s, expiresAt: s ? s.exp * 1000 : null });
  }

  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  if (action === "login" && req.method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "Cross-origin request blocked.");
    const ip = clientIp(req, context);
    await checkRateLimit(ip);
    const body = await readBody(req);
    if (!verifyPassword(typeof body.password === "string" ? body.password.slice(0, 200) : "")) {
      const left = await recordFailure(ip);
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      return fail(401, left > 0 ? `Incorrect password. ${left} attempt(s) left before a temporary lockout.` : "Incorrect password. Too many attempts — locked out for 15 minutes.", { code: "bad_password" });
    }
    await clearFailures(ip);
    const { token, payload } = createToken();
    return json({ ok: true, expiresAt: payload.exp * 1000 }, 200, { "set-cookie": sessionCookie(token, req) });
  }

  return fail(404, "Unknown auth action.");
});
