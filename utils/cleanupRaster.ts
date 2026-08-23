import type { AiRasterLayer, ImageDocument, LayerReference, MaskElement, PerspectiveQuad, StrokeData } from '@/types';
import { resolveLayerOrder } from './layerOrder';
import { drawBrushStroke } from './brushRaster';
import { drawPerspectiveImage, isValidPerspectiveQuad, mapDocumentPointToLayerPoint } from './perspective';
import {
  canvasToPersistentDataUrl,
  getRuntimeRasterSource,
  registerRuntimeRasterSource,
} from './runtimeRasterSources';

export function loadCleanupImage(src: string): Promise<CanvasImageSource> {
  const runtimeSource = getRuntimeRasterSource(src);
  if (runtimeSource) return Promise.resolve(runtimeSource);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение.'));
    image.src = src;
  });
}

function sourceDimensions(source: CanvasImageSource) {
  const image = source as HTMLImageElement;
  const canvas = source as HTMLCanvasElement;
  return {
    width: Number(image.naturalWidth) || Number(canvas.width) || 1,
    height: Number(image.naturalHeight) || Number(canvas.height) || 1,
  };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG.')), 'image/png');
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение.')),
      type,
      quality,
    );
  });
}

export interface BudgetEncodedCanvas {
  blob: Blob;
  width: number;
  height: number;
}

const CLIPDROP_JPEG_QUALITIES = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.5] as const;

/**
 * Encodes a canvas as JPEG under a byte budget. Quality is reduced first;
 * when that is insufficient, both dimensions are reduced by 15% and the
 * quality search starts again. Returned dimensions describe the encoded JPEG
 * and allow callers to keep paired assets (for example a mask) in sync.
 */
export async function encodeCanvasToBudget(canvas: HTMLCanvasElement, maxBytes: number): Promise<BudgetEncodedCanvas> {
  if (maxBytes <= 0) throw new Error('Некорректный лимит размера изображения.');
  let width = Math.max(1, canvas.width);
  let height = Math.max(1, canvas.height);

  for (let resizeAttempt = 0; resizeAttempt < 32; resizeAttempt++) {
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('Canvas недоступен.');
    // JPEG has no alpha channel. White is a safer neutral background for
    // Clipdrop than the browser-dependent black produced from transparency.
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);

    for (const quality of CLIPDROP_JPEG_QUALITIES) {
      const blob = await canvasToBlob(output, 'image/jpeg', quality);
      if (blob.size < maxBytes) return { blob, width, height };
    }

    if (width === 1 && height === 1) break;
    width = Math.max(1, Math.floor(width * 0.85));
    height = Math.max(1, Math.floor(height * 0.85));
  }

  throw new Error('Изображение слишком большое для отправки. Попробуйте уменьшить выделение или размер файла.');
}

/** Converts any supported image blob to a budgeted JPEG. */
export async function encodeBlobToBudget(blob: Blob, maxBytes: number): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadCleanupImage(url);
    const canvas = document.createElement('canvas');
    const dimensions = sourceDimensions(image);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas недоступен.');
    ctx.drawImage(image, 0, 0);
    return (await encodeCanvasToBudget(canvas, maxBytes)).blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeData, width: number, height: number) {
  drawBrushStroke(ctx, stroke, width, height, { color: 'white' });
}

