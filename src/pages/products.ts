import { listUsedProducts } from "../lib/history";
import { table } from "./dashboard";

export function renderProducts(root: HTMLElement): void {
  const rows = listUsedProducts();
  root.innerHTML = `
    <h1>Products</h1>
    <p class="lead">Products used in entered sales.</p>
    <p class="muted">${rows.length} product(s) used in entered sales</p>
    <div class="table-wrap card" style="padding:0">
      ${table(
        ["Code", "Name", "Times used", "Last DateTime", "Total"],
        rows.map((product) => [
          product.productCode,
          product.product,
          String(product.timesUsed),
          product.lastDatetime,
          product.totalAmount.toFixed(2),
        ]),
      )}
    </div>
  `;
}
