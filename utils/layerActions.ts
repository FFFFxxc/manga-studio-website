import { useStore } from '@/store/useStore';
import {
  buildCleanupMask,
  buildCleanupSource,
  buildCleanupSourceCanvas,
  buildElementsMaskCanvas,
  buildRasterLayerCanvas,
  buildBaseCanvas,
  computeAlphaBBox,
  createCleanupPatch,
  createColorPatch,
  prepareClipdropCleanupInput,
  fitBlobToPixelLimit,
  encodeBlobToBudget,
  loadCleanupImage,
  CLIPDROP_RBG_MAX_PIXELS,
  CLIPDROP_RBG_IMAGE_MAX_BYTES,
} from './cleanupRaster';
import { simpleInpaint } from './imageUtils';
import { cleanupWithClipdrop, removeBackgroundWithClipdrop } from '@/lib/clipdrop/client';
import type { ImageDocument, MaskElement } from '@/types';

function newLayerId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getActiveDoc(): ImageDocument | null {
  const { documents, activeDocIndex } = useStore.getState();
  return activeDocIndex >= 0 ? documents[activeDocIndex] : null;
}

function refreshDoc(id: string): ImageDocument | null {
  return useStore.getState().documents.find(doc => doc.id === id) ?? null;
}

export function hasActiveSelection(doc: ImageDocument | null): boolean {
  if (!doc) return false;
  const mask = doc.masks.find(item => item.id === doc.activeMaskId);
  if (!mask) return false;
  return (mask.elements?.length ?? 0) > 0 || mask.strokes.some(stroke => stroke.mode !== 'erase');
}

export async function requireSelectionMask(doc: ImageDocument) {
  const mask = await buildCleanupMask(doc);
  if (mask.isEmpty) throw new Error('Сначала создайте выделение: кистью маски, лассо, прямоугольником или волшебной палочкой.');
  return mask;
}

export function finishSelection(clearedByDefault = true) {
  const { cleanupSettings, clearActiveMask } = useStore.getState();
  if (clearedByDefault && !cleanupSettings.keepSelectionAfterAction) clearActiveMask();
}

/** Tighten a raster's non-destructive crop to its remaining alpha bounds. */
async function trimTransparentBounds(target: { id?: string; type: 'base' | 'ai' }) {
  const state = useStore.getState();
  const document = getActiveDoc();
  if (!document) return;
  const raster = target.type === 'ai' ? document.aiLayers.find(layer => layer.id === target.id) : null;
  if (target.type === 'ai' && !raster) return;
  const canvas = raster
    ? await buildRasterLayerCanvas(raster, document.width, document.height)
    : await buildBaseCanvas(document);
  const bounds = computeAlphaBBox(canvas, 0);
  if (!bounds) return;
  const crop = {
    x: bounds.x / document.width,
    y: bounds.y / document.height,
    width: bounds.width / document.width,
    height: bounds.height / document.height,
  };
  if (target.type === 'ai' && target.id) state.updateAiLayer(target.id, { crop }, { history: false });
  else state.updateBaseLayer({ crop }, { history: false });
}

/**
 * «Удалить пиксели» — makes the selected area transparent, fully locally.
 * Applies a non-destructive erase mask to the explicitly passed target layer.
 * When no target is given, falls back to the currently selected layer
 * (or the base layer when nothing else is selected).
 */
export async function deleteMaskedPixels(target?: { id?: string; type: 'base' | 'ai' }): Promise<void> {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет активного изображения.');
  const mask = await requireSelectionMask(doc);
  const element: MaskElement = { type: 'bitmap', src: mask.canvas.toDataURL('image/png') };

  const state = useStore.getState();
  // The explicit target always wins — never depend on selectedLayer when it's given.
  const resolved = target ?? (doc.selectedLayer?.type === 'ai' ? { id: doc.selectedLayer.id, type: 'ai' as const } : { type: 'base' as const });

  if (resolved.type === 'ai' && resolved.id) {
    const source = doc.aiLayers.find(layer => layer.id === resolved.id);
    if (!source) throw new Error('Слой не найден.');
    if (source.locked) throw new Error('Слой заблокирован. Сначала снимите замок.');
    state.addEraseElement({ id: resolved.id, type: 'ai' }, element);
    await trimTransparentBounds({ id: resolved.id, type: 'ai' });
    finishSelection();
    return;
  }

  // Target is the base layer.
  if (doc.baseLayer?.locked !== false) {
    const makeCopy = window.confirm('Исходник заблокирован. Создать редактируемую копию и удалить пиксели на ней?');
    if (!makeCopy) return;
    const copyId = state.duplicateBaseLayer();
    if (!copyId) throw new Error('Не удалось создать копию исходника.');
    useStore.getState().addEraseElement({ id: copyId, type: 'ai' }, element);
    await trimTransparentBounds({ id: copyId, type: 'ai' });
    // Hide the base so the erased area actually turns transparent.
    useStore.getState().updateBaseLayer({ visible: false });
    finishSelection();
    return;
  }

  state.addEraseElement({ type: 'base' }, element);
  await trimTransparentBounds({ type: 'base' });
  finishSelection();
}

