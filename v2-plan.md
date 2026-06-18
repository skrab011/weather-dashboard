# V2 — Build Plan

> Read `v2-overview.md` (what & why) and `v2-instructions.md` (working rules) first. Each workstream below has a matching copy-paste prompt in `v2-prompts.md`.

The plan is sequenced so **the personal page (V1) stays green at every step.** The risky part (shared-module extraction, W1) comes early and is gated by a V1 regression check before any V2 feature is added.

---

## Workstream map

| WS | Name | Touches V1 code? | Risk |
|---|---|---|---|
| **W0** | Multi-page scaffold | No (additive) | Low |
| **W1** | Shared-module extraction | **Yes** (repoints imports) | **High** |
| **W2** | Backend parameterization | Yes (back-compat) | Medium |
| **W3** | Geocoding | No | Low |
| **W4** | Location picker + persistence | No | Medium |
| **W5** | Colorado gating | No | Low |
| **W6** | Dual-mode brief | No (W2 enables) | Medium |
| **W7** | Polish, PWA, SW, README | Minor | Low |
| **W8** | QA matrix + merge | No | — |

---

## W0 — Multi-page scaffold

**Goal:** a blank `shared.html` builds and serves alongside `index.html`, with no shared logic yet. Proves the multi-page Vite + Vercel setup before touching V1 code.

**Steps:**
1. Create `vite.config.ts` (none exists today — Vite uses defaults). Add multi-page input:
   ```ts
   import { defineConfig } from "vite";
   export default defineConfig({
     build: {
       rollupOptions: {
         input: {
           main: "index.html",      // personal page (V1)
           shared: "shared.html",   // shared page (V2)
         },
       },
     },
   });
   ```
