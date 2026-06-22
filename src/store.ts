// ---------------------------------------------------------------------------
// Personal page (V1) store — a single instance of the shared store factory,
// seeded with the two fixed locations.
//
// The store logic lives in src/shared/store.ts so the personal and shared pages
// share one implementation. This file just instantiates it for V1 and re-exports
// the instance's members under the same names the rest of V1 already imports, so
// main.ts and render.ts are untouched by the factory refactor.
// ---------------------------------------------------------------------------

import { createStore } from "./shared/store";
import { LOCATIONS } from "./locations";

const store = createStore(LOCATIONS);

export const state = store.state;
export const subscribe = store.subscribe;
export const setActiveLocation = store.setActiveLocation;
export const setActiveView = store.setActiveView;
export const setActiveChartVar = store.setActiveChartVar;
export const updateLocationWeather = store.updateLocationWeather;
export const updateCAIC = store.updateCAIC;
export const updateTomer = store.updateTomer;
export const updateBrief = store.updateBrief;
