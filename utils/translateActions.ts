import { useStore } from '@/store/useStore';
import type { ImageDocument, TextObject } from '@/types';
import { uid } from './imageUtils';
import {
  buildCleanupSourceCanvas,
  createCleanupPatch,
  createColorPatch,
  encodeCanvasToBudget,
  loadCleanupImage,
} from './cleanupRaster';
import { aiCleanupMaskedArea, finishSelection, requireSelectionMask } from './layerActions';
import { ocrTranslate, redrawRegion } from '@/lib/routerai/client';
import { clonePaintStyle } from '@/utils/objectPaint';

const TRANSLATE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MODEL_MAX_DIMENSION = 768;

export const DEFAULT_REDRAW_PROMPT = 'Удали только буквы/символы текста в выделенной области и восстанови то, что находится непосредственно под ними. Сохрани все остальные элементы без изменений: речевые баблы, их контуры и заливку, персонажей, фон. Не добавляй новых объектов. Стиль рисунка сохрани.';
const TRANSLATION_LANGUAGE_NAMES: Record<string, string> = {
  ru: 'русский',
  en: 'английский',
  ja: 'японский',
  ko: 'корейский',
  zh: 'китайский',
};

export type BubbleCleanupMethod = 'local' | 'clipdrop';

export interface TranslateBubbleResult {
  original: string;
  translation: string;
  draft: TextObject;
}

interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BubbleCrop {
  image: Blob;
  crop: SelectionBounds;
  selection: SelectionBounds;
  downscaleRatio: number;
}

function hasMaskPixels(maskCanvas: HTMLCanvasElement): boolean {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) return true;
  }
  return false;
}

/** Keeps only pixels with a full neighbourhood inside the selection. */
export function erodeMaskCanvas(maskCanvas: HTMLCanvasElement, radius = 2): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = maskCanvas.width;
  output.height = maskCanvas.height;
  const sourceCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const outputCtx = output.getContext('2d');
  if (!sourceCtx || !outputCtx) throw new Error('Canvas недоступен.');
  const source = sourceCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const result = outputCtx.createImageData(maskCanvas.width, maskCanvas.height);
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const safeRadius = Math.max(0, Math.floor(radius));
  for (let y = safeRadius; y < height - safeRadius; y++) {
    for (let x = safeRadius; x < width - safeRadius; x++) {
      let inside = true;
      for (let dy = -safeRadius; dy <= safeRadius && inside; dy++) {
        for (let dx = -safeRadius; dx <= safeRadius; dx++) {
          if (source.data[((y + dy) * width + (x + dx)) * 4 + 3] <= 8) {
            inside = false;
            break;
          }
        }
      }
      if (inside) result.data[(y * width + x) * 4 + 3] = source.data[(y * width + x) * 4 + 3];
    }
  }
  outputCtx.putImageData(result, 0, 0);
  return output;
}

function median(values: number[]): number {
  if (!values.length) return 255;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** Samples a 3–6 px inner band so the bubble outline is not used as fill color. */
export function estimateMaskBackgroundColor(source: HTMLCanvasElement, maskCanvas: HTMLCanvasElement): string {
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx || !maskCtx) throw new Error('Canvas недоступен.');
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height).data;
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const inner3 = erodeMaskCanvas(maskCanvas, 3);
  const inner6 = erodeMaskCanvas(maskCanvas, 6);
  const inner3Data = inner3.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, inner3.width, inner3.height).data;
  const inner6Data = inner6.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, inner6.width, inner6.height).data;
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const addPixel = (index: number) => {
    red.push(sourceData[index]); green.push(sourceData[index + 1]); blue.push(sourceData[index + 2]);
  };
  for (let pixel = 0; pixel < maskCanvas.width * maskCanvas.height; pixel++) {
    const maskIndex = pixel * 4;
    if (maskData[maskIndex + 3] > 8 && inner3Data[maskIndex + 3] > 8 && inner6Data[maskIndex + 3] <= 8) addPixel(maskIndex);
  }
  if (!red.length) {
    for (let pixel = 0; pixel < maskCanvas.width * maskCanvas.height; pixel++) {
      const index = pixel * 4;
      if (inner3Data[index + 3] > 8) addPixel(index);
    }
  }
  if (!red.length) {
    for (let pixel = 0; pixel < maskCanvas.width * maskCanvas.height; pixel++) {
      const index = pixel * 4;
      if (maskData[index + 3] > 8) addPixel(index);
    }
  }
  return `rgb(${median(red)}, ${median(green)}, ${median(blue)})`;
}