/** «Залить цветом» — fills the selection with a flat color as a new raster patch layer. */
export async function fillMaskedArea(color: string): Promise<void> {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет активного изображения.');
  const mask = await requireSelectionMask(doc);
  const patch = await createColorPatch(mask.canvas, doc.width, doc.height, color);
  const activeMaskId = doc.activeMaskId ?? undefined;
  useStore.getState().addAiLayer(doc.id, {
    id: newLayerId(),
    name: `Заливка ${doc.aiLayers.length + 1}`,
    src: patch,
    visible: true,
    opacity: 1,
    operation: 'cleanup',
    maskId: activeMaskId,
    eraseElements: [],
  });
  finishSelection();
}

/** «Новый слой» — creates an empty transparent drawing layer on top of the stack. */
export function createDrawingLayer(): void {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет активного изображения.');
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const count = doc.aiLayers.filter(layer => layer.operation === 'drawing').length;
  useStore.getState().addAiLayer(doc.id, {
    id: newLayerId(),
    name: `Рисунок ${count + 1}`,
    src: canvas.toDataURL('image/png'),
    visible: true,
    opacity: 1,
    operation: 'drawing',
    locked: false,
    eraseElements: [],
  });
}

/** «Локально восстановить» — browser-only inpainting of the selection (simpleInpaint). */
export async function inpaintMaskedArea(): Promise<void> {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет активного изображения.');
  const { setInpaintRunning, cleanupSettings } = useStore.getState();
  setInpaintRunning(true, 10);
  try {
    const canvas = await buildCleanupSourceCanvas(doc, { willReadFrequently: true });
    const ctx = canvas.getContext('2d')!;
    setInpaintRunning(true, 35);
    const mask = await requireSelectionMask(doc);
    setInpaintRunning(true, 55);
    const maskCtx = mask.canvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
    const result = simpleInpaint(imageData, maskData, cleanupSettings.inpaintRadius * 3);
    setInpaintRunning(true, 85);
    ctx.putImageData(result, 0, 0);
    const patch = await createCleanupPatch(canvas.toDataURL('image/png'), mask.canvas, doc.width, doc.height);
    useStore.getState().addAiLayer(doc.id, {
      id: newLayerId(),
      name: `Локальное замывание ${doc.aiLayers.filter(layer => layer.operation === 'cleanup').length + 1}`,
      src: patch,
      visible: true,
      opacity: 1,
      operation: 'cleanup',
      maskId: doc.activeMaskId ?? undefined,
      eraseElements: [],
    });
    finishSelection();
    setInpaintRunning(false, 100);
  } catch (error) {
    setInpaintRunning(false, 0);
    throw error;
  }
}

/** «AI-восстановление» — Clipdrop Cleanup on the current selection; result becomes a new layer. */
export async function aiCleanupMaskedArea(signal?: AbortSignal): Promise<void> {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет активного изображения.');
  const mask = await requireSelectionMask(doc);
  // Send only the selection's surroundings — this keeps requests within
  // Clipdrop's 16 MP limit even for huge documents, and full resolution
  // is preserved everywhere outside the patch.
  const plan = await prepareClipdropCleanupInput(doc, mask.canvas);
  const cropResult = await cleanupWithClipdrop(plan.image, plan.mask, signal);
  // Paste the processed crop back into a full-size canvas at its position.
  const full = await buildCleanupSourceCanvas(doc);
  const cropImage = await loadCleanupImage(cropResult);
  full.getContext('2d')!.drawImage(cropImage, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height);
  const patch = await createCleanupPatch(full.toDataURL('image/png'), mask.canvas, doc.width, doc.height);
  const current = refreshDoc(doc.id) ?? doc;
  useStore.getState().addAiLayer(doc.id, {
    id: newLayerId(),
    name: `Удален��е объекта ${current.aiLayers.filter(layer => layer.operation === 'cleanup').length + 1}`,
    src: patch,
    visible: true,
    opacity: 1,
    operation: 'cleanup',
    maskId: doc.activeMaskId ?? undefined,
    eraseElements: [],
  });
  finishSelection();
}

