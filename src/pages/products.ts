import { connectedName, getDatabase } from "../lib/db-file";
import { ledgerSnapshot } from "../lib/ledger";
import { table } from "./dashboard";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderProducts(root: HTMLElement): void {
  const ledger = ledgerSnapshot(getDatabase());
  const name = connectedName();
  const enabled = ledger.products.filter((product) => product.enabled).length;
  root.innerHTML = `
    <h1>Products</h1>
    <p class="lead">Full catalog from the attached database.</p>
    <p class="muted">${
      ledger.attached
        ? `${name} · ${ledger.productCount} products · ${enabled} enabled`
        : ATTACH_HINT
    }</p>
    <div class="table-wrap card" style="padding:0">
      ${table(
        ["Code", "Name", "Price", "Status"],
        ledger.products.map((product) => [
          product.code,
          product.name,
          product.price.toFixed(2),
          product.enabled ? "Enabled" : "Disabled",
        ]),
        { lastColumn: "product", empty: ledger.attached ? "No products in this database." : ATTACH_HINT },
      )}
    </div>
  `;
}
