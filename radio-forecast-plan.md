# Radio Forecast — Build Plan

> Status: **✅ SHIPPED 2026-07-12 — owner verified on preview (iPhone + desktop) and merged to `main`.** Planned 2026-07-12. As-built record in `build-log.md` → "Radio Forecast".
> This doc is written so a future Claude session (Opus or Sonnet) can implement
> it with minimal back-and-forth. All design decisions below are **locked** —
> the owner has already chosen the provider and the generation strategy, so
> don't re-litigate them; just build.
>
> Companion to `CLAUDE.md` (project rules — **read it first**, especially the
> working rules about explaining things to a non-coder owner and the git push
> target) and `build-log.md` (history). When this feature ships, record the
> as-built details in `build-log.md` and update the status lines here and in
> `CLAUDE.md`.

---

## 1. What we're building

A **"🎙 Radio" button** on the V1 Consensus Brief card. Tap it and a
text-to-speech voice reads the current brief aloud in the style of a radio
weather announcer — a ~30–45 second audio clip. Started as a joke ("can we have
an AI weatherman video?"), scoped down to audio because video generation costs
~10,000× more per brief. The gag is the point; keep the delivery style fun.

**UX flow:**

1. User taps "🎙 Radio" next to the existing "↻ Refresh" button on the brief card.
2. Button shows "Generating…" (disabled) for ~2–5 s on first listen, then audio
   plays through the page. Replays of the same brief are instant (cached).
3. While playing, the button reads "⏹ Stop"; tapping stops playback and reverts
   the label.
4. If anything fails, the button briefly shows "Unavailable" and reverts. A
   radio failure must never affect the brief card's text content
   (`SourceResult` philosophy: one source failing never breaks another).

**No page reload is ever involved** — the button fetches the audio via
JavaScript and plays it in place, exactly like the ↻ Refresh button swaps in
new brief text without reloading.

---

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| TTS provider | **OpenAI `gpt-4o-mini-tts`** (`POST https://api.openai.com/v1/audio/speech`) | ~$15 per 1M characters ≈ **$0.01 per brief**; supports an `instructions` field to direct delivery style ("upbeat morning-radio weather announcer") — that instruction *is* the gag. |
| Generation strategy | **On-click, cached** — generate only when the button is pressed; store the MP3 in Vercel Blob keyed to a hash of the brief text | Generating inside `api/brief.ts` would slow every brief load and risk the function time limit for audio nobody may play. iOS requires a tap to start audio anyway, so the 2–5 s generation hides behind that tap. |
| Cache key | SHA-256 of the brief text (first 16 hex chars) in the blob filename | Audio can never go out of sync with the brief: same text → same file; new brief → hash mismatch → regenerate. No timestamps to compare. |
| Scope | **V1 only** for now | The owner's personal page. The brief card renderer is shared code, so the button is added behind an optional parameter that V2 simply doesn't pass — V2 stays byte-identical in behavior. Extending to V2 is a one-line follow-up **if the owner asks** (friends/family clicks would spend the owner's OpenAI credit, so that's an owner decision, not an implementer decision). |
| Text source | **Server reads the cached brief from Blob itself. The endpoint must NOT accept text from the client.** | `/api/radio` is a public URL. If it accepted arbitrary text, anyone who found it could run up the owner's OpenAI bill as a free TTS service. Reading the server's own cached brief caps abuse at "regenerate the same forecast audio". |
| Voice | Start with voice `"ash"`; pick whatever sounds most like a broadcast weatherman | Trivial to change; it's one string. Other options: `onyx`, `echo`, `coral`, `nova`. |
| New env var | `OPENAI_API_KEY` (Vercel + local `.env`) | Anthropic doesn't offer TTS. Setup steps for the owner in §4. |

---

## 3. Architecture / data flow

```
[V1 brief card "🎙 Radio" button]
        │  fetch("/api/radio")          (no text sent — just the request)
        ▼
[api/radio.ts]  (new serverless function, self-contained — see CLAUDE.md:
        │        Vercel cannot bundle cross-file imports within /api/)
        │
        ├─ 1. Read cached brief JSON from Vercel Blob
        │     (same naming logic as api/brief.ts: no params → "consensus-brief.json";
        │      ?lat&lon → "brief-{lat.toFixed(2)}_{lon.toFixed(2)}.json")
        │     No cached brief → return { audioUrl: null, error: "..." }.
        │
        ├─ 2. hash = sha256(brief.text).slice(0, 16)   (node:crypto createHash)
        │
        ├─ 3. Blob list() with the radio prefix for this location.
        │     A blob named radio-…-{hash}.mp3 exists → return its URL. Done.
        │
        ├─ 4. Cache miss → POST api.openai.com/v1/audio/speech
        │     { model: "gpt-4o-mini-tts", voice: "ash",
        │       input: brief.text (capped at 1500 chars),
        │       instructions: "<radio announcer style prompt>",
        │       response_format: "mp3" }
        │     Response body is raw MP3 bytes → Buffer.from(await r.arrayBuffer()).
        │
        ├─ 5. put() MP3 to Blob: access "public", addRandomSuffix false,
        │     contentType "audio/mpeg", name includes the hash.
        │     Then delete stale radio-*.mp3 blobs for this location whose name
        │     doesn't contain the current hash (list + del) — keeps storage at
        │     one audio file per location, ever.
        │
        └─ 6. Return JSON { audioUrl, generatedAt, error: null }
        ▼
[frontend]  audio.src = audioUrl; audio.play()   (Blob URLs are public + CORS-fine)
```

**Blob naming:** V1 default path → `radio-home-{hash}.mp3` (prefix
`radio-home-`); parameterized path → `radio-{lat.toFixed(2)}_{lon.toFixed(2)}-{hash}.mp3`.
Build the lat/lon handling now (it mirrors `api/brief.ts` exactly) even though
only V1 calls it — that makes the eventual V2 extension zero backend work.

**Response headers:** `Cache-Control: no-store`. Do NOT copy the brief's
`s-maxage=600` — a CDN-cached radio response could hand back audio for a brief
that a manual ↻ Refresh just replaced. The expensive part (TTS) is already
cached in Blob; the function invocation itself is cheap.

**Timeouts / limits:** TTS call ~2–5 s — use `AbortSignal.timeout(20_000)` like
the other API files. Cap `input` at 1500 characters (`text.slice(0, 1500)`) as
a cost guard; briefs run ~400–700 chars, so the cap should never bite unless
something upstream breaks.

---

## 4. Owner setup — OpenAI API key (do this BEFORE the build session)

For the owner (plain-language, step by step). This is the only manual part:

1. Go to **https://platform.openai.com/signup** and create an account (or sign
   in at https://platform.openai.com if you already have one — note this is
   separate from a ChatGPT subscription).
