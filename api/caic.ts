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
//   1. Weather Summary write-up (JSON array, statewide)
//      https://avalanche.state.co.us/api-proxy/caic_data_api
//        ?_api_proxy_uri=/api/v2/zone_weather_forecasts/statewide/current
//      We filter the statewide array for the Vail & Summit County zone,
//      which covers both Silverthorne and Frisco.
//
//   2. Point-forecast time-series
//      https://looper.avalanche.state.co.us/iptfcst/ptfcst.php
//        ?idate=YYYY-MM-DD&res=4&lat=...&lon=...
//      A time-series of temperature, precipitation, snowfall, and wind.
//      Used by the overlay chart (workstream 6).
//
// The response is cached at the CDN edge for 15 minutes (s-maxage=900) with a
// 30-minute stale-while-revalidate window so stale data is served instantly
// while a fresh fetch happens in the background.
//
// Security: any HTML body content is stripped of <script> tags and on*
// attributes server-side before being sent to the browser.
// ---------------------------------------------------------------------------

type Req = { method?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// CAIC API proxy — discovered from network inspection of avalanche.state.co.us/weather.
const CAIC_PROXY = "https://avalanche.state.co.us/api-proxy/caic_data_api";

// Point-forecast server — separate host from the main site.
const LOOPER_BASE = "https://looper.avalanche.state.co.us";

// Zone keywords to match against the statewide feed for Vail & Summit County.
// We match loosely so a minor label change doesn't lose the zone entirely.
const ZONE_KEYWORDS = ["vail", "summit"];

// Elevation point near Silverthorne used for the point-forecast grid cell.
const POINT_LAT = 39.619625;
const POINT_LON = -106.090422;

// Headers that mimic a browser referer so CAIC's proxy allows server-side requests.
const CAIC_HEADERS: HeadersInit = {
  "User-Agent": "weather-dashboard/1.0 (personal app; jskraba0601@gmail.com)",
  "Referer": "https://avalanche.state.co.us/",
  "Origin": "https://avalanche.state.co.us",
};

// Strip <script> blocks and inline event handlers from untrusted HTML.
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

// Extract the "Issued by / Day, Date, Time" freshness line from HTML or plain text.
function extractIssuedBy(text: string): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const m1 = plain.match(/Issued by[^/]+\/[^/\n]+(,\s*\d{1,2}:\d{2}\s*(?:AM|PM)[^.\n]*)?/i);
  if (m1) return m1[0].trim();

  const m2 = plain.match(/Issued:\s*[^\n.]+/i);
  if (m2) return m2[0].trim();

  return "";
}

// Fetch the statewide zone weather forecast and find the Vail & Summit zone.
// Returns the raw response alongside the matched zone so the caller can
// log the shape if zone matching fails — helps diagnose future feed changes.
async function fetchSummary(): Promise<{ issuedBy: string; bodyHtml: string; rawZone: unknown }> {
  const uri = encodeURIComponent("/api/v2/zone_weather_forecasts/statewide/current");
  const res = await fetch(`${CAIC_PROXY}?_api_proxy_uri=${uri}`, {
    headers: CAIC_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC summary HTTP ${res.status}`);

  const json = await res.json() as unknown;

  // The statewide feed is expected to be an array of zone forecast objects.
  // Find the one whose name/id matches Vail & Summit County.
  let zone: Record<string, unknown> | null = null;
  if (Array.isArray(json)) {
    zone = (json as Array<Record<string, unknown>>).find((z) => {
      const name = String(z.zone_name ?? z.name ?? z.id ?? "").toLowerCase();
      return ZONE_KEYWORDS.some((kw) => name.includes(kw));
    }) ?? null;
  }

  // If we couldn't find the zone, surface the raw response so we can diagnose.
  if (!zone) {
    throw new Error(
      `CAIC zone not found. Keys in response: ${
        Array.isArray(json)
          ? (json as Array<Record<string, unknown>>).map((z) =>
              String(z.zone_name ?? z.name ?? z.id ?? "?")
            ).join(", ")
          : typeof json
      }`
    );
  }

  // The write-up body may be in various fields depending on feed version.
  const rawBody = String(
    zone.weather_summary ?? zone.product_body ?? zone.body ?? zone.forecast_body ?? ""
  );
  const bodyHtml = sanitiseHtml(rawBody);
  const issuedBy = extractIssuedBy(rawBody) || String(zone.issued_by ?? zone.forecaster ?? "");

  return { issuedBy, bodyHtml, rawZone: zone };
}

// Fetch the point-forecast time-series from looper.avalanche.state.co.us.
// Format discovered from CAIC's interactive weather map.
async function fetchPointForecast(): Promise<Array<Record<string, unknown>>> {
  // idate must be today's date in YYYY-MM-DD (Mountain Time approximation via UTC-6).
  const today = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);

  const url =
    `${LOOPER_BASE}/iptfcst/ptfcst.php` +
    `?idate=${today}&res=4&lat=${POINT_LAT}&lon=${POINT_LON}`;

  const res = await fetch(url, {
    headers: CAIC_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC point-forecast HTTP ${res.status}`);

  const json = await res.json() as unknown;

  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;

  // Highcharts pivot format: {series: [{name, data:[...]}, ...], xAxis: {categories: [...]}}
  const obj = json as Record<string, unknown>;
  if (obj.series && obj.xAxis) {
    const categories = (obj.xAxis as { categories?: string[] }).categories ?? [];
    const series = obj.series as Array<{ name: string; data: (number | null)[] }>;
    return categories.map((dt, idx) => {
      const row: Record<string, unknown> = { dateTime: dt };
      for (const s of series) row[s.name] = s.data[idx] ?? null;
      return row;
    });
  }

  throw new Error("CAIC point-forecast: unexpected response shape");
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
