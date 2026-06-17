// ---------------------------------------------------------------------------
// Boot sequence — wires together the store, render layer, and data fetches.
//
// Order matters:
//   1. Paint the shell immediately (skeleton UI visible before any fetch)
//   2. Register the store subscriber (so state changes trigger re-renders)
//   3. Do the initial render (all cards in loading/skeleton state)
//   4. Calculate sun times synchronously and push them into state
//   5. Fetch NWS + air quality data for both locations in parallel
//   6. Fetch CAIC data in parallel with the per-location fetches
// ---------------------------------------------------------------------------

import "./style.css";
import { LOCATIONS } from "./locations";
import { fetchPoints, fetchAllForLocation } from "./nws";
import { fetchAirQuality } from "./airQuality";
import { fetchCAIC } from "./caic";
import { calcSunTimes } from "./sun";
import { state, subscribe, updateLocationWeather, updateCAIC } from "./store";
import { renderShell, renderAll } from "./render";

async function boot(): Promise<void> {
  // Paint the UI skeleton before any network call so there's never a blank screen
  renderShell();

  // Every state mutation calls renderAll, which re-renders the active location's cards
  subscribe(renderAll);

  // Initial render — all cards show their skeleton/loading state
  renderAll();

  // CAIC is zone-wide (same zone for both locations) — fetch once alongside the
  // per-location NWS/AQ fetches. A failure here never affects the other cards.
  const caicPromise = fetchCAIC(state.caic).then(updateCAIC).catch(() => {
    // fetchCAIC already wraps errors in SourceResult, so this only fires on
    // unexpected throws. The store stays in loading state; the card shows a skeleton.
  });

  // Fetch both locations in parallel; neither waits on the other
  await Promise.all([
    caicPromise,
    ...LOCATIONS.map(async (loc) => {
      // Sun times are pure math — calculate immediately so sunrise/sunset
      // appears in the "Now" card before the network calls return
      const sunTimes = calcSunTimes(loc.lat, loc.lon, new Date());
      updateLocationWeather(loc.id, { ...state.weather[loc.id], sunTimes });

      // NWS and air quality fetches run in parallel for each location
      const locId = loc.id as "home" | "office";

      const [nwsOutcome, aqResult] = await Promise.allSettled([
        // NWS: /points first, then all four endpoints
        (async () => {
          const meta = await fetchPoints(loc.lat, loc.lon);
          return fetchAllForLocation(loc, meta, state.weather[loc.id]);
        })(),
        fetchAirQuality(locId, state.weather[loc.id].airQuality),
      ]);

      // Build the merged LocationWeather, carrying the already-set sunTimes
      if (nwsOutcome.status === "fulfilled") {
        updateLocationWeather(loc.id, {
          ...nwsOutcome.value,
          sunTimes,
          airQuality: aqResult.status === "fulfilled"
            ? aqResult.value
            : state.weather[loc.id].airQuality,
        });
      } else {
        // /points (or subsequent NWS calls) failed — mark NWS as errored
        const errMsg =
          nwsOutcome.reason instanceof Error
            ? nwsOutcome.reason.message
            : "Could not reach NWS";
        const failed = {
          data: null as null,
          error: errMsg,
          lastUpdated: null,
          lastGoodData: null as null,
          lastGoodUpdated: null,
        };
        updateLocationWeather(loc.id, {
          forecast:  failed,
          hourly:    failed,
          gridpoint: failed,
          alerts:    failed,
          sunTimes,
          // Air quality is independent — still use its result even if NWS failed
          airQuality: aqResult.status === "fulfilled"
            ? aqResult.value
            : state.weather[loc.id].airQuality,
        });
      }

      // If air quality fetch failed after NWS succeeded, patch it in separately
      if (nwsOutcome.status === "fulfilled" && aqResult.status === "rejected") {
        const errMsg =
          aqResult.reason instanceof Error
            ? aqResult.reason.message
            : "Could not load air quality";
        updateLocationWeather(loc.id, {
          ...state.weather[loc.id],
          airQuality: {
            data: null,
            error: errMsg,
            lastUpdated: null,
            lastGoodData: state.weather[loc.id].airQuality.lastGoodData,
            lastGoodUpdated: state.weather[loc.id].airQuality.lastGoodUpdated,
          },
        });
      }
    }),
  ]);
}

boot();

// Register service worker for offline caching.
// Non-fatal if it fails — the app works fine without it.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Silently ignore — offline support is a progressive enhancement
  });
}
