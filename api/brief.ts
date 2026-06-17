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

import { kv } from "@vercel/kv";
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

const KV_KEY = "consensus-brief";

export default async function handler(req: Req, res: Res): Promise<void> {
  // Allow the browser to cache the response for 5 minutes; CDN for 10 minutes.
  // A manual refresh bypasses the CDN via the ?refresh param.
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");

  const wantsRefresh = req.query?.["refresh"] === "true";

  try {
    if (!wantsRefresh) {
      // Fast path: serve from cache
      const cached = await kv.get<BriefResult>(KV_KEY);
      if (cached) {
        res.status(200).json({ ...cached, error: null });
        return;
      }
      // Cache miss (first run or TTL expired) — fall through to generate
    }

    // Generate a fresh brief and cache it for 24 hours
    const result = await generateBrief();
    await kv.set(KV_KEY, result, { ex: 86_400 });
    res.status(200).json({ ...result, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // On error, try to serve the last cached value with an error note
    try {
      const stale = await kv.get<BriefResult>(KV_KEY);
      if (stale) {
        res.status(200).json({ ...stale, error: msg });
        return;
      }
    } catch { /* KV also down */ }

    res.status(200).json({ text: null, generatedAt: null, error: msg });
  }
}
