# Weather Consolidation PWA — Planning & Feedback

> **How to use this doc:** My feedback is captured in each section so it stands on its own. Wherever you see an **✍️ answer block**, type your responses, decisions, or pushback directly underneath. Leave anything blank that you don't care about. When you're done, send it back and I'll build from your answers.
>
> Answer convention: type below the `✍️` marker, above the `---` divider.

---

## 0. The big architectural decision: this needs a small backend

This can't be a pure static website. A few of your features force it:

- **Secret API keys** (PurpleAir, YouTube, AI summarizer) can't live in browser code — anyone could view-source and steal them.
- **The 9am Tomer check** needs something running on a schedule, not just when the page is open.
- **Transcribing YouTube** needs server-side processing.

**My recommendation:** a clean static PWA frontend + a few "serverless functions" (small bits of code that run on demand) + one scheduled job, hosted on something like Vercel or Netlify. Mostly free tier, low maintenance, gives you the HTTPS that iOS PWAs require.

**✍️ Your answer — are you OK with a backend + a host like Vercel/Netlify? Own a domain, or is a `*.vercel.app` URL fine?**



---

## 1. CAIC forecast (home + office)

**Verdict: partially feasible, with caveats.**

- CAIC is **zone/point-based, not address-based**. Silverthorne and Frisco are ~9 mi apart in the same zone → you'd get the *same* CAIC product for both.
- **Seasonality:** it's mid-June. Avalanche forecasting is in off-season (likely dormant until ~November). The model-derived point weather forecast may run year-round, but the narrative write-up you want may not exist in summer.
- **No documented public API.** The site is lat/lng-driven (there's a URL pattern with `?lat=…&lng=…&date=…`), so there's likely an undocumented JSON feed I can tap — but undocumented means it can break without warning and sits in a gray area on their terms. I'd inspect it before promising it works.

**✍️ Your answer — OK if this panel shows "no current product" in summer as long as the plumbing is ready? Any concern about relying on an undocumented feed?**



---

## 2. Chris Tomer transcription + summary

**Verdict: doable, but the most fragile feature by far.**

- Pipeline: find today's video → get transcript (auto-captions, or download audio + speech-to-text) → AI summarize → scheduled 9am MT check.
- Each link can break (captions not ready on fresh uploads, YouTube anti-scraping, library breakage). Most likely feature to need occasional maintenance.
- Needs an **AI API key** (yours; a few cents per summary).
- Personal-use summary is fine; just not for republishing.

**My pushback:** consider a leaner v1 first — auto-embed the latest video + a one-tap "Summarize" button — then upgrade to the automated 9am version once everything else is solid.

**✍️ Your answer — full automated 9am transcription, or leaner "embed + summarize on tap" to start?**



---

## 3. National Weather Service forecast (home + office)

**Verdict: easy and rock-solid — this is your backbone.**

- Free, no key, works directly in the browser, clean structured data (hourly + 7-day). Genuinely differs between Silverthorne and Frisco since it's true point-based. No drama here.

**✍️ Your answer — anything specific you want from NWS (hourly view, 7-day, both, specific fields)?**



---

## 4. Overlaying NWS on CAIC graphs + highlighting differences

**Verdict: this is where I'd push back hardest.**

- If CAIC's graphs are rendered **images**, you can't cleanly overlay your own data line on them — it won't align. A real overlay needs CAIC's underlying **numbers** (back to that undocumented feed).
- Bigger problem: it may not be **apples-to-apples**. CAIC points are often high-elevation; NWS is your valley address. The "difference" you'd highlight could be mostly *elevation*, not model disagreement — which is misleading.

**My recommendation:** instead of a literal image overlay, build **one chart I control** plotting NWS + CAIC on the same axes (only where elevations are comparable), and/or lean into the **consensus brief** (see §5 below), which I think is what you actually want.

**✍️ Your answer — open to the consensus brief + side-by-side chart instead of a literal image overlay? Or is the visual overlay specifically the goal?**



---

## 5. PurpleAir temp + smoke (PM2.5) per location

**Verdict: feasible, with two corrections.**

- Requires a **free PurpleAir developer API key** (linked to a Google account), updates every ~2 min, supports bounding-box queries to find the nearest sensor. Key must stay secret → needs the backend proxy.
- **Correction 1 — don't use PurpleAir for temperature.** Sensors self-heat and read high. Use **NWS for temp**, PurpleAir for PM2.5/smoke only.
- **Correction 2 — apply the EPA smoke correction.** Raw PurpleAir over-reads during wildfire smoke; the standard EPA conversion makes your AQI trustworthy when it matters most.
- **Coverage caveat:** mountain sensor density is thin — the nearest sensor may be miles away and at a different elevation. I'd widen the radius, show you the sensor's distance/elevation, and cross-check against **AirNow** (EPA's official monitors; Summit County usually has one).

**✍️ Your answer — good with NWS-for-temp + EPA-corrected PurpleAir PM2.5 + AirNow cross-check?**



---

## 6. Features you might be missing

Mark the ones you want (`[x]`), strike the ones you don't:

- [ ] **Consensus brief (my favorite)** — AI ingests all three sources daily and tells you where they agree/disagree in plain language. Better version of §4.
- [ ] **NWS active alerts** — winter storm, red flag (fire), air quality warnings. Free, high value.
- [ ] **CDOT road + pass conditions + webcams** — Loveland/Vail Pass closures, chain laws, live cams. Directly relevant to your commute.
- [ ] **Snowfall accumulation** (not just precip)
- [ ] **UV index** (brutal at altitude)
- [ ] **Sunrise / sunset / wind**
- [ ] **24-hour PM2.5 trend** (is smoke getting better or worse?)
- [ ] **Offline caching** — last-known data when you have no signal in the mountains

**✍️ Your answer — anything else you'd want that's not listed?**



---

## 7. Data I need from you

- **Home lat/lon (42 Lacy Dr, Silverthorne):** ✍️
- **Office lat/lon (409 E Main St, Frisco):** ✍️
- **Units:** °F / mph / inches? ✍️
- **Default time view:** hourly / 7-day / both? ✍️

---

## 8. Accounts you'd need to set up

Mark whether each is OK:

- **PurpleAir API key** (free) — ✍️ OK / not OK
- **YouTube Data API key** (free quota) — ✍️ OK / not OK
- **AI API key** for summaries (a few cents per run) — ✍️ OK / not OK
- Any of these a dealbreaker? ✍️

---

## 9. Scope & phasing

**My strong recommendation:** build a **robust core first** (NWS for both spots + EPA-corrected PurpleAir AQI + NWS alerts + the PWA shell), then layer the fragile/uncertain stuff (CAIC feed, Tomer transcription, overlay) as phase 2.

**✍️ Your answer — phase it this way, or build everything at once?**



---

## 10. Maintenance tolerance

How much occasional tinkering are you OK with? This changes how hard I lean on the fragile features (CAIC scraping, Tomer transcription) vs. keeping things bulletproof.

**✍️ Your answer:**



---

## 11. Anything else

**✍️ Open notes / pushback / ideas:**



---
