# Forecast Comparison Upgrade — Build Plan

> Status: **in progress.** **D1**, **Track A (A1–A3)**, **Track B (B1+B2)**, and
> **Track C C1** complete and merged to `main` (2026-06-22) — the comparison
> chart draws the ECMWF (Open-Meteo) line alongside NWS and CAIC with a shaded
> model-disagreement band, has a Temp/Wind variable toggle, and the AI brief
> compares all available models in plain language. Remaining: **C2** (optional —
> Precip/Snow as amounts), to be revisited after C1. This doc is the source of
> truth for three related upgrades to the temperature/forecast comparison chart
> and the AI brief. Read this first; each step has a matching copy-paste prompt
> in the "Session prompts" appendix at the bottom.
>
> Companion to `CLAUDE.md` (project rules), `v2-overview.md`/`v2-plan.md` (how
> V1 and V2 share one engine), and `build-log.md` (history).

---

## 1. What we're building (three tracks)

| Track | Feature | Benefits | Risk |
|---|---|---|---|
| **A** | **Open-Meteo model series** — add the European model (ECMWF) and optionally GFS/ICON as extra lines on the comparison chart | Both V1 + V2. **This is the keystone** — it gives non-Colorado V2 locations a real second forecast to compare against, and supplies clean multi-variable data for Tracks B & C. | Low–Medium |
| **B** | **Disagreement highlight** — a shaded band on the chart showing how far the models spread apart, hour by hour | Both V1 + V2. Turns the chart from "pretty" into "tells me when to trust the forecast." Depends on Track A. | Low |
| **C** | **Variable toggle** — a small Temp / Wind (later Precip / Snow) switch on the chart so it shows one variable at a time | Both V1 + V2. Track A makes this clean by giving consistent units. | Medium |
| **D** | **Area Forecast Discussion → brief** — fold the NWS forecaster-written regional discussion into the Claude brief, in plain language | Both, but **most valuable for V2** (every US location gets a real regional write-up, not just Colorado). Backend-only, no chart changes. | Low |

