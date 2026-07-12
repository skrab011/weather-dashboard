---
name: verify
description: Build and drive the weather dashboard locally with mocked NWS data to verify frontend changes at runtime.
---

# Verifying weather-dashboard changes locally

Remote sandboxes block `api.weather.gov` (and often other weather APIs), so
live data never loads. Verify frontend changes by serving the built app and
intercepting network calls with Playwright fixtures.

## Recipe

1. `npm install && npm run build` (build = tsc typecheck + vite build).
2. `npx vite preview --port 4173` serves `dist/` — V1 at `/`, V2 at `/shared`.
3. Drive with `playwright-core` (install in the scratchpad, not the repo) and
   `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`.
4. `page.route()` fixtures needed for a working page:
   - `**/api.weather.gov/**` — `/points/` (returns `forecast`,
     `forecastHourly`, `forecastGridData` URLs), `/forecast/hourly` (periods),
     `/forecast` (7-day periods), `/gridpoints/` (raw series: `snowfallAmount`,
     `uVIndex`, `windGust` in km/h, `elevation`), `/alerts/` (`{features:[]}`),
     `/icons/` (any small PNG).
   - `**/api.open-meteo.com/**` and the app's own `/api/*` (air-quality, caic,
     tomer, brief) can be aborted/500'd — cards are failure-isolated and the
     rest of the page still renders.
5. V2 needs saved locations before load:
   `localStorage.setItem("weather-shared-locations-v1", JSON.stringify([{label, lat, lon, state, inColorado}]))`
   via `page.addInitScript()`.

## Gotchas

- Gridpoint time-series `validTime` uses `"<ISO>/PT3H"` interval format; make
  fixture intervals cover "now" or lookups return null.
- Card renderers are shared between V1 and V2 — verify both pages when a card
  changes; the call sites live in `src/render.ts` and
  `src/shared-page/render.ts`.
- Toggle pills reuse `.chart-var-btn` classes in multiple cards — scope
  selectors by region id (e.g. `#hourly-region .chart-var-btn`).
- The app registers a service worker, and requests from a SW-controlled page
  (including `<audio>`/media fetches) BYPASS `page.route()` — fixtures
  silently stop matching and media loads fail with `NotSupportedError`.
  Stub registration out before load:
  `page.addInitScript(() => { navigator.serviceWorker.register = () => new Promise(() => {}); })`
  (never-resolving, so the app's `.then()` chain stays silent).
- Headless audio playback works once the SW is stubbed; launch Chromium with
  `--autoplay-policy=no-user-gesture-required` and serve a tiny generated
  WAV as the fixture (content type wins over a `.mp3` URL suffix).
