# V2 — Shared Weather Dashboard: Project Overview

> Status: **complete — merged to `main` 2026-06-19.** Both V1 (`/`) and V2 (`/shared`) are live in production. This document is the source of truth for *what V2 is* and *why*. The step-by-step build sequence and live progress live in `v2-plan.md`; the working rules live in `v2-instructions.md`; copy-paste build prompts live in `v2-prompts.md` (archived).

---

## 1. What V2 is

A **second, separate page** — a shareable version of the personal weather dashboard for friends and family who live in **different US locations**. Users pick their own two locations; the page remembers them per-device.

V2 is **purely additive**. The personal page (V1) at `index.html` stays exactly as built — fixed Colorado locations, no location picker, full CAIC/Tomer/Consensus features. V2 must never destabilize V1.

The two pages have different natures:

| | **Personal page (V1)** | **Shared page (V2)** |
|---|---|---|
| Locations | Fixed (Home + Frisco, CO) | User-chosen, up to 2 |
| Audience | The owner only | Friends & family |
| Colorado data | Always shown | Shown only when location is in CO |
| Consensus Brief | NWS + CAIC, server-cached | Dual-mode, on-demand + cached per location |
| Persistence | Hardcoded constants | `localStorage`, per-device |

---

## 2. Locked decisions (from owner Q&A, 2026-06-18)

These were confirmed with the owner before planning and are **not open for re-litigation** during the build:

1. **Deployment:** Same repo, **same Vercel project**. Multi-page Vite build — add `shared.html` alongside `index.html`. Both pages share one serverless `/api/` layer and one set of env vars. One deploy pipeline.
2. **Sharing scale:** A few friends/family (private link). **Per-location caching is sufficient** — no hard location cap required. (A cap remains a trivial future lever if scope grows.)
3. **Consensus Brief:** **On-demand generation, cached per location.** Dual-mode — full "Consensus Brief" (NWS + CAIC) inside Colorado; "Forecast Brief" (NWS-only) elsewhere.
4. **Geographic scope:** **US-only.** NWS (the data backbone) is US-only, so the picker restricts to US locations and shows a friendly message otherwise. International support is explicitly out of scope (would require replacing NWS).
5. **Geocoder (decided during W3, 2026-06-18):** **US Census Geocoder primary, OpenStreetMap Nominatim fallback.** Census is official and address-grade but unreliable for the bare city/ZIP queries casual users type; Nominatim (free, no key) fills that gap. Both kept US-only. (Upgraded from the original "Census only" assumption once city-level behavior was assessed.)

---

## 3. Architecture: two pages, one shared engine

The central insight: **V1's data-fetching layer is already location-parameterized.** `src/nws.ts` takes `lat`/`lon` everywhere; the personal page just calls it with hardcoded constants. The shared page calls the *same functions* with user-chosen values.

```
                 ┌─────────────────────┐
   index.html ──▶│  src/main.ts        │  (personal: fixed CO locations)
                 └─────────┬───────────┘
                           │  imports
                 ┌─────────▼───────────┐
                 │   src/shared/       │  ← the shared engine (extracted)
                 │   • nws.ts          │     data fetch (already lat/lon)
                 │   • airQuality.ts   │     data fetch (refactor to lat/lon)
                 │   • caic.ts         │     CO-only data fetch
                 │   • tomer.ts        │     CO-only data fetch
                 │   • brief.ts        │     dual-mode, per-location
                 │   • chart.ts        │     overlay chart
                 │   • sun.ts          │     sun-time math
                 │   • cards.ts        │     pure card renderers
                 │   • store.ts        │     state container factory
                 │   • types.ts        │     domain types
                 └─────────▲───────────┘
                           │  imports
                 ┌─────────┴───────────┐
  shared.html ──▶│  src/shared-main.ts │  (shared: picker + localStorage)
                 │  + src/shared-page/ │     geocode.ts, picker.ts,
                 └─────────────────────┘     persistence.ts
```

**The shared-module extraction is the bulk of the effort and the highest-risk part** — not because it's hard, but because it touches V1's working code. The mitigation is sequencing (see `v2-plan.md`): extract, repoint V1's imports, and **verify V1 behaves identically before adding any V2 feature.** ✅ **This extraction (W1) is now complete** — the whole `src/shared/` engine exists and V1 imports it, with V1 verified byte-for-byte unchanged.

### What's already reusable (little/no change)
- `src/shared/nws.ts` — fully lat/lon-parameterized. **Backbone is ready.**
- `src/shared/sun.ts`, `src/shared/chart.ts` — pure, location-agnostic. *(Caveat: `chart.ts` still has a `home`/`office`-keyed elevation-label map; generalize for arbitrary locations later — see `v2-plan.md` Known gap.)*
- `SourceResult<T>` failure isolation, `cardFooter`/"last updated" stamping, EPA correction, red-flag divergence, sparkline — now cleanly separated into `src/shared/cards.ts`, with `api/air-quality.ts` still owning the EPA correction server-side.

