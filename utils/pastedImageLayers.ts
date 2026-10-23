import type { AiRasterLayer, CropRect } from '@/types';
import { useStore } from '@/store/useStore';
import { isImageFile, validateFile } from '@/utils/imageUtils';
import { canvasToPersistentDataUrl, registerRuntimeRasterSource } from '@/utils/runtimeRasterSources';

export interface PastedImageInfo {
  src: string;
  width: number;
  height: number;
  name?: string;
  image?: HTMLImageElement;
  visibleBounds?: CropRect;
}

export interface PastedLayerDocument {
  id: string;
  width: number;
  height: number;
  aiLayers: AiRasterLayer[];
}

export function planPastedImagePlacement(
  docWidth: number,
  docHeight: number,
  imageWidth: number,
  imageHeight: number,
  index = 0,
  center?: { x: number; y: number },
): CropRect {
  const safeDocWidth = Math.max(1, docWidth);
  const safeDocHeight = Math.max(1, docHeight);
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const margin = safeImageWidth > safeDocWidth || safeImageHeight > safeDocHeight ? 0.95 : 1;
  const fit = Math.min(
    1,
    (safeDocWidth * margin) / safeImageWidth,
    (safeDocHeight * margin) / safeImageHeight,
  );
  const drawWidth = Math.max(1, Math.round(safeImageWidth * fit));
  const drawHeight = Math.max(1, Math.round(safeImageHeight * fit));
  const cascade = Math.min(Math.max(0, index) * 16, Math.min(safeDocWidth, safeDocHeight) * 0.1);
  const x = Math.min(
    Math.max(0, Math.round((center?.x ?? 0.5) * safeDocWidth - drawWidth / 2 + cascade)),
    safeDocWidth - drawWidth,
  );
  const y = Math.min(
    Math.max(0, Math.round((center?.y ?? 0.5) * safeDocHeight - drawHeight / 2 + cascade)),
    safeDocHeight - drawHeight,
  );
  return {
    x: x / safeDocWidth,
    y: y / safeDocHeight,
    width: drawWidth / safeDocWidth,
    height: drawHeight / safeDocHeight,
  };
}

export function createPastedImageLayer(
  doc: PastedLayerDocument,
  image: PastedImageInfo,
  index = 0,
): AiRasterLayer {
  const existing = doc.aiLayers.filter(layer => layer.name.startsWith('Вставлено')).length;
  return {
    id: `ai-paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: image.name?.trim() || `Вставлено ${existing + index + 1}`,
    src: image.src,
    visible: true,
    opacity: 1,
    operation: 'drawing',
    locked: false,
    eraseElements: [],
    crop: image.visibleBounds ?? planPastedImagePlacement(doc.width, doc.height, image.width, image.height, index),
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

export function shouldKeepNativePaste(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toUpperCase();
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || (target as HTMLElement).isContentEditable
    || (target as HTMLElement).contentEditable === 'true'
    || target.getAttribute('contenteditable') === 'true';
}

export function extractClipboardImageFiles(data: DataTransfer): File[] {
  // Chromium may expose the same clipboard payload through both collections.
  // Prefer `files`; `items.getAsFile()` can manufacture a new File with a new
  // lastModified timestamp, which made screenshots appear twice.
  const directFiles = Array.from(data.files ?? []).filter(isImageFile);
  if (directFiles.length > 0) return directFiles;

  const files: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.type}:${file.size}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && (!item.type || item.type.startsWith('image/'))) add(item.getAsFile());
  }
  return files;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name || 'изображение'}.`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const finish = () => resolve(image);
      if (typeof image.decode === 'function') image.decode().then(finish, finish);
      else finish();
    };
    image.onerror = () => reject(new Error('Не удалось декодировать вставленное изображение.'));
    image.src = src;
  });
}

export async function decodePastedImage(file: File): Promise<PastedImageInfo> {
  const src = await fileToDataUrl(file);
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('Вставленное изображение имеет нулевой размер.');
  return { src, width, height, name: file.name || undefined, image };
}

/** Include even faint antialiased pixels; the selection frame skips empty PNG margins. */
export function findAlphaBounds(data: Uint8ClampedArray, width: number, height: number): CropRect | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export async function pasteExternalImagesAsLayers(
  files: File[],
  documentId: string,
  options: { center?: { x: number; y: number }; onError?: (message: string) => void } = {},
): Promise<string[]> {
  const store = useStore.getState();
  const doc = store.documents.find(item => item.id === documentId);
  if (!doc) throw new Error('Активная страница не найдена.');
  const layers: AiRasterLayer[] = [];
  const errors: string[] = [];
  let lastRaster: HTMLCanvasElement | null = null;

  for (let index = 0; index < files.length; index++) {
    try {
    const validation = validateFile(files[index]);
    if (validation) throw new Error(validation);
    const decoded = await decodePastedImage(files[index]);
    const image = decoded.image ?? await loadImage(decoded.src);
    const crop = planPastedImagePlacement(doc.width, doc.height, decoded.width, decoded.height, layers.length, options.center);
    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas недоступен для вставки изображения.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      crop.x * doc.width,
      crop.y * doc.height,
      crop.width * doc.width,
      crop.height * doc.height,
    );
    const left = Math.round(crop.x * doc.width), top = Math.round(crop.y * doc.height);
    const width = Math.round(crop.width * doc.width), height = Math.round(crop.height * doc.height);
    const alphaBounds = findAlphaBounds(ctx.getImageData(left, top, width, height).data, width, height);
    if (!alphaBounds) throw new Error(`«${files[index].name}»: изображение полностью прозрачное.`);
    const layer = createPastedImageLayer(doc, {
      ...decoded,
      src: await canvasToPersistentDataUrl(canvas),
      visibleBounds: { x: (left + alphaBounds.x) / doc.width, y: (top + alphaBounds.y) / doc.height, width: alphaBounds.width / doc.width, height: alphaBounds.height / doc.height },
    }, index);
    layers.push(layer);
    lastRaster = canvas;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Не удалось вставить «${files[index].name}».`;
      errors.push(message);
      options.onError?.(message);
    }
  }
  if (!layers.length) {
    if (errors.length) throw new Error(errors.join('\n'));
    return [];
  }
  const latest = useStore.getState();
  const target = latest.documents.find(item => item.id === documentId);
  if (!target) throw new Error('Страница была закрыта во время вставки.');
  if (target.width !== doc.width || target.height !== doc.height) throw new Error('Размер страницы изменился. Повторите вставку изображения.');
  if (lastRaster) registerRuntimeRasterSource(layers[layers.length - 1].src, lastRaster);
  latest.addAiLayers(doc.id, layers);
  if (latest.documents[latest.activeDocIndex]?.id === doc.id) latest.setRightTab('layers');
  return layers.map(layer => layer.id);
}
