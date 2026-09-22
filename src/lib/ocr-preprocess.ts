export interface CardBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  gray: HTMLCanvasElement;
  cards: CardBand[];
}

function grayValue(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function pixelsToGray(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    gray[j] = grayValue(data[i], data[i + 1], data[i + 2]);
  }
  return gray;
}

function grayToImageData(gray: Uint8ClampedArray, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    const value = gray[i];
    data[j] = data[j + 1] = data[j + 2] = value;
    data[j + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function canvasFromGray(gray: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.putImageData(grayToImageData(gray, width, height), 0, 0);
  return canvas;
}

export function stretchGray(gray: Uint8ClampedArray, lowPct = 0.02, highPct = 0.98): Uint8ClampedArray {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const lowCount = gray.length * lowPct;
  const highCount = gray.length * highPct;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (acc >= lowCount && lo === 0) lo = i;
    if (acc >= highCount) {
      hi = i;
      break;
    }
  }
  const span = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) * 255) / span)));
  }
  return out;
}

function integralImages(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { sum: Float64Array; sq: Float64Array } {
  const cols = width + 1;
  const sum = new Float64Array((width + 1) * (height + 1));
  const sq = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 1; x <= width; x += 1) {
      const value = gray[(y - 1) * width + (x - 1)];
      rowSum += value;
      rowSq += value * value;
      const index = y * cols + x;
      sum[index] = sum[(y - 1) * cols + x] + rowSum;
      sq[index] = sq[(y - 1) * cols + x] + rowSq;
    }
  }
  return { sum, sq };
}

function rectSum(table: Float64Array, cols: number, x0: number, y0: number, x1: number, y1: number): number {
  return table[(y1 + 1) * cols + (x1 + 1)] - table[y0 * cols + (x1 + 1)] - table[(y1 + 1) * cols + x0] + table[y0 * cols + x0];
}

export function sauvolaBin(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  windowSize = 21,
  k = 0.34,
): Uint8ClampedArray {
  const { sum, sq } = integralImages(gray, width, height);
  const cols = width + 1;
  const radius = Math.max(1, Math.floor(windowSize / 2));
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = rectSum(sum, cols, x0, y0, x1, y1) / n;
      const variance = Math.max(0, rectSum(sq, cols, x0, y0, x1, y1) / n - mean * mean);
      const threshold = mean * (1 + k * (Math.sqrt(variance) / 128 - 1));
      out[y * width + x] = gray[y * width + x] < threshold ? 0 : 255;
    }
  }
  return out;
}

export function shouldInvertRegion(bin: Uint8ClampedArray, width: number, band: CardBand): boolean {
  let total = 0;
  let dark = 0;
  const x1 = Math.min(width, band.x + band.width);
  const y1 = Math.min(bin.length / width, band.y + band.height);
  for (let y = band.y; y < y1; y += 1) {
    for (let x = band.x; x < x1; x += 1) {
      total += 1;
      if (bin[y * width + x] < 128) dark += 1;
    }
  }
  return total > 0 && dark / total > 0.62;
}

function invertGray(gray: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) out[i] = 255 - gray[i];
  return out;
}

