// ---------------------------------------------------------------------------
// GET /api/brief — returns the cached consensus brief from Vercel KV.
//
// Normal page loads:  reads the cached entry (fast, no AI call).
// Manual refresh:     ?refresh=true triggers a fresh generation and re-caches.
//
// The brief itself is generated either by the cron job (/api/brief-cron)
// or on manual refresh here. Both paths call generateBrief() from
// brief-generate.ts and write the result to the same KV key.
// ---------------------------------------------------------------------------

import { put, list } from "@vercel/blob";
import { generateBrief } from "./brief-generate";
import type { BriefResult } from "./brief-generate";

type Req = {
  method?: string;
  query?: Record<string, string | string[]>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const BLOB_NAME = "consensus-brief.json";

// Read the cached brief from Vercel Blob storage.
// Uses list() to find the blob by name prefix, then fetches its content.
async function readCached(): Promise<BriefResult | null> {
  const { blobs } = await list({ prefix: "consensus-brief" });
  if (blobs.length === 0) return null;
  const res = await fetch(blobs[0].url);
  if (!res.ok) return null;
  return res.json() as Promise<BriefResult>;
}

// Write the brief to Vercel Blob storage (overwrites the previous entry).
async function writeCached(result: BriefResult): Promise<void> {
  await put(BLOB_NAME, JSON.stringify(result), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");

  const wantsRefresh = req.query?.["refresh"] === "true";

  try {
    if (!wantsRefresh) {
      const cached = await readCached();
      if (cached) {
        res.status(200).json({ ...cached, error: null });
        return;
      }
      // Cache miss (first run) — fall through to generate
    }

    const result = await generateBrief();
    await writeCached(result);
    res.status(200).json({ ...result, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // On error, try to serve stale cached data with an error note
    try {
      const stale = await readCached();
      if (stale) {
        res.status(200).json({ ...stale, error: msg });
        return;
      }
    } catch { /* Blob also unavailable */ }

    res.status(200).json({ text: null, generatedAt: null, error: msg });
  }
}
