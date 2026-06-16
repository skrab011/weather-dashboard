// ---------------------------------------------------------------------------
// NWS (National Weather Service) data layer.
//
// All fetch logic lives here. Each function fetches exactly one endpoint
// and is independent — a failure in one does not affect the others.
//
// NWS API is free and requires no key. It does require a descriptive
// User-Agent header per their terms of service.
//
// Endpoint overview:
//   /points/{lat},{lon}              → grid metadata + forecast URLs
//   /gridpoints/{office}/{x},{y}/forecast        → 7-day periods
//   /gridpoints/{office}/{x},{y}/forecast/hourly → hourly periods
//   /gridpoints/{office}/{x},{y}                 → raw time-series (snowfall, UV)
//   /alerts/active?point={lat},{lon}             → active alerts
// ---------------------------------------------------------------------------

import type {
  LocationWeather,
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  NWSPointsMeta,
  NWSTimeSeriesValue,
  SourceResult,
} from "./types";
import type { Location } from "./locations";

const NWS_BASE = "https://api.weather.gov";

// NWS requires a User-Agent that identifies the application and provides
// a contact point. Requests without this may be rate-limited.
const NWS_HEADERS: HeadersInit = {
  "User-Agent": "weather-dashboard/1.0 (personal app; jskraba0601@gmail.com)",
  Accept: "application/geo+json",
};

// ---------------------------------------------------------------------------
// Core fetch helper — adds one retry on 5xx errors.
// NWS /points in particular occasionally returns 500/503 during high traffic.
// ---------------------------------------------------------------------------
async function nwsFetch(url: string, retriesLeft = 1): Promise<Response> {
  const res = await fetch(url, { headers: NWS_HEADERS });

  if (!res.ok) {
    // Retry server errors once after a 1-second pause
    if (res.status >= 500 && retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return nwsFetch(url, retriesLeft - 1);
    }
    throw new Error(`NWS HTTP ${res.status} from ${url}`);
  }

  return res;
}

// ---------------------------------------------------------------------------
// /points — must be called first to get forecast URLs and grid coordinates.
// The forecast URLs are not predictable from lat/lon alone — NWS assigns them.
// ---------------------------------------------------------------------------
export async function fetchPoints(lat: number, lon: number): Promise<NWSPointsMeta> {
  const res = await nwsFetch(`${NWS_BASE}/points/${lat},${lon}`);
  const json = await res.json();
  const p = json.properties;

  return {
    gridId: p.gridId as string,
    gridX: p.gridX as number,
    gridY: p.gridY as number,
    forecastUrl: p.forecast as string,
    forecastHourlyUrl: p.forecastHourly as string,
    // forecastGridData is the raw gridpoint URL (snowfall, UV, etc.)
    gridpointUrl: p.forecastGridData as string,
  };
}

// ---------------------------------------------------------------------------
// 7-day period forecast — returns ~14 half-day periods (day + night pairs).
// ---------------------------------------------------------------------------
export async function fetchForecast(forecastUrl: string): Promise<NWSPeriod[]> {
  const res = await nwsFetch(forecastUrl);
  const json = await res.json();
  return json.properties.periods as NWSPeriod[];
}

// ---------------------------------------------------------------------------
// Hourly forecast — returns 156 hours (~6.5 days) of hourly periods.
// We only display the next 24 hours in the UI, but fetching all lets the user
// see more later if we add that feature.
// ---------------------------------------------------------------------------
export async function fetchHourly(forecastHourlyUrl: string): Promise<NWSPeriod[]> {
  const res = await nwsFetch(forecastHourlyUrl);
  const json = await res.json();
  return json.properties.periods as NWSPeriod[];
}

// ---------------------------------------------------------------------------
// Raw gridpoint data — contains time-series for fields not in the simple
// forecast endpoint, including snowfallAmount and uVIndex.
//
// UNIT NOTE: NWS gridpoint values use SI units.
//   snowfallAmount → wmoUnit:m  (metres)  — we convert to inches on read
//   uVIndex        → dimensionless
// ---------------------------------------------------------------------------
export async function fetchGridpoint(gridpointUrl: string): Promise<NWSGridpoint> {
  const res = await nwsFetch(gridpointUrl);
  const json = await res.json();
  const p = json.properties;

  return {
    // Fall back to empty values arrays if the field is absent (summer off-season)
    snowfallAmount: p.snowfallAmount ?? { uom: "wmoUnit:m", values: [] },
    uVIndex: p.uVIndex ?? { uom: "1", values: [] },
  };
}

