# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SoleMio — a lencería (lingerie) shop's public catalog + admin panel, for a single small business in Tandil, Argentina. Static multi-page site (no framework, no bundler, no build step) backed by Supabase (Postgres + Auth), deployed as-is to Cloudflare Workers static assets.

There is no `package.json`, no test suite, and no linter configured. "Running" this project means serving the repo root over HTTP and opening a page in a browser — there is nothing to build.

```bash
python3 -m http.server 8765   # from repo root, then open http://localhost:8765/catalogo.html
```

Deployment is `wrangler.jsonc` (`assets.directory: "."`) — Cloudflare serves the repo's static files directly, with `404.html` as the not-found page. There's no CI; changes go live on push/deploy as-is. Live domain: `https://solemiotandil.com.ar`.

- Because the whole repo root is published, **anything not listed in `.assetsignore` is public** (it keeps `.git`, `sql/`, `tools/`, `CLAUDE.md`… off the site). Add new non-site files/folders there.
- Cloudflare's default HTML handling serves `/catalogo.html` as a 307 to `/catalogo`. Canonicals, `og:url` and `sitemap.xml` therefore use the extensionless form (`/catalogo`, `/producto?id=…`, `/` for home). Internal links keep `.html` so the site also works under `python -m http.server` locally.
- `_redirects` (301 `/landing.html` → `/`) and `_headers` (cache rules) are Cloudflare config files — don't add them to `.assetsignore` or they stop applying.
- The home page is `index.html`. `landing.html` is only a redirect stub kept for old links.
- **Worker** (`worker/index.js`, `main` in `wrangler.jsonc`): runs only for `/producto` and `/producto.html` (`assets.run_worker_first`); everything else is served straight from static assets. It fetches the product from Supabase and rewrites the `<head>` (title, description, og/twitter tags, canonical, Product JSON-LD) so link previews in WhatsApp/Instagram — whose crawlers don't run JS — show the product. It must never break the page: on any error it returns the static HTML untouched. Title/description/JSON-LD come from `datosSEOProducto()` in `js/producto-datos.js`, shared with `producto.js`, which re-applies them client-side (and is what you see under `python -m http.server`, where the Worker doesn't run). To test the Worker locally, run `npx wrangler dev` with a config **outside** the repo pointing at it — run from the repo root it rebuilds in a loop because `.wrangler/` is inside the watched assets directory.
- `sitemap.xml` is generated: run `python tools/generar_sitemap.py` after adding/removing products and commit the result (it lists every product a guest can see).

## Repository layout

