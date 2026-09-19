import Tesseract from "tesseract.js";
import { assignAmounts, collectAmounts, finalizeRows, mergeTxnRows, rowsFromItems } from "./parse";
import type { OcrItem, TxnRow } from "../types";

let lastOcrText = "";

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

async function recognize(source: HTMLCanvasElement | File | Blob): Promise<OcrItem[]> {
  const worker = await Tesseract.createWorker("eng");
  try {
    const result = await worker.recognize(source);
    lastOcrText = result.data.text || "";
    return pageToItems(result.data);
  } finally {
    await worker.terminate();
  }
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
  const image = await loadImage(file);
  const fullItems = await recognize(image);
  const sources = [fullItems];

  let parsed = sources.flatMap((items) => rowsFromItems(items, year));
  let amounts = sources.flatMap((items) => collectAmounts(items));
  try {
    const column = await recognize(cropCanvas(image, 0.68));
    const columnAmounts = collectAmounts(column);
    if (columnAmounts.length) amounts = columnAmounts;
    parsed.push(...rowsFromItems(column, year));
  } catch {
    /* amount column optional */
  }

  parsed = mergeTxnRows(parsed);
  assignAmounts(parsed, amounts);
  return finalizeRows(parsed, file.name);
}

export async function extractMany(files: File[], year: number): Promise<TxnRow[]> {
  const rows: TxnRow[] = [];
  for (const file of files) rows.push(...(await extractTransactions(file, year)));
  return rows.sort((a, b) => b.datetime.localeCompare(a.datetime));
}

export function getLastOcrText(): string {
  return lastOcrText;
}
