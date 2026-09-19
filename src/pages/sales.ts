import { listSales } from "../lib/history";
import { escapeHtml, statusClass, table } from "./dashboard";

export function renderSales(root: HTMLElement): void {
  root.innerHTML = `
    <h1>Sales</h1>
    <p class="lead">Sales this app has written from this browser.</p>
    <div class="toolbar">
      <input class="grow" id="search" placeholder="Search datetime, product, sale number" />
    </div>
    <p class="muted" id="meta"></p>
    <div class="table-wrap card" style="padding:0" id="list"></div>
  `;
  const search = root.querySelector<HTMLInputElement>("#search")!;
  const paint = () => {
    const rows = listSales(search.value);
    const inserted = rows.filter((row) => row.result === "inserted");
    const total = inserted.reduce((sum, row) => sum + row.amount, 0);
    root.querySelector("#meta")!.textContent = `${rows.length} entries · ${inserted.length} inserted · ${total.toFixed(2)}`;
    root.querySelector("#list")!.innerHTML = table(
      ["DateTime", "Price", "Code", "Name", "Sale no", "Status"],
      rows.map((sale) => [
        sale.datetime,
        sale.amount.toFixed(2),
        sale.productCode,
        sale.product,
        sale.documentNumber,
        sale.result,
      ]),
    );
    root.querySelectorAll("td:last-child").forEach((cell) => {
      cell.className = statusClass(cell.textContent || "");
    });
  };
  search.addEventListener("input", paint);
  paint();
}

export { escapeHtml };
