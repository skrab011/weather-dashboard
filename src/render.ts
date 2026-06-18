// ---------------------------------------------------------------------------
// Render layer — everything that touches the DOM lives here.
// Reads from state; never writes to state.
//
// Entry points:
//   renderShell()  — called once at boot; paints the static UI skeleton
//   renderAll()    — called by the store on every state change; updates cards
// ---------------------------------------------------------------------------

import type {
  CAICWeatherSummary,
  ConsensusBrief,
  LocationAirQuality,
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  SourceResult,
  SunTimes,
  TomerVideo,
} from "./types";
import { LOCATIONS } from "./locations";
import { state, setActiveLocation, setActiveView, updateBrief } from "./store";
import { fetchBrief } from "./brief";
import { currentSeriesValue, sumSeriesNextHours } from "./nws";
import { renderOverlayChart } from "./chart";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Wind cardinal direction → degrees for the CSS rotation arrow (↑ = North)
const WIND_DIR_DEG: Record<string, number> = {
  N: 0,   NNE: 22.5, NE: 45,  ENE: 67.5,
  E: 90,  ESE: 112.5,SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5,SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5,NW: 315, NNW: 337.5,
};

// Map an alert event string to one of three severity buckets for CSS styling.
function alertSeverity(event: string): "danger" | "warn" | "info" {
  const e = event.toLowerCase();
  if (e.includes("warning") || e.includes("red flag") || e.includes("blizzard")) return "danger";
  if (e.includes("watch") || e.includes("advisory")) return "warn";
  return "info";
}

// Format a Date as "h:mm AM/PM" in the user's local timezone.
function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Format an ISO 8601 date string as "Mon 6/16".
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

// Normalise NWS wind speed string for display.
function fmtWind(raw: string): string {
  return raw.replace(" to ", "–");
}

// Build a card footer showing "Last updated HH:MM" (and a stale-data note on error).
function cardFooter(lastUpdated: Date | null, error: string | null): string {
  const parts: string[] = [];
  if (error) parts.push(`<span class="footer-error">⚠ ${error}</span>`);
  if (lastUpdated) parts.push(`Last updated ${fmtTime(lastUpdated)}`);
  if (!parts.length) return "";
  return `<footer class="card-footer">${parts.join(" · ")}</footer>`;
}

