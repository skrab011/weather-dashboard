import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <h1>Weather Dashboard</h1>
    <p>Scaffold is live. Data sources land in later workstreams.</p>
  </main>
`;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Service worker registration failed — app still works, just no offline cache
  });
}
