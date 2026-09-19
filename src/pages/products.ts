import { connectedName, getDatabase } from "../lib/db-file";
import { ledgerSnapshot } from "../lib/ledger";
import { bindPager, paginate, pagerHtml, type PageSize } from "../lib/pager";
import { table } from "./dashboard";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderProducts(root: HTMLElement): void {
  const ledger = ledgerSnapshot(getDatabase());
  const name = connectedName();
  const enabled = ledger.products.filter((product) => product.enabled).length;
  const state = { page: 1, pageSize: 10 as PageSize };
  root.innerHTML = `
    <h1>Products</h1>
    <p class="lead">Full catalog from the attached database.</p>
    <p class="muted">${
      ledger.attached
        ? `${name} · ${ledger.productCount} products · ${enabled} enabled`
        : ATTACH_HINT
    }</p>
    <div class="table-wrap card" style="padding:0" id="list"></div>
  `;
  const paint = () => {
    const view = paginate(ledger.products, state.page, state.pageSize);
    state.page = view.page;
    root.querySelector("#list")!.innerHTML =
      table(
        ["Code", "Name", "Price", "Status"],
        view.slice.map((product) => [
          product.code,
          product.name,
          product.price.toFixed(2),
          product.enabled ? "Enabled" : "Disabled",
        ]),
        { lastColumn: "product", empty: ledger.attached ? "No products in this database." : ATTACH_HINT },
      ) + pagerHtml("products", view, state.pageSize);
    bindPager(root, "products", ({ pageDelta, pageSize }) => {
      if (pageSize) {
        state.pageSize = pageSize;
        state.page = 1;
      }
      if (pageDelta) state.page += pageDelta;
      paint();
    });
  };
  paint();
}
