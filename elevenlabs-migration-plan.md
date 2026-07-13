# Radio Forecast — OpenAI → ElevenLabs Migration Plan

> Status: **PLANNED 2026-07-13 — not yet built.** Owner requested a plan for
> retiring the OpenAI text-to-speech behind the 🎙 Radio button and replacing
> it with ElevenLabs. Owner has already done the cost analysis (~$2.50/month
> at 2 × ~800-character briefs/day on a Turbo model) and confirmed it's in
> budget, so the *provider* decision is locked. A few smaller decisions are
> still **OPEN** — see §5 — and should be settled before the build session.
>
> Companion to `CLAUDE.md` (project rules — read it first) and
> `radio-forecast-plan.md` (the original OpenAI build, which this replaces —
> move it to `archive/` when this ships). When this ships, record as-built
> details in `build-log.md` and update `CLAUDE.md` (keys table, fragility
> list, Radio Forecast section).

---

## 1. What's changing (and what isn't)

The 🎙 Radio feature keeps its exact architecture. The **only** functional
change is which company's text-to-speech API turns the brief text into an MP3.

**Unchanged — do not touch:**

- The whole caching design: MP3s cached in Vercel Blob, keyed to a hash of
  the spoken text, one file per location, stale files deleted.
- The abuse guard: `/api/radio` never accepts text from the client; it reads
  the server's own cached brief from Blob.
- The time-of-day greeting ("Good morning/afternoon/evening", Colorado time)
  prepended server-side — that's plain text, provider-agnostic.
- The entire frontend: `src/shared/radio.ts`, the button and its states in
  `src/shared/cards.ts`, the iOS second-tap fallback, the 1.1x client-side
  playback rate (revisit after hearing the new voice — see §5).
- V2 (`/shared`) stays radio-free.

**Changed — one file plus config/docs:**

- `api/radio.ts`: the `generateSpeech()` function and the constants block at
  the top. Different URL, different auth header, different request body.
- Environment variables: new `ELEVENLABS_API_KEY` in Vercel + local `.env`.
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
POST https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128
xi-api-key: $ELEVENLABS_API_KEY
{ text: <text>, model_id: "eleven_turbo_v2_5",
  voice_settings: { stability, similarity_boost, style } }
