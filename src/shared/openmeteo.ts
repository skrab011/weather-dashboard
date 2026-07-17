// ---------------------------------------------------------------------------
// Open-Meteo data layer — free, keyless, CORS-friendly multi-model forecast API.
//
// Like NWS, Open-Meteo is called directly from the browser (no serverless
// proxy, no API key). It serves several global weather models; we draw ECMWF
// (the European model) and GFS (the American model) so the comparison chart has
// independent second/third opinions — especially valuable for non-Colorado
// locations on the shared page, which otherwise have only NWS.
//
// We fetch one model per request (rather than one combined multi-model request)
// so each model keeps its own clean grid-cell elevation. Each per-model fetch
// throws on failure; the caller wraps the set in a SourceResult so a missing
// model never affects the others or any other card.
//
// UNIT NOTE: we request Fahrenheit / mph / inch explicitly. Snowfall is part of
// Open-Meteo's precipitation family and is returned in inches when
// precipitation_unit=inch. Confirm precip/snow units against the live feed when
// the variable toggle (Track C) actually plots them.
//
// Docs / attribution: https://open-meteo.com/ — "Weather data by Open-Meteo.com"
// (shown in the chart UI). Free tier is non-commercial, well under its daily
// call limit at personal/family scale.
// ---------------------------------------------------------------------------

import type { CurrentWind, OpenMeteoForecast, OpenMeteoRow, SourceResult } from "./types";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Models drawn on the chart, in order:
//   ecmwf_ifs025  → ECMWF, the European model (0.25°)
//   gfs_seamless  → GFS, the American model (uses HRRR near-term over the US)
// Add ICON etc. here later; the chart draws one line per model automatically.
const OPEN_METEO_MODELS = ["ecmwf_ifs025", "gfs_seamless"];

const METERS_TO_FEET = 3.28084;

// Coerce a value to a finite number, or null. Open-Meteo uses null for gaps.
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Pull one hourly series from the response, tolerating both the unsuffixed key
// (single-model requests) and the `{key}_{model}` suffixed key (multi-model).
function series(
  hourly: Record<string, unknown>,
  key: string,
  model: string,
): unknown[] {
  const arr = hourly[key] ?? hourly[`${key}_${model}`];
  return Array.isArray(arr) ? arr : [];
}

interface OpenMeteoResponse {
  elevation?: number; // metres
  hourly?: Record<string, unknown> & { time?: unknown[] };
}

