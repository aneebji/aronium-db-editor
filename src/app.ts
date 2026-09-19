import { resetBatch, renderBatch } from "./pages/batch";
import { renderDashboard } from "./pages/dashboard";
import { renderProducts } from "./pages/products";
import { renderSales } from "./pages/sales";
import { renderSettings } from "./pages/settings";
import type { PageId } from "./types";

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="orb orb-a"></div>
    <div class="orb orb-b"></div>
    <aside class="nav">
      <p class="brand">POS Sale Sync</p>
      <p class="tag">OCR, match, and ledger on this device</p>
      <button data-page="dash" class="active">Dashboard</button>
      <button data-page="batch">New Batch</button>
      <button data-page="sales">Sales</button>
      <button data-page="products">Products</button>
      <button data-page="settings">Settings</button>
    </aside>
    <main class="page" id="page"></main>
  `;
  const page = root.querySelector<HTMLElement>("#page")!;
  let current: PageId = "dash";

  const show = (id: PageId) => {
    current = id;
    root.querySelectorAll(".nav button").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-page") === id);
    });
    if (id === "dash") renderDashboard(page, () => show("batch"));
    else if (id === "batch") renderBatch(page, () => show("sales"));
    else if (id === "sales") renderSales(page);
    else if (id === "products") renderProducts(page);
    else renderSettings(page, () => show("dash"));
  };

  root.querySelectorAll<HTMLButtonElement>(".nav button").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-page") as PageId;
      if (id === "batch" && current !== "batch") resetBatch();
      show(id);
    });
  });

  show("dash");
}
