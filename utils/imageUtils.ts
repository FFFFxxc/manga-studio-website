import { createBaseLayerState } from '../types';
import type { CropRect, ImageDocument, MaskElement, PerspectiveQuad, StrokeData } from '../types';

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name));
}

export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type) && !(!file.type && isImageFile(file))) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? 'неизвестный';
    return `Формат ${ext} не поддерживается. Принимаются JPG, PNG, WebP.`;
  }
  if (file.size > 60 * 1024 * 1024) {
    return `Файл «${file.name}» слишком большой (макс. 60 МБ).`;
  }
  return null;
}

export function createThumbnail(img: HTMLImageElement, maxSide = 160): string {
  const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

export function loadImageFromFile(file: File): Promise<ImageDocument> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const id = uid();
      resolve({
        id,
        file,
        originalSrc: objectUrl,
        thumbnail: createThumbnail(img, 160),
        width: img.naturalWidth,
        height: img.naturalHeight,
        name: file.name,
        cleanup: { committed: null, strokes: [] },
        baseLayer: createBaseLayerState(id),
        masks: [],
        aiLayers: [],
        activeMaskId: null,
        selectedLayer: null,
        watermarks: [],
        texts: [],
        translationMasks: [],
        shapes: [],
        bubbles: [],
        past: [],
        future: [],
        hasChanges: false,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось загрузить файл «${file.name}». Возможно, файл повреждён.`));
    };
    img.src = objectUrl;
  });
}

export async function loadImagesFromFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void
): Promise<{ docs: ImageDocument[]; errors: string[] }> {
  const docs: ImageDocument[] = [];
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const validationError = validateFile(file);
    if (validationError) {
      errors.push(validationError);
      continue;
    }
    try {
      const doc = await loadImageFromFile(file);
      docs.push(doc);
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message : `Ошибка загрузки «${file.name}»`);
    }
    onProgress?.(i + 1, files.length);
  }
  return { docs, errors };
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

function canvasToObjectURL(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error('toBlob failed'));
    }, 'image/png');
  });
}

/** Resize the document's base image (and committed cleanup) to new dimensions */
export async function resizeDocument(
  doc: ImageDocument,
  newW: number,
  newH: number
): Promise<Partial<ImageDocument>> {
  newW = Math.max(1, Math.round(newW));
  newH = Math.max(1, Math.round(newH));
  const base = await loadImg(doc.originalSrc);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base, 0, 0, newW, newH);

  let committed: string | null = null;
  if (doc.cleanup.committed) {
    const clean = await loadImg(doc.cleanup.committed);
    const cc = document.createElement('canvas');
    cc.width = newW;
    cc.height = newH;
    const cctx = cc.getContext('2d')!;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(clean, 0, 0, newW, newH);
    committed = cc.toDataURL('image/png');
  }

  const originalSrc = await canvasToObjectURL(canvas);
  const thumbImg = await loadImg(originalSrc);

  return {
    originalSrc,
    width: newW,
    height: newH,
    thumbnail: createThumbnail(thumbImg, 160),
    cleanup: { ...doc.cleanup, committed, strokes: doc.cleanup.strokes },
    // Resize invalidates history snapshots (they reference old dimensions)
    past: [],
    future: [],
    hasChanges: true,
  };
}

/** Resize only the canvas, preserving every object's pixel position and size. */
export async function resizeCanvasDocument(doc: ImageDocument, newW: number, newH: number): Promise<Partial<ImageDocument>> {
  newW = Math.max(1, Math.round(newW));
  newH = Math.max(1, Math.round(newH));
  const scaleX = doc.width / newW;
  const scaleY = doc.height / newH;
  const resizeSource = async (src: string, asObjectUrl = false) => {
    const image = await loadImg(src);
    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    canvas.getContext('2d')!.drawImage(image, 0, 0, doc.width, doc.height);
    return asObjectUrl ? canvasToObjectURL(canvas) : canvas.toDataURL('image/png');
  };
  const mapPointArray = (points: number[]) => points.map((value, index) => value * (index % 2 === 0 ? scaleX : scaleY));
  const mapStroke = (stroke: StrokeData): StrokeData => ({ ...stroke, points: mapPointArray(stroke.points), size: stroke.size * scaleY });
  const mapElement = async (element: MaskElement): Promise<MaskElement> => {
    if (element.type === 'brush') return { ...element, stroke: mapStroke(element.stroke) };
    if (element.type === 'polygon') return { ...element, points: mapPointArray(element.points) };
    return { ...element, src: await resizeSource(element.src) };
  };
  const mapPerspective = (quad: PerspectiveQuad | null | undefined) => quad ? ({
    topLeft: { x: quad.topLeft.x * scaleX, y: quad.topLeft.y * scaleY },
    topRight: { x: quad.topRight.x * scaleX, y: quad.topRight.y * scaleY },
    bottomRight: { x: quad.bottomRight.x * scaleX, y: quad.bottomRight.y * scaleY },
    bottomLeft: { x: quad.bottomLeft.x * scaleX, y: quad.bottomLeft.y * scaleY },
  }) : null;
  const mapCrop = (crop: CropRect | null | undefined) => crop ? ({ x: crop.x * scaleX, y: crop.y * scaleY, width: crop.width * scaleX, height: crop.height * scaleY }) : null;

  const originalSrc = await resizeSource(doc.originalSrc, true);
  const committed = doc.cleanup.committed ? await resizeSource(doc.cleanup.committed) : null;
  const baseLayer = {
    ...doc.baseLayer,
    x: doc.baseLayer.x * scaleX,
    y: doc.baseLayer.y * scaleY,
    crop: mapCrop(doc.baseLayer.crop),
    perspective: mapPerspective(doc.baseLayer.perspective),
    perspectiveSourceBounds: mapCrop(doc.baseLayer.perspectiveSourceBounds),
    eraseElements: await Promise.all((doc.baseLayer.eraseElements ?? []).map(mapElement)),
  };
  const aiLayers = await Promise.all((doc.aiLayers ?? []).map(async layer => ({
    ...layer,
    src: await resizeSource(layer.src),
    x: (layer.x ?? 0) * scaleX,
    y: (layer.y ?? 0) * scaleY,
    crop: mapCrop(layer.crop),
    perspective: mapPerspective(layer.perspective),
    perspectiveSourceBounds: mapCrop(layer.perspectiveSourceBounds),
    eraseElements: await Promise.all((layer.eraseElements ?? []).map(mapElement)),
  })));
  const masks = await Promise.all((doc.masks ?? []).map(async mask => ({
    ...mask,
    strokes: (mask.strokes ?? []).map(mapStroke),
    elements: await Promise.all((mask.elements ?? []).map(mapElement)),
  })));
  return {
    originalSrc,
    width: newW,
    height: newH,
    thumbnail: createThumbnail(await loadImg(originalSrc), 160),
    cleanup: { ...doc.cleanup, committed, strokes: doc.cleanup.strokes.map(mapStroke) },
    baseLayer,
    aiLayers,
    masks,
    watermarks: doc.watermarks.map(item => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, fontSize: item.fontSize === undefined ? undefined : item.fontSize * scaleY, imageWidth: item.imageWidth === undefined ? undefined : item.imageWidth * scaleX, imageHeight: item.imageHeight === undefined ? undefined : item.imageHeight * scaleY })),
    texts: doc.texts.map(item => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, width: item.width * scaleX, fontSize: item.fontSize * scaleY })),
    translationMasks: (doc.translationMasks ?? []).map(item => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, width: item.width * scaleX, height: item.height * scaleY, sourceBounds: item.sourceBounds ? { x: item.sourceBounds.x * scaleX, y: item.sourceBounds.y * scaleY, width: item.sourceBounds.width * scaleX, height: item.sourceBounds.height * scaleY } : undefined })),
    shapes: (doc.shapes ?? []).map(item => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, width: item.width * scaleX, height: item.height * scaleY })),
    bubbles: (doc.bubbles ?? []).map(item => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, width: item.width * scaleX, height: item.height * scaleY, tail: item.tail ? { ...item.tail, tipX: item.tail.tipX === undefined ? undefined : item.tail.tipX * scaleX, tipY: item.tail.tipY === undefined ? undefined : item.tail.tipY * scaleY } : null })),
    past: [],
    future: [],
    hasChanges: true,
  };
}

/** Crop the document to a normalized rect; remaps all object coordinates */
export function remapDocumentContentForCrop(doc: ImageDocument, rect: CropRect) {
  const cx = Math.max(0, Math.min(1, rect.x));
  const cy = Math.max(0, Math.min(1, rect.y));
  const cw = Math.max(0.01, Math.min(1 - cx, rect.width));
  const ch = Math.max(0.01, Math.min(1 - cy, rect.height));
  const mapX = (x: number) => (x - cx) / cw;
  const mapY = (y: number) => (y - cy) / ch;
  const remapStroke = (stroke: StrokeData): StrokeData => ({
    ...stroke,
    points: stroke.points.map((value, index) => (index % 2 === 0 ? mapX(value) : mapY(value))),
    size: stroke.size / ch,
  });
  const remapElement = (element: MaskElement): MaskElement => {
    if (element.type === 'brush') return { ...element, stroke: remapStroke(element.stroke) };
    if (element.type === 'polygon') {
      return { ...element, points: element.points.map((value, index) => (index % 2 === 0 ? mapX(value) : mapY(value))) };
    }
    return { ...element };
  };
  const remapPerspective = (quad: PerspectiveQuad | null | undefined): PerspectiveQuad | null => quad ? ({
    topLeft: { x: mapX(quad.topLeft.x), y: mapY(quad.topLeft.y) },
    topRight: { x: mapX(quad.topRight.x), y: mapY(quad.topRight.y) },
    bottomRight: { x: mapX(quad.bottomRight.x), y: mapY(quad.bottomRight.y) },
    bottomLeft: { x: mapX(quad.bottomLeft.x), y: mapY(quad.bottomLeft.y) },
  }) : null;

  return {
    watermarks: (doc.watermarks ?? []).map(watermark => ({
      ...watermark,
      x: mapX(watermark.x),
      y: mapY(watermark.y),
      fontSize: watermark.fontSize !== undefined ? watermark.fontSize / ch : watermark.fontSize,
      imageWidth: watermark.imageWidth !== undefined ? watermark.imageWidth / cw : watermark.imageWidth,
      imageHeight: watermark.imageHeight !== undefined ? watermark.imageHeight / ch : watermark.imageHeight,
    })),
    texts: (doc.texts ?? []).map(text => ({
      ...text,
      x: mapX(text.x),
      y: mapY(text.y),
      fontSize: text.fontSize / ch,
      width: text.width / cw,
    })),
    translationMasks: (doc.translationMasks ?? []).map(mask => ({
      ...mask,
      x: mapX(mask.x),
      y: mapY(mask.y),
      width: mask.width / cw,
      height: mask.height / ch,
      sourceBounds: mask.sourceBounds ? {
        x: mapX(mask.sourceBounds.x),
        y: mapY(mask.sourceBounds.y),
        width: mask.sourceBounds.width / cw,
        height: mask.sourceBounds.height / ch,
      } : undefined,
    })),
    shapes: (doc.shapes ?? []).map(shape => ({
      ...shape,
      x: mapX(shape.x),
      y: mapY(shape.y),
      width: shape.width / cw,
      height: shape.height / ch,
    })),
    bubbles: (doc.bubbles ?? []).map(bubble => ({
      ...bubble,
      x: mapX(bubble.x),
      y: mapY(bubble.y),
      width: bubble.width / cw,
      height: bubble.height / ch,
      tail: bubble.tail ? {
        ...bubble.tail,
        tipX: bubble.tail.tipX === undefined ? undefined : mapX(bubble.tail.tipX),
        tipY: bubble.tail.tipY === undefined ? undefined : mapY(bubble.tail.tipY),
      } : null,
    })),
    cleanupStrokes: (doc.cleanup?.strokes ?? []).map(remapStroke),
    masks: (doc.masks ?? []).map(mask => ({
      ...mask,
      strokes: (mask.strokes ?? []).map(remapStroke),
      elements: (mask.elements ?? []).map(remapElement),
    })),
    baseLayer: {
      ...doc.baseLayer,
      eraseElements: [],
      perspective: remapPerspective(doc.baseLayer?.perspective),
    },
    aiLayers: (doc.aiLayers ?? []).map(layer => ({ ...layer, perspective: remapPerspective(layer.perspective) })),
  };
}

export async function cropDocument(
  doc: ImageDocument,
  rect: { x: number; y: number; width: number; height: number }
): Promise<Partial<ImageDocument>> {
  const cx = Math.max(0, Math.min(1, rect.x));
  const cy = Math.max(0, Math.min(1, rect.y));
  const cw = Math.max(0.01, Math.min(1 - cx, rect.width));
  const ch = Math.max(0.01, Math.min(1 - cy, rect.height));

  const pxX = Math.round(cx * doc.width);
  const pxY = Math.round(cy * doc.height);
  const pxW = Math.max(1, Math.round(cw * doc.width));
  const pxH = Math.max(1, Math.round(ch * doc.height));

  const base = await loadImg(doc.originalSrc);
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, pxX, pxY, pxW, pxH, 0, 0, pxW, pxH);

  let committed: string | null = null;
  if (doc.cleanup.committed) {
    const clean = await loadImg(doc.cleanup.committed);
    const cc = document.createElement('canvas');
    cc.width = pxW;
    cc.height = pxH;
    cc.getContext('2d')!.drawImage(clean, pxX, pxY, pxW, pxH, 0, 0, pxW, pxH);
    committed = cc.toDataURL('image/png');
  }

  const remapped = remapDocumentContentForCrop(doc, { x: cx, y: cy, width: cw, height: ch });
  const masks = await Promise.all(remapped.masks.map(async mask => ({
    ...mask,
    elements: await Promise.all(mask.elements.map(async element => {
      if (element.type !== 'bitmap') return element;
      const bitmap = await loadImg(element.src);
      const bitmapCanvas = document.createElement('canvas');
      bitmapCanvas.width = pxW;
      bitmapCanvas.height = pxH;
      bitmapCanvas.getContext('2d')!.drawImage(bitmap, pxX, pxY, pxW, pxH, 0, 0, pxW, pxH);
      return { ...element, src: bitmapCanvas.toDataURL('image/png') };
    })),
  })));

  const originalSrc = await canvasToObjectURL(canvas);
  const thumbImg = await loadImg(originalSrc);

  return {
    originalSrc,
    width: pxW,
    height: pxH,
    thumbnail: createThumbnail(thumbImg, 160),
    cleanup: { ...doc.cleanup, committed, strokes: remapped.cleanupStrokes },
    baseLayer: remapped.baseLayer,
    aiLayers: remapped.aiLayers,
    masks,
    watermarks: remapped.watermarks,
    texts: remapped.texts,
    translationMasks: remapped.translationMasks,
    shapes: remapped.shapes,
    bubbles: remapped.bubbles,
    past: [],
    future: [],
    hasChanges: true,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Simple flood-fill at ImageData level (for magic bubble / cleanup) */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillR: number,
  fillG: number,
  fillB: number,
  threshold = 30
): void {
  const idx = (x: number, y: number) => (y * width + x) * 4;
  const startIdx = idx(startX, startY);
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];

  if (
    Math.abs(fillR - targetR) < 3 &&
    Math.abs(fillG - targetG) < 3 &&
    Math.abs(fillB - targetB) < 3
  ) return;

  const stack: [number, number][] = [[startX, startY]];
  const visited = new Uint8Array(width * height);

  const matches = (x: number, y: number): boolean => {
    const i = idx(x, y);
    return (
      Math.abs(data[i] - targetR) <= threshold &&
      Math.abs(data[i + 1] - targetG) <= threshold &&
      Math.abs(data[i + 2] - targetB) <= threshold
    );
  };

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const vi = y * width + x;
    if (visited[vi]) continue;
    if (!matches(x, y)) continue;
    visited[vi] = 1;
    const i = idx(x, y);
    data[i] = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}

/**
 * Diffusion inpaint: fills the masked region by propagating colors inward
 * from the mask boundary (BFS waves), then smooths the fill with several
 * relaxation passes, and finally composites with a feathered mask edge
 * so there are no hard seams.
 *
 * Mask convention: black background, white strokes (checked via red channel).
 */
export function simpleInpaint(
  imageData: ImageData,
  maskData: ImageData,
  radius = 8
): ImageData {
  const { width, height } = imageData;
  const img = imageData.data;
  const mask = maskData.data;
  const N = width * height;

  const r = new Float32Array(N);
  const g = new Float32Array(N);
  const b = new Float32Array(N);
  const unknown = new Uint8Array(N); // 1 = masked (to be filled)
  const filled = new Uint8Array(N);  // 1 = has a valid color

  const maskedIdx: number[] = [];
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    r[p] = img[i]; g[p] = img[i + 1]; b[p] = img[i + 2];
    if (mask[i] >= 128) {
      unknown[p] = 1;
      maskedIdx.push(p);
    } else {
      filled[p] = 1;
    }
  }
  if (maskedIdx.length === 0) return new ImageData(new Uint8ClampedArray(img), width, height);

  // --- 1. BFS wave fill: every masked pixel gets a color propagated from the boundary ---
  const queued = new Uint8Array(N);
  let frontier: number[] = [];
  for (const p of maskedIdx) {
    const x = p % width, y = (p / width) | 0;
    if (
      (x > 0 && filled[p - 1]) || (x < width - 1 && filled[p + 1]) ||
      (y > 0 && filled[p - width]) || (y < height - 1 && filled[p + width])
    ) {
      frontier.push(p);
      queued[p] = 1;
    }
  }

  while (frontier.length > 0) {
    // Fill the whole wave from already-filled neighbors (8-neighborhood)
    for (const p of frontier) {
      const x = p % width, y = (p / width) | 0;
      let rs = 0, gs = 0, bs = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (!filled[np]) continue;
          rs += r[np]; gs += g[np]; bs += b[np]; c++;
        }
      }
      if (c > 0) { r[p] = rs / c; g[p] = gs / c; b[p] = bs / c; }
    }
    for (const p of frontier) filled[p] = 1;

    // Collect next wave
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width, y = (p / width) | 0;
      if (x > 0 && !filled[p - 1] && !queued[p - 1]) { next.push(p - 1); queued[p - 1] = 1; }
      if (x < width - 1 && !filled[p + 1] && !queued[p + 1]) { next.push(p + 1); queued[p + 1] = 1; }
      if (y > 0 && !filled[p - width] && !queued[p - width]) { next.push(p - width); queued[p - width] = 1; }
      if (y < height - 1 && !filled[p + width] && !queued[p + width]) { next.push(p + width); queued[p + width] = 1; }
    }
    frontier = next;
  }

  // --- 2. Smoothing (relaxation) passes inside the mask only ---
  const iterations = Math.max(6, Math.min(40, Math.round(radius * 1.5)));
  for (let it = 0; it < iterations; it++) {
    for (const p of maskedIdx) {
      const x = p % width, y = (p / width) | 0;
      let rs = r[p], gs = g[p], bs = b[p], c = 1;
      if (x > 0) { rs += r[p - 1]; gs += g[p - 1]; bs += b[p - 1]; c++; }
      if (x < width - 1) { rs += r[p + 1]; gs += g[p + 1]; bs += b[p + 1]; c++; }
      if (y > 0) { rs += r[p - width]; gs += g[p - width]; bs += b[p - width]; c++; }
      if (y < height - 1) { rs += r[p + width]; gs += g[p + width]; bs += b[p + width]; c++; }
      r[p] = rs / c; g[p] = gs / c; b[p] = bs / c;
    }
  }

  // --- 3. Feathered composite: soft weight near the mask boundary, no hard seams ---
  const weight = new Float32Array(N);
  for (const p of maskedIdx) weight[p] = 1;
  // Two small box-blur passes on the weight map (separable, radius 2)
  const fr = 2;
  const tmp = new Float32Array(N);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let s = 0, c = 0;
        for (let dx = -fr; dx <= fr; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          s += weight[row + nx]; c++;
        }
        tmp[row + x] = s / c;
      }
    }
    // vertical
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let s = 0, c = 0;
        for (let dy = -fr; dy <= fr; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          s += tmp[ny * width + x]; c++;
        }
        weight[y * width + x] = s / c;
      }
    }
  }

  const out = new Uint8ClampedArray(img);
  for (let p = 0; p < N; p++) {
    const w = weight[p];
    if (w <= 0.001) continue;
    const i = p * 4;
    out[i] = Math.round(img[i] * (1 - w) + r[p] * w);
    out[i + 1] = Math.round(img[i + 1] * (1 - w) + g[p] * w);
    out[i + 2] = Math.round(img[i + 2] * (1 - w) + b[p] * w);
    out[i + 3] = 255;
  }

  return new ImageData(out, width, height);
}
