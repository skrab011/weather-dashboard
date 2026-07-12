// ---------------------------------------------------------------------------
// Frontend fetch layer for the Radio Forecast audio.
// Calls /api/radio, which reads the server's cached brief, generates (or
// re-serves) the TTS MP3, and returns its public Blob URL.
//
// No SourceResult envelope — audio is ephemeral; nothing renders from state.
//
// V1 call site passes no options → GET /api/radio (home brief).
// The options parameter mirrors fetchBrief for an eventual V2 extension;
// nothing passes it today.
// ---------------------------------------------------------------------------

export interface RadioResult {
  audioUrl: string | null;
  error: string | null;
}

export async function fetchRadio(
  options?: { lat?: number; lon?: number },
): Promise<RadioResult> {
  let url = "/api/radio";
  if (options?.lat !== undefined && options?.lon !== undefined) {
    const params = new URLSearchParams({ lat: String(options.lat), lon: String(options.lon) });
    url = `/api/radio?${params.toString()}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { audioUrl: null, error: `HTTP ${res.status}` };

    const json = await res.json() as { audioUrl: string | null; error: string | null };
    if (json.error || !json.audioUrl) return { audioUrl: null, error: json.error ?? "No audio returned" };

    return { audioUrl: json.audioUrl, error: null };
  } catch (err) {
    return { audioUrl: null, error: err instanceof Error ? err.message : String(err) };
  }
}
