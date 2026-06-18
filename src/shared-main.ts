// ---------------------------------------------------------------------------
// Shared page (V2) entry point.
//
// W0 scaffold: this renders a placeholder only. The real boot sequence —
// localStorage location loading, picker, and the V1-style fetch/render flow
// using the src/shared/ engine — is wired up in later workstreams (W4+).
//
// The personal page (V1) at src/main.ts is intentionally untouched.
// ---------------------------------------------------------------------------

import "./style.css";

function boot(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  app.innerHTML = `
    <header class="app-header">
      <span class="app-title">Weather</span>
    </header>
    <main class="content">
      <section class="card">
        <h2 class="card-title">Shared page — coming soon</h2>
        <p class="card-empty">
          Pick your own locations here. This page is under construction (V2 scaffold).
        </p>
      </section>
    </main>
  `;
}

boot();
