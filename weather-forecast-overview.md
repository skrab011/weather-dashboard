# Weather Forecast Overview

*Planning summary for a personal weather-consolidation PWA — Silverthorne (home) + Frisco (office).*
*Prepared June 16, 2026.*

---

## 1. Project goal

A clean, modern, **dark-mode-first Progressive Web App (PWA)** — installable on iOS via "Add to Home Screen" — that consolidates several weather sources you trust into one uncluttered interface, for two locations:

- **Home** — 42 Lacy Dr, Silverthorne, CO (lat `39.619625`, lon `-106.090422`)
- **Office** — 409 E Main St, Frisco, CO (lat `39.576179`, lon `-106.09718`)

Guiding constraints, in priority order:

1. **Clean, uncluttered UI**, optimized for dark mode on web + mobile.
2. **Minimal / ideally free *recurring* cost** — specifically server/cloud/hosting. (A Claude Pro subscription covers the build tooling and is a non-issue.)
3. **Low maintenance** — as bulletproof as we can make it, minimal tinkering on your end.

---

## 2. What we've decided (locked spec)

### Architecture
- **Static PWA frontend + a few serverless functions + one scheduled job.** Not a pure static page — secret API keys, the scheduled jobs, and YouTube/AI work all require a small backend.
- **Host:** Vercel or Netlify free tier (handles HTTPS, serverless functions, and scheduling at no cost for personal-scale use).
- **Failure isolation:** the CAIC feed (the most likely to change under us) is walled off so that if it breaks, it shows last-good cached data + a timestamp and the rest of the app keeps working.

### Data sources & rules

| Source | What we pull | Key decisions |
|---|---|---|
| **NWS** (api.weather.gov) | Hourly + 7-day forecast for both locations; **active alerts** (winter storm, red flag/fire, air quality) | Free, no key. The backbone. **Hourly is the default view**, with a toggle to 7-day. Imperial units. |
| **CAIC** | **Weather Summary** write-up (year-round) + numerical point-forecast data | Write-up always shows an **"Issued by / day, date, time"** line so you can see freshness even in the off-season. No Avalanche Forecast panel. Numerical data pulled from their Highcharts JSON feed for the overlay chart. |
| **Chris Tomer (YouTube)** | Auto-embed his **latest "Mountain Weather Update" video** + his own posted description text beneath it | **No transcription, no AI summary** — this removes the most fragile part of the project. Filtered to forecast videos only (title contains "Mountain Weather Update"). |
| **PurpleAir** | Hyperlocal **temperature** (home only) + **PM2.5** (both locations) | **4-mile averaging radius.** Temp uses the published correction offset and is shown **side-by-side with NWS temp**. PM2.5 is **EPA-smoke-corrected**. |
| **AirNow** (EPA) | Official PM2.5 monitor reading | Cross-check against PurpleAir. **Flag PM2.5 red when the two differ by >10% AND >5 µg/m³** (hybrid threshold so it stays quiet in clean air and only lights up on real divergence). Compared against AirNow's freshest hourly value. |

### Overlay + consensus brief
- A **single chart we control**, plotting NWS and CAIC on the same axes, with the **elevation each forecast is tied to clearly labeled** (so an elevation gap doesn't read as "the models disagree").
- A **consensus brief**: AI ingests **NWS + CAIC only** (not Tomer) and summarizes, in plain language, where they agree and where they diverge. Generated on a schedule + cached, with a manual refresh button — keeps AI cost to roughly pennies a month.

### Additional features (confirmed in)
- Snowfall accumulation (separate from precip)
- UV index
- Sunrise / sunset / wind
- 24-hour PM2.5 trend
- Offline caching, with a **"last cached [time]"** stamp; in fact every data card gets a **"last updated [time]"** stamp so you always know each source's freshness

### Out of scope
- **CDOT roads / passes / webcams** — you take public transit, so not needed.
- Avalanche Forecast and regional discussion panels.

### Accounts you'll set up
- PurpleAir developer API key (free)
- YouTube Data API key (free quota)
- An AI API key for the consensus brief (a few cents per run; cached to minimize cost)

---

## 2A. How this runs (build time vs. runtime)

The most useful mental model for this project is to separate **where you do the work** from **where the app lives**. They're two independent planes, and almost every "do I need my computer on / can I switch machines / where does this actually run" question answers itself once you hold them apart.

### Build time — on a machine (or browser), only while you're actively developing
This is you + Claude Code working on the code. It's **portable**: the project lives in a **GitHub repo** that acts as the single source of truth, and any workstation syncs to it. Your `CLAUDE.md` context file travels *inside* the repo, so the project's "memory" comes with it — you can build on one computer and continue on another with no loss of context. Build time only matters while you're developing; it has nothing to do with whether the finished app is up.

### Runtime — in the cloud, 24/7, detached from all your devices
Once deployed, the app and everything it does run on the **host (Vercel/Netlify)**, which is always-on cloud infrastructure. None of your devices need to be on, ever. Specifically:

- **The app** is served from the host. Your phone just loads it.
- **The scheduled job** that regenerates the consensus brief is fired by a cloud timer — the host's built-in scheduler ("cron"), with a free **GitHub Actions** schedule as a rock-solid backstop. Your laptop being closed or off is irrelevant.
- **The AI call** goes out over the internet to the model provider's servers. The model **never runs on your hardware** — your code just sends text and gets a summary back. Your phone then loads the already-generated, cached brief.

The only thing that ever runs *on your computer* is **Claude Code**, and only while you're actively building. After deploy, the app is fully independent of your machines.

### A note on secrets across machines
Your secret API keys live in a `.env` file that is **deliberately kept out of Git**, so they do *not* sync between machines via the repo — by design, for safety. You set them once per machine you build on, and once in the host's secret store for runtime. (Irrelevant until keys enter the picture, but worth knowing so it doesn't surprise you.)