// Skeleton placeholder shown while a card is loading.
function skeletonCard(extraClass = ""): string {
  return `<section class="card card--loading ${extraClass}">
    <div class="skeleton skeleton--title"></div>
    <div class="skeleton skeleton--line"></div>
    <div class="skeleton skeleton--line skeleton--short"></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// renderShell — called once. Writes the static HTML skeleton into #app and
// attaches event listeners for the location tabs and hourly/7-day toggle.
// ---------------------------------------------------------------------------
export function renderShell(): void {
  const app = document.querySelector<HTMLDivElement>("#app")!;

  app.innerHTML = `
    <header class="app-header">
      <span class="app-title">Weather</span>
      <nav class="tab-bar" role="tablist" aria-label="Location">
        ${LOCATIONS.map((loc, i) => `
          <button
            class="tab${i === 0 ? " tab--active" : ""}"
            role="tab"
            aria-selected="${i === 0}"
            data-loc-index="${i}"
          >${loc.label}</button>
        `).join("")}
      </nav>
    </header>

    <div class="view-toggle" role="group" aria-label="Forecast view">
      <button class="toggle-btn toggle-btn--active" data-view="hourly">Hourly</button>
      <button class="toggle-btn" data-view="7day">7-Day</button>
    </div>

    <main class="content" data-view="hourly">
      <div id="alerts-region"></div>

      <div class="desktop-top-row">
        <div id="top-left-col">
          <div id="conditions-region">${skeletonCard()}</div>
          <div id="air-quality-region">${skeletonCard()}</div>
        </div>
        <div id="chart-region">${skeletonCard()}</div>
        <div id="brief-region">${skeletonCard()}</div>
      </div>

      <div class="desktop-bottom-row">
        <div id="forecast-col">
          <div id="hourly-region" class="view-hourly">${skeletonCard()}</div>
          <div id="forecast-region" class="view-7day">${skeletonCard()}</div>
        </div>
        <div id="caic-region">${skeletonCard()}</div>
        <div id="tomer-region">${skeletonCard()}</div>
      </div>
    </main>
  `;

  // Location tab clicks → update active location in state
  app.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.locIndex ?? "0", 10) as 0 | 1;
      setActiveLocation(idx);
    });
  });

  // Toggle clicks → switch between hourly and 7-day view
  app.querySelectorAll<HTMLButtonElement>(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveView(btn.dataset.view as "hourly" | "7day");
    });
  });
}

// ---------------------------------------------------------------------------
// renderAll — called by the store subscriber after every state mutation.
// ---------------------------------------------------------------------------
export function renderAll(): void {
  const loc = LOCATIONS[state.activeLocation];
  const weather = state.weather[loc.id];

  // Sync tab active styling
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn, i) => {
    const active = i === state.activeLocation;
    btn.classList.toggle("tab--active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  // Sync toggle styling and the data-view attribute that drives CSS visibility
  const main = document.querySelector<HTMLElement>(".content");
  if (main) main.setAttribute("data-view", state.activeView);

  document.querySelectorAll<HTMLButtonElement>(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("toggle-btn--active", btn.dataset.view === state.activeView);
  });

  renderAlerts(weather.alerts);
  renderConditions(weather.hourly, weather.gridpoint, weather.sunTimes, weather.airQuality, loc.id);
  renderAirQuality(weather.airQuality, loc.id);
  renderHourly(weather.hourly);
  renderForecast(weather.forecast);
  renderChart();
  renderBrief(state.brief);
  renderCAIC(state.caic.summary);
  renderTomer(state.tomer);
}

// ---------------------------------------------------------------------------
// Alert banner
// ---------------------------------------------------------------------------
function renderAlerts(result: SourceResult<NWSAlert[]>): void {
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
// ---------------------------------------------------------------------------
function renderConditions(
  hourlyResult: SourceResult<NWSPeriod[]>,
  gridResult: SourceResult<NWSGridpoint>,
  sunTimes: SunTimes | null,
  aqResult: SourceResult<LocationAirQuality>,
  locId: string,
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

  if (now) {
    const windDeg = WIND_DIR_DEG[now.windDirection] ?? 0;

    // Show PurpleAir corrected temp beside NWS temp for the home location only.
    // The PA value is additive — it never replaces the authoritative NWS reading.
    const paTemp =
      locId === "home" && aq?.tempF !== null && aq?.tempF !== undefined
        ? `<span class="temp-pa">${Math.round(aq.tempF)}°F</span>`
        : "";

    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Temp</span>
        <span class="cond-value">${now.temperature}°F ${paTemp}</span>
      </div>
      <div class="cond-row">
        <span class="cond-label">Wind</span>
        <span class="cond-value">
          <span class="wind-arrow" style="transform:rotate(${windDeg}deg)" aria-hidden="true">↑</span>
          ${now.windDirection} ${fmtWind(now.windSpeed)}
        </span>
      </div>
      <div class="cond-row">
        <span class="cond-label">Sky</span>
        <span class="cond-value">${now.shortForecast}</span>
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
      ${rows.length ? rows.join("") : `<p class="card-empty">${hasError ? "Could not load current conditions." : "Loading conditions…"}</p>`}
      ${cardFooter(ts ?? null, hasError ? "Could not load current conditions" : null)}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Air quality card — PM2.5 (EPA-corrected PurpleAir), AirNow cross-check,
// divergence flag, 24-hour sparkline trend.
// PA temperature is shown in the conditions card, not here.
// ---------------------------------------------------------------------------
function renderAirQuality(
  result: SourceResult<LocationAirQuality>,
  locId: string,
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

  // Only show PA temp label here for office (home already shows it in Now card).
  // For office we omit it entirely per spec (no PA temp for office).
  void locId; // locId reserved for future per-location customisation

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
function renderSparkline(trend: (number | null)[], flagged: boolean): string {
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
// ---------------------------------------------------------------------------
function renderHourly(result: SourceResult<NWSPeriod[]>): void {
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

  el.innerHTML = `
    <section class="card view-hourly${result.error ? " card--error" : ""}">
      <h2 class="card-title">Hourly</h2>
      <div class="hourly-strip" role="list">
        ${next24.map((p) => `
          <div class="hour-block" role="listitem">
            <span class="hour-time">${fmtTime(new Date(p.startTime))}</span>
            <img
              class="hour-icon"
              src="${p.icon}"
              alt="${p.shortForecast}"
              width="40" height="40"
              loading="lazy"
            />
            <span class="hour-temp">${p.temperature}°</span>
            <span class="hour-precip">${p.probabilityOfPrecipitation?.value ?? 0}%</span>
          </div>
        `).join("")}
      </div>
      ${cardFooter(result.lastUpdated ?? result.lastGoodUpdated, result.error)}
    </section>
  `;
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

function stackedCell(className: string, dayVal: string, nightVal: string): string {
  return `
    <span class="${className}">
      <span class="fc-day-val">${dayVal}</span>
      <span class="fc-night-val">${nightVal}</span>
    </span>`;
}

function renderForecast(result: SourceResult<NWSPeriod[]>): void {
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

  const periods = (result.data ?? result.lastGoodData)!;
  const pairs   = pairPeriods(periods);

  const rows = pairs.map(({ day, night }) => {
    const dateLabel  = day ? fmtDay(day.startTime) : "Tonight";
    const tempDay    = day   ? `${day.temperature}°`   : "—";
    const tempNight  = night ? `${night.temperature}°`  : "—";
    const descDay    = day   ? day.shortForecast   : "—";
    const descNight  = night ? night.shortForecast  : "—";
    const precipDay  = day   ? `${day.probabilityOfPrecipitation?.value   ?? 0}%` : "—";
    const precipNight = night ? `${night.probabilityOfPrecipitation?.value ?? 0}%` : "—";

    const windCell = (p: NWSPeriod | null): string => {
      if (!p) return "—";
      const deg = WIND_DIR_DEG[p.windDirection] ?? 0;
      return `<span class="wind-arrow" style="transform:rotate(${deg}deg)" aria-hidden="true">↑</span>${windMph(p.windSpeed)} mph`;
    };

    return `
      <div class="forecast-row" role="listitem">
        <span class="forecast-day">${dateLabel}</span>
        ${stackedCell("forecast-temp", tempDay, tempNight)}
        ${stackedCell("forecast-desc", descDay, descNight)}
        <span class="forecast-wind">
          <span class="fc-day-val">${windCell(day)}</span>
          <span class="fc-night-val">${windCell(night)}</span>
        </span>
        ${stackedCell("forecast-precip", precipDay, precipNight)}
      </div>`;
  });

  el.innerHTML = `
    <section class="card view-7day${result.error ? " card--error" : ""}">
      <h2 class="card-title">7-Day</h2>
      <div class="forecast-list" role="list">
        ${rows.join("")}
      </div>
      ${cardFooter(result.lastUpdated ?? result.lastGoodUpdated, result.error)}
    </section>
  `;
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
//
// A placeholder div is included for the overlay chart (workstream 6).
// ---------------------------------------------------------------------------
function renderCAIC(result: SourceResult<CAICWeatherSummary>): void {
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
// NWS/CAIC Temperature Comparison chart — standalone card.
// Extracted from the CAIC card so it can be independently positioned.
// ---------------------------------------------------------------------------
function renderChart(): void {
  const el = document.getElementById("chart-region")!;
  const loc          = LOCATIONS[state.activeLocation];
  const hourlyResult = state.weather[loc.id].hourly;
  const nwsHourly    = hourlyResult.data ?? hourlyResult.lastGoodData;
  const caicFcst     = state.caic.pointForecast.data ?? state.caic.pointForecast.lastGoodData;

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

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">Temperature Forecast</h2>
      <div id="caic-chart-placeholder" class="caic-chart-placeholder"></div>
      ${cardFooter(ts, hourlyResult.error)}
    </section>
  `;

  const placeholder = document.getElementById("caic-chart-placeholder")!;
  renderOverlayChart(placeholder, nwsHourly!, caicFcst, loc.id);
}

