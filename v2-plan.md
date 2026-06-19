# V2 — Build Plan

> Read `v2-overview.md` (what & why) and `v2-instructions.md` (working rules) first. Each workstream below has a matching copy-paste prompt in `v2-prompts.md`.

The plan is sequenced so **the personal page (V1) stays green at every step.** The risky part (shared-module extraction, W1) comes early and is gated by a V1 regression check before any V2 feature is added.

---

## Build progress (branch `claude/weather-dashboard-v2-plan-u0x6jl`)

_Last updated 2026-06-19._

- ✅ **W0 — Multi-page scaffold.** `vite.config.ts` (multi-page input), `shared.html`, `src/shared-main.ts` (placeholder). Build emits both `dist/index.html` and `dist/shared.html`; V1 bundle unchanged. Committed + pushed.
- ✅ **W3 — Geocoding** (done out of order — it's independent of W1/W2). `api/geocode.ts` (Census → Nominatim fallback, US-only) + `src/shared-page/geocode.ts` (client + `inColorado`). Build/type-check clean. **Live endpoint + picker testing is DEFERRED until the branch merges** — the build environment blocks the geocoder hosts (`census.gov`, `nominatim.openstreetmap.org`) and the owner is on mobile. Test URLs are in the W3 section below.
- ✅ **W1 — Shared-module extraction.** The high-risk, V1-touching step, done in the four sub-steps below — one commit each so a regression is easy to bisect. The full engine now lives in `src/shared/` and V1 imports it. **V1 regression verified green** (see "How V1 was verified" below). Committed + pushed.
- ✅ **W2 — Backend parameterization.** Both serverless functions now accept arbitrary US lat/lon while V1's calls stay byte-identical. `api/air-quality.ts` adds `?lat=&lon=&temp=` beside the unchanged `?location=` path; `api/brief.ts` adds `?lat=&lon=&co=` with per-location Blob cache keys, no-param path still `consensus-brief.json`; both add US-bbox validation. Frontend `fetchAirQuality`/`fetchBrief` gained back-compat overloads so the **three V1 call sites emit unchanged requests**. Two commits (backend, then frontend signatures) for easy bisecting. **V1 regression verified** at the source level (live weather hosts blocked in build env — see W2 section below). Committed + pushed.
- ✅ **W4 — Location picker + persistence.** The shared page now boots for real. `src/shared-page/persistence.ts` (versioned localStorage, ≤2 locations, corruption-tolerant), `picker.ts` (one screen for both onboarding and manage: search → geocode → persist, cap 2, de-dupe, remove, US-only messaging), `render.ts` (parameterized `renderSharedShell` + `makeRenderAll(store, locations)` — the V2 counterpart to `src/render.ts`), and a rewritten `src/shared-main.ts` boot that seeds `createStore()` from stored locations and runs the V1-style per-location NWS + air-quality (lat/lon path) fetches plus zone-wide CAIC/Tomer and a per-location brief that refetches on tab switch. **No V1 source touched** — only new V2 files + an additive `style.css` section. **Note:** with `shared-main.ts` now importing the shared engine, the build code-splits it into a `cards-*.js` chunk both entries load; V1 behavior is identical but its bundle filenames changed (expected — this is the "both pages import one shared engine" end-state). Live picker/render verification deferred to the Vercel preview. Committed + pushed.
- ⏭️ **Next: W5 — Colorado gating.** Run with Prompt 6 from `v2-prompts.md`.
- **Remaining:** W5, W6, W7, W8.

**Decisions added during the build:**
- **Geocoder = Census + Nominatim fallback** (upgraded from "Census only"). Census `onelineaddress` is address-grade and unreliable for the bare city/ZIP input casual users type; Nominatim (free, no key) covers that gap. Both US-restricted.
- **`Location` type relocated to the shared engine** (W1). The `Location` interface moved from `src/locations.ts` into `src/shared/types.ts` so shared modules don't depend on V1's config; `src/locations.ts` keeps only the two-element `LOCATIONS` constant.
- **Store is a factory + thin V1 wrapper** (W1). `src/shared/store.ts` exports `createStore(locations)`; `src/store.ts` instantiates it with `LOCATIONS` and re-exports the instance members under their original names, so `main.ts`/`render.ts` were untouched by the store refactor. `setActiveLocation` now takes `number` (not `0 | 1`) to support N locations.
- **`render.ts` stays at top level** as V1's thin wrapper (W1) — the plan offered "`src/personal/` or stays at top level"; we chose the lower-churn option. It owns only the page shell (`renderShell`, incl. the fixed two-tab bar) and the `renderAll` orchestrator that feeds V1 state into the shared renderers.
- **`airQuality.ts` + `brief.ts` were moved as-is in W1, refactor deferred.** Relocated into `src/shared/` during W1 sub-step 4 with **no signature change** — the lat/lon (air-quality) and dual-mode (brief) refactors belong to W2/W6. So when W2 starts, both files already live in `src/shared/`; only their signatures change.
- **Known gap for V2:** `src/shared/chart.ts` still has a `LOC_ELEV_FT` map keyed by `"home"`/`"office"` for the NWS elevation label (moved as-is); any other `locId` falls back to `9,000 ft`. V1 is unaffected. Generalize for the shared page in W5/W6 or W7 polish.

**Out-of-plan V1 fix shipped during this session (2026-06-19):** a pre-existing V1 CSS bug — in the 7-day desktop view the CAIC and Mountain Weather Update cards were stretched to the 7-Day card's height (`align-items: stretch` + a `flex:1` block) — was corrected to `align-items: start` so the cards size to their own content. As an independent V1 bug it was committed **directly to `main`** (production V1) and then **merged into this feature branch** (hence the branch's merge commit from `main`). No effect on the V2 work.

