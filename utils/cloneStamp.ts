import type { AiRasterLayer, CloneStampSettings, CropRect, ImageDocument, LayerTransform, StrokeData } from '@/types';
import { useStore } from '@/store/useStore';
import { drawBrushStroke } from '@/utils/brushRaster';
import {
  buildBaseCanvas,
  buildCleanupMask,
  buildRasterLayerCanvas,
  drawPlacedLayer,
} from '@/utils/cleanupRaster';
import { renderDocumentToCanvas } from '@/utils/documentComposite';
import {
  invertHomography,
  isValidPerspectiveQuad,
  perspectiveHomography,
  projectHomography,
} from '@/utils/perspective';
import type { PixelRect, RasterEffectPreview, RasterEffectSession, RasterEffectTarget } from '@/utils/rasterEffectSession';

type RasterPlacement = Partial<LayerTransform> & {
  crop?: CropRect | null;
  opacity?: number;
  perspectiveSourceBounds?: CropRect | null;
};

export interface CloneStampSessionOptions {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  sourceAnchor: { x: number; y: number };
  strokeAnchor: { x: number; y: number };
  settings: CloneStampSettings;
  previewScale: number;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function mapCloneSamplePoint(
  destination: { x: number; y: number },
  sourceAnchor: { x: number; y: number },
  strokeAnchor: { x: number; y: number },
) {
  return {
    x: sourceAnchor.x + destination.x - strokeAnchor.x,
    y: sourceAnchor.y + destination.y - strokeAnchor.y,
  };
}

function sourceBoundsPoint(point: { x: number; y: number }, bounds?: CropRect | null) {
  if (!bounds) return point;
  return { x: bounds.x + point.x * bounds.width, y: bounds.y + point.y * bounds.height };
}

function unitPoint(point: { x: number; y: number }, bounds?: CropRect | null) {
  if (!bounds) return point;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return { x: (point.x - bounds.x) / bounds.width, y: (point.y - bounds.y) / bounds.height };
}

/** Maps document-normalized coordinates into the raster's untransformed bitmap. */
export function mapDocumentPointToRasterPoint(
  point: { x: number; y: number },
  placement: RasterPlacement,
  width: number,
  height: number,
) {
  if (placement.perspective && isValidPerspectiveQuad(placement.perspective)) {
    const forward = perspectiveHomography(placement.perspective, width, height);
    const inverse = forward && invertHomography(forward);
    if (!inverse) return null;
    const unit = projectHomography(inverse, { x: point.x * width, y: point.y * height });
    return sourceBoundsPoint(unit, placement.perspectiveSourceBounds);
  }
  const radians = -((placement.rotation ?? 0) * Math.PI) / 180;
  const translatedX = point.x * width - (placement.x ?? 0) * width;
  const translatedY = point.y * height - (placement.y ?? 0) * height;
  const rotatedX = translatedX * Math.cos(radians) - translatedY * Math.sin(radians);
  const rotatedY = translatedX * Math.sin(radians) + translatedY * Math.cos(radians);
  const scaleX = placement.scaleX || 1;
  const scaleY = placement.scaleY || 1;
  return { x: rotatedX / scaleX / width, y: rotatedY / scaleY / height };
}

/** Maps an untransformed bitmap point into document-normalized coordinates. */
export function mapRasterPointToDocumentPoint(
  point: { x: number; y: number },
  placement: RasterPlacement,
  width: number,
  height: number,
) {
  if (placement.perspective && isValidPerspectiveQuad(placement.perspective)) {
    const unit = unitPoint(point, placement.perspectiveSourceBounds);
    const forward = perspectiveHomography(placement.perspective, width, height);
    if (!unit || !forward) return null;
    const projected = projectHomography(forward, unit);
    return { x: projected.x / width, y: projected.y / height };
  }
  const radians = ((placement.rotation ?? 0) * Math.PI) / 180;
  const scaledX = point.x * width * (placement.scaleX ?? 1);
  const scaledY = point.y * height * (placement.scaleY ?? 1);
  const rotatedX = scaledX * Math.cos(radians) - scaledY * Math.sin(radians);
  const rotatedY = scaledX * Math.sin(radians) + scaledY * Math.cos(radians);
  return {
    x: (rotatedX + (placement.x ?? 0) * width) / width,
    y: (rotatedY + (placement.y ?? 0) * height) / height,
  };
}

function mergeBounds(current: PixelRect | null, next: PixelRect | null): PixelRect | null {
  if (!next) return current;
  if (!current) return { ...next };
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}

function localBoundsForDocumentRect(rect: PixelRect, placement: RasterPlacement, width: number, height: number) {
  const corners = [
    { x: rect.x / width, y: rect.y / height },
    { x: (rect.x + rect.width) / width, y: rect.y / height },
    { x: (rect.x + rect.width) / width, y: (rect.y + rect.height) / height },
    { x: rect.x / width, y: (rect.y + rect.height) / height },
  ].map(point => mapDocumentPointToRasterPoint(point, placement, width, height)).filter(Boolean) as Array<{ x: number; y: number }>;
  if (!corners.length) return null;
  const left = clamp(Math.floor(Math.min(...corners.map(point => point.x)) * width) - 2, 0, width);
  const top = clamp(Math.floor(Math.min(...corners.map(point => point.y)) * height) - 2, 0, height);
  const right = clamp(Math.ceil(Math.max(...corners.map(point => point.x)) * width) + 2, left, width);
  const bottom = clamp(Math.ceil(Math.max(...corners.map(point => point.y)) * height) + 2, top, height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function blendPixel(target: Uint8ClampedArray, index: number, source: Uint8ClampedArray, sourceIndex: number, amount: number) {
  const sourceAlpha = (source[sourceIndex + 3] / 255) * amount;
  if (sourceAlpha <= 0) return;
  const targetAlpha = target[index + 3] / 255;
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel++) {
    target[index + channel] = Math.round((
      source[sourceIndex + channel] * sourceAlpha
      + target[index + channel] * targetAlpha * (1 - sourceAlpha)
    ) / outputAlpha);
  }
  target[index + 3] = Math.round(outputAlpha * 255);
}

export function renderCloneStampStroke(options: {
  original: HTMLCanvasElement;
  working: HTMLCanvasElement;
  sample: HTMLCanvasElement;
  strokeMask: HTMLCanvasElement;
  selectionMask?: HTMLCanvasElement | null;
  samplePixels?: Uint8ClampedArray;
  selectionPixels?: Uint8ClampedArray | null;
  placement: RasterPlacement;
  documentBounds: PixelRect;
  sourceAnchor: { x: number; y: number };
  strokeAnchor: { x: number; y: number };
  opacity: number;
}) {
  const { original, working, sample, strokeMask, selectionMask, placement, documentBounds, sourceAnchor, strokeAnchor } = options;
  const width = original.width;
  const height = original.height;
  const localBounds = localBoundsForDocumentRect(documentBounds, placement, width, height);
  if (!localBounds || localBounds.width < 1 || localBounds.height < 1) return null;
  const originalContext = original.getContext('2d', { willReadFrequently: true });
  const workingContext = working.getContext('2d', { willReadFrequently: true });
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  const maskContext = strokeMask.getContext('2d', { willReadFrequently: true });
  const selectionContext = selectionMask?.getContext('2d', { willReadFrequently: true }) ?? null;
  if (!originalContext || !workingContext || !sampleContext || !maskContext) throw new Error('Canvas недоступен.');
  const output = originalContext.getImageData(localBounds.x, localBounds.y, localBounds.width, localBounds.height);
  const samplePixels = options.samplePixels ?? sampleContext.getImageData(0, 0, sample.width, sample.height).data;
  const maskLeft = clamp(Math.floor(documentBounds.x), 0, width);
  const maskTop = clamp(Math.floor(documentBounds.y), 0, height);
  const maskRight = clamp(Math.ceil(documentBounds.x + documentBounds.width), maskLeft, width);
  const maskBottom = clamp(Math.ceil(documentBounds.y + documentBounds.height), maskTop, height);
  const maskWidth = maskRight - maskLeft;
  const maskHeight = maskBottom - maskTop;
  if (maskWidth < 1 || maskHeight < 1) return null;
  const maskPixels = maskContext.getImageData(maskLeft, maskTop, maskWidth, maskHeight).data;
  const selectionPixels = options.selectionPixels ?? selectionContext?.getImageData(0, 0, width, height).data ?? null;
  const opacity = clamp(options.opacity, 0, 1);

  for (let localY = 0; localY < localBounds.height; localY++) {
    for (let localX = 0; localX < localBounds.width; localX++) {
      const rasterPoint = {
        x: (localBounds.x + localX + 0.5) / width,
        y: (localBounds.y + localY + 0.5) / height,
      };
      const documentPoint = mapRasterPointToDocumentPoint(rasterPoint, placement, width, height);
      if (!documentPoint) continue;
      const documentX = Math.floor(documentPoint.x * width);
      const documentY = Math.floor(documentPoint.y * height);
      if (documentX < 0 || documentX >= width || documentY < 0 || documentY >= height) continue;
      if (documentX < maskLeft || documentX >= maskRight || documentY < maskTop || documentY >= maskBottom) continue;
      const maskIndex = ((documentY - maskTop) * maskWidth + documentX - maskLeft) * 4;
      let amount = (maskPixels[maskIndex + 3] / 255) * opacity;
      if (selectionPixels) amount *= selectionPixels[(documentY * width + documentX) * 4 + 3] / 255;
      if (amount <= 0) continue;
      const samplePoint = mapCloneSamplePoint(documentPoint, sourceAnchor, strokeAnchor);
      const sampleX = Math.floor(samplePoint.x * width);
      const sampleY = Math.floor(samplePoint.y * height);
      if (sampleX < 0 || sampleX >= sample.width || sampleY < 0 || sampleY >= sample.height) continue;
      const outputIndex = (localY * localBounds.width + localX) * 4;
      const sampleIndex = (sampleY * sample.width + sampleX) * 4;
      blendPixel(output.data, outputIndex, samplePixels, sampleIndex, amount);
    }
  }
  workingContext.putImageData(output, localBounds.x, localBounds.y);
  return localBounds;
}

function targetRevision(doc: ImageDocument, target: RasterEffectTarget) {
  if (target.type === 'base') {
    return JSON.stringify({
      src: doc.cleanup.committed ?? doc.originalSrc,
      layer: doc.baseLayer,
      width: doc.width,
      height: doc.height,
    });
  }
  return JSON.stringify({ layer: doc.aiLayers.find(item => item.id === target.id), width: doc.width, height: doc.height });
}

function resolveTarget(doc: ImageDocument, target: RasterEffectTarget) {
  const layer = target.type === 'base' ? doc.baseLayer : doc.aiLayers.find(item => item.id === target.id);
  if (!layer) throw new Error('Слой не найден.');
  if (!layer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
  if (layer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
  return layer;
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png');
}

export async function createCloneStampSession(options: CloneStampSessionOptions): Promise<RasterEffectSession> {
  const state = useStore.getState();
  const document = state.documents[state.activeDocIndex];
  if (!document || document.id !== options.documentId) throw new Error('Активная страница изменилась.');
  const target: RasterEffectTarget = options.layer.type === 'base'
    ? { type: 'base', id: document.baseLayer.id }
    : { type: 'ai', id: options.layer.id };
  const selected = document.selectedLayer;
  const selectedTarget = selected?.type === 'ai'
    ? { type: 'ai' as const, id: selected.id }
    : selected?.type === 'mask'
      ? null
      : { type: 'base' as const, id: document.baseLayer.id };
  if (!selectedTarget || selectedTarget.type !== target.type || selectedTarget.id !== target.id) {
    throw new Error('Активный растровый слой изменился.');
  }
  const placement = resolveTarget(document, target) as RasterPlacement;
  const revision = targetRevision(document, target);
  const original = target.type === 'base'
    ? await buildBaseCanvas(document)
    : await buildRasterLayerCanvas(placement as AiRasterLayer, document.width, document.height);
  const working = window.document.createElement('canvas');
  working.width = document.width;
  working.height = document.height;
  working.getContext('2d')?.drawImage(original, 0, 0);

  const sample = options.settings.sample === 'all'
    ? await renderDocumentToCanvas(document, 'png')
    : (() => {
      const canvas = window.document.createElement('canvas');
      canvas.width = document.width;
      canvas.height = document.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas недоступен.');
      drawPlacedLayer(context, original, { ...placement, opacity: 1 }, document.width, document.height);
      return canvas;
    })();

  let selectionMask: HTMLCanvasElement | null = null;
  if (document.activeMaskId) {
    const selection = await buildCleanupMask(document);
    if (!selection.isEmpty) selectionMask = selection.canvas;
  }
  const samplePixels = sample.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, sample.width, sample.height).data;
  if (!samplePixels) throw new Error('Canvas недоступен.');
  const selectionPixels = selectionMask?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, document.width, document.height).data ?? null;
  const latestState = useStore.getState();
  const latestDocument = latestState.documents[latestState.activeDocIndex];
  if (!latestDocument || latestDocument.id !== document.id) throw new Error('Активная страница изменилась.');
  resolveTarget(latestDocument, target);
  if (targetRevision(latestDocument, target) !== revision) throw new Error('Содержимое или геометрия слоя изменились.');
  const strokeMask = window.document.createElement('canvas');
  strokeMask.width = document.width;
  strokeMask.height = document.height;
  const strokeContext = strokeMask.getContext('2d');
  if (!strokeContext) throw new Error('Canvas недоступен.');

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
        id: 'clone-stamp-mask',
        points: segment,
        size: options.settings.size,
        hardness: options.settings.hardness,
        opacity: 1,
        color: '#ffffff',
        mode: 'paint',
      };
      const next = drawBrushStroke(strokeContext, stroke, document.width, document.height, {
        color: '#ffffff',
        skipFirstStamp: Boolean(lastPoint),
      });
      if (!next) return;
      renderCloneStampStroke({
        original,
        working,
        sample,
        strokeMask,
        selectionMask,
        samplePixels,
        selectionPixels,
        placement,
        documentBounds: next,
        sourceAnchor: options.sourceAnchor,
        strokeAnchor: options.strokeAnchor,
        opacity: options.settings.opacity,
      });
      dirtyBounds = mergeBounds(dirtyBounds, next);
      pendingPreviewBounds = mergeBounds(pendingPreviewBounds, next);
      lastPoint = [normalized[normalized.length - 2], normalized[normalized.length - 1]];
    },

