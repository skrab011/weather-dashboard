// ---------------------------------------------------------------------------
// Domain types for the weather dashboard.
// All other modules import from here — keeping types in one file prevents
// circular imports between nws.ts (data layer) and render.ts (view layer).
// ---------------------------------------------------------------------------

// Grid metadata returned by the NWS /points endpoint.
// Required before any other NWS call — forecast URLs come from here.
export interface NWSPointsMeta {
  gridId: string;            // NWS office ID, e.g. "BOU" (Boulder)
  gridX: number;
  gridY: number;
  forecastUrl: string;       // 7-day periods endpoint
  forecastHourlyUrl: string; // hourly periods endpoint
  gridpointUrl: string;      // raw gridpoint data (snowfall, UV, etc.)
}

// One period from /forecast (7-day) or /forecast/hourly.
export interface NWSPeriod {
  number: number;
  name: string;              // e.g. "Tonight", "Monday"
  startTime: string;         // ISO 8601
  endTime: string;
  isDaytime: boolean;
  temperature: number;       // always °F (we assert this on fetch)
  temperatureUnit: string;
  windSpeed: string;         // NWS returns a string: "10 mph" or "10 to 15 mph"
  windDirection: string;     // Cardinal string: "N", "NNW", etc.
  shortForecast: string;     // e.g. "Partly Cloudy"
  detailedForecast: string;
  icon: string;              // URL to NWS weather icon PNG
  probabilityOfPrecipitation: { value: number | null };
}

// One entry in a NWS time-series value array.
// validTime uses ISO 8601 with duration suffix: "2025-01-15T06:00:00+00:00/PT1H"
// The suffix encodes how long that value applies (e.g. /PT1H = one hour).
export interface NWSTimeSeriesValue {
  validTime: string;
  value: number | null;
}

// Raw gridpoint data from /gridpoints/{office}/{x},{y}.
// Contains time-series forecasts for fields not in the simple forecast endpoint.
export interface NWSGridpoint {
  snowfallAmount: {
    uom: string;                   // unit: typically "wmoUnit:m" (metres — we convert to inches)
    values: NWSTimeSeriesValue[];
  };
  uVIndex: {
    uom: string;                   // dimensionless
    values: NWSTimeSeriesValue[];
  };
}

// A single active weather alert.
export interface NWSAlert {
  id: string;
  event: string;      // e.g. "Winter Storm Warning", "Red Flag Warning"
  headline: string;
  severity: string;   // "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown"
  effective: string;  // ISO 8601
  expires: string | undefined;
  description: string;
}

// Sunrise and sunset for a location on a given day.
export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

// ---------------------------------------------------------------------------
// Failure-isolation envelope.
//
// Every data source is wrapped in SourceResult<T>. Cards render independently
// based on their own result — one source erroring never affects the others.
//
// State machine:
//   Loading  → data: null, error: null, lastUpdated: null
//   Success  → data: T,    error: null, lastUpdated: Date
//   Error    → data: null, error: string, lastUpdated: null
//              (lastGoodData preserves the previous successful fetch so cards
//               can show stale data rather than going blank on error)
// ---------------------------------------------------------------------------
export interface SourceResult<T> {
  data: T | null;
  error: string | null;
  lastUpdated: Date | null;
  lastGoodData: T | null;      // last successful value — survives error cycles
  lastGoodUpdated: Date | null;
}

// All weather data for one location, one result per source.
export interface LocationWeather {
  forecast: SourceResult<NWSPeriod[]>;
  hourly: SourceResult<NWSPeriod[]>;
  gridpoint: SourceResult<NWSGridpoint>;
  alerts: SourceResult<NWSAlert[]>;
  sunTimes: SunTimes | null; // calculated locally, always available
}

// The two possible forecast views.
export type ViewMode = "hourly" | "7day";

// Top-level application state, held in store.ts.
export interface AppState {
  activeLocation: 0 | 1;
  activeView: ViewMode;
  weather: Record<string, LocationWeather>; // keyed by Location.id
}
