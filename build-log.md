# Weather Dashboard — Build Log

*Detailed record of workstream decisions, bugs encountered, and solutions. Organized by workstream. See `CLAUDE.md` for the current working reference and `weather-forecast-overview.md` for the original spec.*

---

## WS1 — Project scaffold + hosting skeleton

**Decision: Vercel over Netlify**
Evaluated both. Vercel was chosen because its free (Hobby) tier integrates cleanly with GitHub for auto-deploy on push to `main`, provides serverless functions out of the box in the `/api/` directory, and has Vercel Blob available for caching. Netlify would have worked similarly but Vercel's TypeScript function support felt cleaner for this stack.

**Live URL:** https://weather-dashboard-five-umber.vercel.app

**Critical rule discovered:** Vercel deploys from the `main` branch on GitHub, not from the development branch (`claude/inspiring-franklin-lftofe`). Several early deployments failed because pushes went to the wrong branch. The fix — always use `git push origin main` — is enshrined in `CLAUDE.md`. Pushing to the wrong branch silently succeeds (git is happy) but Vercel never picks it up.

---

## WS2 — PWA shell + design system

**Stack decisions:**
- Vite + TypeScript, vanilla DOM. No framework — the app is data display, not interactive UI, so React/Vue would add complexity without benefit.
- `SourceResult<T>` failure-isolation envelope established here. Every data source is wrapped so cards render independently. One source erroring never blanks out another card.
- Pub/sub store: single mutable `AppState` object, subscribers notified on every mutation. `renderAll()` is the only subscriber — re-renders all cards on any state change.

**Service worker (initial):**
Cache version `weather-v1`. Used a cache-first strategy for all same-origin GETs. This later caused a bug (see WS9).

---

## WS3 — NWS integration

No major issues. NWS's `/points` endpoint returns forecast URLs specific to each location, so the two-location structure works cleanly. Hourly and 7-day forecasts, alerts, gridpoint data (snowfall, UV), and sun times all integrated without incident.

---

## WS4 — PurpleAir + AirNow

**Architecture:** PurpleAir and AirNow API keys must never reach the browser. Both are proxied through a single serverless function (`api/air-quality.ts`). All corrections (EPA PM2.5 formula, temperature offset) are applied server-side.

**AirNow divergence threshold:** Flags PM2.5 red when `|PA − AirNow| > 5 µg/m³ AND > 10%` of the larger value. The hybrid threshold keeps it quiet in clean air and only lights up on real divergence.

---

## WS5 — CAIC integration

**Problem: CAIC looper HTML parser — multiple iterations**

The CAIC point-forecast data lives in an HTML page (`looper.avalanche.state.co.us/iptfcst/ptfcst.php`) with Highcharts series data embedded in a `<script>` block. There is no JSON API.

First approach: looked for a `categories` array in the HTML. This field does not exist. Result: null data, no chart.

Second approach: found the `name: 'Temp'` token and looked for the associated `data:` array using a simple `indexOf`. This worked in testing but was fragile — it could jump into the next series block if the structure changed slightly.

Final approach: **bracket-counting parser** (`extractArray` + `findSeriesData` in `api/caic.ts`). Scans character by character, counting `[` and `]` to find the balanced end of each array. Handles nested arrays correctly. More robust than simple string search.

**CAIC elevation correction:**
Initially hardcoded at 10,500 ft (a rough estimate). The looper page returns the actual elevation in a JavaScript variable: `var elev = 9219`. Updated to 9,219 ft. This is the elevation labeled on the Temperature Forecast chart for the CAIC series.

**CAIC timezone bug — discovered after WS6 chart integration:**

When the overlay chart was built, the CAIC data appeared shifted ~4 hours behind NWS. Investigation showed the looper uses `Highcharts: { useUTC: false }`, which encodes Mountain local time (e.g., 2:00 PM MDT) as if it were a UTC timestamp (2:00 PM UTC). The fix: add the Mountain UTC offset when converting timestamps to ISO strings.

Initial fix: hardcoded `6 * 3_600_000` (MDT = UTC−6). This was correct for summer but would drift by 1 hour in winter (MST = UTC−7). Both `api/caic.ts` and `api/brief.ts` were updated to use a dynamic offset derived at request time:

```typescript
function looperOffsetMs(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date());
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";
  const m = tz.match(/GMT-(\d+)/);
  return m ? parseInt(m[1], 10) * 3_600_000 : 7 * 3_600_000;
}
```

Fallback is 7h (MST) — the more conservative value.

---

## WS6 — Overlay chart

Chart.js was used for the temperature overlay (tree-shaken imports to keep bundle size down). The chart shows NWS hourly temperature and CAIC point-forecast temperature on shared axes, with each series' elevation clearly labeled in the legend to prevent misreading an elevation gap as model disagreement.

**Card extraction:** The chart was originally inside the CAIC Weather Summary card. During a UI reorganization, it was extracted into its own `#chart-region` card so it could be independently positioned in the desktop grid layout.

---

## WS7 — Tomer embed

**Descoped from original spec:** The original spec called for embedding the YouTube video iframe. The final implementation shows the video's title and description text only. This avoids iframe sizing complexity and keeps the card lightweight. The YouTube Data API key is used server-side to fetch the latest "Mountain Weather Update" video metadata.

---

## WS8 — Consensus brief

**Problem: Vercel cron jobs require Pro plan**

The spec assumed a scheduled job to regenerate the brief. `vercel.json` was updated to add a cron entry. Every deployment showed red X marks in GitHub Actions with a link to `vercel.com/docs/cron-jobs/usage-and-pricing`. Cron requires the Pro plan ($20/month) which is not compatible with the "zero recurring cost" goal.

