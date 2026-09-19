import { connectedName, getDatabase } from "../lib/db-file";
import { listBatches } from "../lib/history";
import { ledgerSnapshot } from "../lib/ledger";
import { bindPager, paginate, pagerHtml, type PageSize } from "../lib/pager";

const ATTACH_HINT = "Attach a database in Settings to load the catalog and sales ledger.";

export function renderDashboard(root: HTMLElement, onNewBatch: () => void): void {
  const ledger = ledgerSnapshot(getDatabase());
  const batches = listBatches();
  const name = connectedName();
  const state = {
    batchPage: 1,
    batchSize: 10 as PageSize,
    salesPage: 1,
    salesSize: 10 as PageSize,
  };

  root.innerHTML = `
    <h1>Dashboard</h1>
    <p class="lead">OCR, match, and ledger on this device.</p>
    <div class="stats">
      <div class="card"><div class="label">Products</div><div class="value">${ledger.productCount}</div></div>
      <div class="card"><div class="label">Sales</div><div class="value">${ledger.salesCount}</div></div>
      <div class="card"><div class="label">OCR batches</div><div class="value">${ledger.ocrBatches}</div></div>
      <div class="card"><div class="label">Ledger total</div><div class="value">${ledger.ledgerTotal.toFixed(2)}</div></div>
    </div>
    <div class="toolbar">
      <button class="btn" id="new-batch">New batch</button>
      <span class="muted">${
        name
          ? `Database · ${escapeHtml(name)} · ${ledger.productCount} products · ${ledger.salesCount} sales`
          : ATTACH_HINT
      }</span>
    </div>
    <h2>Recent batches</h2>
    <div class="table-wrap card" style="padding:0" id="batch-list"></div>
    <h2>Recent sales</h2>
    <div class="table-wrap card" style="padding:0" id="sales-list"></div>
  `;
  root.querySelector("#new-batch")?.addEventListener("click", onNewBatch);

  const paint = () => {
    const batchView = paginate(batches, state.batchPage, state.batchSize);
    state.batchPage = batchView.page;
    root.querySelector("#batch-list")!.innerHTML =
      table(
        ["When", "Images", "Rows", "Inserted", "Skipped", "Failed", "Amount"],
        batchView.slice.map((batch) => [
          batch.createdAt,
          String(batch.imageCount),
          String(batch.rows),
          String(batch.inserted),
          String(batch.skipped),
          String(batch.failed),
          batch.amount.toFixed(2),
        ]),
        { empty: "No OCR batches yet." },
      ) + pagerHtml("dash-batches", batchView, state.batchSize);

    const salesView = paginate(ledger.sales, state.salesPage, state.salesSize);
    state.salesPage = salesView.page;
    root.querySelector("#sales-list")!.innerHTML =
      table(
        ["DateTime", "Amount", "Code", "Name", "Sale no", "Source"],
        salesView.slice.map((sale) => [
          sale.datetime,
          sale.amount.toFixed(2),
          sale.productCode,
          sale.product,
          sale.documentNumber,
          sale.source,
        ]),
        { lastColumn: "source", empty: ledger.attached ? "No sales in this database." : ATTACH_HINT },
      ) + pagerHtml("dash-sales", salesView, state.salesSize);

    bindPager(root, "dash-batches", ({ pageDelta, pageSize }) => {
      if (pageSize) {
        state.batchSize = pageSize;
        state.batchPage = 1;
      }
      if (pageDelta) state.batchPage += pageDelta;
      paint();
    });
    bindPager(root, "dash-sales", ({ pageDelta, pageSize }) => {
      if (pageSize) {
        state.salesSize = pageSize;
        state.salesPage = 1;
      }
      if (pageDelta) state.salesPage += pageDelta;
      paint();
    });
  };

  paint();
}

export type LastColumnKind = "status" | "source" | "product" | "none";

export function table(
  headers: string[],
  rows: string[][],
  options?: { lastColumn?: LastColumnKind; empty?: string },
): string {
  if (!rows.length) {
    return `<p class="muted" style="padding:16px">${escapeHtml(options?.empty ?? "No entries yet.")}</p>`;
  }
  const kind = options?.lastColumn ?? "none";
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map(
        (row) =>
          `<tr>${row
            .map(
              (cell, i) =>
                `<td class="${i === row.length - 1 ? lastColumnClass(cell, kind) : ""}">${escapeHtml(cell)}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
}

export function lastColumnClass(value: string, kind: LastColumnKind): string {
  if (kind === "source") return sourceClass(value);
  if (kind === "status") return statusClass(value);
  if (kind === "product") return value === "Enabled" ? "status-ok" : "source-original";
  return "";
}

export function sourceClass(source: string): string {
  if (/^Batch \d+$/i.test(source)) return "status-ok";
  if (source === "Original") return "source-original";
  return "";
}

export function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (value === "inserted" || value === "ok" || value === "ready") return "status-ok";
  if (value.includes("already") || value.includes("skip")) return "status-skip";
  if (value.includes("fail") || value === "error") return "status-fail";
  return "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
