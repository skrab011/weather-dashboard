// ---------------------------------------------------------------------------
// GET /api/brief — returns the cached consensus brief from Vercel Blob.
//
// Normal page loads:  reads the cached blob (fast, no AI call).
// Manual refresh:     ?refresh=true triggers a fresh generation and re-caches.
// ---------------------------------------------------------------------------

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
// Returns null if Blob isn't configured, the file doesn't exist, or fetch fails.
async function readCached(): Promise<BriefResult | null> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return null;

    // Dynamically import so a missing token doesn't crash at module load time
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: "consensus-brief", token });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    return res.json() as Promise<BriefResult>;
  } catch {
    return null;
  }
}

// Write the brief to Vercel Blob storage (overwrites the previous entry).
// Silently skips if Blob isn't configured.
async function writeCached(result: BriefResult): Promise<void> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return;

    const { put } = await import("@vercel/blob");
    await put(BLOB_NAME, JSON.stringify(result), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      token,
    });
  } catch {
    // Cache write failure is non-fatal — brief was still generated
  }
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
    }

    const result = await generateBrief();
    await writeCached(result);
    res.status(200).json({ ...result, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Try to serve stale cached data with an error note rather than failing completely
    const stale = await readCached();
    if (stale) {
      res.status(200).json({ ...stale, error: msg });
      return;
    }

    res.status(200).json({ text: null, generatedAt: null, error: msg });
  }
}