### How V1 was verified byte-for-byte (W1)
The build/CI environment blocks the live weather hosts (NWS/PurpleAir/AirNow/CAIC), so V1 couldn't be exercised against real data here. Because the rendered HTML is a pure function of state, V1 was instead proven unchanged at the **source level**: a normalized set-diff of the old `render.ts`/`store.ts` against the new `render.ts` + `cards.ts` + `store.ts` showed **zero differences in any HTML template literal** — every diff line was an intended structural change (function exports, argument passing, the two decouplings, import paths). The emitted V1 bundle was also byte-identical across the file-move sub-steps. The owner then confirmed the deployed preview matched production with no structural differences. **This is the reusable technique** when the weather hosts are unreachable: diff the rendered-HTML source, don't rely on a live render.

---

## Workstream map

| WS | Name | Touches V1 code? | Risk | Status |
|---|---|---|---|---|
| **W0** | Multi-page scaffold | No (additive) | Low | ✅ Done |
| **W1** | Shared-module extraction | **Yes** (repoints imports) | **High** | ✅ Done |
| **W2** | Backend parameterization | Yes (back-compat) | Medium | ✅ Done |
| **W3** | Geocoding | No | Low | ✅ Done |
| **W4** | Location picker + persistence | No | Medium | ✅ Done |
| **W5** | Colorado gating | No | Low | Planned |
| **W6** | Dual-mode brief | No (W2 enables) | Medium | Planned |
| **W7** | Polish, PWA, SW, README | Minor | Low | Planned |
| **W8** | QA matrix + merge | No | — | Planned |

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

## W1 — Shared-module extraction (the big one) ✅ Done

> **Built 2026-06-19.** All four sub-steps below shipped, one commit each. Deviations from the plan as written are flagged inline with **[as built]** and summarized under "Decisions added during the build" above. The target layout was achieved; `airQuality.ts`/`brief.ts` were relocated but **not** yet refactored (their W2/W6 signature work is still pending).

**Goal:** move the reusable engine into `src/shared/` and repoint V1's imports there, with **zero behavioral change to V1.** This is the bulk of the effort and the highest risk; do it carefully and verify V1 after.