2. Add a payment method: **https://platform.openai.com/settings/organization/billing/overview**
   → click **"Add payment details"**. Buy the minimum prepaid credit ($5) —
   at ~1¢ per generation, $5 is roughly 500 radio forecasts.
3. Create the key: **https://platform.openai.com/api-keys** → click
   **"Create new secret key"** → name it `weather-dashboard` → click
   **"Create secret key"** → **copy the key now** (it starts with `sk-` and is
   shown only once).
4. Add it to Vercel: go to **https://vercel.com/dashboard** → click the
   **weather-dashboard** project → **Settings** (top tab) → **Environment
   Variables** (left sidebar) → Key: `OPENAI_API_KEY`, Value: paste the key →
   leave all environments checked → **Save**.
5. Correct result: `OPENAI_API_KEY` appears in the environment-variables list
   (value hidden). It takes effect on the **next deployment** — the build
   session's first push will pick it up automatically.
6. Also paste it into the local `.env` file as `OPENAI_API_KEY=sk-...` if doing
   any local dev (the implementer can handle this).

---

## 5. Build steps (one session, in this order)

### R1 — Backend: `api/radio.ts`

New self-contained file per §3. Follow the structure and conventions of
`api/brief.ts` (its `Req`/`Res` types, blob helpers, `US bounding box` check on
the lat/lon path, try/catch envelope returning
`{ audioUrl: null, generatedAt: null, error: msg }` with status 200 on
failure). Suggested style instruction — tune freely:

> "You are an enthusiastic AM-radio weather announcer. Read this forecast
> briskly and warmly, like a morning drive-time radio segment, with a smile in
> your voice."

Deliverable check (works before any frontend exists): visit
`https://<preview-url>/api/radio` in a browser — first hit takes a few seconds
and returns JSON with an `audioUrl`; opening that URL plays the MP3; second
hit returns the same URL instantly.

### R2 — Frontend fetch layer: `src/shared/radio.ts`

