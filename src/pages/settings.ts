import { loadProducts } from "../lib/aronium";
import { connectedName, getDatabase, hasFileAccess, loadFromFile, pickDatabase } from "../lib/db-file";
import { loadSettings, saveSettings } from "../lib/settings";
import { escapeHtml } from "./dashboard";

export function renderSettings(root: HTMLElement, onSaved: () => void): void {
  const settings = loadSettings();
  root.innerHTML = `
    <h1>Settings</h1>
    <p class="lead">The database path is set once here. New Batch only uses this file. Nothing is uploaded.</p>
    <div class="card">
      <strong>POS database</strong>
      <p class="muted">Aronium pos.db — Chrome or Edge can write it in place. Other browsers download the updated file.</p>
      <div class="toolbar">
        <button class="btn" id="pick">Choose pos.db</button>
        ${hasFileAccess() ? "" : `<label class="btn ghost">Choose file<input id="file" class="hidden" type="file" accept=".db"></label>`}
      </div>
      <p class="muted" id="db-status">${connectedName() ? escapeHtml(connectedName()) : "No database selected"}</p>
    </div>
    <div class="card" style="margin-top:12px">
      <strong>Default year</strong>
      <p class="muted">Used when screenshots have no year (for example 13 Sep).</p>
      <input id="year" type="number" value="${settings.year}" />
    </div>
    <div class="toolbar" style="margin-top:16px">
      <button class="btn" id="save">Save settings</button>
    </div>
  `;

  root.querySelector("#pick")?.addEventListener("click", async () => {
    try {
      const name = await pickDatabase();
      loadProducts(mustDb());
      saveSettings({ dbName: name });
      root.querySelector("#db-status")!.textContent = `${name} · ${loadProducts(mustDb()).length} products`;
      onSaved();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });

  root.querySelector<HTMLInputElement>("#file")?.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const name = await loadFromFile(file);
    saveSettings({ dbName: name });
    root.querySelector("#db-status")!.textContent = `${name} · loaded for this session`;
    onSaved();
  });

  root.querySelector("#save")?.addEventListener("click", () => {
    const year = Number(root.querySelector<HTMLInputElement>("#year")!.value);
    saveSettings({ year: Number.isFinite(year) ? year : new Date().getFullYear(), dbName: connectedName() });
    onSaved();
    alert("Settings saved on this device.");
  });
}

function mustDb() {
  const db = getDatabase();
  if (!db) throw new Error("Database is not loaded.");
  return db;
}
