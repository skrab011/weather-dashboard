# Weather Dashboard

Personal weather-consolidation PWA for Colorado locations. See `CLAUDE.md` for the current project reference; completed planning/spec docs live in `archive/`.

## Live app

- **Personal page (V1):** https://weather-dashboard-five-umber.vercel.app
- **Shared page (V2):** https://weather-dashboard-five-umber.vercel.app/shared

## Shared page (V2)

`/shared` is a second app entry point that lets any user pick 1–2 US locations and view the same dashboard cards as V1. Key behavior:

- Locations are stored in `localStorage` (`weather-shared-locations-v1`) — no server-side account.
- US locations only (geocoder validates against a US bounding box).
- Colorado locations show all cards. Non-Colorado locations hide the CAIC weather summary and Mountain Weather Update video, and show a plain NWS "Forecast Brief" instead of a consensus brief. The forecast-comparison chart is shown for all locations (NWS + ECMWF + GFS everywhere; CAIC added in Colorado).
- `/shared` is independently installable as a PWA (its own `manifest-shared.json`, `scope: /shared`, added 2026-06-20).

## Local dev

```bash
npm install
npm run dev        # personal page → http://localhost:5173/
                   # shared page   → http://localhost:5173/shared
```

## Stack

- Frontend: Vite + TypeScript, multi-page build (index.html + shared.html)
- Backend: Vercel serverless functions (`/api`)
- Hosting: Vercel free tier