**Solution:** Removed cron entirely. The brief is regenerated on demand when the CDN cache expires (10 minutes). The next page load after expiry triggers a fresh Claude Haiku call and re-caches the result. Cost impact: pennies/month.

**Problem: Vercel cannot bundle cross-api imports**

Initial structure had `api/brief.ts` (handler) and `api/brief-generate.ts` (generation logic). Vercel bundles each api file independently; an import from `./brief-generate` crashed the function at module load time with a 500 error. The stub handler (with no imports) worked fine, confirming this was the root cause.

**Solution:** Merged all generation logic into a single self-contained `api/brief.ts`. Deleted `brief-generate.ts` and `brief-cron.ts`. This is a general rule: each `/api/` file must be fully self-contained; no cross-file imports within `/api/`.

**Problem: @vercel/kv not available**

The spec mentioned Vercel KV for caching. The user's Vercel account (free Hobby tier) does not have KV available — only Blob and Edge Config. Switched to **Vercel Blob** (`@vercel/blob`). The `readCached` function uses `list({ prefix: "consensus-brief" })` to find the blob, then fetches its public URL. `writeCached` uses `put("consensus-brief.json", ..., { addRandomSuffix: false })` to overwrite in place.

**Problem: Anthropic API 400 "credit balance too low"**

The brief API returned 400 from the Anthropic API after the key was configured. The user's Anthropic Console account needed credits added (separate from Claude Pro subscription — the Pro subscription does not cover API usage). Fixed by adding credits at console.anthropic.com.

---

## WS9 — Polish + harden

**Service worker API bypass (iOS Safari bug):**

The service worker (cache version `weather-v1`) intercepted all same-origin GET requests, including `/api/` routes. On iOS Safari, when navigating directly to an API endpoint URL, the SW would return null (the cached response was empty for those routes). This broke direct API testing from the phone.

**Fix:** Added early return in the fetch handler:
```javascript
if (request.url.includes("/api/")) return;
```
Bumped cache version to `weather-v2` to force the old cache (including any stale API responses) to be deleted on activate.

**Hardening pass — all cards:**
- Every card uses `SourceResult<T>` with three states: loading (skeleton shimmer), error with fallback (stale data + red border + error message in footer), hard error (error card with no data).
- `cardFooter()` utility appends "Last updated HH:MM" and any error string to every card.
- Chart card: added hard-error state (was previously stuck showing skeleton forever if NWS hourly failed).
- Conditions card: fixed timestamp fallback to include `gridResult.lastGoodUpdated` (was stopping one step short).

---

## WS10 — Final tuning

**GPG stop-hook fix:**

Every commit triggered a warning from `~/.claude/stop-hook-git-check.sh` about unverified commits. The awk filter was:
```bash
awk '$2 == "N" || $3 != "noreply@anthropic.com"'
```
This flags a commit if it's unsigned OR if the committer isn't the Anthropic bot — meaning Claude's unsigned commits always tripped it. Changed `||` to `&&`:
```bash
awk '$2 == "N" && $3 != "noreply@anthropic.com"'
```
Now only flags commits that are both unsigned AND not from the bot. Claude's commits (unsigned, from `noreply@anthropic.com`) are silently skipped.

**Dynamic MST/MDT offset:** Implemented in both `api/caic.ts` and `api/brief.ts` (see WS5 above).

---

## Desktop layout (post-WS10)

Added after all workstreams were complete, driven by user feedback on the desktop viewing experience.

**Iterations:**

1. **First pass:** Two-column 640px grid — conditions and AQ side by side, everything else full-width. The 640px breakpoint was too narrow to feel like a true desktop layout.

2. **Second pass:** 960px breakpoint, three-column grid (30/40/30), header tabs condensed to left 1/3. Issues: tabs felt awkward in the left 1/3 with empty space to the right; hourly strip overflowed its column.

3. **CSS Grid `min-width: auto` trap:** The hourly strip's `hour-block` elements (`flex-shrink: 0`, 70px each) caused the center grid column to expand to fit all 24 hours, squishing CAIC and Tomer. Fix: `min-width: 0` on all direct children of `.desktop-top-row` and `.desktop-bottom-row`.

4. **Option C — adaptive bottom row:** Full-width hourly strip; CAIC + Tomer in a 50/50 row below. In 7-Day view, reverts to 30/40/30 three-column layout. Implemented via CSS `grid-template-areas` keyed off the existing `data-view` attribute on `.content` — no JavaScript changes needed.

5. **Header alignment:** "WEATHER" title stays at screen left edge. Tab bar and toggle align with card columns via `max-width: 1600px; margin: 0 auto; padding: 0 1.5rem` applied independently to `.tab-bar` and `.view-toggle`. The `.app-header` itself is not constrained so the title stays at screen-left with its natural 1rem padding.

**Design refinements during desktop work:**
- Active tab text: changed from white (`--fg`) to lavender (`--accent`) to match the underline
- "WEATHER" title: changed from muted gray (`--muted`) to lavender (`--accent`)
- Card headings (`.card-title`): changed from muted gray to lavender — applies to both mobile and desktop
- Hourly strip on desktop: added thin visible scrollbar (`scrollbar-width: thin`) so users can see and use horizontal scroll when 24 hours slightly exceed the container width

---

## General lessons learned

**Vercel serverless function rules:**
- Each file in `/api/` is bundled independently. Cross-file imports within `/api/` do not work — they crash the function at module load time with a 500 error. Keep every api file self-contained.
- Dynamic imports (e.g., `await import("@vercel/blob")`) work fine and can be used to guard optional dependencies.
- `/api/` files are not covered by the project `tsconfig.json` — TypeScript errors in api files are not caught by `tsc` during the build. Test api endpoints directly after changes.

