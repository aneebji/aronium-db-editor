import Tesseract from "tesseract.js";
import { applySaleTimeOffsets } from "./aronium";
import { assignAmounts, collectAmountPoints, dedupeByDatetimeAmount, finalizeRows, mergeTxnRows, rowsFromItems } from "./parse";
import type { OcrItem, TxnRow } from "../types";

let lastOcrText = "";
let lastDeclinedCount = 0;

function pageToItems(page: Tesseract.Page): OcrItem[] {
  const items: OcrItem[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text.trim();
          if (!text) continue;
          items.push({
            x: (word.bbox.x0 + word.bbox.x1) / 2,
            y: (word.bbox.y0 + word.bbox.y1) / 2,
            text,
          });
        }
      }
    }
  }
  if (!items.length && page.text) {
    page.text.split(/\n/).forEach((line, index) => {
      if (line.trim()) items.push({ x: 0, y: index * 24, text: line.trim() });
    });
  }
  return items;
}

async function recognize(
  source: HTMLCanvasElement | File | Blob,
  mode: "full" | "amounts" = "full",
): Promise<OcrItem[]> {
  const worker = await Tesseract.createWorker("eng", 1);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: (mode === "amounts" ? "4" : "6") as Tesseract.PSM,
      preserve_interword_spaces: "1",
      user_defined_dpi: "220",
      ...(mode === "amounts" ? { tessedit_char_whitelist: "0123456789.," } : {}),
    });
    const result = await worker.recognize(source);
    if (mode === "full") lastOcrText = result.data.text || "";
    return pageToItems(result.data);
  } finally {
    await worker.terminate();
  }
}

function enhanceForOcr(image: HTMLCanvasElement): HTMLCanvasElement {
  const scale = image.width < 1400 ? 2.4 : image.width < 2000 ? 1.8 : 1.35;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(image.width * scale));
  out.height = Math.max(1, Math.round(image.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return image;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) contrast(1.35) brightness(1.05)";
  ctx.drawImage(image, 0, 0, out.width, out.height);
  ctx.filter = "none";
  const pixels = ctx.getImageData(0, 0, out.width, out.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i];
    const next = value > 188 ? 255 : value < 96 ? 0 : value;
    data[i] = data[i + 1] = data[i + 2] = next;
  }
  ctx.putImageData(pixels, 0, 0);
  return out;
}

function cropCanvas(image: HTMLCanvasElement | HTMLImageElement, leftFrac: number): HTMLCanvasElement {
  const width = image.width;
  const height = image.height;
  const sx = Math.floor(width * leftFrac);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width - sx);
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(image, sx, 0, canvas.width, height, 0, 0, canvas.width, height);
  return canvas;
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

export async function extractTransactions(file: File, year: number): Promise<TxnRow[]> {
  const image = enhanceForOcr(await loadImage(file));
  const fullItems = await recognize(image, "full");
  const sources = [fullItems];

  let parsed = sources.flatMap((items) => rowsFromItems(items, year));
  let amounts = sources.flatMap((items) => collectAmountPoints(items));
  try {
    let columnAmounts = collectAmountPoints(await recognize(cropCanvas(image, 0.72), "amounts"));
    if (columnAmounts.length < 2) {
      columnAmounts = collectAmountPoints(await recognize(cropCanvas(image, 0.64), "amounts"));
    }
    if (columnAmounts.length) amounts = columnAmounts;
  } catch {
    /* amount column optional */
  }

  parsed = mergeTxnRows(parsed);
  assignAmounts(parsed, amounts);
  const finalized = finalizeRows(parsed, file.name);
  lastDeclinedCount = finalized.declined;
  return finalized.rows;
}

export async function extractMany(files: File[], year: number): Promise<TxnRow[]> {
  const rows: TxnRow[] = [];
  let declined = 0;
  for (const file of files) {
    rows.push(...(await extractTransactions(file, year)));
    declined += lastDeclinedCount;
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
