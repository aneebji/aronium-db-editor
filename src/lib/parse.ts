import { createTxnRow, type OcrItem, type TxnRow } from "../types";

const IGNORE_RE =
  /transaction|history|print(?:able)?|summary|bluetooth|operations|filter|search|battery|wifi|cellular|drag images|png \/ jpg/gi;
const HEADER_ONLY_RE =
  /^(transactions?\s*history|print\s*transaction\s*summary|back)$/i;
const DATE_RE =
  /(?<!\d)(?<day>\d{1,2})\s*(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|sop|5ep|s0p|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*(?<time>\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)/gi;
const TXN_RE = /(\d{12,14})/g;
const AMOUNT_RE = /(\d{1,5}[.,]\d{2})/g;
const CURRENCY_RE = /[﷼$€£¥]|SAR|SR|ر\.?\s*س/gi;

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

export function peelGluedAmount(datetime: string, amount: number): number {
  const seconds = datetime.replace("T", " ").slice(17, 19);
  if (!/^\d{2}$/.test(seconds) || amount < 100) return amount;
  const text = amount.toFixed(2);
  if (text[0] !== seconds[0]) return amount;
  const peeled = Number(text.slice(1));
  if (!(peeled > 0) || peeled >= 100) return amount;
  return Math.round(peeled * 100) / 100;
}

function parseTxnId(text: string): string {
  const matches = [...text.matchAll(TXN_RE)].map((match) => match[1]);
  if (!matches.length) return "";
  return matches.sort((left, right) => right.length - left.length)[0];
}

export function parseAmount(text: string, txnId = "", datetime = ""): number | null {
  let cleaned = text.replace(CURRENCY_RE, " ");
  if (txnId) cleaned = cleaned.replaceAll(txnId, " ");
  cleaned = cleaned.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
  const matches = [...cleaned.matchAll(AMOUNT_RE)].map((match) => match[1]);
  if (!matches.length) return null;
  let value = Number(matches[matches.length - 1].replace(",", "."));
  if (!(value > 0 && value < 100000)) return null;
  if (datetime) value = peelGluedAmount(datetime, value);
  return value;
}

const DECLINED_LETTERS = new Set(["DEC", "DECL", "DECLIN", "DECLINE", "DECLINED", "DEO", "DFC", "DLC", "OEC", "PEC", "BEC"]);

function lettersOnly(token: string): string {
  return token.replace(/[^A-Za-z]/g, "").toUpperCase();
}

export function isDeclinedToken(token: string): boolean {
  const letters = lettersOnly(token);
  if (!letters || letters === "DECEMBER" || letters.startsWith("APP")) return false;
  return DECLINED_LETTERS.has(letters) || (letters.startsWith("DEC") && letters !== "DECEMBER");
}

export function hasDeclinedType(text: string): boolean {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .split(/\s+/)
    .some((token) => isDeclinedToken(token));
}

export function isDeclinedTxn(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, " ");
  DATE_RE.lastIndex = 0;
  const match = DATE_RE.exec(compact);
  const before = match && match.index != null ? compact.slice(0, match.index) : compact;
  return hasDeclinedType(before);
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
  const txnId = parseTxnId(rest) || parseTxnId(compact);
  const amount = parseAmount(rest, txnId, parsed.iso) ?? parseAmount(compact, txnId, parsed.iso);
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

function prefixForDate(text: string, dateIndex: number): string {
  const lookback = text.slice(Math.max(0, dateIndex - 48), dateIndex);
  const prior = [...lookback.matchAll(new RegExp(DATE_RE.source, "gi"))];
  const last = prior[prior.length - 1];
  const afterPrior = last && last.index != null ? lookback.slice(last.index + last[0].length) : lookback;
  return afterPrior.replace(/[\d.,]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractFromBlob(blob: string, year: number): TxnRow[] {
  const cleaned = blob.replace(IGNORE_RE, " ").replace(/\s+/g, " ");
  const matches = [...cleaned.matchAll(new RegExp(DATE_RE.source, "gi"))];
  const rows: TxnRow[] = [];
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index ?? cleaned.length : cleaned.length;
    const start = match.index ?? 0;
    const prevEnd = index === 0 ? 0 : (matches[index - 1].index ?? 0) + matches[index - 1][0].length;
    const typeWindow = cleaned.slice(prevEnd, start);
    const row = parseLine(prefixForDate(cleaned, start) + cleaned.slice(start, end), year);
    if (!row) return;
    if (hasDeclinedType(typeWindow) || isDeclinedTxn(typeWindow + " " + cleaned.slice(start, end))) {
      row.status = "declined";
    }
    rows.push(row);
  });
  return rows;
}

export function groupLines(items: OcrItem[], yTol = 16): Array<{ y: number; line: string }> {
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

export function collectAmountPoints(items: OcrItem[]): Array<{ y: number; amount: number }> {
  const values: Array<{ y: number; amount: number }> = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!text || new RegExp(DATE_RE.source, "i").test(text)) continue;
    const amount = parseAmount(text);
    if (amount == null || amount <= 0) continue;
    values.push({ y: item.y, amount });
  }
  return values.sort((a, b) => a.y - b.y);
}

