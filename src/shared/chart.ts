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

import type { CAICPointForecastRow, ChartVar, NWSPeriod, OpenMeteoForecast, OpenMeteoRow } from "./types";

// CAIC's point-forecast grid cell sits at a higher elevation than town sites.
const CAIC_ELEV_FT = 9_219; // actual looper grid cell elevation

// Design-system colours — must match style.css custom properties.
const COLOR_NWS   = "#b39ddb"; // --accent (lavender)
const COLOR_CAIC  = "#f59e0b"; // --warn
const COLOR_OM    = "#4dd0e1"; // cyan/teal — ECMWF (European model)
const COLOR_GFS   = "#81c784"; // green — GFS (American model)
const COLOR_BAND  = "rgba(154,163,178,0.22)"; // faint neutral — model-disagreement band
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

// Line colour for an Open-Meteo model. ECMWF is cyan; GFS is green.
function modelColor(model: string): string {
  if (model.startsWith("gfs")) return COLOR_GFS;
  return COLOR_OM; // ECMWF and fallback
}

// Translucent version of a "#rrggbb" colour — used for the faint legend-box fill.
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Parse an NWS wind-speed string ("10 mph", "10 to 15 mph") to a number in mph.
// Averages the values when a range is given; null when no number is present.
function parseWindMph(s: string): number | null {
  const nums = s.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const vals = nums.map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
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
  openMeteoModels: OpenMeteoForecast[] | null,
  variable: ChartVar,
): void {
  // Nothing to draw yet — NWS data still loading
  if (!nwsHourly || nwsHourly.length === 0) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    placeholder.innerHTML = "";
    return;
  }

  // Which variable family are we plotting?
  //   temp / wind   → NWS + CAIC + ECMWF, with NWS as the base series.
  //   precip / snow → amounts (inches) from CAIC + ECMWF only. NWS's hourly feed
  //                   reports precip *probability*, not an amount, so it can't
  //                   share this axis honestly — it is omitted for these.
  const isTemp   = variable === "temp";
  const isWind   = variable === "wind";
  const isAmount = variable === "precip" || variable === "snow";
  const includeNws = !isAmount;

  // Per-variable display details.
  const unitSuffix = isTemp ? "°F" : isWind ? " mph" : " in";
  const axisTitle =
    isTemp ? "Temperature (°F)" :
    isWind ? "Wind speed (mph)" :
    variable === "precip" ? "Precipitation (in)" : "Snowfall (in)";
  const varNoun =
    isTemp ? "Temperature" :
    isWind ? "Wind" :
    variable === "precip" ? "Precipitation" : "Snowfall";
  // Straight segments for amounts — smoothing would dip a 0→spike→0 curve below
  // zero, implying negative precip. Temp/wind keep the gentle curve.
  const lineTension = isAmount ? 0 : 0.3;

  // Slice to the next 48 hours of hourly periods
  const cutoff   = Date.now() + 48 * 3_600_000;
  const nwsSlice = nwsHourly.filter((p) => new Date(p.startTime).getTime() < cutoff);

  const labels = nwsSlice.map((p) => fmtHour(p.startTime));

  // NWS values — only for temp/wind (wind is a string that needs parsing).
  const nwsVals = includeNws
    ? nwsSlice.map((p) => (isTemp ? p.temperature : parseWindMph(p.windSpeed)))
    : null;

  // Align an external hourly series to the NWS timestamps by nearest match
  // within a 1.5-hour window. Null where no close match exists.
  function alignToNws<T extends { dateTime: string }>(
    rows: T[],
    getVal: (row: T) => number | null,
  ): (number | null)[] {
    return nwsSlice.map((p) => {
      const t = new Date(p.startTime).getTime();
      let closest: T | null = null;
      let minDiff = Infinity;
      for (const row of rows) {
        const diff = Math.abs(new Date(row.dateTime).getTime() - t);
        if (diff < minDiff) { minDiff = diff; closest = row; }
      }
      return closest && minDiff <= 5_400_000 ? getVal(closest) : null;
    });
  }

  // Per-source field for the selected variable.
  const caicField = (r: CAICPointForecastRow): number | null => {
    switch (variable) {
      case "temp":   return r.tmpF;
      case "wind":   return r.windSpeedMph;
      case "precip": return r.precipIn;
      case "snow":   return r.snowIn;
      default:       return null;
    }
  };
  const omField = (r: OpenMeteoRow): number | null => {
    switch (variable) {
      case "temp":   return r.tempF;
      case "wind":   return r.windMph;
      case "precip": return r.precipIn;
      case "snow":   return r.snowIn;
      default:       return null;
    }
  };

  const caicVals = caicForecast && caicForecast.length > 0
    ? alignToNws(caicForecast, caicField)
    : null;

  // A series may exist but have no values for the selected variable (e.g. CAIC
  // wind missing) — don't draw an empty line / orphan legend entry in that case.
  const caicHasData = !!caicVals && caicVals.some((v) => v !== null);

  // Destroy the previous chart before touching the canvas
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // (Re-)create a fresh canvas inside the placeholder on every render.
  // This avoids any stale Chart.js state from a previous render cycle.
  const ariaLabel = `${varNoun} forecast comparison chart`;
  placeholder.innerHTML = `<canvas class="overlay-chart-canvas" aria-label="${ariaLabel}"></canvas>`;
  const canvas = placeholder.querySelector<HTMLCanvasElement>("canvas")!;

  const elev = (ft: number) => `${ft.toLocaleString()} ft`;
  // Elevation context only makes sense for temperature; otherwise use the bare
  // source name. The elevation label is shown only when ≥ 5,000 ft.
  const nwsLabel = isTemp
    ? (nwsElevFt !== null && nwsElevFt >= 5_000 ? `NWS (${elev(nwsElevFt)})` : "NWS Temperature")
    : "NWS";

  const datasets: Chart["data"]["datasets"] = [];
  // Every drawn line's values, so the disagreement band can span them all.
  const drawnSeries: (number | null)[][] = [];

  // NWS series — temp/wind only (omitted for precip/snow amounts).
  if (includeNws && nwsVals) {
    datasets.push({
      label:           nwsLabel,
      data:            nwsVals,
      borderColor:     COLOR_NWS,
      backgroundColor: rgba(COLOR_NWS, 0.07),
      borderWidth:     2,
      pointRadius:     0,       // hide individual points — too cluttered at 48hrs
      tension:         lineTension,
      fill:            false,
    });
    drawnSeries.push(nwsVals);
  }

  // CAIC series — only added when data is available.
  if (caicHasData) {
    datasets.push({
      label:           isTemp ? `CAIC (~${elev(CAIC_ELEV_FT)})` : "CAIC",
      data:            caicVals!,
      borderColor:     COLOR_CAIC,
      backgroundColor: rgba(COLOR_CAIC, 0.07),
      borderWidth:     2,
      pointRadius:     0,
      tension:         lineTension,
      fill:            false,
    });
    drawnSeries.push(caicVals!);
  }

  // One line per Open-Meteo model (ECMWF, GFS, …) that has data for this
  // variable. Elevation label uses the same ≥ 5,000 ft threshold as NWS.
  for (const om of openMeteoModels ?? []) {
    if (om.rows.length === 0) continue;
    const vals = alignToNws(om.rows, omField);
    if (!vals.some((v) => v !== null)) continue;
    const name  = modelLabel(om.model);
    const label = isTemp && om.elevationFt !== null && om.elevationFt >= 5_000
      ? `${name} (${elev(Math.round(om.elevationFt))})`
      : name;
    const color = modelColor(om.model);
    datasets.push({
      label,
      data:            vals,
      borderColor:     color,
      backgroundColor: rgba(color, 0.07),
      borderWidth:     2,
      pointRadius:     0,
      tension:         lineTension,
      fill:            false,
    });
    drawnSeries.push(vals);
  }

  // Disagreement band — shade the spread between the available model lines so
  // it's easy to see where they agree (pinched) vs. diverge (wide). Drawn only
  // when ≥2 series are present; computed per hour from that hour's non-null
  // values. The two band datasets are inserted at the front of the array so they
  // render *behind* the lines, and are flagged with a "__" label prefix so they
  // are excluded from the legend and tooltip (see the filters below).
  if (drawnSeries.length >= 2) {
    const bandMax: (number | null)[] = [];
    const bandMin: (number | null)[] = [];
    for (let i = 0; i < labels.length; i++) {
      const vals = drawnSeries
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
      tension:         lineTension,
      fill:            false,
    });
    datasets.unshift({
      label:           "__band_max",
      data:            bandMax,
      borderColor:     "transparent",
      backgroundColor: COLOR_BAND,
      borderWidth:     0,
      pointRadius:     0,
      tension:         lineTension,
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
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}${unitSuffix}`,
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
          beginAtZero: isAmount, // amounts can't be negative — anchor at 0
          ticks: {
            color:    COLOR_TICKS,
            font:     { size: 11 },
            callback: (v) => (isTemp ? `${v}°` : `${v}`),
          },
          grid:  { color: COLOR_GRID },
          title: {
            display: true,
            text:    axisTitle,
            color:   COLOR_TICKS,
            font:    { size: 11 },
          },
        },
      },
    },
  });
}