**Target layout:**
```
src/shared/
  types.ts        ← moved as-is [as built: + the Location interface, moved here from locations.ts]
  nws.ts          ← moved as-is (already lat/lon-parameterized)
  sun.ts          ← moved as-is
  chart.ts        ← moved as-is [as built: still has the home/office LOC_ELEV_FT hardcode — see Known gap]
  caic.ts         ← moved as-is (CO-only fetch; gating decided by caller)
  tomer.ts        ← moved as-is (CO-only fetch)
  airQuality.ts   ← [as built: moved as-is in W1; lat/lon refactor deferred to W2 frontend half]
  brief.ts        ← [as built: moved as-is in W1; params + mode refactor deferred to W6 frontend half]
  store.ts        ← refactored into a store factory seeded with N locations [as built: createStore(locations)]
  cards.ts        ← pure card renderers extracted from render.ts
```

**Top-level V1 glue that stayed (imports from `src/shared/`):** `src/locations.ts` (the two fixed `LOCATIONS`), `src/store.ts` (thin wrapper around `createStore(LOCATIONS)`), `src/render.ts` (shell + `renderAll` orchestrator), `src/main.ts` (boot).

**Steps (do in this order, verifying build between moves):**
1. **Move the pure, already-reusable modules first** — `types.ts`, `nws.ts`, `sun.ts`, `chart.ts`, `caic.ts`, `tomer.ts` → `src/shared/`. Update `src/main.ts` and `src/render.ts` import paths. Build. **Verify V1 identical.**
2. **Extract pure card renderers** from `src/render.ts` into `src/shared/cards.ts`: `renderAlerts`, `renderConditions`, `renderAirQuality`, `renderSparkline`, `renderHourly`, `renderForecast`, `renderCAIC`, `renderChart`, `renderBrief`, `renderTomer`, plus shared helpers (`cardFooter`, `fmtTime`, `fmtDay`, `fmtWind`, `skeletonCard`, `alertSeverity`, `WIND_DIR_DEG`). Make each renderer take the data it needs as **arguments** (it mostly already does) rather than reaching into module-scoped `LOCATIONS`/`state`. The personal `render.ts` becomes a thin wrapper that wires `state` → these pure renderers.
   - **Decouple the two V1 hardcodes:** `locId === "home"` for PA temp becomes a `showPaTemp: boolean` (or `paTempLabel`) argument; the fixed 2-tab assumption stays in each page's shell, not in the shared renderers.
   - **[as built]** `renderConditions` takes `showPaTemp: boolean` (V1 passes `loc.id === "home"`). `renderAirQuality` dropped its formerly-unused `locId` param entirely. `renderChart` takes `(hourlyResult, pointForecastResult, locId)` as args instead of reading `state`. `renderBrief` takes an `onRefresh: () => Promise<void>` callback so `cards.ts` has **no** store/fetch dependency — V1's `renderAll` supplies the closure that calls `fetchBrief` + `updateBrief`. (Net effect: this relocated the brief's refresh path out of the old `renderBrief` and into `render.ts`'s `renderAll` — a second `fetchBrief` call site that W2 must keep byte-identical.)
3. **Generalize the store** (`src/store.ts` → `src/shared/store.ts`) into a factory that takes the location list and builds the `weather` record + `activeLocation`/`activeView`. The personal entry calls it with the two fixed locations; the shared entry calls it with the chosen locations.
   - **[as built]** `src/store.ts` is now a thin wrapper: `createStore(LOCATIONS)` + re-export of the instance members under their original names, so `main.ts`/`render.ts` were untouched. `setActiveLocation` is typed `(index: number)`.
4. Repoint `src/main.ts` to import everything from `src/shared/`. Personal `render.ts` either moves to a thin `src/personal/` wrapper or stays at top level importing from `shared/`.
   - **[as built]** `render.ts` stayed at top level (lower churn). This sub-step also relocated `airQuality.ts` + `brief.ts` into `src/shared/` (as-is) so `main.ts` imports the whole engine from one place.

