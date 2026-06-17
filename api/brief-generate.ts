// ---------------------------------------------------------------------------
// Shared brief-generation logic — called by both the cron endpoint and the
// manual-refresh path in /api/brief.
//
// Fetches current NWS + CAIC data server-side (fresh, not from the browser
// cache), builds a compact prompt, calls Claude Haiku, and returns the result.
// The Anthropic API key never leaves this function — it stays in server memory.
// ---------------------------------------------------------------------------

import type { CAICPointForecastRow, NWSAlert, NWSPeriod } from "../src/types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const NWS_BASE      = "https://api.weather.gov";
const CAIC_PROXY    = "https://avalanche.state.co.us/api-proxy/caic_data_api";
const LOOPER_BASE   = "https://looper.avalanche.state.co.us";

// Silverthorne — used for all NWS calls in the brief (one location is enough for a zone-wide summary)
const BRIEF_LAT =  39.619625;
const BRIEF_LON = -106.090422;

// ---------------------------------------------------------------------------
// Compact NWS fetch helpers — the brief only needs condensed data
// ---------------------------------------------------------------------------

interface BriefNWS {
  alerts:  string;
  hourly:  string; // next 48h condensed
  sevenDay: string;
}

async function fetchNWSForBrief(): Promise<BriefNWS> {
  const pointsRes = await fetch(
    `${NWS_BASE}/points/${BRIEF_LAT},${BRIEF_LON}`,
    { headers: { "User-Agent": "weather-dashboard/1.0 (jskraba0601@gmail.com)" }, signal: AbortSignal.timeout(8_000) },
  );
  if (!pointsRes.ok) throw new Error(`NWS /points ${pointsRes.status}`);
  const pointsJson = await pointsRes.json() as { properties: { forecastHourly: string; forecast: string; county: string } };
  const { forecastHourly, forecast, county } = pointsJson.properties;

  // Fetch hourly + 7-day + alerts in parallel
  const countyId = county.split("/").pop() ?? "";
  const [hourlyRes, forecastRes, alertsRes] = await Promise.all([
    fetch(forecastHourly, { headers: { "User-Agent": "weather-dashboard/1.0 (jskraba0601@gmail.com)" }, signal: AbortSignal.timeout(8_000) }),
    fetch(forecast,       { headers: { "User-Agent": "weather-dashboard/1.0 (jskraba0601@gmail.com)" }, signal: AbortSignal.timeout(8_000) }),
    fetch(`${NWS_BASE}/alerts/active?zone=${countyId}`, { headers: { "User-Agent": "weather-dashboard/1.0 (jskraba0601@gmail.com)" }, signal: AbortSignal.timeout(8_000) }),
  ]);

  // Hourly: next 48 periods, condensed to one line each
  let hourlyText = "Unavailable";
  if (hourlyRes.ok) {
    const hj = await hourlyRes.json() as { properties: { periods: NWSPeriod[] } };
    const cutoff = Date.now() + 48 * 3_600_000;
    const periods = hj.properties.periods.filter(p => new Date(p.startTime).getTime() < cutoff);
    hourlyText = periods.map(p => {
      const t = new Date(p.startTime).toLocaleString("en-US", {
        weekday: "short", hour: "numeric", timeZone: "America/Denver",
      });
      const precip = p.probabilityOfPrecipitation?.value;
      return `${t}: ${p.temperature}°F, ${p.shortForecast}${precip ? `, ${precip}% precip` : ""}`;
    }).join("\n");
  }

  // 7-day: one line per period
  let sevenDayText = "Unavailable";
  if (forecastRes.ok) {
    const fj = await forecastRes.json() as { properties: { periods: NWSPeriod[] } };
    sevenDayText = fj.properties.periods.slice(0, 14).map(p =>
      `${p.name}: ${p.temperature}°F, ${p.shortForecast}, wind ${p.windSpeed} ${p.windDirection}`
    ).join("\n");
  }

  // Alerts: event + headline, one per line
  let alertsText = "None";
  if (alertsRes.ok) {
    const aj = await alertsRes.json() as { features: Array<{ properties: NWSAlert }> };
    const active = aj.features.map(f => f.properties).filter(a =>
      !a.expires || new Date(a.expires) > new Date()
    );
    if (active.length > 0) alertsText = active.map(a => `${a.event}: ${a.headline}`).join("\n");
  }

  return { alerts: alertsText, hourly: hourlyText, sevenDay: sevenDayText };
}

interface BriefCAIC {
  summary: string;
  pointForecast: string;
}

