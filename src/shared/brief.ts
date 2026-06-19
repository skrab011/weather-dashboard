// ---------------------------------------------------------------------------
// Frontend fetch layer for the consensus/forecast brief.
// Calls /api/brief and wraps the result in a SourceResult envelope.
// The ?refresh=true path is used by the manual refresh button.
//
// V1 call sites (both unchanged — no options arg → same URLs as before):
//   fetchBrief(state.brief)          → GET /api/brief
//   fetchBrief(brief, true)          → GET /api/brief?refresh=true
//
// V2 call sites pass location options:
//   fetchBrief(prev, false, { lat, lon, inColorado })
//   fetchBrief(prev, true,  { lat, lon, inColorado })
// ---------------------------------------------------------------------------

import type { ConsensusBrief, SourceResult } from "./types";

export async function fetchBrief(
  prev: SourceResult<ConsensusBrief>,
  refresh = false,
  options?: { lat?: number; lon?: number; inColorado?: boolean },
): Promise<SourceResult<ConsensusBrief>> {
  let url: string;

  if (options?.lat !== undefined && options?.lon !== undefined) {
    // V2 path — parameterized request
    const params = new URLSearchParams({
      lat: String(options.lat),
      lon: String(options.lon),
      co:  String(options.inColorado ?? false),
    });
    if (refresh) params.set("refresh", "true");
    url = `/api/brief?${params.toString()}`;
  } else {
    // V1 path — no extra params, byte-identical to existing call sites
    url = refresh ? "/api/brief?refresh=true" : "/api/brief";
  }

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
