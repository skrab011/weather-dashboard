# V2 — Shared Weather Dashboard: Project Overview

> Status: **planning / not yet built.** This document is the source of truth for *what V2 is* and *why*. The step-by-step build sequence lives in `v2-plan.md`; the working rules live in `v2-instructions.md`; copy-paste build prompts live in `v2-prompts.md`.

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
4. **Geographic scope:** **US-only.** NWS (the data backbone) and the US Census Geocoder are both US-only. The picker restricts to US locations and shows a friendly message otherwise. International support is explicitly out of scope (would require replacing NWS).

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

**The shared-module extraction is the bulk of the effort and the highest-risk part** — not because it's hard, but because it touches V1's working code. The mitigation is sequencing (see `v2-plan.md`): extract, repoint V1's imports, and **verify V1 behaves identically before adding any V2 feature.**

### What's already reusable (little/no change)
- `src/nws.ts` — fully lat/lon-parameterized. **Backbone is ready.**
- `src/sun.ts`, `src/chart.ts` — pure, location-agnostic.
- `SourceResult<T>` failure isolation, `cardFooter`/"last updated" stamping, EPA correction, red-flag divergence, sparkline — all cleanly separated in `src/render.ts` and `api/air-quality.ts`.

### What needs real refactoring
- **Air quality** is *not* lat/lon-parameterized. `api/air-quality.ts` has a hardcoded `LOCATIONS = { home, office }` map; the frontend calls `?location=home|office`. Must accept raw `lat`/`lon`. The PA temperature is hardcoded to `locId === "home"` — V2 makes it a per-location flag.
- **`api/brief.ts`** is hardcoded to home coordinates, a single fixed Blob cache name (`consensus-brief.json`), and a CO-only two-source prompt. Needs lat/lon params, **per-location cache keys**, and the **dual-mode prompt fork**.
- **`src/render.ts`** hardcodes `locId === "home"` and the fixed 2-tab model. The pure card renderers extract cleanly to `src/shared/cards.ts`; the page shell/wiring stays per-page.
- **`src/store.ts`** assumes exactly two fixed locations. V2 needs the same shape seeded from chosen locations + an `inColorado` flag per location.

---

## 4. Shared-page features

- **Location picker** — search box → geocode → lat/lon. **Hard cap of 2** locations (same as personal). A friendly empty/onboarding state when no locations are chosen yet.
- **Persistence** — the two chosen locations stored in `localStorage` (per-device, no accounts, no backend, no logins). Keeps it zero-cost and simple.
- **Geocoding** — turn "Boulder, CO" into coordinates via the **US Census Geocoder** (free, no key). The same response yields the **state** field, which feeds Colorado gating — coords + state in one call.

---

## 5. Colorado gating (shared page only)

Three Colorado-specific things must be **hidden — not errored** — when a location is outside Colorado:

1. **CAIC** (Weather Summary write-up + numerical point-forecast feed)
2. **Chris Tomer "Mountain Weather Update"** YouTube embed (Colorado mountains only)
3. **The overlay chart** (plots NWS + CAIC together; outside CO it loses half its data → hide entirely rather than show half-empty)

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
