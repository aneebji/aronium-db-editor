import type { Product } from "../types";

export const SAMPLE_PRODUCTS: Product[] = [
  { id: 101, name: "Sparkling water 330ml", price: 20, code: "WTR-20" },
  { id: 102, name: "House coffee", price: 20, code: "COF-20" },
  { id: 103, name: "Iced tea", price: 23, code: "TEA-23" },
  { id: 104, name: "Fresh juice", price: 30, code: "JUC-30" },
  { id: 105, name: "Club sandwich", price: 35, code: "SND-35" },
  { id: 106, name: "Caesar salad", price: 40, code: "SLD-40" },
  { id: 107, name: "Pasta bowl", price: 40, code: "PST-40" },
  { id: 108, name: "Grilled chicken", price: 50, code: "CHK-50" },
  { id: 109, name: "Steak plate", price: 100, code: "STK-100" },
  { id: 110, name: "Dessert plate", price: 23, code: "DST-23" },
];

export const SAMPLE_TXNS: Array<{ time: string; kind: string; id: string; amount: number }> = [
  { time: "23:25:42", kind: "PUR P1", id: "127300000010", amount: 20 },
  { time: "22:57:50", kind: "PUR P1", id: "127300000021", amount: 40 },
  { time: "22:54:33", kind: "PUR P1", id: "127300000032", amount: 20 },
  { time: "22:53:14", kind: "PUR P1", id: "127300000043", amount: 23 },
  { time: "22:41:56", kind: "PUR P1", id: "127300000054", amount: 50 },
  { time: "22:24:20", kind: "PUR P1", id: "127300000065", amount: 35 },
  { time: "22:20:04", kind: "PUR P1", id: "127300000076", amount: 30 },
  { time: "21:45:31", kind: "PUR P1", id: "127300000087", amount: 20 },
  { time: "20:46:25", kind: "PUR VC", id: "127300000098", amount: 40 },
  { time: "20:43:43", kind: "PUR P1", id: "127300000109", amount: 100 },
];

export function drawSampleReceipt(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Transactions History", 170, 88);
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#666";
  ctx.fillText("Back", 36, 88);
  SAMPLE_TXNS.forEach((txn, index) => {
    const y = 160 + index * 86;
    ctx.fillStyle = "#fff";
    roundRect(ctx, 20, y - 36, 680, 72, 12);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = "17px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`APP ${txn.kind} 13 Sep ${txn.time} ${txn.id}`, 36, y + 6);
    ctx.textAlign = "right";
    ctx.fillText(`${txn.amount.toFixed(2)}`, 680, y + 6);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = "#1a1a1a";
  roundRect(ctx, 0, 1088, 720, 92, 0);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PRINT TRANSACTION SUMMARY", 360, 1142);
  ctx.textAlign = "left";
  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function canvasToFile(canvas: HTMLCanvasElement, name = "sample-history.png"): File {
  const bytes = atob(canvas.toDataURL("image/png").split(",")[1]);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  return new File([buffer], name, { type: "image/png" });
}