Mirror `src/shared/brief.ts`: a `fetchRadio(options?)` that GETs `/api/radio`
(V1 passes nothing) and returns `{ audioUrl, error }`. No `SourceResult`
needed — audio is ephemeral, nothing renders from state.

### R3 — Button in the brief card (shared code, V1-gated)

In `src/shared/cards.ts` → `renderBrief()`: add an **optional** parameter (e.g.
`onRadio?: () => Promise<string /* audioUrl */>`). When absent, output is
**byte-identical to today** — that's the V1-preserving-defaults discipline
(here protecting V2). When present, render a `🎙 Radio` button next to the
refresh button in `.brief-footer` and wire the states from §1.

Playback pattern (module-level `HTMLAudioElement`, reused across renders):

- On click: disable button → `await onRadio()` → set `audio.src` → `audio.play()`.
- **iOS gotcha:** Safari only allows audio started by a user gesture, and an
  `await` before `.play()` can void the gesture. Handle the rejection: if
  `play()` rejects (`NotAllowedError`), set the button to `▶ Play` — the audio
  is loaded by then, so the second tap plays synchronously and always works.
  Do not skip this fallback; it's the difference between "works on iPhone" and
  "works only on desktop". Test on the owner's actual iPhone.
- `audio.onended` → revert button label. Click-while-playing → `audio.pause()`,
  reset `currentTime`, revert label.

Only `src/render.ts` (V1) passes the new argument, wiring it to `fetchRadio()`
from R2. `src/shared-page/render.ts` (V2) is **not touched**.

### R4 — CSS

`.brief-radio-btn` in `src/style.css`, sharing the `.brief-refresh-btn` rules
(`src/style.css:774`) — same pill styling, same disabled state. V1-only, so
`src/shared-page/style.css` is not touched.

### R5 — Docs

Update `CLAUDE.md` (flip the "planned" status; move `OPENAI_API_KEY` from
planned to provisioned in the keys table) and append the as-built record to
`build-log.md` (decisions, surprises, the voice/instructions actually used).

---

## 6. Rollout & testing

Same discipline as every prior feature (see `archive/forecast-upgrade-plan.md` §2):

1. Build on a feature branch; push it so Vercel creates a **preview deploy**.
   Do not touch `main` until the owner has verified on the preview URL.
2. Owner verification checklist (give the owner the full preview URLs):
   - Brief card looks unchanged apart from the new button.
   - Tap 🎙 Radio → a few seconds of "Generating…" → audio plays. **On the
     iPhone**, from the installed PWA, not just desktop Chrome.
   - Tap again mid-playback → stops. Tap again → replays instantly (cache hit).
   - Tap ↻ Refresh, then 🎙 Radio → the audio matches the *new* brief text.
   - `/shared` page (V2): brief card completely unchanged, no radio button.
   - `https://<preview-url>/api/radio` returns JSON with a non-null `audioUrl`.
3. The Playwright harness (`.claude/skills/verify/SKILL.md`) can check button
   rendering and states with a mocked `/api/radio`, but real TTS + real iPhone
   audio need the preview deploy — sandboxes can't reach api.openai.com and
   can't emulate the iOS gesture rule.
4. After owner sign-off: merge to `main`, push (`git push origin main` — see
   CLAUDE.md), confirm on production
   **https://weather-dashboard-five-umber.vercel.app**.

---

## 7. Cost & fragility notes

- **Cost:** ~$0.01 per generated brief; regeneration only when the brief text
  changed since the last listen. Realistic usage ≪ $1/month. The 1500-char cap
  and the server-side-text-only rule are the two cost guards — keep both.
- **New fragility point** (add to CLAUDE.md's list when shipped): if
  `OPENAI_API_KEY` lapses or runs out of credit, the radio button shows
  "Unavailable" but the brief card is otherwise unaffected. Fix is topping up
  billing at https://platform.openai.com — nothing in the app needs changing.
- **Blob dependency:** radio requires a *cached* brief. If
  `BLOB_READ_WRITE_TOKEN` lapses (known fragility #3 in CLAUDE.md), the brief
  still renders but radio returns "no cached brief". Fixing the token fixes
  both.

## 8. Explicitly out of scope (owner decisions, not implementer decisions)

- V2 / shared-page radio button.
- Video generation of any kind (the original joke — killed on cost: ~$5–24 per
  clip vs ~$0.01 for audio).
- Autoplay, background generation, or generating audio inside `api/brief.ts`.
