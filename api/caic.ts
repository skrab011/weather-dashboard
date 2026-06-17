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
//   1. Weather Summary write-up (HTML)
//      https://avalanche.state.co.us/api-proxy/avid?_api_proxy_uri=/api/products/...
//      Zone: VAI (Vail & Summit County) — covers both Silverthorne and Frisco.
//
//   2. Point-forecast Highcharts JSON
//      https://avalanche.state.co.us/api-proxy/avid?_api_proxy_uri=/api/mountain-weather/...
//      A time-series of temperature, precipitation, snowfall, and wind values.
//
// The response is cached at the CDN edge for 15 minutes (s-maxage=900) with a
// 30-minute stale-while-revalidate window so stale data is served instantly
// while a fresh fetch happens in the background.
//
// Security: the HTML body is stripped of <script> tags and on* attributes
// server-side so it can be safely rendered as innerHTML in the browser.
// ---------------------------------------------------------------------------

type Req = { method?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// CAIC API proxy base URL — all requests go through their public API proxy.
const CAIC_BASE = "https://avalanche.state.co.us/api-proxy/avid";

// Zone identifier for Vail & Summit County (covers both our locations).
const ZONE_ID = "VAI";

// Elevation point near Silverthorne used for the point-forecast feed.
// CAIC's point-forecast is grid-based; this puts us in the right grid cell.
const POINT_LAT = 39.619625;
const POINT_LON = -106.090422;

// Strip <script> blocks and inline event handlers from untrusted HTML before
// sending it to the browser. This is a belt-and-suspenders measure since
// CAIC is a government site, but the feed is undocumented and could change.
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

// Extract the "Issued by / Day, Date, Time" freshness line from the HTML body.
// CAIC writes this as the first non-empty line or in a recognisable pattern.
// We try several patterns so a minor format change doesn't lose it entirely.
function extractIssuedBy(html: string): string {
  // Strip all tags to get plain text for the regex search
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Pattern 1: "Issued by <name> / <day>, <date>, <time>"
  const m1 = text.match(/Issued by[^/]+\/[^/\n]+(,\s*\d{1,2}:\d{2}\s*(?:AM|PM)[^.\n]*)?/i);
  if (m1) return m1[0].trim();

  // Pattern 2: "Issued: <date/time>"
  const m2 = text.match(/Issued:\s*[^\n.]+/i);
  if (m2) return m2[0].trim();

  // Fallback: let the UI show nothing rather than show garbage
  return "";
}

// Fetch the CAIC Weather Summary write-up for the Vail & Summit zone.
async function fetchSummary(): Promise<{ issuedBy: string; bodyHtml: string }> {
  const uri = encodeURIComponent(
    `/api/products/all-products?zone_id=${ZONE_ID}&type=weather_summary&published=1`
  );
  const res = await fetch(`${CAIC_BASE}?_api_proxy_uri=${uri}`, {
    headers: { "User-Agent": "weather-dashboard/1.0 (personal app; jskraba0601@gmail.com)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC summary HTTP ${res.status}`);

  const json = await res.json() as Array<{ product_body?: string; body?: string }>;

  // The feed returns an array; we want the first (most recent) entry.
  const raw = (json[0]?.product_body ?? json[0]?.body ?? "") as string;
  const bodyHtml = sanitiseHtml(raw);
  const issuedBy = extractIssuedBy(raw);

  return { issuedBy, bodyHtml };
}

// Fetch the CAIC point-forecast Highcharts JSON for our lat/lon.
// The feed returns an object with series arrays keyed by field name.
// We normalise it into a flat array of rows for the overlay chart (WS6).
async function fetchPointForecast(): Promise<Array<Record<string, unknown>>> {
  const uri = encodeURIComponent(
    `/api/mountain-weather/point-forecast?lat=${POINT_LAT}&lon=${POINT_LON}`
  );
  const res = await fetch(`${CAIC_BASE}?_api_proxy_uri=${uri}`, {
    headers: { "User-Agent": "weather-dashboard/1.0 (personal app; jskraba0601@gmail.com)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CAIC point-forecast HTTP ${res.status}`);

  const json = await res.json() as unknown;

  // If CAIC returns a flat array of row objects, pass through as-is.
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;

  // If CAIC returns Highcharts-style {series: [{name, data:[...]}, ...], xAxis: {categories: [...]}},
  // pivot it into row objects. This is the format observed in 2024/2025.
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
  // Aggressive CDN caching: serve stale immediately while refreshing in background.
  // 15-minute fresh window is appropriate for mountain weather data.
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");

  // Fetch both endpoints in parallel; isolate failures from each other.
  const [summaryResult, pointResult] = await Promise.allSettled([
    fetchSummary(),
    fetchPointForecast(),
  ]);

  res.status(200).json({
    // Summary fields (null on failure, error string explains why)
    issuedBy:     summaryResult.status === "fulfilled" ? summaryResult.value.issuedBy  : null,
    bodyHtml:     summaryResult.status === "fulfilled" ? summaryResult.value.bodyHtml   : null,
    summaryError: summaryResult.status === "rejected"
      ? (summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason))
      : null,

    // Point-forecast (null on failure)
    pointForecast:      pointResult.status === "fulfilled" ? pointResult.value : null,
    pointForecastError: pointResult.status === "rejected"
      ? (pointResult.reason instanceof Error ? pointResult.reason.message : String(pointResult.reason))
      : null,

    fetchedAt: new Date().toISOString(),
  });
}
