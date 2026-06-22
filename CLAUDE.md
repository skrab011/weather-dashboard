# Weather Dashboard — Project Context

## Working rules
- **The owner is new to coding.** Explain things in plain language, avoid unexplained jargon, and define technical terms the first time they appear. When the owner needs to do something manually (run a command, click something in a browser or dashboard, copy a value, etc.), give **explicit, numbered, step-by-step directions** — exact commands to paste, exactly where to click, and what a correct result looks like. Never assume prior knowledge of git, the terminal, Vercel, or browser dev tools.
- Do not implement fixes, improvements, or build work unless explicitly directed to by the user. Diagnose, explain, and ask first.
- Always provide full URLs for the user to copy and paste (e.g. https://weather-dashboard-five-umber.vercel.app/api/caic, not just /api/caic).
- **Git push target:** Vercel deploys from the `main` branch on GitHub. Always push with `git push origin main` (not `git push origin main:claude/inspiring-franklin-lftofe`).
- The user works from either an **iPhone** or a **Windows desktop**. Tailor all browser instructions accordingly:
  - **iPhone (Safari):** No DevTools available. Can visit URLs directly and paste back what the browser shows. Cannot inspect network requests. For anything requiring network inspection, defer to a Windows desktop session.
  - **Windows desktop (Chrome):** Full DevTools available. Network tab: F12 → Network → filter Fetch/XHR → reload page. Use Chrome-specific instructions (not Mac/Safari instructions).
- **GitHub token** expires per session. At the start of each session that needs a push, run:
  `git remote set-url origin https://skrab011:TOKEN@github.com/skrab011/weather-dashboard.git`

---

Personal weather-consolidation PWA for two Colorado locations. All workstreams complete and deployed. See `build-log.md` for a full record of decisions, problems, and solutions.

## Live app

**https://weather-dashboard-five-umber.vercel.app**

- Hosted on Vercel free (Hobby) tier
- Deploys automatically from `main` branch on push
- GitHub repo: `skrab011/weather-dashboard`

## Goal

A clean, dark-mode-first, installable PWA (iOS "Add to Home Screen") that consolidates trusted weather sources into one uncluttered view for:

- **Home** — 42 Lacy Dr, Silverthorne, CO — lat `39.619625`, lon `-106.090422`
- **Office** — 409 E Main St, Frisco, CO — lat `39.576179`, lon `-106.09718`

Priority order for tradeoffs:
1. Clean, uncluttered UI, dark-mode optimized, web + mobile.
2. Minimal/free *recurring* cost (hosting/server). Build-time tooling (Claude Pro) is a non-issue.
3. Low maintenance / bulletproof — minimize ongoing tinkering.

---

## Architecture (as built)

- **Frontend:** Vite + TypeScript, vanilla DOM (no framework), PWA manifest + service worker
- **Backend:** Vercel serverless functions in `/api/` — one file per endpoint, each self-contained (Vercel cannot bundle cross-file imports within `/api/`)
- **Hosting:** Vercel free (Hobby) tier — static frontend + serverless functions
- **Caching:** Vercel Blob (`@vercel/blob`) for the consensus brief JSON. CDN `s-maxage` headers on all `/api/` responses
- **Scheduling:** No cron (requires Vercel Pro). Consensus brief regenerates on the CDN cache TTL (10 min) — next page load after expiry triggers a fresh AI call
- **Service worker:** Cache version `weather-v3`. Precaches `/`, `/shared`, `/manifest.json`, `/manifest-shared.json`, `/icons/icon-192.png`. Skips all `/api/` routes so serverless functions are never intercepted. Both `src/main.ts` (V1) and `src/shared-main.ts` (V2) register the SW and listen for `updatefound` — when a new SW activates after a Vercel deployment, the page auto-reloads so users always get fresh content without a manual refresh. A `hadController` guard ensures this only fires on updates, not on a user's very first visit.
- **Failure isolation:** Every data source is wrapped in `SourceResult<T>`. Cards render independently; one source failing never affects others. CAIC is the most fragile — last-good data is preserved and shown with a stale timestamp

## Data sources & rules

| Source | What we pull | Rules |
|---|---|---|
| **NWS** (api.weather.gov) | Hourly + 7-day forecast, both locations; active alerts (winter storm, red flag/fire, air quality) | Free, no key. The backbone — must be rock solid. |
| **CAIC** | Weather Summary write-up (year-round) + numerical point-forecast data (Highcharts JSON feed) | Write-up always shows "Issued by / day, date, time" for freshness. No Avalanche Forecast panel. Undocumented feed — wrap in failure isolation. Point-forecast elevation: **9,219 ft** (derived from live looper data). |
| **Chris Tomer (YouTube)** | Latest "Mountain Weather Update" video description text | No transcription, no AI summary — explicitly descoped. Filter to videos with "Mountain Weather Update" in title. |
| **PurpleAir** | Hyperlocal temp (home only) + PM2.5 (both locations) | 4-mile averaging radius. Temp uses published correction offset, shown side-by-side with NWS temp. PM2.5 is EPA-smoke-corrected. |
| **AirNow** (EPA) | Official PM2.5 monitor reading | Cross-check vs. PurpleAir. Flag PM2.5 red when sources differ by **>10% AND >5 µg/m³**. |

### Overlay chart + consensus brief
- Chart: NWS + CAIC + ECMWF (Open-Meteo) temperatures on shared axes, elevation labeled for each series. NWS elevation: ~9,035 ft; CAIC elevation: 9,219 ft; ECMWF elevation from the live Open-Meteo grid cell. (ECMWF line added 2026-06-22 — Track A.)
- Consensus brief: Claude Haiku (`claude-haiku-4-5-20251001`) ingests NWS + CAIC + the latest NWS Area Forecast Discussion (AFD), returns 3–5 sentence plain-prose summary with forecaster jargon translated to plain language. Cached in Vercel Blob. Manual refresh button on the card. (AFD added 2026-06-22 — see "Forecast comparison upgrade" below and `forecast-upgrade-plan.md`.)

## API keys (all provisioned)

All keys live in Vercel environment variables (runtime) and in `.env` (local dev — not committed to git).

| Key | Used in |
|---|---|
| `PURPLEAIR_API_KEY` | `api/air-quality.ts` |
| `AIRNOW_API_KEY` | `api/air-quality.ts` |
| `YOUTUBE_API_KEY` | `api/tomer.ts` |
| `ANTHROPIC_API_KEY` | `api/brief.ts` |
| `BLOB_READ_WRITE_TOKEN` | `api/brief.ts` (Vercel Blob for brief cache) |

## Design system

- **Font:** system-ui, -apple-system, "Segoe UI", sans-serif (San Francisco on iPhone/Mac, Segoe UI on Windows — no web font loaded)
- **Color scheme:** dark-mode first
  - Page background: `#0b0d11`
  - Card background: `#13161d`
  - Accent / lavender: `#b39ddb` — used for WEATHER title, active tab text + underline, card headings, wind arrows, PM2.5 sparkline bars
  - Danger: `#ef4444` | Warn: `#f59e0b`
- **Border radius:** 12px cards, 8px smaller elements

## Desktop layout (960px+ breakpoint)

**Top row (30% / 40% / 30%):**
- Left: Now (conditions) + Air Quality stacked
- Center: Temperature Forecast chart
- Right: Consensus Brief

**Bottom row — adaptive per view:**
- *Hourly view:* Hourly strip spans full width; CAIC Weather Summary + Mountain Weather Update share a 50/50 row below
- *7-Day view:* CAIC (30%) | 7-Day forecast (40%) | Mountain Weather Update (30%)

Alert banners always span full width above the top row.

Header ("WEATHER" title + location tabs) and Hourly/7-Day toggle scroll with the page on desktop (not sticky). All constrained to `max-width: 1600px` to align with the card columns, except the "WEATHER" title which stays at the screen's left edge.

**Mobile (< 960px):** single-column stack, cards in this order: Alerts → Now → Air Quality → Hourly/7-Day → Temperature Forecast → Consensus Brief → CAIC Weather Summary → Mountain Weather Update.

## CAIC timezone note

The CAIC looper (`looper.avalanche.state.co.us`) encodes Mountain local time as if it were UTC in its Highcharts timestamps (`useUTC: false`). Both `api/caic.ts` and `api/brief.ts` apply a dynamic offset using `Intl.DateTimeFormat` with `America/Denver` to get the correct MDT (6h) or MST (7h) offset at request time. This handles the November clock-change automatically.

## Workstream status — all complete

1. ✅ Project scaffold + hosting skeleton
2. ✅ PWA shell + design system
3. ✅ NWS integration (hourly, 7-day, alerts, snowfall, UV, sun times, wind)
4. ✅ PurpleAir + AirNow (proxy, 4-mile averaging, EPA correction, AirNow cross-check, 24-hr trend)
5. ✅ CAIC integration (Weather Summary + point-forecast, failure isolation)
6. ✅ Overlay chart (NWS + CAIC, elevation labels, Chart.js)
7. ✅ Tomer embed (latest Mountain Weather Update description)
8. ✅ Consensus brief (Claude Haiku, Vercel Blob cache, manual refresh)
9. ✅ Polish + harden (SW API bypass, SourceResult isolation, last-updated stamps, error/skeleton states)
10. ✅ Final tuning (dynamic MST/MDT offset, GPG stop-hook fix, desktop layout)

## Known fragility points (in priority order)

1. **CAIC looper HTML parser** — highest risk. If the looper changes the Highcharts series name from `'Temp'` or restructures the script block, the bracket-counting parser silently returns null. The app falls back to last-good data gracefully, but data goes stale. Monitor `https://weather-dashboard-five-umber.vercel.app/api/caic` — if `pointForecastError` is non-null for more than a day, the feed changed and `api/caic.ts` needs updating.
2. **NWS API outages** — occasional multi-hour incidents. App falls back to last-good data automatically.
3. **Vercel Blob token expiry** — if `BLOB_READ_WRITE_TOKEN` lapses, brief still generates but isn't cached; every page load after CDN expiry triggers a fresh AI call (cost impact). Check Vercel dashboard if brief card feels slow on every load.
4. **YouTube API quota** — 10,000 units/day free quota. Ample for personal use; only a concern if the key is ever leaked.

## V2 — Shared page (complete and deployed)

A **second, separate page** (`shared.html` → `/shared`) for friends/family to enter their own US locations. Live at `https://weather-dashboard-five-umber.vercel.app/shared`. Planning docs:

- `v2-overview.md` — what V2 is, architecture (two pages / one shared engine), locked decisions.
- `v2-instructions.md` — working rules for the V2 build (V1 regression rule, git workflow, constraints).
- `v2-plan.md` — step-by-step workstreams (W0–W8), all complete.
- `v2-prompts.md` — copy-paste build prompts used during the build (now archived — V2 is on `main`).

**Locked decisions (owner Q&A 2026-06-18):**
1. Same repo, **same Vercel project** — multi-page Vite build (`index.html` + `shared.html`), one `/api/` layer, one set of env vars.
2. Sharing scale: a few friends/family → per-location caching is sufficient, **no hard location cap** needed.
3. Consensus Brief: **on-demand, cached per location**; dual-mode — "Consensus Brief" (NWS+CAIC) in CO, "Forecast Brief" (NWS-only) elsewhere.
4. **US-only** — NWS is US-only; the picker restricts to US locations.
5. **Geocoder** — US Census Geocoder primary, **OpenStreetMap Nominatim fallback**. Census is address-grade but weak on bare city/ZIP queries (what casual users type); Nominatim (free, no key) covers that gap. Both US-restricted.

**As-built key decisions (post-merge):**
- Feature branch `claude/weather-dashboard-v2-plan-u0x6jl` merged to `main` on 2026-06-19 after owner verified V1 unchanged. `/shared` required `"cleanUrls": true` in `vercel.json` — without it, Vercel serves `dist/shared.html` only at `/shared.html`, not the clean `/shared` URL.
- **PA temperature on shared page:** dynamically shown when PurpleAir sensors exist within 4 miles (`showTemp: true` → API returns `tempF: null` when no sensors → UI hides the row). V1 continues to show PA temp for home only.
- **Overlay chart universal:** shown for ALL locations on the shared page. Outside CO, only the NWS series is drawn; CAIC data is explicitly replaced with a null `SourceResult` to prevent bleed from a CO-tab into a non-CO tab. Elevation label shown in chart legend only when ≥ 5,000 ft (label omitted below threshold — elevation matters less at low altitude). NWS elevation now read from the live gridpoint API (`properties.elevation` in meters) rather than a hardcoded table — this applies to both V1 and V2.
- **Colorado gating on shared page:** CAIC Weather Summary and Tomer video are hidden (empty, no skeleton) when the active location is outside CO. Chart and all NWS cards always shown. `data-co` attribute on `.content` drives CSS visibility. CAIC/Tomer fetches are skipped entirely when no saved location is in CO.
- **CSS split:** V2-specific styles (picker UI, CO-gating overrides) moved to `src/shared-page/style.css`, imported only by `src/shared-main.ts`. V1's `style.css` is ~2.9 kB leaner.
- **Service worker:** `weather-v3`; precaches `/`, `/shared`, `/manifest.json`, `/manifest-shared.json`, `/icons/icon-192.png`. `shared-main.ts` registers the SW and has the same `updatefound` auto-reload listener as V1 (see Architecture above). V2 has its own PWA manifest (`public/manifest-shared.json`, `scope: /shared`) and full iOS meta tags in `shared.html` — V2 is independently installable as a PWA on Android and iOS home screens.
- **Per-location brief cache keys:** `brief-{lat.toFixed(2)}_{lon.toFixed(2)}.json` in Vercel Blob.

**Build progress — all workstreams complete and merged to `main`:**
- ✅ **W0** — multi-page scaffold (`vite.config.ts`, `shared.html`, `src/shared-main.ts` placeholder).
- ✅ **W1** — shared-module extraction (`src/shared/`); V1 verified byte-for-byte unchanged via source-level diff.
- ✅ **W2** — backend parameterization (`api/air-quality.ts` + `api/brief.ts` accept `?lat=&lon=`; V1 paths unchanged).
- ✅ **W3** — geocoding (`api/geocode.ts` Census+Nominatim, US-only; `src/shared-page/geocode.ts`).
- ✅ **W4** — location picker + persistence (`src/shared-page/persistence.ts`, `picker.ts`, `render.ts`, boot in `shared-main.ts`).
- ✅ **W5** — Colorado gating (CAIC/Tomer hidden outside CO; chart shown for all locations).
- ✅ **W6** — dual-mode brief ("Consensus Brief" in CO, "Forecast Brief" elsewhere; per-location Blob cache).
- ✅ **W7** — polish: service worker `weather-v3`, README updated, `shared.html` title. (Note: original W7 omitted a PWA manifest for V2; `manifest-shared.json` was added post-merge — see post-merge additions below.)
- ✅ **W8** — QA matrix passed; merged to `main` 2026-06-19.
- **Post-merge additions (all on `main`):** PA temp dynamic per sensor availability, overlay chart universal with elevation threshold, CAIC bleed fix, CSS split to `src/shared-page/style.css`, V1 7-day desktop layout fix (`align-items: start`).
- **Sticky nav (both V1 and V2, 2026-06-19):** Header and Hourly/7-Day toggle wrapped in a `.sticky-nav` container so both stay pinned to the top on mobile as the user scrolls through the weather cards. On desktop (960px+) `.sticky-nav` reverts to `position: static` so everything scrolls with the page.
- **V2 PWA manifest added (2026-06-20):** W7 had deliberately omitted a separate manifest for V2 to "keep it simple," but this meant Android Chrome showed only "Add Shortcut" instead of a proper PWA install prompt for V2. Fixed by creating `public/manifest-shared.json` (name "Weather – Shared", `scope: /shared`, V2 color tokens) and wiring it into `shared.html` via `<link rel="manifest">`. Full iOS meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `apple-touch-icon`) were also added to `shared.html` — they had been completely absent. `manifest-shared.json` added to the SW `PRECACHE` list in `public/sw.js`.
- **Icon purpose fix (2026-06-20):** Both `manifest.json` and `manifest-shared.json` originally had `"purpose": "any maskable"` on all icons. iOS 16.4+ treats a maskable icon as an adaptive icon (applies safe-zone cropping and tinting), which caused the lavender W to render as a lighter, washed-out icon after reinstall. Fixed by changing all icon entries to `"purpose": "any"` in both manifests. iOS then falls back to the explicit `<link rel="apple-touch-icon">` HTML tag, which renders the icon as-is without adaptive processing. Existing installs display the old icon until the user removes and re-adds; new installs get the correct rendering immediately.
- **Geocoder label improvements (2026-06-20):** Two label sources cleaned up in `api/geocode.ts`:
  - *Nominatim (city/ZIP queries):* Previously used `display_name` verbatim, which Nominatim formats as "City, County, State, Country" — cluttered for display. Replaced with a structured address build: reads `city` / `town` / `village` / `municipality` / `suburb` / `neighbourhood` / `county` from Nominatim's structured `address` object and combines with the 2-letter state code → "City, ST". Falls back to `display_name` only when neither place nor state is available.
  - *Census Geocoder (street addresses):* Returns all-caps matched address with a trailing ZIP code (e.g. "42 LACY DR, SILVERTHORNE, CO, 80498"). Added `titleCaseAddress()` helper: strips trailing ZIP (handles both comma-before-ZIP and space-before-ZIP formats, plus any leftover trailing comma), lower-cases then title-cases each word, then restores the 2-letter state abbreviation to full uppercase using a `\b[A-Za-z]{2}$` regex. Result: "42 Lacy Dr, Silverthorne, CO". Note: the ZIP strip regex needed two passes — first strip matched Census's actual comma-before-ZIP format ("CO, 80498" → strip ", 80498" → "CO"), then a second `.replace(/,\s*$/, "")` clears any leftover trailing comma in edge cases.
  - Labels are stored in `localStorage` at search time; previously saved locations keep their old label until the user re-searches or removes and re-adds.