export function detectCardBands(gray: Uint8ClampedArray, width: number, height: number): CardBand[] {
  if (width < 40 || height < 40) return [];
  const rowMean = new Float64Array(height);
  const rowBright = new Float64Array(height);
  let global = 0;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let bright = 0;
    for (let x = 0; x < width; x += 1) {
      const value = gray[y * width + x];
      sum += value;
      if (value >= 176) bright += 1;
    }
    rowMean[y] = sum / width;
    rowBright[y] = bright / width;
    global += rowMean[y];
  }
  global /= height;
  const minH = Math.max(16, Math.round(height * 0.012));
  const maxH = Math.round(height * 0.36);
  const hole = Math.max(8, Math.round(height * 0.009));
  const mask = new Uint8Array(height);
  for (let y = 0; y < height; y += 1) mask[y] = rowBright[y] >= 0.42 ? 1 : 0;
  let cursor = 0;
  while (cursor < height) {
    if (mask[cursor]) {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < height && !mask[end]) end += 1;
    if (cursor > 0 && end < height && end - cursor <= hole) {
      mask.fill(1, cursor, end);
    }
    cursor = end;
  }
  const runs: Array<{ y0: number; y1: number }> = [];
  let start = -1;
  for (let y = 0; y <= height; y += 1) {
    const bright = y < height && mask[y] === 1;
    if (bright && start < 0) start = y;
    if (!bright && start >= 0) {
      runs.push({ y0: start, y1: y - 1 });
      start = -1;
    }
  }
  const merged: Array<{ y0: number; y1: number }> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.y0 - last.y1 <= hole) last.y1 = run.y1;
    else merged.push({ ...run });
  }

  const cards: CardBand[] = [];
  for (const run of merged) {
    const heightBand = run.y1 - run.y0 + 1;
    if (heightBand < minH || heightBand > maxH) continue;
    if (heightBand > height * 0.7) continue;
    const col = new Float64Array(width);
    for (let y = run.y0; y <= run.y1; y += 1) {
      for (let x = 0; x < width; x += 1) col[x] += gray[y * width + x];
    }
    const rows = heightBand;
    const colCut = Math.max(140, global + 10) * rows;
    let x0 = 0;
    let x1 = width - 1;
    while (x0 < width && col[x0] < colCut) x0 += 1;
    while (x1 > x0 && col[x1] < colCut) x1 -= 1;
    const padX = Math.max(4, Math.round(width * 0.01));
    const nextStart = merged[merged.indexOf(run) + 1]?.y0 ?? height;
    const prevEnd = merged[merged.indexOf(run) - 1]?.y1 ?? -1;
    const gapBefore = run.y0 - prevEnd - 1;
    const gapAfter = nextStart - run.y1 - 1;
    const padY = Math.max(2, Math.min(Math.round(heightBand * 0.08), Math.floor(gapBefore / 2), Math.floor(gapAfter / 2)));
    const x = Math.max(0, x0 - padX);
    const y = Math.max(0, run.y0 - padY);
    const w = Math.min(width - x, x1 - x0 + 1 + padX * 2);
    const h = Math.min(height - y, heightBand + padY * 2);
    if (w < Math.max(40, width * 0.28) || h < minH) continue;
    cards.push({ x, y, width: w, height: h });
  }
  return cards;
}

function scaleForOcr(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const short = Math.min(source.width, source.height);
  const scale = short < 1600 ? 1600 / short : 1;
  if (scale === 1) return { canvas: source, scale };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas: source, scale: 1 };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

export function prepareSlipImage(source: HTMLCanvasElement): PreparedImage {
  const nativeCtx = source.getContext("2d");
  const nativeCards = nativeCtx
    ? detectCardBands(
        stretchGray(pixelsToGray(nativeCtx.getImageData(0, 0, source.width, source.height).data)),
        source.width,
        source.height,
      )
    : [];
  const { canvas: scaled, scale } = scaleForOcr(source);
  const ctx = scaled.getContext("2d");
  if (!ctx) return { canvas: scaled, gray: scaled, cards: [] };
  const pixels = ctx.getImageData(0, 0, scaled.width, scaled.height);
  const stretched = stretchGray(pixelsToGray(pixels.data));
  const windowSize = Math.max(15, Math.round(Math.min(scaled.width, scaled.height) * 0.014) | 1);
  const binary = sauvolaBin(stretched, scaled.width, scaled.height, windowSize);
  const cards =
    nativeCards.length >= 2
      ? nativeCards.map((card) => ({
          x: Math.round(card.x * scale),
          y: Math.round(card.y * scale),
          width: Math.round(card.width * scale),
          height: Math.round(card.height * scale),
        }))
      : detectCardBands(stretched, scaled.width, scaled.height);
  return {
    canvas: canvasFromGray(binary, scaled.width, scaled.height),
    gray: canvasFromGray(stretched, scaled.width, scaled.height),
    cards,
  };
}

export function cropBand(image: HTMLCanvasElement, band: CardBand): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, band.width);
  canvas.height = Math.max(1, band.height);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(image, band.x, band.y, band.width, band.height, 0, 0, band.width, band.height);
  return canvas;
}

export function cropRight(image: HTMLCanvasElement, leftFrac = 0.78): HTMLCanvasElement {
  const sx = Math.floor(image.width * leftFrac);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width - sx);
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(image, sx, 0, canvas.width, image.height, 0, 0, canvas.width, image.height);
  return canvas;
}

export function invertCanvas(image: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = image.getContext("2d");
  if (!ctx) return image;
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  const gray = invertGray(pixelsToGray(pixels.data));
  ctx.putImageData(grayToImageData(gray, image.width, image.height), 0, 0);
  return image;
}

export function invertIfDark(image: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = image.getContext("2d");
  if (!ctx) return image;
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  const gray = pixelsToGray(pixels.data);
  let dark = 0;
  for (let i = 0; i < gray.length; i += 1) if (gray[i] < 128) dark += 1;
  if (dark / gray.length <= 0.62) return image;
  return invertCanvas(image);
}
