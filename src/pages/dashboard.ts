import { dashboardStats } from "../lib/history";
import { connectedName } from "../lib/db-file";

export function renderDashboard(root: HTMLElement, onNewBatch: () => void): void {
  const stats = dashboardStats();
  root.innerHTML = `
    <h1>Dashboard</h1>
    <p class="lead">OCR, match, and ledger — processed on this device.</p>
    <div class="stats">
      <div class="card"><div class="label">Batches</div><div class="value">${stats.batches}</div></div>
      <div class="card"><div class="label">Inserted sales</div><div class="value">${stats.inserted}</div></div>
      <div class="card"><div class="label">Amount</div><div class="value">${stats.amount.toFixed(2)}</div></div>
      <div class="card"><div class="label">Last run</div><div class="value" style="font-size:16px">${escapeHtml(stats.lastRun)}</div></div>
    </div>
    <div class="toolbar">
      <button class="btn" id="new-batch">New batch</button>
      <span class="muted">${connectedName() ? `Database · ${escapeHtml(connectedName())}` : "No pos.db selected — open Settings"}</span>
    </div>
    <h2>Recent batches</h2>
    <div class="table-wrap card" style="padding:0">
      ${table(
        ["When", "Images", "Rows", "Inserted", "Skipped", "Failed", "Amount"],
        stats.recentBatches.map((batch) => [
          batch.createdAt,
          String(batch.imageCount),
          String(batch.rows),
          String(batch.inserted),
          String(batch.skipped),
          String(batch.failed),
          batch.amount.toFixed(2),
        ]),
      )}
    </div>
    <h2>Recent sales</h2>
    <div class="table-wrap card" style="padding:0">
      ${table(
        ["DateTime", "Price", "Code", "Name", "Sale no", "Status"],
        stats.recentSales.map((sale) => [
          sale.datetime,
          sale.amount.toFixed(2),
          sale.productCode,
          sale.product,
          sale.documentNumber,
          sale.result,
        ]),
      )}
    </div>
  `;
  root.querySelector("#new-batch")?.addEventListener("click", onNewBatch);
}

export function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return `<p class="muted" style="padding:16px">No entries yet.</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map(
        (row) =>
          `<tr>${row.map((cell, i) => `<td class="${i === row.length - 1 ? statusClass(cell) : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
}

export function statusClass(status: string): string {
  if (status === "inserted" || status === "ok") return "status-ok";
  if (status.includes("already") || status.includes("skip")) return "status-skip";
  if (status.includes("fail") || status === "error") return "status-fail";
  return "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
