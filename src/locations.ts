// Single source of truth for the two locations this app serves.
// Referenced by the NWS fetch layer, the sun-time calculator, and the render layer.

export interface Location {
  id: string;    // used as a key in state.weather and as a data attribute in the DOM
  label: string; // displayed in the tab bar
  lat: number;
  lon: number;
}

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
