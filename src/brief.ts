// ---------------------------------------------------------------------------
// Frontend fetch layer for the consensus brief.
// Calls /api/brief and wraps the result in a SourceResult envelope.
// The ?refresh=true path is used by the manual refresh button.
// ---------------------------------------------------------------------------

import type { ConsensusBrief, SourceResult } from "./types";

export async function fetchBrief(
  prev: SourceResult<ConsensusBrief>,
  refresh = false,
): Promise<SourceResult<ConsensusBrief>> {
  const url = refresh ? "/api/brief?refresh=true" : "/api/brief";

  const res = await fetch(url);
  if (!res.ok) {
    return {
      data: null,
      error: `HTTP ${res.status}`,
      lastUpdated: new Date(),
      lastGoodData: prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }

  const json = await res.json() as {
    text: string | null;
    generatedAt: string | null;
    error: string | null;
  };

  if (json.error || !json.text) {
    return {
      data: null,
      error: json.error ?? "Empty brief",
      lastUpdated: new Date(),
      lastGoodData: prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }

  const data: ConsensusBrief = {
    text: json.text,
    generatedAt: json.generatedAt ?? new Date().toISOString(),
  };

  return {
    data,
    error: null,
    lastUpdated: new Date(),
    lastGoodData: data,
    lastGoodUpdated: new Date(),
  };
}
