import type { Database } from "sql.js";
import type { CatalogProduct, LedgerSale, Product, TxnRow } from "../types";
import { isBlockedProduct } from "./product-flags";
import { activeBranch } from "./settings";

const SALES_TYPE_ID = 2;
const SALES_TYPE_CODE = 200;
const WAREHOUSE_ID = 1;
const USER_ID = 1;
const CUSTOMER_ID = 1;
const PAID_STATUS = 2;
const DEBIT_CARD_TYPE_ID = 3;
const CASH_TYPE_ID = 1;
const DEFAULT_TAX_RATE = 15;

function scalar<T = unknown>(db: Database, sql: string, params: unknown[] = []): T | undefined {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params as never[]);
    if (!stmt.step()) return undefined;
    return stmt.get()[0] as T;
  } finally {
    stmt.free();
  }
}

function lastId(db: Database): number {
  return Number(scalar(db, "SELECT last_insert_rowid()") ?? 0);
}

export function loadProducts(db: Database): Product[] {
  const stmt = db.prepare(
    "SELECT Id, Name, Code, Price FROM Product WHERE IsEnabled = 1 AND Price > 0 ORDER BY Name",
  );
  const products: Product[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    products.push({
      id: Number(row.Id),
      name: String(row.Name ?? ""),
      code: String(row.Code ?? ""),
      price: Number(row.Price),
    });
  }
  stmt.free();
  return products;
}

export function loadCatalog(db: Database): CatalogProduct[] {
  const stmt = db.prepare("SELECT Id, Name, Code, Price, IsEnabled FROM Product ORDER BY Name");
  const products: CatalogProduct[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    products.push({
      id: Number(row.Id),
      name: String(row.Name ?? ""),
      code: String(row.Code ?? ""),
      price: Number(row.Price),
      enabled: Boolean(Number(row.IsEnabled ?? 0)),
    });
  }
  stmt.free();
  return products;
}

export function formatDateTime(value: unknown): string {
  return String(value ?? "").replace("T", " ").slice(0, 19);
}

const SALE_TIME_SHIFT_MIN = 7;
const SALE_TIME_SHIFT_MAX = 20;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function addSeconds(datetime: string, seconds: number): string {
  const normalized = formatDateTime(datetime);
  const [datePart, timePart = "00:00:00"] = normalized.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0);
  date.setSeconds(date.getSeconds() + seconds);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function randomSaleOffsetSeconds(): number {
  return (
    SALE_TIME_SHIFT_MIN +
    Math.floor(Math.random() * (SALE_TIME_SHIFT_MAX - SALE_TIME_SHIFT_MIN + 1))
  );
}

export function applySaleTimeOffsets(rows: TxnRow[]): TxnRow[] {
  const used = new Set<string>();
  for (const row of rows) {
    const original = formatDateTime(row.originalDatetime || row.datetime);
    row.originalDatetime = original;
    let next = addSeconds(original, randomSaleOffsetSeconds());
    for (let attempt = 0; attempt < 30 && used.has(next); attempt += 1) {
      next = addSeconds(original, randomSaleOffsetSeconds());
    }
    used.add(next);
    row.datetime = next;
  }
  return rows;
}

function productLabel(name: string, itemCount: number): string {
  const extra = Math.max(0, itemCount - 1);
  const label = name.trim();
  if (label && extra) return `${label} + ${extra} more`;
  if (label) return label;
  if (itemCount > 1) return `${itemCount} items`;
  return "";
}

export function loadSales(db: Database): Omit<LedgerSale, "source">[] {
  const stmt = db.prepare(
    `SELECT
        d.Id AS DocumentId,
        d.Number AS Number,
        d.DateCreated AS DateCreated,
        d.Total AS Total,
        d.InternalNote AS InternalNote,
        di.ProductId AS ProductId,
        p.Code AS Code,
        p.Name AS Name,
        (SELECT COUNT(*) FROM DocumentItem x WHERE x.DocumentId = d.Id) AS ItemCount
      FROM Document d
      LEFT JOIN DocumentItem di
        ON di.DocumentId = d.Id
        AND di.Id = (SELECT MIN(Id) FROM DocumentItem WHERE DocumentId = d.Id)
      LEFT JOIN Product p ON p.Id = di.ProductId
      WHERE d.DocumentTypeId = ?
      ORDER BY d.DateCreated DESC, d.Id DESC`,
  );
  stmt.bind([SALES_TYPE_ID]);
  const sales: Omit<LedgerSale, "source">[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const itemCount = Number(row.ItemCount ?? 0);
    const productName = String(row.Name ?? "");
    sales.push({
      documentId: Number(row.DocumentId),
      datetime: formatDateTime(row.DateCreated),
      amount: Number(row.Total ?? 0),
      productCode: String(row.Code ?? ""),
      product: productLabel(productName, itemCount),
      productId: row.ProductId == null ? null : Number(row.ProductId),
      extraItems: Math.max(0, itemCount - 1),
      documentNumber: String(row.Number ?? ""),
      internalNote: String(row.InternalNote ?? ""),
    });
  }
  stmt.free();
  return sales;
}

