// ---------------------------------------------------------------------------
// /api/caic — CAIC Weather Summary + point-forecast proxy.
//
// CAIC's endpoints are undocumented and not guaranteed stable. This function
// is the only place CAIC-specific fetch logic lives; if the feed changes,
// only this file needs updating.
//
// Two endpoints are fetched in parallel and reported independently so a
// failure in one never suppresses the other:
//
//   1. Weather Summary write-up (single JSON object, statewide)
//      https://avalanche.state.co.us/api-proxy/caic_data_api
//        ?_api_proxy_uri=/api/v2/zone_weather_forecasts/statewide/current
//      Returns one object with: id, type, zones, body, issued_at, issuer, …
//      The write-up is in `body`; freshness comes from `issued_at` + `issuer`.
//
//   2. Point-forecast time-series (HTML page embedding Highcharts)
//      https://looper.avalanche.state.co.us/iptfcst/ptfcst.php
//        ?idate=YYYY-MM-DD&res=4&lat=...&lon=...
//      Returns an HTML page; we extract the Highcharts series JSON from the
//      embedded <script> block and pivot it into row objects.
//
// The response is cached at the CDN edge for 15 minutes (s-maxage=900) with a
// 30-minute stale-while-revalidate window so stale data is served instantly
// while a fresh fetch happens in the background.
//
// Security: the write-up body is stripped of <script> tags and on* attributes
// server-side before being sent to the browser.
// ---------------------------------------------------------------------------

type Req = { method?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// CAIC API proxy — discovered from network inspection of avalanche.state.co.us/weather.
const CAIC_PROXY = "https://avalanche.state.co.us/api-proxy/caic_data_api";

// Point-forecast server — separate host from the main CAIC site.
const LOOPER_BASE = "https://looper.avalanche.state.co.us";

// Elevation point near Silverthorne used for the point-forecast grid cell.
const POINT_LAT = 39.619625;
const POINT_LON = -106.090422;

// Headers that mimic a browser request so CAIC's servers allow server-side calls.
const CAIC_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (compatible; weather-dashboard/1.0; +https://github.com/skrab011/weather-dashboard)",
  "Referer": "https://avalanche.state.co.us/",
  "Origin": "https://avalanche.state.co.us",
};

// Strip <script> blocks and inline event handlers from untrusted HTML.
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

// Format an ISO timestamp as a human-readable "Issued by / Day, Date, Time" line.
// Falls back to extracting a pattern from the body text if structured fields aren't useful.
function buildIssuedBy(issuedAt: string | null, issuer: unknown, bodyText: string): string {
  // issuer may be a plain string or an object like {name: "...", id: ...}
  const issuerName =
    typeof issuer === "string" ? issuer
    : issuer && typeof issuer === "object"
      ? String(
          (issuer as Record<string, unknown>).name ??
          (issuer as Record<string, unknown>).full_name ??
          (issuer as Record<string, unknown>).username ??
          ""
        )
      : "";

  // Use structured issued_at timestamp if present — most reliable
  if (issuedAt) {
    const dt = new Date(issuedAt);
    const formatted = dt.toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
      timeZone: "America/Denver",
    });
    return issuerName ? `Issued by ${issuerName} / ${formatted}` : `Issued ${formatted}`;
  }

  // Fall back to scanning the body text for an "Issued by …" line
  const plain = bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const m = plain.match(/Issued by[^/]+\/[^\n.]+/i) ?? plain.match(/Issued:\s*[^\n.]+/i);
  return m ? m[0].trim() : "";
}

