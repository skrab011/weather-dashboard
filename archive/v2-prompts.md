# V2 — Build Prompts

Copy-paste these into Claude Code **one at a time, in order.** Each maps to a workstream in `v2-plan.md`. Don't skip ahead — several prompts depend on the previous one being verified.

> ✅ **V2 IS COMPLETE AND MERGED TO `main`.** The feature branch `claude/weather-dashboard-v2-plan-u0x6jl` was merged on 2026-06-19. All W0–W8 workstreams are done. Both V1 (`/`) and V2 (`/shared`) are live in production.
>
> **For future sessions doing new feature work**, work directly on `main` (or create a new named feature branch if the change is large or risky). The old branch name is retired. At the start of any session that needs a push, set the remote token first:
>
> ```
> git remote set-url origin https://skrab011:TOKEN@github.com/skrab011/weather-dashboard.git
> git pull origin main
> ```
>
> Then confirm `shared.html`, `src/shared-main.ts`, `src/shared-page/`, and `api/geocode.ts` are all present before making any changes.

**How to use:**
- Run one prompt, let it finish, **verify in a browser**, commit, then run the next.
- Every prompt assumes the working rules in `v2-instructions.md` (V1 stays green; feature branch, not `main`; ask before ambiguous architectural changes).
- If a prompt's verification step fails, paste the failure back rather than moving on.

**Status (as of 2026-06-19): ALL PROMPTS COMPLETE.** ✅ W0 (1), ✅ W1 (2), ✅ W2 (3), ✅ W3 (4), ✅ W4 (5), ✅ W5 (6), ✅ W6 (7), ✅ W7 (8), ✅ W8 (9). V2 is merged to `main` and live at `/shared`. The prompts below are archived for reference — the build is done. Post-merge additions (PA temp dynamic, universal chart, elevation threshold, CAIC bleed fix, CSS split) were implemented directly on `main` without a separate prompt.

---

## Prompt 0 — Kickoff / context load

```
We're starting the V2 "shared page" build. Before writing any code, read v2-overview.md,
v2-instructions.md, and v2-plan.md in this repo, plus the existing CLAUDE.md. Then confirm
back to me, in a short summary: (1) the locked decisions, (2) which V1 files are reusable as-is
vs. which need refactoring, and (3) the V1 regression rule. Do not change any code yet — just
confirm you've absorbed the plan and flag anything in it you think is wrong or risky.
```

---

## Prompt 1 — W0: Multi-page scaffold ✅ (already complete — skip)

```
Implement Workstream W0 from v2-plan.md (multi-page scaffold) only.

- Add vite.config.ts with multi-page input for index.html (main) and a new shared.html (shared).
- Create shared.html as a minimal shell pointing at a new src/shared-main.ts that renders a
  visible placeholder ("Shared page — coming soon").
- Do NOT touch index.html, src/main.ts, or any V1 logic.
- Run npm run build and confirm dist/index.html and dist/shared.html are both emitted.

Then tell me exactly how to verify both pages locally (npm run dev) and what the production URLs
will be (full copy-paste URLs). Commit to the feature branch with a clear message. Do not merge
to main.
```

---

## Prompt 2 — W1: Shared-module extraction ✅ (already complete — skip)

```
Implement Workstream W1 from v2-plan.md (shared-module extraction). This is the highest-risk step
because it touches V1's working code, so go in the sub-step order the plan specifies and build
after each move.

1. Move the already-reusable modules (types, nws, sun, chart, caic, tomer) into src/shared/ and
   repoint V1 imports. Build. 
2. Extract the pure card renderers + helpers from src/render.ts into src/shared/cards.ts, taking
   data as arguments. Decouple the two V1 hardcodes: locId === "home" PA-temp becomes a boolean
   arg; the fixed 2-tab assumption stays in the page shell, not the shared renderers.
3. Turn src/store.ts into a store factory seeded with N locations (src/shared/store.ts).
4. Repoint src/main.ts to the shared engine.

CRITICAL: do NOT change V1's behavior. After you're done, walk me through how to confirm the
personal page renders byte-for-byte identically (both tabs, all cards, same copy). If anything in
V1's output would change, that's a bug — fix it before finishing. Keep the V1-touching changes in
their own commit so they're easy to bisect. Do not merge to main.
```

---

## Prompt 3 — W2: Backend parameterization ✅ (already complete — skip)