**Recommended order:** D and A can both go first (they're independent). Do
**A before B** (B needs ≥2 model lines to highlight disagreement) and **A
before C** (A supplies the consistent multi-variable data C needs). D can run
in parallel any time — it touches only the brief.

A pragmatic sequence that front-loads value and keeps each session small:
**D → A → B → C.**

---

## 2. Rollout & branch strategy (the V1-vs-both question, answered)

**Key fact: the chart is shared code.** Both pages render through the same
`src/shared/chart.ts` and `src/shared/cards.ts`. There is no way to change "just
V1's chart" — you're always editing shared code. So the question isn't *which
codebase*; it's *where we prove it first.*

**Decision: build in the shared code, prove on V1 first, then confirm V2 — in
the same work cycle.** Reasons:

1. **V1 always has the richest data to test against.** Home/Office are always in
   Colorado, so NWS **and** CAIC are always present. Add Open-Meteo and V1 has
   three lines to exercise the disagreement band and the variable toggle. A
   non-CO V2 location only has NWS (+ Open-Meteo once Track A lands), so it's a
   thinner test.
2. **V1's only user is you.** A chart glitch hits you, not friends/family.
3. **Shared engine = rolling to V2 is nearly free.** Once it works on V1, V2 is
   mostly "show the same control on the shared page."

**The safety discipline (same one the V2 build used):** every change is
**additive with defaults that preserve today's behavior**. A new chart series or
toggle defaults to off/absent until explicitly enabled, so an in-progress step
never breaks the existing chart.

### Where to test: use a Vercel **preview deploy**, not production

`CLAUDE.md` says deploy from `main`, and V1 lives on your phone in daily use — so
we do **not** want experimental chart code on `main` until you've seen it work.
Two options:

- **Option 1 (recommended): feature branch + Vercel preview URL.** Push each
  step to the feature branch `claude/epic-wright-jx6ho7`. Vercel builds a
  separate **preview** deployment with its own URL (it does this automatically
  for every branch, *if* preview deploys are enabled on the project). You test
  there. When a track is verified, we merge it to `main` so production updates.
  This keeps production V1 untouched while we iterate.
- **Option 2 (simpler, riskier): push small steps straight to `main`.** Works
  because changes are additive and guarded, and each step is tiny and
  reversible — but any rough edge is briefly live on your phone.

> **Action needed from you:** confirm whether Vercel preview deployments are
> enabled for this project (Vercel dashboard → project → Settings → Git →
> "Preview Deployments"). If yes, we use Option 1. If you'd rather not deal with
> finding preview URLs, we use Option 2 with extra-small steps. I'll give you
> exact click-by-click steps either way once you choose.

---

## 3. Constraints to honor (carried from this project)

- **The build/CI environment I run in cannot reach external weather hosts**
  (NWS, CAIC, Open-Meteo, etc.). So I can't see live data while building. I
  verify what I *can* (TypeScript compile, `npm run build`, source-level
  review), then **you verify the live result in your browser** on the deployed
  (preview or prod) URL. This is the same model the whole V2 build used.
- **Each `/api/*.ts` file must be fully self-contained** — Vercel can't bundle
  cross-file imports inside `/api/`. Duplicate small constants inline.
- **Failure isolation is non-negotiable.** Every new source is wrapped in
  `SourceResult<T>`; one source failing never blanks another card. A new chart
  series simply doesn't draw if its data is missing.
- **Clean, uncluttered UI is priority #1.** Each new line and toggle is a tax on
  that. We cap the chart at a sensible number of series and lean on the brief
  for nuance.
- **Zero new recurring cost.** Open-Meteo and NWS AFD are free and keyless. The
  brief still runs on the existing Anthropic key (Haiku, pennies/month) — adding
  AFD text adds a trivial number of tokens.
- **Claude Pro note:** your Pro subscription limits apply to *our build
  sessions* (me writing code), **not** to the running app. The app's only AI
  cost is the Anthropic API key behind the brief. So "stay within Pro limits"
  means: keep each build session small and self-contained — which is exactly how
  the steps below are sized (one focused commit per step, ~one short session
  each).

---

## 4. Track A — Open-Meteo model series  ✅ A1–A3 done (merged to `main` 2026-06-22)

**Goal:** add ECMWF (the European model) as a new line on the comparison chart,
fetched directly from the browser (Open-Meteo is keyless and allows browser
calls, so it follows the same pattern as NWS — no serverless proxy needed).

### What it touches
- **New:** `src/shared/openmeteo.ts` (fetch + types).
- `src/shared/types.ts` — add an `OpenMeteoForecast` type and an
  `openMeteo: SourceResult<OpenMeteoForecast>` field on `LocationWeather`.
- `src/shared/store.ts` — seed the new field in the per-location weather record.
- `src/main.ts` (V1) and `src/shared-main.ts` (V2) — fetch Open-Meteo per
  location in the boot flow.
- `src/shared/cards.ts` (`renderChart`) and `src/shared/chart.ts`
  (`renderOverlayChart`) — accept and draw the new series.
- `src/render.ts` and `src/shared-page/render.ts` — pass the new data through.

### Steps (one commit each)

- **A1 — Fetch module + types (no UI yet). ✅ Done.**
  Create `src/shared/openmeteo.ts` with a `fetchOpenMeteo(lat, lon)` that calls
  `https://api.open-meteo.com/v1/forecast` requesting `temperature_2m` (and,
  ready for later, `wind_speed_10m`, `precipitation`, `snowfall`) in Fahrenheit
  / mph / inch, `timezone=America/Denver`, `forecast_days=3`,
  `models=ecmwf_ifs025`. Return normalized hourly rows
  `{ time: ISO, tempF, windMph, precipIn, snowIn }[]` plus the grid-cell
  `elevationFt` (Open-Meteo returns elevation — we'll label it on the chart like
  we do NWS/CAIC). Add the `OpenMeteoForecast` type to `types.ts`. **No call
  sites yet** — this step only adds the module and compiles.
  *Verify:* `npm run build` is green; I paste the exact Open-Meteo URL for you to
  open in Safari/Chrome and confirm it returns JSON for Home's coordinates.

- **A2 — Wire into state + boot fetch (still not drawn). ✅ Done.**
  Add `openMeteo: SourceResult<OpenMeteoForecast>` to `LocationWeather`, seed it
  in `createStore`, and fetch it (wrapped in the `settle()` failure-isolation
  helper) per location in both `main.ts` and `shared-main.ts`.
  *Verify:* on the deployed URL, **Windows:** F12 → Network → reload → confirm an
  `open-meteo.com` request returns 200. **iPhone:** no network tab — I'll add a
  temporary visible note or you confirm via the next step's chart.

- **A3 — Draw the ECMWF line on the chart. ✅ Done (owner verified on V1, 2026-06-22).**
  Thread the Open-Meteo data through `renderChart` → `renderOverlayChart` as a
  third dataset (new color — propose a green/teal distinct from NWS lavender and
  CAIC amber), aligned to the chart's hourly axis the same way CAIC is. Show its
  elevation label when ≥ 5,000 ft, consistent with the others. Guard: if
  Open-Meteo data is null, simply don't add the dataset.
  *Verify:* **Both devices, visual.** On V1: chart shows three lines (NWS, CAIC,
  ECMWF). On V2 non-CO location: two lines (NWS, ECMWF) — this is the payoff for
  outside Colorado. Confirm V1 still looks right and the legend is readable.

**Optional A4 (later):** add a second model (GFS) by extending the `models=`
param — Open-Meteo can return several models in one call. Hold until B/C land so
we don't crowd the chart.

---

## 5. Track B — Disagreement highlight  ✅ B1 done (merged to `main` 2026-06-22)

**Goal:** a subtle shaded band behind the lines showing the spread between models
at each hour, so you can see at a glance where the forecasts agree vs. diverge.

### What it touches
- `src/shared/chart.ts` only (plus a tiny helper). No new data — it's computed
  from the series Track A already put on the chart.

### Steps

- **B1 — Spread band. ✅ Done (owner verified on preview; opacity tuned to 0.22, 2026-06-22).**
  For each hour, compute min and max across the available series (NWS, CAIC,
  ECMWF) and draw a faint filled band between them (Chart.js "fill between two
  datasets"). Keep it subtle (low opacity, neutral color) so it reads as
  background, not a fourth line. Only render the band when ≥2 series exist.
  *Verify:* visual — band is wide where lines diverge, pinched where they agree;
  doesn't clutter; still clean on mobile.

- **B2 — Plain-language spread note, folded into the brief. ✅ Done (option 1, owner verified, 2026-06-22).**
  Chose the brief-based option over a chart caption (cleaner UI, natural
  language). Implemented in `api/brief.ts`: a self-contained, non-throwing
  server-side `fetchOpenMeteo(lat, lon)` returns a compact next-48h ECMWF hourly
  temperature listing (Mountain-time labels to match the NWS block), fetched for
  every location; both prompts now include it and instruct Claude to compare
  NWS / CAIC / ECMWF (CO) or NWS / ECMWF (non-CO) and call out agreement vs.
  divergence in flowing prose. By design the brief does **not** name the sources
  robotically — it keeps plain-language phrasing ("the models agree…"); a
  one-line prompt tweak could make attribution explicit if ever wanted.

---

## 6. Track C — Variable toggle (Temp / Wind / …)  ✅ C1 done (merged to `main` 2026-06-22); C2 pending

**Goal:** a small segmented control on the chart to switch which variable is
shown — one at a time, so the chart never gets crowded.

> **The data-mismatch caveat (from our discussion) still applies and shapes the
> order here:**
> - **Temp** — all three sources have it. ✅
> - **Wind** — NWS hourly has it as text (`"10 mph"`, needs parsing); Open-Meteo
>   and CAIC have clean numbers. 🟢 Clean once parsed.
> - **Precip / Snow** — NWS's *easy* hourly feed gives precip **% chance**, not
>   an amount, so it can't be plotted against CAIC/Open-Meteo **amounts** without
>   misleading. ➜ For these, plot **amounts** from **Open-Meteo + CAIC only** (and
>   optionally pull NWS's amount fields later from the gridpoint feed). We label
>   the chart so it's honest about which sources are shown per variable.

### What it touches
- `src/shared/cards.ts` — the chart card markup gets a segmented control;
  selection stored in app state (`activeChartVar`) like `activeView` already is.
- `src/shared/store.ts` / `types.ts` — add `activeChartVar` to state.
- `src/shared/chart.ts` — pick which field each series contributes based on the
  selected variable; update the Y-axis title/units.
- `src/render.ts` + `src/shared-page/render.ts` — wire the toggle's click
  handler to re-render (mirrors the existing Hourly/7-Day toggle).

### Steps

- **C1 — Toggle UI + Temp/Wind only. ✅ Done (owner verified on mobile, 2026-06-22).**
  Added a compact segmented Temp/Wind control to the chart card with new
  `.chart-var-*` classes (own classes, not the `.toggle-btn` ones, to avoid
  colliding with the Hourly/7-Day wiring; styling reuses the design tokens — no
  new colors). New `activeChartVar` state (`ChartVar = "temp" | "wind"`) +
  `setActiveChartVar`, wired through both render wrappers. `renderOverlayChart`
  is variable-aware: NWS wind parsed from its `"10 mph"`/`"10 to 15 mph"` string
  (range → average), CAIC `windSpeedMph`, ECMWF `windMph`; Y-axis title/units,
  tooltip unit, and series labels switch (elevation shown for temp only); the
  disagreement band recomputes for the active variable. Series with no values
  for the selected variable are skipped (no orphan legend entry). Hourly/7-Day
  toggle unaffected.

- **C2 (optional, later) — Precip & Snow as amounts.**
  Add Precip and Snow showing **amounts** from Open-Meteo + CAIC, with a clear
  label that NWS isn't included (or do the extra work to pull NWS gridpoint
  amounts). Decide scope when we get here.

---

## 7. Track D — Area Forecast Discussion → brief  ✅ D1 done (merged to `main` 2026-06-22)

**Goal:** the NWS publishes a forecaster-written "Area Forecast Discussion"
(AFD) for every region of the US, free and keyless via `api.weather.gov`. Fold
it into the Claude brief so the brief gains real regional reasoning — and have
Claude translate its jargon ("shortwave trough", "h5 ridging") into plain
language. This is the nationwide CAIC-analog for V2, and it enriches V1 too.

### What it touches
- `api/brief.ts` **only.** It already fetches NWS and CAIC server-side and
  assembles a text prompt for Haiku — we add an AFD fetch and a few prompt lines.
  Self-contained, no cross-imports. No frontend change required.

### How it works (confirmed against the current `api/brief.ts`)
- `fetchNWS` already calls `/points/{lat},{lon}`. That response includes the
  forecast office id (`properties.cwa`, e.g. `"BOU"`). We capture it.
- Add `fetchAFD(office)`:
  `GET https://api.weather.gov/products/types/AFD/locations/{office}` → take the
  latest product's `@id` → `GET` it → use `.productText`. Trim it (AFDs are
  long — take the most relevant section / first ~1,500 chars) to keep token cost
  tiny. Wrap in try/catch → `"Unavailable"` on any failure (failure isolation).
- Add the AFD text to **both** prompt variants (CO consensus and non-CO
  forecast) with an instruction like: *"An NWS forecaster discussion is included;
  use it for reasoning and translate any technical terms into plain language."*

### Steps

- **D1 — Fetch + inject AFD. ✅ Done (2026-06-22).**
  Implemented in `api/brief.ts`: self-contained, non-throwing `fetchAFD(office)`
  (latest AFD product text, collapsed + capped at 1,800 chars, `"Unavailable"`
  on any failure); the forecast office id is captured from the `/points`
  response (`properties.gridId`) inside `fetchNWS` and AFD is fetched as a 4th
  parallel call; the trimmed AFD is injected into **both** prompt variants (CO
  consensus + non-CO forecast) with an instruction to translate jargon to plain
  language. Owner verified the briefs read richer on the preview deploy. Bumped
  nothing else.
  *Verify:* **iPhone-friendly** — open
  `https://weather-dashboard-five-umber.vercel.app/api/brief?refresh=true` (V1)
  and a non-CO example like
  `…/api/brief?lat=30.27&lon=-97.74&co=false&refresh=true` and read whether the
  brief is richer/more regional. Confirm the V1 (no-param) brief still reads
  well and still caches to `consensus-brief.json`.

- **D2 (optional) — Tune wording / length.**
  Adjust how much AFD we include and the translation instruction based on how D1
  reads. Pure prompt tuning, no structural change.

---

## 8. Testing approach (works around the blocked-host build env)

For **every** step:

1. **I verify locally what's verifiable:** `npx tsc --noEmit` and `npm run build`
   are green; the diff is additive and guarded; V1's existing code paths are
   logically unchanged (source-level check — the technique the V2 build relied on
   when live hosts were unreachable).
2. **You verify the live result** on the deployed URL (preview or prod per §2):
   - **Raw data checks** (Open-Meteo URL, `/api/brief`, AFD): open the URL
     directly — works on **iPhone Safari** (it's just JSON/text) and Windows.
   - **Network checks** (did a call fire?): **Windows Chrome only** — F12 →
     Network → filter Fetch/XHR → reload. iPhone has no network tab, so we lean
     on the visual/data checks instead.
   - **Chart visual checks:** both devices — I'll tell you exactly what a correct
     result looks like (line count, colors, legend, that it's still uncluttered).
3. **V1 regression gate:** after any chart step, confirm V1 (both Home/Office
   tabs, Hourly + 7-Day) looks identical to before except for the intended
   addition. Only merge to `main` once that's green.

### Verification matrix (run before merging each track to `main`)

| Case | Expectation |
|---|---|
| V1 Home/Office, after Track A | NWS + CAIC + ECMWF lines; layout otherwise unchanged. |
| V2 CO location | Same three lines as V1. |
| V2 non-CO location | NWS + ECMWF (two lines) — the outside-CO payoff. |
| Open-Meteo down (simulate by bad coords) | Chart still draws remaining lines; no blank card. |
| Track B | Spread band widens on divergence, pinches on agreement; not cluttered. |
| Track C | Temp↔Wind toggle redraws with correct units; Hourly/7-Day toggle unaffected. |
| Track D, V1 brief | Reads richer/regional; still caches; no error. |
| Track D, V2 non-CO brief | Now has real regional reasoning in plain language. |
| Both pages, mobile + desktop | Still clean and responsive. |

---

## 9. Session prompts (paste one per build session)

Each prompt is self-contained and points me at *only* the files that step needs,
so sessions stay small and efficient (kind to Pro limits). Start each with the
repo open on branch `claude/epic-wright-jx6ho7`.

**A1 — Open-Meteo fetch module**
> Read `forecast-upgrade-plan.md` §4 and `src/shared/types.ts`,
> `src/shared/nws.ts`. Implement step A1 only: create `src/shared/openmeteo.ts`
> with `fetchOpenMeteo(lat, lon)` (ECMWF model, °F/mph/inch, 3 days, returns
> normalized hourly rows + elevationFt) and add the `OpenMeteoForecast` type to
> `types.ts`. Do not touch any call sites. Run `npx tsc --noEmit` and
> `npm run build`, then give me the exact Open-Meteo URL to test in my browser.
> Commit as "A1: Open-Meteo fetch module + types". Don't push yet — tell me
> what to verify first.

**A2 — Wire into state + boot fetch**
> Read `forecast-upgrade-plan.md` §4, plus `src/shared/store.ts`,
> `src/shared/openmeteo.ts`, `src/main.ts`, `src/shared-main.ts`. Implement A2:
> add `openMeteo` to `LocationWeather`, seed it in `createStore`, and fetch it
> per location (via `settle()`) in both boot files. Keep it additive — nothing
> draws yet. tsc + build green, commit, tell me how to verify the network call.

**A3 — Draw ECMWF line**
> Read `forecast-upgrade-plan.md` §4, plus `src/shared/cards.ts` (renderChart),
> `src/shared/chart.ts`, `src/render.ts`, `src/shared-page/render.ts`. Implement
> A3: pass Open-Meteo data through and draw it as a third dataset with its own
> color + elevation label, guarded so it's skipped when null. tsc + build,
> commit, tell me exactly what the chart should look like on V1 and on a non-CO
> V2 location.

**B1 — Disagreement band**
> Read `forecast-upgrade-plan.md` §5 and `src/shared/chart.ts`. Implement B1: a
> subtle filled spread band between the per-hour min and max of the available
> series, only when ≥2 series exist. Keep it background-subtle. tsc + build,
> commit, tell me what to look for.

**C1 — Variable toggle (Temp/Wind)**
> Read `forecast-upgrade-plan.md` §6, plus `src/shared/cards.ts`,
> `src/shared/chart.ts`, `src/shared/store.ts`, `src/shared/types.ts`,
> `src/render.ts`, `src/shared-page/render.ts`. Implement C1: add an
> `activeChartVar` to state and a segmented Temp/Wind control reusing the
> view-toggle styling; switch the plotted field and Y-axis units accordingly.
> Parse NWS wind strings; use Open-Meteo/CAIC numeric wind. Keep Hourly/7-Day
> toggle working. tsc + build, commit, tell me how to verify.

**D1 — AFD into brief**
> Read `forecast-upgrade-plan.md` §7 and `api/brief.ts` in full. Implement D1:
> capture the forecast office id in `fetchNWS`, add a self-contained
> `fetchAFD(office)` (latest AFD product text, trimmed, try/catch →
> "Unavailable"), and inject it into both prompt variants with an instruction to
> translate jargon to plain language. Keep `api/brief.ts` self-contained (no
> imports from other `/api` files). tsc + build, commit, and give me the exact
> `/api/brief` URLs (V1 no-param + a non-CO example) to test.

---

## 10. Open decisions for the owner

1. **Deploy/test flow:** Vercel preview deploys (Option 1) or push small steps to
   `main` (Option 2)? See §2.
2. **Which models on the chart:** just ECMWF to start (recommended), or ECMWF +
   GFS right away? More lines = more clutter.
3. **Track order:** recommended **D → A → B → C**. D is a quick, low-risk,
   backend-only win that improves both pages; A is the keystone for the chart
   work. Happy to reorder.
4. **Precip/Snow (C2):** worth the extra NWS-gridpoint work later, or leave
   precip/snow as Open-Meteo + CAIC amounts only?
