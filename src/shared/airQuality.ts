// ---------------------------------------------------------------------------
// Frontend air quality data layer.
//
// Calls our own serverless proxy (/api/air-quality) — never touches PurpleAir
// or AirNow directly. The proxy handles key security and all corrections.
// ---------------------------------------------------------------------------

import type { LocationAirQuality, SourceResult } from "./types";

// Wrap a fetch in a SourceResult, preserving last-good data on failure.
// Same pattern used in nws.ts — each source fails independently.
export async function fetchAirQuality(
  locationId: "home" | "office",
  prev: SourceResult<LocationAirQuality>,
): Promise<SourceResult<LocationAirQuality>> {
  try {
    const res = await fetch(`/api/air-quality?location=${locationId}`);
    if (!res.ok) throw new Error(`Air quality proxy HTTP ${res.status}`);

    const data = await res.json() as LocationAirQuality;
    const now = new Date();

    return {
      data,
      error: null,
      lastUpdated: now,
      lastGoodData: data,
      lastGoodUpdated: now,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
      lastUpdated: null,
      lastGoodData: prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }
}
