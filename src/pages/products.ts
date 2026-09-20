import { connectedName, getDatabase } from "../lib/db-file";
import { ledgerSnapshot } from "../lib/ledger";
import { bindPager, paginate, pagerHtml, type PageSize } from "../lib/pager";
import { flagLabel, flaggedList, productFlag } from "../lib/product-flags";
import { activeBranch } from "../lib/settings";
import { table } from "./dashboard";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderProducts(root: HTMLElement): void {
  const ledger = ledgerSnapshot(getDatabase());
  const name = connectedName();
  const shop = activeBranch();
  const flagged = flaggedList(shop.id);
  const enabled = ledger.products.filter((product) => product.enabled).length;
  const blockedInCatalog = ledger.products.filter((product) => productFlag(product, shop.id)).length;
  const state = { page: 1, pageSize: 10 as PageSize };
  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="kicker">Catalog</p>
        <h1>Products</h1>
        <p class="lead">Full catalog from the attached database. Exempt products are never written as sales.</p>
      </div>
    </div>
    <p class="muted">${
      ledger.attached
        ? `${name} · ${ledger.productCount} products · ${enabled} enabled · ${blockedInCatalog} exempt`
        : ATTACH_HINT
    }</p>
    <div class="table-wrap" id="list"></div>
    <div class="card" style="margin-top:18px">
      <strong>Exempt products · ${shop.name}</strong>
      <p class="muted">${flagged.length} products. Match and Enter Sale skip these.</p>
      <div class="table-wrap" id="flagged"></div>
    </div>
  `;
  root.querySelector("#flagged")!.innerHTML = table(
    ["Code", "Name"],
    flagged.map((item) => [item.code || "—", item.name]),
    { empty: "No exempt products." },
  );
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
          flagLabel(productFlag(product, shop.id), product.enabled),
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
