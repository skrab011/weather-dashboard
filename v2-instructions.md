# V2 — Build Instructions & Working Rules

> Read `v2-overview.md` first (what & why), then this (how we work), then `v2-plan.md` (the sequence). Build prompts are in `v2-prompts.md`.

---

## Prime directive: never destabilize V1

The personal page is installed on the owner's phone and is in daily use. V2 is **additive only.**

- **V1 is the regression baseline.** After every shared-module extraction step, confirm the personal page (`index.html`) builds and behaves **byte-for-byte identically** to before. If a refactor changes V1 output, the refactor is wrong — fix it before proceeding.
- The personal page's data flow, layout, copy, and API calls must be **unchanged**. If a shared function needs new parameters, give them **defaults that reproduce V1's exact behavior** so the personal entry keeps working without edits where possible.
- When backend functions (`api/air-quality.ts`, `api/brief.ts`) gain new params, the **no-param / `location=home|office` paths must keep working** exactly as today.

---

## Working rules (inherited from CLAUDE.md, apply to V2)

- **Diagnose and confirm before large or ambiguous changes.** If a plan step is ambiguous or a fix could be interpreted multiple ways, ask before acting — don't guess on anything architectural.
- **Always provide full copy-paste URLs**, e.g. `https://weather-dashboard-five-umber.vercel.app/shared`, not `/shared`.
- **The owner uses an iPhone or a Windows desktop. Tailor browser instructions:**
  - **iPhone (Safari):** no DevTools. Can visit URLs and paste back what's shown. Cannot inspect network. Defer network inspection to Windows.
  - **Windows desktop (Chrome):** full DevTools. Network tab: F12 → Network → filter Fetch/XHR → reload.
- **GitHub token** expires per session. If a push needs auth, set the remote first:
  `git remote set-url origin https://skrab011:TOKEN@github.com/skrab011/weather-dashboard.git`

---

## Git workflow for the V2 build

- **Branch:** all V2 work happens on a dedicated feature branch (current planning branch: `claude/weather-dashboard-v2-plan-u0x6jl`). Do **not** push V2 work-in-progress to `main` — `main` auto-deploys to production and V1 must stay stable.
- **Only merge to `main` when a milestone is verified** and the owner approves. V1 (`index.html`) and V2 (`shared.html`) coexist on the same deploy, so merging V2 to `main` is safe *once V1 regression is confirmed green*.
- Commit per workstream with clear messages. Keep V1-touching commits (the extraction) separate from V2-additive commits so a problem is easy to bisect.
- `git push -u origin <branch>`; retry network failures up to 4× with exponential backoff (2s/4s/8s/16s).
- **Do not open a pull request unless the owner explicitly asks.**

---

## Engineering constraints (carried from V1)

- **Vercel serverless functions cannot bundle cross-file imports within `/api/`.** Each `/api/*.ts` file stays self-contained — duplicate small constants/types inline rather than importing across `/api/`. (This is why `api/air-quality.ts` re-declares its location map.)
- **The service worker skips all `/api/` routes.** When adding `shared.html`, bump the SW cache version and make sure the shared page's shell is cached but its API calls are not intercepted.
- **Failure isolation is non-negotiable.** Every data source stays wrapped in `SourceResult<T>`. Cards render independently; one source failing never blanks another. On the shared page, a *gated* source (CO-only, outside CO) is **absent**, which is different from an *errored* source.
- **Zero recurring cost.** No new paid services. Census Geocoder (free, no key), NWS (free), existing keys reused. Static frontend + serverless on the Hobby tier.
- **Dark-mode-first design system unchanged** — reuse `src/style.css` tokens (`#0b0d11` page, `#13161d` card, `#b39ddb` accent, danger `#ef4444`, warn `#f59e0b`, 12px/8px radii, system font stack).

---

## Definition of done for each workstream

A workstream is complete only when:
1. The personal page (`index.html`) is verified unchanged (regression baseline holds).
2. The shared page behavior for that workstream is verified in a real browser — both a **Colorado** location (full features) and a **non-Colorado** location (gated features hidden, not errored).
3. Mobile (<960px single column) and desktop (≥960px) layouts both look correct.
4. The change is committed with a descriptive message on the feature branch.

---

## Verification matrix (run before any merge to main)

| Case | Expectation |
|---|---|
| Personal page, both tabs | Identical to pre-V2 production. |
| Shared page, CO location (e.g. Boulder, CO) | All cards incl. CAIC, Tomer, overlay chart, "Consensus Brief". |
| Shared page, non-CO location (e.g. Austin, TX) | NWS + air-quality cards only; CAIC/Tomer/chart **absent**; brief titled "Forecast Brief". |
| Shared page, invalid / non-US search | Friendly "US locations only" message; no crash, no broken cards. |
| Shared page, first visit (empty localStorage) | Onboarding/empty state prompting the user to add a location. |
| Shared page, return visit | Previously chosen locations restored from localStorage. |
| Both pages, mobile + desktop | Correct responsive layout. |