- **V2 color palette (2026-06-19):** At a family member's request, V2's background was lightened. V2 now uses its own color palette defined in `src/shared-page/style.css` — a neutral dark gray bg (`#292929`) with neutral-cool surface tokens, distinct from V1's near-black blue-tinted palette. V1 colors are unchanged. V2 tokens: `--bg: #292929`, `--surface: #34363b`, `--surface-raised: #3d4047`, `--border: #46494f`, `--accent-dim: #3a2a62`. `--muted` is also overridden to `#8a95a8` (from V1's `#6b7280`) — the lighter surface dropped the original value to ~2:1 contrast, making small text like hourly times and card timestamps unreadable.

## Forecast comparison upgrade (in progress, started 2026-06-22)

A multi-step epic to make the forecast comparison chart + AI brief more useful on both V1 and V2. Full plan, sequencing, per-step session prompts, and the rollout/test strategy live in `forecast-upgrade-plan.md`. Tracks and order: **D** (AFD → brief) → **A** (Open-Meteo / ECMWF model series on the chart — the keystone) → **B** (disagreement-highlight band) → **C** (Temp/Wind/… variable toggle).

- **Rollout rule:** the chart is shared code (`src/shared/chart.ts` / `cards.ts`), so every change is built in the shared engine, made additive with V1-preserving defaults, proven on V1 first (always in CO = richest test), confirmed on V2, then merged to `main` per verified step. Test on a Vercel **preview** deploy off branch `claude/epic-wright-jx6ho7` before merging to `main`.
- **New free, keyless data sources introduced by this epic:** NWS AFD (`api.weather.gov/products`) and Open-Meteo (`api.open-meteo.com`, ECMWF/GFS/etc.). Both are CORS-friendly and follow the NWS direct-from-browser pattern (no serverless proxy); the brief's AFD call is server-side inside `api/brief.ts`.
- ✅ **D1 done (merged to `main` 2026-06-22):** AFD folded into both brief prompts. See `build-log.md` → "Forecast comparison upgrade".
- ✅ **Track A (A1–A3) done (merged to `main` 2026-06-22):** ECMWF (Open-Meteo) drawn as a third line on the comparison chart (cyan), per location, alongside NWS + CAIC. New `src/shared/openmeteo.ts`; `openMeteo` field on `LocationWeather`. Non-CO V2 locations now show NWS + ECMWF. Wind/precip/snow are fetched but not yet drawn (await Track C). See `build-log.md`.
- ✅ **Track B (B1) done (merged to `main` 2026-06-22):** shaded model-disagreement band behind the chart lines (per-hour min/max spread, drawn when ≥2 series present). Hidden helper datasets via `"__"`-prefixed labels + legend/tooltip filters; required registering Chart.js `Filler`. Band fill opacity 0.22. See `build-log.md`.

## Notes
- `weather-pwa-planning.md` — earliest planning/feedback doc; some decisions were superseded by `weather-forecast-overview.md`. Treat the overview as source of truth where they differ.
- `weather-forecast-overview.md` — locked spec doc with a "What changed during build" section appended at the end.
- `build-log.md` — detailed record of workstream decisions, bugs encountered, and solutions.
