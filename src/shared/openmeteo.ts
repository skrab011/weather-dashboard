// ---------------------------------------------------------------------------
// Open-Meteo data layer — free, keyless, CORS-friendly multi-model forecast API.
//
// Like NWS, Open-Meteo is called directly from the browser (no serverless
// proxy, no API key). It serves several global weather models; we start with
// ECMWF (the European model) to give the comparison chart a second opinion —
// especially valuable for non-Colorado locations on the shared page, which
// otherwise have only NWS.
//
// Each function fetches one model for one location and throws on failure; the
// caller wraps it in the SourceResult/settle() failure-isolation envelope so a
// missing Open-Meteo line never affects other chart series or cards.
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

import type { OpenMeteoForecast, OpenMeteoRow } from "./types";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// ECMWF IFS at 0.25° — the European model. Track A4 may add GFS/ICON later by
// extending the `models` param; the series accessor below already tolerates the
// suffixed field names Open-Meteo uses when more than one model is requested.
const OPEN_METEO_MODEL = "ecmwf_ifs025";

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
// Returns normalized rows (UTC ISO timestamps) + the model grid-cell elevation.
// Throws on HTTP error or a malformed response.
// ---------------------------------------------------------------------------
export async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoForecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,wind_speed_10m,precipitation,snowfall",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timeformat: "unixtime", // absolute UTC seconds — unambiguous for alignment
    forecast_days: "3",
    models: OPEN_METEO_MODEL,
  });

  const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  const json = (await res.json()) as OpenMeteoResponse;
  const hourly = json.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error("Open-Meteo: hourly.time missing from response");
  }

  const times = hourly.time as number[];
  const temps  = series(hourly, "temperature_2m", OPEN_METEO_MODEL);
  const winds  = series(hourly, "wind_speed_10m", OPEN_METEO_MODEL);
  const precs  = series(hourly, "precipitation", OPEN_METEO_MODEL);
  const snows  = series(hourly, "snowfall", OPEN_METEO_MODEL);

  const rows: OpenMeteoRow[] = times.map((unixSec, i) => ({
    dateTime: new Date(unixSec * 1000).toISOString(),
    tempF:    numOrNull(temps[i]),
    windMph:  numOrNull(winds[i]),
    precipIn: numOrNull(precs[i]),
    snowIn:   numOrNull(snows[i]),
  }));

  const elevationFt =
    typeof json.elevation === "number" ? json.elevation * METERS_TO_FEET : null;

  return { model: OPEN_METEO_MODEL, elevationFt, rows };
}
