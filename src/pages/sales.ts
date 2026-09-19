import { connectedName, getDatabase } from "../lib/db-file";
import { ledgerSnapshot } from "../lib/ledger";
import { table } from "./dashboard";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderSales(root: HTMLElement): void {
  const ledger = ledgerSnapshot(getDatabase());
  const name = connectedName();
  root.innerHTML = `
    <h1>Sales</h1>
    <p class="lead">Every sale in the attached database. OCR entries show a batch number; existing Aronium tickets are marked Original.</p>
    <div class="toolbar">
      <input class="grow" id="search" placeholder="Search date, product, sale number, or source" ${ledger.attached ? "" : "disabled"} />
    </div>
    <p class="muted" id="meta"></p>
    <div class="table-wrap card" style="padding:0" id="list"></div>
  `;
  const search = root.querySelector<HTMLInputElement>("#search")!;
  const paint = () => {
    const term = search.value.trim().toLowerCase();
    const rows = ledger.sales.filter((sale) => {
      if (!term) return true;
      return [sale.datetime, sale.product, sale.productCode, sale.documentNumber, sale.source]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    const ocr = rows.filter((sale) => sale.source.startsWith("Batch ")).length;
    const total = rows.reduce((sum, sale) => sum + sale.amount, 0);
    root.querySelector("#meta")!.textContent = ledger.attached
      ? `${name} · ${rows.length} sales · ${ocr} from OCR · ${total.toFixed(2)}`
      : ATTACH_HINT;
    root.querySelector("#list")!.innerHTML = table(
      ["DateTime", "Amount", "Code", "Name", "Sale no", "Source"],
      rows.map((sale) => [
        sale.datetime,
        sale.amount.toFixed(2),
        sale.productCode,
        sale.product,
        sale.documentNumber,
        sale.source,
      ]),
      { lastColumn: "source", empty: ledger.attached ? "No sales in this database." : ATTACH_HINT },
    );
  };
  search.addEventListener("input", paint);
  paint();
}
