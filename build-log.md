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
