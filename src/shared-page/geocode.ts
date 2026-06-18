// ---------------------------------------------------------------------------
// Shared page (V2) — frontend geocoding client.
//
// Calls our own /api/geocode proxy (Census → Nominatim) and returns a
// normalized result, computing the `inColorado` flag that drives Colorado
// gating (CAIC, Tomer, overlay chart) elsewhere on the shared page.
//
// Never calls a geocoder directly — the proxy handles source selection,
// US restriction, and caching.
// ---------------------------------------------------------------------------

export interface GeoResult {
  lat: number;
  lon: number;
  state: string;        // 2-letter postal code, e.g. "CO" ("" if unknown)
  label: string;        // human-readable matched/display address
  inColorado: boolean;  // computed once here; persisted alongside the location
  source: "census" | "nominatim";
}

export type GeocodeOutcome =
  | { found: true; result: GeoResult }
  | { found: false; reason: "not_found" | "not_us" | "error" };

// Shape returned by /api/geocode.
interface GeocodeApiResponse {
  found: boolean;
  lat?: number;
  lon?: number;
  state?: string;
  label?: string;
  source?: "census" | "nominatim";
  reason?: "not_found" | "not_us" | "error";
}

// Colorado bounding box — fallback when the geocoder can't supply a state code.
// Roughly lat 37.0–41.0, lon -109.05 to -102.05 (CO is a near-perfect rectangle).
const CO_BBOX = { latMin: 37.0, latMax: 41.0, lonMin: -109.05, lonMax: -102.05 };

// Preferred: geocoder state field (state === "CO"). Fallback: bounding box.
function computeInColorado(state: string, lat: number, lon: number): boolean {
  if (state) return state.toUpperCase() === "CO";
  return lat >= CO_BBOX.latMin && lat <= CO_BBOX.latMax
      && lon >= CO_BBOX.lonMin && lon <= CO_BBOX.lonMax;
}

export async function geocode(query: string): Promise<GeocodeOutcome> {
  const q = query.trim();
  if (!q) return { found: false, reason: "not_found" };

  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) return { found: false, reason: "error" };

    const data = await res.json() as GeocodeApiResponse;

    if (!data.found
      || typeof data.lat !== "number"
      || typeof data.lon !== "number") {
      return { found: false, reason: data.reason ?? "not_found" };
    }

    const state = data.state ?? "";
    return {
      found: true,
      result: {
        lat: data.lat,
        lon: data.lon,
        state,
        label: data.label ?? q,
        source: data.source ?? "census",
        inColorado: computeInColorado(state, data.lat, data.lon),
      },
    };
  } catch {
    return { found: false, reason: "error" };
  }
}
