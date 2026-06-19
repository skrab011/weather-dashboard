// ---------------------------------------------------------------------------
// Shared page (V2) — localStorage persistence for the user's chosen locations.
//
// The shared page has no accounts and no backend: the (up to 2) locations a
// visitor picks are remembered per-device in localStorage only. This keeps the
// feature zero-cost and private. The personal page (V1) does not use this —
// its two locations are hardcoded constants.
//
// Storage is defensive on read: a missing key, malformed JSON, or a shape that
// doesn't match (old/corrupt data) all fall back to an empty list rather than
// throwing, so a bad localStorage value can never break the page.
// ---------------------------------------------------------------------------

// One stored location. `state` (2-letter postal code) and `inColorado` are
// captured once at pick-time from the geocoder so Colorado gating (W5) and the
// dual-mode brief (W6) never need to re-geocode.
export interface StoredLocation {
  label: string;
  lat: number;
  lon: number;
  state: string;
  inColorado: boolean;
}

// Versioned key — bump the suffix if the StoredLocation shape ever changes so
// old data is ignored rather than mis-read.
const STORAGE_KEY = "weather-shared-locations-v1";

// Hard cap on locations, matching the personal page's two-location layout.
export const MAX_LOCATIONS = 2;

// Validate one parsed item against the StoredLocation shape.
function isValidLocation(x: unknown): x is StoredLocation {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.label === "string" &&
    typeof o.lat === "number" && Number.isFinite(o.lat) &&
    typeof o.lon === "number" && Number.isFinite(o.lon) &&
    typeof o.state === "string" &&
    typeof o.inColorado === "boolean"
  );
}

// Load the stored locations. Returns an empty array on any problem (no key,
// corrupt JSON, wrong shape) — never throws.
export function loadLocations(): StoredLocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Keep only valid entries, then cap at the maximum.
    return parsed.filter(isValidLocation).slice(0, MAX_LOCATIONS);
  } catch {
    return [];
  }
}

// Persist the locations (capped at the maximum). Silently no-ops if storage is
// unavailable (e.g. Safari private mode quota), since persistence is a
// convenience, not a correctness requirement.
export function saveLocations(locations: StoredLocation[]): void {
  try {
    const capped = locations.slice(0, MAX_LOCATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    /* storage unavailable — ignore */
  }
}