function activeDocument(): ImageDocument {
  const { documents, activeDocIndex } = useStore.getState();
  const doc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  if (!doc) throw new Error('Нет активного изображения.');
  return doc;
}

function getSelectionBounds(maskCanvas: HTMLCanvasElement): SelectionBounds {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен.');
  const pixels = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  let minX = maskCanvas.width;
  let minY = maskCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskCanvas.height; y++) {
    for (let x = 0; x < maskCanvas.width; x++) {
      if (pixels[(y * maskCanvas.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error('Выделение пустое.');
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function resizeCanvasToMaxDimension(canvas: HTMLCanvasElement, maxDimension: number): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDimension) return canvas;
  const scale = maxDimension / longest;
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));
  output.getContext('2d')!.drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

async function buildBubbleCrop(doc: ImageDocument, paddingPx?: number, maxDimension?: number): Promise<BubbleCrop> {
  const mask = await requireSelectionMask(doc);
  const selection = getSelectionBounds(mask.canvas);
  const pad = paddingPx === undefined
    ? Math.max(8, Math.round(Math.max(selection.width, selection.height) * 0.15))
    : Math.max(0, Math.min(12, Math.round(paddingPx)));
  const cropX = Math.max(0, selection.x - pad);
  const cropY = Math.max(0, selection.y - pad);
  const cropRight = Math.min(doc.width, selection.x + selection.width + pad);
  const cropBottom = Math.min(doc.height, selection.y + selection.height + pad);
  const crop = {
    x: cropX,
    y: cropY,
    width: Math.max(1, cropRight - cropX),
    height: Math.max(1, cropBottom - cropY),
  };

  const source = await buildCleanupSourceCanvas(doc);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const prepared = maxDimension ? resizeCanvasToMaxDimension(canvas, maxDimension) : canvas;
  const encoded = await encodeCanvasToBudget(prepared, TRANSLATE_IMAGE_MAX_BYTES);
  return {
    image: encoded.blob,
    crop,
    selection,
    downscaleRatio: Math.max(crop.width / encoded.width, crop.height / encoded.height),
  };
}

function createBubbleTextDraft(doc: ImageDocument, selection: SelectionBounds, translation: string): TextObject {
  const { textSettings, translationFontFamily } = useStore.getState();
  return {
    id: uid(),
    text: translation.trim(),
    // «Вставить текст» после перевода бабла — всегда дефолтным шрифтом перевода
    fontFamily: translationFontFamily,
    fontSize: textSettings.fontSize,
    fill: textSettings.fill,
    stroke: textSettings.stroke,
    strokeWidth: textSettings.strokeWidth,
    fillStyle: clonePaintStyle(textSettings.fillStyle),
    strokeStyle: clonePaintStyle(textSettings.strokeStyle),
    shadowColor: textSettings.shadowColor,
    shadowBlur: textSettings.shadowBlur,
    lineHeight: textSettings.lineHeight,
    align: 'center',
    width: Math.max(0.04, Math.min(1, selection.width / doc.width)),
    x: Math.max(0, Math.min(0.96, selection.x / doc.width)),
    y: Math.max(0, Math.min(0.96, selection.y / doc.height)),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    visible: true,
  };
}

export async function translateBubble(
  targetLang = 'ru',
  cleanupMethod: BubbleCleanupMethod = 'local',
  signal?: AbortSignal,
): Promise<TranslateBubbleResult> {
  const doc = activeDocument();
  const crop = await buildBubbleCrop(doc);
  const result = await ocrTranslate(crop.image, targetLang, signal);
  const translation = result.translation.trim();
  if (!translation) throw new Error('Модель не нашла текст для перевода.');

  if (cleanupMethod === 'clipdrop') {
    await aiCleanupMaskedArea(signal);
  } else {
    const mask = await requireSelectionMask(doc);
    const source = await buildCleanupSourceCanvas(doc);
    const erodedMask = erodeMaskCanvas(mask.canvas, 2);
    const fillMask = hasMaskPixels(erodedMask) ? erodedMask : mask.canvas;
    const color = estimateMaskBackgroundColor(source, mask.canvas);
    const patch = await createColorPatch(fillMask, doc.width, doc.height, color);
    const current = useStore.getState().documents.find(item => item.id === doc.id) ?? doc;
    useStore.getState().addAiLayer(doc.id, {
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Заливка бабла ${current.aiLayers.filter(layer => layer.operation === 'cleanup').length + 1}`,
      src: patch,
      visible: true,
      opacity: 1,
      operation: 'cleanup',
      maskId: current.activeMaskId ?? undefined,
      eraseElements: [],
    });
    finishSelection();
  }

  return {
    original: result.original.trim(),
    translation,
    draft: createBubbleTextDraft(doc, crop.selection, translation),
  };
}

/**
 * One-step translation/redraw. Image-model operations use the strict
 * selection bounding box; the generated crop is clipped back through the mask.
 */
export async function translateRegionWithAi(targetLang = 'ru', signal?: AbortSignal, seed?: number): Promise<{ downscaleRatio: number }> {
  const doc = activeDocument();
  const crop = await buildBubbleCrop(doc, 0, IMAGE_MODEL_MAX_DIMENSION);
  const language = TRANSLATION_LANGUAGE_NAMES[targetLang] ?? targetLang;
  const prompt = `Переведи весь текст на этом фрагменте манги на ${language} язык. Перерисуй текст на том же месте, в том же стиле и с тем же оформлением (баблы, контуры, цвета — без изменений). Не меняй ничего, кроме самого текста. Верни изображение того же размера.`;
  const resultDataUrl = await redrawRegion(crop.image, prompt, signal, { seed });
  const result = await loadCleanupImage(resultDataUrl);
  const patch = document.createElement('canvas');
  patch.width = doc.width;
  patch.height = doc.height;
  const ctx = patch.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  ctx.drawImage(result, crop.crop.x, crop.crop.y, crop.crop.width, crop.crop.height);
  const mask = await requireSelectionMask(doc);
  const maskedPatch = await createCleanupPatch(patch.toDataURL('image/png'), mask.canvas, doc.width, doc.height);
  const current = useStore.getState().documents.find(item => item.id === doc.id) ?? doc;
  useStore.getState().addAiLayer(doc.id, {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Перевод AI ${current.aiLayers.filter(layer => layer.operation === 'cleanup').length + 1}`,
    src: maskedPatch,
    visible: true,
    opacity: 1,
    operation: 'cleanup',
    maskId: current.activeMaskId ?? undefined,
    eraseElements: [],
  });
  finishSelection();
  return { downscaleRatio: crop.downscaleRatio };
}

export async function redrawSfx(signal?: AbortSignal, prompt = DEFAULT_REDRAW_PROMPT, seed?: number): Promise<{ downscaleRatio: number }> {
  const doc = activeDocument();
  const crop = await buildBubbleCrop(doc, 0, IMAGE_MODEL_MAX_DIMENSION);
  const resultDataUrl = await redrawRegion(
    crop.image,
    prompt.trim() || DEFAULT_REDRAW_PROMPT,
    signal,
    { seed },
  );
  const result = await loadCleanupImage(resultDataUrl);
  const patch = document.createElement('canvas');
  patch.width = doc.width;
  patch.height = doc.height;
  const ctx = patch.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен.');
  ctx.drawImage(result, crop.crop.x, crop.crop.y, crop.crop.width, crop.crop.height);
  const mask = await requireSelectionMask(doc);
  const maskedPatch = await createCleanupPatch(patch.toDataURL('image/png'), mask.canvas, doc.width, doc.height);

  const current = useStore.getState().documents.find(item => item.id === doc.id) ?? doc;
  useStore.getState().addAiLayer(doc.id, {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Перерисовка участка ${current.aiLayers.filter(layer => layer.operation === 'cleanup').length + 1}`,
    src: maskedPatch,
    visible: true,
    opacity: 1,
    operation: 'cleanup',
    maskId: current.activeMaskId ?? undefined,
    eraseElements: [],
  });
  finishSelection();
  return { downscaleRatio: crop.downscaleRatio };
}
