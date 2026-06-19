// ---------------------------------------------------------------------------
// Shared page (V2) render layer — the V2 counterpart to src/render.ts.
//
// Like the personal page's render.ts, this owns the two page-specific concerns
// that don't belong in the shared card renderers: the page shell (header, tab
// bar, hourly/7-day toggle) and a renderAll orchestrator that reads state and
// feeds each shared card its data. The difference from V1: the tab bar is built
// from the user's chosen locations (1 or 2) and there's an "Edit locations"
// affordance. The pure card renderers in src/shared/cards.ts are shared verbatim.
//
// Colorado gating (hiding CAIC / Tomer / overlay chart outside CO) is NOT done
// here yet — that's W5. W4 renders the full V1-style card set for every location.
// ---------------------------------------------------------------------------

import type { Store } from "../shared/store";
import type { Location } from "../shared/types";
import { fetchBrief } from "../shared/brief";
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
} from "../shared/cards";

// A chosen location carries the geocoder-derived state/inColorado alongside the
// base Location fields the store needs. inColorado drives the per-location brief
// (and, in W5, Colorado gating).
export interface RuntimeLocation extends Location {
  state: string;
  inColorado: boolean;
}

// Small HTML escaper for geocoder-supplied labels rendered into the tab bar.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------------------------------------------------------------------------
// renderSharedShell — paints the static skeleton and wires the header controls.
// Mirrors V1's renderShell but with user-chosen tabs and an Edit button.
// ---------------------------------------------------------------------------
export function renderSharedShell(
  locations: RuntimeLocation[],
  handlers: {
    onSelectLocation: (index: number) => void;
    onSelectView: (view: "hourly" | "7day") => void;
    onManage: () => void;
  },
): void {
  const app = document.querySelector<HTMLDivElement>("#app")!;

  app.innerHTML = `
    <div class="sticky-nav">
      <header class="app-header">
        <div class="app-header__top">
          <span class="app-title">Weather</span>
          <button class="app-edit" type="button">Edit locations</button>
        </div>
        <nav class="tab-bar" role="tablist" aria-label="Location">
          ${locations.map((loc, i) => `
            <button
              class="tab${i === 0 ? " tab--active" : ""}"
              role="tab"
              aria-selected="${i === 0}"
              data-loc-index="${i}"
            >${esc(loc.label)}</button>
          `).join("")}
        </nav>
      </header>

      <div class="view-toggle" role="group" aria-label="Forecast view">
        <button class="toggle-btn toggle-btn--active" data-view="hourly">Hourly</button>
        <button class="toggle-btn" data-view="7day">7-Day</button>
      </div>
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

  // Location tab clicks → caller decides what to do (switch + refetch brief)
  app.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onSelectLocation(parseInt(btn.dataset.locIndex ?? "0", 10));
    });
  });

  // Toggle clicks → switch between hourly and 7-day view
  app.querySelectorAll<HTMLButtonElement>(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onSelectView(btn.dataset.view as "hourly" | "7day");
    });
  });

  // Edit locations → caller opens the manage screen
  app.querySelector<HTMLButtonElement>(".app-edit")?.addEventListener("click", handlers.onManage);
}

// ---------------------------------------------------------------------------
// makeRenderAll — returns a renderAll bound to this store + location list.
// Registered as the store subscriber so every state change re-renders.
// ---------------------------------------------------------------------------
export function makeRenderAll(store: Store, locations: RuntimeLocation[]): () => void {
  return function renderAll(): void {
    const state = store.state;
    const loc = locations[state.activeLocation];
    const weather = state.weather[loc.id];

    // Sync tab active styling
    document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn, i) => {
      const active = i === state.activeLocation;
      btn.classList.toggle("tab--active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    // Sync toggle styling and the data-view attribute that drives CSS visibility
    const main = document.querySelector<HTMLElement>(".content");
    if (main) {
      main.setAttribute("data-view", state.activeView);
      // data-co drives CSS to collapse/restore the CO-gated card regions
      main.setAttribute("data-co", String(loc.inColorado));
    }

    document.querySelectorAll<HTMLButtonElement>(".toggle-btn").forEach((btn) => {
      btn.classList.toggle("toggle-btn--active", btn.dataset.view === state.activeView);
    });

    // Show PA temperature only when sensors exist near the chosen location and
    // returned a reading. tempF is null when no sensors are within 4 miles.
    const showPaTemp = !!weather.airQuality.data?.tempF;

    renderAlerts(weather.alerts);
    renderConditions(weather.hourly, weather.gridpoint, weather.sunTimes, weather.airQuality, showPaTemp);
    renderAirQuality(weather.airQuality);
    renderHourly(weather.hourly);
    renderForecast(weather.forecast);

    // Brief refresh refetches for the ACTIVE location (per-location cache key +
    // mode plumbing from W2). Capture the current brief result so the refresh
    // preserves last-good data on failure.
    const brief = state.brief;
    const briefTitle = loc.inColorado ? "Consensus Brief" : "Forecast Brief";
    renderBrief(brief, async () => {
      const updated = await fetchBrief(brief, true, {
        lat: loc.lat,
        lon: loc.lon,
        inColorado: loc.inColorado,
      });
      store.updateBrief(updated);
    }, briefTitle);

    // Chart is always rendered for all locations. CAIC series is included only
    // when the active location is in Colorado. We must pass a null result
    // explicitly for non-CO — not state.caic.pointForecast — because CAIC data
    // may already be in state from a CO location the user also has saved, and
    // passing it would bleed that CO data into a non-CO chart.
    // Elevation label shown only when ≥ 5,000 ft (see chart.ts).
    const nwsElevFt = weather.gridpoint.data?.elevationM != null
      ? Math.round(weather.gridpoint.data.elevationM * 3.28084)
      : null;
    const caicForChart = loc.inColorado
      ? state.caic.pointForecast
      : { data: null, error: null, lastUpdated: null, lastGoodData: null, lastGoodUpdated: null };
    renderChart(weather.hourly, caicForChart, nwsElevFt);

    // CO-gated: CAIC weather summary and Tomer video only.
    // Clear their regions when non-CO so no skeleton/stale content lingers.
    if (loc.inColorado) {
      renderCAIC(state.caic.summary);
      renderTomer(state.tomer);
    } else {
      const caicEl  = document.getElementById("caic-region");
      const tomerEl = document.getElementById("tomer-region");
      if (caicEl)  caicEl.innerHTML  = "";
      if (tomerEl) tomerEl.innerHTML = "";
    }
  };
}
