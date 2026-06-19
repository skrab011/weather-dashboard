# Weather Dashboard

Personal weather-consolidation PWA for Colorado locations. See `CLAUDE.md` for the locked spec and build plan.

## Live app

- **Personal page (V1):** https://weather-dashboard-five-umber.vercel.app
- **Shared page (V2):** https://weather-dashboard-five-umber.vercel.app/shared

## Shared page (V2)

`/shared` is a second app entry point that lets any user pick 1–2 US locations and view the same dashboard cards as V1. Key behavior:

- Locations are stored in `localStorage` (`weather-shared-locations-v1`) — no server-side account.
- US locations only (geocoder validates against a US bounding box).
- Colorado locations show all cards (CAIC weather summary, overlay chart, Mountain Weather Update video). Non-Colorado locations hide those three cards and show a plain NWS forecast brief instead of a consensus brief.
- `/shared` is not independently installable as a PWA — V1's manifest scopes to `/` and covers the installed app.

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