**CSS Grid `min-width: auto`:**
Grid children default to `min-width: auto`, which means they can expand beyond their defined column width if their content is wider. Always add `min-width: 0` to grid children when any child might contain overflowing content (scroll strips, long text, charts).

**Service worker and API routes:**
Never let a service worker cache serverless function responses. The SW should intercept only the app shell (HTML, CSS, JS, icons). API routes must bypass the SW entirely so they go to the network and hit the CDN cache managed by `Cache-Control` headers.

**GitHub token expiry:**
The GitHub personal access token used for pushing expires per session in the remote build environment. At the start of any session that needs a push, run:
```bash
git remote set-url origin https://skrab011:YOUR_GITHUB_TOKEN@github.com/skrab011/weather-dashboard.git
```
The token is stored separately (not in this repo). Generate a new one at github.com → Settings → Developer settings → Personal access tokens if the current one has expired.

---

## V2 — Shared Page Build (merged to `main` 2026-06-19)

### Overview

A second page at `/shared` that lets friends and family enter their own US locations. Built as a multi-page Vite app alongside V1 — same repo, same Vercel project, same `/api/` layer. The personal page (V1) was left completely unchanged.

### W0 — Multi-page scaffold

Added `vite.config.ts` with `rollupOptions.input` for both `index.html` (main) and `shared.html` (shared). Created a placeholder `src/shared-main.ts`. Verified that `npm run build` emits both `dist/index.html` and `dist/shared.html`. No V1 files touched.

### W1 — Shared-module extraction (highest-risk step)

Moved the reusable engine into `src/shared/` across four sub-steps, one commit each:
1. Moved pure modules (`types.ts`, `nws.ts`, `sun.ts`, `chart.ts`, `caic.ts`, `tomer.ts`) and repointed V1 imports.
2. Extracted pure card renderers from `src/render.ts` into `src/shared/cards.ts`. Two V1 hardcodes decoupled: `locId === "home"` for PA temp became a `showPaTemp: boolean` arg; the 2-tab assumption stayed in `render.ts`.
3. Converted `src/store.ts` into a store factory (`createStore(locations)`) in `src/shared/store.ts`; a thin `src/store.ts` wrapper re-exports instance members so `main.ts` was untouched.
4. Relocated `airQuality.ts` + `brief.ts` as-is (lat/lon and dual-mode refactors deferred to W2/W6).

**V1 verification technique:** the build environment blocks live weather hosts, so V1 was proven unchanged via source-level normalized HTML-template diff (zero differences in any template literal), identical bundle output, and owner preview-vs-prod comparison. This is the reusable technique when live data is inaccessible.

**Knock-on effect:** once `shared-main.ts` imported the shared engine in W4, Vite code-split the common modules into a `cards-*.js` chunk both pages load. V1 behavior is identical but bundle filenames changed — expected and not a regression.

### W2 — Backend parameterization

`api/air-quality.ts`: added `?lat=&lon=&temp=` path alongside unchanged `?location=home|office`. Runtime-overloaded frontend `fetchAirQuality`: string first arg → legacy path, number first arg → lat/lon path. All three V1 call sites emit byte-identical requests.

`api/brief.ts`: added `?lat=&lon=&co=` path; per-location Blob cache key (`brief-{lat.toFixed(2)}_{lon.toFixed(2)}.json`). No-param path still uses `consensus-brief.json`. `fetchBrief` got an optional third arg; with no options, both V1 call sites reproduce their original URLs exactly.

US bounding-box validation added to both endpoints (rejects non-US coords so owner's API keys can't be used as open relays).

### W3 — Geocoding

`api/geocode.ts`: US Census Geocoder primary (`onelineaddress?benchmark=Public_AR_Current`), OpenStreetMap Nominatim fallback (`countrycodes=us`). Decision to add Nominatim was made during this workstream — Census is address-grade and weak on bare city/ZIP input, which is what casual users type. Both sources US-restricted. Long CDN cache (results are stable). Self-contained per the `/api/` no-cross-import rule.

`src/shared-page/geocode.ts`: frontend client calling `/api/geocode?q=...`; computes `inColorado` (`state === "CO"`, CO bounding-box fallback for edge cases).

### W4 — Location picker + persistence

- `src/shared-page/persistence.ts`: versioned localStorage key `weather-shared-locations-v1`; cap 2, corruption-tolerant, returns `[]` on any parse error.
- `src/shared-page/picker.ts`: single screen for both onboarding (empty state) and manage (add/remove). Search → geocode → persist flow; US-only messaging for non-US results; de-dupe by rounded coords.
- `src/shared-page/render.ts`: `renderSharedShell` builds tab bar from chosen locations + "Edit locations" button; `makeRenderAll(store, locations)` wires state into the shared card renderers.
- `src/shared-main.ts` (rewritten): boot reads stored locations; if empty → picker; else seeds `createStore()` and runs V1-style NWS + air-quality fetches (lat/lon path) + zone-wide CAIC/Tomer + per-location brief that refetches on tab switch.

No V1 source touched. `style.css` got an additive picker section (later split out — see post-merge CSS split).

### W5 — Colorado gating

`data-co` attribute set on `.content` by `makeRenderAll` based on `loc.inColorado`. CSS hides `#caic-region` and `#tomer-region` when `data-co="false"`. Desktop grid collapses the bottom row to full-width forecast when CO cards are absent (no layout holes).

Chart rendered for all locations regardless of CO status (decided during this workstream as a feature improvement over the original plan, which had the chart CO-gated too).

CAIC and Tomer fetches skipped entirely when no saved location is in CO (`anyInCO` flag in `shared-main.ts`).

