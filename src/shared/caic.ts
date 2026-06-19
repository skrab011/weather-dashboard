// ---------------------------------------------------------------------------
// CAIC frontend fetch layer.
//
// Calls /api/caic and wraps both results in SourceResult envelopes so the
// render layer can display stale data on error. The two results (summary and
// point-forecast) are isolated from each other: a failure in one does not
// suppress the other.
//
// prev is the current CAICZoneData from the store; its lastGoodData fields
// are preserved on error so the last successful values survive network blips.
// ---------------------------------------------------------------------------

import type { CAICPointForecastRow, CAICWeatherSummary, CAICZoneData, SourceResult } from "./types";

interface CAICApiResponse {
  issuedBy:           string | null;
  bodyHtml:           string | null;
  summaryError:       string | null;
  pointForecast:      Array<Record<string, unknown>> | null;
  pointForecastError: string | null;
  fetchedAt:          string;
}

// Normalise one raw row from the point-forecast into our typed struct.
// Unknown keys are silently ignored so a schema change doesn't crash the app.
function parseRow(raw: Record<string, unknown>): CAICPointForecastRow {
  const num = (k: string): number | null => {
    const v = raw[k];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const str = (k: string): string | null => {
    const v = raw[k];
    return typeof v === "string" ? v : null;
  };

  return {
    // Try both camelCase and snake_case variants in case the feed changes
    dateTime:     str("dateTime") ?? str("date_time") ?? str("datetime") ?? "",
    tmpF:         num("tmpF")         ?? num("tmp_f")          ?? num("temperature"),
    precipIn:     num("precipIn")     ?? num("precip_in")      ?? num("precipitation"),
    snowIn:       num("snowIn")       ?? num("snow_in")        ?? num("snowfall"),
    windSpeedMph: num("windSpeedMph") ?? num("wind_speed_mph") ?? num("wind_speed"),
    windGustMph:  num("windGustMph")  ?? num("wind_gust_mph")  ?? num("wind_gust"),
    windDir:      str("windDir")      ?? str("wind_dir")       ?? str("wind_direction"),
  };
}

function successResult<T>(data: T): SourceResult<T> {
  const now = new Date();
  return { data, error: null, lastUpdated: now, lastGoodData: data, lastGoodUpdated: now };
}

function errorResult<T>(error: string, prev: SourceResult<T>): SourceResult<T> {
  return {
    data: null,
    error,
    lastUpdated: null,
    lastGoodData:    prev.lastGoodData,
    lastGoodUpdated: prev.lastGoodUpdated,
  };
}

export async function fetchCAIC(prev: CAICZoneData): Promise<CAICZoneData> {
  let json: CAICApiResponse;

  try {
    const res = await fetch("/api/caic");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json() as CAICApiResponse;
  } catch (err) {
    // Network failure — both results error; previous lastGoodData is preserved.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      summary:       errorResult(`Could not reach CAIC: ${msg}`, prev.summary),
      pointForecast: errorResult(`Could not reach CAIC: ${msg}`, prev.pointForecast),
    };
  }

  // Resolve summary
  const summary: SourceResult<CAICWeatherSummary> = json.summaryError
    ? errorResult(json.summaryError, prev.summary)
    : successResult<CAICWeatherSummary>({
        issuedBy: json.issuedBy ?? "",
        bodyHtml: json.bodyHtml ?? "",
      });

  // Resolve point-forecast
  const pointForecast: SourceResult<CAICPointForecastRow[]> = json.pointForecastError
    ? errorResult(json.pointForecastError, prev.pointForecast)
    : successResult((json.pointForecast ?? []).map(parseRow));

  return { summary, pointForecast };
}
