// ---------------------------------------------------------------------------
// GET /api/radio — text-to-speech "radio announcer" reading of the cached brief.
//
// Reads the cached brief JSON from Vercel Blob (never accepts text from the
// client — this endpoint is public, and accepting arbitrary text would turn
// it into a free TTS service on the owner's OpenAI bill). A time-of-day
// greeting is prepended to the spoken text, and the MP3 is cached in Blob
// keyed to a SHA-256 hash of that full spoken text, so audio can never go
// out of sync with the brief or the greeting: new brief or a new time of
// day → new hash → regenerate.
// All logic lives in this single file to avoid inter-api imports which
// Vercel's bundler does not handle reliably.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

type Req = { method?: string; query?: Record<string, string | string[]> };
type Res = { status: (c: number) => Res; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OPENAI_TTS_API = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL      = "gpt-4o-mini-tts";
const TTS_VOICE      = "ash";
const TTS_INSTRUCTIONS =
  "You are a warm, friendly local radio weather host — a longtime " +
  "drive-time veteran chatting with regular listeners, not a script reader. " +
  "Speak conversationally and naturally: relaxed easy pace, a genuine smile " +
  "in your voice, natural variation in rhythm and pitch with small pauses " +
  "and friendly emphasis — never flat, stiff, or robotic. Open the greeting " +
  "warmly, like you're genuinely glad the listener tuned in.";
// Cost guard — briefs run ~400–700 chars, so this should never bite unless
// something upstream breaks.
const TTS_INPUT_CAP  = 1500;
const BRIEF_BLOB     = "consensus-brief.json";

// ---------------------------------------------------------------------------
// US bounding box — blocks non-US coordinates on the lat/lon path.
// (Mirrors api/brief.ts so the eventual V2 extension is zero backend work.)
// ---------------------------------------------------------------------------
const US_LAT_MIN = 24.0, US_LAT_MAX = 49.5;
const US_LON_MIN = -125.0, US_LON_MAX = -66.0;

function isInUSBbox(lat: number, lon: number): boolean {
  return lat >= US_LAT_MIN && lat <= US_LAT_MAX && lon >= US_LON_MIN && lon <= US_LON_MAX;
}

// Per-location blob keys — same 2-decimal rounding as api/brief.ts.
function briefBlobName(lat: number, lon: number): string {
  return `brief-${lat.toFixed(2)}_${lon.toFixed(2)}.json`;
}

function radioPrefix(hasCoords: boolean, lat: number, lon: number): string {
  return hasCoords ? `radio-${lat.toFixed(2)}_${lon.toFixed(2)}-` : "radio-home-";
}

// ---------------------------------------------------------------------------
// Time-of-day greeting, prepended to the spoken text (not put in the TTS
// instructions — `instructions` steers delivery style, it can't reliably add
// words). Uses Colorado time; the radio button is V1-only (home location), so
// this is correct for every current caller.
// ---------------------------------------------------------------------------
function timeGreeting(): string {
  const hourStr = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }).format(new Date());
  const hour = parseInt(hourStr, 10);
  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Blob helpers
// ---------------------------------------------------------------------------
interface BriefResult { text: string; generatedAt: string }

async function readCachedBrief(blobName: string): Promise<BriefResult | null> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return null;
    const { list } = await import("@vercel/blob");
    const prefix = blobName.replace(/\.json$/, "");
    const { blobs } = await list({ prefix, token });
    if (blobs.length === 0) return null;
    const r = await fetch(blobs[0].url);
    if (!r.ok) return null;
    const j = await r.json() as BriefResult;
    return j.text ? j : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// OpenAI TTS — returns raw MP3 bytes
// ---------------------------------------------------------------------------
async function generateSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const r = await fetch(OPENAI_TTS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text.slice(0, TTS_INPUT_CAP),
      instructions: TTS_INSTRUCTIONS,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${await r.text().catch(() => r.statusText)}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: Req, res: Res): Promise<void> {
  // no-store, NOT the brief's s-maxage=600 — a CDN-cached radio response could
  // hand back audio for a brief that a manual refresh just replaced. The
  // expensive part (TTS) is already cached in Blob; the invocation is cheap.
  res.setHeader("Cache-Control", "no-store");

  // Parse location params — no params = V1 personal-page path
  const latParam = req.query?.lat ? parseFloat(String(req.query.lat)) : null;
  const lonParam = req.query?.lon ? parseFloat(String(req.query.lon)) : null;
  const hasCoords = latParam !== null && lonParam !== null && !isNaN(latParam) && !isNaN(lonParam);

  if (hasCoords && !isInUSBbox(latParam!, lonParam!)) {
    res.status(400).json({ error: "Coordinates must be valid numbers within the US bounding box" });
    return;
  }

  const briefBlob = hasCoords ? briefBlobName(latParam!, lonParam!) : BRIEF_BLOB;
  const prefix    = radioPrefix(hasCoords, latParam ?? 0, lonParam ?? 0);

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

    const brief = await readCachedBrief(briefBlob);
    if (!brief) {
      res.status(200).json({ audioUrl: null, generatedAt: null, error: "No cached brief to read — load the brief card first" });
      return;
    }

    // Hash the full spoken text (greeting + brief) so the cache regenerates
    // both when the brief changes and when the time of day rolls over —
    // a morning clip must never replay "Good morning" in the evening.
    const speech = `${timeGreeting()}! ${brief.text}`;
    const hash = createHash("sha256").update(speech).digest("hex").slice(0, 16);
    const audioName = `${prefix}${hash}.mp3`;

    const { list, put, del } = await import("@vercel/blob");

    // Cache hit — the audio for this exact brief text already exists.
    const { blobs } = await list({ prefix, token });
    const existing = blobs.find(b => b.pathname === audioName);
    if (existing) {
      res.status(200).json({ audioUrl: existing.url, generatedAt: existing.uploadedAt, error: null });
      return;
    }

    // Cache miss — generate, store, then prune stale audio for this location
    // (keeps storage at one audio file per location, ever).
    const mp3 = await generateSpeech(speech);
    const saved = await put(audioName, mp3, { access: "public", addRandomSuffix: false, contentType: "audio/mpeg", token });

    const stale = blobs.filter(b => b.pathname !== audioName).map(b => b.url);
    if (stale.length > 0) await del(stale, { token }).catch(() => { /* non-fatal */ });

    res.status(200).json({ audioUrl: saved.url, generatedAt: new Date().toISOString(), error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(200).json({ audioUrl: null, generatedAt: null, error: msg });
  }
}
