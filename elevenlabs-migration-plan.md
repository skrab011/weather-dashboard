# Radio Forecast — OpenAI → ElevenLabs Migration Plan

> Status: **PLANNED 2026-07-13, all decisions LOCKED — awaiting owner review
> of this doc before building.** Owner chose the provider (cost analysis:
> ~$2.50/month at 2 × ~800-character briefs/day on a Turbo model), crafted a
> custom voice, and settled the open questions on 2026-07-13 (see §5). Build
> may start once the owner signs off on this document.
>
> Companion to `CLAUDE.md` (project rules — read it first) and
> `radio-forecast-plan.md` (the original OpenAI build, which this replaces —
> move it to `archive/` when this ships). When this ships, record as-built
> details in `build-log.md` and update `CLAUDE.md` (keys table, fragility
> list, Radio Forecast section).

---

## 1. What's changing (and what isn't)

The 🎙 Radio feature keeps its exact architecture. The functional changes are
which company's text-to-speech API turns the brief text into an MP3, and a
reset of the client-side playback speed.

**Unchanged — do not touch:**

- The whole caching design: MP3s cached in Vercel Blob, keyed to a hash of
  the spoken text, one file per location, stale files deleted.
- The abuse guard: `/api/radio` never accepts text from the client; it reads
  the server's own cached brief from Blob.
- The time-of-day greeting ("Good morning/afternoon/evening", Colorado time)
  prepended server-side — that's plain text, provider-agnostic.
- The button and its states, the iOS second-tap fallback, and the fetch
  layer (`src/shared/radio.ts`).
- V2 (`/shared`) stays radio-free.

**Changed:**

- `api/radio.ts`: the `generateSpeech()` function and the constants block at
  the top. Different URL, different auth header, different request body.
