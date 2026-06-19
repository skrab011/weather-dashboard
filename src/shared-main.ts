// ---------------------------------------------------------------------------
// Shared page (V2) entry point.
//
// Boot sequence:
//   1. Read the user's saved locations from localStorage (W4 persistence).
//   2. No locations  → show the onboarding/picker screen (W4 picker).
//      Has locations → build the store from them and run the V1-style
//                       fetch/render flow using the src/shared/ engine.
//   3. An "Edit locations" control returns to the picker to add/remove/change.
//
// The personal page (V1) at src/main.ts is intentionally untouched. Colorado
// gating (hiding CAIC/Tomer/chart outside CO) and the dual-mode brief title are
// later workstreams (W5/W6); W4 wires up the full V1-style flow for every
// location.
// ---------------------------------------------------------------------------

import "./style.css";
import { fetchPoints, fetchAllForLocation } from "./shared/nws";
import { fetchAirQuality } from "./shared/airQuality";
import { fetchCAIC } from "./shared/caic";
import { fetchTomer } from "./shared/tomer";
import { fetchBrief } from "./shared/brief";
import { calcSunTimes } from "./shared/sun";
import { createStore } from "./shared/store";
import type { Location } from "./shared/types";
import { loadLocations, type StoredLocation } from "./shared-page/persistence";
import { renderLocationScreen } from "./shared-page/picker";
import { renderSharedShell, makeRenderAll, type RuntimeLocation } from "./shared-page/render";

// Turn the persisted locations into runtime locations with a stable store id.
function toRuntimeLocations(stored: StoredLocation[]): RuntimeLocation[] {
  return stored.map((s, i) => ({
    id: `loc${i}`,
    label: s.label,
    lat: s.lat,
    lon: s.lon,
    state: s.state,
    inColorado: s.inColorado,
  }));
}

// Fetch the consensus/forecast brief for the active location and push it into
// state. Called at boot and on every tab switch so the brief tracks the active
// location (it's cached per-location server-side via the W2 plumbing).
function fetchBriefForActive(
  store: ReturnType<typeof createStore>,
  locations: RuntimeLocation[],
): void {
  const loc = locations[store.state.activeLocation];
  fetchBrief(store.state.brief, false, { lat: loc.lat, lon: loc.lon, inColorado: loc.inColorado })
    .then(store.updateBrief)
    .catch(() => {});
}

// Render the dashboard for the chosen locations.
function showDashboard(runtimeLocations: RuntimeLocation[]): void {
  // The store only needs the base Location fields, keyed by our generated id.
  const storeLocations: Location[] = runtimeLocations.map((l) => ({
    id: l.id, label: l.label, lat: l.lat, lon: l.lon,
  }));
  const store = createStore(storeLocations);

  const renderAll = makeRenderAll(store, runtimeLocations);

  // Paint the shell, then register the subscriber, then do the first render —
  // same ordering as V1 so cards show skeletons before any network call.
  renderSharedShell(runtimeLocations, {
    onSelectLocation: (index) => {
      store.setActiveLocation(index);
      // Brief is per-location; refetch for the newly active tab.
      fetchBriefForActive(store, runtimeLocations);
    },
    onSelectView: (view) => store.setActiveView(view),
    onManage: showPicker,
  });
  store.subscribe(renderAll);
  renderAll();

  // Zone-wide CAIC + Tomer: skip entirely when no chosen location is in Colorado.
  // W5 gating — avoids pointless calls for fully non-CO users.
  const anyInCO = runtimeLocations.some((l) => l.inColorado);
  if (anyInCO) {
    fetchCAIC(store.state.caic).then(store.updateCAIC).catch(() => {});
    fetchTomer(store.state.tomer).then(store.updateTomer).catch(() => {});
  }

  // Brief for the initially-active location.
  fetchBriefForActive(store, runtimeLocations);

  // Per-location NWS + air quality, both locations in parallel (V1-style).
  runtimeLocations.forEach(async (loc) => {
    // Sun times are pure math — set immediately so sunrise/sunset shows early.
    const sunTimes = calcSunTimes(loc.lat, loc.lon, new Date());
    store.updateLocationWeather(loc.id, { ...store.state.weather[loc.id], sunTimes });

    const [nwsOutcome, aqResult] = await Promise.allSettled([
      (async () => {
        const meta = await fetchPoints(loc.lat, loc.lon);
        return fetchAllForLocation(loc, meta, store.state.weather[loc.id]);
      })(),
      // Shared page uses the lat/lon air-quality path; no home-only PA temp.
      fetchAirQuality(loc.lat, loc.lon, { showTemp: false }, store.state.weather[loc.id].airQuality),
    ]);

    if (nwsOutcome.status === "fulfilled") {
      store.updateLocationWeather(loc.id, {
        ...nwsOutcome.value,
        sunTimes,
        airQuality: aqResult.status === "fulfilled"
          ? aqResult.value
          : store.state.weather[loc.id].airQuality,
      });
    } else {
      const errMsg = nwsOutcome.reason instanceof Error ? nwsOutcome.reason.message : "Could not reach NWS";
      const failed = { data: null as null, error: errMsg, lastUpdated: null, lastGoodData: null as null, lastGoodUpdated: null };
      store.updateLocationWeather(loc.id, {
        forecast: failed,
        hourly: failed,
        gridpoint: failed,
        alerts: failed,
        sunTimes,
        airQuality: aqResult.status === "fulfilled"
          ? aqResult.value
          : store.state.weather[loc.id].airQuality,
      });
    }

    // If air quality failed after NWS succeeded, patch it in separately.
    if (nwsOutcome.status === "fulfilled" && aqResult.status === "rejected") {
      const errMsg = aqResult.reason instanceof Error ? aqResult.reason.message : "Could not load air quality";
      store.updateLocationWeather(loc.id, {
        ...store.state.weather[loc.id],
        airQuality: {
          data: null,
          error: errMsg,
          lastUpdated: null,
          lastGoodData: store.state.weather[loc.id].airQuality.lastGoodData,
          lastGoodUpdated: store.state.weather[loc.id].airQuality.lastGoodUpdated,
        },
      });
    }
  });
}

// Show the location picker / manage screen.
function showPicker(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  app.innerHTML = `<main class="content content--centered"><div id="picker-region"></div></main>`;
  const region = app.querySelector<HTMLElement>("#picker-region")!;
  renderLocationScreen(region, { onDone: start });
}

// Entry: pick the right screen based on what's stored.
function start(): void {
  const stored = loadLocations();
  if (stored.length === 0) {
    showPicker();
  } else {
    showDashboard(toRuntimeLocations(stored));
  }
}

start();
