// ---------------------------------------------------------------------------
// GET /api/brief — generates and caches the AI consensus brief.
//
// Normal page loads: reads the cached blob (fast, no AI call).
// Manual refresh:    ?refresh=true triggers a fresh generation and re-caches.
// All generation logic lives in this single file to avoid inter-api imports
// which Vercel's bundler does not handle reliably.
// ---------------------------------------------------------------------------

type Req = { method?: string; query?: Record<string, string | string[]> };
type Res = { status: (c: number) => Res; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

// ---------------------------------------------------------------------------
// Inline types
// ---------------------------------------------------------------------------
interface NWSPeriod { startTime: string; temperature: number; shortForecast: string; windSpeed: string; windDirection: string; name: string; probabilityOfPrecipitation?: { value: number | null } }
interface NWSAlert  { event: string; headline: string; expires?: string }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const NWS_BASE      = "https://api.weather.gov";
const CAIC_PROXY    = "https://avalanche.state.co.us/api-proxy/caic_data_api";
const LOOPER_BASE   = "https://looper.avalanche.state.co.us";
const BRIEF_LAT     =  39.619625;
const BRIEF_LON     = -106.090422;
const NWS_UA        = "weather-dashboard/1.0 (jskraba0601@gmail.com)";
const CAIC_HEADERS  = { "User-Agent": "Mozilla/5.0 (compatible; weather-dashboard/1.0)", "Referer": "https://avalanche.state.co.us/", "Origin": "https://avalanche.state.co.us" };
const BLOB_NAME     = "consensus-brief.json";

// ---------------------------------------------------------------------------
// Blob helpers — gracefully skip if BLOB_READ_WRITE_TOKEN is not set
// ---------------------------------------------------------------------------
export interface BriefResult { text: string; generatedAt: string }

async function readCached(): Promise<BriefResult | null> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return null;
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: "consensus-brief", token });
    if (blobs.length === 0) return null;
    const r = await fetch(blobs[0].url);
    if (!r.ok) return null;
    return r.json() as Promise<BriefResult>;
  } catch { return null; }
}

async function writeCached(result: BriefResult): Promise<void> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return;
    const { put } = await import("@vercel/blob");
    await put(BLOB_NAME, JSON.stringify(result), { access: "public", addRandomSuffix: false, contentType: "application/json", token });
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// NWS data fetch
// ---------------------------------------------------------------------------
async function fetchNWS(): Promise<{ alerts: string; hourly: string; sevenDay: string }> {
  const pr = await fetch(`${NWS_BASE}/points/${BRIEF_LAT},${BRIEF_LON}`, { headers: { "User-Agent": NWS_UA }, signal: AbortSignal.timeout(8_000) });
  if (!pr.ok) throw new Error(`NWS /points ${pr.status}`);
  const pj = await pr.json() as { properties: { forecastHourly: string; forecast: string; county: string } };
  const { forecastHourly, forecast, county } = pj.properties;
  const countyId = county.split("/").pop() ?? "";

  const [hr, fr, ar] = await Promise.all([
    fetch(forecastHourly, { headers: { "User-Agent": NWS_UA }, signal: AbortSignal.timeout(8_000) }),
    fetch(forecast,       { headers: { "User-Agent": NWS_UA }, signal: AbortSignal.timeout(8_000) }),
    fetch(`${NWS_BASE}/alerts/active?zone=${countyId}`, { headers: { "User-Agent": NWS_UA }, signal: AbortSignal.timeout(8_000) }),
  ]);

  const cutoff = Date.now() + 48 * 3_600_000;
  let hourly = "Unavailable";
  if (hr.ok) {
    const hj = await hr.json() as { properties: { periods: NWSPeriod[] } };
    hourly = hj.properties.periods
      .filter(p => new Date(p.startTime).getTime() < cutoff)
      .map(p => {
        const t = new Date(p.startTime).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/Denver" });
        const precip = p.probabilityOfPrecipitation?.value;
        return `${t}: ${p.temperature}°F, ${p.shortForecast}${precip ? `, ${precip}% precip` : ""}`;
      }).join("\n");
  }

  let sevenDay = "Unavailable";
  if (fr.ok) {
    const fj = await fr.json() as { properties: { periods: NWSPeriod[] } };
    sevenDay = fj.properties.periods.slice(0, 14)
      .map(p => `${p.name}: ${p.temperature}°F, ${p.shortForecast}, wind ${p.windSpeed} ${p.windDirection}`)
      .join("\n");
  }

  let alerts = "None";
  if (ar.ok) {
    const aj = await ar.json() as { features: Array<{ properties: NWSAlert }> };
    const active = aj.features.map(f => f.properties).filter(a => !a.expires || new Date(a.expires) > new Date());
    if (active.length > 0) alerts = active.map(a => `${a.event}: ${a.headline}`).join("\n");
  }

  return { alerts, hourly, sevenDay };
}