**V1 check (gate — do not proceed to W2+ until green):** full verification matrix row "Personal page, both tabs" — identical layout, identical data, identical copy. Diff the rendered DOM if needed. **[as built]** Verified via source-level normalized HTML-template diff (live weather hosts are blocked in the build env) + identical bundle output + owner preview-vs-prod comparison. See "How V1 was verified" above.

**Done when:** V1 is provably unchanged and both entries import the same shared engine (no copy-paste divergence). **✅ Met** — though the shared *entry* (`shared-main.ts`) doesn't consume the engine yet; that wiring is W4. W1's deliverable is the extracted, V1-backing engine.

---

## W2 — Backend parameterization ✅ Done

> **Built 2026-06-19.** Shipped in two commits (backend functions, then frontend fetch signatures) so the V1-touching frontend half is easy to bisect. Implemented as the plan specified below; deviations are flagged inline with **[as built]**. The full dual-mode brief *prompt* fork is intentionally still deferred to W6 — W2 only wired the param plumbing, the CAIC skip on `co=false`, and the per-location cache keys.

**Goal:** make the serverless functions accept arbitrary US lat/lon while keeping V1's existing calls working unchanged.

**[as built] How V1 was verified (no live render):** same constraint as W1 — the build env can't reach NWS/PurpleAir/AirNow/CAIC, so V1 was confirmed at the source level by three facts: (a) the three V1 frontend call sites (`fetchAirQuality(locId, prev)` and both `fetchBrief` calls) are textually unchanged, so they emit the same HTTP requests; (b) `tsc --noEmit` + `vite build` are green; (c) the `?location=` branch in `api/air-quality.ts` and the no-param branch in `api/brief.ts` are logically identical to before — the new code is added as `if` branches *above* them, never editing the V1 path. Live endpoint testing on the deployed preview is deferred until the branch merges.

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
> **W1 left these files already relocated into `src/shared/` with their V1 signatures intact** — W2 only changes the signatures, it does not move anything. Three V1 call sites must keep emitting byte-identical requests; verify each:
> - `src/main.ts` → `fetchAirQuality(locId, prev)` (currently sends `?location=home|office`).
> - `src/main.ts` → `fetchBrief(state.brief)` (initial load, no params).
> - `src/render.ts` → `fetchBrief(brief, true)` (the refresh-button closure relocated here in W1; sends `?refresh=true`).

- `airQuality.ts`: change the fetch signature from `(locationId: "home" | "office")` to `(lat, lon, { temp })`; build the query string accordingly. **Prefer keeping the `location=` shortcut for the personal entry** so V1's request stays byte-identical — i.e. accept either the legacy `("home"|"office")` form or `(lat, lon, opts)`, and leave `main.ts`'s call alone (or give it a back-compat default that still sends `?location=home|office`). Coords is cleaner long-term but `location=` is the safest V1 path.
  - **[as built]** Implemented as a runtime-overloaded function: `fetchAirQuality(locationIdOrLat, prevOrLon, optsOrPrev?, maybePrev?)`. If the first arg is a **string** it takes the legacy `("home"|"office", prev)` path and sends `?location=…` (V1, untouched in `main.ts`). If it's a **number** it takes the `(lat, lon, { showTemp }, prev)` path and sends `?lat=&lon=&temp=`. (The opts key is `showTemp`, matching the backend's `temp` flag.)
- `brief.ts`: add `(lat, lon, { inColorado })` params; **default (no args) reproduces V1** at *both* call sites above (initial load + refresh).
  - **[as built]** Implemented as an optional third arg: `fetchBrief(prev, refresh = false, options?: { lat, lon, inColorado })`. With **no `options`**, the URL is exactly `/api/brief` or `/api/brief?refresh=true` — byte-identical to both V1 call sites. With `options`, it sends `?lat=&lon=&co=` (plus `&refresh=true` on refresh), which the backend maps to the per-location blob key.

**V1 check:** personal page air-quality and brief cards identical; personal brief still reads/writes `consensus-brief.json`; the two `fetchBrief` call sites and the one `fetchAirQuality` call site emit unchanged requests.

