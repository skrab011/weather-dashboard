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
- **Service worker:** Cache version `weather-v2`. Skips all `/api/` routes so serverless functions are never intercepted
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
- Chart: NWS + CAIC temperatures on shared axes, elevation labeled for each series. NWS elevation: ~9,035 ft; CAIC elevation: 9,219 ft.
- Consensus brief: Claude Haiku (`claude-haiku-4-5-20251001`) ingests NWS + CAIC only, returns 3–5 sentence plain-prose summary. Cached in Vercel Blob. Manual refresh button on the card.

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

## V2 — Shared page (in progress)

A **second, separate page** (`shared.html` → `/shared`) for friends/family to enter their own US locations. **Purely additive — must never destabilize V1.** The personal page stays exactly as built. Planning docs:

- `v2-overview.md` — what V2 is, architecture (two pages / one shared engine), locked decisions.
- `v2-instructions.md` — working rules for the V2 build (V1 regression rule, git workflow, constraints).
- `v2-plan.md` — step-by-step workstreams (W0–W8).
- `v2-prompts.md` — copy-paste build prompts, one per workstream.

**Locked decisions (owner Q&A 2026-06-18):**
1. Same repo, **same Vercel project** — multi-page Vite build (`index.html` + `shared.html`), one `/api/` layer, one set of env vars.
2. Sharing scale: a few friends/family → per-location caching is sufficient, **no hard location cap** needed.
3. Consensus Brief: **on-demand, cached per location**; dual-mode — "Consensus Brief" (NWS+CAIC) in CO, "Forecast Brief" (NWS-only) elsewhere.
4. **US-only** — NWS is US-only; the picker restricts to US locations.
5. **Geocoder (decided during W3)** — US Census Geocoder primary, **OpenStreetMap Nominatim fallback**. Census is address-grade but weak on bare city/ZIP queries (what casual users type); Nominatim (free, no key) covers that gap. Both US-restricted.

**Key facts for the build:**
- `src/nws.ts` is already lat/lon-parameterized (backbone ready). The big effort is **extracting the shared engine into `src/shared/`** and keeping V1 byte-identical.
- `api/air-quality.ts` (hardcoded home/office map) and `api/brief.ts` (hardcoded home coords, single blob, CO-only prompt) need lat/lon params + back-compat defaults.
- Colorado gating = an `inColorado` boolean (geocoder `state === "CO"`) that **hides, not errors**, CAIC + Tomer + overlay chart outside CO.

**V2 git note:** build on a feature branch, not `main` (`main` auto-deploys prod V1). Merge to `main` only after V1 regression is verified green and owner approves.

**Build progress (branch `claude/weather-dashboard-v2-plan-u0x6jl`):**
- ✅ **W0** — multi-page scaffold (`vite.config.ts`, `shared.html`, `src/shared-main.ts` placeholder). Build emits both pages; V1 bundle unchanged.
- ✅ **W3** — geocoding (`api/geocode.ts` Census+Nominatim, US-only; `src/shared-page/geocode.ts` client + `inColorado`). Done out of order (independent of W1/W2). **Live endpoint + picker testing deferred until the branch merges** — the build env blocks the geocoder hosts and the owner is on mobile.
- ✅ **W1** — shared-module extraction. The whole engine now lives in `src/shared/` (types, nws, sun, chart, caic, tomer, airQuality, brief, store factory, cards) and V1 imports it. `Location` type moved to `shared/types.ts`; store is `createStore(locations)` + a thin `src/store.ts` wrapper; `render.ts` stayed top-level as a thin shell + orchestrator. `airQuality.ts`/`brief.ts` were relocated as-is (their lat/lon + dual-mode refactors are W2/W6). **V1 verified byte-for-byte unchanged** via source-level HTML-template diff (live weather hosts are blocked in the build env). Known gap: `chart.ts` elevation label still home/office-keyed.
- ✅ **W2** — backend parameterization. `api/air-quality.ts` accepts `?lat=&lon=&temp=` alongside the unchanged `?location=home|office` V1 path; `api/brief.ts` accepts `?lat=&lon=&co=` with per-location Blob cache keys (`brief-{lat}_{lon}.json`), no-param path still writes `consensus-brief.json`. Both add US bounding-box validation. Frontend `fetchAirQuality`/`fetchBrief` got back-compat overloads — all three V1 call sites emit byte-identical requests. **V1 verified** via the three unchanged call sites + green build + logically-identical no-param backend branches (live weather hosts blocked in build env). **Live endpoint testing deferred until the branch merges.**
- ⏭️ **Next: W4** (location picker + persistence) — Prompt 5 from `v2-prompts.md`. (W3 already done.)
- Remaining: W4–W8. See `v2-plan.md` for the live status table.
- **Out-of-plan V1 fix (2026-06-19):** corrected the 7-day desktop layout so CAIC + Mountain Weather Update cards size to their own content (was `align-items: stretch`). Shipped **directly to `main`** and merged into the V2 branch.

## Notes
- `weather-pwa-planning.md` — earliest planning/feedback doc; some decisions were superseded by `weather-forecast-overview.md`. Treat the overview as source of truth where they differ.
- `weather-forecast-overview.md` — locked spec doc with a "What changed during build" section appended at the end.
- `build-log.md` — detailed record of workstream decisions, bugs encountered, and solutions.
