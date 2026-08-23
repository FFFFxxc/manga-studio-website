/**
 * OCR via tesseract.js (free, runs fully in the browser).
 * Recognizes text blocks on an image and returns them with
 * normalized bounding boxes (0..1 relative to image size).
 */

import type { TranslateLang } from './translate';

export interface OcrLineBox {
  // normalized 0..1
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrParagraph {
  text: string;
  confidence: number;
  // normalized 0..1
  x: number;
  y: number;
  width: number;
  height: number;
  lineCount: number;
  lines: OcrLineBox[];
}

/** Map UI language codes to tesseract traineddata codes */
const OCR_LANGS: Record<TranslateLang, string> = {
  en: 'eng',
  ru: 'rus',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi_sim',
};

/**
 * Preprocess the image for OCR: upscale + grayscale + Otsu binarization.
 * Manga pages are full of screentones and art that confuse Tesseract;
 * binarization turns dark text on light bubbles into clean black-on-white.
 * Returns a dataURL and the scale factor applied (bbox coords must be
 * divided by it to map back to the original image).
 */
async function preprocessForOcr(imageSrc: string): Promise<{ dataUrl: string; scale: number; W: number; H: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('img load failed'));
    el.src = imageSrc;
  });
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // Upscale small images — bubble text is often tiny; Tesseract wants
  // characters to be at least ~20px tall.
  const target = 2800;
  const longSide = Math.max(W, H);
  const scale = longSide < target ? Math.min(4, target / longSide) : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const n = d.length / 4;

  // Grayscale + histogram for Otsu threshold
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
    gray[i] = g;
    hist[g]++;
  }

  // Otsu: find the threshold that best separates dark text from light bubbles
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }

  // Binarize: pure black text on pure white background
  for (let i = 0; i < n; i++) {
    const v = gray[i] > threshold ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  return { dataUrl: canvas.toDataURL('image/png'), scale, W, H };
}

interface RawLine {
  text: string;
  confidence: number;
  x: number; // normalized
  y: number;
  width: number;
  height: number;
}

