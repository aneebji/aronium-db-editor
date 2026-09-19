import type { Database } from "sql.js";
import type { CatalogProduct, LedgerSale } from "../types";
import { loadCatalog, loadSales } from "./aronium";
import { batchIdForDocument, listBatches } from "./history";

const NOTE_RE = /^OCR batch (\d+)/i;

export function saleSource(internalNote: string, documentNumber: string): string {
  const match = internalNote.trim().match(NOTE_RE);
  if (match) return `Batch ${match[1]}`;
  const batchId = batchIdForDocument(documentNumber);
  if (batchId != null) return `Batch ${batchId}`;
  return "Original";
}

export function ledgerSales(db: Database): LedgerSale[] {
  return loadSales(db).map((sale) => ({
    ...sale,
    source: saleSource(sale.internalNote, sale.documentNumber),
  }));
}

export function ledgerSnapshot(db: Database | null): {
  attached: boolean;
  products: CatalogProduct[];
  sales: LedgerSale[];
  productCount: number;
  salesCount: number;
  ledgerTotal: number;
  ocrBatches: number;
} {
  const ocrBatches = listBatches().length;
  if (!db) {
    return {
      attached: false,
      products: [],
      sales: [],
      productCount: 0,
      salesCount: 0,
      ledgerTotal: 0,
      ocrBatches,
    };
  }
  const products = loadCatalog(db);
  const sales = ledgerSales(db);
  return {
    attached: true,
    products,
    sales,
    productCount: products.length,
    salesCount: sales.length,
    ledgerTotal: sales.reduce((sum, sale) => sum + sale.amount, 0),
    ocrBatches,
  };
}
