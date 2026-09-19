import type { Database } from "sql.js";
import type { Product, TxnRow } from "../types";

const SALES_TYPE_ID = 2;
const SALES_TYPE_CODE = 200;
const WAREHOUSE_ID = 1;
const USER_ID = 1;
const CUSTOMER_ID = 1;
const PAID_STATUS = 2;
const DEBIT_CARD_TYPE_ID = 3;
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

function taxRate(db: Database): number {
  const rate = scalar<number>(db, "SELECT Rate FROM Tax WHERE IsEnabled = 1 ORDER BY Id LIMIT 1");
  return rate == null ? DEFAULT_TAX_RATE : Number(rate);
}

function taxId(db: Database): number {
  return Number(scalar(db, "SELECT Id FROM Tax WHERE IsEnabled = 1 ORDER BY Id LIMIT 1") ?? 1);
}

function paymentTypeId(db: Database): number {
  const card = scalar<number>(
    db,
    "SELECT Id FROM PaymentType WHERE Name LIKE '%Debit%' OR Name LIKE '%Card%' LIMIT 1",
  );
  if (card != null) return Number(card);
  return Number(scalar(db, "SELECT Id FROM PaymentType ORDER BY Id LIMIT 1") ?? DEBIT_CARD_TYPE_ID);
}

function existingSaleNumber(db: Database, dt: string): string {
  const second = dt.slice(0, 19);
  const number = scalar<string>(
    db,
    "SELECT Number FROM Document WHERE DateCreated = ? OR DateCreated LIKE ? LIMIT 1",
    [second, `${second}.%`],
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

export function insertSale(db: Database, row: TxnRow): TxnRow {
  if (row.skipped) {
    row.result = "skipped";
    return row;
  }
  if (!row.productId) {
    row.result = "failed";
    row.error = "No matched product";
    return row;
  }
  const dt = row.datetime;
  const dateOnly = `${dt.split(" ")[0]} 00:00:00`;
  const year = Number(dt.slice(2, 4));
  const amount = Number(row.amount);

  const existing = existingSaleNumber(db, dt);
  if (existing) {
    row.result = "already added";
    row.saleNumber = existing;
    row.saleTotal = amount;
    row.error = "Already added at this DateTime";
    return row;
  }

  try {
    db.run("BEGIN IMMEDIATE");
    const rate = taxRate(db);
    const tax = taxId(db);
    const payType = paymentTypeId(db);
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL, ?, 0, 0, ?, 0, 1)`,
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

export function insertRows(db: Database, rows: TxnRow[]): TxnRow[] {
  for (const row of rows) {
    if (row.skipped) {
      row.result = "skipped";
      continue;
    }
    try {
      insertSale(db, row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      row.result = "failed";
      row.error = /locked/i.test(message) ? "Database locked. Close Aronium and retry." : message;
    }
  }
  return rows;
}