export function collectAmounts(items: OcrItem[]): number[] {
  return collectAmountPoints(items).map((item) => item.amount);
}

function leadingType(line: string): string {
  const token = line.trim().split(/\s+/)[0] ?? "";
  if (isDeclinedToken(token) || lettersOnly(token).startsWith("APP")) return token;
  return "";
}

function secondsApart(left: string, right: string): number {
  return Math.abs(Date.parse(left.replace(" ", "T")) - Date.parse(right.replace(" ", "T"))) / 1000;
}

function sameExtract(left: TxnRow, right: TxnRow): boolean {
  if (left.txnId.length >= 12 && left.txnId === right.txnId) return true;
  return secondsApart(left.datetime, right.datetime) <= 2;
}

export function rowsFromItems(items: OcrItem[], year: number): TxnRow[] {
  const rows: TxnRow[] = [];
  const lines = groupLines(items);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].line;
    const prevType = index > 0 ? leadingType(lines[index - 1].line) : "";
    const prefixed = prevType && !leadingType(line) ? `${prevType} ${line}` : line;
    for (const row of extractFromBlob(prefixed, year)) {
      row.ocrY = lines[index].y;
      rows.push(row);
    }
  }
  for (const row of extractFromBlob(items.map((item) => item.text).join(" "), year)) {
    if (!rows.some((prev) => sameExtract(prev, row))) rows.push(row);
  }
  return rows;
}

function amountPoints(amounts: number[] | Array<{ y: number; amount: number }>): Array<{ y: number; amount: number }> {
  return amounts.map((item) => (typeof item === "number" ? { y: Number.NaN, amount: item } : item));
}