async function drawElement(ctx: CanvasRenderingContext2D, element: MaskElement, width: number, height: number) {
  if (element.type === 'brush') return drawStroke(ctx, element.stroke, width, height);
  if (element.type === 'polygon') {
    if (element.points.length < 6) return;
    ctx.save();
    ctx.globalCompositeOperation = element.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'white';
    ctx.beginPath();
    for (let index = 0; index < element.points.length; index += 2) {
      const x = element.points[index] * width;
      const y = element.points[index + 1] * height;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }
  const bitmap = await loadCleanupImage(element.src);
  ctx.save();
  ctx.globalCompositeOperation = element.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.drawImage(bitmap, 0, 0, width, height);
  ctx.restore();
}

/** Rasterizes mask elements into a standalone alpha mask canvas. */
export async function buildElementsMaskCanvas(elements: MaskElement[], width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  for (const element of elements) await drawElement(ctx, element, width, height);
  return canvas;
}

/** Punches erase-mask elements out of the target canvas (destination-out). */
export async function applyEraseElements(target: HTMLCanvasElement, elements: MaskElement[] | undefined) {
  if (!elements?.length) return;
  const mask = await buildElementsMaskCanvas(elements, target.width, target.height);
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
}

function adjustmentsFilter(adjustments?: { brightness: number; contrast: number; saturation: number }): string {
  if (!adjustments) return 'none';
  const { brightness, contrast, saturation } = adjustments;
  if (brightness === 1 && contrast === 1 && saturation === 1) return 'none';
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
}

/** Renders the base (original + committed cleanup) with adjustments and erase mask, without opacity. */
export async function buildBaseCanvas(doc: ImageDocument): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  const source = await loadCleanupImage(doc.cleanup.committed ?? doc.originalSrc);
  ctx.save();
  ctx.filter = adjustmentsFilter(doc.baseLayer?.adjustments);
  ctx.drawImage(source, 0, 0, doc.width, doc.height);
  ctx.restore();
  await applyEraseElements(canvas, doc.baseLayer?.eraseElements);
  return canvas;
}

/** Renders one raster/AI layer with its adjustments and erase mask applied. */
export async function buildRasterLayerCanvas(layer: AiRasterLayer, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  const image = await loadCleanupImage(layer.src);
  ctx.save();
  ctx.filter = adjustmentsFilter(layer.adjustments);
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
  await applyEraseElements(canvas, layer.eraseElements);
  return canvas;
}

/**
 * Bakes a brush stroke (doc-normalized points) into a drawing layer's bitmap
 * and returns the new src. Applies the inverse of the layer's non-destructive
 * transform so the stroke lands exactly where the user drew it on screen.
 */
export async function bakeStrokeIntoLayerSrc(
  layer: AiRasterLayer,
  docWidth: number,
  docHeight: number,
  stroke: StrokeData,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = docWidth; canvas.height = docHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  const image = await loadCleanupImage(layer.src);
  ctx.drawImage(image, 0, 0, docWidth, docHeight);

  if (layer.perspective && isValidPerspectiveQuad(layer.perspective)) {
    const points: number[] = [];
    for (let index = 0; index < stroke.points.length; index += 2) {
      const mapped = mapDocumentPointToLayerPoint(
        { x: stroke.points[index], y: stroke.points[index + 1] },
        layer.perspective,
        docWidth,
        docHeight,
      );
      if (mapped) points.push(mapped.x, mapped.y);
    }
    if (points.length >= 2) drawBrushStroke(ctx, { ...stroke, points }, docWidth, docHeight);
  } else {
    const { x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0 } = layer;
    ctx.save();
    // Inverse of drawPlacedLayer's transform: layer-local = S^-1 · R^-1 · T^-1 · doc.
    ctx.scale(1 / (scaleX || 1), 1 / (scaleY || 1));
    ctx.rotate((-rotation * Math.PI) / 180);
    ctx.translate(-x * docWidth, -y * docHeight);
    drawBrushStroke(ctx, stroke, docWidth, docHeight);
    ctx.restore();
  }
  const src = await canvasToPersistentDataUrl(canvas);
  registerRuntimeRasterSource(src, canvas);
  return src;
}

export interface RasterPlacement {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
  opacity?: number;
  perspective?: PerspectiveQuad | null;
  perspectiveSourceBounds?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Draws a fully-rendered layer canvas onto the composition applying the
 * non-destructive transform (x/y normalized to doc size, scale, rotation)
 * and crop. Identity transform + no crop = plain drawImage.
 */
export function drawPlacedLayer(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  placement: RasterPlacement,
  width: number,
  height: number,
) {
  const { x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0, crop, opacity = 1, perspective } = placement;
  if (perspective && isValidPerspectiveQuad(perspective)) {
    drawPerspectiveImage(ctx, source, perspective, width, height, {
      crop,
      sourceBounds: placement.perspectiveSourceBounds,
      opacity,
      quality: 'export',
    });
    return;
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x * width, y * height);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);
  if (crop) {
    ctx.drawImage(
      source,
      crop.x * source.width, crop.y * source.height, crop.width * source.width, crop.height * source.height,
      crop.x * width, crop.y * height, crop.width * width, crop.height * height,
    );
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }
  ctx.restore();
}

