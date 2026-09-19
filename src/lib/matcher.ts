import { isValidRow, type Product, type TxnRow } from "../types";

export function pickProduct(products: Product[], amount: number): { product: Product | null; matchType: string } {
  const usable = products.filter((product) => product.price > 0);
  if (!usable.length) return { product: null, matchType: "none" };

  const exact = usable.filter((product) => Math.abs(product.price - amount) < 0.005);
  if (exact.length) return { product: exact[Math.floor(Math.random() * exact.length)], matchType: "exact" };

  for (const window of [20, 50, null] as const) {
    const pool = window == null ? usable : usable.filter((product) => Math.abs(product.price - amount) <= window);
    if (!pool.length) continue;
    const nearest = Math.min(...pool.map((product) => Math.abs(product.price - amount)));
    const bandPrices = new Set(
      pool.filter((product) => Math.abs(Math.abs(product.price - amount) - nearest) < 0.01).map((product) => product.price),
    );
    const band = pool.filter((product) => bandPrices.has(product.price));
    return { product: band[Math.floor(Math.random() * band.length)], matchType: "nearby" };
  }
  return { product: null, matchType: "none" };
}

export function matchRows(rows: TxnRow[], products: Product[]): TxnRow[] {
  for (const row of rows) {
    if (!isValidRow(row)) {
      row.productId = null;
      row.productCode = "";
      row.productName = "";
      row.catalogPrice = null;
      row.matchType = row.skipped ? "skipped" : "none";
      continue;
    }
    const { product, matchType } = pickProduct(products, row.amount);
    if (!product) {
      row.productId = null;
      row.productCode = "";
      row.productName = "";
      row.catalogPrice = null;
      row.matchType = "none";
      row.status = "error";
      row.error = "No product found";
      continue;
    }
    row.productId = product.id;
    row.productCode = product.code;
    row.productName = product.name;
    row.catalogPrice = product.price;
    row.matchType = matchType;
    row.error = "";
    if (row.status !== "ok") row.status = "ok";
  }
  return rows;
}