// ---------------------------------------------------------------------------
// Fetch one model's hourly forecast for a location.
//   lat, lon  decimal degrees
//   model     Open-Meteo model id (e.g. "ecmwf_ifs025")
// Returns normalized rows (UTC ISO timestamps) + the model grid-cell elevation.
// Throws on HTTP error or a malformed response.
// ---------------------------------------------------------------------------
async function fetchOneModel(lat: number, lon: number, model: string): Promise<OpenMeteoForecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,wind_speed_10m,precipitation,snowfall",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timeformat: "unixtime", // absolute UTC seconds — unambiguous for alignment
    forecast_days: "3",
    models: model,
  });

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} (${model})`);

  const json = (await res.json()) as OpenMeteoResponse;
  const hourly = json.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error(`Open-Meteo: hourly.time missing from response (${model})`);
  }

  const times = hourly.time as number[];
  const temps  = series(hourly, "temperature_2m", model);
  const winds  = series(hourly, "wind_speed_10m", model);
  const precs  = series(hourly, "precipitation", model);
  const snows  = series(hourly, "snowfall", model);

  const rows: OpenMeteoRow[] = times.map((unixSec, i) => ({
    dateTime: new Date(unixSec * 1000).toISOString(),
    tempF:    numOrNull(temps[i]),
    windMph:  numOrNull(winds[i]),
    precipIn: numOrNull(precs[i]),
    snowIn:   numOrNull(snows[i]),
  }));

  const elevationFt =
    typeof json.elevation === "number" ? json.elevation * METERS_TO_FEET : null;

  return { model, elevationFt, rows };
}

// ---------------------------------------------------------------------------
// Fetch all configured models for a location, in parallel. Returns the models
// that succeeded (so one model failing still draws the others). Throws only if
// every model fails, so the caller's SourceResult reflects a real outage.
// ---------------------------------------------------------------------------
export async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoForecast[]> {
  const settled = await Promise.allSettled(
    OPEN_METEO_MODELS.map((m) => fetchOneModel(lat, lon, m)),
  );
  const ok = settled
    .filter((r): r is PromiseFulfilledResult<OpenMeteoForecast> => r.status === "fulfilled")
    .map((r) => r.value);

  if (ok.length === 0) {
    const firstErr = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstErr?.reason instanceof Error ? firstErr.reason : new Error("Open-Meteo: all models failed");
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Current wind for the Now card — HRRR first, GFS fallback.
//
// HRRR (gfs_hrrr) is NOAA's 3 km rapid-refresh model, updated hourly — the
// best short-term wind source over the lower 48, but it doesn't cover
// Alaska/Hawaii. Models are tried in order; the first one that returns a
// usable reading wins, so off-CONUS locations (and HRRR outages) fall
// through to the global GFS automatically.
// ---------------------------------------------------------------------------
const CURRENT_WIND_MODELS = ["gfs_hrrr", "gfs_seamless"];

interface OpenMeteoCurrentResponse {
  current?: Record<string, unknown>;
}

// Pull one value from the `current` block, tolerating both the unsuffixed key
// (single-model requests) and the `{key}_{model}` suffixed key — same
// tolerance as series() above for the hourly block.
function currentValue(
  current: Record<string, unknown> | undefined,
  key: string,
  model: string,
): number | null {
  return numOrNull(current?.[key] ?? current?.[`${key}_${model}`]);
}

async function fetchCurrentWindModel(lat: number, lon: number, model: string): Promise<CurrentWind> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "mph",
    models: model,
  });

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} (${model})`);

  const json = (await res.json()) as OpenMeteoCurrentResponse;
  const speedMph     = currentValue(json.current, "wind_speed_10m", model);
  const directionDeg = currentValue(json.current, "wind_direction_10m", model);
  if (speedMph === null || directionDeg === null) {
    throw new Error(`Open-Meteo: no current wind in response (${model})`);
  }
  return { model, speedMph, directionDeg };
}

// Failure-isolation wrapper for the Now card's wind. Never throws: when every
// model fails it returns an error result that preserves the previous good
// reading, and the card itself falls back to NWS wind when nothing is left.
export async function fetchCurrentWindResult(
  lat: number,
  lon: number,
  prev: SourceResult<CurrentWind>,
): Promise<SourceResult<CurrentWind>> {
  let lastErr = "Open-Meteo: current wind unavailable";
  for (const model of CURRENT_WIND_MODELS) {
    try {
      const data = await fetchCurrentWindModel(lat, lon, model);
      const now = new Date();
      return { data, error: null, lastUpdated: now, lastGoodData: data, lastGoodUpdated: now };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    data: null,
    error: lastErr,
    lastUpdated: null,
    lastGoodData: prev.lastGoodData,
    lastGoodUpdated: prev.lastGoodUpdated,
  };
}

// ---------------------------------------------------------------------------
// Failure-isolation wrapper — mirrors settle() in nws.ts.
//
// Fetches one model and returns a SourceResult, never throwing: on error it
// preserves the previous good data so a transient Open-Meteo outage leaves the
// last forecast on the chart rather than dropping the line. The boot files call
// this in parallel with the NWS + air-quality fetches.
// ---------------------------------------------------------------------------
export async function fetchOpenMeteoResult(
  lat: number,
  lon: number,
  prev: SourceResult<OpenMeteoForecast[]>,
): Promise<SourceResult<OpenMeteoForecast[]>> {
  try {
    const data = await fetchOpenMeteo(lat, lon);
    const now = new Date();
    return { data, error: null, lastUpdated: now, lastGoodData: data, lastGoodUpdated: now };
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
