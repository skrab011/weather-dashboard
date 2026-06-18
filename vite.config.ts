import { defineConfig } from "vite";

// Multi-page build: the personal page (V1) and the shared page (V2) are two
// separate HTML entry points that share one Vite/Vercel build and one /api/
// layer. index.html is V1 and must stay byte-identical; shared.html is V2.
// Vercel serves each as a route: index.html → /, shared.html → /shared.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html", // personal page (V1) — do not destabilize
        shared: "shared.html", // shared page (V2)
      },
    },
  },
});
