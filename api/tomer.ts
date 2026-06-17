// ---------------------------------------------------------------------------
// /api/tomer — Chris Tomer YouTube description proxy.
//
// Fetches the description text from his latest "Mountain Weather Update"
// video. No video embed or link is returned — description text only.
//
// Two sequential YouTube Data API v3 calls:
//   1. channels?forHandle=thechristomer  → resolve handle to channel ID
//   2. search?channelId=...&q=Mountain+Weather+Update&order=date&maxResults=5
//      → find the latest matching video (title filter applied client-side)
//   3. videos?id=...&part=snippet        → fetch the full description
//      (search results truncate the description field)
//
// The channel ID lookup (step 1) is cheap (1 quota unit) and makes the
// function resilient to channel renames — no hardcoded ID to maintain.
//
// Quota budget: ~5 units per call (1 channels + 100 search + 1 videos).
// At one call per hour that's ~120 units/day against the 10,000 free quota.
//
// Requires YOUTUBE_API_KEY in Vercel environment variables.
// ---------------------------------------------------------------------------

type Req = { method?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const YT_BASE = "https://www.googleapis.com/youtube/v3";

// Title must contain this string (case-insensitive) to be considered a match.
const TITLE_FILTER = "mountain weather update";

// YouTube search results truncate descriptions; we need a separate videos call.
async function fetchChannelId(apiKey: string): Promise<string> {
  const url =
    `${YT_BASE}/channels?part=id&forHandle=thechristomer&key=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`YouTube channels HTTP ${res.status}`);

  const json = await res.json() as { items?: Array<{ id: string }> };
  const id = json.items?.[0]?.id;
  if (!id) throw new Error("YouTube channel not found for handle @thechristomer");
  return id;
}

async function fetchLatestVideoId(apiKey: string, channelId: string): Promise<{ videoId: string; title: string; publishedAt: string }> {
  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    q: "Mountain Weather Update",
    type: "video",
    order: "date",
    maxResults: "10", // fetch more to ensure we find a matching title after filtering
    key: apiKey,
  });
  const res = await fetch(`${YT_BASE}/search?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);

  const json = await res.json() as {
    items?: Array<{
      id: { videoId: string };
      snippet: { title: string; publishedAt: string };
    }>;
  };

  // Apply title filter — search results may include unrelated videos
  const match = (json.items ?? []).find((item) =>
    item.snippet.title.toLowerCase().includes(TITLE_FILTER)
  );

  if (!match) throw new Error("No recent 'Mountain Weather Update' video found");

  return {
    videoId:     match.id.videoId,
    title:       match.snippet.title,
    publishedAt: match.snippet.publishedAt,
  };
}

async function fetchDescription(apiKey: string, videoId: string): Promise<string> {
  const params = new URLSearchParams({ part: "snippet", id: videoId, key: apiKey });
  const res = await fetch(`${YT_BASE}/videos?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`YouTube videos HTTP ${res.status}`);

  const json = await res.json() as {
    items?: Array<{ snippet: { description: string } }>;
  };

  const description = json.items?.[0]?.snippet?.description ?? "";
  if (!description) throw new Error("Video description is empty");
  return description;
}

export default async function handler(_req: Req, res: Res): Promise<void> {
  // 1-hour fresh cache; 2-hour stale-while-revalidate — videos post roughly daily
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      title: null, description: null, publishedAt: null,
      error: "YOUTUBE_API_KEY not configured",
      fetchedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const channelId   = await fetchChannelId(apiKey);
    const { videoId, title, publishedAt } = await fetchLatestVideoId(apiKey, channelId);
    const description = await fetchDescription(apiKey, videoId);

    res.status(200).json({
      title,
      description,
      publishedAt,
      error: null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(200).json({
      title: null,
      description: null,
      publishedAt: null,
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: new Date().toISOString(),
    });
  }
}