- `src/shared/cards.ts`: playback speed reset from 1.1x to normal (owner
  decision #3, §5) — the custom ElevenLabs voice was crafted with its own
  pacing, so the client-side speed-up is retired. Remove the
  `RADIO_PLAYBACK_RATE` constant and the two `audio.playbackRate` lines
  (defaults to 1.0) rather than setting it to 1.0 — dead tuning knobs are
  clutter.
- Environment variables: new `ELEVENLABS_API_KEY` in Vercel + local `.env`.
  `OPENAI_API_KEY` retires on the schedule in §6.
- Docs: `CLAUDE.md`, `build-log.md`, and archiving per §6.

## 2. The API swap, precisely

Current call (OpenAI):

```
POST https://api.openai.com/v1/audio/speech
Authorization: Bearer $OPENAI_API_KEY
{ model: "gpt-4o-mini-tts", voice: "ash", input: <text>,
  instructions: <radio-host style prompt>, response_format: "mp3" }
→ raw MP3 bytes
```

New call (ElevenLabs):

```
POST https://api.elevenlabs.io/v1/text-to-speech/Gw0nY3v7mRqp8whsS8cs?output_format=mp3_44100_128
xi-api-key: $ELEVENLABS_API_KEY
{ text: <text>, model_id: "eleven_turbo_v2_5" }
→ raw MP3 bytes
```

Both return raw MP3 bytes, so `Buffer.from(await r.arrayBuffer())`, the Blob
`put()`, and everything downstream are untouched. Notes for the implementer:

- **Voice is a URL path segment, not a body field.** The owner's custom
  voice ID is **`Gw0nY3v7mRqp8whsS8cs`** — store it as a constant like
  today's `TTS_VOICE`.
- **No `instructions` field, and no `voice_settings` needed.** The owner
  crafted the voice in ElevenLabs Voice Design with the radio-host delivery
  and pacing baked in, so send the text and nothing else — omitting
  `voice_settings` uses the settings saved on the voice itself. Only add
  `voice_settings` overrides later if a real problem shows up in listening.
- **Verify the exact `model_id` and request schema against the live docs at
  build time** (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
  — this plan was written from July 2026 docs; `eleven_turbo_v2_5` is
  today's higher-quality 0.5-credit "fast" model.
- **Keep both cost guards:** the 1500-character input cap and the
  server-side-text-only rule. At ~$0.05 per 1,000 characters, the cap limits
  any single generation to under a dime.
- **Keep `AbortSignal.timeout(20_000)`** and the same error envelope
  (`{ audioUrl: null, generatedAt: null, error: msg }`, HTTP 200).
- **Bust the audio cache on switch:** the Blob cache key is a hash of the
  spoken text only, so without a change the first ElevenLabs tap could
  re-serve a cached OpenAI-voiced MP3 for an unchanged brief. Fold the model
  ID into the hash input (e.g. hash `"eleven_turbo_v2_5|" + speech`) so the
  provider switch — and any future model/voice change — regenerates
  automatically. The stale-pruning step already deletes the old file.
- Update the file-top comment ("owner's OpenAI bill" → ElevenLabs).

## 3. Delivery style: solved by the custom voice

OpenAI let us write "you are a warm drive-time radio host…" and the model
acted it out; ElevenLabs Turbo takes no such director's notes. This was
flagged as the migration's one real tradeoff, but the owner resolved it
before the build: the **custom voice `Gw0nY3v7mRqp8whsS8cs` was designed
with the radio-announcer character and pacing built in**, so no prompt (and
no `voice_settings` tuning, and no client-side speed-up) is needed. If the
delivery ever needs adjusting, the knob is the voice's own settings in the
ElevenLabs dashboard — not code.

## 4. Owner setup — before the build session

Everything here happens in a browser; nothing touches the code.
~~Step "pick a voice" — already done: custom voice `Gw0nY3v7mRqp8whsS8cs`.~~

1. Confirm API billing matches the cost analysis: go to
   **https://elevenlabs.io/pricing/api** and check you're on the
   usage-based API option you priced (~$0.05 per 1,000 characters on
   Turbo). Note: ElevenLabs also sells monthly subscription plans with
   "credits" — a different billing mode than pay-per-use API pricing. The
   correct result is a billing page showing usage-based (metered) API
   pricing, not just a credit allowance.
2. Create the API key: **https://elevenlabs.io/app/settings/api-keys** →
   **"Create API Key"** → name it `weather-dashboard` → copy it immediately
   (shown only once, starts with `sk_`).
3. Add it to Vercel: **https://vercel.com/dashboard** → **weather-dashboard**
   project → **Settings** → **Environment Variables** → Key:
   `ELEVENLABS_API_KEY`, Value: paste → leave **all environments** checked
   (Production AND Preview — remember the `BLOB_READ_WRITE_TOKEN` preview
   gotcha from the radio build) → **Save**.
4. Correct result: `ELEVENLABS_API_KEY` appears in the list (value hidden).
   It takes effect on the next deployment.

## 5. Decisions — LOCKED (owner, 2026-07-13)

| # | Question | Decision |
|---|---|---|
| 1 | Which voice? | Owner's custom-crafted voice, ID **`Gw0nY3v7mRqp8whsS8cs`** — radio-host delivery and pacing designed in. |
| 2 | Which model? | **`eleven_turbo_v2_5`** (matches the cost analysis; highest quality at the 0.5-credit rate). |
| 3 | What happens to OpenAI? | **Remove the OpenAI code path entirely** — no fallback; one provider, less to maintain. Keep `OPENAI_API_KEY` in Vercel for one week post-ship as a rollback parachute, then delete it (§6). Remaining prepaid OpenAI credit just sits there; it expires 12 months after purchase. |
| 4 | Playback speed? | **Reset to normal (1.0x)** — remove `RADIO_PLAYBACK_RATE` and the `playbackRate` lines from `src/shared/cards.ts`. The custom voice's pacing was set in Voice Design; client-side speed-up is retired. |

## 6. What "archiving the OpenAI feature" means concretely

- `radio-forecast-plan.md` → `archive/radio-forecast-plan.md`, with a line
  added to `archive/README.md` (it's the OpenAI-era build plan; the feature
  it describes lives on, re-voiced).
- The OpenAI implementation itself is preserved by git history — no code
  copy needed. The build-log entry for this migration should name the last
  commit that contained the OpenAI version, so it's one `git show` away.
- **`OPENAI_API_KEY` retirement schedule:** leave it in Vercel for one week
  after the migration ships to `main`. If ElevenLabs misbehaves, rollback is
  `git revert` + redeploy and the old key still works. After a quiet week,
  delete the variable: https://vercel.com/dashboard → weather-dashboard →
  Settings → Environment Variables → `OPENAI_API_KEY` → ⋯ menu → Delete.
  (Also remove it from local `.env` then.)
- `CLAUDE.md` updates: keys table (`OPENAI_API_KEY` row → `ELEVENLABS_API_KEY`,
  used in `api/radio.ts`), fragility point #5 (billing/top-up URL becomes
  https://elevenlabs.io/app/settings/billing), and the "Radio Forecast"
  section (provider, model, voice ID, 1.0x playback, no-instructions note).
- `build-log.md`: as-built record — voice ID, model, surprises.

## 7. Build steps (one session, after §4 is done and this doc is approved)

1. **E1 — `api/radio.ts` swap** per §2 (constants + `generateSpeech()` +
   hash-input change + comment). Everything else in the file untouched.
2. **E2 — playback-rate removal** in `src/shared/cards.ts` per §1: delete
   `RADIO_PLAYBACK_RATE` and both `audio.playbackRate` assignments. This
   file is shared code, but the lines live inside the `onRadio` branch that
   only V1 exercises — V2 behavior is unchanged by construction. No other
   frontend changes; if the button behaves differently at all, something in
   E1 went wrong.
3. **E3 — deliverable check, backend first:** on the Vercel preview deploy,
   visit `https://<preview-url>/api/radio` — first hit returns JSON with an
   `audioUrl`; opening that URL plays the MP3 **in the custom voice**;
   second hit returns the same URL instantly.
4. **E4 — docs + archive** per §6 (except the `OPENAI_API_KEY` deletion,
   which waits out the one-week parachute).

## 8. Rollout & testing

Same discipline as every prior feature:

1. Build on a feature branch; push for a Vercel **preview deploy**. `main`
   untouched until owner sign-off.
2. Owner verification checklist (full preview URLs will be provided):
   - Tap 🎙 Radio → "Generating…" → audio plays **in the custom voice** (not
     the old OpenAI "ash" voice — that would mean the cache didn't bust),
     **at normal speed**. On the iPhone, from the installed PWA, not just
     desktop.
   - Greeting still matches the time of day.
   - Tap mid-playback → stops; tap again → instant replay (cache hit).
   - ↻ Refresh the brief, then 🎙 Radio → audio matches the new text.
   - `/shared` (V2): unchanged, no radio button.
   - `https://<preview-url>/api/radio` returns a non-null `audioUrl`.
3. After sign-off: merge to `main`, push, confirm on
   **https://weather-dashboard-five-umber.vercel.app**, then update docs'
   status lines. One week later: delete `OPENAI_API_KEY` per §6.

## 9. Cost & fragility notes

- **Cost:** owner-verified ~$2.40–2.50/month worst case (every brief
  listened to twice daily at ~800 chars, $0.05/1k chars). Actual spend will
  be lower — generation only happens on tap, and only when the brief text or
  time-of-day greeting changed since the last listen.
- **Fragility (replaces current #5):** if `ELEVENLABS_API_KEY` lapses or
  billing fails, the 🎙 button shows "Unavailable"; brief card unaffected.
  Fix at https://elevenlabs.io/app/settings/billing — no code change. Radio
  still also depends on a cached brief in Blob (fragility #3): a lapsed
  `BLOB_READ_WRITE_TOKEN` breaks both; fixing the token fixes both.
- **Custom-voice dependency:** the voice `Gw0nY3v7mRqp8whsS8cs` lives in the
  owner's ElevenLabs account. Unlike community-library voices it can't be
  pulled by a third party, but deleting it from **My Voices** in the
  dashboard would break the API call (button shows "Unavailable") — so
  don't tidy it away. If it's ever lost, fix is crafting/picking a new voice
  and updating one constant in `api/radio.ts`.

## 10. Explicitly out of scope

- V2 / shared-page radio button (unchanged from the original plan).
- `eleven_v3` audio-tag styling — moot now; the custom voice carries the
  character.
- Streaming playback, background generation, autoplay.
- Any change to brief generation (`api/brief.ts`) — Claude Haiku stays.
