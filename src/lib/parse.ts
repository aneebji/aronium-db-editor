import { createTxnRow, type OcrItem, type TxnRow } from "../types";

const IGNORE_RE =
  /transaction|history|print(?:able)?|summary|bluetooth|operations|filter|search|battery|wifi|cellular|drag images|png \/ jpg/gi;
const HEADER_ONLY_RE =
  /^(transactions?\s*history|print\s*transaction\s*summary|back)$/i;
const DATE_RE =
  /(?<day>\d{1,2})\s*(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|sop|5ep|s0p|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*(?<time>\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)/gi;
const TXN_RE = /(\d{10,})/;
const AMOUNT_RE = /(\d{1,5}[.,]\d{2})/g;

const MONTH_LOOKUP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  sop: 9,
  "5ep": 9,
  s0p: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function monthNumber(token: string): number | undefined {
  return MONTH_LOOKUP[token.toLowerCase().replace(/\.$/, "")];
}

export function parseAmount(text: string, txnId = ""): number | null {
  let cleaned = text;
  if (txnId) cleaned = cleaned.replaceAll(txnId, " ");
  const matches = [...cleaned.matchAll(AMOUNT_RE)].map((match) => match[1]);
  if (!matches.length) return null;
  const value = Number(matches[matches.length - 1].replace(",", "."));
  return value > 0 && value < 100000 ? value : null;
}

const DECLINED_TOKEN_RE = /^(DEC(?:LINED)?|DEO|DFC)$/i;

export function isDeclinedTxn(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, " ");
  DATE_RE.lastIndex = 0;
  const match = DATE_RE.exec(compact);
  if (!match || match.index == null) return false;
  return compact
    .slice(0, match.index)
    .trim()
    .split(/\s+/)
    .some((token) => DECLINED_TOKEN_RE.test(token));
}

function isHeaderOnly(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, " ");
  if (HEADER_ONLY_RE.test(compact)) return true;
  const leftover = compact.replace(IGNORE_RE, " ").replace(/[^\w.:]/g, " ").replace(/\s+/g, "");
  return leftover.length < 3;
}

export function parseDatetime(text: string, year: number): { iso: string; end: number } | null {
  DATE_RE.lastIndex = 0;
  const match = DATE_RE.exec(text);
  if (!match?.groups) return null;
  const day = Number(match.groups.day);
  const month = monthNumber(match.groups.month);
  if (!month) return null;
  let timeRaw = match.groups.time.replaceAll(".", ":");
  if ((timeRaw.match(/:/g) || []).length === 1) timeRaw += ":00";
  const [hh, mm, ss] = timeRaw.split(":").map((part) => part.padStart(2, "0"));
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")} ${hh}:${mm}:${ss}`;
  if (Number.isNaN(Date.parse(iso.replace(" ", "T")))) return null;
  return { iso, end: match.index + match[0].length };
}

export function parseLine(text: string, year: number): TxnRow | null {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact || isHeaderOnly(compact)) return null;
  const parsed = parseDatetime(compact, year);
  if (!parsed) return null;
  const rest = compact.slice(parsed.end);
  const txnMatch = TXN_RE.exec(rest) || TXN_RE.exec(compact);
  const txnId = txnMatch?.[1] ?? "";
  const amount = parseAmount(rest, txnId) ?? parseAmount(compact, txnId);
  if (isDeclinedTxn(compact)) {
    return createTxnRow({
      datetime: parsed.iso,
      amount: amount == null ? 0 : Math.round(amount * 100) / 100,
      txnId,
      status: "declined",
    });
  }
  if (amount == null) {
    return createTxnRow({ datetime: parsed.iso, amount: 0, txnId, status: "partial" });
  }
  return createTxnRow({ datetime: parsed.iso, amount: Math.round(amount * 100) / 100, txnId, status: "ok" });
}

export function extractFromBlob(blob: string, year: number): TxnRow[] {
  const cleaned = blob.replace(IGNORE_RE, " ").replace(/\s+/g, " ");
  const matches = [...cleaned.matchAll(new RegExp(DATE_RE.source, "gi"))];
  const rows: TxnRow[] = [];
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index ?? cleaned.length : cleaned.length;
    const start = match.index ?? 0;
    const lookback = cleaned.slice(Math.max(0, start - 48), start);
    const row = parseLine(lookback + cleaned.slice(start, end), year);
    if (row) rows.push(row);
  });
  return rows;
}

