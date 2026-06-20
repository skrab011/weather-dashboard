// ---------------------------------------------------------------------------
// GET /api/geocode?q=<address> — US-only geocoding proxy.
//
// Two-source strategy:
//   1. US Census Geocoder (official, free, no key) — excellent for full street
//      addresses, weak for bare city/ZIP queries.
//   2. OpenStreetMap Nominatim (free, no key) — fallback that resolves the
//      city/ZIP/place names casual users actually type.
//
// Returns a normalized result the shared page can consume directly:
//   { found: true, lat, lon, state, label, source }
//   { found: false, reason: "not_found" | "not_us" | "error" }
//
// Self-contained: Vercel cannot bundle cross-file imports within /api/, so all
// constants/types live inline (same pattern as api/air-quality.ts).
// ---------------------------------------------------------------------------

type Query = Record<string, string | string[]>;
interface Req { query: Query }
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

// Normalized hit shared by both geocoders. state is the 2-letter postal code
// (e.g. "CO") when available; "" when the source can't supply it (the frontend
// falls back to a Colorado bounding box in that case).
interface GeoHit {
  lat: number;
  lon: number;
  state: string;
  label: string;
  source: "census" | "nominatim";
}

const CENSUS_URL    = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires a descriptive User-Agent with a contact.
const NOMINATIM_UA  = "weather-dashboard/1.0 (https://weather-dashboard-five-umber.vercel.app; jskraba0601@gmail.com)";

// Coarse US envelope (incl. AK/HI) — defense-in-depth. Both sources already
// restrict to the US, but this rejects anything obviously off-continent and
// keeps the owner's downstream API keys from being used for non-US lookups.
const US_BBOX = { latMin: 15, latMax: 72, lonMin: -180, lonMax: -64 };

function inUS(lat: number, lon: number): boolean {
  return lat >= US_BBOX.latMin && lat <= US_BBOX.latMax
      && lon >= US_BBOX.lonMin && lon <= US_BBOX.lonMax;
}

// Census returns all-caps addresses ("42 LACY DR, SILVERTHORNE, CO 80498").
// Title-case each word, then restore the 2-letter state abbreviation to full
// uppercase (it appears immediately before the 5-digit ZIP code).
function titleCaseAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b[A-Za-z]{2}\b(?=\s+\d{5})/g, (m) => m.toUpperCase());
}

// ---------------------------------------------------------------------------
// Census Geocoder — coordinates come back as { x: lon, y: lat }; state is the
// 2-letter postal abbreviation in addressComponents.
// ---------------------------------------------------------------------------
async function geocodeCensus(q: string): Promise<GeoHit | null> {
  const url = `${CENSUS_URL}?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return null;

  const j = await r.json() as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string;
        coordinates?: { x: number; y: number };
        addressComponents?: { state?: string };
      }>;
    };
  };

  const m = j.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;

  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    state: (m.addressComponents?.state ?? "").toUpperCase(),
    label: m.matchedAddress ? titleCaseAddress(m.matchedAddress) : q,
    source: "census",
  };
}

// ---------------------------------------------------------------------------
// Nominatim fallback — countrycodes=us restricts to the US. state comes from
// the ISO3166-2 code (e.g. "US-CO" → "CO"); the plain "state" field is a full
// name, so we prefer the ISO code for a clean 2-letter abbreviation.
// ---------------------------------------------------------------------------
async function geocodeNominatim(q: string): Promise<GeoHit | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&countrycodes=us&limit=1`;
  const r = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) return null;

  const arr = await r.json() as Array<{
    lat: string;
    lon: string;
    display_name?: string;
    address?: Record<string, string>;
  }>;

  const m = arr?.[0];
  if (!m) return null;

  const lat = parseFloat(m.lat);
  const lon = parseFloat(m.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const iso = m.address?.["ISO3166-2-lvl4"] ?? "";        // e.g. "US-CO"
  const state = iso.includes("-") ? iso.split("-")[1].toUpperCase() : "";

  // Build a clean "City, ST" label from structured address fields rather than
  // Nominatim's verbose display_name ("City, County, State, Country").
  const addr = m.address ?? {};
  const place = addr["city"] ?? addr["town"] ?? addr["village"]
             ?? addr["municipality"] ?? addr["suburb"] ?? addr["neighbourhood"]
             ?? addr["county"] ?? "";
  const label = place && state ? `${place}, ${state}` : (m.display_name ?? q);

  return { lat, lon, state, label, source: "nominatim" };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: Req, res: Res): Promise<void> {
  // Geocoding results are stable — cache aggressively at the CDN.
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

  const raw = req.query["q"];
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  if (!q) { res.status(400).json({ found: false, reason: "not_found" }); return; }

  try {
    // Census first (official); fall back to Nominatim for place/ZIP queries.
    let hit = await geocodeCensus(q).catch(() => null);
    if (!hit) hit = await geocodeNominatim(q).catch(() => null);

    if (!hit) { res.status(200).json({ found: false, reason: "not_found" }); return; }
    if (!inUS(hit.lat, hit.lon)) { res.status(200).json({ found: false, reason: "not_us" }); return; }

    res.status(200).json({
      found: true,
      lat: hit.lat,
      lon: hit.lon,
      state: hit.state,
      label: hit.label,
      source: hit.source,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(200).json({ found: false, reason: "error", error: msg });
  }
}