export async function drawRasterReferenceToContext(
  ctx: CanvasRenderingContext2D,
  doc: ImageDocument,
  ref: Extract<LayerReference, { type: 'base' | 'ai' }>,
): Promise<void> {
  if (ref.type === 'base') {
    const replacing = [...(doc.aiLayers ?? [])].reverse().find(layer => layer.visible && layer.replacesBase);
    if (replacing || doc.baseLayer?.visible === false) return;
    const base = await buildBaseCanvas(doc);
    const state = doc.baseLayer;
    drawPlacedLayer(ctx, base, {
      x: state?.x,
      y: state?.y,
      scaleX: state?.scaleX,
      scaleY: state?.scaleY,
      rotation: state?.rotation,
      crop: state?.crop,
      opacity: state?.opacity ?? 1,
      perspective: state?.perspective,
      perspectiveSourceBounds: state?.perspectiveSourceBounds,
    }, doc.width, doc.height);
    return;
  }

  const layer = (doc.aiLayers ?? []).find(item => item.id === ref.id);
  if (!layer || !layer.visible) return;
  try {
    const image = await buildRasterLayerCanvas(layer, doc.width, doc.height);
    drawPlacedLayer(ctx, image, {
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      crop: layer.crop,
      opacity: layer.opacity,
      perspective: layer.perspective,
      perspectiveSourceBounds: layer.perspectiveSourceBounds,
    }, doc.width, doc.height);
  } catch {
    // Optional pasted/AI layers may reference a missing local blob. Keep the
    // rest of the document compositable instead of failing every export/action.
  }
}

export async function buildCleanupSourceCanvas(
  doc: ImageDocument,
  options?: { willReadFrequently?: boolean },
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext(
    '2d',
    options?.willReadFrequently ? { willReadFrequently: true } : undefined,
  );
  if (!ctx) throw new Error('Canvas недоступен.');
  // Follow the document's unified z-order so previews, exports and AI sources match.
  const order = resolveLayerOrder(doc);
  for (const ref of order) {
    if (ref.type === 'base' || ref.type === 'ai') {
      await drawRasterReferenceToContext(ctx, doc, ref);
    }
    // text/watermark/shape refs are not part of the cleanup source.
  }
  return canvas;
}

export async function buildCleanupSource(doc: ImageDocument): Promise<Blob> {
  return canvasToPngBlob(await buildCleanupSourceCanvas(doc));
}

export async function buildCleanupMaskCanvas(doc: ImageDocument): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен.');
  const activeMask = (doc.masks ?? []).find(mask => mask.id === doc.activeMaskId);
  const elements = activeMask?.elements?.length
    ? activeMask.elements
    : (activeMask?.strokes ?? []).map(stroke => ({ type: 'brush', stroke }) as MaskElement);
  for (const element of elements) await drawElement(ctx, element, doc.width, doc.height);
  return canvas;
}

export async function buildCleanupMask(doc: ImageDocument): Promise<{ blob: Blob; isEmpty: boolean; canvas: HTMLCanvasElement }> {
  const canvas = await buildCleanupMaskCanvas(doc);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен.');
  const pixels = ctx.getImageData(0, 0, doc.width, doc.height).data;
  let isEmpty = true;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 8) { isEmpty = false; break; }
  }
  const output = document.createElement('canvas');
  output.width = doc.width; output.height = doc.height;
  const outputCtx = output.getContext('2d')!;
  outputCtx.fillStyle = 'black'; outputCtx.fillRect(0, 0, doc.width, doc.height);
  outputCtx.drawImage(canvas, 0, 0);
  return { blob: await canvasToPngBlob(output), isEmpty, canvas };
}

