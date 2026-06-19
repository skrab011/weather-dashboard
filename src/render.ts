// ---------------------------------------------------------------------------
// Personal page (V1) render layer — a thin wrapper over the shared card engine.
//
// This file owns the two page-specific concerns that don't belong in the shared
// renderers: the static shell (header, the fixed two-location tab bar, the
// hourly/7-day toggle) and the renderAll orchestrator that reads V1's state and
// feeds each shared card the data it needs. The pure card renderers themselves
// live in src/shared/cards.ts and are shared with the V2 page.
//
// Entry points:
//   renderShell()  — called once at boot; paints the static UI skeleton
//   renderAll()    — called by the store on every state change; updates cards
// ---------------------------------------------------------------------------

import { LOCATIONS } from "./locations";
import { state, setActiveLocation, setActiveView, updateBrief } from "./store";
import { fetchBrief } from "./brief";
import {
  skeletonCard,
  renderAlerts,
  renderConditions,
  renderAirQuality,
  renderHourly,
  renderForecast,
  renderChart,
  renderBrief,
  renderCAIC,
  renderTomer,
} from "./shared/cards";

// ---------------------------------------------------------------------------
// renderShell — called once. Writes the static HTML skeleton into #app and
// attaches event listeners for the location tabs and hourly/7-day toggle.
// The two-tab layout is a personal-page concern and lives here, not in the
// shared renderers.
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
// Wires V1's state into the shared card renderers.
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

  // PurpleAir temperature is shown for the home location only (V1 rule).
  const showPaTemp = loc.id === "home";

  renderAlerts(weather.alerts);
  renderConditions(weather.hourly, weather.gridpoint, weather.sunTimes, weather.airQuality, showPaTemp);
  renderAirQuality(weather.airQuality);
  renderHourly(weather.hourly);
  renderForecast(weather.forecast);
  renderChart(weather.hourly, state.caic.pointForecast, loc.id);

  // The brief's manual-refresh button refetches and pushes the result into state.
  // Capture the current brief result so the refresh uses the same value the
  // original render-time closure did.
  const brief = state.brief;
  renderBrief(brief, async () => {
    const updated = await fetchBrief(brief, true);
    updateBrief(updated);
  });

  renderCAIC(state.caic.summary);
  renderTomer(state.tomer);
}
