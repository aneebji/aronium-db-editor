import { loadCatalog, loadSales } from "../lib/aronium";
import { hasBranchHandle } from "../lib/branches";
import {
  activateBranch,
  connectedName,
  getDatabase,
  hasFileAccess,
  loadFromFileFor,
  pickDatabaseFor,
  resetAttachedShops,
} from "../lib/db-file";
import {
  applyTheme,
  isBranchId,
  loadSettings,
  patchBranch,
  saveSettings,
  type BranchId,
  type ThemeId,
} from "../lib/settings";
import { flaggedList } from "../lib/product-flags";
import { escapeHtml, table } from "./dashboard";

export function renderSettings(root: HTMLElement, onAttached: () => void): void {
  const settings = loadSettings();
  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="kicker">Device</p>
        <h1>Settings</h1>
        <p class="lead">Attach a pos.db to each shop. New Batch, Dashboard, Sales, and Products use the active shop. Nothing is uploaded.</p>
      </div>
    </div>
    <div class="card">
      <strong>Inventory</strong>
      <p class="muted">Four shops. Select the active shop, then attach its Aronium database. Chrome or Edge can write that file in place.</p>
      <label class="field-label" for="active-branch">Active shop</label>
      <select id="active-branch" aria-label="Active shop">
        ${settings.branches
          .map(
            (branch) =>
              `<option value="${branch.id}"${branch.id === settings.activeBranchId ? " selected" : ""}>${escapeHtml(branch.name)}</option>`,
          )
          .join("")}
      </select>
      <div class="branch-list" id="branch-list">
        ${settings.branches
          .map(
            (branch) => `
          <div class="branch-row" data-id="${branch.id}">
            <input class="branch-name" aria-label="Shop name" value="${escapeHtml(branch.name)}" />
            <button type="button" class="btn ghost pick-branch">Choose pos.db</button>
            ${
              hasFileAccess()
                ? ""
                : `<label class="btn ghost">Choose file<input class="hidden branch-file" type="file" accept=".db"></label>`
            }
            <p class="muted branch-status">${escapeHtml(slotStatus(branch.id, branch.dbName, branch.productCount, branch.salesCount))}</p>
          </div>`,
          )
          .join("")}
      </div>
    </div>
    <div class="card">
      <strong id="exempt-title">Exempt</strong>
      <p class="muted" id="exempt-hint"></p>
      <div class="table-wrap exempt-preview" id="exempt-preview"></div>
    </div>
    <div class="card">
      <strong>Default year</strong>
      <p class="muted">Used when screenshots omit the year, for example 13 Sep.</p>
      <input id="year" type="number" value="${settings.year}" />
    </div>
    <div class="card">
      <strong>Appearance</strong>
      <p class="muted">Dark is the default. Light uses the same ink and ochre tokens on paper.</p>
      <select id="theme" aria-label="Color theme">
        <option value="dark"${settings.theme === "dark" ? " selected" : ""}>Dark</option>
        <option value="light"${settings.theme === "light" ? " selected" : ""}>Light</option>
      </select>
    </div>
    <div class="toolbar">
      <button class="btn" id="save">Save settings</button>
      <button class="btn ghost" id="reset" type="button">Reset</button>
    </div>
  `;

  const themeSelect = root.querySelector<HTMLSelectElement>("#theme")!;
  const activeSelect = root.querySelector<HTMLSelectElement>("#active-branch")!;

  const paintExempt = () => {
    const current = loadSettings();
    const shop = current.branches.find((branch) => branch.id === current.activeBranchId);
    const id = shop?.id ?? "shop-1";
    const name = shop?.name ?? "Shop 1";
    const list = flaggedList(id);
    root.querySelector("#exempt-title")!.textContent = `Exempt products · ${name}`;
    root.querySelector("#exempt-hint")!.textContent =
      `${list.length} products. Match and Enter Sale skip these.`;
    root.querySelector("#exempt-preview")!.innerHTML = table(
      ["Code", "Name"],
      list.map((item) => [item.code || "—", item.name]),
      { empty: "No exempt products for this shop." },
    );
  };

  const refreshActiveOptions = () => {
    const next = loadSettings();
    activeSelect.innerHTML = next.branches
      .map(
        (branch) =>
          `<option value="${branch.id}"${branch.id === next.activeBranchId ? " selected" : ""}>${escapeHtml(branch.name)}</option>`,
      )
      .join("");
    paintExempt();
  };

  const paintStatus = async (id: BranchId) => {
    const row = root.querySelector(`.branch-row[data-id="${id}"] .branch-status`);
    if (!row) return;
    const slot = loadSettings().branches.find((branch) => branch.id === id);
    if (!slot) return;
    const needs = slot.dbName && !(await hasBranchHandle(id)) && !(id === loadSettings().activeBranchId && getDatabase());
    row.textContent = needs
      ? `${slot.dbName} · re-attach pos.db`
      : slotStatus(id, slot.dbName, slot.productCount, slot.salesCount);
  };

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value as ThemeId;
    applyTheme(theme);
    saveSettings({ theme });
  });

  activeSelect.addEventListener("change", async () => {
    const id = activeSelect.value;
    if (!isBranchId(id)) return;
    const loaded = await activateBranch(id);
    if (!loaded && loadSettings().branches.find((branch) => branch.id === id)?.dbName) {
      alert("Re-attach pos.db for this shop. The saved file handle is missing or permission was denied.");
    }
    await Promise.all(loadSettings().branches.map((branch) => paintStatus(branch.id)));
    paintExempt();
  });

  root.querySelectorAll<HTMLInputElement>(".branch-name").forEach((input) => {
    const commit = () => {
      const id = input.closest(".branch-row")?.getAttribute("data-id");
      if (!isBranchId(id)) return;
      const name = input.value.trim() || input.value;
      patchBranch(id, { name: name || "Shop" });
      refreshActiveOptions();
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  });

  root.querySelectorAll<HTMLButtonElement>(".pick-branch").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.closest(".branch-row")?.getAttribute("data-id");
      if (!isBranchId(id)) return;
      try {
        await pickDatabaseFor(id);
        refreshActiveOptions();
        await Promise.all(loadSettings().branches.map((branch) => paintStatus(branch.id)));
        onAttached();
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    });
  });

  root.querySelectorAll<HTMLInputElement>(".branch-file").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const id = input.closest(".branch-row")?.getAttribute("data-id");
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!isBranchId(id) || !file) return;
      const name = await loadFromFileFor(id, file);
      patchBranch(id, { dbName: name });
      refreshActiveOptions();
      await Promise.all(loadSettings().branches.map((branch) => paintStatus(branch.id)));
      onAttached();
    });
  });

  root.querySelector("#save")?.addEventListener("click", () => {
    const year = Number(root.querySelector<HTMLInputElement>("#year")!.value);
    const theme = themeSelect.value as ThemeId;
    applyTheme(theme);
    root.querySelectorAll<HTMLInputElement>(".branch-name").forEach((input) => {
      const id = input.closest(".branch-row")?.getAttribute("data-id");
      if (!isBranchId(id)) return;
      patchBranch(id, { name: input.value.trim() || "Shop" });
    });
    saveSettings({
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      theme,
      dbName: connectedName(),
    });
    refreshActiveOptions();
    alert("Settings saved on this device.");
  });

  root.querySelector("#reset")?.addEventListener("click", async () => {
    if (
      !confirm(
        "Reset all shop names and attached databases on this device? The files on disk are not deleted.",
      )
    ) {
      return;
    }
    await resetAttachedShops();
    onAttached();
    renderSettings(root, onAttached);
    alert("Shops and attached databases were reset.");
  });

  paintExempt();
  void Promise.all(settings.branches.map((branch) => paintStatus(branch.id)));
}

function slotStatus(id: BranchId, name: string, products: number, sales: number): string {
  if (id === loadSettings().activeBranchId) {
    const live = connectedName();
    if (live) {
      const db = getDatabase();
      if (db) return `${live} · ${loadCatalog(db).length} products · ${loadSales(db).length} sales`;
      return `${live} · attached`;
    }
  }
  if (!name) return "No database";
  if (products || sales) return `${name} · ${products} products · ${sales} sales`;
  return `${name} · saved`;
}