/**
 * Bounding box (in device pixels) of all pixels with alpha above the
 * threshold. Used to crop selection fragments to their actual bounds.
 * Returns null when the canvas is fully transparent.
 */
export function computeAlphaBBox(
  canvas: HTMLCanvasElement,
  threshold = 8,
): { x: number; y: number; width: number; height: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Clipdrop Cleanup rejects images above ~16 megapixels; RBG allows ~25. */
export const CLIPDROP_CLEANUP_MAX_PIXELS = 16_000_000;
export const CLIPDROP_RBG_MAX_PIXELS = 25_000_000;
export const CLIPDROP_CLEANUP_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const CLIPDROP_RBG_IMAGE_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);
export const CLIPDROP_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

export interface ClipdropCropPlan {
  image: Blob;
  mask: Blob;
  /** Crop rectangle in document pixels. */
  crop: { x: number; y: number; width: number; height: number };
}

/**
 * Prepares Clipdrop cleanup input that always fits the 16 MP API limit:
 * crops the source and mask to the selection's bounding box (plus context
 * padding), and downsizes the crop if it is still too large. The result is
 * pasted back at full document resolution, so quality outside the patch
 * never degrades.
 */
export async function prepareClipdropCleanupInput(
  doc: ImageDocument,
  maskCanvas: HTMLCanvasElement,
): Promise<ClipdropCropPlan> {
  const { width, height } = maskCanvas;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  const alpha = maskCtx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('Выделение пустое.');

  // Keep useful reconstruction context without turning a medium selection into
  // an unnecessarily large serverless request.
  const selectionW = maxX - minX + 1;
  const selectionH = maxY - minY + 1;
  const pad = Math.max(64, Math.round(Math.max(selectionW, selectionH) * 0.35));
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width, maxX + pad + 1) - cropX;
  const cropH = Math.min(height, maxY + pad + 1) - cropY;

  // Downscale the crop if even the cropped region exceeds the API limit.
  const scale = cropW * cropH > CLIPDROP_CLEANUP_MAX_PIXELS
    ? Math.sqrt(CLIPDROP_CLEANUP_MAX_PIXELS / (cropW * cropH))
    : 1;
  const outW = Math.max(1, Math.floor(cropW * scale));
  const outH = Math.max(1, Math.floor(cropH * scale));

  const source = await buildCleanupSourceCanvas(doc);
  let targetW = outW;
  let targetH = outH;
  for (let attempt = 0; attempt < 24; attempt++) {
    const imageCrop = document.createElement('canvas');
    imageCrop.width = targetW;
    imageCrop.height = targetH;
    const imageCtx = imageCrop.getContext('2d');
    if (!imageCtx) throw new Error('Canvas недоступен.');
    imageCtx.fillStyle = 'white';
    imageCtx.fillRect(0, 0, targetW, targetH);
    imageCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

    const encodedImage = await encodeCanvasToBudget(imageCrop, CLIPDROP_CLEANUP_IMAGE_MAX_BYTES);

    // The Cleanup API requires image and mask to have identical dimensions.
    // If JPEG budgeting downscaled the image, rasterize the PNG mask at the
    // exact encoded dimensions instead of resizing it independently.
    const maskCrop = document.createElement('canvas');
    maskCrop.width = encodedImage.width;
    maskCrop.height = encodedImage.height;
    const maskCropCtx = maskCrop.getContext('2d');
    if (!maskCropCtx) throw new Error('Canvas недоступен.');
    maskCropCtx.fillStyle = 'black';
    maskCropCtx.fillRect(0, 0, maskCrop.width, maskCrop.height);
    maskCropCtx.drawImage(maskCanvas, cropX, cropY, cropW, cropH, 0, 0, maskCrop.width, maskCrop.height);
    const encodedMask = await canvasToPngBlob(maskCrop);

    if (encodedImage.blob.size + encodedMask.size < CLIPDROP_REQUEST_MAX_BYTES) {
      return {
        image: encodedImage.blob,
        mask: encodedMask,
        crop: { x: cropX, y: cropY, width: cropW, height: cropH },
      };
    }

    // A complex/feathered PNG mask can consume more than the reserved 1 MB.
    // Reduce both assets together; plan.crop stays in document coordinates so
    // aiCleanupMaskedArea scales the returned patch back into the same area.
    targetW = Math.max(1, Math.floor(encodedImage.width * 0.85));
    targetH = Math.max(1, Math.floor(encodedImage.height * 0.85));
  }

  throw new Error('Изображение и маска слишком большие для отправки. Уменьшите выделение.');
}

