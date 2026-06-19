// Single source of truth for the two locations the personal page (V1) serves.
// Referenced by the NWS fetch layer, the sun-time calculator, and the render layer.
// The Location type now lives in the shared engine (src/shared/types.ts) so the
// shared page (V2) can reuse it with its own user-chosen locations.

import type { Location } from "./shared/types";

export const LOCATIONS: [Location, Location] = [
  {
    id: "home",
    label: "Home",
    lat: 39.619625,
    lon: -106.090422,
  },
  {
    id: "office",
    label: "Frisco",
    lat: 39.576179,
    lon: -106.09718,
  },
];
