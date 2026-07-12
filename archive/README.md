# Archive — completed planning & spec docs

Everything in this folder is **finished work kept for history**. Nothing here
is a living document — the current working reference is `CLAUDE.md` at the
repo root, and the detailed history is `build-log.md`. If a doc here
contradicts `CLAUDE.md`, `CLAUDE.md` wins.

| File | What it was | Archived because |
|---|---|---|
| `weather-pwa-planning.md` | Earliest planning/feedback doc (pre-build) | Superseded by `weather-forecast-overview.md`, which was itself superseded by the as-built record in `CLAUDE.md`/`build-log.md`. |
| `weather-forecast-overview.md` | The locked V1 spec, with a "What changed during build" section at the end | V1 shipped; where it and the planning doc differ, this overview was the source of truth. |
| `v2-overview.md` | What V2 (the `/shared` page) is and why — architecture + locked decisions | V2 complete, merged to `main` 2026-06-19. |
| `v2-instructions.md` | Working rules for the V2 build (V1 regression rule, git workflow) | Same. |
| `v2-plan.md` | Step-by-step V2 workstreams W0–W8 | Same — all workstreams done. |
| `v2-prompts.md` | Copy-paste session prompts used during the V2 build | Same. |
| `forecast-upgrade-plan.md` | The forecast-comparison epic (AFD → brief, ECMWF/GFS chart lines, disagreement band, variable toggle) | Epic complete, all tracks merged to `main` 2026-06-22. One open watch-item (Open-Meteo precip/snow units) is tracked in `build-log.md`. |
| `Design feedback request.zip` | Design-handoff bundle (annotated HTML review + mockup files) behind the 2026-07-06 design-polish pass | That polish shipped in the "Design polish" commit on `main`. |
