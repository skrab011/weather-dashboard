# Weather Dashboard — Project Context

## Working rules
- Do not implement fixes, improvements, or build work unless explicitly directed to by the user. Diagnose, explain, and ask first.
- Always provide full URLs for the user to copy and paste (e.g. https://weather-dashboard-five-umber.vercel.app/api/caic, not just /api/caic).
- The user works from either an **iPhone** or a **Windows desktop**. Tailor all browser instructions accordingly:
  - **iPhone (Safari):** No DevTools available. Can visit URLs directly and paste back what the browser shows. Cannot inspect network requests. For anything requiring network inspection, defer to a Windows desktop session.
  - **Windows desktop (Chrome):** Full DevTools available. Network tab: F12 → Network → filter Fetch/XHR → reload page. Use Chrome-specific instructions (not Mac/Safari instructions).

Personal weather-consolidation PWA for two Colorado locations. Spec is locked (see `weather-forecast-overview.md` and `weather-pwa-planning.md` for full history/reasoning). This file is the working reference for build sessions.

## Goal

A clean, dark-mode-first, installable PWA (iOS "Add to Home Screen") that consolidates trusted weather sources into one uncluttered view for:

- **Home** — 42 Lacy Dr, Silverthorne, CO — lat `39.619625`, lon `-106.090422`
- **Office** — 409 E Main St, Frisco, CO — lat `39.576179`, lon `-106.09718`

Priority order for tradeoffs:
1. Clean, uncluttered UI, dark-mode optimized, web + mobile.
2. Minimal/free *recurring* cost (hosting/server). Build-time tooling (Claude Pro) is a non-issue.
3. Low maintenance / bulletproof — minimize ongoing tinkering.

## Locked architecture decisions

- **Static PWA frontend + serverless functions + one scheduled job.** Not pure static — secret keys, scheduling, and the AI summary call all require a small backend.
- **Host:** Vercel or Netlify free tier (HTTPS, serverless functions, scheduling).
- **Failure isolation:** CAIC integration is walled off — if it breaks, show last-good cached data + timestamp; rest of the app keeps working. Generalize this pattern to every external source.
- **Units:** Imperial (°F, mph, inches).
- **Default view:** Hourly forecast, with a toggle to 7-day.
- Secrets live in `.env`, excluded from git. Set once per dev machine, and once in the host's secret store for runtime.

## Data sources & rules

| Source | What we pull | Rules |
|---|---|---|
| **NWS** (api.weather.gov) | Hourly + 7-day forecast, both locations; active alerts (winter storm, red flag/fire, air quality) | Free, no key. The backbone — must be rock solid. |
| **CAIC** | Weather Summary write-up (year-round) + numerical point-forecast data (Highcharts JSON feed) | Write-up always shows "Issued by / day, date, time" for freshness. No Avalanche Forecast panel. Undocumented feed — wrap in failure isolation. |
| **Chris Tomer (YouTube)** | Auto-embed latest "Mountain Weather Update" video + his own description text | No transcription, no AI summary — explicitly descoped to avoid fragility. Filter to videos titled "Mountain Weather Update". |
| **PurpleAir** | Hyperlocal temp (home only) + PM2.5 (both locations) | 4-mile averaging radius. Temp uses published correction offset, shown side-by-side with NWS temp (never as a replacement for NWS temp). PM2.5 is EPA-smoke-corrected. |
| **AirNow** (EPA) | Official PM2.5 monitor reading | Cross-check vs. PurpleAir. Flag PM2.5 red when sources differ by **>10% AND >5 µg/m³** (hybrid threshold). Compare against AirNow's freshest hourly value. |

### Overlay + consensus brief
- One chart we control, plotting NWS + CAIC on shared axes, with each forecast's **elevation clearly labeled** (avoid misreading elevation gaps as model disagreement).
- Consensus brief: AI ingests **NWS + CAIC only** (not Tomer), summarized in plain language. Generated on a schedule + cached, with manual refresh. Keep AI cost to pennies/month.

### Additional confirmed features
- Snowfall accumulation (separate from precip)
- UV index
- Sunrise / sunset / wind
- 24-hour PM2.5 trend
- Offline caching with "last cached [time]" stamp; every data card shows a "last updated [time]" stamp

### Out of scope
- CDOT roads/passes/webcams (user takes public transit)
- Avalanche Forecast / regional discussion panels

## Accounts / keys needed (not yet provisioned)
- PurpleAir developer API key (free) — create when build reaches workstream 4
- YouTube Data API key (free quota) — create when build reaches workstream 7
- Anthropic Console API key for consensus brief — separate from Claude Pro subscription, which does not cover API usage; pay-as-you-go, pennies/month. Create when build reaches workstream 8. Use a cheap/fast model (e.g. Haiku) for the summary call.

## Resolved build decisions
- **Hosting domain:** free `*.vercel.app` / `*.netlify.app` subdomain — no custom domain.
- **Host (Vercel vs Netlify):** not yet locked — evaluate free-tier scheduled-function limits at workstream 1 and pick the better fit.
- **AI provider:** Anthropic Claude API (cheap/fast model) for the consensus brief.
- **CAIC undocumented feed:** approved for personal use, with failure-isolation wrapper as already specified. Avoid hammering it with requests (cache aggressively, fetch on schedule not per-pageview).

## Workstream order

Build in this order (not gated phases, but natural dependencies):

1. Project scaffold + hosting skeleton (repo, frontend shell, serverless function folder, deploy to Vercel/Netlify, secret storage)
2. PWA shell + design system (dark mode, two-location structure, hourly/7-day toggle, manifest + service worker)
3. NWS integration — both locations, hourly + 7-day, alerts, snowfall, UV, sun times, wind
4. PurpleAir + AirNow — serverless proxy for key, 4-mile averaging, EPA correction, temp offset, AirNow cross-check + red-flag logic, 24-hour trend
5. CAIC integration — Weather Summary write-up (issued-by line) + numerical feed, with fail-gracefully wrapper
6. Overlay chart — NWS + CAIC on shared axes with elevation labels
7. Tomer embed — latest video + description
8. Consensus brief — scheduled AI call (NWS + CAIC), caching, manual refresh
9. Polish + harden — offline behavior, "last updated" stamps, loading/empty/error states, isolation pass
10. Install on phone + final tuning

## Notes
- `weather-pwa-planning.md` is the earlier feedback/decision doc — some of its open questions were resolved in `weather-forecast-overview.md` (e.g., Tomer transcription was dropped, CDOT was descoped). Treat the overview doc as the source of truth where the two differ.
