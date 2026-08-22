import type {
  AiRasterLayer,
  BlurSettings,
  ImageDocument,
  RasterEffectMode,
  RasterEffectParameters,
  StrokeData,
} from '@/types';
import { useStore } from '@/store/useStore';
import { drawBrushStroke } from '@/utils/brushRaster';
import { buildBaseCanvas, buildCleanupMask, buildRasterLayerCanvas } from '@/utils/cleanupRaster';
import { renderRasterEffect } from '@/utils/rasterEffectPrimitives';

export interface PixelRect { x: number; y: number; width: number; height: number }

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
type CanvasFactory = (width: number, height: number) => CanvasSurface;
export type RasterEffectTarget = { type: 'base'; id: string } | { type: 'ai'; id: string };
type RasterTarget = RasterEffectTarget;

export interface RasterEffectPreview {
  /** Full target-layer replacement at preview scale. Render it in the target's z-order slot. */
  canvas: CanvasImageSource;
  /** The portion of the replacement that changed since the previous preview. */
  bounds: PixelRect;
  target: RasterEffectTarget;
  opacity: number;
}

export interface RasterEffectSessionOptions {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  settings: BlurSettings;
  previewScale: number;
  createCanvas?: CanvasFactory;
}

export interface RasterEffectSession {
  append(points: number[]): void;
  renderPreview(): Promise<RasterEffectPreview | null>;
  commit(): Promise<string>;
  cancel(): void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createDefaultCanvas(width: number, height: number): CanvasSurface {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function createSurface(factory: CanvasFactory, width: number, height: number) {
  const roundedWidth = Math.max(1, Math.round(width));
  const roundedHeight = Math.max(1, Math.round(height));
  const canvas = factory(roundedWidth, roundedHeight);
  canvas.width = roundedWidth;
  canvas.height = roundedHeight;
  return canvas;
}

function context2d(canvas: CanvasSurface, willReadFrequently = false) {
  const context = canvas.getContext(
    '2d',
    willReadFrequently ? { willReadFrequently: true } : undefined,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Canvas недоступен.');
  return context;
}

function copyCanvas(source: CanvasImageSource, width: number, height: number, factory: CanvasFactory) {
  const copy = createSurface(factory, width, height);
  context2d(copy).drawImage(source, 0, 0, width, height);
  return copy;
}

function mergeBounds(current: PixelRect | null, next: PixelRect | null): PixelRect | null {
  if (!next || next.width <= 0 || next.height <= 0) return current;
  if (!current) return { ...next };
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}

function scaleBounds(bounds: PixelRect, scale: number, width: number, height: number): PixelRect {
  const x = clamp(Math.floor(bounds.x * scale), 0, width);
  const y = clamp(Math.floor(bounds.y * scale), 0, height);
  const right = clamp(Math.ceil((bounds.x + bounds.width) * scale), x, width);
  const bottom = clamp(Math.ceil((bounds.y + bounds.height) * scale), y, height);
  return { x, y, width: right - x, height: bottom - y };
}

function alphaBounds(canvas: CanvasSurface): PixelRect | null {
  const pixels = context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function selectedRasterTarget(document: ImageDocument): RasterTarget | null {
  const selected = document.selectedLayer;
  if (!selected || selected.type === 'base') return { type: 'base', id: document.baseLayer.id };
  if (selected.type === 'ai') return { type: 'ai', id: selected.id };
  return null;
}

function requestedTarget(document: ImageDocument, layer: RasterEffectSessionOptions['layer']): RasterTarget {
  return layer.type === 'base'
    ? { type: 'base', id: document.baseLayer.id }
    : { type: 'ai', id: layer.id };
}

function targetKey(target: RasterTarget) {
  return `${target.type}:${target.id}`;
}

function resolveTarget(document: ImageDocument, target: RasterTarget, requireSelection = true) {
  const selected = requireSelection ? selectedRasterTarget(document) : null;
  if (requireSelection && !selected) throw new Error('Выберите растровый слой.');
  if (target.type === 'base') {
    if (target.id !== document.baseLayer.id) throw new Error('Слой не найден.');
    if (selected && targetKey(selected) !== targetKey(target)) throw new Error('Активный слой изменился.');
    if (!document.baseLayer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
    if (document.baseLayer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
    assertIdentityPlacement(document.baseLayer);
    return { target, layer: document.baseLayer } as const;
  }
  const layer = document.aiLayers.find(item => item.id === target.id);
  if (!layer) throw new Error('Слой не найден.');
  if (selected && targetKey(selected) !== targetKey(target)) throw new Error('Активный слой изменился.');
  if (!layer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
  if (layer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
  assertIdentityPlacement(layer);
  return { target, layer } as const;
}

function assertIdentityPlacement(layer: {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  crop?: unknown;
  perspective?: unknown;
  perspectiveSourceBounds?: unknown;
}) {
  const identity = (layer.x ?? 0) === 0
    && (layer.y ?? 0) === 0
    && (layer.scaleX ?? 1) === 1
    && (layer.scaleY ?? 1) === 1
    && (layer.rotation ?? 0) === 0
    && !layer.crop
    && !layer.perspective
    && !layer.perspectiveSourceBounds;
  if (!identity) {
    throw new Error('Эффект для перемещённого или деформированного слоя пока недоступен. Сначала сбросьте трансформацию слоя.');
  }
}

function sourceRevision(document: ImageDocument, target: RasterTarget) {
  if (target.type === 'base') {
    return JSON.stringify({
      width: document.width,
      height: document.height,
      id: document.baseLayer.id,
      src: document.cleanup.committed ?? document.originalSrc,
      adjustments: document.baseLayer.adjustments,
      eraseElements: document.baseLayer.eraseElements,
      placement: {
        x: document.baseLayer.x,
        y: document.baseLayer.y,
        scaleX: document.baseLayer.scaleX,
        scaleY: document.baseLayer.scaleY,
        rotation: document.baseLayer.rotation,
        crop: document.baseLayer.crop,
        perspective: document.baseLayer.perspective,
        perspectiveSourceBounds: document.baseLayer.perspectiveSourceBounds,
        opacity: document.baseLayer.opacity,
      },
    });
  }
  const layer = document.aiLayers.find(item => item.id === target.id);
  if (!layer) return 'missing';
  return JSON.stringify({
    width: document.width,
    height: document.height,
    id: layer.id,
    src: layer.src,
    adjustments: layer.adjustments,
    eraseElements: layer.eraseElements,
    placement: {
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      crop: layer.crop,
      perspective: layer.perspective,
      perspectiveSourceBounds: layer.perspectiveSourceBounds,
      opacity: layer.opacity,
    },
  });
}

function effectParameters(settings: BlurSettings, seed: number, scale: number): RasterEffectParameters {
  const strength = clamp(Number.isFinite(settings.strength) ? settings.strength : 0.5, 0, 1);
  const radius = settings.mode === 'sharpen' ? settings.sharpenRadius : settings.radius;
  return {
    radius: Math.max(0, (Number.isFinite(radius) ? radius : 1) * scale),
    strength: settings.mode === 'noise'
      ? 1
      : settings.mode === 'sharpen'
        ? clamp(Number.isFinite(settings.sharpenAmount) ? settings.sharpenAmount : 0.5, 0, 1)
        : strength,
    cellSize: Math.max(1, (Number.isFinite(settings.cellSize) ? settings.cellSize : 24) * scale),
    noiseAmount: clamp(Number.isFinite(settings.noiseAmount) ? settings.noiseAmount : 0.18, 0, 1),
    noiseMonochrome: settings.noiseMonochrome !== false,
    seed,
    coordinateScale: scale,
  };
}

export function blendEffectPixelData(
  source: Uint8ClampedArray,
  effected: Uint8ClampedArray,
  mask: Uint8ClampedArray,
) {
  const result = new Uint8ClampedArray(source.length);
  for (let index = 0; index < source.length; index += 4) {
    const amount = (mask[index + 3] ?? 0) / 255;
    result[index] = source[index] + (effected[index] - source[index]) * amount;
    result[index + 1] = source[index + 1] + (effected[index + 1] - source[index + 1]) * amount;
    result[index + 2] = source[index + 2] + (effected[index + 2] - source[index + 2]) * amount;
    result[index + 3] = source[index + 3];
  }
  return result;
}

function buildReplacementPatch(
  scaledSource: CanvasSurface,
  effected: CanvasImageSource,
  fullMask: CanvasSurface,
  documentBounds: PixelRect,
  scaledBounds: PixelRect,
  scale: number,
  factory: CanvasFactory,
) {
  const sourcePatch = createSurface(factory, scaledBounds.width, scaledBounds.height);
  const sourcePatchContext = context2d(sourcePatch, true);
  sourcePatchContext.drawImage(
    scaledSource,
    scaledBounds.x, scaledBounds.y, scaledBounds.width, scaledBounds.height,
    0, 0, scaledBounds.width, scaledBounds.height,
  );
  const maskPatch = createSurface(factory, scaledBounds.width, scaledBounds.height);
  const maskContext = context2d(maskPatch, true);
  const maskX = scaledBounds.x / scale;
  const maskY = scaledBounds.y / scale;
  const maskWidth = scaledBounds.width / scale;
  const maskHeight = scaledBounds.height / scale;
  maskContext.drawImage(
    fullMask,
    maskX, maskY, maskWidth, maskHeight,
    0, 0, scaledBounds.width, scaledBounds.height,
  );

  const patch = createSurface(factory, scaledBounds.width, scaledBounds.height);
  const patchContext = context2d(patch, true);
  const sourcePixels = sourcePatchContext.getImageData(0, 0, scaledBounds.width, scaledBounds.height);
  const effectCanvas = copyCanvas(effected, scaledBounds.width, scaledBounds.height, factory);
  const effectPixels = context2d(effectCanvas, true).getImageData(0, 0, scaledBounds.width, scaledBounds.height);
  const maskPixels = maskContext.getImageData(0, 0, scaledBounds.width, scaledBounds.height);
  const replacement = patchContext.createImageData(scaledBounds.width, scaledBounds.height);
  replacement.data.set(blendEffectPixelData(sourcePixels.data, effectPixels.data, maskPixels.data));
  patchContext.putImageData(replacement, 0, 0);
  return { canvas: patch, bounds: scaledBounds, documentBounds };
}

async function canvasToDataUrl(canvas: CanvasSurface) {
  const htmlCanvas = canvas as HTMLCanvasElement;
  if (typeof htmlCanvas.toDataURL === 'function') return htmlCanvas.toDataURL('image/png');
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось сохранить результат эффекта.'));
    reader.readAsDataURL(blob);
  });
}

export async function createRasterEffectSession(options: RasterEffectSessionOptions): Promise<RasterEffectSession> {
  const state = useStore.getState();
  const activeDocument = state.documents[state.activeDocIndex];
  if (!activeDocument) throw new Error('Нет активной страницы.');
  if (activeDocument.id !== options.documentId) throw new Error('Активная страница изменилась.');

  const target = requestedTarget(activeDocument, options.layer);
  const resolved = resolveTarget(activeDocument, target);
  const settings = { ...options.settings };
  const previewScale = Number.isFinite(options.previewScale) && options.previewScale > 0 ? options.previewScale : 1;
  const factory = options.createCanvas ?? createDefaultCanvas;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
  const revision = sourceRevision(activeDocument, target);

  let mask = createSurface(factory, activeDocument.width, activeDocument.height);
  let dirtyBounds: PixelRect | null = null;
  let pendingPreviewBounds: PixelRect | null = null;
  if (settings.applyTo === 'selection') {
    const selection = await buildCleanupMask(activeDocument);
    if (selection.isEmpty) throw new Error('Сначала создайте выделение.');
    mask = copyCanvas(selection.canvas, activeDocument.width, activeDocument.height, factory);
    dirtyBounds = alphaBounds(mask);
    if (!dirtyBounds) throw new Error('Сначала создайте выделение.');
    pendingPreviewBounds = { ...dirtyBounds };
  } else if (settings.gesture === 'area') {
    const context = context2d(mask);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, activeDocument.width, activeDocument.height);
    dirtyBounds = { x: 0, y: 0, width: activeDocument.width, height: activeDocument.height };
    pendingPreviewBounds = { ...dirtyBounds };
  }

  const builtSource = target.type === 'ai'
    ? await buildRasterLayerCanvas(resolved.layer as AiRasterLayer, activeDocument.width, activeDocument.height)
    : await buildBaseCanvas(activeDocument);
  const source = copyCanvas(builtSource, activeDocument.width, activeDocument.height, factory);
  const latestState = useStore.getState();
  const latestDocument = latestState.documents[latestState.activeDocIndex];
  if (!latestDocument || latestDocument.id !== activeDocument.id) {
    throw new Error('Активная страница изменилась. Эффект отменён.');
  }
  // The gesture already captured and validated its target at pointerdown.
  // Selection may legitimately be cleared after pointerup (for example by
  // Escape), so subsequent identity/revision checks must validate the captured
  // target itself rather than the current UI selection.
  resolveTarget(latestDocument, target, false);
  if (sourceRevision(latestDocument, target) !== revision) {
    throw new Error('Содержимое или геометрия слоя изменились. Эффект отменён.');
  }
  let lastPoint: [number, number] | null = null;
  let cancelled = false;
  let committedId: string | null = null;
  let commitStarted = false;
  let previewSource: CanvasSurface | null = null;
  let previewComposite: CanvasSurface | null = null;
  const targetOpacity = resolved.layer.opacity;

  const renderCompositeAtScale = async (documentBounds: PixelRect, scale: number) => {
    const width = Math.max(1, Math.round(activeDocument.width * scale));
    const height = Math.max(1, Math.round(activeDocument.height * scale));
    const bounds = scaleBounds(documentBounds, scale, width, height);
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const scaledSource = scale === 1
      ? source
      : previewSource ?? (previewSource = copyCanvas(source, width, height, factory));
    const effected = renderRasterEffect(
      scaledSource as HTMLCanvasElement,
      bounds,
      settings.mode as RasterEffectMode,
      effectParameters(settings, seed, scale),
    );
    return buildReplacementPatch(scaledSource, effected, mask, documentBounds, bounds, scale, factory);
  };

  return {
    append(points) {
      if (cancelled || committedId || commitStarted || settings.applyTo === 'selection' || settings.gesture === 'area') return;
      const normalized: number[] = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const x = points[index];
        const y = points[index + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        normalized.push(clamp(x, 0, 1), clamp(y, 0, 1));
      }
      if (normalized.length < 2) return;
      const segment = lastPoint ? [lastPoint[0], lastPoint[1], ...normalized] : normalized;
      const stroke: StrokeData = {
        id: 'raster-effect-mask',
        points: segment,
        size: settings.brushSize,
        color: '#ffffff',
        opacity: 1,
        hardness: settings.hardness,
        mode: 'paint',
      };
      const next = drawBrushStroke(
        context2d(mask) as CanvasRenderingContext2D,
        stroke,
        activeDocument.width,
        activeDocument.height,
        { color: '#ffffff', skipFirstStamp: Boolean(lastPoint) },
      );
      dirtyBounds = mergeBounds(dirtyBounds, next);
      pendingPreviewBounds = mergeBounds(pendingPreviewBounds, next);
      lastPoint = [normalized[normalized.length - 2], normalized[normalized.length - 1]];
    },

    async renderPreview() {
      if (cancelled || committedId || commitStarted || !pendingPreviewBounds) return null;
      const bounds = pendingPreviewBounds;
      pendingPreviewBounds = null;
      const rendered = await renderCompositeAtScale(bounds, previewScale);
      if (!rendered) return null;
      const width = Math.max(1, Math.round(activeDocument.width * previewScale));
      const height = Math.max(1, Math.round(activeDocument.height * previewScale));
      const replacement = previewComposite
        ?? (previewComposite = copyCanvas(previewSource ?? source, width, height, factory));
      const replacementPixels = context2d(rendered.canvas, true).getImageData(
        0, 0, rendered.bounds.width, rendered.bounds.height,
      );
      context2d(replacement).putImageData(replacementPixels, rendered.bounds.x, rendered.bounds.y);
      return {
        canvas: replacement,
        bounds: rendered.bounds,
        target: { ...target },
        opacity: targetOpacity,
      };
    },

    async commit() {
      if (cancelled) throw new Error('Операция отменена.');
      if (committedId) throw new Error('Операция уже завершена.');
      if (commitStarted) throw new Error('Операция уже завершается.');
      if (!dirtyBounds) throw new Error('Пустой штрих.');
      commitStarted = true;

      const currentState = useStore.getState();
      const currentDocument = currentState.documents[currentState.activeDocIndex];
      if (!currentDocument || currentDocument.id !== activeDocument.id) {
        cancelled = true;
        throw new Error('Активная страница изменилась. Эффект отменён.');
      }
      resolveTarget(currentDocument, target, false);
      if (sourceRevision(currentDocument, target) !== revision) {
        cancelled = true;
        throw new Error('Содержимое или геометрия слоя изменились. Эффект отменён.');
      }

      try {
        const rendered = await renderCompositeAtScale(dirtyBounds, 1);
        if (cancelled) throw new Error('Операция отменена.');
        if (!rendered) throw new Error('Пустой штрих.');
        const output = copyCanvas(source, activeDocument.width, activeDocument.height, factory);
        const replacement = context2d(rendered.canvas, true).getImageData(
          0, 0, rendered.bounds.width, rendered.bounds.height,
        );
        context2d(output).putImageData(replacement, rendered.bounds.x, rendered.bounds.y);
        const src = await canvasToDataUrl(output);
        if (cancelled) throw new Error('Операция отменена.');
        const commitState = useStore.getState();
        const commitDocument = commitState.documents[commitState.activeDocIndex];
        if (!commitDocument || commitDocument.id !== activeDocument.id) {
          cancelled = true;
          throw new Error('Активная страница изменилась. Эффект отменён.');
        }
        resolveTarget(commitDocument, target, false);
        if (sourceRevision(commitDocument, target) !== revision) {
          cancelled = true;
          throw new Error('Содержимое или геометрия слоя изменились. Эффект отменён.');
        }

        if (target.type === 'ai') {
          commitState.pushHistory();
          useStore.getState().updateAiLayer(target.id, {
            src,
            adjustments: { brightness: 1, contrast: 1, saturation: 1 },
            eraseElements: [],
          }, { history: false });
          committedId = target.id;
        } else {
          commitState.commitBaseRasterEffect(src);
          committedId = target.id;
        }
        return committedId;
      } catch (error) {
        cancelled = true;
        throw error;
      }
    },

    cancel() {
      if (!committedId) cancelled = true;
    },
  };
}