function taxRate(db: Database): number {
  const rate = scalar<number>(db, "SELECT Rate FROM Tax WHERE IsEnabled = 1 ORDER BY Id LIMIT 1");
  return rate == null ? DEFAULT_TAX_RATE : Number(rate);
}

function taxId(db: Database): number {
  return Number(scalar(db, "SELECT Id FROM Tax WHERE IsEnabled = 1 ORDER BY Id LIMIT 1") ?? 1);
}

function paymentTypeId(db: Database, method: "debit" | "cash" = "debit"): number {
  if (method === "cash") {
    const cash = scalar<number>(db, "SELECT Id FROM PaymentType WHERE Name LIKE '%Cash%' LIMIT 1");
    if (cash != null) return Number(cash);
    return Number(scalar(db, "SELECT Id FROM PaymentType ORDER BY Id LIMIT 1") ?? CASH_TYPE_ID);
  }
  const card = scalar<number>(
    db,
    "SELECT Id FROM PaymentType WHERE Name LIKE '%Debit%' OR Name LIKE '%Card%' LIMIT 1",
  );
  if (card != null) return Number(card);
  return Number(scalar(db, "SELECT Id FROM PaymentType ORDER BY Id LIMIT 1") ?? DEBIT_CARD_TYPE_ID);
}

function productSoldOnDate(db: Database, productId: number, datetime: string): boolean {
  const day = formatDateTime(datetime).slice(0, 10);
  const found = scalar(
    db,
    `SELECT d.Number FROM Document d
     JOIN DocumentItem di ON di.DocumentId = d.Id
     WHERE d.DocumentTypeId = ?
       AND di.ProductId = ?
       AND (substr(d.DateCreated, 1, 10) = ? OR substr(d.Date, 1, 10) = ?)
     LIMIT 1`,
    [SALES_TYPE_ID, productId, day, day],
  );
  return found != null;
}

function existingSaleNumber(db: Database, originalDatetime: string): string {
  const second = formatDateTime(originalDatetime);
  const number = scalar<string>(
    db,
    `SELECT Number FROM Document
     WHERE DateCreated = ?
        OR DateCreated LIKE ?
        OR InternalNote LIKE ?
     LIMIT 1`,
    [second, `${second}.%`, `%${second}%`],
  );
  return number ? String(number) : "";
}

function counter(db: Database, name: string, fallback = 0): number {
  const value = scalar<number>(db, "SELECT Value FROM Counter WHERE Name = ?", [name]);
  if (value == null) {
    db.run("INSERT INTO Counter (Name, Value) VALUES (?, ?)", [name, fallback]);
    return fallback;
  }
  return Number(value);
}

function setCounter(db: Database, name: string, value: number): void {
  db.run("UPDATE Counter SET Value = ? WHERE Name = ?", [value, name]);
}

export function ocrBatchNote(batchId: number, originalDatetime?: string): string {
  const prefix = `OCR batch ${batchId}`;
  return originalDatetime ? `${prefix} · ${formatDateTime(originalDatetime)}` : prefix;
}

