// ---------------------------------------------------------------------------
// Boot sequence — wires together the store, render layer, and data fetches.
//
// Order matters:
//   1. Paint the shell immediately (skeleton UI visible before any fetch)
//   2. Register the store subscriber (so state changes trigger re-renders)
//   3. Do the initial render (all cards in loading/skeleton state)
//   4. Calculate sun times synchronously and push them into state
//   5. Fetch NWS data for both locations in parallel
// ---------------------------------------------------------------------------

import "./style.css";
import { LOCATIONS } from "./locations";
import { fetchPoints, fetchAllForLocation } from "./nws";
import { calcSunTimes } from "./sun";
import { state, subscribe, updateLocationWeather } from "./store";
import { renderShell, renderAll } from "./render";

async function boot(): Promise<void> {
  // Paint the UI skeleton before any network call so there's never a blank screen
  renderShell();

  // Every state mutation calls renderAll, which re-renders the active location's cards
  subscribe(renderAll);

  // Initial render — all cards show their skeleton/loading state
  renderAll();

  // Fetch both locations in parallel; neither waits on the other
  await Promise.all(
    LOCATIONS.map(async (loc) => {
      // Sun times are pure math — calculate immediately so sunrise/sunset
      // appears in the "Now" card before the network calls return
      const sunTimes = calcSunTimes(loc.lat, loc.lon, new Date());
      updateLocationWeather(loc.id, {
        ...state.weather[loc.id],
        sunTimes,
      });

      try {
        // /points must succeed first — it returns the forecast and gridpoint URLs.
        // If it fails, all NWS cards for this location enter error state.
        const meta = await fetchPoints(loc.lat, loc.lon);

        // Fetch all four endpoints in parallel; each is independently failure-isolated
        const weatherData = await fetchAllForLocation(loc, meta, state.weather[loc.id]);

        updateLocationWeather(loc.id, { ...weatherData, sunTimes });
      } catch (err) {
        // /points itself failed — mark all NWS sources as errored for this location.
        // Sun times are still available since they don't depend on the network.
        const errMsg =
          err instanceof Error ? err.message : "Could not reach NWS";
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
        });
      }
    }),
  );
}

boot();

// Register service worker for offline caching.
// Non-fatal if it fails — the app works fine without it.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Silently ignore — offline support is a progressive enhancement
  });
}