### W6 — Dual-mode brief

`api/brief.ts`: `co=true` → NWS + CAIC consensus prompt (V1 behavior); `co=false` → NWS-only plain-language forecast prompt, CAIC fetch skipped. Both modes cached under per-location Blob key. Brief card title: "Consensus Brief" in CO, "Forecast Brief" elsewhere. Manual refresh passes `inColorado` so the correct prompt is used on re-fetch.

### W7 — Polish, PWA, service worker, README

Service worker bumped to `weather-v3`; `/shared` added to `PRECACHE` list. `shared.html` title set to "Weather". No separate PWA manifest for `/shared` — keeping it simple; users can bookmark or use the V1 install. README updated with a "Shared page (V2)" section.

### W8 — QA matrix + merge

Full verification matrix passed (personal page unchanged, CO locations, non-CO locations, non-US search, empty/return visit, mobile + desktop). Feature branch `claude/weather-dashboard-v2-plan-u0x6jl` fast-forward merged to `main`. 33 files changed in merge.

---

### Post-merge additions (all directly on `main`)

**Bug: `/shared` returned 404 after merge.**
Root cause: Vercel serves `dist/shared.html` at `/shared.html` by default; without `cleanUrls: true`, the clean URL `/shared` returns 404. Fix: added `"cleanUrls": true` to `vercel.json`. This also auto-redirects `/shared.html` → `/shared`. Discovery: this is a Vercel-specific behavior that differs from how `vite preview` serves files locally.

**Bug: CAIC series bleeding into non-CO location charts.**
When a user saves both a CO and a non-CO location, `fetchCAIC` runs (because `anyInCO === true`) and populates `state.caic.pointForecast` with real CO zone data. Switching to the non-CO tab, `renderChart` was still receiving that real CAIC data and drawing the series. Fix: in `src/shared-page/render.ts`, explicitly pass a null `SourceResult` for non-CO tabs:
```typescript
const caicForChart = loc.inColorado
  ? state.caic.pointForecast
  : { data: null, error: null, lastUpdated: null, lastGoodData: null, lastGoodUpdated: null };
```
Owner verified fix across multiple non-CO locations.

**Feature: PA temperature dynamic on shared page.**
Original implementation had `showTemp: false` hardcoded for all shared-page locations. Changed to `showTemp: true` — the API already handles this gracefully (returns `tempF: null` when no PurpleAir sensors are within 4 miles). The render layer checks `!!weather.airQuality.data?.tempF` and hides the PA temperature row when null. No UI change for users in sensor-dense areas; clean omission for users without nearby sensors.

**Feature: NWS elevation from live gridpoint data.**
Previously `src/shared/chart.ts` had a `LOC_ELEV_FT` lookup table keyed by `"home"` / `"office"`. Removed in favor of reading `properties.elevation` (in meters) from the live NWS gridpoint API response. Added `elevationM?: number` to `NWSGridpoint` in `src/shared/types.ts`; `fetchGridpoint` in `src/shared/nws.ts` extracts it. Chart renderers receive `nwsElevFt: number | null` and show the elevation label only when ≥ 5,000 ft (below that threshold the label reads "NWS Temperature"). Decision rationale: elevation is critical context in mountainous areas; irrelevant (and potentially confusing) at low altitude. Applies to both V1 and V2.

**Feature: V2-specific CSS split to `src/shared-page/style.css`.**
All V2-specific rules (picker UI, CO-gating overrides) were moved out of `src/style.css` into a new `src/shared-page/style.css`, imported only by `src/shared-main.ts`. V1 now loads ~2.9 kB less CSS (picker and gating rules are never in its bundle). The CO-gating rules in `src/shared-page/style.css` differ from the original plan: the chart is not CO-gated, so only `#caic-region` and `#tomer-region` are hidden; the top row stays 3-column for all locations.

**Out-of-plan V1 fix (2026-06-19):** 7-day desktop layout — CAIC and Mountain Weather Update cards were stretching to the 7-Day card's height due to `align-items: stretch` on `.desktop-bottom-row`. Fixed to `align-items: start`. Shipped directly to `main` (pure V1 bug, independent of V2).

**Feature: sticky nav on mobile (both V1 and V2, 2026-06-19).**
The header and Hourly/7-Day toggle were previously two separate elements in the page flow. On mobile, the toggle scrolled off-screen as soon as the user scrolled past it — requiring a scroll back to the top to switch views. Fix: wrapped both `<header class="app-header">` and `<div class="view-toggle">` in a new `<div class="sticky-nav">` container. `.sticky-nav` is `position: sticky; top: 0; z-index: 10` on mobile so both stay pinned together. On desktop (960px+), `.sticky-nav` reverts to `position: static` (desktop cards are all visible at once so pinning wastes vertical space). Applied to both `src/render.ts` (V1) and `src/shared-page/render.ts` (V2).

**Feature: V2 distinct color palette (2026-06-19).**
At a family member's request, the V2 shared page was given a lighter, warmer background. V1's near-black blue-tinted palette (`--bg: #0b0d11`) was designed for the personal page and stayed unchanged. V2's `src/shared-page/style.css` overrides the `:root` CSS tokens with a neutral dark-gray palette:

| Token | V1 value | V2 value |
|---|---|---|
| `--bg` | `#0b0d11` | `#292929` |
| `--surface` | `#13161d` | `#34363b` |
| `--surface-raised` | `#1c2030` | `#3d4047` |
| `--border` | `#252a38` | `#46494f` |
| `--accent-dim` | `#241c3a` | `#3a2a62` |
| `--muted` | `#6b7280` | `#8a95a8` |