// ---------------------------------------------------------------------------
// Consensus brief card — AI-generated 3–5 sentence plain-prose summary.
//
// Includes a manual refresh button that calls /api/brief?refresh=true,
// which triggers a fresh Claude Haiku call server-side and re-caches the result.
// The button is disabled while a refresh is in flight to prevent double-clicks.
// ---------------------------------------------------------------------------
function renderBrief(result: SourceResult<ConsensusBrief>): void {
  const el = document.getElementById("brief-region")!;

  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard();
    return;
  }

  if (result.error && !result.lastGoodData) {
    el.innerHTML = `
      <section class="card card--error">
        <h2 class="card-title">Consensus Brief</h2>
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
      <h2 class="card-title">Consensus Brief</h2>
      <div class="brief-body">${d.text}</div>
      <div class="brief-footer">
        ${genTime ? `<span class="brief-generated">Generated ${genTime}</span>` : ""}
        <button class="brief-refresh-btn" aria-label="Refresh consensus brief">↻ Refresh</button>
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
      const updated = await fetchBrief(result, true);
      updateBrief(updated);
    } finally {
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
    }
  });
}

// ---------------------------------------------------------------------------
// Chris Tomer description card.
//
// Displays the description text from his latest "Mountain Weather Update"
// video. No embed, no link — description text only, per spec.
// The video title is shown in small muted text above the description so
// the user can see which video the description belongs to.
// ---------------------------------------------------------------------------
function renderTomer(result: SourceResult<TomerVideo>): void {
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

  el.innerHTML = `
    <section class="card${isStale ? " card--error" : ""}">
      <h2 class="card-title">Mountain Weather Update</h2>
      <p class="tomer-video-title">${d.title}</p>
      <div class="tomer-body">${descHtml}</div>
      ${cardFooter(ts, result.error)}
      ${published ? `<footer class="card-footer tomer-published">Posted ${published}</footer>` : ""}
    </section>
  `;
}
