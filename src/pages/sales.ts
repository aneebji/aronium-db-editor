import { connectedName, getDatabase } from "../lib/db-file";
import { ledgerSnapshot } from "../lib/ledger";
import { bindPager, paginate, pagerHtml, type PageSize } from "../lib/pager";
import { table } from "./dashboard";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderSales(root: HTMLElement): void {
  const ledger = ledgerSnapshot(getDatabase());
  const name = connectedName();
  const state = { page: 1, pageSize: 10 as PageSize };
  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="kicker">Ledger</p>
        <h1>Sales</h1>
        <p class="lead">Every sale in the attached database. OCR entries show a batch number; existing Aronium tickets are marked Original.</p>
      </div>
    </div>
    <div class="toolbar">
      <input class="grow" id="search" placeholder="Search date, product, sale number, or source" ${ledger.attached ? "" : "disabled"} />
    </div>
    <p class="muted" id="meta"></p>
    <div class="table-wrap" id="list"></div>
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
    const view = paginate(rows, state.page, state.pageSize);
    state.page = view.page;
    root.querySelector("#meta")!.textContent = ledger.attached
      ? `${name} · ${rows.length} sales · ${ocr} from OCR · ${total.toFixed(2)}`
      : ATTACH_HINT;
    root.querySelector("#list")!.innerHTML =
      table(
        ["DateTime", "Amount", "Code", "Name", "Sale no", "Source"],
        view.slice.map((sale) => [
          sale.datetime,
          sale.amount.toFixed(2),
          sale.productCode,
          sale.product,
          sale.documentNumber,
          sale.source,
        ]),
        { lastColumn: "source", empty: ledger.attached ? "No sales in this database." : ATTACH_HINT },
      ) + pagerHtml("sales", view, state.pageSize);
    bindPager(root, "sales", ({ pageDelta, pageSize }) => {
      if (pageSize) {
        state.pageSize = pageSize;
        state.page = 1;
      }
      if (pageDelta) state.page += pageDelta;
      paint();
    });
  };
  search.addEventListener("input", () => {
    state.page = 1;
    paint();
  });
  paint();
}
