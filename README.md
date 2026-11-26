# DTF Transferprint

Astro landing page for Selini-Shirt (https://dtf-transferprint.de), rendered on Netlify (SSR) with its own admin at `/admin`. Every text, number, price, link and image of the page can be changed there and goes live immediately on "Veröffentlichen".

## How it fits together

```
/admin (Better Auth: E-Mail + Passwort, optional Authenticator-Code)
   │  Entwurf speichern ─► Netlify Database (Postgres): site_content.draft
   │  Veröffentlichen   ─► neue Zeile in site_versions + CDN-Cache „cms“ leeren
   ▼
/  /404  /sitemap.xml  /robots.txt  ◄── liest die veröffentlichte Version (30 s Speicher-Cache,
                                         danach CDN bis zum nächsten Veröffentlichen)
```

- `src/data/cms.json` is the **schema and the starting content**. Field names, types, labels (`_label`) and hints (`_hints`) come from it; the admin can only change values and list items, never the structure. Until the first publish, and whenever the database cannot be reached, the page renders this file.
- `src/lib/content.ts` loads the published content; `src/components/HomePage.astro` renders it (the live page and the admin preview `/admin/preview` use the same component).
- `src/lib/auth.ts` configures Better Auth (no public sign-up, optional TOTP 2FA per account, database-backed rate limits, audit of every login).
- `src/lib/admin-store.ts` holds drafts, publishing, versions, image uploads (re-encoded to WebP, served under `/images/cms/…`), the link check and the audit log. `src/pages/admin/api/[...path].ts` is its JSON API; the editor UI is the static client in `public/admin/`.
- Database schema: `netlify/database/migrations/`. Netlify applies new migrations automatically on every production deploy (deploy previews get their own database branch).

## Netlify setup (once)

1. **Database:** Netlify → Project → *Database*. It is created automatically on the first deploy because `@netlify/database` is installed (otherwise "Create a database manually"). Netlify then sets `NETLIFY_DB_URL` itself. Netlify Database needs a credit-based plan.
2. **Environment variables** (Project configuration → Environment variables):
   - `BETTER_AUTH_SECRET`: at least 32 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - `ADMIN_SETUP_TOKEN`: at least 16 random characters; only needed until the admin account exists.
   - Delete the old `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `DATA_DIR` (former basic-auth admin, no longer used).
3. **Deploy** (push to `main`). The migration runs before the deploy goes live.
4. Open `https://dtf-transferprint.de/admin/login`, enter the setup token and create the admin account. Afterwards remove `ADMIN_SETUP_TOKEN` in Netlify. More people: "Benutzer" tab (admins only). Two-factor login: "Konto" → Zwei-Faktor-Anmeldung (optional, per person; an admin can reset it under "Benutzer").

## Working in the admin

- **Bearbeiten → Entwurf speichern:** nothing changes online.
- **Entwurf ansehen:** `/admin/preview` shows the saved draft exactly like the live page (noindex).
- **Links prüfen** (under "Versionen & Veröffentlichen"): tests every link of the draft against the real pages and marks dead selini-shirt.de links (404, redirect to /404, "nicht gefunden" pages) with a button to the field.
- **Veröffentlichen:** live immediately (CDN cache is purged). Every version is kept and can be loaded back into the draft.
- Prices are validated before saving: tiers must ascend in quantity and must not rise in price.

## Local development

Requires Node.js 22.19 or newer.

```powershell
npm install
$env:BETTER_AUTH_SECRET = "<32+ random characters>"
$env:ADMIN_SETUP_TOKEN = "<16+ characters>"
npm run dev
```

`npm run dev` starts Netlify's local emulation, including a local database (connection string in `.netlify/state.json`, data in `.netlify/db`). Migrations are not applied automatically there: run the SQL files in `netlify/database/migrations/` against that database once (or `netlify database migrations apply` with the Netlify CLI). Without a database the page still renders from `src/data/cms.json`; only the admin needs it.

After changing Better Auth plugins or user fields, print the required SQL with `NETLIFY_DB_URL=… npm run auth:schema` and add it as a new migration file.

## Content rules

The DTF product page is `https://selini-shirt.de/product/dtf-transfer-meterware-bestellen`. The former `/product/dtf-transfer-bestellen` redirects to the shop's 404 page and `/muster-bestellen/` does not exist (samples are requested via `/kontakt/`); never reuse them. Shop links stay dofollow. The canonical origin is `PUBLIC_SITE_URL` → `site.liveUrl` (https://dtf-transferprint.de) → Netlify `URL` → request origin. The sitemap `<lastmod>` is the date of the last publish.

## Release checklist

1. `npm ci` and `npm run build` (Node.js 22.19+).
2. Netlify variables set (see above); database present.
3. After the deploy: `/`, `/api/health`, `/robots.txt`, `/sitemap.xml` and `/admin/login` on https://dtf-transferprint.de.
4. In the admin: "Links prüfen" shows no dead links.
