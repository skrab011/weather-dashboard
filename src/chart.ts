// ---------------------------------------------------------------------------
// Overlay chart — NWS + CAIC temperature on shared axes.
//
// Renders into the #caic-chart-placeholder div that already exists inside
// the CAIC card. Rebuilt on every renderAll() call so it stays in sync
// when the user switches location tabs.
//
// Phase 1: NWS data only. CAIC series is wired in during WS6 Phase 2 once
// the looper point-forecast JSON endpoint is identified via DevTools.
//
// Elevation labels are the key spec requirement: they explain why NWS and
// CAIC temperatures differ — it's elevation, not model disagreement.
//
// Approximate elevations:
//   Home (Silverthorne)  → NWS forecasts for ~9,035 ft
//   Office (Frisco)      → NWS forecasts for ~9,097 ft
//   CAIC mountain zone   → point-forecast grid cell at ~10,500 ft
// ---------------------------------------------------------------------------

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";

// Register only the components we use — keeps the bundle smaller than
// importing the full Chart.js library via the "auto" import.
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

import type { CAICPointForecastRow, NWSPeriod } from "./types";

// Approximate elevation of the NWS forecast point for each location.
// NWS forecasts are tied to the specific lat/lon grid cell, not a mountain summit.
const LOC_ELEV_FT: Record<string, number> = {
  home:   9_035, // Silverthorne, CO
  office: 9_097, // Frisco, CO
};

// CAIC's point-forecast grid cell sits at a higher elevation than the town sites.
const CAIC_ELEV_FT = 9_219; // actual looper grid cell elevation

// Design-system colours — must match style.css custom properties.
const COLOR_NWS   = "#4a9eff"; // --accent
const COLOR_CAIC  = "#f59e0b"; // --warn
const COLOR_GRID  = "#252a38"; // --border
const COLOR_TICKS = "#6b7280"; // --muted
const COLOR_LEGEND = "#9aa3b2"; // --fg-secondary

// Persist the Chart.js instance so we can call destroy() before rebuilding.
// Chart.js throws if you create a second chart on the same canvas element.
let chartInstance: Chart | null = null;

// Format a period's startTime as "Mon 2 PM" for X-axis tick labels.
function fmtHour(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric" });
}

// ---------------------------------------------------------------------------
// renderOverlayChart — main entry point called from render.ts.
//
// placeholder  The #caic-chart-placeholder div to render into.
// nwsHourly    Hourly NWS periods (or null while loading / on error).
// caicForecast CAIC point-forecast rows (null until WS6 Phase 2).
// locId        Active location id — "home" or "office" — for elevation label.
// ---------------------------------------------------------------------------
export function renderOverlayChart(
  placeholder: HTMLElement,
  nwsHourly: NWSPeriod[] | null,
  caicForecast: CAICPointForecastRow[] | null,
  locId: string,
): void {
  // Nothing to draw yet — NWS data still loading
  if (!nwsHourly || nwsHourly.length === 0) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    placeholder.innerHTML = "";
    return;
  }

  // Slice to the next 48 hours of hourly periods
  const cutoff   = Date.now() + 48 * 3_600_000;
  const nwsSlice = nwsHourly.filter((p) => new Date(p.startTime).getTime() < cutoff);

  const labels   = nwsSlice.map((p) => fmtHour(p.startTime));
  const nwsTemps = nwsSlice.map((p) => p.temperature);

  // Align CAIC temperatures to NWS timestamps by finding the nearest CAIC row
  // within a 1.5-hour window. Null when no close match exists.
  let caicTemps: (number | null)[] | null = null;
  if (caicForecast && caicForecast.length > 0) {
    caicTemps = nwsSlice.map((p) => {
      const t = new Date(p.startTime).getTime();
      let closest: CAICPointForecastRow | null = null;
      let minDiff = Infinity;
      for (const row of caicForecast) {
        const diff = Math.abs(new Date(row.dateTime).getTime() - t);
        if (diff < minDiff) { minDiff = diff; closest = row; }
      }
      return closest && minDiff <= 5_400_000 ? closest.tmpF : null;
    });
  }

  // Destroy the previous chart before touching the canvas
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // (Re-)create a fresh canvas inside the placeholder on every render.
  // This avoids any stale Chart.js state from a previous render cycle.
  placeholder.innerHTML = `<canvas class="overlay-chart-canvas" aria-label="Temperature forecast comparison chart"></canvas>`;
  const canvas = placeholder.querySelector<HTMLCanvasElement>("canvas")!;

  const nwsElev = LOC_ELEV_FT[locId] ?? 9_000;
  const elev    = (ft: number) => `${ft.toLocaleString()} ft`;

  const datasets: Chart["data"]["datasets"] = [
    {
      label:           `NWS (${elev(nwsElev)})`,
      data:            nwsTemps,
      borderColor:     COLOR_NWS,
      backgroundColor: "rgba(74,158,255,0.07)",
      borderWidth:     2,
      pointRadius:     0,       // hide individual points — too cluttered at 48hrs
      tension:         0.3,
      fill:            false,
    },
  ];

  // CAIC series — only added when data is available (Phase 2 and beyond)
  if (caicTemps) {
    datasets.push({
      label:           `CAIC (~${elev(CAIC_ELEV_FT)})`,
      data:            caicTemps,
      borderColor:     COLOR_CAIC,
      backgroundColor: "rgba(245,158,11,0.07)",
      borderWidth:     2,
      pointRadius:     0,
      tension:         0.3,
      fill:            false,
    });
  }

  chartInstance = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      aspectRatio:         2.5, // width:height — feels comfortable on both mobile and desktop
      animation:           false, // no animation on re-renders (location tab switches feel instant)
      plugins: {
        legend: {
          labels: {
            color:    COLOR_LEGEND,
            font:     { size: 12 },
            boxWidth: 16,
          },
        },
        tooltip: {
          callbacks: {
            // Show unit in tooltip so the value is unambiguous
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}°F`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color:         COLOR_TICKS,
            font:          { size: 11 },
            maxTicksLimit: 12,  // avoid crowded labels on small screens
            maxRotation:   0,   // keep horizontal — rotated labels are hard to read
          },
          grid: { color: COLOR_GRID },
        },
        y: {
          ticks: {
            color:    COLOR_TICKS,
            font:     { size: 11 },
            callback: (v) => `${v}°`,
          },
          grid:  { color: COLOR_GRID },
          title: {
            display: true,
            text:    "Temperature (°F)",
            color:   COLOR_TICKS,
            font:    { size: 11 },
          },
        },
      },
    },
  });
}
