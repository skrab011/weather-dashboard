// ---------------------------------------------------------------------------
// Application state store — a single mutable AppState object with a simple
// pub/sub notification system. No framework, no signals; just a plain object
// and a list of subscriber functions that are called on every mutation.
//
// All state mutations go through the exported setters so subscribers are
// always notified. Direct mutation of `state` bypasses notifications and
// should be avoided outside this file.
// ---------------------------------------------------------------------------

import type {
  AppState,
  CAICZoneData,
  LocationAirQuality,
  LocationWeather,
  NWSAlert,
  NWSGridpoint,
  NWSPeriod,
  SourceResult,
  ViewMode,
} from "./types";
import { LOCATIONS } from "./locations";

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
  };
}

// CAIC starts in loading state — both sub-results are empty.
function emptyCAICZoneData(): CAICZoneData {
  return {
    summary:       emptyResult(),
    pointForecast: emptyResult(),
  };
}

// The single application state object. Mutated in place by the setters below.
export const state: AppState = {
  activeLocation: 0,
  activeView: "hourly",
  weather: {
    [LOCATIONS[0].id]: emptyLocationWeather(),
    [LOCATIONS[1].id]: emptyLocationWeather(),
  },
  caic: emptyCAICZoneData(),
};

// Subscribers are called synchronously after every state mutation.
// render.ts registers one subscriber (the renderAll function) at boot.
const subscribers: Array<() => void> = [];

export function subscribe(fn: () => void): void {
  subscribers.push(fn);
}

function notify(): void {
  for (const fn of subscribers) fn();
}

export function setActiveLocation(index: 0 | 1): void {
  state.activeLocation = index;
  notify();
}

export function setActiveView(view: ViewMode): void {
  state.activeView = view;
  notify();
}

// Merges new weather data for a location and triggers a re-render.
// Called after each fetchAllForLocation() resolves.
export function updateLocationWeather(
  locationId: string,
  weather: LocationWeather,
): void {
  state.weather[locationId] = weather;
  notify();
}

// Replaces CAIC zone data and triggers a re-render.
// Called once at boot after the CAIC fetch resolves (or fails).
export function updateCAIC(data: CAICZoneData): void {
  state.caic = data;
  notify();
}
