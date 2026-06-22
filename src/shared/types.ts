// ---------------------------------------------------------------------------
// Domain types for the weather dashboard.
// All other modules import from here — keeping types in one file prevents
// circular imports between nws.ts (data layer) and render.ts (view layer).
// ---------------------------------------------------------------------------

// A geographic location the app renders weather for. The personal page (V1)
// uses two fixed locations (see src/locations.ts); the shared page (V2) builds
// this list from user-chosen places. The shared engine is parameterized over
// these, so the type lives here rather than in the V1-specific config.
export interface Location {
  id: string;    // used as a key in state.weather and as a data attribute in the DOM
  label: string; // displayed in the tab bar
  lat: number;
  lon: number;
}

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
  elevationM?: number;             // metres above sea level — present in most gridpoint responses
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
  url: string;        // link to the human-readable alert page on weather.gov
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

// ---------------------------------------------------------------------------
// Air quality types (PurpleAir + AirNow)
// ---------------------------------------------------------------------------

// Processed air quality data for one location, returned by /api/air-quality.
// All corrections (EPA PM2.5, temperature offset) are applied server-side.
export interface LocationAirQuality {
  // EPA-corrected PM2.5, averaged across all valid nearby PurpleAir sensors.
  // null when no sensors are within range or all failed quality checks.
  pm25: number | null;

  // Five trend data points, oldest → newest:
  // [24-hr avg, 6-hr avg, 60-min avg, 30-min avg, 10-min avg]
  // Each is EPA-corrected using the current RH from the sensor set.
  trend: (number | null)[];

  // Corrected PA temperature (raw − 8°F). Populated for home location only;
  // null for office (spec: hyperlocal temp for home only).
  tempF: number | null;

  // AirNow PM2.5 reading from the nearest official EPA monitor (within 25 mi).
  airnowPm25: number | null;

  // True when |PA − AirNow| > 5 µg/m³ AND > 10% of the larger value.
  // Drives the red flag in the UI.
  divergent: boolean;

  // Number of PurpleAir sensors that passed quality checks and contributed
  // to the pm25 average. 0 means no usable sensors were found.
  sensorCount: number;

  // Per-source error strings; non-null when that source failed entirely.
  purpleAirError: string | null;
  airnowError: string | null;

  fetchedAt: string; // ISO 8601 timestamp of when this data was fetched
}

// All weather data for one location, one result per source.
export interface LocationWeather {
  forecast:   SourceResult<NWSPeriod[]>;
  hourly:     SourceResult<NWSPeriod[]>;
  gridpoint:  SourceResult<NWSGridpoint>;
  alerts:     SourceResult<NWSAlert[]>;
  sunTimes:   SunTimes | null;        // calculated locally, always available
  airQuality: SourceResult<LocationAirQuality>;
  openMeteo:  SourceResult<OpenMeteoForecast[]>; // extra global models (ECMWF, GFS) for the chart
}

// The two possible forecast views.
export type ViewMode = "hourly" | "7day";

// Which variable the comparison chart plots (one at a time — see Track C).
// temp/wind draw NWS + CAIC + ECMWF; precip/snow draw amounts from CAIC + ECMWF
// only (NWS's hourly feed gives precip *probability*, not an amount).
export type ChartVar = "temp" | "wind" | "precip" | "snow";

// ---------------------------------------------------------------------------
// CAIC types — Colorado Avalanche Information Center
//
// Silverthorne and Frisco share the same CAIC forecast zone (Vail & Summit
// County), so CAIC data is zone-wide and lives on AppState.caic rather than
// inside LocationWeather, avoiding a duplicate fetch per location.
// ---------------------------------------------------------------------------

// Processed Weather Summary from CAIC's write-up endpoint.
export interface CAICWeatherSummary {
  // Human-readable "Issued by / Day, Date, Time" line extracted from the body.
  // Shown prominently so users can assess freshness at a glance.
  issuedBy: string;

  // Full HTML body of the write-up, sanitised (script/on* stripped) server-side.
  bodyHtml: string;
}

// One row from the CAIC Highcharts point-forecast JSON feed.
// Loosely typed because the undocumented feed schema can change without notice.
export interface CAICPointForecastRow {
  dateTime: string;
  tmpF: number | null;
  precipIn: number | null;
  snowIn: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
  windDir: string | null;
}

// Container for all CAIC data: two independently-isolated source results.
export interface CAICZoneData {
  summary:       SourceResult<CAICWeatherSummary>;
  pointForecast: SourceResult<CAICPointForecastRow[]>;
}

// ---------------------------------------------------------------------------
// Open-Meteo types — free, keyless multi-model forecast API.
//
// Used to add extra global-model lines (starting with ECMWF, the European
// model) to the comparison chart. Open-Meteo is CORS-friendly and called
// directly from the browser, like NWS. Field names mirror CAICPointForecastRow
// (`dateTime`, `tempF`, …) so the chart can align all series the same way.
//
// Wind/precip/snow are fetched now but only temperature is drawn until the
// variable toggle (Track C) lands. Attribution ("Weather data by Open-Meteo")
// is added in the chart UI.
// ---------------------------------------------------------------------------

// One hourly row from an Open-Meteo model.
export interface OpenMeteoRow {
  dateTime: string;        // ISO 8601 (UTC) — absolute time for chart alignment
  tempF: number | null;
  windMph: number | null;
  precipIn: number | null;
  snowIn: number | null;
}

// A single model's forecast for one location.
export interface OpenMeteoForecast {
  model: string;               // Open-Meteo model id, e.g. "ecmwf_ifs025"
  elevationFt: number | null;  // model grid-cell elevation (for the chart label)
  rows: OpenMeteoRow[];
}

// ---------------------------------------------------------------------------
// Chris Tomer types — YouTube description pull
//
// We display only the description text from his latest "Mountain Weather
// Update" video. No embed, no link, no AI summary — just the text he posts.
// ---------------------------------------------------------------------------

export interface TomerVideo {
  title:       string; // full video title, shown in muted text above the description
  description: string; // the posted description text — this is the main content
  publishedAt: string; // ISO 8601 — shown in the card footer for freshness
}

// ---------------------------------------------------------------------------
// Consensus brief — AI-generated summary of NWS + CAIC forecasts.
// Generated on a schedule server-side; cached in Vercel KV.
// ---------------------------------------------------------------------------
export interface ConsensusBrief {
  text: string;        // 3–5 sentence plain-prose summary from Claude Haiku
  generatedAt: string; // ISO 8601 timestamp from when the AI ran
}

// Top-level application state, held in store.ts.
export interface AppState {
  activeLocation: 0 | 1;
  activeView: ViewMode;
  activeChartVar: ChartVar;                  // which variable the chart plots
  weather: Record<string, LocationWeather>; // keyed by Location.id
  caic: CAICZoneData;                        // zone-wide, shared across locations
  tomer: SourceResult<TomerVideo>;           // zone-wide, not per-location
  brief: SourceResult<ConsensusBrief>;       // zone-wide AI summary
}