```
Implement Workstream W2 from v2-plan.md (backend parameterization), keeping all V1 call paths
byte-identical.

W1 CONTEXT (already done — don't redo): the shared engine is extracted to src/shared/. The two
frontend fetch modules you'll touch — src/shared/airQuality.ts and src/shared/brief.ts — were
ALREADY relocated there in W1 with their V1 signatures intact. So MOVE NOTHING in this step; only
change signatures + the api/ files. Also note the renderer PA-temp hardcode is already decoupled
(renderConditions takes a showPaTemp boolean) — leave the renderers alone.

There are exactly THREE V1 frontend call sites whose emitted HTTP request must stay byte-identical.
Verify each by reading it before and after:
- src/main.ts  → fetchAirQuality(locId, prev)   currently sends GET /api/air-quality?location=home|office
- src/main.ts  → fetchBrief(state.brief)         sends GET /api/brief        (initial load)
- src/render.ts → fetchBrief(brief, true)        sends GET /api/brief?refresh=true  (refresh button;
                                                 this closure moved into renderAll during W1)

api/air-quality.ts:
- Accept ?lat=&lon= in addition to the existing ?location=home|office. If location= is present, use
  the existing hardcoded map (the V1 path — unchanged). If lat/lon are present, use those.
- Add a temp flag so PA temperature is only returned when requested; the location= path keeps its
  current home=temp / office=no-temp behavior via the existing map.
- Reject coordinates outside a US bounding box with a clean error.

api/brief.ts:
- Accept ?lat=&lon=&co=&mode= ; NO params = current home behavior, unchanged.
- Key the Vercel Blob cache per location (rounded coords), e.g. brief-39.62_-106.09.json. The
  no-param personal path keeps using consensus-brief.json.
- Same US bbox validation. (Full dual-mode prompt comes in W6 — for now just wire the param
  plumbing and cache keys.)

Frontend halves in src/shared/ (signatures only — files already live there):
- airQuality.ts: generalize fetchAirQuality. The current signature is ("home"|"office", prev).
  PREFER keeping the location= shortcut for the personal entry so main.ts's request is byte-identical
  — accept either the legacy ("home"|"office", prev) form OR a (lat, lon, { temp }, prev) form, and
  leave main.ts's call site untouched (or give it a back-compat default that still sends
  ?location=home|office).
- brief.ts: add optional (lat, lon, { inColorado }) params with defaults such that BOTH no-extra-arg
  call sites above (initial load AND refresh) reproduce V1 exactly — same URLs, same blob.

CRITICAL: this touches V1 call paths, so re-run the V1 regression check from v2-instructions.md.
W2 changes no renderers, so the W1 HTML-template diff doesn't apply; instead, since the build env
can't reach the live weather/PA hosts, confirm V1 by: (a) the three call sites above are unchanged
or back-compat-defaulted so they emit the same requests, (b) tsc/build is green, and (c) the api/
no-param / location= branches are logically identical to today. Keep the V1-touching changes in
their own commit.

Verify: give me full copy-paste URLs to test a non-CO location on both endpoints (e.g.
.../api/air-quality?lat=30.27&lon=-97.74&temp=false and
.../api/brief?lat=30.27&lon=-97.74&co=false&mode=forecast), and confirm the no-param/home paths still
return identical data and the personal brief still reads/writes consensus-brief.json. Commit to the
feature branch. Do not merge to main.
```

---

## Prompt 4 — W3: Geocoding ✅ (already complete — skip; built with Census + Nominatim fallback)

```
Implement Workstream W3 from v2-plan.md (geocoding).

- Add api/geocode.ts proxying the US Census Geocoder onelineaddress endpoint
  (benchmark=Public_AR_Current, format=json). Return normalized { lat, lon, state, matchedAddress }
  or a clean not-found/not-US result. Add a short cache header. Keep it self-contained (no /api
  cross-imports).
- Add src/shared-page/geocode.ts: a frontend client calling /api/geocode?q=..., returning the
  normalized shape and computing inColorado (state === "CO", bounding-box fallback).

Verify with full copy-paste URLs: "Boulder, CO" (inColorado true), "Austin, TX" (false), and a
non-US query (clean not-found). Commit to the feature branch.
```

---

## Prompt 5 — W4: Location picker + persistence ✅ (already complete — skip)

