import { addSeconds, formatDateTime } from "./aronium";
import { createTxnRow, isValidRow, type Product, type TxnRow } from "../types";

const EXTRA_NEAR_MIN = 30;
const EXTRA_NEAR_MAX = 180;
const EXTRA_COUNT_MAX = 50;
const EXTRA_PRICE_MIN = 35;
const EXTRA_PRICE_MAX = 50;

function extraCashAmount(): number {
  return EXTRA_PRICE_MIN + Math.floor(Math.random() * (EXTRA_PRICE_MAX - EXTRA_PRICE_MIN + 1));
}

export function dateKey(datetime: string): string {
  return formatDateTime(datetime).slice(0, 10);
}

export interface ProductReservation {
  datetime: string;
  productId: number | null;
  productCode?: string;
}

function codeKey(code: string | undefined): string {
  return String(code ?? "").trim().toLowerCase();
}

function usedOnDate(byDate: Map<string, { ids: Set<number>; codes: Set<string> }>, datetime: string) {
  const day = dateKey(datetime);
  let used = byDate.get(day);
  if (!used) {
    used = { ids: new Set(), codes: new Set() };
    byDate.set(day, used);
  }
  return used;
}

function markUsed(
  byDate: Map<string, { ids: Set<number>; codes: Set<string> }>,
  datetime: string,
  product: Pick<Product, "id" | "code">,
): void {
  const used = usedOnDate(byDate, datetime);
  used.ids.add(product.id);
  const code = codeKey(product.code);
  if (code) used.codes.add(code);
}

function seedUsed(reserved: ProductReservation[] = []): Map<string, { ids: Set<number>; codes: Set<string> }> {
  const byDate = new Map<string, { ids: Set<number>; codes: Set<string> }>();
  for (const item of reserved) {
    if (item.productId == null) continue;
    markUsed(byDate, item.datetime, { id: item.productId, code: item.productCode ?? "" });
  }
  return byDate;
}

export function pickProduct(
  products: Product[],
  amount: number,
  exclude?: { ids?: Set<number>; codes?: Set<string> },
): { product: Product | null; matchType: string } {
  const usable = products.filter((product) => {
    if (product.price <= 0) return false;
    if (exclude?.ids?.has(product.id)) return false;
    const code = codeKey(product.code);
    if (code && exclude?.codes?.has(code)) return false;
    return true;
  });
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

export function matchRows(rows: TxnRow[], products: Product[], reserved: ProductReservation[] = []): TxnRow[] {
  const byDate = seedUsed(reserved);
  for (const row of rows) {
    if (!isValidRow(row)) {
      row.productId = null;
      row.productCode = "";
      row.productName = "";
      row.catalogPrice = null;
      row.matchType = row.skipped ? "skipped" : "none";
      continue;
    }
    const used = usedOnDate(byDate, row.datetime);
    const { product, matchType } = pickProduct(products, row.amount, used);
    if (!product) {
      row.productId = null;
      row.productCode = "";
      row.productName = "";
      row.catalogPrice = null;
      row.matchType = "none";
      row.status = "error";
      row.error = "No unused product for this date";
      continue;
    }
    row.productId = product.id;
    row.productCode = product.code;
    row.productName = product.name;
    row.catalogPrice = product.price;
    row.matchType = matchType;
    row.error = "";
    if (row.status !== "ok") row.status = "ok";
    markUsed(byDate, row.datetime, product);
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
  reserved: ProductReservation[] = [],
): TxnRow[] {
  const usable = products.filter((product) => product.price > 0);
  const n = Math.min(EXTRA_COUNT_MAX, Math.max(0, Math.floor(count)));
  if (!usable.length || n < 1 || !anchorDatetime) return [];
  const taken = new Set(takenDatetimes);
  const byDate = seedUsed(reserved);
  const rows: TxnRow[] = [];
  let attempts = 0;
  while (rows.length < n && attempts < n * 20) {
    attempts += 1;
    const datetime = nearbySaleDatetime(anchorDatetime, taken);
    const amount = extraCashAmount();
    const { product, matchType } = pickProduct(usable, amount, usedOnDate(byDate, datetime));
    if (!product) continue;
    taken.add(datetime);
    markUsed(byDate, datetime, product);
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
