import type { AiRasterLayer, CropRect, ImageDocument, LayerTransform, StrokeData } from '@/types';
import { useStore } from '@/store/useStore';
import { drawBrushStroke } from '@/utils/brushRaster';
import { buildBaseCanvas, buildRasterLayerCanvas, drawPlacedLayer } from '@/utils/cleanupRaster';
import { localBoundsForDocumentRect, mapRasterPointToDocumentPoint } from '@/utils/cloneStamp';
import type { PixelRect, RasterEffectPreview, RasterEffectSession, RasterEffectTarget } from '@/utils/rasterEffectSession';
import { canvasToPersistentDataUrl, registerRuntimeRasterSource } from '@/utils/runtimeRasterSources';
import { isValidPerspectiveQuad } from '@/utils/perspective';

type RasterPlacement = Partial<LayerTransform> & {
  crop?: CropRect | null;
  opacity?: number;
  perspectiveSourceBounds?: CropRect | null;
};

export interface EraserSessionOptions {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  settings: { size: number; hardness: number; opacity: number };
  previewScale: number;
}

interface EraserRasterOptions {
  original: HTMLCanvasElement;
  working: HTMLCanvasElement;
  localMask: HTMLCanvasElement;
  documentMask: HTMLCanvasElement;
  placement: RasterPlacement;
  documentBounds: PixelRect;
  opacity?: number;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function mergeBounds(current: PixelRect | null, next: PixelRect | null): PixelRect | null {
  if (!next) return current;
  if (!current) return { ...next };
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}

function context2d(canvas: HTMLCanvasElement, readback = false) {
  const context = canvas.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('Canvas недоступен.');
  return context;
}

function makeCanvas(width: number, height: number, readback = false) {
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  context2d(canvas, readback);
  return canvas;
}

/** Maps the document brush mask back into the layer bitmap and cuts alpha. */
export function renderEraserMaskToRaster(options: EraserRasterOptions): PixelRect | null {
  const { original, working, localMask, documentMask, placement, documentBounds } = options;
  const width = original.width;
  const height = original.height;
  const localBounds = localBoundsForDocumentRect(documentBounds, placement, width, height);
  if (!localBounds || localBounds.width < 1 || localBounds.height < 1) return null;

  const maskLeft = clamp(Math.floor(documentBounds.x), 0, documentMask.width);
  const maskTop = clamp(Math.floor(documentBounds.y), 0, documentMask.height);
  const maskRight = clamp(Math.ceil(documentBounds.x + documentBounds.width), maskLeft, documentMask.width);
  const maskBottom = clamp(Math.ceil(documentBounds.y + documentBounds.height), maskTop, documentMask.height);
  const maskWidth = maskRight - maskLeft;
  const maskHeight = maskBottom - maskTop;
  if (maskWidth < 1 || maskHeight < 1) return null;

  const originalContext = context2d(original, true);
  const workingContext = context2d(working, true);
  const localMaskContext = context2d(localMask, true);
  const documentMaskContext = context2d(documentMask, true);
  const sourcePixels = originalContext.getImageData(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
  // Start from the current working pixels so the padded bounds of a later
  // segment can never restore alpha erased by an earlier preview frame.
  const outputPixels = workingContext.getImageData(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
  const localMaskPixels = localMaskContext.getImageData(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
  const documentMaskPixels = documentMaskContext.getImageData(maskLeft, maskTop, maskWidth, maskHeight).data;
  const opacity = clamp(options.opacity ?? 1, 0, 1);

  for (let localY = 0; localY < localBounds.height; localY += 1) {
    for (let localX = 0; localX < localBounds.width; localX += 1) {
      const rasterPoint = {
        x: (localBounds.x + localX + 0.5) / width,
        y: (localBounds.y + localY + 0.5) / height,
      };
      const documentPoint = mapRasterPointToDocumentPoint(rasterPoint, placement, width, height);
      if (!documentPoint) continue;
      const documentX = Math.floor(documentPoint.x * documentMask.width);
      const documentY = Math.floor(documentPoint.y * documentMask.height);
      if (documentX < maskLeft || documentX >= maskRight || documentY < maskTop || documentY >= maskBottom) continue;
      const documentIndex = ((documentY - maskTop) * maskWidth + documentX - maskLeft) * 4;
      const amount = (documentMaskPixels[documentIndex + 3] / 255) * opacity;
      const localIndex = (localY * localBounds.width + localX) * 4;
      localMaskPixels.data[localIndex] = 255;
      localMaskPixels.data[localIndex + 1] = 255;
      localMaskPixels.data[localIndex + 2] = 255;
      localMaskPixels.data[localIndex + 3] = Math.round(amount * 255);
      outputPixels.data[localIndex + 3] = Math.round(sourcePixels.data[localIndex + 3] * (1 - amount));
    }
  }

  localMaskContext.putImageData(localMaskPixels, localBounds.x, localBounds.y);
  workingContext.putImageData(outputPixels, localBounds.x, localBounds.y);
  return localBounds;
}

function renderAffineEraserMaskToRaster(options: EraserRasterOptions): PixelRect | null {
  const { original, working, localMask, documentMask, placement, documentBounds } = options;
  const width = original.width;
  const height = original.height;
  const localBounds = localBoundsForDocumentRect(documentBounds, placement, width, height);
  if (!localBounds || localBounds.width < 1 || localBounds.height < 1) return null;
  const { x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0 } = placement;
  const maskContext = context2d(localMask);
  maskContext.save();
  maskContext.beginPath();
  maskContext.rect(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
  maskContext.clip();
  // Re-sample the cumulative document mask through the exact inverse affine
  // transform. Canvas interpolation keeps rotated/scaled eraser edges smooth
  // and avoids a JavaScript per-pixel loop on ordinary layers.
  maskContext.globalCompositeOperation = 'copy';
  maskContext.globalAlpha = clamp(options.opacity ?? 1, 0, 1);
  maskContext.scale(1 / (scaleX || 1), 1 / (scaleY || 1));
  maskContext.rotate((-rotation * Math.PI) / 180);
  maskContext.translate(-x * width, -y * height);
  maskContext.drawImage(documentMask, 0, 0, width, height);
  maskContext.restore();

  const workingContext = context2d(working);
  workingContext.save();
  workingContext.globalCompositeOperation = 'copy';
  workingContext.drawImage(
    original,
    localBounds.x, localBounds.y, localBounds.width, localBounds.height,
    localBounds.x, localBounds.y, localBounds.width, localBounds.height,
  );
  workingContext.globalCompositeOperation = 'destination-out';
  workingContext.drawImage(
    localMask,
    localBounds.x, localBounds.y, localBounds.width, localBounds.height,
    localBounds.x, localBounds.y, localBounds.width, localBounds.height,
  );
  workingContext.restore();
  return localBounds;
}

function selectedTarget(document: ImageDocument): RasterEffectTarget | null {
  const selected = document.selectedLayer;
  if (selected?.type === 'mask') return null;
  return selected?.type === 'ai'
    ? { type: 'ai', id: selected.id }
    : { type: 'base', id: document.baseLayer.id };
}

function targetRevision(document: ImageDocument, target: RasterEffectTarget) {
  return JSON.stringify({
    width: document.width,
    height: document.height,
    layer: target.type === 'base' ? document.baseLayer : document.aiLayers.find(layer => layer.id === target.id),
    source: target.type === 'base' ? document.cleanup.committed ?? document.originalSrc : undefined,
  });
}

function resolveTarget(document: ImageDocument, target: RasterEffectTarget) {
  const selected = selectedTarget(document);
  if (!selected || selected.type !== target.type || selected.id !== target.id) throw new Error('Активный растровый слой изменился.');
  const layer = target.type === 'base' ? document.baseLayer : document.aiLayers.find(item => item.id === target.id);
  if (!layer) throw new Error('Слой не найден.');
  if (!layer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
  if (layer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
  return layer;
}

/** Creates one live non-destructive erase mask and one undo entry. */
export async function createEraserSession(options: EraserSessionOptions): Promise<RasterEffectSession> {
  const state = useStore.getState();
  const document = state.documents[state.activeDocIndex];
  if (!document || document.id !== options.documentId) throw new Error('Активная страница изменилась.');
  const target: RasterEffectTarget = options.layer.type === 'base'
    ? { type: 'base', id: document.baseLayer.id }
    : { type: 'ai', id: options.layer.id };
  const placement = resolveTarget(document, target) as RasterPlacement;
  const revision = targetRevision(document, target);
  const builtOriginal = target.type === 'base'
    ? await buildBaseCanvas(document)
    : await buildRasterLayerCanvas(placement as AiRasterLayer, document.width, document.height);
  const original = makeCanvas(document.width, document.height, true);
  context2d(original, true).drawImage(builtOriginal, 0, 0);
  const working = makeCanvas(document.width, document.height, true);
  context2d(working, true).drawImage(original, 0, 0);
  const documentMask = makeCanvas(document.width, document.height, true);
  const documentMaskContext = context2d(documentMask, true);
  const localMask = makeCanvas(document.width, document.height, true);

  const latestDocument = useStore.getState().documents[useStore.getState().activeDocIndex];
  if (!latestDocument || latestDocument.id !== document.id) throw new Error('Активная страница изменилась.');
  resolveTarget(latestDocument, target);
  if (targetRevision(latestDocument, target) !== revision) throw new Error('Содержимое или геометрия слоя изменились.');

  const previewScale = Number.isFinite(options.previewScale) && options.previewScale > 0 ? options.previewScale : 1;
  const preview = makeCanvas(document.width * previewScale, document.height * previewScale);
  const previewContext = context2d(preview);
  let lastPoint: [number, number] | null = null;
  let dirtyBounds: PixelRect | null = null;
  let pendingPreviewBounds: PixelRect | null = null;
  let cancelled = false;
  let committing = false;
  let committedId: string | null = null;

  return {
    append(points) {
      if (cancelled || committing || committedId) return;
      const normalized: number[] = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const x = points[index];
        const y = points[index + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) normalized.push(clamp(x, 0, 1), clamp(y, 0, 1));
      }
      if (normalized.length < 2) return;
      const segment = lastPoint ? [lastPoint[0], lastPoint[1], ...normalized] : normalized;
      const stroke: StrokeData = {
        id: 'live-eraser-mask', points: segment, size: options.settings.size,
        hardness: options.settings.hardness, opacity: 1, color: '#ffffff', mode: 'paint',
      };
      const documentBounds = drawBrushStroke(documentMaskContext, stroke, document.width, document.height, {
        color: '#ffffff', skipFirstStamp: Boolean(lastPoint),
      });
      if (!documentBounds) return;
      const rasterOptions = {
        original, working, localMask, documentMask, placement, documentBounds, opacity: options.settings.opacity,
      };
      if (placement.perspective && isValidPerspectiveQuad(placement.perspective)) {
        renderEraserMaskToRaster(rasterOptions);
      } else {
        renderAffineEraserMaskToRaster(rasterOptions);
      }
      dirtyBounds = mergeBounds(dirtyBounds, documentBounds);
      pendingPreviewBounds = mergeBounds(pendingPreviewBounds, documentBounds);
      lastPoint = [normalized[normalized.length - 2], normalized[normalized.length - 1]];
    },

    async renderPreview(): Promise<RasterEffectPreview | null> {
      if (cancelled || committing || committedId || !pendingPreviewBounds) return null;
      const bounds = pendingPreviewBounds;
      pendingPreviewBounds = null;
      previewContext.clearRect(0, 0, preview.width, preview.height);
      drawPlacedLayer(previewContext, working, placement, preview.width, preview.height);
      return {
        canvas: preview,
        bounds: {
          x: Math.floor(bounds.x * previewScale), y: Math.floor(bounds.y * previewScale),
          width: Math.ceil(bounds.width * previewScale), height: Math.ceil(bounds.height * previewScale),
        },
        target,
        opacity: 1,
      };
    },

    async commit() {
      if (cancelled) throw new Error('Операция отменена.');
      if (committing || committedId) throw new Error('Операция уже завершается.');
      if (!dirtyBounds) throw new Error('Пустой штрих.');
      committing = true;
      const latest = useStore.getState();
      const latestDocument = latest.documents[latest.activeDocIndex];
      if (!latestDocument || latestDocument.id !== document.id) throw new Error('Активная страница изменилась.');
      resolveTarget(latestDocument, target);
      if (targetRevision(latestDocument, target) !== revision) throw new Error('Содержимое или геометрия слоя изменились.');
      const src = await canvasToPersistentDataUrl(localMask);
      registerRuntimeRasterSource(src, localMask);
      useStore.getState().addEraseElement(
        target.type === 'base' ? { type: 'base' } : { type: 'ai', id: target.id },
        { type: 'bitmap', src, mode: 'add' },
      );
      committedId = target.id;
      return target.id;
    },

    cancel() { if (!committedId) cancelled = true; },
  };
}