/**
 * Downscales an image blob to fit a megapixel budget. Returns the original
 * blob when it already fits. Used for whole-image Clipdrop operations
 * (remove background), where the result is stretched back to document size.
 */
export async function fitBlobToPixelLimit(blob: Blob, maxPixels: number): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadCleanupImage(url);
    const dimensions = sourceDimensions(image);
    const pixels = dimensions.width * dimensions.height;
    if (pixels <= maxPixels) return blob;
    const scale = Math.sqrt(maxPixels / pixels);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(dimensions.width * scale));
    canvas.height = Math.max(1, Math.floor(dimensions.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createColorPatch(maskCanvas: HTMLCanvasElement, width: number, height: number, color: string): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(maskCanvas, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

export async function createCleanupPatch(resultSrc: string, maskCanvas: HTMLCanvasElement, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const result = await loadCleanupImage(resultSrc);
  ctx.drawImage(result, 0, 0, width, height);
  const feather = document.createElement('canvas'); feather.width = width; feather.height = height;
  const featherCtx = feather.getContext('2d')!;
  featherCtx.filter = 'blur(3px)'; featherCtx.drawImage(maskCanvas, 0, 0);
  // Feather only inside the user's mask. A plain blur expands the alpha
  // outside the selection and can smear a generated crop into nearby artwork.
  featherCtx.globalCompositeOperation = 'destination-in';
  featherCtx.filter = 'none';
  featherCtx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(feather, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function createFloodMask(doc: ImageDocument, normalizedX: number, normalizedY: number, threshold: number, contiguous = true) {
  const source = await buildCleanupSourceCanvas(doc, { willReadFrequently: true });
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  const sx = Math.min(width - 1, Math.max(0, Math.floor(normalizedX * width)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor(normalizedY * height)));
  const seed = (sy * width + sx) * 4;
  const selected = new Uint8Array(width * height);
  let count = 0;
  const limit = Math.max(4, threshold * 2.55);
  const matches = (offset: number) =>
    Math.max(Math.abs(data[offset] - data[seed]), Math.abs(data[offset + 1] - data[seed + 1]), Math.abs(data[offset + 2] - data[seed + 2]), Math.abs(data[offset + 3] - data[seed + 3])) <= limit;
  if (contiguous) {
    const queued = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0, tail = 0;
    const seedPixel = sy * width + sx;
    queue[tail++] = seedPixel;
    queued[seedPixel] = 1;
    while (head < tail) {
      const pixel = queue[head++];
      if (!matches(pixel * 4)) continue;
      selected[pixel] = 1; count++;
      const x = pixel % width, y = Math.floor(pixel / width);
      const enqueue = (next: number) => { if (!queued[next]) { queued[next] = 1; queue[tail++] = next; } };
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
  } else {
    for (let pixel = 0; pixel < selected.length; pixel++) {
      if (matches(pixel * 4)) { selected[pixel] = 1; count++; }
    }
  }
  const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
  const maskCtx = mask.getContext('2d')!; const image = maskCtx.createImageData(width, height);
  for (let pixel = 0; pixel < selected.length; pixel++) if (selected[pixel]) { const offset = pixel * 4; image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = image.data[offset + 3] = 255; }
  maskCtx.putImageData(image, 0, 0);
  return { src: mask.toDataURL('image/png'), coverage: count / (width * height) };
}
