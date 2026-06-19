// ---------------------------------------------------------------------------
// Shared page (V2) — location picker.
//
// One screen handles both jobs:
//   • Onboarding empty state — shown when no locations are stored yet.
//   • Manage screen — reached via the header "Edit" button to add/remove/change
//     the saved locations later.
//
// Flow: type a place → geocode via /api/geocode (W3) → persist to localStorage
// (W4 persistence). A hard cap of 2 locations matches the personal page. All
// US-restriction and source selection happens in the geocode proxy; this module
// only turns the outcome into friendly UI.
// ---------------------------------------------------------------------------

import { geocode, type GeoResult } from "./geocode";
import { loadLocations, saveLocations, MAX_LOCATIONS, type StoredLocation } from "./persistence";

// Friendly message for each not-found reason from the geocoder.
function messageForReason(reason: "not_found" | "not_us" | "error"): string {
  switch (reason) {
    case "not_us":
      return "US locations only. Try a city, ZIP code, or address in the United States.";
    case "error":
      return "Something went wrong reaching the search service. Please try again.";
    default:
      return "Couldn't find that place. Try a city, ZIP code, or full street address.";
  }
}

// Add a geocoded result to storage, enforcing the cap and de-duplicating by
// rounded coordinates. Returns a status the caller can surface inline.
function addLocation(result: GeoResult): { ok: boolean; message?: string } {
  const current = loadLocations();

  if (current.length >= MAX_LOCATIONS) {
    return { ok: false, message: `You can save up to ${MAX_LOCATIONS} locations. Remove one first.` };
  }

  const sameSpot = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    a.lat.toFixed(3) === b.lat.toFixed(3) && a.lon.toFixed(3) === b.lon.toFixed(3);
  if (current.some((l) => sameSpot(l, result))) {
    return { ok: false, message: "That location is already saved." };
  }

  const stored: StoredLocation = {
    label: result.label,
    lat: result.lat,
    lon: result.lon,
    state: result.state,
    inColorado: result.inColorado,
  };
  saveLocations([...current, stored]);
  return { ok: true };
}

// Remove the location at the given index.
function removeLocation(index: number): void {
  const current = loadLocations();
  current.splice(index, 1);
  saveLocations(current);
}

// Small HTML escaper for user/geocoder-supplied labels.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------------------------------------------------------------------------
// renderLocationScreen — paints the onboarding/manage screen into `container`
// and re-renders itself whenever the stored set changes.
//
//   onDone — called when the user is finished (the "View dashboard" button).
//            Only available once at least one location is saved.
// ---------------------------------------------------------------------------
export function renderLocationScreen(
  container: HTMLElement,
  opts: { onDone: () => void },
): void {
  function render(): void {
    const locations = loadLocations();
    const atCap = locations.length >= MAX_LOCATIONS;
    const isEmpty = locations.length === 0;

    const listHtml = locations.length
      ? `<ul class="loc-list">
          ${locations.map((l, i) => `
            <li class="loc-list__item">
              <span class="loc-list__label">${esc(l.label)}</span>
              <button class="loc-remove" data-remove="${i}" aria-label="Remove ${esc(l.label)}">Remove</button>
            </li>
          `).join("")}
        </ul>`
      : "";

    const searchHtml = atCap
      ? `<p class="loc-search__status">You've saved the maximum of ${MAX_LOCATIONS} locations.</p>`
      : `<form class="loc-search" novalidate>
          <input
            class="loc-search__input"
            type="text"
            name="q"
            autocomplete="off"
            placeholder="City, ZIP code, or address"
            aria-label="Search for a US location"
          />
          <button class="loc-search__btn" type="submit">Add</button>
        </form>
        <p class="loc-search__status" role="status" aria-live="polite"></p>`;

    const doneHtml = !isEmpty
      ? `<button class="loc-done" type="button">View dashboard &rarr;</button>`
      : "";

    container.innerHTML = `
      <section class="location-screen card">
        <h2 class="card-title">${isEmpty ? "Add a location" : "Your locations"}</h2>
        <p class="card-empty">
          ${isEmpty
            ? "Pick up to two US locations to see their weather. Your choices are saved on this device only."
            : `Add, remove, or change your saved locations (up to ${MAX_LOCATIONS}).`}
        </p>
        ${listHtml}
        ${searchHtml}
        ${doneHtml}
      </section>
    `;

    // Wire remove buttons
    container.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeLocation(parseInt(btn.dataset.remove ?? "0", 10));
        render();
      });
    });

    // Wire the "View dashboard" button
    const done = container.querySelector<HTMLButtonElement>(".loc-done");
    done?.addEventListener("click", opts.onDone);

    // Wire the search form
    const form = container.querySelector<HTMLFormElement>(".loc-search");
    const status = container.querySelector<HTMLParagraphElement>(".loc-search__status");
    if (form && status) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = form.querySelector<HTMLInputElement>(".loc-search__input");
        const btn = form.querySelector<HTMLButtonElement>(".loc-search__btn");
        const query = input?.value.trim() ?? "";
        if (!query) return;

        status.classList.remove("loc-search__status--error");
        status.textContent = "Searching…";
        if (btn) btn.disabled = true;

        const outcome = await geocode(query);

        if (!outcome.found) {
          status.textContent = messageForReason(outcome.reason);
          status.classList.add("loc-search__status--error");
          if (btn) btn.disabled = false;
          return;
        }

        const added = addLocation(outcome.result);
        if (!added.ok) {
          status.textContent = added.message ?? "Couldn't add that location.";
          status.classList.add("loc-search__status--error");
          if (btn) btn.disabled = false;
          return;
        }

        // Success — re-render the screen to show the new location.
        render();
      });
    }
  }

  render();
}
