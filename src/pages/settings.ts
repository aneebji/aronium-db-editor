import { loadCatalog, loadSales } from "../lib/aronium";
import { connectedName, getDatabase, hasFileAccess, loadFromFile, pickDatabase } from "../lib/db-file";
import { loadSettings, saveSettings } from "../lib/settings";
import { escapeHtml } from "./dashboard";

export function renderSettings(root: HTMLElement, onAttached: () => void): void {
  const settings = loadSettings();
  root.innerHTML = `
    <h1>Settings</h1>
    <p class="lead">Attach the Aronium database once. New Batch, Dashboard, Sales, and Products all use this file. Nothing is uploaded.</p>
    <div class="card">
      <strong>POS database</strong>
      <p class="muted">Select pos.db. Chrome or Edge can write it in place. Other browsers download the updated file.</p>
      <div class="toolbar">
        <button class="btn" id="pick">Choose pos.db</button>
        ${hasFileAccess() ? "" : `<label class="btn ghost">Choose file<input id="file" class="hidden" type="file" accept=".db"></label>`}
      </div>
      <p class="muted" id="db-status">${currentStatus()}</p>
    </div>
    <div class="card" style="margin-top:12px">
      <strong>Default year</strong>
      <p class="muted">Used when screenshots omit the year, for example 13 Sep.</p>
      <input id="year" type="number" value="${settings.year}" />
    </div>
    <div class="toolbar" style="margin-top:16px">
      <button class="btn" id="save">Save settings</button>
    </div>
  `;

  root.querySelector("#pick")?.addEventListener("click", async () => {
    try {
      const name = await pickDatabase();
      saveSettings({ dbName: name });
      root.querySelector("#db-status")!.textContent = attachStatus(name);
      onAttached();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });

  root.querySelector<HTMLInputElement>("#file")?.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const name = await loadFromFile(file);
    saveSettings({ dbName: name });
    root.querySelector("#db-status")!.textContent = attachStatus(name);
    onAttached();
  });

  root.querySelector("#save")?.addEventListener("click", () => {
    const year = Number(root.querySelector<HTMLInputElement>("#year")!.value);
    saveSettings({
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      dbName: connectedName(),
    });
    alert("Settings saved on this device.");
  });
}

function currentStatus(): string {
  const name = connectedName();
  if (!name) return "No database selected";
  return escapeHtml(attachStatus(name));
}

function attachStatus(name: string): string {
  const db = getDatabase();
  if (!db) return `${name} · attached`;
  return `${name} · ${loadCatalog(db).length} products · ${loadSales(db).length} sales`;
}
