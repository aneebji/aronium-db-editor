export type PageId = "dash" | "batch" | "sales" | "products" | "settings";
export type PaymentMethod = "debit" | "cash";

export interface Product {
  id: number;
  name: string;
  price: number;
  code: string;
}

export interface CatalogProduct extends Product {
  enabled: boolean;
}

export interface LedgerSale {
  documentId: number;
  datetime: string;
  amount: number;
  productCode: string;
  product: string;
  productId: number | null;
  extraItems: number;
  documentNumber: string;
  internalNote: string;
  source: string;
}

export interface TxnRow {
  rowId: string;
  datetime: string;
  originalDatetime: string;
  amount: number;
  txnId: string;
  imageName: string;
  status: string;
  skipped: boolean;
  productId: number | null;
  productCode: string;
  productName: string;
  catalogPrice: number | null;
  matchType: string;
  saleNumber: string;
  saleTotal: number | null;
  result: string;
  error: string;
  paymentMethod: PaymentMethod;
}

export interface OcrItem {
  x: number;
  y: number;
  text: string;
}

export interface BatchRecord {
  id: number;
  createdAt: string;
  dbPath: string;
  imageCount: number;
  rows: number;
  inserted: number;
  skipped: number;
  failed: number;
  amount: number;
}

export interface SaleRecord {
  id: number;
  batchId: number;
  datetime: string;
  amount: number;
  product: string;
  productCode: string;
  productId: number | null;
  catalogPrice: number | null;
  matchType: string;
  documentNumber: string;
  result: string;
  txnId: string;
}

export interface UsedProduct {
  productCode: string;
  product: string;
  timesUsed: number;
  lastDatetime: string;
  totalAmount: number;
}

export function createTxnRow(partial: Partial<TxnRow> & Pick<TxnRow, "datetime" | "amount">): TxnRow {
  return {
    rowId: partial.rowId ?? crypto.randomUUID().slice(0, 10),
    datetime: partial.datetime,
    originalDatetime: partial.originalDatetime ?? partial.datetime,
    amount: partial.amount,
    txnId: partial.txnId ?? "",
    imageName: partial.imageName ?? "",
    status: partial.status ?? "ok",
    skipped: partial.skipped ?? false,
    productId: partial.productId ?? null,
    productCode: partial.productCode ?? "",
    productName: partial.productName ?? "",
    catalogPrice: partial.catalogPrice ?? null,
    matchType: partial.matchType ?? "",
    saleNumber: partial.saleNumber ?? "",
    saleTotal: partial.saleTotal ?? null,
    result: partial.result ?? "",
    error: partial.error ?? "",
    paymentMethod: partial.paymentMethod === "cash" ? "cash" : "debit",
  };
}

export function isValidRow(row: TxnRow): boolean {
  return !row.skipped && row.status === "ok" && row.amount > 0 && Boolean(row.datetime);
}

export function displayStatus(row: TxnRow): string {
  if (row.result === "already added") return "Already added";
  if (row.result === "skipped" && row.error) {
    if (row.error.toLowerCase().includes("already") || row.error.includes("Duplicate")) {
      return "Already added";
    }
    return `Skipped · ${row.error}`;
  }
  if (row.result === "inserted") return "Inserted";
  if (row.result === "failed") return "Failed";
  if (row.result === "skipped") return "Skipped";
  if (row.skipped) return "Skipped";
  if (row.status === "error") return "Failed";
  if (row.status === "ok") return "Ready";
  return row.result || row.status || "Ready";
}