```
Implement Workstream W4 from v2-plan.md (location picker + localStorage persistence) on the shared
page only. Do not touch V1.

- src/shared-page/persistence.ts: load/save up to 2 locations { label, lat, lon, state,
  inColorado } under a versioned localStorage key; tolerate missing/corrupt data.
- src/shared-page/picker.ts: search box + results; on select, geocode (W3) and persist (hard cap
  2); a change/remove affordance; an onboarding empty state when nothing is stored.
- src/shared-main.ts: boot — read stored locations; if none, show the empty state/picker; else seed
  the store factory (W1) and run the V1-style fetch/render flow via src/shared/ modules. Build
  tabs from the chosen locations.

Reuse the V1 design tokens and tab markup. Verify: add two locations, reload (they persist), switch
tabs, change a location. Commit to the feature branch.
```

---

## Prompt 6 — W5: Colorado gating

```
Implement Workstream W5 from v2-plan.md (Colorado gating) on the shared page only.

- Read the active location's inColorado flag.
- Only fetch CAIC + Tomer when at least one chosen location is in CO; only render the CAIC card,
  Tomer card, and overlay chart when the ACTIVE location is in CO.
- Gated-off means ABSENT (no error card, no stuck skeleton). Make the responsive grid collapse
  cleanly to NWS-only cards with no layout holes, mobile and desktop.

Verify: a CO location shows all three; a non-CO location cleanly omits all three. Confirm V1 is
unaffected (always CO, always shows them). Commit to the feature branch.
```

---

## Prompt 7 — W6: Dual-mode brief

```
Implement Workstream W6 from v2-plan.md (dual-mode brief), building on the W2 plumbing.

- api/brief.ts: co=true → V1 NWS+CAIC consensus prompt; co=false → NWS-only plain-language forecast
  prompt and SKIP the CAIC fetch. Cache both under the per-location blob key.
- src/shared/ brief card renderer: title "Consensus Brief" when inColorado, else "Forecast Brief".
  Manual refresh passes the right mode.
- Confirm per-location cache keys so two different cities don't clobber each other.

Verify: CO location → 2-source "Consensus Brief"; non-CO → NWS-only "Forecast Brief"; refresh works
for both; second load of the same location is cache-fast. Commit to the feature branch.
```

---

## Prompt 8 — W7: Polish, PWA, service worker, README

```
Implement Workstream W7 from v2-plan.md (polish).

- PWA: recommend whether shared.html should be independently installable; if yes, give it its own
  manifest/start_url/scope (/shared) so it doesn't collide with V1's installed app; if no, omit the
  manifest link. Tell me your recommendation and why before finalizing.
- Service worker: bump the cache version; precache shared.html + its assets; keep all /api/ routes
  bypassed.
- Copy/affordances: shared header/title, change-location UI, US-only messaging, empty/onboarding
  state, geocode-error states. Reuse existing dark-mode tokens only — no new colors/fonts.
- README: add a "Shared page (V2)" section (what it is, the /shared URL, persistence, US-only
  limit).

Commit to the feature branch.
```

---

## Prompt 9 — W8: QA matrix + merge

```
Run Workstream W8 from v2-plan.md (final QA) and prepare for merge.

Walk through the full verification matrix in v2-instructions.md and report results for each row:
personal page unchanged (both tabs), CO location (full features), non-CO location (gated),
invalid/non-US search, first visit (empty), return visit (restored), mobile + desktop.

Also confirm cost guards: per-location brief caching makes a second same-location load cache-fast,
and the US bbox validation rejects non-US coords on both api/air-quality and api/brief.

Give me full copy-paste test URLs for each case. Do NOT merge to main yet — summarize results and
wait for my go-ahead. Once I approve, merge the feature branch to main and confirm production V1 is
still identical.
```

---

## Optional follow-up prompts

```
# If the link starts spreading and you want a cost cap later (W2/W6 lever):
Add a hard cap on distinct cached brief locations in api/brief.ts: once N locations are cached,
refuse new AI generations and serve the NWS data without an AI brief. Make N a single constant.
Don't change behavior below the cap. Verify the personal page is unaffected.
```

```
# Update project docs after the build:
The V2 build is complete and merged. Update CLAUDE.md's V2 section to reflect "as built" (not
"planned"), and append a V2 section to build-log.md capturing key decisions, bugs, and solutions —
matching the style of the existing V1 entries.
```
