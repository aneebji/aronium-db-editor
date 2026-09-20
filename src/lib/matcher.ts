import { addSeconds } from "./aronium";
import { createTxnRow, isValidRow, type Product, type TxnRow } from "../types";

const EXTRA_NEAR_MIN = 30;
const EXTRA_NEAR_MAX = 180;
const EXTRA_COUNT_MAX = 50;
const EXTRA_PRICE_MIN = 35;
const EXTRA_PRICE_MAX = 50;

function extraCashAmount(): number {
  return EXTRA_PRICE_MIN + Math.floor(Math.random() * (EXTRA_PRICE_MAX - EXTRA_PRICE_MIN + 1));
}

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

export function extractDatetimes(rows: TxnRow[]): string[] {
  return [...new Set(rows.filter((row) => row.origin !== "extra").map((row) => row.datetime))].sort((a, b) =>
    b.localeCompare(a),
  );
}

export function nearbySaleDatetime(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const magnitude = EXTRA_NEAR_MIN + Math.floor(Math.random() * (EXTRA_NEAR_MAX - EXTRA_NEAR_MIN + 1));
    const next = addSeconds(base, (Math.random() < 0.5 ? -1 : 1) * magnitude);
    if (!used.has(next)) return next;
  }
  return addSeconds(base, EXTRA_NEAR_MAX + 1 + Math.floor(Math.random() * 60));
}

export function createExtraCashSales(
  anchorDatetime: string,
  count: number,
  products: Product[],
  takenDatetimes: string[],
): TxnRow[] {
  const usable = products.filter((product) => product.price > 0);
  const n = Math.min(EXTRA_COUNT_MAX, Math.max(0, Math.floor(count)));
  if (!usable.length || n < 1 || !anchorDatetime) return [];
  const taken = new Set(takenDatetimes);
  const rows: TxnRow[] = [];
  let attempts = 0;
  while (rows.length < n && attempts < n * 8) {
    attempts += 1;
    const amount = extraCashAmount();
    const { product, matchType } = pickProduct(usable, amount);
    if (!product) continue;
    const datetime = nearbySaleDatetime(anchorDatetime, taken);
    taken.add(datetime);
    rows.push(
      createTxnRow({
        datetime,
        originalDatetime: datetime,
        amount,
        paymentMethod: "cash",
        origin: "extra",
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        catalogPrice: product.price,
        matchType: matchType || "extra",
      }),
    );
  }
  return rows;
}