- `*.html` at the **repo root** — every page is its own standalone HTML file. These are the real public URLs (e.g. a customer's saved link `pedido-estado.html?id=...`), so they never move, even though their JS/CSS were reorganized into folders.
- `js/` — one JS module per page, plus shared modules (see below). Imports between them are relative and unaffected by the folder move.
- `css/` — one stylesheet per page, plus shared stylesheets.
- `sql/` — hand-run migrations, **not applied automatically**. Dated filenames, run in order, once each, by pasting into the Supabase SQL Editor. There is no migration tool tracking what's been applied — see "Database" below.
- `img/` — static images (logo, hero photo).

Each page is a self-contained triplet: `foo.html` + `js/foo.js` + `css/foo.css`, all loaded independently — there's no SPA router and no shared page shell beyond the modules below.

## Shared modules (imported by most/all pages)

- `js/supabase-client.js` — the Supabase client singleton (stored on `window` to survive multiple module evaluations), plus `esAdmin(email)` and the `irAlCatalogo()`/`irACatalogo()` navigation helpers that check for an existing admin session before deciding whether to send someone to the catalog as admin or guest.
- `js/theme.js` — light/dark theme + the shared inline-SVG icon set (`ICON`). Theme toggling targets `.theme-btn-icon` **by class, not id** — there can be more than one theme button on a page (e.g. one inside a settings dropdown), and they all need to stay in sync when either is clicked. Also owns generic modal/zoom scroll-locking (`document.body` gets a "no-scroll" state while any modal is open).
- `js/topbar.js` — renders the entire top bar (`renderTopbar(activeKey, opts)`) into `<header id="topbar-slot">`. `opts.search` and `opts.marcas` are catalog-only extras; every other page just gets logo/nav/cart/settings. Theme toggle, "Mi cuenta", and "Cerrar sesión" all live together in one `.settings-menu` dropdown (gear icon) — same on mobile and desktop, not duplicated per breakpoint. On mobile, page nav links collapse into a hamburger dropdown instead of showing inline.
- `js/footer.js` — renders the shared footer (`renderFooter()`) into `<footer id="footer-slot">`.
- `js/carrito.js` — cart **state** (localStorage-backed) plus the cart **drawer** (slide-in panel, opened from the topbar cart icon without navigating away) and the "toast" notification shown when something is added. `js/carrito-page.js` is the separate full-page cart view (`carrito.html`) built on top of the same state functions — don't confuse the two files.
- `js/pedidos-alertas.js` — admin-only: a bell icon + live count in the topbar, and a toast when a new `pedido` comes in, wired via a Supabase realtime subscription. No-ops entirely for guests.
- `js/tarjeta-producto.js` — the one product card used everywhere (catalog grid, "Más de <marca>" on `producto.html`, home page destacados). It **must always show the product ID and the "Agregar al carrito" button** (owner requirement: customers quote the ID over WhatsApp). Admin passes `opts.acciones` to swap the add button for Editar/Disponible/Eliminar. The card is an `<article>` with a stretched link (`.prod-link::after`), not an `<a>` wrapping buttons.
- `js/producto-datos.js` — pure (no browser/Supabase deps, also bundled into the Worker): `resolverImagen`, `precioCliente` (the `* 1.5`), `resumenTalles`, `datosSEOProducto`. Keep it dependency-free except `texto.js`.
- `js/texto.js` — display-only formatting: `nombreLegible()` turns supplier ALL-CAPS product names into sentence case (keeping the brand capitalized), `marcaLegible()` does the same for brands. Never write these back to the DB.

## Visual tokens (css/shared.css)

- Palette is a soft pastel take on the original Instagram logo violet (#4808D8) — deliberately *not* the logo's electric violet. `--brand` (#8A70D6, lavender-violet) is for the logo, ornaments and the card hover frame (large graphics only: 3.9:1). Links and highlighted text use `--primary` (#7862C8, 4.8:1 on white — on lavender backgrounds use `--primary-dark`). Primary buttons are lavender (`--boton` #BBAAF0) with dark plum text (`--boton-fg`, 7:1), not violet with white text. `--purpura` (#8C4F96, mauve) is only for italic accents (eyebrows, brand name on the product page, "Nuevo"). Text is a dark plum (`--text`), not black. All text pairs were checked for ≥4.5:1 in light and dark mode — re-check if you change them.
- The topbar and login logos are **CSS masks** over `img/logo-wordmark*.png` painted with `--brand` (see `.logo-img` in catalogo.css, `.login-logo-img` in login.css), so they follow the palette and dark mode automatically. Only the PNG's alpha matters for them; the PNGs themselves are violet for places that use them as images (og:image, JSON-LD logo).
- Page background is white on purpose: product photos come on white and blend into the page. Lavender (`--primary-soft`) is for soft bands (e.g. the landing's "cómo te atendemos"). The footer is deep violet (`--pie-fondo`) and redefines the text tokens to white *inside* `.site-footer` — style footer content with the normal tokens, not hard-coded white. The topbar's bottom line is a solid 2px `--brand` line that spans the full viewport (`.topbar::after`, box-shadow + clip-path trick so it never causes horizontal scroll). The owner explicitly rejected gradient washes behind the header and gradient accent lines — keep color solid.
- No tracked-uppercase labels, no monospace, sentence-case buttons ≥44px tall. The `.ornamento` (leaf between two rules, echoing the logo) is the only decoration — keep it to page titles and landing section breaks.

When adding a new page, copy the init pattern from an existing simple one (`js/no-encontrado.js` is the shortest example): detect role, call `renderTopbar`/`renderFooter`/`initAlertasPedidos`, then page-specific logic.

## Roles and page access

There's no per-route middleware — each page's JS decides for itself what a "guest" vs "admin" can see, using two different patterns:

- **Guest-accessible pages** (`catalogo.html`, `producto.html`, `carrito.html`, `pedido-estado.html`, `index.html` (home), `contacto.html`): never redirect. They check for a real Supabase session first (`sb.auth.getSession()` + `esAdmin(email)`); if that fails, they fall back to a `sessionStorage.getItem('solemio-role') === 'guest'` flag set by `login.html`/`irAlCatalogo()`. Checking the real session *before* the guest flag matters — otherwise an admin who once browsed as guest in the same tab stays stuck as guest after logging in.
- **Admin-only pages** (`pedidos.html`): redirect straight to `login.html` if the session isn't an admin. No guest fallback.
- `esAdmin(email)` is a live query against the `admins` table — being an admin isn't a claim/role on the Supabase Auth user, it's membership in that table.

Guests never see stock counts, in/out-of-stock filters, or the "eliminado" (soft-deleted) state — see `productos.disponible`/`productos.eliminado` under "Database" below.

## Database (Supabase)

- Migrations in `sql/` are dated, sequential, and **manual** — nothing in this repo tracks which ones have been run against the live database. Before assuming a column/table exists, check the live schema (the anon key in `supabase-client.js` is enough for a read-only check against a table that allows public `select`) rather than trusting that every file in `sql/` has been applied.
- RLS admin-check idiom, used identically on every admin-gated table — match it exactly rather than inventing a different check:
  ```sql
  exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email'))
  ```
- `pedidos.id` is a **client-generated UUID**, not an identity column. Guests can `insert` into `pedidos`/`pedido_items` but RLS only allows admins to `select` them (order data has customer PII) — so a guest's `insert().select()` can never read back its own row. Generating the id client-side sidesteps that. Any new guest-writable table with admin-only `select` needs the same pattern. Guests can still look up **their own** order later via `obtener_pedido_publico(uuid)` / `obtener_pedido_items_publico(uuid)` — `SECURITY DEFINER` functions that return one order by exact id (capability-URL style: knowing the UUID is the access control, there's no listing/search).
- Stock is one row per `(producto_id, talle, color)` in `producto_talles`, with `color = ''` as the sentinel for "this product has no color variants" — not two independent talle/color dimensions. Availability must be checked per exact combination. `producto_talles.orden` controls display order (admin-draggable); `producto_talles.precio` is an optional per-variant price override (falls back to `productos.precio` when null).
- Product visibility for guests is `productos.disponible` (boolean, independently editable — a product can be shown with zero stock, e.g. "available to order," or hidden despite having stock). This **replaced** an older `stock`-derived visibility and an even older `oculto` column; both `stock`/`oculto` still exist as real columns (stock is still the physical quantity, used by the admin-only stock filter) but `oculto` is unused dead data now — don't resurrect it. `productos.eliminado` is a separate, harder soft-delete: an eliminado product is filtered out of *every* query (admin included), used for "delete" instead of an actual `DELETE`, specifically to keep old orders' snapshots meaningful.
- `pedido_items` snapshots `producto_nombre` and `precio_unitario` at order time — order history stays correct even if the product is later edited, re-priced, or soft-deleted.
- Prices: `productos.precio` (and `producto_talles.precio`) are the **base/cost** price. The customer-facing price everywhere in the frontend is that value `* 1.5` — computed in JS at render time, not stored.

## Notable non-obvious behavior

- `overflow-x: hidden` on `<body>` breaks `position: sticky` for descendants in mobile Chromium — the mobile-nav-wrap fix uses `overflow-x: hidden` on `<html>` only, never on `<body>`. Don't reintroduce it on body while chasing a horizontal-scroll bug.
- The "Marcas" dropdown panel closes via `mouseenter` on its trigger button, not `mouseleave` on the menu. Replacing the panel's `innerHTML` while the mouse sits over it (e.g. right after picking a brand) fires spurious `mouseleave`/`mouseenter` events on the container even though the real cursor never moved — a `mouseleave`-based close is unreliable there. If you touch this again, keep relying on the trigger's `mouseenter` instead of re-introducing `mouseleave`.
- `renderMarcasMenu()` in `catalogo.js` fills **every** element with class `.marcas-panel` (there are two: the topbar dropdown on desktop, and a second copy next to "Categoría" that only shows on mobile/narrow layouts) — don't switch it back to a single `getElementById` lookup.
