// ---------------------------------------------------------------------------
// Client-side sunrise / sunset calculation.
//
// NWS has no sun-times endpoint, so we calculate locally from lat/lon + date.
// Algorithm: NOAA Solar Calculator equations (Spencer/Fourier series).
// Accuracy: within ~1 minute for latitudes between 70°N and 70°S.
// Source: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
// ---------------------------------------------------------------------------

import type { SunTimes } from "./types";

export function calcSunTimes(lat: number, lon: number, date: Date): SunTimes {
  const doy = dayOfYear(date);

  // Fractional year in radians. Using UTC hour keeps this timezone-agnostic.
  const gamma =
    ((2 * Math.PI) / 365) *
    (doy - 1 + (date.getUTCHours() - 12) / 24);

  // Equation of time in minutes — correction for Earth's elliptical orbit
  // and axial tilt, which cause the Sun to appear slightly ahead or behind
  // a perfectly uniform 24-hour clock throughout the year.
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.04089 * Math.sin(2 * gamma));

  // Solar declination in radians — the angle between the Sun and Earth's equator.
  // Drives the seasonal variation in day length.
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latRad = (lat * Math.PI) / 180;

  // Hour angle at sunrise/sunset.
  // 90.833° (not 90°) accounts for atmospheric refraction at the horizon and
  // the angular size of the Sun's disk — this is the standard NOAA correction.
  const cosHA =
    Math.cos((90.833 * Math.PI) / 180) /
      (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl);

  // Clamp to [-1, 1] to guard against floating-point drift at extreme latitudes
  // (polar day/night); at Colorado's latitude this should never be needed.
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHA)));
  const haDeg = (ha * 180) / Math.PI;

  // Sunrise and sunset in minutes past UTC midnight.
  // The formula: solar noon is at 720 min (12:00 UTC adjusted for longitude and eqtime).
  const sunriseMins = 720 - 4 * (lon + haDeg) - eqtime;
  const sunsetMins  = 720 - 4 * (lon - haDeg) - eqtime;

  // Convert minutes-past-UTC-midnight to Date objects.
  // toLocaleTimeString() in the browser will render these in the user's local timezone.
  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  return {
    sunrise: new Date(utcMidnight + sunriseMins * 60_000),
    sunset:  new Date(utcMidnight + sunsetMins  * 60_000),
  };
}

// Day of year (1–365, or 1–366 in a leap year)
function dayOfYear(date: Date): number {
  const yearStart = Date.UTC(date.getFullYear(), 0, 0);
  const today     = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - yearStart) / 86_400_000);
}