### What needs real refactoring
- ✅ **Air quality** — done (W2). `api/air-quality.ts` now accepts raw `?lat=&lon=&temp=` alongside the unchanged `?location=home|office` V1 path, with US-bbox validation. `src/shared/airQuality.ts` gained a back-compat overload (string form → `?location=`; numeric `lat,lon` form → `?lat=&lon=&temp=`), so V1's call site is untouched. The PA-temperature hardcode was already decoupled in the renderer in W1 (`renderConditions` takes a `showPaTemp` flag).
- ✅ **`api/brief.ts`** — partially done (W2). It now accepts `?lat=&lon=&co=` with **per-location Blob cache keys** (`brief-39.62_-106.09.json`); the no-param V1 path still uses `consensus-brief.json`. `src/shared/brief.ts` got an optional `{ lat, lon, inColorado }` arg whose absence reproduces V1 exactly at both call sites. The **dual-mode prompt fork** (CO consensus vs. NWS-only forecast wording) is still **deferred to W6** — W2 wired the plumbing, the CAIC skip on `co=false`, and the cache keys only.
- ✅ **`src/render.ts`** — done (W1). The `locId === "home"` and fixed-2-tab hardcodes are decoupled: pure renderers live in `src/shared/cards.ts`; `render.ts` is now a thin V1 wrapper owning only the shell + the `renderAll` orchestrator.
- ✅ **`src/store.ts`** — done (W1). Generalized into `createStore(locations)` in `src/shared/store.ts`; `src/store.ts` is a thin V1 wrapper seeding it with the two fixed locations. The shared page (W4) will seed it with chosen locations; the per-location `inColorado` flag rides on the picker/persistence data, not the store shape.

---

## 4. Shared-page features

- **Location picker** — search box → geocode → lat/lon. **Hard cap of 2** locations (same as personal). A friendly empty/onboarding state when no locations are chosen yet.
- **Persistence** — the two chosen locations stored in `localStorage` (per-device, no accounts, no backend, no logins). Keeps it zero-cost and simple.
- **Geocoding** — turn "Boulder, CO" into coordinates via `/api/geocode`: **US Census Geocoder** first (free, no key; address-grade), **OpenStreetMap Nominatim** fallback for the city/ZIP/place queries Census can't resolve (free, no key). The response yields a **state** field (Census 2-letter code, or Nominatim ISO3166-2), which feeds Colorado gating — coords + state in one call. *(Built in W3.)*

---

## 5. Colorado gating (shared page only)

Three Colorado-specific things must be **hidden — not errored** — when a location is outside Colorado:

1. **CAIC** (Weather Summary write-up + numerical point-forecast feed)
2. **Chris Tomer "Mountain Weather Update"** YouTube embed (Colorado mountains only)
3. **The overlay chart** *(as planned: hide when outside CO; **as built:** chart is shown for all locations — outside CO, only the NWS series is drawn and the CAIC data is replaced with an explicit null `SourceResult` to prevent bleed from a CO tab into a non-CO tab. Elevation label shown in legend only when ≥ 5,000 ft.)*

**Mechanism:** compute an `inColorado` boolean **once**, when each location is set, and store it in `localStorage` alongside `lat`/`lon`/`label`. Every Colorado-specific component reads the active location's flag and renders or doesn't. *Hidden means absent, not an error state.*

**Determining `inColorado` — preferred order:**
1. **Geocoder `state` field** — `state === "CO"`. Preferred, since the picker already geocodes.
2. **Bounding box** — fallback only: lat 37.0–41.0, lon −109.05 to −102.05. Good enough for "is CAIC relevant?"

```js
function isInColorado(location) {
  return location.state === "CO";              // preferred (geocoder)
  // Fallback (no state field):
  // return location.lat >= 37.0 && location.lat <= 41.0
  //     && location.lon >= -109.05 && location.lon <= -102.05;
}
```

---

## 6. Consensus Brief — dual mode

This is the only part with a real behavioral fork. Outside Colorado there is no CAIC, so there is no second source to compare against — "consensus" between one source and itself is meaningless. **The prompt itself changes, not just the inputs:**

- **In Colorado (two-source mode):** ingest NWS + CAIC, compare and contrast, note agreement and divergence. Card title: **"Consensus Brief"** (same as V1).
- **Outside Colorado (NWS-only mode):** ingest NWS only, produce a plain-language forecast summary (headline, what to expect, anything notable). Card title relabeled to **"Forecast Brief"** so the UI stays honest — consistent with the project's freshness/honesty theme.

**Cost model (locked):** generate **on-demand** when a location is first viewed; **cache per location** in Vercel Blob keyed by rounded coordinates (e.g. `brief-39.62_-106.09.json`), with a sane TTL. Repeat visits to the same location hit cache. At friends-and-family scale this keeps cost in pennies. The personal page keeps its existing single-blob behavior, untouched.

---

## 7. Cost & abuse guardrails (friends-scale)

Because V2 exposes the owner's API keys to arbitrary user-chosen coordinates, two light guards are warranted (neither is heavy engineering):

1. **Per-location brief caching** (above) — bounds Anthropic spend; rounding coords maximizes cache hits.
2. **US bounding-box validation** in `api/air-quality.ts` and `api/brief.ts` — reject coordinates outside the US so the proxy can't be used as a generic open relay for the owner's PurpleAir/AirNow/Anthropic keys.

A hard cap on distinct cached locations is **not** needed at this scale but is a one-line lever if the link ever spreads.

---

## 8. Out of scope for V2

- International / non-US locations (NWS limitation).
- User accounts, server-side persistence, multi-device sync (localStorage only).
- Changing the personal page's behavior, layout, or data sources in any way.
- AI summarization of the Tomer video (descoped in V1, stays descoped).
- More than two locations.
