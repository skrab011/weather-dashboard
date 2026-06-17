// ---------------------------------------------------------------------------
// GET /api/brief-cron — called by Vercel Cron on a schedule.
//
// Generates a fresh consensus brief and stores it in Vercel KV so that
// /api/brief can serve it instantly without an AI call on page load.
//
// Vercel protects this endpoint automatically when called from the cron
// scheduler. To prevent accidental external calls, we also check for the
// CRON_SECRET header that Vercel injects on cron invocations.
// ---------------------------------------------------------------------------

import { kv } from "@vercel/kv";
import { generateBrief } from "./brief-generate";

type Req = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const KV_KEY = "consensus-brief";

export default async function handler(req: Req, res: Res): Promise<void> {
  // Vercel sets Authorization: Bearer <CRON_SECRET> on cron invocations.
  // Reject any request that doesn't carry the secret so the endpoint can't
  // be triggered by random external callers.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers?.["authorization"] ?? "";
    const token = Array.isArray(auth) ? auth[0] : auth;
    if (token !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const result = await generateBrief();
    await kv.set(KV_KEY, result, { ex: 86_400 });
    res.status(200).json({ ok: true, generatedAt: result.generatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
}