The initial V2 bg tried was `#293040` (a blue-navy), but after iteration the final choice was `#292929` — a neutral dark gray. The surface tokens were then adjusted from their blue-tinted values to neutral-cool grays that maintain the same card-elevation hierarchy (each token steps up ~4–5 lightness points above the one below it). The `--accent-dim` purple for active tabs was kept and proportionally lifted. V1 loads none of these overrides — they are scoped to V2 via the CSS import in `src/shared-main.ts`.

**Bug: hourly time labels unreadable after surface color change (two-pass fix).**
After the surface tokens were updated, the hourly strip time labels ("11:00 AM", "12:00 PM", etc.) and card footer timestamps became very hard to read. Root cause: these elements use `--muted: #6b7280`, which has only ~2:1 contrast against the new `--surface: #34363b` — far below the minimum needed for small (0.75rem) text. First fix: added `--muted: #8a95a8` to V2's `:root` override (~3.7:1 contrast). Still not legible enough due to the small font size and light weight. Second fix: added an explicit `.hour-time` override in `src/shared-page/style.css` matching the Now card's `.cond-value` style — `font-size: 0.95rem`, `font-weight: 500`, `color: var(--fg)`. This uses the full primary text color and a heavier, larger rendering, making the labels clearly readable. V1 unchanged.

---

## Post-V2 improvements (2026-06-20)

**Fix: blank page after Vercel deployments, requiring manual refresh (both V1 and V2).**

**Root cause:** The service worker uses stale-while-revalidate — it serves the cached version of the page immediately, then fetches a fresh version in the background for next time. After a Vercel deployment, the cached HTML references old JavaScript filenames (Vite hashes filenames on every build, e.g. `assets/index-abc123.js`). Vercel only serves the *current* deployment's assets on the production domain — the old filename is gone. The SW served the stale HTML, the browser requested the old JS file, the SW had no cached copy and Vercel returned 404, so the JS failed to load silently. Result: blank page. A manual refresh served the newly cached HTML (from the background fetch), which referenced the new JS filename, which loaded fine from the network.

**Fix:** Added an `updatefound` listener to the service worker registration in both `src/main.ts` (V1) and `src/shared-main.ts` (V2). When a new SW finishes installing and transitions to `activated`, the page calls `window.location.reload()` automatically. A `hadController` guard (captured at registration time) ensures the reload only fires on *updates* — if no SW was previously controlling the page (first ever visit, empty cache), `hadController` is `false` and no reload happens.

```typescript
const hadController = !!navigator.serviceWorker.controller;
navigator.serviceWorker.register("/sw.js").then((registration) => {
  registration.addEventListener("updatefound", () => {
    const newWorker = registration.installing;
    if (!newWorker) return;
    newWorker.addEventListener("statechange", () => {
      if (newWorker.state === "activated" && hadController) {
        window.location.reload();
      }
    });
  });
}).catch(() => {});
```

No changes to `public/sw.js` were required — the existing `skipWaiting()` + `clients.claim()` already causes immediate activation, which is what triggers the `statechange` event the page listens for.

**Bonus fix: V2 had no SW registration at all.**
`src/shared-main.ts` never had a `serviceWorker.register()` call — the shared page was never registering the SW, so it had no offline caching and no PWA behavior. The fix adds the full registration block (with the `updatefound` listener) to `src/shared-main.ts` as part of this same change.

**Fix: V2 not installable as a PWA (2026-06-20).**

A family member on Android 13 (Samsung) couldn't install V2 as a PWA — the browser offered "Add Shortcut" instead of a proper install prompt, and nothing appeared on her home screen.

Root cause: `shared.html` had no `<link rel="manifest">` tag. Without a web app manifest, browsers can't verify PWA installability criteria (the `display: standalone` field is what unlocks the install prompt). The W7 build decision deliberately omitted a V2-specific manifest ("keeping it simple; users can bookmark or use the V1 install"). That decision was made without consulting the owner and turned out to be wrong — a family member accessing only V2 at `/shared` has no path to a V1 install, and the experience was visibly broken.

Fix: Created `public/manifest-shared.json` with:
- `name: "Weather – Shared"`, `short_name: "Weather"`
- `start_url: "/shared"`, `scope: "/shared"` — the `scope` field is key: it scopes the PWA to `/shared`, so V1 and V2 install as independent apps on the home screen rather than conflicting.
- V2 color tokens (`background_color` and `theme_color` both `#292929`)
- Same icon set as V1 (all three sizes, `"purpose": "any"`)

Also added full iOS meta tags to `shared.html` that had been completely missing:
```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Weather" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```
Without these, iOS Safari ignores the web manifest for home screen purposes and doesn't use the app icon correctly.