const LETTERS_RE = /[a-zA-Zа-яА-ЯёЁ\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g;

/**
 * Extract individual WORDS with per-word confidence filtering.
 * Tesseract's lines/paragraphs are unreliable on manga pages: they merge
 * words from different bubbles standing at the same height. We take raw
 * words and cluster them into lines/blocks ourselves.
 */
function extractWords(
  blocks: any[] | null | undefined,
  W: number,
  H: number,
  scale: number,
  minConfidence: number
): RawLine[] {
  const out: RawLine[] = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? '').trim();
          if (!text) continue;
          if (word.confidence < minConfidence) continue;
          // Require the word to be mostly letters (filters art noise like "|_~=.")
          const letters = (text.match(LETTERS_RE) ?? []).length;
          if (letters === 0 || letters / text.length < 0.5) continue;
          // Single characters are almost always noise unless confident
          if (letters < 2 && word.confidence < 85) continue;

          const { x0, y0, x1, y1 } = word.bbox;
          const w = (x1 - x0) / scale / W;
          const h = (y1 - y0) / scale / H;
          if (w <= 0 || h <= 0 || h > 0.2 || w > 0.6) continue; // noise
          out.push({
            text,
            confidence: word.confidence,
            x: x0 / scale / W,
            y: y0 / scale / H,
            width: w,
            height: h,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Group words into visual lines: words merge when they vertically overlap
 * and the horizontal gap between them is small (relative to word height).
 */
function wordsToLines(words: RawLine[]): RawLine[] {
  const sorted = [...words].sort((a, b) => a.x - b.x);
  const lines: RawLine[][] = [];

  for (const word of sorted) {
    let placed = false;
    for (const line of lines) {
      const last = line[line.length - 1];
      // Vertical overlap >= 50% of the smaller height
      const oy = Math.min(last.y + last.height, word.y + word.height) - Math.max(last.y, word.y);
      const minH = Math.min(last.height, word.height);
      // Horizontal gap no more than ~2 word heights (letters are close in a line)
      const gap = word.x - (last.x + last.width);
      if (oy >= minH * 0.5 && gap >= -minH && gap <= Math.max(last.height, word.height) * 2) {
        line.push(word);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([word]);
  }

  return lines.map(line => {
    const x0 = Math.min(...line.map(w => w.x));
    const y0 = Math.min(...line.map(w => w.y));
    const x1 = Math.max(...line.map(w => w.x + w.width));
    const y1 = Math.max(...line.map(w => w.y + w.height));
    return {
      text: line.sort((a, b) => a.x - b.x).map(w => w.text).join(' '),
      confidence: line.reduce((s, w) => s + w.confidence, 0) / line.length,
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
    };
  });
}

/**
 * Cluster lines into text blocks (speech bubbles): lines join a group when
 * they are vertically adjacent and horizontally overlapping.
 */
function clusterLines(lines: RawLine[]): OcrParagraph[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  const groups: RawLine[][] = [];

  for (const line of sorted) {
    let placed = false;
    for (const group of groups) {
      const last = group[group.length - 1];
      const vGap = line.y - (last.y + last.height);
      const maxGap = Math.max(last.height, line.height) * 0.9;
      // Horizontal overlap
      const ox = Math.min(last.x + last.width, line.x + line.width) - Math.max(last.x, line.x);
      const minW = Math.min(last.width, line.width);
      if (vGap <= maxGap && vGap > -last.height && ox > minW * 0.3) {
        group.push(line);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([line]);
  }

  return groups
    .map(group => {
      const x0 = Math.min(...group.map(l => l.x));
      const y0 = Math.min(...group.map(l => l.y));
      const x1 = Math.max(...group.map(l => l.x + l.width));
      const y1 = Math.max(...group.map(l => l.y + l.height));
      return {
        text: group.map(l => l.text).join(' '),
        confidence: group.reduce((s, l) => s + l.confidence, 0) / group.length,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        lineCount: group.length,
        lines: group.map(l => ({ x: l.x, y: l.y, width: l.width, height: l.height })),
      };
    })
    .filter(p => {
      // Reject tiny/noise clusters: short "words" hallucinated in art
      const letters = (p.text.match(LETTERS_RE) ?? []).length;
      if (letters < 3) return false;
      if (letters < 8 && p.confidence < 70) return false;
      if (p.lineCount === 1 && !p.text.includes(' ') && p.confidence < 75) return false;
      return true;
    });
}

export async function recognizeParagraphs(
  imageSrc: string,
  lang: TranslateLang,
  onProgress?: (pct: number) => void
): Promise<OcrParagraph[]> {
  const { createWorker, PSM } = await import('tesseract.js');

  const worker = await createWorker(OCR_LANGS[lang], 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const { dataUrl, scale, W, H } = await preprocessForOcr(imageSrc);

    // Pass 1: automatic page segmentation (good for regular layouts)
    const auto = await worker.recognize(dataUrl, {}, { blocks: true });
    const words = extractWords(auto.data.blocks, W, H, scale, 50);

    // Pass 2: sparse text mode — much better for speech bubbles scattered
    // across art-heavy pages. Merge results (auto often misses some words).
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const sparse = await worker.recognize(dataUrl, {}, { blocks: true });
    // Sparse mode hallucinates "words" in art — require high confidence
    const sparseWords = extractWords(sparse.data.blocks, W, H, scale, 70);

    // Dedupe: keep a sparse word only if it doesn't overlap an auto word
    for (const sw of sparseWords) {
      const overlaps = words.some(w => {
        const ox = Math.min(w.x + w.width, sw.x + sw.width) - Math.max(w.x, sw.x);
        const oy = Math.min(w.y + w.height, sw.y + sw.height) - Math.max(w.y, sw.y);
        if (ox <= 0 || oy <= 0) return false;
        const inter = ox * oy;
        const minArea = Math.min(w.width * w.height, sw.width * sw.height);
        return inter > minArea * 0.5;
      });
      if (!overlaps) words.push(sw);
    }

    return clusterLines(wordsToLines(words));
  } finally {
    await worker.terminate();
  }
}
