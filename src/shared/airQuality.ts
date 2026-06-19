// ---------------------------------------------------------------------------
// Frontend air quality data layer.
//
// Calls our own serverless proxy (/api/air-quality) — never touches PurpleAir
// or AirNow directly. The proxy handles key security and all corrections.
//
// Two call forms (both return SourceResult<LocationAirQuality>):
//   V1: fetchAirQuality("home" | "office", prev)
//       → sends ?location=home|office  (byte-identical to before)
//   V2: fetchAirQuality(lat, lon, { showTemp }, prev)
//       → sends ?lat=&lon=&temp=
// ---------------------------------------------------------------------------

import type { LocationAirQuality, SourceResult } from "./types";

export async function fetchAirQuality(
  locationIdOrLat: "home" | "office" | number,
  prevOrLon: SourceResult<LocationAirQuality> | number,
  optsOrPrev?: { showTemp?: boolean } | SourceResult<LocationAirQuality>,
  maybePrev?: SourceResult<LocationAirQuality>,
): Promise<SourceResult<LocationAirQuality>> {
  let url: string;
  let prev: SourceResult<LocationAirQuality>;

  if (typeof locationIdOrLat === "string") {
    // V1 form: fetchAirQuality("home" | "office", prev)
    url = `/api/air-quality?location=${locationIdOrLat}`;
    prev = prevOrLon as SourceResult<LocationAirQuality>;
  } else {
    // V2 form: fetchAirQuality(lat, lon, { showTemp }, prev)
    const lat = locationIdOrLat;
    const lon = prevOrLon as number;
    const opts = optsOrPrev as { showTemp?: boolean } | undefined;
    prev = maybePrev!;
    const showTemp = opts?.showTemp ?? false;
    url = `/api/air-quality?lat=${lat}&lon=${lon}&temp=${showTemp}`;
  }

  try {
    const res = await fetch(url);
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