export function assignAmounts(rows: TxnRow[], amounts: number[] | Array<{ y: number; amount: number }>): void {
  const points = amountPoints(amounts);
  if (!rows.length || !points.length) return;
  const live = rows.filter((row) => row.status !== "declined");
  const used = points.map(() => false);
  const canPair = live.some((row) => row.ocrY != null) && points.some((point) => Number.isFinite(point.y));

  if (canPair) {
    for (const row of [...live].sort((left, right) => (left.ocrY ?? 0) - (right.ocrY ?? 0))) {
      let best = -1;
      let bestDist = 20;
      points.forEach((point, index) => {
        if (used[index] || !Number.isFinite(point.y)) return;
        const dist = Math.abs((row.ocrY ?? 0) - point.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      });
      if (best < 0) continue;
      const paired = points[best].amount;
      if (row.amount <= 0 || peelGluedAmount(row.datetime, row.amount) === paired) {
        row.amount = paired;
        row.status = "ok";
      }
      used[best] = true;
    }
  }

  const ordered = [...live].sort((a, b) => b.datetime.localeCompare(a.datetime));
  const values = points.map((point) => point.amount);
  if (ordered.length === values.length) {
    ordered.forEach((row, index) => {
      if (row.amount <= 0) {
        row.amount = values[index];
        row.status = "ok";
      }
    });
  } else {
    for (const row of ordered) {
      if (row.amount > 0) {
        const hit = values.findIndex((amount, index) => !used[index] && Math.abs(amount - row.amount) < 0.001);
        if (hit >= 0) used[hit] = true;
        continue;
      }
      const next = used.findIndex((flag) => !flag);
      if (next >= 0) {
        row.amount = values[next];
        row.status = "ok";
        used[next] = true;
      }
    }
  }

  for (const row of live) {
    if (row.amount > 0) row.amount = peelGluedAmount(row.datetime, row.amount);
  }
}

function clockKey(row: TxnRow): string {
  if (row.txnId.length >= 12) return `id|${row.txnId}`;
  return `t|${row.datetime.replace("T", " ").slice(0, 19)}`;
}

function dayOf(row: TxnRow): number {
  return Number(row.datetime.slice(8, 10));
}

function keepBetter(prev: TxnRow, next: TxnRow): TxnRow {
  if (dayOf(next) > dayOf(prev)) {
    if (next.amount <= 0 && prev.amount > 0) next.amount = prev.amount;
    if (!next.txnId && prev.txnId) next.txnId = prev.txnId;
    return next;
  }
  if (next.amount > 0 && prev.amount <= 0) prev.amount = next.amount;
  if (next.txnId && !prev.txnId) prev.txnId = next.txnId;
  if (prev.amount > 0) prev.status = "ok";
  return prev;
}

function allKeys(row: TxnRow): string[] {
  const keys = [`t|${row.datetime.replace("T", " ").slice(0, 19)}`];
  if (row.txnId.length >= 12) keys.push(`id|${row.txnId}`);
  return keys;
}

export function mergeTxnRows(rows: TxnRow[]): TxnRow[] {
  const declinedKeys = new Set<string>();
  for (const row of rows) {
    if (row.status === "declined") {
      for (const key of allKeys(row)) declinedKeys.add(key);
    }
  }
  const byKey = new Map<string, TxnRow>();
  const extras: TxnRow[] = [];
  for (const row of rows) {
    if (row.status === "declined" || allKeys(row).some((key) => declinedKeys.has(key))) {
      extras.push({ ...row, status: "declined" });
      continue;
    }
    const key = clockKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const differentTx = Boolean(prev.txnId && row.txnId && prev.txnId !== row.txnId);
    const differentSale =
      prev.amount > 0 &&
      row.amount > 0 &&
      Math.abs(prev.amount - row.amount) > 0.005 &&
      secondsApart(prev.datetime, row.datetime) > 2;
    if ((differentTx || differentSale) && prev.amount > 0 && row.amount > 0) {
      extras.push(row);
      continue;
    }
    byKey.set(key, keepBetter(prev, row));
  }
  return [...byKey.values(), ...extras];
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

const DUP_WINDOW_SECONDS = 3;

function rowClock(row: TxnRow): string {
  return (row.originalDatetime || row.datetime).replace("T", " ").slice(0, 19);
}

export function dedupeByDatetimeAmount(rows: TxnRow[]): TxnRow[] {
  const kept: TxnRow[] = [];
  for (const row of rows) {
    if (row.origin === "extra") {
      kept.push(row);
      continue;
    }
    const clock = rowClock(row);
    const duplicate = kept.some((prev) => {
      if (prev.origin === "extra") return false;
      return Math.abs(prev.amount - row.amount) < 0.005 && secondsApart(rowClock(prev), clock) <= DUP_WINDOW_SECONDS;
    });
    if (!duplicate) kept.push(row);
  }
  return kept;
}
