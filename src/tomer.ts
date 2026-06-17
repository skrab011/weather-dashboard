// ---------------------------------------------------------------------------
// Chris Tomer frontend fetch layer.
//
// Calls /api/tomer and wraps the result in a SourceResult envelope so the
// render layer can show stale data on error and a skeleton while loading.
// ---------------------------------------------------------------------------

import type { SourceResult, TomerVideo } from "./types";

interface TomerApiResponse {
  title:       string | null;
  description: string | null;
  publishedAt: string | null;
  error:       string | null;
  fetchedAt:   string;
}

export async function fetchTomer(
  prev: SourceResult<TomerVideo>,
): Promise<SourceResult<TomerVideo>> {
  let json: TomerApiResponse;

  try {
    const res = await fetch("/api/tomer");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json() as TomerApiResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      error: `Could not reach Tomer feed: ${msg}`,
      lastUpdated: null,
      lastGoodData:    prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }

  if (json.error || !json.title || !json.description) {
    return {
      data: null,
      error: json.error ?? "Incomplete response from Tomer feed",
      lastUpdated: null,
      lastGoodData:    prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }

  const now = new Date();
  const data: TomerVideo = {
    title:       json.title,
    description: json.description,
    publishedAt: json.publishedAt ?? json.fetchedAt,
  };

  return {
    data,
    error: null,
    lastUpdated:     now,
    lastGoodData:    data,
    lastGoodUpdated: now,
  };
}
