// ---------------------------------------------------------------------------
// Inline SVG weather icons for the hourly strip.
//
// The NWS icon PNGs (api.weather.gov/icons/…) clash with the app's minimal
// dark design, so the hourly card draws its own line-art icons instead —
// stroke-based 24×24 glyphs in the style of the Lucide icon set (ISC
// licensed), colored via currentColor so CSS controls the tint. Bonus: no
// cross-origin image requests, so the card renders instantly and can't be
// affected by NWS image-server outages.
//
// Glyph choice: the NWS icon URL encodes a condition code (e.g.
// ".../day/rain_showers,30"), which we pattern-match in priority order —
// precipitation codes outrank sky-cover codes so a "sct/rain" dual icon
// resolves to rain. If the URL yields nothing (format change, missing icon),
// we fall back to keywords in shortForecast, then to a plain cloud. Day/night
// (sun vs. moon variants) comes from the period's own isDaytime flag.
// ---------------------------------------------------------------------------

import type { NWSPeriod } from "./types";

// Resolved glyph names. "clear" and "partly" are placeholders that split into
// day/night variants at render time.
type Glyph =
  | "sun" | "moon" | "cloud-sun" | "cloud-moon" | "cloud"
  | "fog" | "wind" | "rain" | "drizzle" | "snow" | "mix" | "storm";

// SVG path data per glyph (24×24 viewBox, 2px stroke).
const GLYPH_PATHS: Record<Glyph, string[]> = {
  sun: [
    "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41",
    "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41",
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  ],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  "cloud-sun": [
    "M12 2v2", "m4.93 4.93 1.41 1.41", "M20 12h2", "m19.07 4.93-1.41 1.41",
    "M15.947 12.65a4 4 0 0 0-5.925-4.128",
    "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z",
  ],
  "cloud-moon": [
    "M10.1 9A6 6 0 0 1 16 4a4.24 4.24 0 0 0 6 6 6 6 0 0 1-3 5.197",
    "M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z",
  ],
  cloud: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
  fog: [
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M16 17H7", "M17 21H9",
  ],
  wind: [
    "M12.8 19.6A2 2 0 1 0 14 16H2",
    "M17.5 8a2.5 2.5 0 1 1 2 4H2",
    "M9.8 4.4A2 2 0 1 1 11 8H2",
  ],
  rain: [
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M16 14v6", "M8 14v6", "M12 16v6",
  ],
  drizzle: [
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M8 19v1", "M8 14v1", "M16 19v1", "M16 14v1", "M12 21v1", "M12 16v1",
  ],
  snow: [
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M8 15h.01", "M8 19h.01", "M12 17h.01", "M12 21h.01", "M16 15h.01", "M16 19h.01",
  ],
  mix: [
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M16 14v2", "M8 14v2", "M12 16v2", "M16 20h.01", "M8 20h.01", "M12 22h.01",
  ],
  storm: [
    "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973",
    "m13 12-3 5h4l-3 5",
  ],
};

// NWS condition-code patterns, checked in priority order (first match wins).
// Weather outranks sky cover so dual-condition URLs resolve to the weather.
const CODE_GLYPHS: Array<[RegExp, Glyph | "clear" | "partly"]> = [
  [/tsra|tornado|hurricane|tropical/, "storm"],
  [/blizzard/, "snow"],
  [/rain_snow|rain_sleet|snow_sleet|fzra|sleet/, "mix"],
  [/snow/, "snow"],
  [/rain_showers/, "drizzle"],
  [/rain/, "rain"],
  [/fog|smoke|haze|dust/, "fog"],
  [/wind/, "wind"],
  [/ovc|bkn/, "cloud"],
  [/few|sct/, "partly"],
  [/skc|hot|cold/, "clear"],
];

// shortForecast keyword fallback, same priority idea.
const TEXT_GLYPHS: Array<[RegExp, Glyph | "clear" | "partly"]> = [
  [/thunder/i, "storm"],
  [/sleet|freezing|wintry/i, "mix"],
  [/snow|flurr/i, "snow"],
  [/shower|drizzle/i, "drizzle"],
  [/rain/i, "rain"],
  [/fog|haze|smoke|dust/i, "fog"],
  [/wind|breezy|blustery/i, "wind"],
  [/overcast|cloudy/i, "cloud"],
  [/partly|mostly (sunny|clear)/i, "partly"],
  [/sunny|clear/i, "clear"],
];

function resolveGlyph(period: NWSPeriod): Glyph {
  // The condition portion of the icon URL: everything after /day/ or /night/
  // up to the query string, e.g. "sct/rain_showers,40".
  const conditions = period.icon?.split(/\/(?:day|night)\//)[1]?.split("?")[0] ?? "";

  let match: Glyph | "clear" | "partly" | null = null;
  for (const [re, glyph] of CODE_GLYPHS) {
    if (re.test(conditions)) { match = glyph; break; }
  }
  if (!match) {
    for (const [re, glyph] of TEXT_GLYPHS) {
      if (re.test(period.shortForecast)) { match = glyph; break; }
    }
  }
  if (!match) return "cloud";
  if (match === "clear")  return period.isDaytime ? "sun" : "moon";
  if (match === "partly") return period.isDaytime ? "cloud-sun" : "cloud-moon";
  return match;
}

// Returns the full icon markup for one hourly period. The wrapping span
// carries the accessible label (replacing the old <img alt>); the SVG itself
// is decorative.
export function weatherIcon(period: NWSPeriod): string {
  const paths = GLYPH_PATHS[resolveGlyph(period)]
    .map((d) => `<path d="${d}"/>`)
    .join("");
  return `
    <span class="hour-icon" role="img" aria-label="${period.shortForecast}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>
    </span>`;
}
