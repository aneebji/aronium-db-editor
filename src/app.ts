import { resetBatch, renderBatch } from "./pages/batch";
import { renderDashboard } from "./pages/dashboard";
import { renderProducts } from "./pages/products";
import { renderSales } from "./pages/sales";
import { renderSettings } from "./pages/settings";
import { restoreActiveBranch } from "./lib/db-file";
import { applyTheme } from "./lib/settings";
import type { PageId } from "./types";

export async function mountApp(root: HTMLElement): Promise<void> {
  applyTheme();
  root.innerHTML = `
    <a class="skip" href="#page">Skip to content</a>
    <header class="nav">
      <div class="brand-block">
        <p class="brand">POS Sale Sync</p>
        <p class="tag">On-device register</p>
      </div>
      <nav class="nav-links" aria-label="Primary">
        <button type="button" data-page="dash" class="active">Dashboard</button>
        <button type="button" data-page="batch">New Batch</button>
        <button type="button" data-page="sales">Sales</button>
        <button type="button" data-page="products">Products</button>
        <button type="button" data-page="settings">Settings</button>
      </nav>
    </header>
    <main class="page" id="page" tabindex="-1"></main>
  `;
  const page = root.querySelector<HTMLElement>("#page")!;
  let current: PageId = "dash";

  const show = (id: PageId) => {
    current = id;
    root.querySelectorAll(".nav-links button").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-page") === id);
    });
    if (id === "dash") renderDashboard(page, () => show("batch"));
    else if (id === "batch") renderBatch(page, () => show("sales"));
    else if (id === "sales") renderSales(page);
    else if (id === "products") renderProducts(page);
    else renderSettings(page, () => show("dash"));
  };

  root.querySelectorAll<HTMLButtonElement>(".nav-links button").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-page") as PageId;
      if (id === "batch" && current !== "batch") resetBatch();
      show(id);
    });
  });

  await restoreActiveBranch();
  show("dash");
}
