import type { CleanupMethod } from '@/types';
import type { OcrLineBox, OcrParagraph } from './ocr';
import { simpleInpaint } from './imageUtils';

export const RING_SIZE_PX = 10;
export const UNIFORM_VARIANCE_THRESHOLD = 420;
export const LIGHT_BACKGROUND_THRESHOLD = 200;
export const MIN_RING_PIXELS = 24;

export interface PixelRingStats {
  red: number;
  green: number;
  blue: number;
  brightness: number;
  variance: number;
  count: number;
}

export type ResolvedCleanupMethod = Exclude<CleanupMethod, 'auto'>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function analyzePixelRing(image: ImageData, box: OcrLineBox, ring = RING_SIZE_PX): PixelRingStats | null {
  const x0 = clamp(Math.floor(box.x * image.width), 0, image.width - 1);
  const y0 = clamp(Math.floor(box.y * image.height), 0, image.height - 1);
  const x1 = clamp(Math.ceil((box.x + box.width) * image.width), 0, image.width);
  const y1 = clamp(Math.ceil((box.y + box.height) * image.height), 0, image.height);
  const outerX0 = clamp(x0 - ring, 0, image.width - 1);
  const outerY0 = clamp(y0 - ring, 0, image.height - 1);
  const outerX1 = clamp(x1 + ring, 0, image.width);
  const outerY1 = clamp(y1 + ring, 0, image.height);
  const samples: Array<[number, number, number]> = [];

  for (let y = outerY0; y < outerY1; y++) {
    for (let x = outerX0; x < outerX1; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const index = (y * image.width + x) * 4;
      if (image.data[index + 3] < 128) continue;
      samples.push([image.data[index], image.data[index + 1], image.data[index + 2]]);
    }
  }
  if (samples.length < MIN_RING_PIXELS) return null;
  const sums = samples.reduce((acc, pixel) => [acc[0] + pixel[0], acc[1] + pixel[1], acc[2] + pixel[2]], [0, 0, 0]);
  const means = sums.map(value => value / samples.length);
  const variance = samples.reduce((sum, pixel) => sum + pixel.reduce((channelSum, value, channel) => channelSum + (value - means[channel]) ** 2, 0) / 3, 0) / samples.length;
  return {
    red: Math.round(means[0]), green: Math.round(means[1]), blue: Math.round(means[2]),
    brightness: means[0] * 0.299 + means[1] * 0.587 + means[2] * 0.114,
    variance,
    count: samples.length,
  };
}

export function resolveCleanupMethod(method: CleanupMethod, stats: PixelRingStats | null): ResolvedCleanupMethod {
  if (method !== 'auto') return method;
  if (!stats || stats.variance >= UNIFORM_VARIANCE_THRESHOLD) return 'inpaint';
  return stats.brightness > LIGHT_BACKGROUND_THRESHOLD ? 'white' : 'background';
}

function fillLine(ctx: CanvasRenderingContext2D, box: OcrLineBox, width: number, height: number, color: string) {
  const pad = Math.max(2, box.height * height * 0.2);
  ctx.fillStyle = color;
  ctx.fillRect(box.x * width - pad, box.y * height - pad, box.width * width + pad * 2, box.height * height + pad * 2);
}

export async function buildSmartCleanup(
  source: string,
  paragraphs: OcrParagraph[],
  method: CleanupMethod,
  inpaintRadius: number,
): Promise<{ dataUrl: string; methods: ResolvedCleanupMethod[] }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const methods: ResolvedCleanupMethod[] = [];

  for (const paragraph of paragraphs) {
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stats = analyzePixelRing(before, paragraph);
    const resolved = resolveCleanupMethod(method, stats);
    methods.push(resolved);
    const boxes = paragraph.lines.length ? paragraph.lines : [paragraph];
    if (resolved === 'white' || resolved === 'background') {
      const color = resolved === 'white' || !stats ? '#ffffff' : `rgb(${stats.red}, ${stats.green}, ${stats.blue})`;
      boxes.forEach(box => fillLine(ctx, box, canvas.width, canvas.height, color));
      continue;
    }
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, canvas.width, canvas.height);
    boxes.forEach(box => fillLine(maskCtx, box, canvas.width, canvas.height, '#ffffff'));
    const mask = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(simpleInpaint(before, mask, inpaintRadius * 3), 0, 0);
  }
  return { dataUrl: canvas.toDataURL('image/png'), methods };
}
