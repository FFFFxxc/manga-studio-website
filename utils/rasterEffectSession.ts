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
type RasterTarget = { type: 'base'; id: string } | { type: 'ai'; id: string };

export interface RasterEffectSessionOptions {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  settings: BlurSettings;
  previewScale: number;
  createCanvas?: CanvasFactory;
}

export interface RasterEffectSession {
  append(points: number[]): void;
  renderPreview(): Promise<{ canvas: CanvasImageSource; bounds: PixelRect } | null>;
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

function resolveTarget(document: ImageDocument, target: RasterTarget) {
  const selected = selectedRasterTarget(document);
  if (!selected) throw new Error('Выберите растровый слой.');
  if (target.type === 'base') {
    if (target.id !== document.baseLayer.id) throw new Error('Слой не найден.');
    if (targetKey(selected) !== targetKey(target)) throw new Error('Активный слой изменился.');
    if (!document.baseLayer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
    if (document.baseLayer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
    return { target, layer: document.baseLayer } as const;
  }
  const layer = document.aiLayers.find(item => item.id === target.id);
  if (!layer) throw new Error('Слой не найден.');
  if (targetKey(selected) !== targetKey(target)) throw new Error('Активный слой изменился.');
  if (!layer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
  if (layer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
  return { target, layer } as const;
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
  });
}

function effectParameters(settings: BlurSettings, seed: number, scale: number): RasterEffectParameters {
  const intensity = clamp(Number.isFinite(settings.intensity) ? settings.intensity : 0.5, 0, 1);
  return {
    radius: Math.max(0, intensity * 36 * scale),
    strength: 1,
    cellSize: Math.max(1, Math.round((3 + intensity * 42) * scale)),
    noiseAmount: intensity * 36 / 255,
    noiseMonochrome: true,
    seed,
  };
}

function compositeEffect(
  effected: CanvasImageSource,
  mask: CanvasImageSource,
  bounds: PixelRect,
  factory: CanvasFactory,
) {
  const patch = createSurface(factory, bounds.width, bounds.height);
  const context = context2d(patch);
  context.drawImage(effected, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  context.globalCompositeOperation = 'source-over';
  return patch;
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

function effectLayerName(mode: RasterEffectMode) {
  if (mode === 'pixelate') return 'Пикселизация';
  if (mode === 'noise') return 'Шум';
  if (mode === 'sharpen') return 'Резкость';
  return 'Размытие';
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
  if (settings.applyTo === 'selection') {
    const selection = await buildCleanupMask(activeDocument);
    if (selection.isEmpty) throw new Error('Сначала создайте выделение.');
    mask = copyCanvas(selection.canvas, activeDocument.width, activeDocument.height, factory);
    dirtyBounds = alphaBounds(mask);
    if (!dirtyBounds) throw new Error('Сначала создайте выделение.');
  } else if (settings.gesture === 'area') {
    const context = context2d(mask);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, activeDocument.width, activeDocument.height);
    dirtyBounds = { x: 0, y: 0, width: activeDocument.width, height: activeDocument.height };
  }

  const builtSource = target.type === 'ai'
    ? await buildRasterLayerCanvas(resolved.layer as AiRasterLayer, activeDocument.width, activeDocument.height)
    : await buildBaseCanvas(activeDocument);
  const source = copyCanvas(builtSource, activeDocument.width, activeDocument.height, factory);
  let lastPoint: [number, number] | null = null;
  let cancelled = false;
  let committedId: string | null = null;
  let commitStarted = false;

  const renderCompositeAtScale = async (scale: number) => {
    if (!dirtyBounds) return null;
    const width = Math.max(1, Math.round(activeDocument.width * scale));
    const height = Math.max(1, Math.round(activeDocument.height * scale));
    const bounds = scaleBounds(dirtyBounds, scale, width, height);
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const scaledSource = copyCanvas(source, width, height, factory);
    const scaledMask = copyCanvas(mask, width, height, factory);
    const effected = renderRasterEffect(
      scaledSource as HTMLCanvasElement,
      bounds,
      settings.mode as RasterEffectMode,
      effectParameters(settings, seed, scale),
    );
    return { canvas: compositeEffect(effected, scaledMask, bounds, factory), bounds };
  };

  return {
    append(points) {
      if (cancelled || committedId || settings.applyTo === 'selection' || settings.gesture === 'area') return;
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
      lastPoint = [normalized[normalized.length - 2], normalized[normalized.length - 1]];
    },

    async renderPreview() {
      if (cancelled || committedId) return null;
      return renderCompositeAtScale(previewScale);
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
      resolveTarget(currentDocument, target);
      if (sourceRevision(currentDocument, target) !== revision) {
        cancelled = true;
        throw new Error('Содержимое слоя изменилось. Эффект отменён.');
      }

      try {
        const rendered = await renderCompositeAtScale(1);
        if (cancelled) throw new Error('Операция отменена.');
        if (!rendered) throw new Error('Пустой штрих.');
        const output = copyCanvas(source, activeDocument.width, activeDocument.height, factory);
        context2d(output).drawImage(rendered.canvas, rendered.bounds.x, rendered.bounds.y);
        const src = await canvasToDataUrl(output);
        if (cancelled) throw new Error('Операция отменена.');
        const commitState = useStore.getState();
        const commitDocument = commitState.documents[commitState.activeDocIndex];
        if (!commitDocument || commitDocument.id !== activeDocument.id) {
          cancelled = true;
          throw new Error('Активная страница изменилась. Эффект отменён.');
        }
        resolveTarget(commitDocument, target);
        if (sourceRevision(commitDocument, target) !== revision) {
          cancelled = true;
          throw new Error('Содержимое слоя изменилось. Эффект отменён.');
        }

        if (target.type === 'ai') {
          commitState.pushHistory();
          useStore.getState().updateAiLayer(target.id, {
            src,
            adjustments: { brightness: 1, contrast: 1, saturation: 1 },
          }, { history: false });
          committedId = target.id;
        } else {
          const id = `ai-effect-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          commitState.addAiLayer(activeDocument.id, {
            id,
            name: effectLayerName(settings.mode as RasterEffectMode),
            src,
            visible: true,
            opacity: 1,
            operation: 'effect',
            locked: false,
            eraseElements: [],
            crop: null,
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
          });
          committedId = id;
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