export function insertSale(db: Database, row: TxnRow, batchId?: number): TxnRow {
  if (row.skipped) {
    row.result = "skipped";
    return row;
  }
  if (!row.productId) {
    row.result = "failed";
    row.error = "No matched product";
    return row;
  }
  if (isBlockedProduct({ code: row.productCode, name: row.productName }, activeBranch().id)) {
    row.result = "failed";
    row.error = "Blocked product";
    return row;
  }
  const originalDt = formatDateTime(row.originalDatetime || row.datetime);
  const amount = Number(row.amount);

  const existing = existingSaleNumber(db, originalDt);
  if (existing) {
    row.result = "already added";
    row.saleNumber = existing;
    row.saleTotal = amount;
    row.error = "Already added at this DateTime";
    return row;
  }

  let dt = formatDateTime(row.datetime);
  if (dt === originalDt) {
    dt = addSeconds(originalDt, randomSaleOffsetSeconds());
  }
  if (productSoldOnDate(db, row.productId, dt) || productSoldOnDate(db, row.productId, originalDt)) {
    row.result = "failed";
    row.error = "Product already used this date";
    return row;
  }
  const dateOnly = `${dt.split(" ")[0]} 00:00:00`;
  const year = Number(dt.slice(2, 4));

  try {
    db.run("BEGIN IMMEDIATE");
    const rate = taxRate(db);
    const tax = taxId(db);
    const payType = paymentTypeId(db, row.paymentMethod === "cash" ? "cash" : "debit");
    const docCounterName = `Document.${SALES_TYPE_CODE}.20${year.toString().padStart(2, "0")}`;
    const nextSeq = counter(db, docCounterName, 0) + 1;
    const nextReceipt = counter(db, "Receipt", 0) + 1;
    const number = `${year.toString().padStart(2, "0")}-${SALES_TYPE_CODE}-${nextSeq.toString().padStart(6, "0")}`;
    const priceBeforeTax = Math.round((amount / (1 + rate / 100)) * 10000) / 10000;
    const taxAmount = Math.round((amount - priceBeforeTax) * 10000) / 10000;

    db.run(
      `INSERT INTO Document (
        Number, UserId, CustomerId, OrderNumber, Date, StockDate, Total,
        IsClockedOut, DocumentTypeId, WarehouseId, ReferenceDocumentNumber,
        DateCreated, DateUpdated, InternalNote, Note, DueDate, Discount,
        DiscountType, PaidStatus, DiscountApplyRule, ServiceType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, 0, ?, 0, 1)`,
      [
        number,
        USER_ID,
        CUSTOMER_ID,
        String(nextReceipt),
        dateOnly,
        dt,
        amount,
        SALES_TYPE_ID,
        WAREHOUSE_ID,
        dt,
        dt,
        batchId != null ? ocrBatchNote(batchId, originalDt) : null,
        dateOnly,
        PAID_STATUS,
      ],
    );
    const documentId = lastId(db);
    db.run(
      `INSERT INTO DocumentItem (
        DocumentId, ProductId, Quantity, ExpectedQuantity, PriceBeforeTax, Price,
        Discount, DiscountType, ProductCost, PriceBeforeTaxAfterDiscount,
        PriceAfterDiscount, Total, TotalAfterDocumentDiscount, DiscountApplyRule
      ) VALUES (?, ?, 1, 0, ?, ?, 0, 0, 0, ?, ?, ?, ?, 0)`,
      [documentId, row.productId, priceBeforeTax, amount, priceBeforeTax, amount, amount, amount],
    );
    const itemId = lastId(db);
    db.run("INSERT INTO DocumentItemTax (DocumentItemId, TaxId, Amount) VALUES (?, ?, ?)", [
      itemId,
      tax,
      taxAmount,
    ]);
    db.run(
      `INSERT INTO Payment (
        DocumentId, PaymentTypeId, Amount, Date, UserId, ZReportId, DateCreated
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [documentId, payType, amount, dateOnly, USER_ID, dt],
    );
    setCounter(db, docCounterName, nextSeq);
    setCounter(db, "Receipt", nextReceipt);

    const stockId = scalar<number>(
      db,
      "SELECT Id FROM Stock WHERE ProductId = ? AND WarehouseId = ?",
      [row.productId, WAREHOUSE_ID],
    );
    if (stockId != null) {
      db.run("UPDATE Stock SET Quantity = Quantity - 1 WHERE Id = ?", [Number(stockId)]);
    } else {
      db.run("INSERT INTO Stock (ProductId, WarehouseId, Quantity) VALUES (?, ?, -1)", [
        row.productId,
        WAREHOUSE_ID,
      ]);
    }
    db.run("COMMIT");
    row.datetime = dt;
    row.saleNumber = number;
    row.saleTotal = amount;
    row.result = "inserted";
    row.error = "";
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
  return row;
}

export function insertRows(db: Database, rows: TxnRow[], batchId?: number): TxnRow[] {
  const queue = [...rows].sort((left, right) => {
    const a = formatDateTime(left.datetime);
    const b = formatDateTime(right.datetime);
    if (a !== b) return a.localeCompare(b);
    return formatDateTime(left.originalDatetime || a).localeCompare(formatDateTime(right.originalDatetime || b));
  });
  for (const row of queue) {
    if (row.skipped) {
      row.result = "skipped";
      continue;
    }
    try {
      insertSale(db, row, batchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      row.result = "failed";
      row.error = /locked/i.test(message) ? "The database is locked. Close Aronium and try again." : message;
    }
  }
  return rows;
}