→ raw MP3 bytes
```

Both return raw MP3 bytes, so `Buffer.from(await r.arrayBuffer())`, the Blob
`put()`, and everything downstream are untouched. Notes for the implementer:

- **Voice is a URL path segment, not a body field.** ElevenLabs identifies
  voices by an ID string (e.g. `pNInz6obpgDQGcFmaJgB`), chosen from their
  voice library (§4 step 3). Store it as a constant like today's `TTS_VOICE`.
- **There is no `instructions` field.** This is the one real capability loss
  (see §3). Delivery style comes from the voice you pick plus
  `voice_settings` numbers (`stability` ≈ how consistent vs. expressive,
  `style` ≈ style exaggeration, `similarity_boost` ≈ voice fidelity). Start
  with the voice's defaults (omit `voice_settings` entirely) and only tune if
  the read sounds flat.
- **Verify the exact `model_id` and request schema against the live docs at
  build time** (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
  — this plan was written from July 2026 docs; `eleven_turbo_v2_5` and
  `eleven_flash_v2_5` are the two 0.5-credit "fast" models today.
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

## 3. The one real tradeoff: losing the `instructions` field

OpenAI let us write "you are a warm drive-time radio host…" and the model
acted it out. ElevenLabs Turbo/Flash models don't take director's notes — the
character comes from **which voice you pick**. That's also the reason to
switch: ElevenLabs' voice acting is widely considered the best available, so
a well-chosen voice should out-radio the prompted OpenAI read without any
instructions. The mitigation is simply auditioning voices (§4 step 3) until
one sounds like a broadcast weatherman.

(ElevenLabs' `eleven_v3` model does support inline "audio tags" like
`[warm]`, but it costs ~2× the Turbo rate, is slower, and the tags count as
billed characters. Recommendation: don't start there; Turbo + the right voice
first. Revisit only if the read sounds flat.)

## 4. Owner setup — before the build session

Everything here happens in a browser; nothing touches the code.

1. Create an ElevenLabs account at **https://elevenlabs.io/sign-up** (or sign
   in at https://elevenlabs.io/app/sign-in).
2. Set up API billing matching your cost analysis: go to
   **https://elevenlabs.io/pricing/api** and choose the usage-based API
   option you priced (~$0.05 per 1,000 characters on Turbo/Flash). Note:
   ElevenLabs also sells monthly subscription plans with "credits" — that is
   a different billing mode than pay-per-use API pricing. Double-check which
   one you signed up for; the correct result is a billing page showing
   usage-based (metered) API pricing, not just a credit allowance.
3. **Pick the voice** (the fun part, and an OPEN decision — §5): browse
   **https://elevenlabs.io/app/voice-library**, use the play button to
   audition voices, and when you find your radio weatherman click **"Add to
   my voices"**. Then open **https://elevenlabs.io/app/voice-lab** (My
   Voices), find the voice, click the **ID / copy icon** next to it, and
   paste the voice ID (a ~20-character code) into the chat for the build
   session.
4. Create the API key: **https://elevenlabs.io/app/settings/api-keys** →
   **"Create API Key"** → name it `weather-dashboard` → copy it immediately
   (shown only once, starts with `sk_`).
5. Add it to Vercel: **https://vercel.com/dashboard** → **weather-dashboard**
   project → **Settings** → **Environment Variables** → Key:
   `ELEVENLABS_API_KEY`, Value: paste → leave **all environments** checked
   (Production AND Preview — remember the `BLOB_READ_WRITE_TOKEN` preview
   gotcha from the radio build) → **Save**.
6. Correct result: `ELEVENLABS_API_KEY` appears in the list (value hidden).
   It takes effect on the next deployment.

## 5. OPEN decisions (owner calls, settle before building)

| # | Question | Recommendation |
|---|---|---|
| 1 | **Which voice?** | Owner auditions in the voice library (§4 step 3). No default — this is the whole gag; pick by ear. |
| 2 | **Which model?** | `eleven_turbo_v2_5` (matches the cost analysis; highest quality at the 0.5-credit rate). `eleven_flash_v2_5` is faster but noticeably lower quality — not worth it for a cached ~40-second clip. |
| 3 | **What happens to OpenAI?** | Remove the OpenAI code path entirely (no fallback — one provider, less to maintain, per the "bulletproof" priority). Keep `OPENAI_API_KEY` in Vercel for now in case of rollback; delete it once the ElevenLabs version has survived a week. Any remaining prepaid OpenAI credit just sits there (note: OpenAI prepaid credits expire 12 months after purchase). |
| 4 | **Keep the 1.1x playback speed?** | Leave `RADIO_PLAYBACK_RATE = 1.1` for the preview, then decide by ear. ElevenLabs voices are paced differently than OpenAI's; 1.0 may sound better. It's a one-line change either way (`src/shared/cards.ts`). ElevenLabs also has a native `voice_settings.speed` — prefer the client-side rate we already have (no regeneration needed to tune it). |

## 6. What "archiving the OpenAI feature" means concretely

- `radio-forecast-plan.md` → `archive/radio-forecast-plan.md`, with a line
  added to `archive/README.md` (it's the OpenAI-era build plan; the feature
  it describes lives on, re-voiced).
- The OpenAI implementation itself is preserved by git history — no code
  copy needed. The build-log entry for this migration should name the last
  commit that contained the OpenAI version, so it's one `git show` away.
- `CLAUDE.md` updates: keys table (`OPENAI_API_KEY` row → `ELEVENLABS_API_KEY`,
  used in `api/radio.ts`), fragility point #5 (billing/top-up URL becomes
  https://elevenlabs.io/app/settings/billing), and the "Radio Forecast"
  section (provider, model, voice ID, no-instructions note).
- `build-log.md`: as-built record — voice chosen, model, any
  `voice_settings` tuning, surprises.

## 7. Build steps (one session, after §4 + §5 are done)

1. **E1 — `api/radio.ts` swap** per §2 (constants + `generateSpeech()` +
   hash-input change + comment). Everything else in the file untouched.
2. **E2 — deliverable check, backend only:** on the Vercel preview deploy,
   visit `https://<preview-url>/api/radio` — first hit returns JSON with an
   `audioUrl`; opening that URL plays the MP3 **in the new voice**; second
   hit returns the same URL instantly.
3. **E3 — docs + archive** per §6.
4. No frontend steps — if the button behaves differently at all, something
   in E1 went wrong.

## 8. Rollout & testing

Same discipline as every prior feature:

1. Build on a feature branch; push for a Vercel **preview deploy**. `main`
   untouched until owner sign-off.
2. Owner verification checklist (full preview URLs will be provided):
   - Tap 🎙 Radio → "Generating…" → audio plays **in the new ElevenLabs
     voice** (not the old OpenAI "ash" voice — that would mean the cache
     didn't bust). On the iPhone, from the installed PWA, not just desktop.
   - Greeting still matches the time of day.
   - Tap mid-playback → stops; tap again → instant replay (cache hit).
   - ↻ Refresh the brief, then 🎙 Radio → audio matches the new text.
   - `/shared` (V2): unchanged, no radio button.
   - `https://<preview-url>/api/radio` returns a non-null `audioUrl`.
3. After sign-off: merge to `main`, push, confirm on
   **https://weather-dashboard-five-umber.vercel.app**, then update docs'
   status lines.

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
- **Voice removal risk (new, ElevenLabs-specific):** community voice-library
  voices can be removed by their creators. If the chosen voice ID ever stops
  resolving, the API errors → button shows "Unavailable" → fix is picking a
  new voice ID (one constant). Preferring one of ElevenLabs' **default/premade
  voices** (shown first in the library, maintained by ElevenLabs) avoids this
  almost entirely — worth weighing during the §4 audition.

## 10. Explicitly out of scope

- V2 / shared-page radio button (unchanged from the original plan).
- `eleven_v3` audio-tag styling (revisit only if Turbo sounds flat — §3).
- Streaming playback, background generation, autoplay.
- Any change to brief generation (`api/brief.ts`) — Claude Haiku stays.
