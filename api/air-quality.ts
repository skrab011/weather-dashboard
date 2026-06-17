// ---------------------------------------------------------------------------
// Serverless proxy for PurpleAir + AirNow.
//
// This is the ONLY file that ever sees PURPLEAIR_API_KEY and AIRNOW_API_KEY.
// The browser calls /api/air-quality?location=home (or office) and receives
// fully processed data — no raw keys, no raw sensor values.
//
// Query params:
//   location  "home" | "office"
//
// Both external calls run in parallel. If one fails, the other's result is
// still returned — partial data is better than nothing.
// ---------------------------------------------------------------------------

// Minimal Vercel Node.js request/response types (avoids @vercel/node dependency)
type Query = Record<string, string | string[]>;
interface Req { query: Query }
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

// ---------------------------------------------------------------------------
// Location coordinates — must match src/locations.ts exactly.
// Duplicated here because serverless functions can't import from src/.
// ---------------------------------------------------------------------------
const LOCATIONS: Record<string, { lat: number; lon: number }> = {
  home:   { lat: 39.619625, lon: -106.090422 },
  office: { lat: 39.576179, lon: -106.09718  },
};

// ---------------------------------------------------------------------------
// Bounding box for a 4-mile radius at Summit County latitudes (~39.6°N).
//   1° latitude  ≈ 69.0 miles  → 4 miles ≈ 0.058°
//   1° longitude ≈ 53.2 miles at 39.6°N → 4 miles ≈ 0.075°
// PurpleAir convention: nwlng = western (min) lon, selng = eastern (max) lon.
// ---------------------------------------------------------------------------
const LAT_DELTA = 0.058;
const LON_DELTA = 0.075;

// PurpleAir fields to request. The API returns data in a columnar format:
//   { fields: ["sensor_index", "latitude", ...], data: [[val, val, ...], ...] }
// We request exactly the fields we need to keep the response small.
const PA_FIELDS = [
  "sensor_index",
  "name",
  "latitude",
  "longitude",
  "last_seen",         // Unix timestamp; we exclude sensors older than 90 min
  "pm2.5_cf_1_a",     // Channel A CF=1 reading (needed for EPA correction)
  "pm2.5_cf_1_b",     // Channel B CF=1 reading (null on single-channel sensors)
  "pm2.5_10minute",   // 10-minute average (trend point — most recent)
  "pm2.5_30minute",
  "pm2.5_60minute",
  "pm2.5_6hour",
  "pm2.5_24hour",     // 24-hour average (trend point — oldest)
  "temperature",      // °F, self-heated (~8°F above ambient)
  "humidity",         // % relative humidity (used in EPA correction)
].join(",");

// ---------------------------------------------------------------------------
// Haversine distance between two lat/lon points, in miles.
// Used to filter sensors after the bounding-box query — corners of the box
// can be up to ~5.3 miles from the centre.
// ---------------------------------------------------------------------------
function distanceMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8; // Earth's mean radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// EPA 2022 PM2.5 correction for PurpleAir sensors.
//
// PurpleAir's laser particle counter over-reads during wildfire smoke because
// smoke particles scatter laser light differently than the "standard" aerosol
// used for factory calibration. The EPA derived this regression against
// co-located reference monitors (FEM/FRM):
//
//   PM2.5_corrected = 0.52 × PM2.5_cf1 − 0.086 × RH + 5.75
//
// where PM2.5_cf1 is the average of channel A and B CF=1 readings,
// and RH is the relative humidity from the same sensor.
//
// The correction compresses high readings (smoke episodes) and adjusts for
// humidity, which causes aerosol particles to swell and scatter more light
// even when actual PM2.5 mass is unchanged.
//
// Valid range: 0–343 µg/m³ (above 343, a different formula applies — not
// relevant for this app; we clamp the output to ≥ 0).
// ---------------------------------------------------------------------------
function epaCorrectedPM25(pm25cf1: number, humidity: number): number {
  return Math.max(0, 0.52 * pm25cf1 - 0.086 * humidity + 5.75);
}

// ---------------------------------------------------------------------------
// PurpleAir temperature correction.
//
// The sensor electronics and enclosure self-heat by approximately 8°F above
// ambient temperature. PurpleAir Inc. documents this fixed offset as the
// standard correction for their PA-II hardware. Subtract to get ambient.
// ---------------------------------------------------------------------------
function correctTempF(rawF: number): number {
  return rawF - 8;
}

