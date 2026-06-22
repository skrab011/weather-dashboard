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
  Filler,
} from "chart.js";

// Register only the components we use — keeps the bundle smaller than
// importing the full Chart.js library via the "auto" import.
// Filler is needed for the disagreement band's area fill (the lines use fill:false).
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

import type { CAICPointForecastRow, NWSPeriod, OpenMeteoForecast } from "./types";

// CAIC's point-forecast grid cell sits at a higher elevation than town sites.
const CAIC_ELEV_FT = 9_219; // actual looper grid cell elevation

// Design-system colours — must match style.css custom properties.
const COLOR_NWS   = "#b39ddb"; // --accent (lavender)
const COLOR_CAIC  = "#f59e0b"; // --warn
const COLOR_OM    = "#4dd0e1"; // cyan/teal — ECMWF / Open-Meteo, distinct from the above
const COLOR_BAND  = "rgba(154,163,178,0.13)"; // faint neutral — model-disagreement band
const COLOR_GRID  = "#252a38"; // --border
const COLOR_TICKS = "#6b7280"; // --muted
const COLOR_LEGEND = "#9aa3b2"; // --fg-secondary

// Friendly label for an Open-Meteo model id (e.g. "ecmwf_ifs025" → "ECMWF").
function modelLabel(model: string): string {
  if (model.startsWith("ecmwf")) return "ECMWF";
  if (model.startsWith("gfs"))   return "GFS";
  if (model.startsWith("icon"))  return "ICON";
  return model;
}

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
// caicForecast CAIC point-forecast rows (null for non-CO locations).
// nwsElevFt    NWS forecast-point elevation in feet, or null if unknown.
//              Elevation label is shown only when ≥ 5,000 ft — below that
//              elevation varies little over short distances so the label adds
//              noise rather than context.
// ---------------------------------------------------------------------------
export function renderOverlayChart(
  placeholder: HTMLElement,
  nwsHourly: NWSPeriod[] | null,
  caicForecast: CAICPointForecastRow[] | null,
  nwsElevFt: number | null,
  openMeteo: OpenMeteoForecast | null,
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

  // Align Open-Meteo (ECMWF) temperatures to NWS timestamps the same way.
  // Open-Meteo is hourly on the hour, so matches line up exactly.
  let omTemps: (number | null)[] | null = null;
  if (openMeteo && openMeteo.rows.length > 0) {
    omTemps = nwsSlice.map((p) => {
      const t = new Date(p.startTime).getTime();
      let closest: { dateTime: string; tempF: number | null } | null = null;
      let minDiff = Infinity;
      for (const row of openMeteo.rows) {
        const diff = Math.abs(new Date(row.dateTime).getTime() - t);
        if (diff < minDiff) { minDiff = diff; closest = row; }
      }
      return closest && minDiff <= 5_400_000 ? closest.tempF : null;
    });
  }

  // Destroy the previous chart before touching the canvas
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // (Re-)create a fresh canvas inside the placeholder on every render.
  // This avoids any stale Chart.js state from a previous render cycle.
  placeholder.innerHTML = `<canvas class="overlay-chart-canvas" aria-label="Temperature forecast comparison chart"></canvas>`;
  const canvas = placeholder.querySelector<HTMLCanvasElement>("canvas")!;

  const elev = (ft: number) => `${ft.toLocaleString()} ft`;
  // Show elevation in the label only when ≥ 5,000 ft — elevation matters more
  // at high altitude where small differences produce meaningful temperature gaps.
  const nwsLabel = nwsElevFt !== null && nwsElevFt >= 5_000
    ? `NWS (${elev(nwsElevFt)})`
    : "NWS Temperature";

  const datasets: Chart["data"]["datasets"] = [
    {
      label:           nwsLabel,
      data:            nwsTemps,
      borderColor:     COLOR_NWS,
      backgroundColor: "rgba(179,157,219,0.07)",
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

  // Open-Meteo (ECMWF) series — only added when data is available.
  // Elevation label uses the same ≥ 5,000 ft threshold as the NWS label.
  if (omTemps && openMeteo) {
    const omName = modelLabel(openMeteo.model);
    const omLabel = openMeteo.elevationFt !== null && openMeteo.elevationFt >= 5_000
      ? `${omName} (${elev(Math.round(openMeteo.elevationFt))})`
      : omName;
    datasets.push({
      label:           omLabel,
      data:            omTemps,
      borderColor:     COLOR_OM,
      backgroundColor: "rgba(77,208,225,0.07)",
      borderWidth:     2,
      pointRadius:     0,
      tension:         0.3,
      fill:            false,
    });
  }

  // Disagreement band — shade the spread between the available model lines so
  // it's easy to see where they agree (pinched) vs. diverge (wide). Drawn only
  // when ≥2 series are present; computed per hour from that hour's non-null
  // values. The two band datasets are inserted at the front of the array so they
  // render *behind* the lines, and are flagged with a "__" label prefix so they
  // are excluded from the legend and tooltip (see the filters below).
  const bandSeries: (number | null)[][] = [nwsTemps];
  if (caicTemps) bandSeries.push(caicTemps);
  if (omTemps)   bandSeries.push(omTemps);
  if (bandSeries.length >= 2) {
    const bandMax: (number | null)[] = [];
    const bandMin: (number | null)[] = [];
    for (let i = 0; i < nwsTemps.length; i++) {
      const vals = bandSeries
        .map((s) => s[i])
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length >= 2) {
        bandMax.push(Math.max(...vals));
        bandMin.push(Math.min(...vals));
      } else {
        bandMax.push(null);
        bandMin.push(null);
      }
    }
    // Order matters: max first (fills down to min at relative index +1), min
    // second. unshift in reverse so the final order is [max, min, ...lines].
    datasets.unshift({
      label:           "__band_min",
      data:            bandMin,
      borderColor:     "transparent",
      backgroundColor: "transparent",
      borderWidth:     0,
      pointRadius:     0,
      tension:         0.3,
      fill:            false,
    });
    datasets.unshift({
      label:           "__band_max",
      data:            bandMax,
      borderColor:     "transparent",
      backgroundColor: COLOR_BAND,
      borderWidth:     0,
      pointRadius:     0,
      tension:         0.3,
      fill:            "+1", // fill the area down to the min dataset
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
            // Hide the internal band datasets (label prefixed with "__").
            filter: (item) => !(item.text ?? "").startsWith("__"),
          },
        },
        tooltip: {
          // Don't show the band's min/max helper datasets in the tooltip.
          filter: (item) => !(item.dataset.label ?? "").startsWith("__"),
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