Also fixed: `shared.html` had `theme-color` set to `#0b0d11` (V1's near-black), not V2's `#292929`. Corrected.

`manifest-shared.json` added to the SW `PRECACHE` list so it's available offline.

**Fix: icon appearance changed after reinstall — iOS lavender W became washed out (2026-06-20).**

After reinstalling the PWA on iOS during troubleshooting, both V1 and V2 icons showed a lighter, whitish W instead of the expected solid lavender W.

Root cause: both `manifest.json` and `manifest-shared.json` had `"purpose": "any maskable"` on all icon entries. iOS 16.4+ added support for maskable (adaptive) icons: when a manifest icon has `"purpose": "maskable"` or `"any maskable"`, iOS treats it as an adaptive icon — it applies safe-zone cropping (shrinks the image to fit within an inset circle) and may apply a tint or background. The existing icon images were not designed as maskable icons (they don't have a safe zone), so this cropping and processing made the W appear lighter and resized.

Fix: changed all icon `"purpose"` values from `"any maskable"` to `"purpose": "any"` in both `manifest.json` and `manifest-shared.json`. With only `"any"`, iOS falls back to the explicit `<link rel="apple-touch-icon">` link in the HTML, which renders the PNG as-is without adaptive processing.

Note for existing installs: the icon won't update automatically. Users who installed before this fix need to remove the app from their home screen and re-add it to see the correct icon.

**Improvement: geocoder location labels cleaned up (2026-06-20).**

Two label-formatting issues were discovered in `api/geocode.ts`:

*Nominatim (handles city/ZIP/place queries):* Was returning `display_name` verbatim. Nominatim formats `display_name` as a long string like "Silverthorne, Summit County, Colorado, United States" — containing county and country, which is visual clutter for a tab label. Fix: read from Nominatim's structured `address` object instead. Priority order: `city` → `town` → `village` → `municipality` → `suburb` → `neighbourhood` → `county`. Combine with the 2-letter state abbreviation (extracted from the `ISO3166-2-lvl4` field, e.g. "US-CO" → "CO") to produce "City, ST". Falls back to `display_name` only if neither a place name nor state can be found.

*Census Geocoder (handles street address queries):* Returns all-caps matched address including trailing ZIP, e.g. "42 LACY DR, SILVERTHORNE, CO, 80498". This was being used as the label directly. Fix: added `titleCaseAddress()` helper:
1. Strip trailing ZIP — Census uses a comma-before-ZIP format (", 80498"), so the regex uses `/,?\s+\d{5}(?:-\d{4})?$/` (optional leading comma). A second `.replace(/,\s*$/, "")` strips any leftover trailing comma from edge cases.
2. Lower-case the whole string, then title-case each word boundary (`\b\w`).
3. Restore the state abbreviation to uppercase — after ZIP strip it appears at the very end of the string, so `/\b[A-Za-z]{2}$/` matches it and uppercases it.

Result: "42 Lacy Dr, Silverthorne, CO".

Bug encountered: first ZIP strip regex was `/\s+\d{5}(?:-\d{4})?$/` (space-before-ZIP only). Census actual format has a comma before the ZIP ("CO, 80498"), so stripping " 80498" left "CO," → title-cased to "Co," → state-uppercase regex `/\b[A-Za-z]{2}$/` failed (string ended with comma, not a letter). User reported seeing "42 Lacy Dr, Silverthorne, Co,". Fixed by making the leading comma optional in the strip regex and adding the fallback comma cleanup.

Labels are stored in `localStorage` at search time; previously saved locations retain their old label until the user removes and re-adds the location.

---

## Forecast comparison upgrade (2026-06-22 →)

A multi-step epic to make the forecast comparison chart and AI brief more
useful for both V1 and V2. Full plan, sequencing, and per-step session prompts
live in `forecast-upgrade-plan.md`. Tracks: **D** (AFD → brief), **A**
(Open-Meteo / ECMWF model series on the chart — the keystone), **B**
(disagreement-highlight band), **C** (Temp/Wind/… variable toggle). Order:
**D → A → B → C**. Rollout: build in the shared engine, prove on V1 first
(always has CAIC = richest test), confirm V2, merge to `main` per verified step.

### D1 — NWS Area Forecast Discussion folded into the brief ✅ (merged to `main`)

**What & why.** The brief previously ingested NWS + CAIC only. The NWS Area
Forecast Discussion (AFD) is a forecaster-written regional narrative published
nationwide, free and keyless via `api.weather.gov` — the closest national
equivalent to CAIC's write-up. Folding it into the brief adds real regional
reasoning everywhere (the biggest win is V2's non-Colorado locations, which had
no narrative source at all) and, because Claude rewrites it, stays readable for
a lay audience.

**Implementation (all in `api/brief.ts`, kept self-contained per the `/api`
no-cross-import rule).**
- New `fetchAFD(office)`: two sequential keyless calls —
  `/products/types/AFD/locations/{office}` for the newest product, then its
  `@id` for `productText`. Collapses blank lines and caps length at 1,800 chars
  to keep AI token cost trivial. Wrapped so it **never throws** — any failure
  returns `"Unavailable"`, so a missing AFD never blocks brief generation
  (failure isolation).
- The forecast office id is read from the existing `/points` response
  (`properties.gridId`, e.g. `"BOU"`) inside `fetchNWS`, and AFD is fetched as a
  4th parallel call alongside hourly/7-day/alerts.
- The trimmed AFD is injected into **both** prompt variants (CO consensus and
  non-CO forecast) with an instruction to translate forecaster jargon
  ("shortwave trough", "h5 ridging", "CAA") into plain language.

**Cost note.** Runtime AI cost is still the existing Anthropic key (Haiku,
pennies/month); AFD adds a small number of input tokens. The Claude Pro limit
applies only to *build* sessions, not the running app.

**Verification.** Owner compared the preview-deploy brief (`/api/brief?refresh=true`
for V1, and `?lat=30.27&lon=-97.74&co=false&refresh=true` for a non-CO example)
against production and confirmed the briefs read richer and more regional, with
jargon translated. Merged to `main` 2026-06-22.

### Track A — Open-Meteo (ECMWF) model line on the comparison chart ✅ (merged to `main`)

**What & why.** The comparison chart showed only NWS + CAIC. Open-Meteo
(`api.open-meteo.com`) is a free, keyless, CORS-friendly service that serves
several global models; we added **ECMWF** (the European model) as a third line.
Biggest win: non-Colorado V2 locations, which had no second source at all, now
get a real model to compare NWS against. ECMWF also supplies clean, consistent
multi-variable data that Tracks B (disagreement band) and C (variable toggle)
build on.

**Implementation, in three small steps (one commit each):**
- **A1** — `src/shared/openmeteo.ts`: `fetchOpenMeteo(lat, lon)` (ECMWF,
  °F/mph/inch, `forecast_days=3`, `timeformat=unixtime` for unambiguous UTC
  timestamps) returning normalized hourly rows (`dateTime`/`tempF`/`windMph`/
  `precipIn`/`snowIn`, mirroring `CAICPointForecastRow`) + grid-cell
  `elevationFt`. A `series()` accessor tolerates both unsuffixed and
  `{key}_{model}` field names so adding GFS/ICON later (A4) is trivial. New
  `OpenMeteoForecast`/`OpenMeteoRow` types. Called direct from the browser like
  NWS — no serverless proxy, no key.
- **A2** — `openMeteo: SourceResult<OpenMeteoForecast>` added to
  `LocationWeather`, seeded in `createStore`, fetched per location in both boot
  files (`main.ts`, `shared-main.ts`) in parallel with NWS + air quality via a
  non-throwing `fetchOpenMeteoResult()` wrapper (mirrors `settle()`). The
  `NWSWeatherResult` Omit also excludes `openMeteo` so `fetchAllForLocation`
  still type-checks. Nothing drawn yet.
- **A3** — `renderChart` → `renderOverlayChart` gain the Open-Meteo result and
  draw it as a third dataset (cyan `#4dd0e1`), aligned to the NWS hourly axis
  the same way CAIC is, with a model-elevation label using the same ≥ 5,000 ft
  threshold. Guarded: skipped when data is null, so the chart still draws NWS
  (+ CAIC) without it.

**Notes / watch-items.**
- ECMWF's grid-cell elevation can read lower than reality in the mountains
  (global models use smoothed terrain) — the elevation label exists precisely so
  that gap reads as elevation, not model disagreement.
- Open-Meteo asks for a "Weather data by Open-Meteo.com" attribution; to be added
  in the chart UI (folded into a later polish step).
- Wind/precip/snow are fetched now but not yet drawn — they wait for the variable
  toggle (Track C). Confirm precip/snow units against the live feed when C plots
  them.

**Verification.** Owner verified the three-line chart on V1 (preview deploy).
Merged to `main` 2026-06-22.

### Track B (B1) — model-disagreement band on the comparison chart ✅ (merged to `main`)

**What & why.** With 2–3 model lines now on the chart, the useful signal is
*where they diverge*. B1 shades the per-hour spread between the available
lines so agreement (pinched band) vs. disagreement (wide band) reads at a
glance — turning the chart from "pretty" into "tells you when to trust it".

**Implementation (all in `src/shared/chart.ts`).**
- Per hour, gather that hour's non-null values across `nwsTemps` / `caicTemps` /
  `omTemps`; if ≥2 exist, the band's max = `Math.max`, min = `Math.min`,
  otherwise null (gap). The whole band is drawn only when ≥2 series are present,
  so V1 (3 lines) and non-CO V2 (NWS + ECMWF) get it; NWS-only does not.
- Implemented as two extra datasets inserted at the **front** of the dataset
  array (so they render *behind* the lines): a `__band_max` dataset with the
  neutral fill that fills down to the next dataset (`fill: "+1"`), and a
  `__band_min` dataset (transparent). Required registering Chart.js's `Filler`
  plugin (the model lines use `fill: false`, so it wasn't needed before; adds
  ~8 kB to the cards chunk).
- The helper datasets are flagged with a `"__"` label prefix and excluded from
  the **legend** (`labels.filter`) and **tooltip** (`tooltip.filter`), so the UI
  still shows only the three real model series and hover still reads real values.

**Tuning.** Initial fill opacity `0.13` read too light on the owner's preview;
bumped to `0.22` (still subtle background, not a fourth line). Owner verified.
Merged to `main` 2026-06-22.

### Track B (B2) — model-spread note folded into the AI brief ✅ (merged to `main`)

**What & why.** B1 made disagreement visible *on the chart*; B2 makes it
*readable* in the brief. Chosen over a chart caption (owner picked option 1) to
keep the chart clean and let Claude phrase the spread naturally. Also upgrades
non-CO V2 briefs, which previously summarized NWS alone, into a real two-model
(NWS vs. ECMWF) comparison.

**Implementation (all in `api/brief.ts`, self-contained).**
- New non-throwing `fetchOpenMeteo(lat, lon)` (keyless) returns a compact
  next-48h ECMWF hourly temperature listing, labeled in `America/Denver` to
  match the existing NWS hourly block so Claude compares matching timestamps;
  `"Unavailable"` on any failure. Fetched for **every** location (ECMWF is
  global) in the same `Promise.all` as NWS/CAIC.
- Injected into both prompt variants with updated instructions: compare NWS /
  CAIC / ECMWF (CO) or NWS / ECMWF (non-CO) and call out agreement vs.
  divergence.

**Note (expected behavior).** The prompt keeps "flowing prose, plain language,"
so the brief does **not** name sources robotically ("the models agree…", not
"NWS says X, ECMWF says Y"). Owner confirmed this reads well; explicit
attribution would be a one-line prompt change if ever wanted. In calm weather
the models often agree and the brief only briefly notes it — the divergence
language earns its keep in unsettled periods. Merged to `main` 2026-06-22.

### Track C (C1) — Temp/Wind variable toggle on the comparison chart ✅ (merged to `main`)

**What & why.** Let the chart show one variable at a time via a small Temp/Wind
segmented control, starting with the two cleanest variables. Open-Meteo (Track A)
made this tractable by supplying wind in consistent units alongside CAIC.

**Implementation.**
- State: new `ChartVar = "temp" | "wind"` and `activeChartVar` on `AppState`
  (default `"temp"`), with a `setActiveChartVar` setter on the store factory,
  re-exported from the V1 `src/store.ts` wrapper. Both render wrappers pass
  `activeChartVar` + the setter into `renderChart`.
- UI: `renderChart` (in `src/shared/cards.ts`) renders the segmented control in
  the card and attaches click handlers (re-attached each render, like the brief
  refresh button). New `.chart-var-toggle` / `.chart-var-btn` /
  `.chart-var-btn--active` CSS in `src/style.css` — **own classes**, deliberately
  not the `.toggle-btn` ones, because the existing Hourly/7-Day wiring does a
  broad `querySelectorAll(".toggle-btn")` that would otherwise capture these
  buttons. Styling reuses existing design tokens (no new colors).
- Chart: `renderOverlayChart` takes a `variable` arg and is now variable-aware —
  a generic `alignToNws()` helper picks each source's field for the selected
  variable (NWS wind parsed from its `"10 mph"`/`"10 to 15 mph"` string, averaged
  on a range; CAIC `windSpeedMph`; ECMWF `windMph`); the Y-axis title/units,
  tooltip unit, series labels (elevation for temp only), `aria-label`, and the
  disagreement band all switch with the variable. `caicHasData`/`omHasData`
  guards skip a source that has no values for the chosen variable so there's no
  orphan legend entry.

**Watch-items.** NWS wind ranges are averaged to a single value (deliberate
simplification). Verified on mobile (V1); desktop spot-check deferred (owner away
from desktop) — additive change, Temp view identical to prior production. Merged
to `main` 2026-06-22.

### Track C (C2) — Precip/Snow as amounts on the chart ✅ (merged to `main`)

**What & why.** Completed the variable toggle with Precip and Snow, plotted as
**amounts in inches**. NWS is deliberately omitted for these — its hourly feed
reports precip *probability* (%), not an amount, so it can't share the axis
honestly (the mismatch flagged at the start of the epic). So Precip/Snow draw
**CAIC + ECMWF only** (CAIC + ECMWF in CO; ECMWF alone outside CO).

**Implementation (`src/shared/chart.ts`, `cards.ts`, `style.css`).**
- `ChartVar` extended with `"precip" | "snow"`. `renderOverlayChart` computes an
  `isAmount` flag; for amount variables it skips the NWS dataset (`includeNws`),
  selects each source's `precipIn`/`snowIn` field, sets the Y-axis title/units to
  inches, anchors the axis at zero (`beginAtZero`), and uses straight segments
  (`tension: 0`) so a 0→spike→0 line can't visually dip below zero. The
  disagreement band is built from whatever series are actually drawn.
- Two more toggle buttons (Precip, Snow); `.chart-var-toggle` now `flex-wrap`s
  for the four buttons on narrow screens.

**Units note (important).** CAIC precip/snow are **inches** — confirmed by the
owner from prior looper experience. **Open-Meteo precip/snow units are not yet
verified against live data**: we request `precipitation_unit=inch`, but
Open-Meteo sometimes reports snowfall in cm regardless. Verify magnitudes during
the next rain (precip) and the first winter snow (snow); if the ECMWF snow line
reads ~2.5× too high, add a cm→inch conversion in `src/shared/openmeteo.ts`.
Shipping in June is low-risk (snow ≈ 0 everywhere). Verified on mobile; merged to
`main` 2026-06-22.

---

## Forecast comparison upgrade — COMPLETE (2026-06-22)

All four tracks shipped to production on both V1 and V2, each built in small
single-commit steps, verified on a Vercel preview, and merged to `main` only
after owner sign-off:
- **D1** — NWS Area Forecast Discussion folded into the AI brief.
- **Track A (A1–A3)** — ECMWF (Open-Meteo) line on the comparison chart.
- **Track B (B1+B2)** — model-disagreement band + plain-language model-spread
  note in the brief.
- **Track C (C1+C2)** — Temp/Wind/Precip/Snow variable toggle.

Open follow-up: confirm Open-Meteo precip/snow units (above) during the next
precipitation/snow event.

### Track A (A4) — GFS (American model) added ✅ (merged to `main`)

**What & why.** Added GFS alongside ECMWF so the chart and brief carry both the
European and American global models (plus NWS and, in CO, CAIC). For non-CO V2
locations this means three independent lines (NWS + ECMWF + GFS).

**Implementation.**
- `src/shared/openmeteo.ts`: `OPEN_METEO_MODELS = ["ecmwf_ifs025", "gfs_seamless"]`.
  Fetch **one request per model** (not a combined multi-model request) so each
  keeps its own clean grid elevation; `fetchOpenMeteo` returns
  `OpenMeteoForecast[]` (the models that succeeded; throws only if all fail).
  `LocationWeather.openMeteo` is now `SourceResult<OpenMeteoForecast[]>`.
- `src/shared/chart.ts`: draws one line per model in a loop (ECMWF cyan
  `#4dd0e1`, GFS green `#81c784` via `modelColor()`); a `drawnSeries` list feeds
  the disagreement band so it spans every line present. Added an `rgba()` helper
  for consistent faint legend-box fills.
- `api/brief.ts`: server-side fetch parameterized by model
  (`fetchOpenMeteoModel`), called for both ECMWF and GFS; both injected into the
  prompts; instructions updated to compare NWS/CAIC/ECMWF/GFS (CO) or
  NWS/ECMWF/GFS (non-CO).

**Note.** Four lines + band on V1 (temp) is about the clutter ceiling for the
"clean UI" priority — adding more models later (ICON, etc.) should be weighed
against that. Verified on mobile; merged to `main` 2026-06-22.
