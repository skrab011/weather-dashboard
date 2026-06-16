// ---------------------------------------------------------------------------
// Render layer — everything that touches the DOM lives here.
// Reads from state; never writes to state.
//
// Entry points:
//   renderShell()  — called once at boot; paints the static UI skeleton
//   renderAll()    — called by the store on every state change; updates cards
// ---------------------------------------------------------------------------

import type {
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  SourceResult,
  SunTimes,
} from "./types";
import { LOCATIONS } from "./locations";
import { state, setActiveLocation, setActiveView } from "./store";
import { currentSeriesValue, sumSeriesNextHours } from "./nws";

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
// NWS returns "10 mph" or "10 to 15 mph"; we convert the latter to "10–15 mph".
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
// The skeleton is painted synchronously before any network fetch starts, so
// the user always sees the UI frame rather than a blank screen.
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

      <div id="conditions-region">
        ${skeletonCard()}
      </div>

      <div id="hourly-region" class="view-hourly">
        ${skeletonCard()}
      </div>

      <div id="forecast-region" class="view-7day">
        ${skeletonCard()}
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
// Syncs tab + toggle visual state, then re-renders all data cards for the
// currently active location.
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

  // Render each card
  renderAlerts(weather.alerts);
  renderConditions(weather.hourly, weather.gridpoint, weather.sunTimes);
  renderHourly(weather.hourly);
  renderForecast(weather.forecast);
}

// ---------------------------------------------------------------------------
// Alert banner — sits above all cards; hidden when there are no alerts.
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
// Current conditions card — temperature, wind, sky, UV, snowfall, sun times.
// Pulls from the first hourly period (current hour) + gridpoint time series.
// ---------------------------------------------------------------------------
function renderConditions(
  hourlyResult: SourceResult<NWSPeriod[]>,
  gridResult: SourceResult<NWSGridpoint>,
  sunTimes: SunTimes | null,
): void {
  const el = document.getElementById("conditions-region")!;

  // Loading state — both sources still in flight
  if (!hourlyResult.data && !hourlyResult.error && !gridResult.data && !gridResult.error) {
    el.innerHTML = skeletonCard();
    return;
  }

  const now = (hourlyResult.data ?? hourlyResult.lastGoodData)?.[0];
  const grid = gridResult.data ?? gridResult.lastGoodData;

  // Sum expected snowfall over the next 24 hours (returns 0 in summer, hidden if so)
  const snowNext24 = grid
    ? sumSeriesNextHours(
        grid.snowfallAmount.values,
        24,
        grid.snowfallAmount.uom,
      )
    : null;

  // UV index value for the current time window
  const uvNow = grid ? currentSeriesValue(grid.uVIndex.values) : null;

  const rows: string[] = [];

  if (now) {
    const windDeg = WIND_DIR_DEG[now.windDirection] ?? 0;
    rows.push(`
      <div class="cond-row">
        <span class="cond-label">Temp</span>
        <span class="cond-value">${now.temperature}°F</span>
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

  // Only show snowfall when there is meaningful accumulation expected
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
  const ts = hourlyResult.lastUpdated ?? gridResult.lastUpdated ?? hourlyResult.lastGoodUpdated;

  el.innerHTML = `
    <section class="card${hasError ? " card--error" : ""}">
      <h2 class="card-title">Now</h2>
      ${rows.length ? rows.join("") : '<p class="card-empty">Loading conditions…</p>'}
      ${cardFooter(ts ?? null, hasError ? "Could not load current conditions" : null)}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Hourly forecast strip — horizontally scrollable, next 24 hours.
// Hidden when the 7-day view is active (CSS data-view attribute).
// ---------------------------------------------------------------------------
function renderHourly(result: SourceResult<NWSPeriod[]>): void {
  const el = document.getElementById("hourly-region")!;

  // Loading
  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard("view-hourly");
    return;
  }

  // Hard error with no fallback data
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
  // Show only the next 24 hours — 156 hourly periods would be overwhelming
  const cutoff = Date.now() + 24 * 3_600_000;
  const next24 = periods.filter((p) => new Date(p.startTime).getTime() < cutoff);

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
// 7-day forecast — stacked rows, one per period (day + night).
// Hidden when the hourly view is active (CSS data-view attribute).
// ---------------------------------------------------------------------------
function renderForecast(result: SourceResult<NWSPeriod[]>): void {
  const el = document.getElementById("forecast-region")!;

  // Loading
  if (!result.data && !result.error && !result.lastGoodData) {
    el.innerHTML = skeletonCard("view-7day");
    return;
  }

  // Hard error with no fallback
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

  el.innerHTML = `
    <section class="card view-7day${result.error ? " card--error" : ""}">
      <h2 class="card-title">7-Day</h2>
      <div class="forecast-list" role="list">
        ${periods.map((p) => `
          <div class="forecast-row" role="listitem">
            <span class="forecast-day">${p.isDaytime ? fmtDay(p.startTime) : "Night"}</span>
            <img
              class="forecast-icon"
              src="${p.icon}"
              alt="${p.shortForecast}"
              width="36" height="36"
              loading="lazy"
            />
            <span class="forecast-temp">${p.temperature}°F</span>
            <span class="forecast-desc">${p.shortForecast}</span>
            <span class="forecast-precip" title="Precipitation probability">${p.probabilityOfPrecipitation?.value ?? 0}%</span>
          </div>
        `).join("")}
      </div>
      ${cardFooter(result.lastUpdated ?? result.lastGoodUpdated, result.error)}
    </section>
  `;
}
