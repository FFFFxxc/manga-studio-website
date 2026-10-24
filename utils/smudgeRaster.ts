import type { AiRasterLayer, BlurSettings, CropRect, ImageDocument, LayerTransform, SmudgeSettings, StrokeData } from '@/types';
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
  createRasterPointMapper,
  localBoundsForDocumentRect,
  mapRasterPointToDocumentPoint,
} from '@/utils/cloneStamp';
import type { PixelRect, RasterEffectPreview, RasterEffectSession, RasterEffectTarget } from '@/utils/rasterEffectSession';
import { canvasToPersistentDataUrl, registerRuntimeRasterSource } from '@/utils/runtimeRasterSources';
import { mixPremultipliedPixel, samplePremultipliedBilinear } from '@/utils/rasterSampling';
import { createSmudgeDabSampler, type SmudgeDab } from '@/utils/smudgeDabs';

type RasterPlacement = Partial<LayerTransform> & {
  crop?: CropRect | null;
  opacity?: number;
  perspectiveSourceBounds?: CropRect | null;
};

type LocalRetouchOptions = {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  previewScale: number;
} & (
  | { tool: 'smudge'; settings: SmudgeSettings }
  | { tool: 'sharpen'; settings: Pick<BlurSettings, 'brushSize' | 'hardness' | 'sharpenAmount' | 'sharpenRadius'> }
);

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** Small pure same-coordinate primitive used by pixel-direction tests. */
export function renderSmudgeSegment(
  source: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  settings: { size: number; hardness: number; strength: number },
  bounds: PixelRect = { x: 0, y: 0, width: source.width, height: source.height },
) {
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  const outputContext = output.getContext('2d', { willReadFrequently: true });
  if (!sourceContext || !outputContext) throw new Error('Canvas недоступен.');
  outputContext.drawImage(source, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const result = outputContext.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  const radius = Math.max(0.5, settings.size / 2);
  const hard = clamp(settings.hardness, 0, 1);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const sample = new Float64Array(4);
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const documentX = bounds.x + x;
    const documentY = bounds.y + y;
    const distance = Math.hypot(documentX + 0.5 - to.x, documentY + 0.5 - to.y) / radius;
    if (distance > 1) continue;
    const edge = hard >= 1 || distance <= hard ? 1 : (1 - distance) / Math.max(0.001, 1 - hard);
    samplePremultipliedBilinear(pixels, source.width, source.height, documentX - deltaX, documentY - deltaY, sample);
    mixPremultipliedPixel(result.data, (y * bounds.width + x) * 4, sample, edge * clamp(settings.strength, 0, 1));
  }
  outputContext.putImageData(result, bounds.x, bounds.y);
  return output;
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

function unionBounds(first: PixelRect, second: PixelRect, width: number, height: number) {
  const x = clamp(Math.min(first.x, second.x), 0, width);
  const y = clamp(Math.min(first.y, second.y), 0, height);
  const right = clamp(Math.max(first.x + first.width, second.x + second.width), x, width);
  const bottom = clamp(Math.max(first.y + first.height, second.y + second.height), y, height);
  return { x, y, width: right - x, height: bottom - y };
}

function targetRevision(doc: ImageDocument, target: RasterEffectTarget) {
  return target.type === 'base'
    ? JSON.stringify({ src: doc.cleanup.committed ?? doc.originalSrc, layer: doc.baseLayer, width: doc.width, height: doc.height })
    : JSON.stringify({ layer: doc.aiLayers.find(item => item.id === target.id), width: doc.width, height: doc.height });
}

function resolveTarget(doc: ImageDocument, target: RasterEffectTarget) {
  const layer = target.type === 'base' ? doc.baseLayer : doc.aiLayers.find(item => item.id === target.id);
  if (!layer) throw new Error('Слой не найден.');
  if (!layer.visible) throw new Error('Слой скрыт. Сделайте слой видимым.');
  if (layer.locked) throw new Error('Слой заблокирован. Снимите блокировку.');
  return layer;
}

function selectedMatches(doc: ImageDocument, target: RasterEffectTarget) {
  const selected = doc.selectedLayer;
  if (selected?.type === 'mask') return false;
  if (selected?.type === 'ai') return target.type === 'ai' && target.id === selected.id;
  return target.type === 'base' && target.id === doc.baseLayer.id;
}

function maskPatch(mask: HTMLCanvasElement, bounds: PixelRect) {
  const left = clamp(Math.floor(bounds.x), 0, mask.width);
  const top = clamp(Math.floor(bounds.y), 0, mask.height);
  const right = clamp(Math.ceil(bounds.x + bounds.width), left, mask.width);
  const bottom = clamp(Math.ceil(bounds.y + bounds.height), top, mask.height);
  const width = right - left;
  const height = bottom - top;
  const data = mask.getContext('2d', { willReadFrequently: true })?.getImageData(left, top, width, height).data;
  if (!data) throw new Error('Canvas недоступен.');
  return { left, top, width, height, data };
}

function maskAmount(
  point: { x: number; y: number },
  width: number,
  height: number,
  patch: ReturnType<typeof maskPatch>,
  selectionPixels: Uint8ClampedArray | null,
) {
  const x = Math.floor(point.x * width);
  const y = Math.floor(point.y * height);
  if (x < patch.left || x >= patch.left + patch.width || y < patch.top || y >= patch.top + patch.height) return 0;
  let amount = patch.data[((y - patch.top) * patch.width + x - patch.left) * 4 + 3] / 255;
  if (selectionPixels && x >= 0 && x < width && y >= 0 && y < height) amount *= selectionPixels[(y * width + x) * 4 + 3] / 255;
  return amount;
}

export function renderSmudgeOnLayer(options: {
  working: HTMLCanvasElement;
  placement: RasterPlacement;
  documentBounds: PixelRect;
  size: number;
  hardness: number;
  mapper?: ReturnType<typeof createRasterPointMapper>;
  selectionPixels: Uint8ClampedArray | null;
  sampleAllPixels: Uint8ClampedArray | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  strength: number;
}) {
  const { working, placement, documentBounds, from, to } = options;
  const width = working.width;
  const height = working.height;
  const destinationBounds = localBoundsForDocumentRect(documentBounds, placement, width, height);
  if (!destinationBounds || destinationBounds.width < 1 || destinationBounds.height < 1) return null;
  const delta = { x: to.x - from.x, y: to.y - from.y };
  const sourceDocumentBounds = {
    x: documentBounds.x - delta.x * width,
    y: documentBounds.y - delta.y * height,
    width: documentBounds.width,
    height: documentBounds.height,
  };
  const sourceBounds = localBoundsForDocumentRect(sourceDocumentBounds, placement, width, height) ?? destinationBounds;
  const readBounds = unionBounds(destinationBounds, sourceBounds, width, height);
  const context = working.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен.');
  const snapshot = context.getImageData(readBounds.x, readBounds.y, readBounds.width, readBounds.height);
  const output = context.getImageData(destinationBounds.x, destinationBounds.y, destinationBounds.width, destinationBounds.height);
  const strength = clamp(options.strength, 0, 1);
  const mapper = options.mapper ?? createRasterPointMapper(placement, width, height);
  const radius = Math.max(0.5, options.size * height / 2);
  const hardness = clamp(options.hardness, 0, 1);
  const sample = new Float64Array(4);
  // Carry edits forward when sampling all layers, rather than repeatedly
  // picking up an unchanging snapshot from the beginning of the stroke.
  const compositePatch = options.sampleAllPixels
    ? new Uint8ClampedArray(documentBounds.width * documentBounds.height * 4) : null;
  const compositeEdited = compositePatch ? new Set<number>() : null;
  if (compositePatch && options.sampleAllPixels) {
    for (let row = 0; row < documentBounds.height; row++) {
      const start = ((documentBounds.y + row) * width + documentBounds.x) * 4;
      compositePatch.set(options.sampleAllPixels.subarray(start, start + documentBounds.width * 4), row * documentBounds.width * 4);
    }
  }

  for (let y = 0; y < destinationBounds.height; y++) for (let x = 0; x < destinationBounds.width; x++) {
    const localPoint = { x: (destinationBounds.x + x + 0.5) / width, y: (destinationBounds.y + y + 0.5) / height };
    const documentPoint = mapper.toDocument(localPoint);
    if (!documentPoint) continue;
    const documentX = documentPoint.x * width, documentY = documentPoint.y * height;
    if (documentX < 0 || documentX >= width || documentY < 0 || documentY >= height) continue;
    const distance = Math.hypot(documentX - to.x * width, documentY - to.y * height) / radius;
    if (distance >= 1) continue;
    const falloff = distance <= hardness ? 1 : (1 - distance) / Math.max(0.001, 1 - hardness);
    const selection = options.selectionPixels ? options.selectionPixels[(Math.floor(documentY) * width + Math.floor(documentX)) * 4 + 3] / 255 : 1;
    const amount = falloff * selection * strength;
    if (amount <= 0) continue;
    const sourceDocumentPoint = { x: documentPoint.x - delta.x, y: documentPoint.y - delta.y };
    if (options.sampleAllPixels) {
      const sx = sourceDocumentPoint.x * width - 0.5;
      const sy = sourceDocumentPoint.y * height - 0.5;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      samplePremultipliedBilinear(options.sampleAllPixels, width, height, sx, sy, sample);
    } else {
      const sourceLocal = mapper.toRaster(sourceDocumentPoint);
      if (!sourceLocal) continue;
      const sx = sourceLocal.x * width - 0.5 - readBounds.x;
      const sy = sourceLocal.y * height - 0.5 - readBounds.y;
      if (sx < 0 || sx >= readBounds.width || sy < 0 || sy >= readBounds.height) continue;
      samplePremultipliedBilinear(snapshot.data, readBounds.width, readBounds.height, sx, sy, sample);
    }
    mixPremultipliedPixel(output.data, (y * destinationBounds.width + x) * 4, sample, amount);
    if (compositePatch && compositeEdited) {
      const px = Math.floor(documentX) - documentBounds.x, py = Math.floor(documentY) - documentBounds.y;
      const index = (py * documentBounds.width + px) * 4;
      if (px >= 0 && px < documentBounds.width && py >= 0 && py < documentBounds.height && !compositeEdited.has(index)) {
        mixPremultipliedPixel(compositePatch, index, sample, amount);
        compositeEdited.add(index);
      }
    }
  }
  context.putImageData(output, destinationBounds.x, destinationBounds.y);
  if (compositePatch && options.sampleAllPixels) {
    for (let row = 0; row < documentBounds.height; row++) {
      options.sampleAllPixels.set(compositePatch.subarray(row * documentBounds.width * 4, (row + 1) * documentBounds.width * 4), ((documentBounds.y + row) * width + documentBounds.x) * 4);
    }
  }
  return destinationBounds;
}

function renderSharpenOnLayer(options: {
  working: HTMLCanvasElement;
  placement: RasterPlacement;
  documentBounds: PixelRect;
  segmentMask: HTMLCanvasElement;
  selectionPixels: Uint8ClampedArray | null;
  amount: number;
  radius: number;
}) {
  const { working, placement, documentBounds } = options;
  const width = working.width;
  const height = working.height;
  const destinationBounds = localBoundsForDocumentRect(documentBounds, placement, width, height);
  if (!destinationBounds) return null;
  const radius = clamp(Math.round(options.radius), 1, 8);
  const readBounds = {
    x: clamp(destinationBounds.x - radius, 0, width),
    y: clamp(destinationBounds.y - radius, 0, height),
    width: 0,
    height: 0,
  };
  readBounds.width = clamp(destinationBounds.x + destinationBounds.width + radius, readBounds.x, width) - readBounds.x;
  readBounds.height = clamp(destinationBounds.y + destinationBounds.height + radius, readBounds.y, height) - readBounds.y;
  const context = working.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен.');
  const snapshot = context.getImageData(readBounds.x, readBounds.y, readBounds.width, readBounds.height);
  const output = context.getImageData(destinationBounds.x, destinationBounds.y, destinationBounds.width, destinationBounds.height);
  const mask = maskPatch(options.segmentMask, documentBounds);
  const amount = clamp(options.amount, 0, 1);
  for (let y = 0; y < destinationBounds.height; y++) for (let x = 0; x < destinationBounds.width; x++) {
    const localPoint = { x: (destinationBounds.x + x + 0.5) / width, y: (destinationBounds.y + y + 0.5) / height };
    const documentPoint = mapRasterPointToDocumentPoint(localPoint, placement, width, height);
    if (!documentPoint) continue;
    const brushAmount = maskAmount(documentPoint, width, height, mask, options.selectionPixels);
    if (brushAmount <= 0) continue;
    const centerX = destinationBounds.x + x - readBounds.x;
    const centerY = destinationBounds.y + y - readBounds.y;
    const outputIndex = (y * destinationBounds.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      let total = 0;
      let count = 0;
      for (let sampleY = -radius; sampleY <= radius; sampleY++) for (let sampleX = -radius; sampleX <= radius; sampleX++) {
        const sx = centerX + sampleX;
        const sy = centerY + sampleY;
        if (sx < 0 || sx >= readBounds.width || sy < 0 || sy >= readBounds.height) continue;
        total += snapshot.data[(sy * readBounds.width + sx) * 4 + channel];
        count++;
      }
      const center = snapshot.data[(centerY * readBounds.width + centerX) * 4 + channel];
      const sharpened = clamp(center + amount * (center - total / Math.max(1, count)), 0, 255);
      output.data[outputIndex + channel] = Math.round(center + (sharpened - center) * brushAmount);
    }
  }
  context.putImageData(output, destinationBounds.x, destinationBounds.y);
  return destinationBounds;
}

async function createLocalRetouchSession(options: LocalRetouchOptions): Promise<RasterEffectSession> {
  const state = useStore.getState();
  const document = state.documents[state.activeDocIndex];
  if (!document || document.id !== options.documentId) throw new Error('Активная страница изменилась.');
  const target: RasterEffectTarget = options.layer.type === 'base' ? { type: 'base', id: document.baseLayer.id } : { type: 'ai', id: options.layer.id };
  if (!selectedMatches(document, target)) throw new Error('Активный растровый слой изменился.');
  const placement = resolveTarget(document, target) as RasterPlacement;
  const revision = targetRevision(document, target);
  const original = target.type === 'base' ? await buildBaseCanvas(document) : await buildRasterLayerCanvas(placement as AiRasterLayer, document.width, document.height);
  const working = window.document.createElement('canvas');
  working.width = document.width;
  working.height = document.height;
  const workingContext = working.getContext('2d', { willReadFrequently: true });
  if (!workingContext) throw new Error('Canvas недоступен.');
  workingContext.drawImage(original, 0, 0);
  let selectionMask: HTMLCanvasElement | null = null;
  if (document.activeMaskId) {
    const selection = await buildCleanupMask(document);
    if (!selection.isEmpty) selectionMask = selection.canvas;
  }
  const selectionPixels = selectionMask?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, document.width, document.height).data ?? null;
  let sampleAllPixels: Uint8ClampedArray | null = null;
  if (options.tool === 'smudge' && options.settings.sampleAllLayers) {
    const composite = await renderDocumentToCanvas(document, 'png', { willReadFrequently: true });
    sampleAllPixels = composite.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, document.width, document.height).data ?? null;
  }
  const segmentMask = window.document.createElement('canvas');
  segmentMask.width = document.width;
  segmentMask.height = document.height;
  const segmentContext = segmentMask.getContext('2d', { willReadFrequently: true });
  if (!segmentContext) throw new Error('Canvas недоступен.');
  const latest = useStore.getState();
  const latestDocument = latest.documents[latest.activeDocIndex];
  if (!latestDocument || latestDocument.id !== document.id || targetRevision(latestDocument, target) !== revision) throw new Error('Слой изменился.');
  resolveTarget(latestDocument, target);

  let lastPoint: [number, number] | null = null;
  let dirtyBounds: PixelRect | null = null;
  let pendingPreviewBounds: PixelRect | null = null;
  let cancelled = false;
  let committing = false;
  let committedId: string | null = null;
  const previewScale = Number.isFinite(options.previewScale) && options.previewScale > 0 ? options.previewScale : 1;
  const preview = window.document.createElement('canvas');
  preview.width = Math.max(1, Math.round(document.width * previewScale));
  preview.height = Math.max(1, Math.round(document.height * previewScale));
  const previewContext = preview.getContext('2d');
  if (!previewContext) throw new Error('Canvas недоступен.');
  const smudgeSettings = options.tool === 'smudge' ? options.settings : null;
  const diameter = Math.max(1, (smudgeSettings?.size ?? 0) * document.height);
  const spacing = Math.max(0.5, diameter * 0.08);
  const smudgeSampler = createSmudgeDabSampler(spacing);
  const mapper = createRasterPointMapper(placement, document.width, document.height);
  const applySmudgeDab = (dab: SmudgeDab) => {
    if (!smudgeSettings || smudgeSettings.strength <= 0) return;
    const radius = diameter / 2 + 1;
    const x = Math.max(0, Math.floor(dab.to.x - radius));
    const y = Math.max(0, Math.floor(dab.to.y - radius));
    const right = Math.min(document.width, Math.ceil(dab.to.x + radius));
    const bottom = Math.min(document.height, Math.ceil(dab.to.y + radius));
    if (right <= x || bottom <= y) return;
    const next = { x, y, width: right - x, height: bottom - y };
    const changed = renderSmudgeOnLayer({
      working, placement, documentBounds: next, selectionPixels, sampleAllPixels, mapper,
      from: { x: dab.from.x / document.width, y: dab.from.y / document.height },
      to: { x: dab.to.x / document.width, y: dab.to.y / document.height },
      size: smudgeSettings.size, hardness: smudgeSettings.hardness,
      strength: 1 - Math.pow(1 - clamp(smudgeSettings.strength, 0, 1), dab.distance / spacing),
    });
    if (!changed) return;
    dirtyBounds = mergeBounds(dirtyBounds, next);
    pendingPreviewBounds = mergeBounds(pendingPreviewBounds, next);
  };
  return {
    append(points) {
      if (cancelled || committing || committedId) return;
      const normalized: number[] = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        if (Number.isFinite(points[index]) && Number.isFinite(points[index + 1])) normalized.push(clamp(points[index], 0, 1), clamp(points[index + 1], 0, 1));
      }
      if (normalized.length < 2) return;
      if (options.tool === 'smudge') {
        const pixelPoints = normalized.map((value, index) => value * (index % 2 === 0 ? document.width : document.height));
        for (const dab of smudgeSampler.append(pixelPoints)) applySmudgeDab(dab);
        return;
      }
      const segment = lastPoint ? [lastPoint[0], lastPoint[1], ...normalized] : normalized;
      segmentContext.clearRect(0, 0, document.width, document.height);
      const size = options.settings.brushSize;
      const hardness = options.settings.hardness;
      const stroke: StrokeData = { id: 'local-retouch-mask', points: segment, size, hardness, opacity: 1, color: '#ffffff', mode: 'paint' };
      const next = drawBrushStroke(segmentContext, stroke, document.width, document.height, { color: '#ffffff' });
      if (!next) return;
      const to = { x: segment[segment.length - 2], y: segment[segment.length - 1] };
      renderSharpenOnLayer({ working, placement, documentBounds: next, segmentMask, selectionPixels, amount: options.settings.sharpenAmount, radius: options.settings.sharpenRadius });
      dirtyBounds = mergeBounds(dirtyBounds, next);
      pendingPreviewBounds = mergeBounds(pendingPreviewBounds, next);
      lastPoint = [to.x, to.y];
    },
    async renderPreview(): Promise<RasterEffectPreview | null> {
      if (cancelled || committing || committedId || !pendingPreviewBounds) return null;
      const bounds = pendingPreviewBounds;
      pendingPreviewBounds = null;
      previewContext.clearRect(0, 0, preview.width, preview.height);
      drawPlacedLayer(previewContext, working, placement, preview.width, preview.height);
      return { canvas: preview, bounds: { x: Math.floor(bounds.x * previewScale), y: Math.floor(bounds.y * previewScale), width: Math.ceil(bounds.width * previewScale), height: Math.ceil(bounds.height * previewScale) }, target, opacity: 1 };
    },
    async commit() {
      if (cancelled) throw new Error('Операция отменена.');
      if (committing || committedId) throw new Error('Операция уже завершается.');
      for (const dab of smudgeSampler.finish()) applySmudgeDab(dab);
      if (!dirtyBounds) throw new Error(options.tool === 'smudge' ? 'Проведите кистью, чтобы смазать пиксели.' : 'Пустой штрих.');
      committing = true;
      const commitState = useStore.getState();
      const commitDocument = commitState.documents[commitState.activeDocIndex];
      if (!commitDocument || commitDocument.id !== document.id) throw new Error('Активная страница изменилась.');
      resolveTarget(commitDocument, target);
      if (targetRevision(commitDocument, target) !== revision) throw new Error('Содержимое или геометрия слоя изменились.');
      const src = await canvasToPersistentDataUrl(working);
      const finalState = useStore.getState();
      const finalDocument = finalState.documents[finalState.activeDocIndex];
      if (!finalDocument || finalDocument.id !== document.id) throw new Error('Активная страница изменилась.');
      resolveTarget(finalDocument, target);
      if (targetRevision(finalDocument, target) !== revision || !selectedMatches(finalDocument, target)) throw new Error('Слой изменился до завершения ретуши.');
      registerRuntimeRasterSource(src, working);
      if (target.type === 'base') finalState.commitBaseRasterEffect(src);
      else {
        finalState.pushHistory();
        useStore.getState().updateAiLayer(target.id, { src, adjustments: { brightness: 1, contrast: 1, saturation: 1 }, eraseElements: [] }, { history: false });
      }
      committedId = target.id;
      return target.id;
    },
    cancel() { if (!committedId) cancelled = true; },
  };
}

export function createSmudgeSession(options: Omit<LocalRetouchOptions & { tool: 'smudge' }, 'tool'>) {
  return createLocalRetouchSession({ ...options, tool: 'smudge' });
}

export function createSharpenBrushSession(options: Omit<LocalRetouchOptions & { tool: 'sharpen' }, 'tool'>) {
  return createLocalRetouchSession({ ...options, tool: 'sharpen' });
}