    async renderPreview(): Promise<RasterEffectPreview | null> {
      if (cancelled || committing || committedId || !pendingPreviewBounds) return null;
      const bounds = pendingPreviewBounds;
      pendingPreviewBounds = null;
      const scale = Number.isFinite(options.previewScale) && options.previewScale > 0 ? options.previewScale : 1;
      const width = Math.max(1, Math.round(document.width * scale));
      const height = Math.max(1, Math.round(document.height * scale));
      const preview = window.document.createElement('canvas');
      preview.width = width;
      preview.height = height;
      const context = preview.getContext('2d');
      if (!context) throw new Error('Canvas недоступен.');
      drawPlacedLayer(context, working, placement, width, height);
      return {
        canvas: preview,
        bounds: {
          x: Math.floor(bounds.x * scale),
          y: Math.floor(bounds.y * scale),
          width: Math.ceil(bounds.width * scale),
          height: Math.ceil(bounds.height * scale),
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
      const src = canvasToDataUrl(working);
      if (target.type === 'base') {
        latest.commitBaseRasterEffect(src);
      } else {
        latest.pushHistory();
        useStore.getState().updateAiLayer(target.id, {
          src,
          adjustments: { brightness: 1, contrast: 1, saturation: 1 },
          eraseElements: [],
        }, { history: false });
      }
      committedId = target.id;
      return target.id;
    },

    cancel() {
      if (!committedId) cancelled = true;
    },
  };
}
