import type { BatchRecord, SaleRecord, TxnRow, UsedProduct } from "../types";

const KEY = "pos-sale-sync.history.v1";

interface Store {
  nextBatchId: number;
  nextSaleId: number;
  batches: BatchRecord[];
  sales: SaleRecord[];
}

function empty(): Store {
  return { nextBatchId: 1, nextSaleId: 1, batches: [], sales: [] };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) } as Store;
  } catch {
    return empty();
  }
}

function save(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function peekNextBatchId(): number {
  return load().nextBatchId;
}

export function batchIdForDocument(documentNumber: string): number | undefined {
  if (!documentNumber) return undefined;
  const sale = load().sales.find(
    (row) =>
      row.documentNumber === documentNumber &&
      (row.result === "inserted" || row.result === "already added"),
  );
  return sale?.batchId;
}

export function listBatches(): BatchRecord[] {
  return load().batches;
}

export function saveBatch(dbPath: string, imageCount: number, rows: TxnRow[], batchId?: number): number {
  const store = load();
  const inserted = rows.filter((row) => row.result === "inserted").length;
  const skipped = rows.filter((row) => row.result === "skipped" || row.result === "already added" || row.skipped).length;
  const failed = rows.filter((row) => row.result === "failed").length;
  const amount = rows.filter((row) => row.result === "inserted").reduce((sum, row) => sum + row.amount, 0);
  const id = batchId ?? store.nextBatchId;
  const batch: BatchRecord = {
    id,
    createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    dbPath,
    imageCount,
    rows: rows.length,
    inserted,
    skipped,
    failed,
    amount,
  };
  store.nextBatchId = Math.max(store.nextBatchId, id + 1);
  store.batches.unshift(batch);
  for (const row of rows) {
    store.sales.unshift({
      id: store.nextSaleId,
      batchId: batch.id,
      datetime: row.datetime,
      amount: row.amount,
      product: row.productName,
      productCode: row.productCode,
      productId: row.productId,
      catalogPrice: row.catalogPrice,
      matchType: row.matchType,
      documentNumber: row.saleNumber,
      result: row.result || (row.skipped ? "skipped" : ""),
      txnId: row.txnId,
    });
    store.nextSaleId += 1;
  }
  save(store);
  return batch.id;
}

export function listSales(search = "", limit = 500): SaleRecord[] {
  const term = search.trim().toLowerCase();
  return load()
    .sales.filter((sale) => {
      if (!term) return true;
      return [sale.datetime, sale.product, sale.productCode, sale.documentNumber, sale.result]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .slice(0, limit);
}

export function listUsedProducts(): UsedProduct[] {
  const map = new Map<string, UsedProduct>();
  for (const sale of load().sales) {
    if (sale.result !== "inserted" || !sale.product) continue;
    const key = `${sale.productId ?? ""}|${sale.productCode}|${sale.product}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        productCode: sale.productCode,
        product: sale.product,
        timesUsed: 1,
        lastDatetime: sale.datetime,
        totalAmount: sale.amount,
      });
    } else {
      prev.timesUsed += 1;
      prev.totalAmount += sale.amount;
      if (sale.datetime > prev.lastDatetime) prev.lastDatetime = sale.datetime;
    }
  }
  return [...map.values()].sort((a, b) => b.timesUsed - a.timesUsed || b.lastDatetime.localeCompare(a.lastDatetime));
}

export function dashboardStats(): {
  batches: number;
  inserted: number;
  amount: number;
  lastRun: string;
  recentBatches: BatchRecord[];
  recentSales: SaleRecord[];
} {
  const store = load();
  return {
    batches: store.batches.length,
    inserted: store.batches.reduce((sum, batch) => sum + batch.inserted, 0),
    amount: store.batches.reduce((sum, batch) => sum + batch.amount, 0),
    lastRun: store.batches[0]?.createdAt ?? "-",
    recentBatches: store.batches.slice(0, 20),
    recentSales: store.sales.slice(0, 40),
  };
}