**Done when:** `https://<deploy>/api/air-quality?lat=30.27&lon=-97.74&temp=false` and `https://<deploy>/api/brief?lat=30.27&lon=-97.74&co=false&mode=forecast` return valid data for a non-CO location, and the no-param paths are unchanged.

---

## W3 — Geocoding ✅ Done

**Goal:** turn "Boulder, CO" into `{ found, lat, lon, state, label, source }`.

**As built:**
1. `api/geocode.ts` — `GET /api/geocode?q=<address>`. **Census Geocoder first** (`.../onelineaddress?benchmark=Public_AR_Current&format=json`), **OpenStreetMap Nominatim fallback** (`countrycodes=us`) for the city/ZIP/place queries Census can't resolve. US-restricted (Nominatim country filter + a coarse US bounding box). Returns normalized `{ found, lat, lon, state, label, source }` or `{ found:false, reason }`. Self-contained per the `/api` no-cross-import rule; long CDN cache since results are stable. *(Geocoder choice upgraded from Census-only — see Build progress above.)*
2. `src/shared-page/geocode.ts` — frontend client calling `/api/geocode?q=...`; computes `inColorado` (`state === "CO"`, with a Colorado bounding-box fallback).

**Verification — DEFERRED until the branch merges** (build env blocks the geocoder hosts; owner on mobile). On the deployed preview/prod, expect:
- `/api/geocode?q=Boulder, CO` → `found:true`, `state:"CO"`, ~`40.01,-105.27` (likely `source:"nominatim"`).
- `/api/geocode?q=1600 Pennsylvania Ave NW, Washington, DC 20500` → `found:true`, `state:"DC"`, `source:"census"`.
- `/api/geocode?q=Austin, TX` → `found:true`, `state:"TX"`, `inColorado:false`.
- `/api/geocode?q=Paris, France` → `found:false`.

---

## W4 — Location picker + persistence ✅ Done

> **Built 2026-06-19.** One additive commit (no V1 source touched). Implemented as the steps below specify, with two deliberate choices flagged **[as built]**: the onboarding and "Edit locations" screens are unified into one `renderLocationScreen`, and the V2 render wrapper lives in `src/shared-page/render.ts` (parallel to V1's `src/render.ts`) rather than reusing it.

**Goal:** the shared page's UI for choosing, storing, and changing up to two locations.

**[as built] Files:**
- `src/shared-page/persistence.ts` — `loadLocations()`/`saveLocations()` under the versioned key `weather-shared-locations-v1`; validates each entry and caps at `MAX_LOCATIONS = 2`; any problem (missing key, bad JSON, wrong shape) returns `[]`.
- `src/shared-page/picker.ts` — `renderLocationScreen(container, { onDone })` serves **both** the onboarding empty state and the manage screen. Search → `geocode()` (W3) → `addLocation()` (cap + de-dupe by rounded coords) → re-render. Remove buttons, and a "View dashboard →" button once ≥1 location exists. Friendly messages for not-found / US-only / error.
- `src/shared-page/render.ts` — `renderSharedShell(locations, handlers)` (tabs built from chosen locations + an "Edit locations" button) and `makeRenderAll(store, locations)` (binds the shared card renderers to this store; `showPaTemp` is always `false` on the shared page; the brief refresh passes the active location's `lat/lon/inColorado`).
- `src/shared-main.ts` — boot: `loadLocations()` → empty shows the picker, else seed `createStore()` and run the V1-style flow (per-location NWS + air-quality via the W2 lat/lon path; zone-wide CAIC/Tomer once; per-location brief that refetches on tab switch). "Edit locations" returns to the picker; finishing there re-boots.

**[as built] Build-output note:** now that `shared-main.ts` imports the shared engine, Vite code-splits the common modules into a `cards-*.js` chunk that **both** `index.html` and `shared.html` load. V1's behavior and rendered HTML are unchanged, but its emitted bundle filenames differ from the pre-W4 single `main-*.js`. This is the intended "two pages, one shared engine" end-state, not a V1 regression.

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
