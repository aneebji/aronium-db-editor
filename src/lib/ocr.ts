import Tesseract from "tesseract.js";
import { applySaleTimeOffsets } from "./aronium";
import {
  cropBand,
  cropRight,
  invertIfDark,
  prepareSlipImage,
  type CardBand,
} from "./ocr-preprocess";
import {
  assignAmounts,
  collectAmountPoints,
  dedupeByDatetimeAmount,
  finalizeRows,
  mergeTxnRows,
  rowsFromItems,
  rowsFromLineText,
} from "./parse";
import type { OcrItem, TxnRow } from "../types";

let lastOcrText = "";
let lastDeclinedCount = 0;
let workerPromise: Promise<Tesseract.Worker> | null = null;

const TOKEN_KEEP = /\d{1,2}[:.]\d{2}|\d+[.,]\d{2}/;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) workerPromise = Tesseract.createWorker("eng", 1);
  return workerPromise;
}

export async function releaseOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

function pageToItems(page: Tesseract.Page, offsetX = 0, offsetY = 0): OcrItem[] {
  const items: OcrItem[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text.trim();
          if (!text) continue;
          const confidence = word.confidence ?? 0;
          if (confidence < 40 && !TOKEN_KEEP.test(text)) continue;
          items.push({
            x: (word.bbox.x0 + word.bbox.x1) / 2 + offsetX,
            y: (word.bbox.y0 + word.bbox.y1) / 2 + offsetY,
            text,
            confidence,
          });
        }
      }
    }
  }
  if (!items.length && page.text) {
    page.text.split(/\n/).forEach((line, index) => {
      if (line.trim()) items.push({ x: offsetX, y: offsetY + index * 24, text: line.trim() });
    });
  }
  return items;
}

type RecognizeMode = "full" | "line" | "amounts";

async function recognize(
  source: HTMLCanvasElement | File | Blob,
  mode: RecognizeMode,
  offsetX = 0,
  offsetY = 0,
): Promise<{ items: OcrItem[]; text: string }> {
  const worker = await getWorker();
  const psm = mode === "line" ? "7" : mode === "amounts" ? "4" : "6";
  await worker.setParameters({
    tessedit_pageseg_mode: psm as Tesseract.PSM,
    preserve_interword_spaces: "1",
    user_defined_dpi: "220",
    ...(mode === "amounts" ? { tessedit_char_whitelist: "0123456789.," } : { tessedit_char_whitelist: "" }),
  });
  const result = await worker.recognize(source);
  const text = result.data.text || "";
  return { items: pageToItems(result.data, offsetX, offsetY), text };
}

async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function readCard(
  page: HTMLCanvasElement,
  card: CardBand,
  year: number,
): Promise<{ rows: TxnRow[]; amounts: Array<{ y: number; amount: number }>; text: string }> {
  const midY = card.y + card.height / 2;
  const line = invertIfDark(cropBand(page, card));
  const { items, text } = await recognize(line, "line", card.x, card.y);
  const rows = rowsFromLineText(text, year, midY);
  if (!rows.length) {
    for (const row of rowsFromItems(items, year)) {
      row.ocrY = midY;
      rows.push(row);
    }
  } else {
    for (const row of rows) row.ocrY = midY;
  }
  let amounts = collectAmountPoints(items.filter((item) => item.x >= card.x + card.width * 0.62));
  try {
    const strip = invertIfDark(cropRight(line, 0.78));
    const column = await recognize(strip, "amounts", card.x + Math.floor(card.width * 0.78), card.y);
    const points = collectAmountPoints(column.items).map((point) => ({ ...point, y: midY }));
    if (points.length) amounts = points;
  } catch {
    /* amount strip optional */
  }
  return { rows, amounts, text };
}

async function readFullPage(
  page: HTMLCanvasElement,
  year: number,
): Promise<{ rows: TxnRow[]; amounts: Array<{ y: number; amount: number }>; text: string }> {
  const full = await recognize(page, "full");
  const rows = rowsFromItems(full.items, year);
  let amounts = collectAmountPoints(full.items);
  try {
    const column = await recognize(cropRight(page, 0.72), "amounts");
    const points = collectAmountPoints(column.items);
    if (points.length >= 2) amounts = points;
  } catch {
    /* amount column optional */
  }
  return { rows, amounts, text: full.text };
}

export async function extractTransactions(file: File, year: number): Promise<TxnRow[]> {
  const prepared = prepareSlipImage(await loadImage(file));
  const texts: string[] = [];
  let parsed: TxnRow[] = [];
  let amounts: Array<{ y: number; amount: number }> = [];

  if (prepared.cards.length >= 2) {
    for (const card of prepared.cards) {
      const read = await readCard(prepared.canvas, card, year);
      parsed.push(...read.rows);
      amounts.push(...read.amounts);
      if (read.text.trim()) texts.push(read.text.trim());
    }
  }

  if (parsed.length < 2) {
    const full = await readFullPage(prepared.canvas, year);
    parsed = full.rows;
    if (full.amounts.length) amounts = full.amounts;
    if (full.text.trim()) texts.push(full.text.trim());
  }

  lastOcrText = texts.join("\n");
  parsed = mergeTxnRows(parsed);
  assignAmounts(parsed, amounts);
  const finalized = finalizeRows(parsed, file.name);
  lastDeclinedCount = finalized.declined;
  return finalized.rows;
}

export async function extractMany(files: File[], year: number): Promise<TxnRow[]> {
  const rows: TxnRow[] = [];
  let declined = 0;
  try {
    for (const file of files) {
      rows.push(...(await extractTransactions(file, year)));
      declined += lastDeclinedCount;
    }
  } finally {
    await releaseOcrWorker();
  }
  lastDeclinedCount = declined;
  const unique = dedupeByDatetimeAmount(rows);
  return applySaleTimeOffsets(unique).sort((a, b) => b.datetime.localeCompare(a.datetime));
}

export function getLastOcrText(): string {
  return lastOcrText;
}

export function getLastDeclinedCount(): number {
  return lastDeclinedCount;
}