/**
 * Shared Clipdrop Remove Background operation, used by the left panel
 * and the layer context menu. Creates a new raster layer, keeps the source.
 */
export async function removeBackgroundFromLayer(layer: { id: string; type: 'base' | 'ai' }, signal?: AbortSignal): Promise<void> {
  const doc = getActiveDoc();
  if (!doc) throw new Error('Нет ��ктивного изображения.');

  let image: Blob;
  if (layer.type === 'ai') {
    const source = doc.aiLayers.find(item => item.id === layer.id);
    if (!source) throw new Error('Слой не найден.');
    const response = await fetch(source.src);
    image = await response.blob();
  } else {
    image = await buildCleanupSource(doc);
  }

  // Clipdrop RBG rejects images above ~25 MP: downscale before sending.
  // Vercel also rejects request bodies above its serverless limit, so encode
  // the pixel-limited image as a budgeted JPEG before sending. The result
  // layer is stretched back to document size when rendered.
  image = await fitBlobToPixelLimit(image, CLIPDROP_RBG_MAX_PIXELS);
  image = await encodeBlobToBudget(image, CLIPDROP_RBG_IMAGE_MAX_BYTES);
  const result = await removeBackgroundWithClipdrop(image, signal);
  const current = refreshDoc(doc.id) ?? doc;
  useStore.getState().addAiLayer(doc.id, {
    id: newLayerId(),
    name: `Фон удалён ${current.aiLayers.filter(layer => layer.operation === 'remove-background').length + 1}`,
    src: result,
    visible: true,
    opacity: 1,
    operation: 'remove-background',
    replacesBase: layer.type === 'base',
    eraseElements: [],
  });
}

/**
 * Ctrl+J — «Слой из выделения».
 * Renders the visible composite with all adjustments applied, punches out
 * everything outside the active mask, and creates a new raster layer cropped
 * to the selection's bounding box (so the transform frame hugs the fragment,
 * not the whole page).
 * Returns an error string on failure (so the caller can show a toast/message).
 */
export async function createLayerFromSelection(): Promise<string | null> {
  const doc = getActiveDoc();
  if (!doc) return 'Нет активного изображения.';

  // ── 1. Require active selection ──────────────────────────────────────────
  if (!hasActiveSelection(doc)) return 'Сначала создайте выделение.';
  const mask = await buildCleanupMask(doc);
  if (mask.isEmpty) return 'Сначала создайте выделение.';

  // ── 2. Build the full-res source canvas (with all adjustments baked in) ─
  const sourceCanvas = await buildCleanupSourceCanvas(doc);
  const W = sourceCanvas.width;
  const H = sourceCanvas.height;

  // ── 3. Apply mask: keep only pixels inside the selection ─────────────────
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = W;
  resultCanvas.height = H;
  const ctx = resultCanvas.getContext('2d')!;
  ctx.drawImage(sourceCanvas, 0, 0);

  // Use the mask as a destination-in clip: areas where mask alpha > 0 survive.
  const maskCanvas = mask.canvas;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const src = resultCanvas.toDataURL('image/png');

  // ── 4. Crop the layer to the selection bounds ─────────────────────────────
  // The layer bitmap stays document-sized (consistent with rendering/export),
  // but the non-destructive crop makes the layer occupy only the fragment.
  const bboxPx = computeAlphaBBox(maskCanvas);
  const crop = bboxPx
    ? { x: bboxPx.x / W, y: bboxPx.y / H, width: bboxPx.width / W, height: bboxPx.height / H }
    : undefined;

  // ── 5. Add layer ──────────────────────────────────────────────────────────
  const count = doc.aiLayers.filter(l => l.operation === 'drawing').length;
  useStore.getState().pushHistory();
  useStore.getState().addAiLayer(doc.id, {
    id: newLayerId(),
    name: `Копия выделения ${count + 1}`,
    src,
    visible: true,
    opacity: 1,
    operation: 'drawing',
    locked: false,
    eraseElements: [],
    crop,
  });
  return null; // success
}