async function fetchCAICForBrief(): Promise<BriefCAIC> {
  const summaryUri = encodeURIComponent("/api/v2/zone_weather_forecasts/statewide/current");
  const caicHeaders = {
    "User-Agent": "Mozilla/5.0 (compatible; weather-dashboard/1.0)",
    "Referer": "https://avalanche.state.co.us/",
    "Origin": "https://avalanche.state.co.us",
  };

  const [summaryRes, looperRes] = await Promise.all([
    fetch(`${CAIC_PROXY}?_api_proxy_uri=${summaryUri}`, { headers: caicHeaders, signal: AbortSignal.timeout(8_000) }),
    fetch(
      `${LOOPER_BASE}/iptfcst/ptfcst.php?idate=${new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10)}&res=4&lat=${BRIEF_LAT}&lon=${BRIEF_LON}`,
      { headers: caicHeaders, signal: AbortSignal.timeout(8_000) },
    ),
  ]);

  // Summary: strip HTML tags, truncate to 800 chars
  let summaryText = "Unavailable";
  if (summaryRes.ok) {
    const sj = await summaryRes.json() as Record<string, unknown>;
    const plain = String(sj.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    summaryText = plain.slice(0, 800) + (plain.length > 800 ? "…" : "");
  }

  // Point forecast: next 48h of temp + wind, condensed
  let pointText = "Unavailable";
  if (looperRes.ok) {
    const html = await looperRes.text();
    const rows = parseLooperRows(html);
    const cutoff = Date.now() + 48 * 3_600_000;
    const slice = rows.filter(r => new Date(r.dateTime).getTime() < cutoff);
    pointText = slice.map(r => {
      const t = new Date(r.dateTime).toLocaleString("en-US", {
        weekday: "short", hour: "numeric", timeZone: "America/Denver",
      });
      return `${t}: ${r.tmpF !== null ? Math.round(r.tmpF) + "°F" : "?"}${r.windSpeedMph !== null ? `, wind ${Math.round(r.windSpeedMph)} mph` : ""}`;
    }).join("\n");
  }

  return { summary: summaryText, pointForecast: pointText };
}

// Minimal bracket-counting parser (mirrors api/caic.ts) — duplicated here
// to keep this module self-contained without importing from another api file.
function extractArray(text: string, from: number): string | null {
  const start = text.indexOf("[", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseLooperRows(html: string): CAICPointForecastRow[] {
  const nameIdx = html.indexOf("name: 'Temp'");
  if (nameIdx === -1) return [];
  const dataIdx = html.indexOf("data:", nameIdx);
  if (dataIdx === -1) return [];
  const arr = extractArray(html, dataIdx);
  if (!arr) return [];
  try {
    const raw = JSON.parse(arr) as [number, number | null][];
    return raw.map(([ms, tmpF]) => ({
      dateTime: new Date(ms).toISOString(), tmpF: tmpF ?? null,
      precipIn: null, snowIn: null, windSpeedMph: null, windGustMph: null, windDir: null,
    }));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// buildPrompt — assembles the condensed context sent to Claude
// ---------------------------------------------------------------------------
function buildPrompt(nws: BriefNWS, caic: BriefCAIC): string {
  return `You are a concise weather forecaster for Summit County, Colorado (elevation ~9,000–9,200 ft).

Summarize the forecasts below in 3–5 plain-language sentences. Focus on where NWS and CAIC agree, and note any meaningful differences. Translate numbers into practical terms (e.g. "breezy afternoon", "staying in the 60s"). No markdown, no bullet points — flowing prose only.

NWS ACTIVE ALERTS:
${nws.alerts}

NWS HOURLY FORECAST (next 48h):
${nws.hourly}

NWS 7-DAY FORECAST:
${nws.sevenDay}

CAIC WEATHER SUMMARY:
${caic.summary}

CAIC POINT FORECAST (next 48h at ~9,219 ft):
${caic.pointForecast}`;
}

// ---------------------------------------------------------------------------
// generateBrief — the main export. Fetches data, calls Claude, returns result.
// ---------------------------------------------------------------------------
export interface BriefResult {
  text: string;
  generatedAt: string;
}

export async function generateBrief(): Promise<BriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const [nws, caic] = await Promise.all([
    fetchNWSForBrief().catch(() => ({
      alerts: "Unavailable", hourly: "Unavailable", sevenDay: "Unavailable",
    })),
    fetchCAICForBrief().catch(() => ({
      summary: "Unavailable", pointForecast: "Unavailable",
    })),
  ]);

  const prompt = buildPrompt(nws, caic);

  const aiRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text().catch(() => aiRes.statusText);
    throw new Error(`Anthropic API ${aiRes.status}: ${err}`);
  }

  const aiJson = await aiRes.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const text = aiJson.content.find(b => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Empty response from Claude");

  return { text: text.trim(), generatedAt: new Date().toISOString() };
}