// ---------------------------------------------------------------------------
// CAIC data fetch
// ---------------------------------------------------------------------------
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

async function fetchCAIC(): Promise<{ summary: string; pointForecast: string }> {
  const uri = encodeURIComponent("/api/v2/zone_weather_forecasts/statewide/current");
  const today = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const [sr, lr] = await Promise.all([
    fetch(`${CAIC_PROXY}?_api_proxy_uri=${uri}`, { headers: CAIC_HEADERS, signal: AbortSignal.timeout(8_000) }),
    fetch(`${LOOPER_BASE}/iptfcst/ptfcst.php?idate=${today}&res=4&lat=${BRIEF_LAT}&lon=${BRIEF_LON}`, { headers: CAIC_HEADERS, signal: AbortSignal.timeout(8_000) }),
  ]);

  let summary = "Unavailable";
  if (sr.ok) {
    const sj = await sr.json() as Record<string, unknown>;
    const plain = String(sj.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    summary = plain.slice(0, 800) + (plain.length > 800 ? "…" : "");
  }

  let pointForecast = "Unavailable";
  if (lr.ok) {
    const html = await lr.text();
    const nameIdx = html.indexOf("name: 'Temp'");
    if (nameIdx !== -1) {
      const dataIdx = html.indexOf("data:", nameIdx);
      const arr = dataIdx !== -1 ? extractArray(html, dataIdx) : null;
      if (arr) {
        try {
          const rows = JSON.parse(arr) as [number, number | null][];
          const cutoff = Date.now() + 48 * 3_600_000;
          pointForecast = rows
            .filter(([ms]) => ms < cutoff)
            .map(([ms, tmpF]) => {
              const t = new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/Denver" });
              return `${t}: ${tmpF !== null ? Math.round(tmpF) + "°F" : "?"}`;
            }).join("\n");
        } catch { /* leave as Unavailable */ }
      }
    }
  }

  return { summary, pointForecast };
}

// ---------------------------------------------------------------------------
// Generate brief via Claude Haiku
// ---------------------------------------------------------------------------
async function generateBrief(): Promise<BriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const [nws, caic] = await Promise.all([
    fetchNWS().catch(() => ({ alerts: "Unavailable", hourly: "Unavailable", sevenDay: "Unavailable" })),
    fetchCAIC().catch(() => ({ summary: "Unavailable", pointForecast: "Unavailable" })),
  ]);

  const prompt = `You are a concise weather forecaster for Summit County, Colorado (elevation ~9,000–9,200 ft).

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

  const aiRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!aiRes.ok) throw new Error(`Anthropic API ${aiRes.status}: ${await aiRes.text().catch(() => aiRes.statusText)}`);

  const aiJson = await aiRes.json() as { content: Array<{ type: string; text: string }> };
  const text = aiJson.content.find(b => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Empty response from Claude");

  return { text: text.trim(), generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");

  const wantsRefresh = req.query?.["refresh"] === "true";

  try {
    if (!wantsRefresh) {
      const cached = await readCached();
      if (cached) { res.status(200).json({ ...cached, error: null }); return; }
    }
    const result = await generateBrief();
    await writeCached(result);
    res.status(200).json({ ...result, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stale = await readCached();
    if (stale) { res.status(200).json({ ...stale, error: msg }); return; }
    res.status(200).json({ text: null, generatedAt: null, error: msg });
  }
}
