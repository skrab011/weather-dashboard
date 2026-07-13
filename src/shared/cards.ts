// ---------------------------------------------------------------------------
// Pure card renderers — the shared view engine.
//
// Every function here takes the data it needs as arguments and writes HTML into
// a DOM region by id. None of them reach into app state or the location list, so
// both the personal page (V1) and the shared page (V2) can drive them from their
// own state. The page-specific glue — which location is active, how many tabs to
// show, where the data comes from — lives in each page's render wrapper, not here.
//
// Decoupled V1 hardcodes:
//   • PurpleAir temperature is gated by a `showPaTemp` boolean argument rather
//     than a hardcoded `locId === "home"` check.
//   • The fixed two-tab assumption stays in each page's shell (renderShell),
//     never in these renderers.
// ---------------------------------------------------------------------------

import type {
  CAICPointForecastRow,
  CAICWeatherSummary,
  ChartVar,
  ConsensusBrief,
  HourlyVar,
  LocationAirQuality,
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  OpenMeteoForecast,
  SourceResult,
  SunTimes,
  TomerVideo,
} from "./types";
import { currentSeriesValue, seriesValueAt, sumSeriesNextHours } from "./nws";
import { renderOverlayChart } from "./chart";
import { weatherIcon } from "./weatherIcons";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Wind cardinal direction → degrees for the CSS rotation arrow (↑ = North)
export const WIND_DIR_DEG: Record<string, number> = {
  N: 0,   NNE: 22.5, NE: 45,  ENE: 67.5,
  E: 90,  ESE: 112.5,SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5,SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5,NW: 315, NNW: 337.5,
};

// Map an alert event string to one of three severity buckets for CSS styling.
export function alertSeverity(event: string): "danger" | "warn" | "info" {
  const e = event.toLowerCase();
  if (e.includes("warning") || e.includes("red flag") || e.includes("blizzard")) return "danger";
  if (e.includes("watch") || e.includes("advisory")) return "warn";
  return "info";
}

// Format a Date as "h:mm AM/PM" in the user's local timezone.
export function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Format an ISO 8601 date string as "Mon 6/16".
export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

// Normalise NWS wind speed string for display.
export function fmtWind(raw: string): string {
  return raw.replace(" to ", "–");
}

// Build a card footer showing "Last updated HH:MM" (and a stale-data note on error).
export function cardFooter(lastUpdated: Date | null, error: string | null): string {
  const parts: string[] = [];
  if (error) parts.push(`<span class="footer-error">⚠ ${error}</span>`);
  if (lastUpdated) parts.push(`Last updated ${fmtTime(lastUpdated)}`);
  if (!parts.length) return "";
  return `<footer class="card-footer">${parts.join(" · ")}</footer>`;
}