### What this means for recurring cost
Runtime is the only place recurring cost could hide, and it stays at roughly **$0**: free-tier hosting, a once/twice-daily scheduled job that fits comfortably inside free limits (GitHub Actions as the free backstop), and an AI call that is usage-based pennies — and cached, so it fires on a schedule rather than on every page load. Exact free-tier scheduler limits vary by host; we'll confirm specifics at build time.

> **Architect's analogy:** build time is the workstation and software you use to produce a drawing set; runtime is the building those drawings produce. You can draft from any office, and the drawings live in a central repository any workstation can check out (that's Git/GitHub). But once the building is built, it stands and operates on its own lot with the utilities running, whether or not you're at your desk — that's the deployed app on cloud hosting. Your computer is the drafting station, not the building.

---

## 3. Plan of attack

How we get from "agreed spec" to "installed on your phone." You asked to build everything in one pass (justified, since we removed the fragile transcription piece), so these are **workstreams**, not gated phases — but they have a natural order.

1. **Project scaffold + hosting skeleton.** Set up the repo, the frontend shell, the serverless-function folder, and a one-click deploy to Vercel/Netlify so we have a live (empty) URL early and a place to store secret keys.
2. **PWA shell + design system.** Dark-mode layout, the two-location structure, the hourly/7-day toggle, the install manifest + service worker (this is what makes it installable and enables offline caching). Get the look and feel right before stuffing it with data.
3. **NWS integration (the backbone).** Both locations, hourly + 7-day, plus alerts, snowfall, UV, sun times, wind. This alone is a useful app.
4. **PurpleAir + AirNow.** The serverless proxy that hides your key, the 4-mile averaging, the EPA correction, the temp offset, the AirNow cross-check + red-flag logic, and the 24-hour trend.
5. **CAIC integration.** The Weather Summary write-up (with the issued-by line) and the numerical feed for the chart. Built with the fail-gracefully wrapper from the start.
6. **The overlay chart.** NWS + CAIC on shared axes with elevation labels.
7. **Tomer embed.** Latest forecast video + its description.
8. **Consensus brief.** The scheduled AI call (NWS + CAIC), caching, and manual refresh.
9. **Polish + harden.** Offline behavior, "last updated" stamps everywhere, loading/empty/error states, and a pass to make sure no single source can take the app down.
10. **Install on your phone + final tuning.** Includes:
    - Silencing the git commit signature warning — Claude's commits can't be GPG-signed in the remote build environment, so GitHub marks them "Unverified." This is cosmetic and has no effect on the running app. The stop-hook check at `~/.claude/stop-hook-git-check.sh` will be updated at this step to skip the signature requirement for commits authored by `noreply@anthropic.com`.
    - Making the CAIC looper timezone offset dynamic. The looper encodes Mountain local time in its Highcharts timestamps (Highcharts `useUTC: false`). Currently hardcoded to 6 hours (MDT, UTC−6). When MST (UTC−7) is in effect (approx. November–March), this needs to be 7 hours. Replace the hardcoded `6 * 3_600_000` constant in `api/caic.ts` and `api/brief.ts` with a value derived from the actual UTC offset for `America/Denver` at the time of the request.

---

## 3A. Should this be built in Claude Chat or Claude Code?

**Short answer: use Claude Code to build it, and we've already used Claude Chat for the part it's best at — planning and spec'ing (these docs).**

