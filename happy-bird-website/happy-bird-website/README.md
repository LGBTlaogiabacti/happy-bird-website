# Happy Bird — Official Website

Immersive, scroll-driven showcase + download center for **Happy Bird**, with a hidden, password-protected
release/platform manager. Static frontend + Netlify Functions + Netlify Blobs. No server, no VPS.

Repo: https://github.com/LGBTlaogiabacti/Happy-Bird

## Deploy to Netlify (5 minutes)
1. Push this folder to a Git repo (or drag-and-drop the folder in Netlify → *Add new site*).
2. Build settings are already in `netlify.toml` (publish `public`, functions `netlify/functions`). No build command needed.
3. **Site configuration → Environment variables** → add:
   | Name | Value |
   |---|---|
   | `ADMIN_PASSWORD` | your admin password (initial value you chose: `24032014` — change it!) |
   | `SESSION_SECRET` *(optional)* | any long random string; if unset, the session key is derived from `ADMIN_PASSWORD` |
4. Deploy. Open `https://<your-site>.netlify.app/`.

**Changing the password:** edit `ADMIN_PASSWORD` in Netlify → redeploy. All existing sessions are invalidated automatically.
The password never appears in any frontend file; it is only read by the server functions.

## Hidden admin
- `/new/releases` — release manager (add / edit / delete / preview, changelog editor, drafts)
- `/new/base` — platform manager (add future platforms; shown publicly only when *Published*)

There is no link to either route anywhere on the public site. Security does not rely on the URL being secret:
all `/api` writes require a signed, expiring (8h) HttpOnly session cookie; login is rate-limited (5 failures / 15 min / IP);
every payload is validated and sanitised on the server; drafts are never returned by the public API.

## Storage
Releases and platforms live in **Netlify Blobs** (store `happybird`), so they survive refreshes, logouts, restarts and new deploys.
On first request the store is seeded with v1.2.0 (EXE + ZIP direct URLs) and the Windows platform
("Windows 7 and later", one universal build) — the site works before you add anything.

## Adding a release
1. Create the GitHub Release/asset first.
2. `/new/releases` → **New release**. Enter version (e.g. `1.3.0`), date, title, description, the **exact** EXE and ZIP asset URLs,
   changelog entries (Enter = new line, paste a bullet list to split it), status **Published**.
3. Publish. Visitors see it immediately: hero version, download center, version history (sorted semantically: 1.10.0 > 1.9.0).

Validation: semver format, required fields, http(s) URLs ending `.exe` / `.zip`, both links required for Windows,
duplicate versions blocked, ≥1 changelog entry to publish.

## Behaviour notes
- Download buttons are plain direct links to the GitHub asset URLs (verified: they 302 to a GitHub attachment download).
- If `/api/releases` fails, the site says so, offers *Try again*, and shows the v1.2.0 links clearly labelled "last known build".
- The GitHub stats card uses the public GitHub API from the browser (no token) and silently hides stats on rate-limit/failure.
- `prefers-reduced-motion`: no smooth scroll, no particles, static bird; the page is fully usable.

## Content to double-check (editable in `public/index.html`)
Your assets contained sprites/audio, not gameplay screenshots, so the gallery shows **sprite scenes composed from the game's art**
(labelled as such) and the "Sky Practice" web demo is a small browser toy built from the same art (labelled as a demo, not the game).
Feature claims (day/night worlds, three bird colours, sound effects, one-tap flying) are inferred from the asset pack — edit if they differ.
To add real screenshots: put them in `public/assets/screenshots/` and add `<button class="shot">` entries in the `#gallery` block.

## Local development
```bash
npm install
ADMIN_PASSWORD=secret npm run dev      # http://localhost:8888, file-backed fake Blobs in .dev-data/
npm test                               # 29 backend tests
# or the real thing:  npx netlify dev
```

## Structure
```
public/            index.html, admin.html, css/, js/ (site.js, admin.js, shared.js), assets/, vendor/ (GSAP, ScrollTrigger, Lenis)
netlify/functions/ auth.js, releases.js, platforms.js, _lib.js
netlify.toml       publish dir, /new/* → admin.html, security headers
scripts/           dev-server.mjs, prepare-assets.py (derives sprite sheets/scenes; originals untouched)
tests/             backend tests
```
Credits: bird/pipe/background sprites & audio from your supplied asset pack.