export function groupLines(items: OcrItem[], yTol = 22): Array<{ y: number; line: string }> {
  const prepared = items
    .filter((item) => item.text.trim())
    .map((item) => ({ y: item.y, x: item.x, text: item.text.trim() }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
  for (const item of prepared) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(item.y - last.y) <= yTol) last.parts.push({ x: item.x, text: item.text });
    else rows.push({ y: item.y, parts: [{ x: item.x, text: item.text }] });
  }
  return rows.map((row) => ({
    y: row.y,
    line: row.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.text)
      .join(" "),
  }));
}

export function collectAmounts(items: OcrItem[]): number[] {
  const values: Array<{ y: number; amount: number }> = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!text || new RegExp(DATE_RE.source, "i").test(text)) continue;
    const amount = parseAmount(text);
    if (amount == null || amount <= 0) continue;
    values.push({ y: item.y, amount });
  }
  return values.sort((a, b) => a.y - b.y).map((item) => item.amount);
}

export function rowsFromItems(items: OcrItem[], year: number): TxnRow[] {
  const rows: TxnRow[] = [];
  for (const { line } of groupLines(items)) rows.push(...extractFromBlob(line, year));
  rows.push(...extractFromBlob(items.map((item) => item.text).join(" "), year));
  return rows;
}

export function assignAmounts(rows: TxnRow[], amounts: number[]): void {
  if (!rows.length || !amounts.length) return;
  const ordered = [...rows].filter((row) => row.status !== "declined").sort((a, b) => b.datetime.localeCompare(a.datetime));
  if (ordered.length === amounts.length) {
    ordered.forEach((row, index) => {
      if (row.amount <= 0) {
        row.amount = amounts[index];
        row.status = "ok";
      }
    });
    return;
  }
  const used = amounts.map(() => false);
  for (const row of ordered) {
    if (row.amount > 0) {
      const hit = amounts.findIndex((amount, index) => !used[index] && Math.abs(amount - row.amount) < 0.001);
      if (hit >= 0) used[hit] = true;
      continue;
    }
    const next = used.findIndex((flag) => !flag);
    if (next >= 0) {
      row.amount = amounts[next];
      row.status = "ok";
      used[next] = true;
    }
  }
}

export function mergeTxnRows(rows: TxnRow[]): TxnRow[] {
  const byDt = new Map<string, TxnRow>();
  const extras: TxnRow[] = [];
  for (const row of rows) {
    if (row.status === "declined") {
      extras.push(row);
      continue;
    }
    const prev = byDt.get(row.datetime);
    if (!prev) {
      byDt.set(row.datetime, row);
      continue;
    }
    const differentTx = Boolean(prev.txnId && row.txnId && prev.txnId !== row.txnId);
    if (differentTx && prev.amount > 0 && row.amount > 0 && prev.amount !== row.amount) {
      extras.push(row);
      continue;
    }
    if (row.amount > 0 && prev.amount <= 0) {
      prev.amount = row.amount;
      prev.status = "ok";
    }
    if (row.txnId && !prev.txnId) prev.txnId = row.txnId;
    if (prev.amount > 0) prev.status = "ok";
  }
  return [...byDt.values(), ...extras];
}

export function finalizeRows(rows: TxnRow[], imageName: string): { rows: TxnRow[]; declined: number } {
  const seen = new Set<string>();
  const out: TxnRow[] = [];
  let declined = 0;
  for (const row of rows) {
    if (row.status === "declined") {
      const key = `dec|${row.datetime}|${row.amount}|${row.txnId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      declined += 1;
      continue;
    }
    if (row.amount <= 0) continue;
    row.status = "ok";
    const key = `${row.datetime}|${row.amount}|${row.txnId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    row.imageName = imageName;
    out.push(row);
  }
  return { rows: out.sort((a, b) => b.datetime.localeCompare(a.datetime)), declined };
}