// Skeleton placeholder shown while a card is loading.
export function skeletonCard(extraClass = ""): string {
  return `<section class="card card--loading ${extraClass}">
    <div class="skeleton skeleton--title"></div>
    <div class="skeleton skeleton--line"></div>
    <div class="skeleton skeleton--line skeleton--short"></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Alert banner
// ---------------------------------------------------------------------------
export function renderAlerts(result: SourceResult<NWSAlert[]>): void {
  const el = document.getElementById("alerts-region")!;

  if (!result.data || result.data.length === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = result.data.map((alert) => `
    <a
      class="alert-banner alert-banner--${alertSeverity(alert.event)}"
      href="${alert.url}"
      target="_blank"
      rel="noopener noreferrer"
      role="alert"
      aria-label="${alert.event} — tap to read full alert"
    >
      <strong class="alert-event">${alert.event} ↗</strong>
      <span class="alert-headline">${alert.headline}</span>
    </a>
  `).join("");
}

// ---------------------------------------------------------------------------
// Current conditions card — temperature (NWS + optional PA), wind, sky,
// UV, snowfall, sun times.
//
// `showPaTemp` controls whether the PurpleAir corrected temperature is shown
// beside the NWS reading. V1 sets it true for home only; the shared page sets
// it per its own rules. The PA value is additive — it never replaces NWS.
// ---------------------------------------------------------------------------
export function renderConditions(
  hourlyResult: SourceResult<NWSPeriod[]>,
  gridResult: SourceResult<NWSGridpoint>,
  sunTimes: SunTimes | null,
  aqResult: SourceResult<LocationAirQuality>,
  showPaTemp: boolean,
): void {
  const el = document.getElementById("conditions-region")!;

  if (!hourlyResult.data && !hourlyResult.error && !gridResult.data && !gridResult.error) {
    el.innerHTML = skeletonCard();
    return;
  }

  const now   = (hourlyResult.data ?? hourlyResult.lastGoodData)?.[0];
  const grid  = gridResult.data ?? gridResult.lastGoodData;
  const aq    = aqResult.data ?? aqResult.lastGoodData;

  const snowNext24 = grid
    ? sumSeriesNextHours(grid.snowfallAmount.values, 24, grid.snowfallAmount.uom)
    : null;
  const uvNow = grid ? currentSeriesValue(grid.uVIndex.values) : null;

  const rows: string[] = [];
  let hero = "";

  if (now) {
    const windDeg = WIND_DIR_DEG[now.windDirection] ?? 0;

    // Show PurpleAir corrected temp beneath the condition when requested by the
    // caller. The PA value is additive — it never replaces the NWS reading.
    const paTemp =
      showPaTemp && aq?.tempF !== null && aq?.tempF !== undefined
        ? `<span class="temp-pa">PurpleAir ${Math.round(aq.tempF)}°F</span>`
        : "";

    // Hero block replaces the old Temp + Sky rows: big NWS temp, condition
    // text (+ optional PA annotation), condition icon on the right.
    hero = `
      <div class="cond-hero">
        <span class="cond-hero__temp">${now.temperature}°</span>
        <span class="cond-hero__meta">
          <span class="cond-hero__cond">${now.shortForecast}</span>
          ${paTemp}
        </span>
        <span class="cond-hero__icon">${weatherIcon(now)}</span>
      </div>
    `;

    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Wind</span>
        <span class="cond-value">
          <span class="wind-arrow" style="transform:rotate(${windDeg}deg)" aria-hidden="true">↑</span>
          ${now.windDirection} ${fmtWind(now.windSpeed)}
        </span>
      </div>
    `);
  }

  // Humidity — prefer the PurpleAir sensor average when sensors are nearby
  // (the API returns humidityPct: null when none are), fall back to the NWS
  // hourly value. ?? also covers cached air-quality objects that predate
  // the humidityPct field (undefined).
  const humidity = aq?.humidityPct ?? now?.relativeHumidity?.value ?? null;
  if (humidity !== null) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Humidity</span>
        <span class="cond-value">${Math.round(humidity)}%</span>
      </div>
    `);
  }

  if (uvNow !== null) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">UV Index</span>
        <span class="cond-value">${Math.round(uvNow)}</span>
      </div>
    `);
  }

  if (snowNext24 !== null && snowNext24 >= 0.1) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Snow (24 hr)</span>
        <span class="cond-value">${snowNext24.toFixed(1)} in</span>
      </div>
    `);
  }

  if (sunTimes) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Sunrise</span>
        <span class="cond-value">${fmtTime(sunTimes.sunrise)}</span>
      </div>
      <div class="cond-row">
        <span class="cond-label">Sunset</span>
        <span class="cond-value">${fmtTime(sunTimes.sunset)}</span>
      </div>
    `);
  }

  const hasError = !!(hourlyResult.error && gridResult.error);
  const ts = hourlyResult.lastUpdated ?? gridResult.lastUpdated ?? hourlyResult.lastGoodUpdated ?? gridResult.lastGoodUpdated;

  el.innerHTML = `
    <section class="card${hasError ? " card--error" : ""}">
      <h2 class="card-title">Now</h2>
      ${hero}
      ${rows.length || hero ? rows.join("") : `<p class="card-empty">${hasError ? "Could not load current conditions." : "Loading conditions…"}</p>`}
      ${cardFooter(ts ?? null, hasError ? "Could not load current conditions" : null)}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Air quality card — PM2.5 (EPA-corrected PurpleAir), AirNow cross-check,
// divergence flag, 24-hour sparkline trend.
// PA temperature is shown in the conditions card, not here.
// ---------------------------------------------------------------------------
export function renderAirQuality(
  result: SourceResult<LocationAirQuality>,
): void {
  const el = document.getElementById("air-quality-region")!;

  // Loading state
  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard();
    return;
  }

  // Hard error with no fallback
  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">Air Quality</h2>
        <p class="card-empty">Could not load air quality data.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  const d = (result.data ?? result.lastGoodData)!;
  const ts = result.lastUpdated ?? result.lastGoodUpdated;
  const rows: string[] = [];

  if (d.sensorCount === 0 || d.pm25 === null) {
    // No usable PurpleAir sensors in range
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">PM2.5</span>
        <span class="cond-value cond-value--muted">No nearby sensors</span>
      </div>
    `);
  } else {
    // PM2.5 value — flagged red when PurpleAir and AirNow significantly disagree
    const flagged = d.divergent;
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">PM2.5</span>
        <span class="cond-value${flagged ? " pm-value--flagged" : ""}">
          ${d.pm25.toFixed(1)} µg/m³
          ${flagged ? '<span class="pm-flag" title="PurpleAir and AirNow readings diverge significantly">⚠ Sources differ</span>' : ""}
        </span>
      </div>
      <div class="cond-row cond-row--sparkline">
        <span class="cond-label">24-hr trend</span>
        ${renderSparkline(d.trend, flagged)}
      </div>
    `);
  }

  // AirNow cross-check row
  if (d.airnowPm25 !== null) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">AirNow (EPA)</span>
        <span class="cond-value">${d.airnowPm25.toFixed(1)} µg/m³</span>
      </div>
    `);
  } else if (d.airnowError) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">AirNow</span>
        <span class="cond-value cond-value--muted">Unavailable</span>
      </div>
    `);
  }

  // Sensor count — useful context, especially when flagged
  if (d.sensorCount > 0) {
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Sensors</span>
        <span class="cond-value cond-value--muted">${d.sensorCount} nearby</span>
      </div>
    `);
  }

  el.innerHTML = `
    <section class="card${result.error ? " card--error" : ""}">
      <h2 class="card-title">Air Quality</h2>
      ${rows.join("")}
      ${cardFooter(ts, result.error)}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Sparkline — 5 bars, oldest (24hr) to newest (10min), left to right.
// Heights are proportional to PM2.5 value, bottom-aligned via CSS flex.
// Rendered as pure HTML/CSS with no chart library.
// ---------------------------------------------------------------------------
export function renderSparkline(trend: (number | null)[], flagged: boolean): string {
  // Scale bars relative to the maximum non-null value in the trend
  const nonNull = trend.filter((v): v is number => v !== null);
  const max = nonNull.length > 0 ? Math.max(...nonNull) : 1;
  const MAX_PX = 32; // tallest bar height in pixels
  const MIN_PX = 4;  // minimum height so even zero reads are visible

  const bars = trend.map((v) => {
    const height = v !== null
      ? Math.max(MIN_PX, Math.round((v / Math.max(max, 1)) * MAX_PX))
      : MIN_PX;
    const opacity = v !== null ? "1" : "0.25";
    return `<div class="sparkline-bar" style="height:${height}px;opacity:${opacity}"></div>`;
  });

  return `
    <div class="sparkline${flagged ? " sparkline--flagged" : ""}"
         aria-label="PM2.5 trend oldest to newest, 24h 6h 1h 30min 10min">
      ${bars.join("")}
    </div>`;
}

// ---------------------------------------------------------------------------
// Hourly forecast strip — next 24 hours, horizontally scrollable.
//
// A Temp/Wind toggle (same pill styling as the chart's variable toggle) swaps
// what each hour block shows:
//   temp — inline SVG condition icon + temperature + precip chance
//   wind — direction arrow + sustained speed, with the gust ("G ##") below
//          (no condition icon — wind mode is numbers-only by design).
// Speed/direction come from the hourly periods; gusts come from the raw
// gridpoint time-series (km/h → mph), which the caller passes in. A gridpoint
// failure only blanks the gust line — the rest of the card is unaffected.
// ---------------------------------------------------------------------------
export function renderHourly(
  result: SourceResult<NWSPeriod[]>,
  gridResult: SourceResult<NWSGridpoint>,
  activeVar: HourlyVar,
  onSelectVar: (variable: HourlyVar) => void,
): void {
  const el = document.getElementById("hourly-region")!;

  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard("view-hourly");
    return;
  }

  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error view-hourly">
        <h2 class="card-title">Hourly</h2>
        <p class="card-empty">Could not load hourly forecast.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  const periods = (result.data ?? result.lastGoodData)!;
  const cutoff  = Date.now() + 24 * 3_600_000;
  const next24  = periods.filter((p) => new Date(p.startTime).getTime() < cutoff);

  const gust = (gridResult.data ?? gridResult.lastGoodData)?.windGust;
  const gustMphAt = (iso: string): number | null => {
    if (!gust) return null;
    const v = seriesValueAt(gust.values, new Date(iso).getTime());
    if (v === null) return null;
    return Math.round(gust.uom.includes("km_h") ? v * 0.621371 : v);
  };

  const hourValues = (p: NWSPeriod): string => {
    if (activeVar === "wind") {
      const deg = WIND_DIR_DEG[p.windDirection];
      const arrow = deg !== undefined
        ? `<span class="wind-arrow" style="transform:rotate(${deg}deg)" aria-hidden="true">↑</span>`
        : "";
      const g = gustMphAt(p.startTime);
      return `
        <span class="hour-wind" aria-label="Wind ${p.windDirection} ${p.windSpeed}">${arrow}${windMph(p.windSpeed)}</span>
        <span class="hour-gust" aria-label="Gusts ${g !== null ? `${g} mph` : "unknown"}">${g !== null ? `G ${g}` : "—"}</span>`;
    }
    return `
      ${weatherIcon(p)}
      <span class="hour-temp">${p.temperature}°</span>
      <span class="hour-precip">${p.probabilityOfPrecipitation?.value ?? 0}%</span>`;
  };

  const varBtn = (v: HourlyVar, label: string) =>
    `<button class="chart-var-btn${activeVar === v ? " chart-var-btn--active" : ""}" data-hourly-var="${v}">${label}</button>`;

  el.innerHTML = `
    <section class="card view-hourly${result.error ? " card--error" : ""}">
      <h2 class="card-title">Hourly</h2>
      <div class="chart-var-toggle" role="group" aria-label="Hourly variable">
        ${varBtn("temp", "Temp")}
        ${varBtn("wind", "Wind")}
      </div>
      <div class="hourly-strip" role="list">
        ${next24.map((p) => `
          <div class="hour-block" role="listitem">
            <span class="hour-time">${fmtTime(new Date(p.startTime))}</span>
            ${hourValues(p)}
          </div>
        `).join("")}
      </div>
      ${cardFooter(result.lastUpdated ?? result.lastGoodUpdated, result.error)}
    </section>
  `;

  el.querySelectorAll<HTMLButtonElement>(".chart-var-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.hourlyVar as HourlyVar | undefined;
      if (v && v !== activeVar) onSelectVar(v);
    });
  });
}

// ---------------------------------------------------------------------------
// 7-day forecast — combined day/night rows, no icons, with wind column.
// ---------------------------------------------------------------------------

interface ForecastPair {
  day: NWSPeriod | null;
  night: NWSPeriod | null;
}

function pairPeriods(periods: NWSPeriod[]): ForecastPair[] {
  const pairs: ForecastPair[] = [];
  let i = 0;

  if (periods.length > 0 && !periods[0].isDaytime) {
    pairs.push({ day: null, night: periods[0] });
    i = 1;
  }

  while (i < periods.length) {
    const day   = periods[i].isDaytime ? periods[i] : null;
    const night = periods[i + 1] && !periods[i + 1].isDaytime ? periods[i + 1] : null;
    pairs.push({ day, night });
    i += (day ? 1 : 0) + (night ? 1 : 0) || 1;
  }

  return pairs;
}

function windMph(raw: string): string {
  const stripped = raw.replace(/ mph/gi, "").trim();
  return /^\d+$/.test(stripped) ? stripped : stripped.replace(/\s+to\s+/i, "–");
}

// Expanded-row state for the 7-day card. Module-local so the renderer stays
// argument-pure for callers; reset whenever a different SourceResult arrives
// (location/tab switch) so rows collapse by default on new data.
let fcExpanded = new Set<number>();
let fcLastResult: SourceResult<NWSPeriod[]> | null = null;

export function renderForecast(result: SourceResult<NWSPeriod[]>): void {
  const el = document.getElementById("forecast-region")!;

  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard("view-7day");
    return;
  }

  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error view-7day">
        <h2 class="card-title">7-Day</h2>
        <p class="card-empty">Could not load forecast.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  if (result !== fcLastResult) {
    fcExpanded = new Set();
    fcLastResult = result;
  }

  const periods = (result.data ?? result.lastGoodData)!;
  const pairs   = pairPeriods(periods);

  // Week-wide min/max across all day highs and night lows — the temp-range
  // bars are positioned against this shared scale so rows compare visually.
  const allTemps = pairs.flatMap(({ day, night }) =>
    [day?.temperature, night?.temperature].filter((t): t is number => t != null));
  const weekMin = Math.min(...allTemps);
  const weekMax = Math.max(...allTemps);
  const weekSpan = weekMax - weekMin;

  const windValue = (p: NWSPeriod): string => {
    const deg = WIND_DIR_DEG[p.windDirection] ?? 0;
    return `<span class="wind-arrow" style="transform:rotate(${deg}deg)" aria-hidden="true">↑</span> ${p.windDirection} ${windMph(p.windSpeed)} mph`;
  };

  const rows = pairs.map(({ day, night }, i) => {
    const expanded  = fcExpanded.has(i);
    const dateLabel = day ? fmtDay(day.startTime) : "Tonight";
    // Day period leads; the "Tonight"-only first row falls back to night values.
    const lead    = day ?? night;
    const outlook = lead ? lead.shortForecast : "—";
    const precip  = lead ? `${lead.probabilityOfPrecipitation?.value ?? 0}%` : "—";
    const lo = night ? `${night.temperature}°` : "—";
    const hi = day   ? `${day.temperature}°`   : "—";

    // Range bar only when both temps exist and the week has a usable span.
    let bar = "";
    if (day && night && weekSpan > 0) {
      const left  = ((night.temperature - weekMin) / weekSpan) * 100;
      const width = ((day.temperature - night.temperature) / weekSpan) * 100;
      bar = `<span class="fc-range__fill" style="left:${left.toFixed(1)}%;width:${Math.max(width, 0).toFixed(1)}%"></span>`;
    }

    const detailItem = (label: string, value: string) => `
      <span class="fc-detail__item">
        <span class="fc-detail__label">${label}</span>
        <span class="fc-detail__value">${value}</span>
      </span>`;

    const detail = !expanded ? "" : `
      <div class="fc-detail">
        ${night ? detailItem("Night", `${night.shortForecast} · ${night.probabilityOfPrecipitation?.value ?? 0}%`) : ""}
        ${day   ? detailItem("Wind day", windValue(day))     : ""}
        ${night ? detailItem("Wind night", windValue(night)) : ""}
      </div>`;

    return `
      <button class="fc-row${expanded ? " fc-row--open" : ""}" data-fc-idx="${i}"
              aria-expanded="${expanded}" aria-label="${dateLabel}: ${outlook}, tap for details">
        <span class="fc-day">${dateLabel}</span>
        <span class="fc-outlook-wrap">
          <span class="fc-outlook">${outlook}</span>
          <span class="fc-precip">${precip}</span>
        </span>
        <span class="fc-lo">${lo}</span>
        <span class="fc-range">${bar}</span>
        <span class="fc-hi">${hi}</span>
        <span class="fc-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
      </button>
      ${detail}`;
  });

  el.innerHTML = `
    <section class="card view-7day${result.error ? " card--error" : ""}">
      <h2 class="card-title">7-Day</h2>
      <div class="forecast-list">
        ${rows.join("")}
      </div>
      ${cardFooter(result.lastUpdated ?? result.lastGoodUpdated, result.error)}
    </section>
  `;

  el.querySelectorAll<HTMLButtonElement>(".fc-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.fcIdx);
      if (fcExpanded.has(idx)) fcExpanded.delete(idx);
      else fcExpanded.add(idx);
      renderForecast(result);
    });
  });
}

// ---------------------------------------------------------------------------
// CAIC Weather Summary card.
//
// Always visible regardless of active location tab — CAIC is zone-wide and
// applies equally to both Silverthorne and Frisco.
//
// The issued-by line is shown prominently at the top so freshness is
// immediately visible. The full write-up is rendered as innerHTML from
// sanitised server-side HTML.
// ---------------------------------------------------------------------------
export function renderCAIC(result: SourceResult<CAICWeatherSummary>): void {
  const el = document.getElementById("caic-region")!;

  // Loading state
  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard();
    return;
  }

  // Hard error with no fallback data
  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">CAIC Weather Summary</h2>
        <p class="card-empty">Could not load CAIC write-up.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  const d = (result.data ?? result.lastGoodData)!;
  const ts = result.lastUpdated ?? result.lastGoodUpdated;

  // Showing stale data — apply the stale border so the user knows
  const isStale = !!result.error && !!result.lastGoodData;

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">CAIC Weather Summary</h2>
      ${d.issuedBy
        ? `<p class="caic-issued">${d.issuedBy}</p>`
        : ""}
      <div class="caic-body">${d.bodyHtml}</div>
      ${cardFooter(ts, result.error)}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Forecast comparison chart — standalone card.
//
// Takes the active location's hourly NWS result, the zone-wide CAIC
// point-forecast result, the NWS forecast-point elevation, the active
// location's Open-Meteo (ECMWF) result, the selected chart variable, and a
// callback for the Temp/Wind toggle. Each series draws independently — any
// source that's missing simply isn't plotted.
// ---------------------------------------------------------------------------
export function renderChart(
  hourlyResult: SourceResult<NWSPeriod[]>,
  pointForecastResult: SourceResult<CAICPointForecastRow[]>,
  nwsElevFt: number | null,
  openMeteoResult: SourceResult<OpenMeteoForecast[]>,
  activeVar: ChartVar,
  onSelectVar: (variable: ChartVar) => void,
): void {
  const el = document.getElementById("chart-region")!;
  const nwsHourly = hourlyResult.data ?? hourlyResult.lastGoodData;
  const caicFcst  = pointForecastResult.data ?? pointForecastResult.lastGoodData;
  const omFcst    = openMeteoResult.data ?? openMeteoResult.lastGoodData;

  // Loading state — NWS hourly not yet resolved
  if (!nwsHourly && !hourlyResult.error) {
    el.innerHTML = skeletonCard();
    return;
  }

  // Hard error with no fallback
  if (!nwsHourly && hourlyResult.error) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">Temperature Forecast</h2>
        <p class="card-empty">Could not load forecast data.</p>
        ${cardFooter(null, hourlyResult.error)}
      </section>`;
    return;
  }

  const ts = hourlyResult.lastUpdated ?? hourlyResult.lastGoodUpdated;
  const isStale = !!hourlyResult.error && !!hourlyResult.lastGoodData;
  const title =
    activeVar === "wind"   ? "Wind Forecast" :
    activeVar === "precip" ? "Precipitation Forecast" :
    activeVar === "snow"   ? "Snowfall Forecast" :
    "Temperature Forecast";

  const varBtn = (v: ChartVar, label: string) =>
    `<button class="chart-var-btn${activeVar === v ? " chart-var-btn--active" : ""}" data-chart-var="${v}">${label}</button>`;

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">${title}</h2>
      <div class="chart-var-toggle" role="group" aria-label="Chart variable">
        ${varBtn("temp", "Temp")}
        ${varBtn("wind", "Wind")}
        ${varBtn("precip", "Precip")}
        ${varBtn("snow", "Snow")}
      </div>
      <div id="caic-chart-placeholder" class="caic-chart-placeholder"></div>
      ${cardFooter(ts, hourlyResult.error)}
    </section>
  `;

  el.querySelectorAll<HTMLButtonElement>(".chart-var-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.chartVar as ChartVar | undefined;
      if (v && v !== activeVar) onSelectVar(v);
    });
  });

  const placeholder = document.getElementById("caic-chart-placeholder")!;
  renderOverlayChart(placeholder, nwsHourly!, caicFcst, nwsElevFt, omFcst, activeVar);
}

// ---------------------------------------------------------------------------
// Consensus brief card — AI-generated 3–5 sentence plain-prose summary.
//
// Includes a manual refresh button. The actual refetch + state update is
// supplied by the caller via `onRefresh` so this renderer stays pure; the
// button is disabled while a refresh is in flight to prevent double-clicks.
// ---------------------------------------------------------------------------
// title defaults to "Consensus Brief" (V1 behavior); the shared page passes
// "Forecast Brief" for non-Colorado locations.
//
// onRadio (optional): resolves to the URL of a TTS MP3 reading of the brief.
// When absent the card renders exactly as before — only V1 passes it, so the
// V2 page is untouched. Playback goes through a single module-level
// HTMLAudioElement so it survives re-renders and only one clip plays at once.
let radioAudio: HTMLAudioElement | null = null;

export function renderBrief(
  result: SourceResult<ConsensusBrief>,
  onRefresh: () => Promise<void>,
  title = "Consensus Brief",
  onRadio?: () => Promise<string /* audioUrl */>,
): void {
  const el = document.getElementById("brief-region")!;

  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard();
    return;
  }

  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">${title}</h2>
        <p class="card-empty">Could not load brief.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  const d  = (result.data ?? result.lastGoodData)!;
  const ts = result.lastUpdated ?? result.lastGoodUpdated;
  const isStale = !!result.error && !!result.lastGoodData;

  const genTime = d.generatedAt
    ? new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">${title}</h2>
      <div class="brief-body">${d.text}</div>
      <div class="brief-footer">
        ${genTime ? `<span class="brief-generated">Generated ${genTime}</span>` : ""}
        ${onRadio ? `<button class="brief-radio-btn" aria-label="Play radio forecast">🎙 Radio</button>` : ""}
        <button class="brief-refresh-btn" aria-label="Refresh ${title.toLowerCase()}">↻ Refresh</button>
      </div>
      ${cardFooter(ts, result.error)}
    </section>
  `;

  // Wire the refresh button — disabled while in flight
  const btn = el.querySelector<HTMLButtonElement>(".brief-refresh-btn")!;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    try {
      await onRefresh();
    } finally {
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
    }
  });

  if (onRadio) {
    const radioBtn = el.querySelector<HTMLButtonElement>(".brief-radio-btn")!;
    if (!radioAudio) radioAudio = new Audio();
    const audio = radioAudio;

    const setIdle = () => { radioBtn.disabled = false; radioBtn.textContent = "🎙 Radio"; };
    const setStop = () => { radioBtn.disabled = false; radioBtn.textContent = "⏹ Stop"; };
    const setUnavailable = () => {
      radioBtn.disabled = true;
      radioBtn.textContent = "Unavailable";
      setTimeout(setIdle, 2_500);
    };

    // A re-render mid-playback recreates the button; reflect the live state.
    // onended (not addEventListener) so re-renders replace, never stack.
    if (!audio.paused) setStop();
    audio.onended = setIdle;

    radioBtn.addEventListener("click", async () => {
      // Tap while playing → stop and reset
      if (!audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        setIdle();
        return;
      }

      // "▶ Play" fallback (see below): the audio is already loaded, so this
      // play() runs synchronously inside the tap gesture and always works.
      if (radioBtn.textContent === "▶ Play") {
        try { await audio.play(); setStop(); } catch { setUnavailable(); }
        return;
      }

      radioBtn.disabled = true;
      radioBtn.textContent = "Generating…";
      try {
        audio.src = await onRadio();
        try {
          await audio.play();
          setStop();
        } catch {
          // iOS Safari only allows audio started by a user gesture, and the
          // await above can void it. The audio is loaded now, so offer a
          // second tap that plays synchronously.
          radioBtn.disabled = false;
          radioBtn.textContent = "▶ Play";
        }
      } catch {
        setUnavailable();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Chris Tomer description card.
//
// Displays the description text from his latest "Mountain Weather Update"
// video. No embed, no link — description text only, per spec.
// The video title is shown in small muted text above the description so
// the user can see which video the description belongs to.
// ---------------------------------------------------------------------------
export function renderTomer(result: SourceResult<TomerVideo>): void {
  const el = document.getElementById("tomer-region")!;

  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard();
    return;
  }

  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">Mountain Weather Update</h2>
        <p class="card-empty">Could not load video description.</p>
        ${cardFooter(null, result.error)}
      </section>`;
    return;
  }

  const d  = (result.data ?? result.lastGoodData)!;
  const ts = result.lastUpdated ?? result.lastGoodUpdated;
  const isStale = !!result.error && !!result.lastGoodData;

  // Format the publish date as a readable string for the footer
  const published = d.publishedAt
    ? new Date(d.publishedAt).toLocaleDateString([], {
        weekday: "short", month: "short", day: "numeric",
      })
    : null;

  // Preserve line breaks from the YouTube description (newlines → <br>)
  const descHtml = d.description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // Single merged footer: "Posted Sat, Jul 4 · Last updated 6:45 AM"
  // (error note first when showing stale data, same as cardFooter).
  const footerParts: string[] = [];
  if (result.error) footerParts.push(`<span class="footer-error">⚠ ${result.error}</span>`);
  if (published) footerParts.push(`Posted ${published}`);
  if (ts) footerParts.push(`Last updated ${fmtTime(ts)}`);

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">Mountain Weather Update</h2>
      <p class="tomer-video-title">${d.title}</p>
      <div class="tomer-body">${descHtml}</div>
      ${footerParts.length ? `<footer class="card-footer">${footerParts.join(" · ")}</footer>` : ""}
    </section>
  `;
}