// Fetch the statewide zone weather forecast object.
// Response shape (confirmed): { id, type, zones, body, issued_at, issuer, … }
async function fetchSummary(): Promise<{ issuedBy: string; bodyHtml: string }> {
  const uri = encodeURIComponent("/api/v2/zone_weather_forecasts/statewide/current");
  const res = await fetch(`${CAIC_PROXY}?_api_proxy_uri=${uri}`, {
    headers: CAIC_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC summary HTTP ${res.status}`);

  const json = await res.json() as Record<string, unknown>;

  // `body` holds the write-up HTML; `issued_at` and `issuer` give freshness.
  const rawBody = String(json.body ?? "");
  if (!rawBody) {
    throw new Error(
      `CAIC summary: body field empty. Available keys: ${Object.keys(json).join(", ")}`
    );
  }

  const bodyHtml = sanitiseHtml(rawBody);
  const issuedBy = buildIssuedBy(
    json.issued_at as string | null,
    json.issuer,
    rawBody,
  );

  return { issuedBy, bodyHtml };
}

// Extract a balanced bracket-delimited array from `text` starting at `fromIndex`.
// Uses bracket counting so nested arrays are handled correctly.
function extractArray(text: string, fromIndex: number): string | null {
  const start = text.indexOf("[", fromIndex);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// Find and parse the `data` array for the named Highcharts series.
// Series in the looper page use datetime x-axis: data: [[timestampMs, value], ...]
function findSeriesData(html: string, name: string): [number, number | null][] | null {
  const nameToken = `name: '${name}'`;
  const nameIdx = html.indexOf(nameToken);
  if (nameIdx === -1) return null;
  const dataKeyIdx = html.indexOf("data:", nameIdx);
  if (dataKeyIdx === -1) return null;
  // Sanity check: make sure we haven't jumped into the next series block
  const nextNameIdx = html.indexOf("name:", nameIdx + nameToken.length);
  if (nextNameIdx !== -1 && dataKeyIdx > nextNameIdx) return null;
  const arrayStr = extractArray(html, dataKeyIdx);
  if (!arrayStr) return null;
  try { return JSON.parse(arrayStr) as [number, number | null][]; } catch { return null; }
}

// Parse the looper point-forecast HTML page.
// All Highcharts series are inlined in a <script> block; no AJAX calls.
// X axis is datetime. Despite looking like UTC Unix ms, the looper encodes
// Mountain local time (Highcharts useUTC:false) — add 6h to correct to UTC.
const LOOPER_UTC_OFFSET_MS = 6 * 3_600_000; // MDT = UTC−6

function parseLooperHtml(html: string): Array<Record<string, unknown>> {
  const elevMatch = html.match(/var\s+elev\s*=\s*([\d.]+)/);
  const elevFt = elevMatch ? parseFloat(elevMatch[1]) : null;

  const tempData = findSeriesData(html, "Temp");
  if (!tempData || tempData.length === 0) {
    throw new Error("CAIC point-forecast: Temp series not found in page HTML");
  }

  const windData  = findSeriesData(html, "Wind Speed");
  const gustData  = findSeriesData(html, "Gust");
  const precipData = findSeriesData(html, "Precip");
  const snowData  = findSeriesData(html, "Snow");

  return tempData.map(([timestampMs, tmpF], i) => ({
    dateTime:     new Date(timestampMs + LOOPER_UTC_OFFSET_MS).toISOString(),
    tmpF:         tmpF ?? null,
    windSpeedMph: windData?.[i]?.[1] ?? null,
    windGustMph:  gustData?.[i]?.[1] ?? null,
    precipIn:     precipData?.[i]?.[1] ?? null,
    snowIn:       snowData?.[i]?.[1] ?? null,
    windDir:      null,
    elevFt,
  }));
}

// Fetch the point-forecast HTML page and extract the embedded series data.
async function fetchPointForecast(): Promise<Array<Record<string, unknown>>> {
  const today = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const url =
    `${LOOPER_BASE}/iptfcst/ptfcst.php` +
    `?idate=${today}&res=4&lat=${POINT_LAT}&lon=${POINT_LON}`;

  const res = await fetch(url, {
    headers: CAIC_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC point-forecast HTTP ${res.status}`);

  const html = await res.text();
  return parseLooperHtml(html);
}

export default async function handler(_req: Req, res: Res): Promise<void> {
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");

  const [summaryResult, pointResult] = await Promise.allSettled([
    fetchSummary(),
    fetchPointForecast(),
  ]);

  res.status(200).json({
    issuedBy: summaryResult.status === "fulfilled" ? summaryResult.value.issuedBy : null,
    bodyHtml: summaryResult.status === "fulfilled" ? summaryResult.value.bodyHtml : null,
    summaryError: summaryResult.status === "rejected"
      ? (summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason))
      : null,

    pointForecast: pointResult.status === "fulfilled" ? pointResult.value : null,
    pointForecastError: pointResult.status === "rejected"
      ? (pointResult.reason instanceof Error ? pointResult.reason.message : String(pointResult.reason))
      : null,

    fetchedAt: new Date().toISOString(),
  });
}