Here's the honest reasoning, specific to *this* project:

**Why not just build it here in Claude Chat?**
Chat (this interface) is excellent for self-contained things — a single-file prototype, a UI mockup, a script. But this project is fundamentally a *real, multi-file, deployed application* with a backend. Chat hits three hard ceilings here:
- It **can't hold your secret API keys** or run a persistent backend — exactly what PurpleAir/YouTube/AI require.
- It **can't run your scheduled job** (the consensus brief) or deploy to Vercel for you.
- It **can't see your live environment** — so when something errors against a real API or during deploy, I can't watch the actual output and fix it in place. You'd be relaying errors back and forth by copy-paste, which is slow and rework-heavy, especially as a coding novice.

Chat *can* write all the code as files for you, but then **you** have to assemble the repo, install dependencies, set environment variables, deploy, and debug — the hardest parts for someone new to code.

**Why Claude Code fits this well:**
Claude Code works inside the actual project on your machine (or in the browser). It can scaffold the whole repo, install dependencies, run the local dev server, **test against the live APIs, read the real error output, and iterate** — then help you deploy. It remembers the project across sessions (via a `CLAUDE.md` file), so maintenance later is easy, which directly serves your "bulletproof, low-tinkering" goal. For a multi-source, deploy-for-real app, this is the tool built for the job.

**On cost (resolved).** Claude Code requires a paid Claude plan, and your **Claude Pro** subscription covers it — so the build tooling is a non-issue. Your cost concern is *recurring* server/cloud cost, and that stays at roughly $0 (see §2A): free-tier hosting and a cached, scheduled AI call measured in pennies.

**Recommended split:**
- **Claude Chat (done):** scope, push-back, and the spec you're reading now.
- **Claude Code (next):** the actual build, test, deploy, and ongoing maintenance — ideally via its **Desktop app**, which is friendlier than the terminal for a novice (visual diffs, side-by-side sessions, scheduled tasks).

---

## 3B. What Claude Code is, how to use it, and when to choose it over Chat

### What it is
Claude Code is Anthropic's **agentic coding tool**: rather than just answering questions like a chatbot, it *acts* — it reads your whole codebase, edits files, runs commands, runs tests, works with Git, and integrates with your dev tools, all from natural-language instructions. It asks permission before making changes or running commands, and it runs locally (talking directly to the model, no separate server needed).

It's the same underlying engine across several **surfaces**, so your settings and project memory carry across all of them:
- **Terminal (CLI)** — the original, most powerful surface.
- **Desktop app** — a standalone app with visual diff review, multiple side-by-side sessions, and scheduled tasks. *(Friendliest for a novice — my pick for you.)*
- **Web** — runs in the browser at `claude.ai/code` with no local setup; also on the Claude iOS app.
- **IDE plugins** — VS Code, Cursor, and JetBrains.

### How to use it (high level)
1. **Get access:** a paid Claude plan (Pro/Max/Team/Enterprise) or an Anthropic Console account.
2. **Install / open:** download the **Desktop app** (simplest), or install the CLI. For the CLI, the native installer is one line:
   - macOS / Linux / WSL: `curl -fsSL https://claude.ai/install.sh | bash`
   - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
   - Then, in a project folder, run `claude`.
3. **Point it at a project** (a folder on your machine) and **describe what you want in plain English.** It plans, then edits files and runs commands, pausing for your approval.
4. **Give it lasting context** with a `CLAUDE.md` file in the project — coding standards, architecture decisions, the spec. It reads this at the start of every session and also builds its own "auto memory" of how your project works, so it gets smarter about your codebase over time.
5. **Useful built-ins** you'll likely touch: **Plan Mode** (it proposes a plan and you approve before it writes code), **MCP** (connect external tools/data), and **scheduled tasks** (for our consensus brief).

### When to choose Claude Code over Chat
- **Choose Claude Code when** the work is a real, multi-file project that needs to run, be tested, and be deployed — when there's a codebase to understand, commands to run, or iteration against a live environment. (This project.)
- **Choose Claude Chat when** you want to think through ideas, draft a spec, get a quick single-file prototype or mockup, write or edit a document, or do research — anything that doesn't need to touch a real running codebase. (Everything we've done so far.)
- **Rule of thumb:** *"AI, answer/draft this for me" → Chat. "AI, go build/fix/run this in my project" → Code.*

*Sources: Anthropic's official Claude Code documentation (code.claude.com/docs) and pricing (claude.com/pricing), verified June 16, 2026.*

---

## 4. End of overview

Detailed, step-by-step build instructions for both approaches — plus suggested prompts — are in the companion document, **Weather Forecast Instructions**.