// Alert event types we display. We use includes() rather than exact equality
// because NWS wording occasionally varies (e.g. "Winter Storm Watch" vs "Warning").
const ALERT_KEYWORDS = [
  "winter storm",
  "winter weather",
  "blizzard",
  "ice storm",
  "red flag",
  "fire weather",
  "air quality",
];

// ---------------------------------------------------------------------------
// Active alerts for a point — returns only the alert types we care about.
// ---------------------------------------------------------------------------
export async function fetchAlerts(lat: number, lon: number): Promise<NWSAlert[]> {
  const res = await nwsFetch(`${NWS_BASE}/alerts/active?point=${lat},${lon}`);
  const json = await res.json();

  return ((json.features ?? []) as Array<{ properties: NWSAlert }>)
    .map((f) => f.properties)
    .filter((a) => ALERT_KEYWORDS.some((kw) => a.event.toLowerCase().includes(kw)));
}

// ---------------------------------------------------------------------------
// Failure-isolation wrapper.
//
// Wraps a promise in a SourceResult. On success: updates data + timestamp.
// On failure: sets error + preserves lastGoodData from the previous result
// so the card can display stale data rather than going blank.
// ---------------------------------------------------------------------------
async function settle<T>(
  promise: Promise<T>,
  prev: SourceResult<T>,
): Promise<SourceResult<T>> {
  try {
    const data = await promise;
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
      // Keep the last successful values so the card can show stale data
      lastGoodData: prev.lastGoodData,
      lastGoodUpdated: prev.lastGoodUpdated,
    };
  }
}

// ---------------------------------------------------------------------------
// Fetch everything for one location in parallel.
//
// Uses settle() for each call so any single failure is isolated to its card.
// If /points fails (called before this), the caller handles the error and
// this function is never reached for that location.
// ---------------------------------------------------------------------------
export async function fetchAllForLocation(
  location: Location,
  meta: NWSPointsMeta,
  prev: LocationWeather,
): Promise<Omit<LocationWeather, "sunTimes">> {
  const [forecast, hourly, gridpoint, alerts] = await Promise.all([
    settle(fetchForecast(meta.forecastUrl), prev.forecast),
    settle(fetchHourly(meta.forecastHourlyUrl), prev.hourly),
    settle(fetchGridpoint(meta.gridpointUrl), prev.gridpoint),
    settle(fetchAlerts(location.lat, location.lon), prev.alerts),
  ]);

  return { forecast, hourly, gridpoint, alerts };
}

// ---------------------------------------------------------------------------
// Time-series utilities — used by the render layer to extract values from
// the gridpoint time-series format.
//
// NWS time-series values use ISO 8601 duration-encoded intervals:
//   "2025-01-15T06:00:00+00:00/PT1H"
//   = starting at 06:00 UTC, valid for 1 hour
// Durations we see in practice: PT1H, PT3H, PT6H, PT12H
// ---------------------------------------------------------------------------

interface ParsedInterval {
  start: Date;
  endMs: number; // start + duration in milliseconds
}

function parseInterval(validTime: string): ParsedInterval {
  const slash = validTime.indexOf("/");
  const isoStr = validTime.slice(0, slash);
  const duration = validTime.slice(slash + 1);

  const start = new Date(isoStr);

  // Parse ISO 8601 duration — we only need hours (PT#H)
  const hoursMatch = duration.match(/PT(\d+)H/);
  const durationMs = hoursMatch ? parseInt(hoursMatch[1], 10) * 3_600_000 : 3_600_000;

  return { start, endMs: start.getTime() + durationMs };
}

// Return the value whose time interval contains right now.
export function currentSeriesValue(
  values: NWSTimeSeriesValue[],
): number | null {
  const now = Date.now();
  for (const v of values) {
    const { start, endMs } = parseInterval(v.validTime);
    if (start.getTime() <= now && now < endMs) return v.value;
  }
  return null;
}

// Sum values whose intervals overlap the next `hours` hours from now.
// Used for "snowfall in the next 24 hours".
export function sumSeriesNextHours(
  values: NWSTimeSeriesValue[],
  hours: number,
  uom: string,
): number {
  const now = Date.now();
  const cutoff = now + hours * 3_600_000;
  let total = 0;

  for (const v of values) {
    if (v.value === null) continue;
    const { start, endMs } = parseInterval(v.validTime);

    // Include if the interval overlaps [now, cutoff]
    if (endMs > now && start.getTime() < cutoff) {
      // NWS gridpoint snowfall is in metres — convert to inches
      const inInches = uom.includes("m") ? v.value * 39.3701 : v.value;
      total += inInches;
    }
  }

  return total;
}