2. Create `shared.html` (copy of `index.html`'s shell) pointing at a new `src/shared-main.ts`. For now `shared-main.ts` just renders a placeholder.
3. Confirm `npm run build` emits both `dist/index.html` and `dist/shared.html`.
4. Confirm Vercel serves `/shared` (Vercel maps `shared.html` → `/shared`).

**V1 check:** `index.html` and `src/main.ts` untouched; personal page identical.

**Done when:** `https://<deploy>/` shows V1 unchanged and `https://<deploy>/shared` shows the placeholder.

---

## W1 — Shared-module extraction (the big one)

**Goal:** move the reusable engine into `src/shared/` and repoint V1's imports there, with **zero behavioral change to V1.** This is the bulk of the effort and the highest risk; do it carefully and verify V1 after.

**Target layout:**
```
src/shared/
  types.ts        ← moved as-is
  nws.ts          ← moved as-is (already lat/lon-parameterized)
  sun.ts          ← moved as-is
  chart.ts        ← moved as-is
  caic.ts         ← moved as-is (CO-only fetch; gating decided by caller)
  tomer.ts        ← moved as-is (CO-only fetch)
  airQuality.ts   ← moved; refactored to accept lat/lon (see W2 frontend half)
  brief.ts        ← moved; refactored for params + mode (see W6 frontend half)
  store.ts        ← refactored into a store factory seeded with N locations
  cards.ts        ← pure card renderers extracted from render.ts
```

**Steps (do in this order, verifying build between moves):**
1. **Move the pure, already-reusable modules first** — `types.ts`, `nws.ts`, `sun.ts`, `chart.ts`, `caic.ts`, `tomer.ts` → `src/shared/`. Update `src/main.ts` and `src/render.ts` import paths. Build. **Verify V1 identical.**
2. **Extract pure card renderers** from `src/render.ts` into `src/shared/cards.ts`: `renderAlerts`, `renderConditions`, `renderAirQuality`, `renderSparkline`, `renderHourly`, `renderForecast`, `renderCAIC`, `renderChart`, `renderBrief`, `renderTomer`, plus shared helpers (`cardFooter`, `fmtTime`, `fmtDay`, `fmtWind`, `skeletonCard`, `alertSeverity`, `WIND_DIR_DEG`). Make each renderer take the data it needs as **arguments** (it mostly already does) rather than reaching into module-scoped `LOCATIONS`/`state`. The personal `render.ts` becomes a thin wrapper that wires `state` → these pure renderers.
   - **Decouple the two V1 hardcodes:** `locId === "home"` for PA temp becomes a `showPaTemp: boolean` (or `paTempLabel`) argument; the fixed 2-tab assumption stays in each page's shell, not in the shared renderers.
3. **Generalize the store** (`src/store.ts` → `src/shared/store.ts`) into a factory that takes the location list and builds the `weather` record + `activeLocation`/`activeView`. The personal entry calls it with the two fixed locations; the shared entry calls it with the chosen locations.
4. Repoint `src/main.ts` to import everything from `src/shared/`. Personal `render.ts` either moves to a thin `src/personal/` wrapper or stays at top level importing from `shared/`.

**V1 check (gate — do not proceed to W2+ until green):** full verification matrix row "Personal page, both tabs" — identical layout, identical data, identical copy. Diff the rendered DOM if needed.

**Done when:** V1 is provably unchanged and both entries import the same shared engine (no copy-paste divergence).

---

## W2 — Backend parameterization

**Goal:** make the serverless functions accept arbitrary US lat/lon while keeping V1's existing calls working unchanged.

### `api/air-quality.ts`
1. Accept `?lat=&lon=` in addition to the existing `?location=home|office`. If `location` is present, use the existing hardcoded map (V1 path, unchanged). If `lat`/`lon` are present, use those.
2. Add `?temp=true|false` (or infer): PA temperature should be returned only when requested. V1 keeps home=temp, office=no-temp behavior via the existing map; the shared page passes the flag explicitly.
3. **US bounding-box validation:** reject coordinates outside the continental US + AK/HI envelope with a clean error, so the proxy can't be used as a generic open relay for the owner's keys.

### `api/brief.ts`
1. Accept `?lat=&lon=&co=true|false&mode=consensus|forecast`. **No params = current home behavior, unchanged** (V1 path).
2. **Per-location Blob cache key:** derive the blob name from rounded coords, e.g. `brief-${lat.toFixed(2)}_${lon.toFixed(2)}.json`. The personal page keeps using `consensus-brief.json` (its no-param default) so its cache is untouched.
3. Wire the dual-mode prompt fork here (full implementation in W6): `co=true` → NWS+CAIC consensus prompt; otherwise NWS-only forecast prompt (and skip the CAIC fetch entirely).
4. Keep the same US bbox validation.

### Frontend halves (in `src/shared/`)
- `airQuality.ts`: change the fetch signature from `(locationId)` to `(lat, lon, { temp })`; build the query string accordingly. Personal entry passes the home/office coords (or keeps the `location=` shortcut — pick one and apply consistently; coords is cleaner long-term but `location=` keeps V1 byte-identical, so prefer `location=` for the personal entry).
- `brief.ts`: add `(lat, lon, { inColorado })` params; default (no args) reproduces V1.

**V1 check:** personal page air-quality and brief cards identical; personal brief still reads/writes `consensus-brief.json`.

**Done when:** `https://<deploy>/api/air-quality?lat=30.27&lon=-97.74&temp=false` and `https://<deploy>/api/brief?lat=30.27&lon=-97.74&co=false&mode=forecast` return valid data for a non-CO location, and the no-param paths are unchanged.

---

## W3 — Geocoding

**Goal:** turn "Boulder, CO" into `{ lat, lon, state, label }`.

**Steps:**
1. Add `api/geocode.ts` — a thin proxy to the **US Census Geocoder** (`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` with `benchmark=Public_AR_Current&format=json`). Proxying server-side avoids CORS surprises and lets us add a short cache header. Return a normalized `{ lat, lon, state, matchedAddress }` (or an empty/`notFound` result). Validate the result is in the US.
2. Add `src/shared-page/geocode.ts` — frontend client that calls `/api/geocode?q=...`, returns the normalized shape, and computes `inColorado` (`state === "CO"`, with bounding-box fallback).

**Done when:** searching "Boulder, CO" yields CO coords with `inColorado: true`; "Austin, TX" yields TX coords with `inColorado: false`; "Paris, France" yields a clean not-found / not-US result.

---

## W4 — Location picker + persistence

**Goal:** the shared page's UI for choosing, storing, and changing up to two locations.

**Steps:**
1. `src/shared-page/persistence.ts` — load/save an array of up to 2 `{ label, lat, lon, state, inColorado }` to `localStorage` under a versioned key (e.g. `weather-shared-locations-v1`). Tolerate missing/corrupt data (fall back to empty).
2. `src/shared-page/picker.ts` — search box + results; on select, geocode (W3) and persist (cap at 2). A "change / remove location" affordance. An onboarding **empty state** when no locations are stored.
3. `src/shared-main.ts` — boot sequence: read stored locations → if none, show picker/empty state → else seed the store factory (W1) with the chosen locations and run the V1-style fetch/render flow using `src/shared/` modules.
4. Tabs are built from the chosen locations (1 or 2), reusing the V1 tab markup/behavior.

**Done when:** a user can add two locations, see them persist across reloads, switch tabs, and change a location.

---

## W5 — Colorado gating

**Goal:** hide (not error) CAIC, Tomer, and the overlay chart when the active location is outside Colorado.

**Steps:**
1. In `shared-main.ts`/the shared render path, read the active location's `inColorado`.
2. Only **fetch** CAIC + Tomer when at least one chosen location is in CO (avoid pointless calls); only **render** those cards + the overlay chart when the *active* location is in CO.
3. When gated off, the regions are **empty/absent** — no error card, no skeleton stuck forever. Adjust the responsive grid so the layout doesn't leave holes (the bottom row collapses gracefully to NWS-only cards).

**V1 check:** personal page always shows CAIC/Tomer/chart (it's always in CO) — unchanged.

**Done when:** CO location shows all three; non-CO location cleanly omits all three with no layout gap or error.

---

## W6 — Dual-mode brief

**Goal:** the brief card adapts its prompt, inputs, and title to whether the active location is in Colorado.

**Steps:**
1. Backend (`api/brief.ts`, building on W2): when `co=true` use the V1 NWS+CAIC consensus prompt; when `co=false` use an NWS-only plain-language forecast prompt and **skip the CAIC fetch**. Cache both under the per-location blob key.
2. Frontend (`src/shared/cards.ts` brief renderer): title is **"Consensus Brief"** when `inColorado`, else **"Forecast Brief"**. Manual refresh button passes the right mode.
3. Confirm cache keys differ per location so two friends in different cities don't clobber each other's brief.

**Done when:** CO location shows a 2-source "Consensus Brief"; non-CO shows an NWS-only "Forecast Brief"; refresh works for both; repeat loads hit cache.

---

## W7 — Polish, PWA, service worker, README

**Steps:**
1. **PWA:** decide whether the shared page is installable. If yes, give `shared.html` its own manifest (or a `start_url`/`scope` of `/shared`) so installing V2 doesn't collide with V1's home-screen app. If no, simply omit the manifest link from `shared.html`.
2. **Service worker:** bump cache version (e.g. `weather-v3`); ensure `shared.html` + its JS/CSS are precached and that all `/api/` routes remain bypassed.
3. **Copy & affordances:** shared-page header/title, "change location" UI, US-only messaging, empty/onboarding state, error states for geocode failures.
4. **README:** add a short "Shared page (V2)" section — what it is, the `/shared` URL, how locations persist, the US-only limitation.
5. Confirm dark-mode design tokens are reused (no new colors/fonts).

**Done when:** the shared page feels finished on mobile and desktop and the docs describe it.

---

## W8 — QA matrix + merge

**Steps:**
1. Run the full verification matrix in `v2-instructions.md` (personal unchanged; CO full; non-CO gated; invalid input; empty/return visits; mobile + desktop).
2. Check costs: confirm per-location brief caching works (second load of same location is cache-fast) and that bbox validation rejects non-US coords on both proxies.
3. Get owner sign-off, then merge the feature branch to `main` (this deploys V1 + V2 together). Confirm production V1 is still identical post-merge.

**Done when:** both pages are live on production, V1 verified unchanged, V2 passes the full matrix.

---

## Effort summary

- **Easy:** W0 scaffold, W3 geocoding, W5 gating, W7 polish.
- **Medium:** W2 backend params, W4 picker/persistence, W6 dual-mode brief.
- **Highest variable / risk:** **W1 shared-module extraction** — it touches V1's working code. Budget the most care and the V1 regression gate here.
