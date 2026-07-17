// ---------------------------------------------------------------------------
// Store factory — builds an application-state object with a simple pub/sub
// notification system, seeded with an arbitrary list of locations.
//
// No framework, no signals; just a plain object and a list of subscriber
// functions called on every mutation. All state mutations go through the
// returned setters so subscribers are always notified. Direct mutation of
// `state` bypasses notifications and should be avoided.
//
// The personal page (V1) creates one store seeded with its two fixed locations
// (see src/store.ts); the shared page (V2) creates one seeded with the user's
// chosen locations. The store logic lives here once so the two pages can't
// drift apart.
// ---------------------------------------------------------------------------

import type {
  AppState,
  CAICZoneData,
  ChartVar,
  ConsensusBrief,
  CurrentWind,
  HourlyVar,
  Location,
  LocationAirQuality,
  LocationWeather,
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  OpenMeteoForecast,
  SourceResult,
  TomerVideo,
  ViewMode,
} from "./types";

// An empty SourceResult represents the "loading" state:
// data is absent, no error has occurred, no timestamp yet.
function emptyResult<T>(): SourceResult<T> {
  return {
    data: null,
    error: null,
    lastUpdated: null,
    lastGoodData: null,
    lastGoodUpdated: null,
  };
}

// Empty weather for one location — all sources start in loading state.
function emptyLocationWeather(): LocationWeather {
  return {
    forecast:   emptyResult<NWSPeriod[]>(),
    hourly:     emptyResult<NWSPeriod[]>(),
    gridpoint:  emptyResult<NWSGridpoint>(),
    alerts:     emptyResult<NWSAlert[]>(),
    sunTimes:   null,
    airQuality: emptyResult<LocationAirQuality>(),
    openMeteo:  emptyResult<OpenMeteoForecast[]>(),
    currentWind: emptyResult<CurrentWind>(),
  };
}

// CAIC starts in loading state — both sub-results are empty.
function emptyCAICZoneData(): CAICZoneData {
  return {
    summary:       emptyResult(),
    pointForecast: emptyResult(),
  };
}

// The public surface of a store instance — the state object plus the setters
// that mutate it and notify subscribers.
export interface Store {
  state: AppState;
  subscribe(fn: () => void): void;
  setActiveLocation(index: number): void;
  setActiveView(view: ViewMode): void;
  setActiveChartVar(variable: ChartVar): void;
  setActiveHourlyVar(variable: HourlyVar): void;
  updateLocationWeather(locationId: string, weather: LocationWeather): void;
  updateCAIC(data: CAICZoneData): void;
  updateTomer(data: SourceResult<TomerVideo>): void;
  updateBrief(data: SourceResult<ConsensusBrief>): void;
}

// Create a fresh store seeded with the given locations. Each location gets its
// own empty LocationWeather entry, keyed by Location.id.
export function createStore(locations: Location[]): Store {
  const weather: Record<string, LocationWeather> = {};
  for (const loc of locations) {
    weather[loc.id] = emptyLocationWeather();
  }

  const state: AppState = {
    activeLocation: 0,
    activeView: "hourly",
    activeChartVar: "temp",
    activeHourlyVar: "temp",
    weather,
    caic:  emptyCAICZoneData(),
    tomer: emptyResult<TomerVideo>(),
    brief: emptyResult<ConsensusBrief>(),
  };

  // Subscribers are called synchronously after every state mutation.
  // The render layer registers one subscriber (renderAll) at boot.
  const subscribers: Array<() => void> = [];

  function notify(): void {
    for (const fn of subscribers) fn();
  }

  return {
    state,

    subscribe(fn: () => void): void {
      subscribers.push(fn);
    },

    setActiveLocation(index: number): void {
      state.activeLocation = index as AppState["activeLocation"];
      notify();
    },

    setActiveView(view: ViewMode): void {
      state.activeView = view;
      notify();
    },

    setActiveChartVar(variable: ChartVar): void {
      state.activeChartVar = variable;
      notify();
    },

    setActiveHourlyVar(variable: HourlyVar): void {
      state.activeHourlyVar = variable;
      notify();
    },

    // Merges new weather data for a location and triggers a re-render.
    // Called after each fetchAllForLocation() resolves.
    updateLocationWeather(locationId: string, w: LocationWeather): void {
      state.weather[locationId] = w;
      notify();
    },

    // Replaces CAIC zone data and triggers a re-render.
    updateCAIC(data: CAICZoneData): void {
      state.caic = data;
      notify();
    },

    // Replaces Tomer video data and triggers a re-render.
    updateTomer(data: SourceResult<TomerVideo>): void {
      state.tomer = data;
      notify();
    },

    // Replaces consensus brief data and triggers a re-render.
    updateBrief(data: SourceResult<ConsensusBrief>): void {
      state.brief = data;
      notify();
    },
  };
}