// Typed shape of one unpacked PurpleAir sensor row
interface PASensor {
  sensor_index: number;
  latitude: number;
  longitude: number;
  last_seen: number;           // Unix epoch seconds
  "pm2.5_cf_1_a": number | null;
  "pm2.5_cf_1_b": number | null;
  "pm2.5_10minute": number | null;
  "pm2.5_30minute": number | null;
  "pm2.5_60minute": number | null;
  "pm2.5_6hour": number | null;
  "pm2.5_24hour": number | null;
  temperature: number | null;
  humidity: number | null;
}

// ---------------------------------------------------------------------------
// fetch with AbortController timeout so a slow external API does not stall
// the serverless function up to Vercel's 30-second hard limit.
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req: Req, res: Res): Promise<void> {
  const locationId = String(req.query.location ?? "home");
  const coords = LOCATIONS[locationId];

  if (!coords) {
    res.status(400).json({ error: "Unknown location" });
    return;
  }

  const purpleAirKey = process.env.PURPLEAIR_API_KEY ?? "";
  const airnowKey    = process.env.AIRNOW_API_KEY ?? "";

  const { lat, lon } = coords;

  // Run both external API calls in parallel — neither waits on the other
  const [paResult, anResult] = await Promise.allSettled([
    fetchPurpleAir(lat, lon, purpleAirKey),
    fetchAirNow(lat, lon, airnowKey),
  ]);

  // Unpack PurpleAir result
  let pm25: number | null = null;
  let trend: (number | null)[] = [null, null, null, null, null];
  let tempF: number | null = null;
  let sensorCount = 0;
  let purpleAirError: string | null = null;

  if (paResult.status === "fulfilled") {
    ({ pm25, trend, tempF, sensorCount } = paResult.value);
    // Only return PA temperature for the home location (spec requirement)
    if (locationId !== "home") tempF = null;
  } else {
    purpleAirError = String(paResult.reason);
  }

  // Unpack AirNow result
  let airnowPm25: number | null = null;
  let airnowError: string | null = null;

  if (anResult.status === "fulfilled") {
    airnowPm25 = anResult.value;
  } else {
    airnowError = String(anResult.reason);
  }

  // Divergence flag: flag red only when both sources are available AND they
  // disagree by more than 5 µg/m³ AND more than 10% of the larger reading.
  // The hybrid threshold keeps it quiet in clean air (small absolute differences
  // are meaningless at low concentrations) while still catching real smoke events.
  const divergent =
    pm25 !== null &&
    airnowPm25 !== null &&
    Math.abs(pm25 - airnowPm25) > 5 &&
    Math.abs(pm25 - airnowPm25) / Math.max(pm25, airnowPm25, 1) > 0.10;

  res.status(200).json({
    pm25,
    trend,
    tempF,
    airnowPm25,
    divergent,
    sensorCount,
    purpleAirError,
    airnowError,
    fetchedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// PurpleAir fetch + processing
// ---------------------------------------------------------------------------
interface PAProcessed {
  pm25: number | null;
  trend: (number | null)[];
  tempF: number | null;
  sensorCount: number;
}

async function fetchPurpleAir(lat: number, lon: number, apiKey: string): Promise<PAProcessed> {
  if (!apiKey) throw new Error("PURPLEAIR_API_KEY not configured");

  const nwlat = lat + LAT_DELTA;
  const selat = lat - LAT_DELTA;
  const nwlng = lon - LON_DELTA; // western (more negative) longitude
  const selng = lon + LON_DELTA; // eastern (less negative) longitude

  const url =
    `https://api.purpleair.com/v1/sensors` +
    `?fields=${PA_FIELDS}` +
    `&location_type=0` +            // outdoor sensors only
    `&nwlat=${nwlat}&nwlng=${nwlng}` +
    `&selat=${selat}&selng=${selng}`;

  const res = await fetchWithTimeout(url, {
    headers: { "X-API-Key": apiKey },
  });

  if (!res.ok) throw new Error(`PurpleAir HTTP ${res.status}`);

  const json = await res.json() as { fields: string[]; data: (number | null)[][] };

  // Unpack columnar response into typed objects
  const fieldIndex = Object.fromEntries(json.fields.map((f, i) => [f, i]));
  const sensors: PASensor[] = json.data.map((row) => {
    const get = (field: string) => {
      const i = fieldIndex[field];
      return i !== undefined ? row[i] : null;
    };
    return {
      sensor_index:    get("sensor_index") as number,
      latitude:        get("latitude") as number,
      longitude:       get("longitude") as number,
      last_seen:       get("last_seen") as number,
      "pm2.5_cf_1_a": get("pm2.5_cf_1_a") as number | null,
      "pm2.5_cf_1_b": get("pm2.5_cf_1_b") as number | null,
      "pm2.5_10minute": get("pm2.5_10minute") as number | null,
      "pm2.5_30minute": get("pm2.5_30minute") as number | null,
      "pm2.5_60minute": get("pm2.5_60minute") as number | null,
      "pm2.5_6hour":   get("pm2.5_6hour") as number | null,
      "pm2.5_24hour":  get("pm2.5_24hour") as number | null,
      temperature:     get("temperature") as number | null,
      humidity:        get("humidity") as number | null,
    };
  });

  const nowSec = Date.now() / 1000;
  const STALE_SECS = 90 * 60; // exclude sensors silent for more than 90 minutes

  const valid = sensors.filter((s) => {
    // Must be within 4 miles (bounding box corners can be ~5.3 miles out)
    if (distanceMiles(lat, lon, s.latitude, s.longitude) > 4) return false;

    // Must have reported recently
    if (nowSec - s.last_seen > STALE_SECS) return false;

    // Need at least one PM channel
    const a = s["pm2.5_cf_1_a"];
    const b = s["pm2.5_cf_1_b"];
    if (a === null && b === null) return false;

    // Channel A/B agreement check — exclude sensors where channels wildly disagree,
    // which indicates a dirty or malfunctioning sensor.
    // Only applies when both channels are present.
    if (a !== null && b !== null) {
      const diff = Math.abs(a - b);
      const avg  = (a + b) / 2;
      // More than 5 µg/m³ difference AND more than 70% relative spread → discard
      if (diff > 5 && avg > 0 && diff / avg > 0.70) return false;
    }

    return true;
  });

  if (valid.length === 0) {
    return { pm25: null, trend: [null, null, null, null, null], tempF: null, sensorCount: 0 };
  }

  // Average humidity across valid sensors (used in EPA correction for all values)
  const avgHumidity =
    valid.reduce((sum, s) => sum + (s.humidity ?? 50), 0) / valid.length;

  // Compute EPA-corrected current PM2.5 for each sensor, then average
  const correctedReadings = valid.map((s) => {
    const a = s["pm2.5_cf_1_a"];
    const b = s["pm2.5_cf_1_b"];
    const cf1 = a !== null && b !== null ? (a + b) / 2 : (a ?? b)!;
    const rh  = s.humidity ?? avgHumidity;
    return epaCorrectedPM25(cf1, rh);
  });
  const pm25 = correctedReadings.reduce((s, v) => s + v, 0) / correctedReadings.length;

  // Build trend: average each time-bucket across sensors, then EPA-correct.
  // Time-average fields use CF-ATM not CF-1, but we apply the same correction
  // using the current average RH as a proxy — the relative shape of the trend
  // is what matters here, not sub-µg/m³ precision.
  const trendFields: (keyof PASensor)[] = [
    "pm2.5_24hour",
    "pm2.5_6hour",
    "pm2.5_60minute",
    "pm2.5_30minute",
    "pm2.5_10minute",
  ];

  const trend = trendFields.map((field) => {
    const vals = valid.map((s) => s[field] as number | null).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return epaCorrectedPM25(avg, avgHumidity);
  });

  // Average temperature across valid sensors, then apply -8°F self-heat correction
  const rawTemps = valid.map((s) => s.temperature).filter((t): t is number => t !== null);
  const tempF = rawTemps.length > 0
    ? correctTempF(rawTemps.reduce((s, v) => s + v, 0) / rawTemps.length)
    : null;

  return { pm25, trend, tempF, sensorCount: valid.length };
}

// ---------------------------------------------------------------------------
// AirNow fetch — returns the current PM2.5 reading from the nearest official
// EPA monitor within 25 miles, or null if none is available.
// ---------------------------------------------------------------------------
async function fetchAirNow(lat: number, lon: number, apiKey: string): Promise<number | null> {
  if (!apiKey) throw new Error("AIRNOW_API_KEY not configured");

  const url =
    `https://www.airnowapi.org/aq/observation/latLong/current/` +
    `?format=application/json` +
    `&latitude=${lat}&longitude=${lon}` +
    `&distance=25` +
    `&API_KEY=${apiKey}`;

  const res = await fetchWithTimeout(url, {});
  if (!res.ok) throw new Error(`AirNow HTTP ${res.status}`);

  const observations = await res.json() as Array<{
    ParameterName: string;
    Value: number;
    AQI: number;
    DateObserved: string;
    HourObserved: number;
  }>;

  // AirNow returns multiple pollutants; we want PM2.5 only
  const pm25obs = observations.find((o) => o.ParameterName.trim() === "PM2.5");
  return pm25obs?.Value ?? null;
}
