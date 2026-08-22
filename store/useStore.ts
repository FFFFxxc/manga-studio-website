import { create } from 'zustand';
import { docRectToLocalRect, sanitizeImageDocument, sanitizeShape, sanitizeText, sanitizeWatermark } from '@/utils/coordinates';
import { createBaseLayerState } from '../types';
import type {
  BaseLayerState,
  ImageDocument,
  WatermarkObject,
  TextObject,
  ShapeObject,
  ShapeSettings,
  StrokeData,
  SelectedObject,
  HistorySnapshot,
  ViewportState,
  WatermarkSettings,
  CleanupSettings,
  TextSettings,
  ExportSettings,
  LayerVisibility,
  ActiveTool,
  LeftTab,
  CropRect,
  MaskLayer,
  MaskElement,
  AiRasterLayer,
  SelectedLayer,
  LayerReference,
  BubbleObject,
  BubbleKind,
  PerspectiveQuad,
  BlurSettings,
  EyedropperSettings,
  CropSettings,
  TranslationMaskSettings,
  TranslationMaskObject,
} from '../types';
import { DEFAULT_ANIME_FONT, DEFAULT_BASE_ADJUSTMENTS, DEFAULT_LAYER_TRANSFORM } from '../types';
import { resolveLayerOrder, layerRefKey } from '@/utils/layerOrder';
import { clonePerspectiveQuad, isValidPerspectiveQuad } from '@/utils/perspective';
import { cloneGlowStyle, clonePaintStyle } from '@/utils/objectPaint';
import { storeDefaultTranslationFont } from '@/utils/fonts';
import { filterLockedGeometryUpdates } from '@/utils/lockedUpdates';
import { addRecentColor, loadStoredRecentColors, storeRecentColors } from '@/utils/recentColors';
import { documentObjectUrlReferencesChanged, revokeUnusedDocumentObjectUrls } from '@/utils/objectUrls';
import { canTransformRasterLayer } from '@/utils/layerGuards';

const MAX_HISTORY = 40;

const defaultWmSettings: WatermarkSettings = {
  type: 'text',
  text: '© Манга-студия',
  fontFamily: 'Russo One',
  fontSize: 0.06,
  fill: 'rgba(255,255,255,0.85)',
  imageSrc: null,
  imageWidth: 0.25,
  imageHeight: 0.12,
  opacity: 0.75,
  rotation: 0,
  batchMode: 'fixed',
  scatterOffsetPct: 10,
  scatterTiltDeg: 15,
};

const defaultCleanupSettings: CleanupSettings = {
  brushSize: 0.03,
  brushHardness: 0.8,
  brushOpacity: 1,
  brushColor: '#ffffff',
  inpaintRadius: 4,
  mode: 'brush',
  cleanupMethod: 'auto',
  magicThreshold: 30,
  selectionMode: 'replace',
  wandContiguous: true,
  keepSelectionAfterAction: false,
  translationCleanupMethod: 'local',
  disableImageTranslationModel: false,
};

const defaultTextSettings: TextSettings = {
  fontFamily: DEFAULT_ANIME_FONT,
  fontSize: 0.06,
  fill: '#000000',
  stroke: '',
  strokeWidth: 2,
  shadowColor: 'transparent',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  lineHeight: 1.3,
  align: 'center',
  bold: false,
  italic: false,
  vertical: false,
  width: 0.35,
  draftText: '',
};

const defaultCropSettings: CropSettings = {
  scope: 'page',
  lockAspect: true,
  ratio: 'free',
};

const defaultBlurSettings: BlurSettings = {
  mode: 'blur',
  gesture: 'brush',
  applyTo: 'layer',
  brushSize: 0.08,
  hardness: 0.75,
  radius: 18,
  strength: 0.5,
  cellSize: 24,
  noiseAmount: 0.18,
  noiseMonochrome: true,
  sharpenRadius: 1,
  sharpenAmount: 0.5,
};

const defaultEyedropperSettings: EyedropperSettings = {
  sample: 'all',
};

const defaultTranslationMaskSettings: TranslationMaskSettings = {
  shape: 'rounded-rect',
  fill: '#ffffff',
  opacity: 1,
  feather: 2,
  padding: 0.04,
};

const defaultExportSettings: ExportSettings = {
  format: 'png',
  quality: 0.92,
};

const defaultShapeSettings: ShapeSettings = {
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 4,
  opacity: 1,
  cornerRadius: 0,
  fillStyle: { type: 'solid', color: '#ffffff' },
  strokeStyle: { type: 'solid', color: '#000000' },
  glow: { enabled: false, color: '#00e5ff', blur: 24, opacity: 0.8, intensity: 1 },
  lineStyle: 'solid',
  curve: 0.35,
};

function cloneElements(elements: MaskElement[] | undefined): MaskElement[] {
  return (elements ?? []).map(element =>
    element.type === 'brush'
      ? { ...element, stroke: { ...element.stroke, points: [...element.stroke.points] } }
      : element.type === 'polygon'
        ? { ...element, points: [...element.points] }
        : { ...element }
  );
}

function snap(doc: ImageDocument): HistorySnapshot {
  return {
    cleanup: { ...doc.cleanup, committed: doc.cleanup.committed, strokes: [...doc.cleanup.strokes] },
    baseLayer: doc.baseLayer
      ? { ...doc.baseLayer, eraseElements: cloneElements(doc.baseLayer.eraseElements), adjustments: { ...doc.baseLayer.adjustments }, perspective: clonePerspectiveQuad(doc.baseLayer.perspective), perspectiveSourceBounds: doc.baseLayer.perspectiveSourceBounds ? { ...doc.baseLayer.perspectiveSourceBounds } : null }
      : createBaseLayerState(doc.id),
    masks: (doc.masks ?? []).map(mask => ({
      ...mask,
      strokes: mask.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] })),
      elements: (mask.elements ?? mask.strokes.map(stroke => ({ type: 'brush', stroke }) as MaskElement)).map(element =>
        element.type === 'brush' ? { ...element, stroke: { ...element.stroke, points: [...element.stroke.points] } } : element.type === 'polygon' ? { ...element, points: [...element.points] } : { ...element }
      ),
    })),
    aiLayers: (doc.aiLayers ?? []).map(layer => ({ ...layer, eraseElements: cloneElements(layer.eraseElements), perspective: clonePerspectiveQuad(layer.perspective), perspectiveSourceBounds: layer.perspectiveSourceBounds ? { ...layer.perspectiveSourceBounds } : null })),
    activeMaskId: doc.activeMaskId ?? null,
    selectedLayer: doc.selectedLayer ? { ...doc.selectedLayer } : null,
    watermarks: doc.watermarks.map(w => ({ ...w })),
    texts: doc.texts.map(t => ({ ...t })),
    translationMasks: (doc.translationMasks ?? []).map(mask => ({
      ...mask,
      points: mask.points ? [...mask.points] : undefined,
      sourceBounds: mask.sourceBounds ? { ...mask.sourceBounds } : undefined,
    })),
    shapes: (doc.shapes ?? []).map(s => ({
      ...s,
      fillStyle: s.fillStyle ? clonePaintStyle(s.fillStyle) : undefined,
      strokeStyle: s.strokeStyle ? clonePaintStyle(s.strokeStyle) : undefined,
      glow: s.glow ? cloneGlowStyle(s.glow) : undefined,
    })),
    bubbles: (doc.bubbles ?? []).map(b => ({
      ...b,
      fillStyle: b.fillStyle ? clonePaintStyle(b.fillStyle) : undefined,
      strokeStyle: b.strokeStyle ? clonePaintStyle(b.strokeStyle) : undefined,
      glow: b.glow ? cloneGlowStyle(b.glow) : undefined,
      text: { ...b.text },
      tail: b.tail ? { ...b.tail } : null,
    })),
    layerOrder: (doc.layerOrder ?? []).map(ref => ({ ...ref })),
  };
}

function withHistory(doc: ImageDocument): ImageDocument {
  const snapshot = snap(doc);
  const past = [...doc.past, snapshot].slice(-MAX_HISTORY);
  return { ...doc, past, future: [], hasChanges: true };
}

export interface AppState {
  documents: ImageDocument[];
  activeDocIndex: number;
  activeTool: ActiveTool;
  leftTab: LeftTab;
  selectedObject: SelectedObject | null;
  /** ID of the TextObject currently being edited in the inline editor, or null */
  inlineEditingTextId: string | null;
  wmSettings: WatermarkSettings;
  cleanupSettings: CleanupSettings;
  textSettings: TextSettings;
  cropSettings: CropSettings;
  blurSettings: BlurSettings;
  eyedropperSettings: EyedropperSettings;
  foregroundColor: string;
  translationMaskSettings: TranslationMaskSettings;
  recentColors: string[];
  exportSettings: ExportSettings;
  viewport: ViewportState;
  layerVisibility: LayerVisibility;
  showExportModal: boolean;
  isInpaintRunning: boolean;
  inpaintProgress: number;
  shapeSettings: ShapeSettings;
  customFonts: string[];
  fontsVersion: number;
  /** Все шрифты из IndexedDB зарегистрированы — можно рендерить канвас. */
  fontsReady: boolean;
  /**
   * «Шрифт перевода по умолчанию»: применяется к новому тексту, «Вставить
   * текст» после перевода бабла и блокам автоперевода. По умолчанию —
   * встроенный анимешный шрифт; пользователь может выбрать свой загруженный.
   */
  translationFontFamily: string;
  cropRect: CropRect | null;
  /** When set, the crop tool edits this layer's non-destructive crop instead of the whole document. */
  layerCropTarget: LayerReference | null;
  rightTab: 'layers' | 'gallery';

  setLayerCropTarget: (target: LayerReference | null) => void;
  setRightTab: (tab: 'layers' | 'gallery') => void;
  applyLayerCrop: () => void;
  cancelLayerCrop: () => void;
  addDocuments: (docs: ImageDocument[]) => void;
  removeDocument: (id: string) => void;
  reorderDocuments: (sourceIndex: number, destinationIndex: number) => void;
  setActiveDoc: (index: number) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setLeftTab: (tab: LeftTab) => void;
  setSelectedObject: (obj: SelectedObject | null) => void;
  setInlineEditingTextId: (id: string | null) => void;
  duplicateSelectedObject: () => void;
  deleteSelectedObject: () => void;
  moveSelectedObject: (direction: 'forward' | 'backward') => void;
  updateDocumentThumbnail: (id: string, dataUrl: string) => void;
  addStroke: (stroke: StrokeData) => void;
  updateCleanupLayer: (updates: Partial<Pick<ImageDocument['cleanup'], 'locked'>>) => void;
  createMask: () => string | null;
  selectLayer: (layer: SelectedLayer | null) => void;
  addMaskStroke: (stroke: StrokeData) => void;
  addMaskElement: (element: MaskElement, options?: { replace?: boolean; documentId?: string; maskId?: string | null; preserveSelection?: boolean }) => void;
  removeMaskElement: (documentId: string, maskId: string, elementId: string) => void;
  clearActiveMask: () => void;
  updateMask: (id: string, updates: Partial<Pick<MaskLayer, 'name' | 'visible' | 'opacity' | 'locked'>>, options?: { history?: boolean }) => void;
  deleteMask: (id: string) => void;
  addAiLayer: (documentId: string, layer: AiRasterLayer) => void;
  updateAiLayer: (id: string, updates: Partial<Omit<AiRasterLayer, 'id' | 'operation'>>, options?: { history?: boolean }) => void;
  commitBaseRasterEffect: (dataUrl: string) => void;
  updateAiLayerPerspective: (id: string, quad: PerspectiveQuad | null, options?: { history?: boolean }) => void;
  deleteAiLayer: (id: string) => void;
  duplicateAiLayer: (id: string) => void;
  duplicateBaseLayer: () => string | null;
  updateBaseLayer: (updates: Partial<Omit<BaseLayerState, 'id' | 'eraseElements' | 'adjustments'>> & { adjustments?: Partial<BaseLayerState['adjustments']> }, options?: { history?: boolean }) => void;
  updateBasePerspective: (quad: PerspectiveQuad | null, options?: { history?: boolean }) => void;
  resetBaseLayerSettings: () => void;
  reorderLayer: (sourceIndex: number, destinationIndex: number) => void;
  moveLayerForward: (layer: LayerReference) => void;
  moveLayerBackward: (layer: LayerReference) => void;
  moveLayerToTop: (layer: LayerReference) => void;
  moveLayerToBottom: (layer: LayerReference) => void;
  addEraseElement: (target: SelectedLayer | { type: 'base' }, element: MaskElement) => void;
  clearEraseElements: (target: SelectedLayer | { type: 'base' }) => void;
  clearMaskStrokes: () => void;
  applyTranslationBatch: (cleanupDataUrl: string, texts: TextObject[]) => void;
  addWatermark: (wm: WatermarkObject) => void;
  updateWatermark: (id: string, updates: Partial<WatermarkObject>) => void;
  deleteWatermark: (id: string) => void;
  batchApplyWatermark: () => void;
  addText: (text: TextObject) => void;
  updateText: (id: string, updates: Partial<TextObject>, options?: { history?: boolean; moveGroup?: boolean }) => void;
  deleteText: (id: string) => void;
  addTranslationGroup: (mask: TranslationMaskObject, text: TextObject) => void;
  updateTranslationMask: (id: string, updates: Partial<TranslationMaskObject>, options?: { history?: boolean; moveGroup?: boolean }) => void;
  deleteTranslationMask: (id: string) => void;
  updateAllTranslationMaskPadding: (padding: number, options?: { history?: boolean }) => void;
  restorePageSourceText: () => void;
  addShape: (shape: ShapeObject) => void;
  updateShape: (id: string, updates: Partial<ShapeObject>, options?: { history?: boolean }) => void;
  deleteShape: (id: string) => void;
  updateShapeSettings: (updates: Partial<ShapeSettings>) => void;
  addBubble: (bubble: BubbleObject) => void;
  updateBubble: (id: string, updates: Partial<BubbleObject>, options?: { history?: boolean }) => void;
  deleteBubble: (id: string) => void;
  duplicateBubble: (id: string) => void;
  addCustomFont: (name: string) => void;
  setCustomFonts: (names: string[]) => void;
  removeCustomFont: (name: string) => void;
  bumpFontsVersion: () => void;
  setFontsReady: (ready: boolean) => void;
  /** Меняет дефолтный шрифт перевода (и текущий шрифт инструмента «Текст»). */
  setTranslationFontFamily: (name: string, options?: { persist?: boolean }) => void;
  /**
   * Заменяет во всех открытых документах шрифты, которых нет в availableFonts,
   * на дефолтный (не ломая рендер). Возвращает имена недостающих шрифтов.
   */
  replaceMissingFonts: (availableFonts: string[]) => string[];
  setCropRect: (rect: CropRect | null) => void;
  applyDocumentTransform: (updates: Partial<ImageDocument>) => void;
  updateWmSettings: (updates: Partial<WatermarkSettings>) => void;
  updateCleanupSettings: (updates: Partial<CleanupSettings>) => void;
  updateTextSettings: (updates: Partial<TextSettings>) => void;
  updateCropSettings: (updates: Partial<CropSettings>) => void;
  updateBlurSettings: (updates: Partial<BlurSettings>) => void;
  updateEyedropperSettings: (updates: Partial<EyedropperSettings>) => void;
  /** Updates defaults only; existing document objects are never recolored. */
  setForegroundColor: (color: string) => void;
  updateTranslationMaskSettings: (updates: Partial<TranslationMaskSettings>) => void;
  rememberTextColor: (color: string) => void;
  updateExportSettings: (updates: Partial<ExportSettings>) => void;
  setViewport: (vp: Partial<ViewportState>) => void;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  /** Restore and remove the snapshot created for an uncommitted operation. */
  rollbackPendingHistory: () => void;
  toggleLayerVisibility: (layer: keyof LayerVisibility) => void;
  setShowExportModal: (show: boolean) => void;
  applyCleanupCommit: (dataURL: string) => void;
  applyAiCleanupCommit: (documentId: string, dataURL: string, clearMask: boolean) => void;
  clearCurrentDocument: () => void;
  setInpaintRunning: (running: boolean, progress?: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  documents: [],
  activeDocIndex: -1,
  activeTool: 'select',
  leftTab: 'watermark',
  selectedObject: null,
  inlineEditingTextId: null,
  wmSettings: defaultWmSettings,
  cleanupSettings: defaultCleanupSettings,
  textSettings: defaultTextSettings,
  cropSettings: defaultCropSettings,
  blurSettings: defaultBlurSettings,
  eyedropperSettings: defaultEyedropperSettings,
  foregroundColor: '#000000',
  translationMaskSettings: defaultTranslationMaskSettings,
  recentColors: loadStoredRecentColors(),
  exportSettings: defaultExportSettings,
  viewport: { x: 0, y: 0, scale: 1 },
  layerVisibility: { base: true, cleanup: true, watermarks: true, texts: true, shapes: true },
  showExportModal: false,
  isInpaintRunning: false,
  inpaintProgress: 0,
  shapeSettings: defaultShapeSettings,
  customFonts: [],
  fontsVersion: 0,
  fontsReady: false,
  translationFontFamily: DEFAULT_ANIME_FONT,
  cropRect: null,
  layerCropTarget: null,
  rightTab: 'gallery',

  setLayerCropTarget: (target) => set({ layerCropTarget: target }),
  setRightTab: (tab) => set({ rightTab: tab }),

  applyLayerCrop: () => {
    const state = get();
    const target = state.layerCropTarget;
    const rect = state.cropRect;
    if (!target || !rect || state.activeDocIndex < 0) return;
    // The crop frame is drawn in document space, but the layer may be moved,
    // scaled or rotated — store the crop in the layer's LOCAL space so it cuts
    // exactly what the frame showed on screen.
    const doc = state.documents[state.activeDocIndex];
    const placement = target.type === 'base'
      ? doc?.baseLayer
      : doc?.aiLayers.find(layer => layer.id === target.id);
    if (!placement || placement.locked) return;
    const localRect = doc && placement && !placement.perspective
      ? docRectToLocalRect(rect, placement, doc.width, doc.height)
      : rect;
    // One history entry for the whole action. Locked layers are rejected above
    // so this action cannot silently bypass the central geometry guard.
    state.pushHistory();
    if (target.type === 'base') {
      state.updateBaseLayer({ crop: localRect }, { history: false });
    } else if (target.type === 'ai') {
      state.updateAiLayer(target.id, { crop: localRect }, { history: false });
    }
    // Keep the layer selected so the transformer appears right away.
    state.selectLayer({ id: target.id, type: target.type as 'base' | 'ai' });
    set({ layerCropTarget: null, cropRect: null, activeTool: 'select' });
  },

  cancelLayerCrop: () => {
    if (!get().layerCropTarget) return;
    set({ layerCropTarget: null, cropRect: null, activeTool: 'select' });
  },

  addDocuments: (newDocs) =>
    set(state => {
      const all = [...state.documents, ...newDocs.map(sanitizeImageDocument)];
      const idx = state.documents.length === 0 ? 0 : state.activeDocIndex;
      return { documents: all, activeDocIndex: Math.max(0, idx) };
    }),

  removeDocument: (id) =>
    set(state => {
      const activeId = state.documents[state.activeDocIndex]?.id;
      const removedIndex = state.documents.findIndex(document => document.id === id);
      const docs = state.documents.filter(d => d.id !== id);
      const preservedIndex = activeId === id ? -1 : docs.findIndex(document => document.id === activeId);
      const idx = preservedIndex >= 0
        ? preservedIndex
        : Math.min(Math.max(0, removedIndex), docs.length - 1);
      return { documents: docs, activeDocIndex: docs.length === 0 ? -1 : idx, selectedObject: null };
    }),

  reorderDocuments: (sourceIndex, destinationIndex) =>
    set(state => {
      if (
        sourceIndex < 0 || destinationIndex < 0
        || sourceIndex >= state.documents.length || destinationIndex >= state.documents.length
        || sourceIndex === destinationIndex
      ) return {};
      const activeId = state.documents[state.activeDocIndex]?.id;
      const documents = [...state.documents];
      const [moved] = documents.splice(sourceIndex, 1);
      documents.splice(destinationIndex, 0, moved);
      const activeDocIndex = activeId ? documents.findIndex(doc => doc.id === activeId) : -1;
      return { documents, activeDocIndex };
    }),

  setActiveDoc: (index) =>
    set({ activeDocIndex: index, selectedObject: null, viewport: { x: 0, y: 0, scale: 1 } }),

  setActiveTool: (tool) => set({ activeTool: tool }),
  setLeftTab: (tab) => set({ leftTab: tab }),
  setSelectedObject: (obj) => set({ selectedObject: obj }),
  setInlineEditingTextId: (id) => set({ inlineEditingTextId: id }),

  duplicateSelectedObject: () => set(state => {
    const selected = state.selectedObject;
    if (!selected || state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    const id = `${selected.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (selected.type === 'text') {
      const source = doc.texts.find(item => item.id === selected.id);
      if (!source) return {};
      doc.texts = [...doc.texts, { ...source, id, x: Math.min(.95, source.x + .025), y: Math.min(.95, source.y + .025) }];
    } else if (selected.type === 'watermark') {
      const source = doc.watermarks.find(item => item.id === selected.id);
      if (!source) return {};
      doc.watermarks = [...doc.watermarks, { ...source, id, x: Math.min(.95, source.x + .025), y: Math.min(.95, source.y + .025), isBatch: false }];
    } else if (selected.type === 'bubble') {
      const source = (doc.bubbles ?? []).find(item => item.id === selected.id);
      if (!source) return {};
      const newBubble = { ...source, id, x: Math.min(.95, source.x + .025), y: Math.min(.95, source.y + .025), text: { ...source.text }, tail: source.tail ? { ...source.tail } : null };
      doc.bubbles = [...(doc.bubbles ?? []), newBubble];
      const newLayerOrder = [...(doc.layerOrder ?? []), { type: 'bubble' as const, id }];
      docs[state.activeDocIndex] = { ...doc, layerOrder: newLayerOrder };
      return { documents: docs, selectedObject: { ...selected, id } };
    } else if (selected.type === 'translationMask') {
      const source = (doc.translationMasks ?? []).find(item => item.id === selected.id);
      if (!source) return {};
      doc.translationMasks = [...(doc.translationMasks ?? []), { ...source, id, name: `${source.name} (копия)`, x: Math.min(.95, source.x + .025), y: Math.min(.95, source.y + .025), groupId: undefined, textId: undefined }];
    } else {
      const source = doc.shapes.find(item => item.id === selected.id);
      if (!source) return {};
      doc.shapes = [...doc.shapes, { ...source, id, x: Math.min(.95, source.x + .025), y: Math.min(.95, source.y + .025) }];
    }
    docs[state.activeDocIndex] = doc;
    return { documents: docs, selectedObject: { ...selected, id } };
  }),

  deleteSelectedObject: () => {
    const state = get();
    const selected = state.selectedObject;
    if (!selected) return;
    if (selected.type === 'text') state.deleteText(selected.id);
    else if (selected.type === 'watermark') state.deleteWatermark(selected.id);
    else if (selected.type === 'bubble') state.deleteBubble(selected.id);
    else if (selected.type === 'translationMask') state.deleteTranslationMask(selected.id);
    else state.deleteShape(selected.id);
  },

  moveSelectedObject: (direction) => set(state => {
    const selected = state.selectedObject;
    if (!selected || state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    const key = selected.type === 'text' ? 'texts' : selected.type === 'watermark' ? 'watermarks' : selected.type === 'bubble' ? 'bubbles' : selected.type === 'translationMask' ? 'translationMasks' : 'shapes';
    const items = [...(doc[key] ?? [])] as Array<{ id: string }>;
    const index = items.findIndex(item => item.id === selected.id);
    const target = direction === 'forward' ? index + 1 : index - 1;
    if (index < 0 || target < 0 || target >= items.length) return {};
    [items[index], items[target]] = [items[target], items[index]];
    (doc as unknown as Record<string, unknown>)[key] = items;
    docs[state.activeDocIndex] = doc;
    return { documents: docs };
  }),

  updateDocumentThumbnail: (id, dataUrl) => set(state => ({
    documents: state.documents.map(doc => doc.id === id ? { ...doc, thumbnail: dataUrl } : doc),
  })),

  addStroke: (stroke) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = docs[state.activeDocIndex];
      if (doc.cleanup.locked) return {};
      const withH = withHistory(doc);
      docs[state.activeDocIndex] = {
        ...withH,
        cleanup: { ...withH.cleanup, strokes: [...withH.cleanup.strokes, stroke] },
      };
      return { documents: docs };
    }),

  updateCleanupLayer: (updates) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    docs[state.activeDocIndex] = { ...doc, cleanup: { ...doc.cleanup, ...updates } };
    return { documents: docs };
  }),

  createMask: () => {
    const state = get();
    if (state.activeDocIndex < 0) return null;
    const id = `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set(current => {
      const docs = [...current.documents];
      const doc = withHistory(docs[current.activeDocIndex]);
      const mask: MaskLayer = { id, name: `Маска ${(doc.masks?.length ?? 0) + 1}`, strokes: [], elements: [], visible: true, opacity: 0.55 };
      docs[current.activeDocIndex] = { ...doc, masks: [...(doc.masks ?? []), mask], activeMaskId: id, selectedLayer: { id, type: 'mask' } };
      return { documents: docs };
    });
    return id;
  },

  selectLayer: (layer) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = docs[state.activeDocIndex];
    docs[state.activeDocIndex] = { ...doc, selectedLayer: layer, activeMaskId: layer?.type === 'mask' ? layer.id : doc.activeMaskId };
    return { documents: docs, selectedObject: null };
  }),

  addMaskStroke: (stroke) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    let doc = docs[state.activeDocIndex];
    let maskId = doc.activeMaskId;
    const activeMask = maskId ? (doc.masks ?? []).find(mask => mask.id === maskId) : null;
    if (activeMask?.locked) return {};
    if (!maskId || !(doc.masks ?? []).some(mask => mask.id === maskId)) {
      maskId = `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      doc = { ...doc, masks: [...(doc.masks ?? []), { id: maskId, name: `Маска ${(doc.masks?.length ?? 0) + 1}`, strokes: [], elements: [], visible: true, opacity: 0.55 }] };
    }
    const withH = withHistory(doc);
    docs[state.activeDocIndex] = {
      ...withH,
      masks: withH.masks.map(mask => mask.id === maskId ? {
        ...mask,
        strokes: [...mask.strokes, { ...stroke, purpose: 'mask' }],
        elements: [...(mask.elements ?? mask.strokes.map(item => ({ type: 'brush', stroke: item }) as MaskElement)), { type: 'brush', stroke: { ...stroke, purpose: 'mask' } }],
      } : mask),
      activeMaskId: maskId,
      selectedLayer: { id: maskId, type: 'mask' },
    };
    return { documents: docs, selectedObject: null };
  }),

  addMaskElement: (element, options) => set(state => {
    const documentIndex = options?.documentId
      ? state.documents.findIndex(document => document.id === options.documentId)
      : state.activeDocIndex;
    if (documentIndex < 0) return {};
    const docs = [...state.documents];
    let doc = docs[documentIndex];
    const hasExplicitMask = options ? Object.prototype.hasOwnProperty.call(options, 'maskId') : false;
    let maskId = hasExplicitMask ? options?.maskId ?? null : doc.activeMaskId;
    if (hasExplicitMask && maskId && !doc.masks.some(mask => mask.id === maskId)) return {};
    const activeMask = maskId ? doc.masks.find(mask => mask.id === maskId) : null;
    if (activeMask?.locked) return {};
    if (!maskId || !doc.masks.some(mask => mask.id === maskId)) {
      maskId = `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      doc = { ...doc, masks: [...doc.masks, { id: maskId, name: `Маска ${doc.masks.length + 1}`, strokes: [], elements: [], visible: true, opacity: 0.55 }] };
    }
    const withH = withHistory(doc);
    const preserveCurrentSelection = options?.preserveSelection === true && documentIndex === state.activeDocIndex;
    docs[documentIndex] = {
      ...withH,
      masks: withH.masks.map(mask => mask.id === maskId
        ? {
            ...mask,
            strokes: options?.replace ? [] : mask.strokes,
            elements: options?.replace ? [element] : [...(mask.elements ?? []), element],
          }
        : mask),
      activeMaskId: preserveCurrentSelection ? withH.activeMaskId : maskId,
      selectedLayer: preserveCurrentSelection ? withH.selectedLayer : { id: maskId, type: 'mask' },
    };
    return documentIndex === state.activeDocIndex ? { documents: docs, selectedObject: null } : { documents: docs };
  }),

  removeMaskElement: (documentId, maskId, elementId) => set(state => {
    const documentIndex = state.documents.findIndex(document => document.id === documentId);
    if (documentIndex < 0) return {};
    const current = state.documents[documentIndex];
    const mask = current.masks.find(item => item.id === maskId);
    // Exact rollback primitive for the wand confirmation: it may remove only
    // the identified element even if the user locked the mask afterward.
    if (!mask || !mask.elements.some(element => element.id === elementId)) return {};
    const docs = [...state.documents];
    const doc = withHistory(current);
    docs[documentIndex] = {
      ...doc,
      masks: doc.masks.map(item => item.id === maskId
        ? { ...item, elements: item.elements.filter(element => element.id !== elementId) }
        : item),
    };
    return { documents: docs };
  }),

  clearActiveMask: () => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const current = docs[state.activeDocIndex];
    if (!current.activeMaskId) return {};
    const mask = current.masks.find(item => item.id === current.activeMaskId);
    if (!mask || mask.locked || (!mask.strokes.length && !(mask.elements?.length))) return {};
    const doc = withHistory(current);
    docs[state.activeDocIndex] = { ...doc, masks: doc.masks.map(item => item.id === doc.activeMaskId ? { ...item, strokes: [], elements: [] } : item) };
    return { documents: docs };
  }),

  updateMask: (id, updates, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const current = docs[state.activeDocIndex];
    const doc = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    docs[state.activeDocIndex] = { ...doc, masks: doc.masks.map(mask => mask.id === id ? { ...mask, ...updates } : mask) };
    return { documents: docs };
  }),

  deleteMask: (id) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    docs[state.activeDocIndex] = {
      ...doc,
      masks: doc.masks.filter(mask => mask.id !== id),
      activeMaskId: doc.activeMaskId === id ? null : doc.activeMaskId,
      selectedLayer: doc.selectedLayer?.id === id ? null : doc.selectedLayer,
      aiLayers: doc.aiLayers.map(layer => layer.maskId === id ? { ...layer, maskId: undefined } : layer),
    };
    return { documents: docs };
  }),

  addAiLayer: (documentId, layer) => set(state => {
    const index = state.documents.findIndex(doc => doc.id === documentId);
    if (index < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[index]);
    const normalizedLayer: AiRasterLayer = {
      ...layer,
      visible: layer.visible !== false,
      opacity: Number.isFinite(layer.opacity) ? Math.max(0, Math.min(1, layer.opacity)) : 1,
      locked: layer.locked === true,
      x: Number.isFinite(layer.x) ? layer.x : 0,
      y: Number.isFinite(layer.y) ? layer.y : 0,
      scaleX: Number.isFinite(layer.scaleX) && layer.scaleX !== 0 ? layer.scaleX : 1,
      scaleY: Number.isFinite(layer.scaleY) && layer.scaleY !== 0 ? layer.scaleY : 1,
      rotation: Number.isFinite(layer.rotation) ? layer.rotation : 0,
      eraseElements: layer.eraseElements ?? [],
    };
    const layerOrder = [...resolveLayerOrder(doc), { type: 'ai' as const, id: normalizedLayer.id }];
    docs[index] = {
      ...doc,
      aiLayers: [...(doc.aiLayers ?? []), normalizedLayer],
      masks: doc.masks.map(mask => mask.id === normalizedLayer.maskId ? { ...mask, resultLayerId: normalizedLayer.id } : mask),
      selectedLayer: { id: normalizedLayer.id, type: 'ai' },
      layerOrder,
    };
    return index === state.activeDocIndex
      ? { documents: docs, selectedObject: null, activeTool: 'select' as const }
      : { documents: docs };
  }),

  updateAiLayer: (id, updates, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const current = state.documents[state.activeDocIndex];
    const target = current.aiLayers.find(layer => layer.id === id);
    if (!target) return {};
    const allowedUpdates = filterLockedGeometryUpdates(target.locked, updates);
    if (Object.keys(allowedUpdates).length === 0) return {};
    const docs = [...state.documents];
    const doc = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    docs[state.activeDocIndex] = { ...doc, aiLayers: doc.aiLayers.map(layer => layer.id === id ? { ...layer, ...allowedUpdates } : layer) };
    return { documents: docs };
  }),

  commitBaseRasterEffect: dataUrl => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const current = documents[state.activeDocIndex];
    const document = withHistory(current);
    const baseLayer = document.baseLayer ?? createBaseLayerState(document.id);
    documents[state.activeDocIndex] = {
      ...document,
      cleanup: { ...document.cleanup, committed: dataUrl },
      baseLayer: {
        ...baseLayer,
        adjustments: { brightness: 1, contrast: 1, saturation: 1 },
        eraseElements: [],
      },
    };
    return { documents };
  }),

  updateAiLayerPerspective: (id, quad, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    if (quad && !isValidPerspectiveQuad(quad)) return {};
    const current = state.documents[state.activeDocIndex];
    if (!canTransformRasterLayer(current, { id, type: 'ai' })) return {};
    const documents = [...state.documents];
    const document = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    documents[state.activeDocIndex] = {
      ...document,
      aiLayers: document.aiLayers.map(layer => layer.id === id
        ? { ...layer, perspective: clonePerspectiveQuad(quad) }
        : layer),
    };
    return { documents };
  }),

  deleteAiLayer: (id) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    docs[state.activeDocIndex] = {
      ...doc,
      aiLayers: doc.aiLayers.filter(layer => layer.id !== id),
      masks: doc.masks.map(mask => mask.resultLayerId === id ? { ...mask, resultLayerId: undefined } : mask),
      selectedLayer: doc.selectedLayer?.id === id ? null : doc.selectedLayer,
    };
    return { documents: docs };
  }),

  duplicateAiLayer: (id) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const doc = withHistory(docs[state.activeDocIndex]);
    const source = doc.aiLayers.find(layer => layer.id === id);
    if (!source) return {};
    const copyId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const copy: AiRasterLayer = {
      ...source,
      id: copyId,
      name: `${source.name} (копия)`,
      maskId: undefined,
      eraseElements: cloneElements(source.eraseElements),
    };
    const index = doc.aiLayers.findIndex(layer => layer.id === id);
    const aiLayers = [...doc.aiLayers];
    aiLayers.splice(index + 1, 0, copy);
    const order = resolveLayerOrder(doc);
    const orderIndex = order.findIndex(ref => ref.type === 'ai' && ref.id === id);
    if (orderIndex >= 0) order.splice(orderIndex + 1, 0, { type: 'ai', id: copyId });
    docs[state.activeDocIndex] = { ...doc, aiLayers, layerOrder: orderIndex >= 0 ? order : doc.layerOrder, selectedLayer: { id: copyId, type: 'ai' } };
    return { documents: docs };
  }),

  duplicateBaseLayer: () => {
    const state = get();
    if (state.activeDocIndex < 0) return null;
    const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set(current => {
      const docs = [...current.documents];
      const doc = withHistory(docs[current.activeDocIndex]);
      // The copy must inherit everything the user already did to the base:
      // adjustments, opacity, crop, transform and erased areas.
      const base = doc.baseLayer;
      const copy: AiRasterLayer = {
        id,
        name: `Копия — ${doc.name}`,
        src: doc.cleanup.committed ?? doc.originalSrc,
        visible: true,
        opacity: base?.opacity ?? 1,
        operation: 'duplicate',
        eraseElements: cloneElements(base?.eraseElements ?? []),
        adjustments: base ? { ...base.adjustments } : undefined,
        crop: base?.crop ?? null,
        locked: false,
        x: base?.x ?? 0,
        y: base?.y ?? 0,
        scaleX: base?.scaleX ?? 1,
        scaleY: base?.scaleY ?? 1,
        rotation: base?.rotation ?? 0,
        perspective: clonePerspectiveQuad(base?.perspective),
        perspectiveSourceBounds: base?.perspectiveSourceBounds
          ? { ...base.perspectiveSourceBounds }
          : null,
      };
      const order = resolveLayerOrder(doc);
      const baseIndex = order.findIndex(ref => ref.type === 'base');
      order.splice(baseIndex + 1, 0, { type: 'ai', id });
      docs[current.activeDocIndex] = { ...doc, aiLayers: [copy, ...doc.aiLayers], layerOrder: order, selectedLayer: { id, type: 'ai' } };
      return { documents: docs };
    });
    return id;
  },

  updateBaseLayer: (updates, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const current = state.documents[state.activeDocIndex];
    const currentBase = current.baseLayer ?? createBaseLayerState(current.id);
    const allowedUpdates = filterLockedGeometryUpdates(currentBase.locked, updates);
    if (Object.keys(allowedUpdates).length === 0) return {};
    const docs = [...state.documents];
    const doc = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    const baseLayer = doc.baseLayer ?? createBaseLayerState(doc.id);
    docs[state.activeDocIndex] = {
      ...doc,
      baseLayer: {
        ...baseLayer,
        ...allowedUpdates,
        adjustments: allowedUpdates.adjustments ? { ...baseLayer.adjustments, ...allowedUpdates.adjustments } : baseLayer.adjustments,
      },
    };
    return { documents: docs };
  }),

  updateBasePerspective: (quad, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    if (quad && !isValidPerspectiveQuad(quad)) return {};
    const current = state.documents[state.activeDocIndex];
    const baseLayer = current.baseLayer ?? createBaseLayerState(current.id);
    if (!canTransformRasterLayer(current, { id: baseLayer.id, type: 'base' })) return {};
    const documents = [...state.documents];
    const document = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    documents[state.activeDocIndex] = {
      ...document,
      baseLayer: { ...baseLayer, perspective: clonePerspectiveQuad(quad) },
    };
    return { documents };
  }),

  resetBaseLayerSettings: () => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const currentBase = docs[state.activeDocIndex].baseLayer ?? createBaseLayerState(docs[state.activeDocIndex].id);
    if (currentBase.locked) return {};
    const doc = withHistory(docs[state.activeDocIndex]);
    const baseLayer = doc.baseLayer ?? createBaseLayerState(doc.id);
    docs[state.activeDocIndex] = {
      ...doc,
      baseLayer: {
        ...baseLayer,
        opacity: 1,
        visible: true,
        adjustments: { ...DEFAULT_BASE_ADJUSTMENTS },
        crop: null,
        perspective: null,
        ...DEFAULT_LAYER_TRANSFORM,
        // eraseElements are intentionally preserved — use «Восстановить стёртое».
      },
    };
    return { documents: docs };
  }),

  reorderLayer: (sourceIndex, destinationIndex) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const current = docs[state.activeDocIndex];
    const order = resolveLayerOrder(current);
    if (sourceIndex < 0 || sourceIndex >= order.length || destinationIndex < 0 || destinationIndex >= order.length || sourceIndex === destinationIndex) return {};
    const doc = withHistory(current);
    const next = [...order];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);
    docs[state.activeDocIndex] = { ...doc, layerOrder: next };
    return { documents: docs };
  }),

  moveLayerForward: (layer) => {
    const state = get();
    if (state.activeDocIndex < 0) return;
    const order = resolveLayerOrder(state.documents[state.activeDocIndex]);
    const index = order.findIndex(ref => layerRefKey(ref) === layerRefKey(layer));
    if (index >= 0 && index < order.length - 1) state.reorderLayer(index, index + 1);
  },

  moveLayerBackward: (layer) => {
    const state = get();
    if (state.activeDocIndex < 0) return;
    const order = resolveLayerOrder(state.documents[state.activeDocIndex]);
    const index = order.findIndex(ref => layerRefKey(ref) === layerRefKey(layer));
    if (index > 0) state.reorderLayer(index, index - 1);
  },

  moveLayerToTop: (layer) => {
    const state = get();
    if (state.activeDocIndex < 0) return;
    const order = resolveLayerOrder(state.documents[state.activeDocIndex]);
    const index = order.findIndex(ref => layerRefKey(ref) === layerRefKey(layer));
    if (index >= 0 && index < order.length - 1) state.reorderLayer(index, order.length - 1);
  },

  moveLayerToBottom: (layer) => {
    const state = get();
    if (state.activeDocIndex < 0) return;
    const order = resolveLayerOrder(state.documents[state.activeDocIndex]);
    const index = order.findIndex(ref => layerRefKey(ref) === layerRefKey(layer));
    if (index > 0) state.reorderLayer(index, 0);
  },

  addEraseElement: (target, element) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const current = docs[state.activeDocIndex];
    if (target.type === 'base') {
      const currentBase = current.baseLayer ?? createBaseLayerState(current.id);
      if (currentBase.locked) return {};
      const doc = withHistory(current);
      const baseLayer = doc.baseLayer ?? createBaseLayerState(doc.id);
      docs[state.activeDocIndex] = { ...doc, baseLayer: { ...baseLayer, eraseElements: [...baseLayer.eraseElements, element] } };
    } else if (target.type === 'ai' && 'id' in target) {
      if (current.aiLayers.find(layer => layer.id === target.id)?.locked) return {};
      const doc = withHistory(current);
      docs[state.activeDocIndex] = {
        ...doc,
        aiLayers: doc.aiLayers.map(layer => layer.id === target.id ? { ...layer, eraseElements: [...(layer.eraseElements ?? []), element] } : layer),
      };
    } else {
      return {};
    }
    return { documents: docs };
  }),

  clearEraseElements: (target) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const current = docs[state.activeDocIndex];
    if (target.type === 'base') {
      const currentBase = current.baseLayer ?? createBaseLayerState(current.id);
      if (currentBase.locked || currentBase.eraseElements.length === 0) return {};
    } else if (target.type === 'ai' && 'id' in target) {
      const currentLayer = current.aiLayers.find(layer => layer.id === target.id);
      if (!currentLayer || currentLayer.locked || (currentLayer.eraseElements?.length ?? 0) === 0) return {};
    }
    const doc = withHistory(current);
    if (target.type === 'base') {
      const baseLayer = doc.baseLayer ?? createBaseLayerState(doc.id);
      docs[state.activeDocIndex] = { ...doc, baseLayer: { ...baseLayer, eraseElements: [] } };
    } else if (target.type === 'ai' && 'id' in target) {
      docs[state.activeDocIndex] = {
        ...doc,
        aiLayers: doc.aiLayers.map(layer => layer.id === target.id ? { ...layer, eraseElements: [] } : layer),
      };
    } else {
      return {};
    }
    return { documents: docs };
  }),

  clearMaskStrokes: () => get().clearActiveMask(),

  applyTranslationBatch: (cleanupDataUrl, texts) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const docs = [...state.documents];
    const withH = withHistory(docs[state.activeDocIndex]);
    docs[state.activeDocIndex] = {
      ...withH,
      cleanup: { ...withH.cleanup, committed: cleanupDataUrl, strokes: withH.cleanup.strokes.filter(stroke => stroke.purpose !== 'mask') },
      texts: [...withH.texts, ...texts],
    };
    return { documents: docs };
  }),

  addWatermark: (wm) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      // Explicitly append the new object on TOP of the unified stack —
      // otherwise it would resolve into its type group and could render
      // below objects the user added earlier.
      const layerOrder = [...resolveLayerOrder(withH), { type: 'watermark' as const, id: wm.id }];
      docs[state.activeDocIndex] = { ...withH, watermarks: [...withH.watermarks, wm], layerOrder };
      return { documents: docs };
    }),

  updateWatermark: (id, updates) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = { ...docs[state.activeDocIndex] };
      doc.watermarks = doc.watermarks.flatMap(w => {
        if (w.id !== id) return [w];
        const sanitized = sanitizeWatermark({ ...w, ...filterLockedGeometryUpdates(w.locked, updates) });
        return sanitized ? [sanitized] : [];
      });
      doc.hasChanges = true;
      docs[state.activeDocIndex] = doc;
      return { documents: docs };
    }),

  deleteWatermark: (id) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      docs[state.activeDocIndex] = { ...withH, watermarks: withH.watermarks.filter(w => w.id !== id) };
      return { documents: docs, selectedObject: null };
    }),

  batchApplyWatermark: () => {
    const state = get();
    const { documents, activeDocIndex, wmSettings } = state;
    if (documents.length === 0) return;
    const activeDoc = documents[activeDocIndex] ?? documents[0];
    const existingBatch = activeDoc.watermarks.find(w => w.isBatch);
    const baseX = existingBatch?.x ?? 0.5;
    const baseY = existingBatch?.y ?? 0.85;
    const baseScaleX = existingBatch?.scaleX ?? 1;
    const baseScaleY = existingBatch?.scaleY ?? 1;
    const baseRot = existingBatch?.rotation ?? wmSettings.rotation;

    const newDocs = documents.map(doc => {
      let newDoc = withHistory(doc);
      const nonBatch = newDoc.watermarks.filter(w => !w.isBatch);
      let x = baseX, y = baseY, rotation = baseRot;

      if (wmSettings.batchMode === 'random') {
        const p = 0.1;
        x = p + Math.random() * (1 - 2 * p);
        y = p + Math.random() * (1 - 2 * p);
        rotation = Math.random() * 360;
      } else if (wmSettings.batchMode === 'scattered') {
        const off = wmSettings.scatterOffsetPct / 100;
        x = Math.max(0.05, Math.min(0.95, baseX + (Math.random() - 0.5) * 2 * off));
        y = Math.max(0.05, Math.min(0.95, baseY + (Math.random() - 0.5) * 2 * off));
        rotation = baseRot + (Math.random() - 0.5) * 2 * wmSettings.scatterTiltDeg;
      }

      const batchWm: WatermarkObject = {
        id: `wm-batch-${doc.id}`,
        type: wmSettings.type,
        text: wmSettings.text,
        fontFamily: wmSettings.fontFamily,
        fontSize: wmSettings.fontSize,
        fill: wmSettings.fill,
        imageSrc: wmSettings.imageSrc ?? undefined,
        imageWidth: wmSettings.imageWidth,
        imageHeight: wmSettings.imageHeight,
        x, y,
        scaleX: baseScaleX,
        scaleY: baseScaleY,
        rotation,
        opacity: wmSettings.opacity,
        visible: true,
        isBatch: true,
      };
      return { ...newDoc, watermarks: [...nonBatch, batchWm] };
    });
    set({ documents: newDocs });
  },

  addText: (text) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      // New text goes on TOP of the unified stack (see addWatermark).
      const layerOrder = [...resolveLayerOrder(withH), { type: 'text' as const, id: text.id }];
      docs[state.activeDocIndex] = { ...withH, texts: [...withH.texts, text], layerOrder };
      return { documents: docs };
    }),

  updateText: (id, updates, options) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = options?.history
        ? withHistory(docs[state.activeDocIndex])
        : { ...docs[state.activeDocIndex], hasChanges: true };
      const source = doc.texts.find(text => text.id === id);
      doc.texts = doc.texts.flatMap(t => {
        if (t.id !== id) return [t];
        const sanitized = sanitizeText({ ...t, ...filterLockedGeometryUpdates(t.locked, updates) });
        return sanitized ? [sanitized] : [];
      });
      if (options?.moveGroup && source?.groupId && (updates.x !== undefined || updates.y !== undefined)) {
        const updated = doc.texts.find(text => text.id === id);
        if (updated) {
          const dx = updated.x - source.x;
          const dy = updated.y - source.y;
          doc.translationMasks = (doc.translationMasks ?? []).map(mask => mask.groupId === source.groupId ? { ...mask, x: mask.x + dx, y: mask.y + dy } : mask);
        }
      }
      doc.hasChanges = true;
      docs[state.activeDocIndex] = doc;
      return { documents: docs };
    }),

  deleteText: (id) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      docs[state.activeDocIndex] = { ...withH, texts: withH.texts.filter(t => t.id !== id) };
      return { documents: docs, selectedObject: null };
    }),

  addTranslationGroup: (mask, text) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const doc = withHistory(documents[state.activeDocIndex]);
    const layerOrder = [
      ...resolveLayerOrder(doc),
      { type: 'translationMask' as const, id: mask.id },
      { type: 'text' as const, id: text.id },
    ];
    documents[state.activeDocIndex] = {
      ...doc,
      translationMasks: [...(doc.translationMasks ?? []), mask],
      texts: [...doc.texts, text],
      layerOrder,
    };
    return { documents, selectedObject: { id: text.id, type: 'text' as const } };
  }),

  updateTranslationMask: (id, updates, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const current = documents[state.activeDocIndex];
    const source = (current.translationMasks ?? []).find(mask => mask.id === id);
    if (!source || source.locked) return {};
    const doc = options?.history === false ? { ...current, hasChanges: true } : withHistory(current);
    const x = Number.isFinite(updates.x) ? Math.max(-1, Math.min(2, updates.x!)) : source.x;
    const y = Number.isFinite(updates.y) ? Math.max(-1, Math.min(2, updates.y!)) : source.y;
    const next = {
      ...source,
      ...updates,
      x,
      y,
      width: Math.max(0.002, Math.min(2, updates.width ?? source.width)),
      height: Math.max(0.002, Math.min(2, updates.height ?? source.height)),
      opacity: Math.max(0, Math.min(1, updates.opacity ?? source.opacity)),
      feather: Math.max(0, Math.min(100, updates.feather ?? source.feather)),
      padding: Math.max(0, Math.min(0.5, updates.padding ?? source.padding)),
    };
    let texts = doc.texts;
    if (options?.moveGroup && source.groupId && (updates.x !== undefined || updates.y !== undefined)) {
      const dx = x - source.x;
      const dy = y - source.y;
      texts = texts.map(text => text.groupId === source.groupId ? { ...text, x: text.x + dx, y: text.y + dy } : text);
    }
    documents[state.activeDocIndex] = {
      ...doc,
      translationMasks: (doc.translationMasks ?? []).map(mask => mask.id === id ? next : mask),
      texts,
    };
    return { documents };
  }),

  deleteTranslationMask: id => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const doc = withHistory(documents[state.activeDocIndex]);
    documents[state.activeDocIndex] = {
      ...doc,
      translationMasks: (doc.translationMasks ?? []).filter(mask => mask.id !== id),
      layerOrder: (doc.layerOrder ?? []).filter(ref => !(ref.type === 'translationMask' && ref.id === id)),
    };
    return { documents, selectedObject: null };
  }),

  updateAllTranslationMaskPadding: (padding, options) => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const doc = options?.history === false ? { ...documents[state.activeDocIndex], hasChanges: true } : withHistory(documents[state.activeDocIndex]);
    const normalized = Math.max(0, Math.min(0.5, padding));
    documents[state.activeDocIndex] = {
      ...doc,
      translationMasks: (doc.translationMasks ?? []).map(mask => {
        const source = mask.sourceBounds ?? { x: mask.x, y: mask.y, width: mask.width, height: mask.height };
        return {
          ...mask,
          padding: normalized,
          x: Math.max(0, source.x - normalized),
          y: Math.max(0, source.y - normalized),
          width: Math.min(1, source.width + normalized * 2),
          height: Math.min(1, source.height + normalized * 2),
        };
      }),
    };
    return { documents };
  }),

  restorePageSourceText: () =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      const translatedTextIds = new Set(withH.texts.filter(text => text.translationBatchId).map(text => text.id));
      const translationMaskIds = new Set((withH.translationMasks ?? []).map(mask => mask.id));
      docs[state.activeDocIndex] = {
        ...withH,
        texts: withH.texts.filter(text => !translatedTextIds.has(text.id)),
        translationMasks: [],
        layerOrder: (withH.layerOrder ?? []).filter(ref =>
          !(ref.type === 'text' && translatedTextIds.has(ref.id))
          && !(ref.type === 'translationMask' && translationMaskIds.has(ref.id))
        ),
      };
      return { documents: docs, selectedObject: null };
    }),

  addShape: (shape) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      // New shape goes on TOP of the unified stack (see addWatermark).
      const layerOrder = [...resolveLayerOrder(withH), { type: 'shape' as const, id: shape.id }];
      docs[state.activeDocIndex] = { ...withH, shapes: [...(withH.shapes ?? []), shape], layerOrder };
      return { documents: docs, selectedObject: { id: shape.id, type: 'shape' } };
    }),

  updateShape: (id, updates, options) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = options?.history
        ? withHistory(docs[state.activeDocIndex])
        : { ...docs[state.activeDocIndex], hasChanges: true };
      doc.shapes = (doc.shapes ?? []).flatMap(s => {
        if (s.id !== id) return [s];
        const sanitized = sanitizeShape({ ...s, ...filterLockedGeometryUpdates(s.locked, updates) });
        return sanitized ? [sanitized] : [];
      });
      doc.hasChanges = true;
      docs[state.activeDocIndex] = doc;
      return { documents: docs };
    }),

  deleteShape: (id) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      docs[state.activeDocIndex] = { ...withH, shapes: (withH.shapes ?? []).filter(s => s.id !== id) };
      return { documents: docs, selectedObject: null };
    }),

  updateShapeSettings: (u) => set(s => ({ shapeSettings: { ...s.shapeSettings, ...u } })),

  addBubble: (bubble) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = withHistory(docs[state.activeDocIndex]);
      const newLayerOrder = [...resolveLayerOrder(doc), { type: 'bubble' as const, id: bubble.id }];
      docs[state.activeDocIndex] = { ...doc, bubbles: [...(doc.bubbles ?? []), bubble], layerOrder: newLayerOrder };
      return { documents: docs, selectedObject: { id: bubble.id, type: 'bubble' as const } };
    }),

  updateBubble: (id, updates, options) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const current = state.documents[state.activeDocIndex];
      const target = (current.bubbles ?? []).find(bubble => bubble.id === id);
      if (!target) return {};
      const allowedUpdates = filterLockedGeometryUpdates(target.locked, updates);
      if (Object.keys(allowedUpdates).length === 0) return {};
      const docs = [...state.documents];
      const doc = options?.history === false
        ? { ...current, hasChanges: true }
        : withHistory(current);
      docs[state.activeDocIndex] = { ...doc, bubbles: (doc.bubbles ?? []).map(b => b.id === id ? { ...b, ...allowedUpdates } : b) };
      return { documents: docs };
    }),

  deleteBubble: (id) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = withHistory(docs[state.activeDocIndex]);
      const layerOrder = (doc.layerOrder ?? []).filter(ref => !(ref.type === 'bubble' && ref.id === id));
      docs[state.activeDocIndex] = { ...doc, bubbles: (doc.bubbles ?? []).filter(b => b.id !== id), layerOrder };
      return { documents: docs, selectedObject: null };
    }),

  duplicateBubble: (id) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = withHistory(docs[state.activeDocIndex]);
      const source = (doc.bubbles ?? []).find(b => b.id === id);
      if (!source) return {};
      const newId = `bubble-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newBubble = {
        ...source,
        id: newId,
        x: Math.min(0.95, source.x + 0.05),
        y: Math.min(0.95, source.y + 0.05),
        fillStyle: source.fillStyle ? clonePaintStyle(source.fillStyle) : undefined,
        strokeStyle: source.strokeStyle ? clonePaintStyle(source.strokeStyle) : undefined,
        glow: source.glow ? cloneGlowStyle(source.glow) : undefined,
        text: { ...source.text },
        tail: source.tail ? { ...source.tail } : null,
      };
      const newLayerOrder = [...resolveLayerOrder(doc), { type: 'bubble' as const, id: newId }];
      docs[state.activeDocIndex] = { ...doc, bubbles: [...(doc.bubbles ?? []), newBubble], layerOrder: newLayerOrder };
      return { documents: docs, selectedObject: { id: newId, type: 'bubble' as const } };
    }),

  addCustomFont: (name) => set(s => ({ customFonts: s.customFonts.includes(name) ? s.customFonts : [...s.customFonts, name] })),
  setCustomFonts: (names) => set({ customFonts: names }),
  removeCustomFont: (name) => set(s => ({ customFonts: s.customFonts.filter(f => f !== name) })),
  bumpFontsVersion: () => set(s => ({ fontsVersion: s.fontsVersion + 1 })),
  setFontsReady: (ready) => set({ fontsReady: ready }),

  setTranslationFontFamily: (name, options) => {
    if (options?.persist !== false) storeDefaultTranslationFont(name);
    set(s => ({
      translationFontFamily: name,
      // «Использовать его везде»: инструмент «Текст» тоже стартует с дефолта.
      textSettings: { ...s.textSettings, fontFamily: name },
    }));
  },

  replaceMissingFonts: (availableFonts) => {
    const missing = new Set<string>();
    set(state => {
      const available = new Set(availableFonts);
      const fallback = available.has(state.translationFontFamily)
        ? state.translationFontFamily
        : DEFAULT_ANIME_FONT;
      const resolve = (family: string | undefined): string | null => {
        if (!family || available.has(family)) return null;
        missing.add(family);
        return fallback;
      };
      let changed = false;
      const documents = state.documents.map(doc => {
        let docChanged = false;
        const texts = doc.texts.map(t => {
          const replacement = resolve(t.fontFamily);
          if (!replacement) return t;
          docChanged = true;
          return { ...t, fontFamily: replacement };
        });
        const watermarks = doc.watermarks.map(w => {
          if (w.type !== 'text') return w;
          const replacement = resolve(w.fontFamily);
          if (!replacement) return w;
          docChanged = true;
          return { ...w, fontFamily: replacement };
        });
        const bubbles = (doc.bubbles ?? []).map(b => {
          const replacement = resolve(b.text.fontFamily);
          if (!replacement) return b;
          docChanged = true;
          return { ...b, text: { ...b.text, fontFamily: replacement } };
        });
        if (!docChanged) return doc;
        changed = true;
        return { ...doc, texts, watermarks, bubbles, hasChanges: true };
      });
      return changed ? { documents } : {};
    });
    return Array.from(missing);
  },
  setCropRect: (rect) => set({ cropRect: rect }),

  applyDocumentTransform: (updates) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      docs[state.activeDocIndex] = { ...docs[state.activeDocIndex], ...updates };
      return { documents: docs, selectedObject: null, cropRect: null };
    }),

  updateWmSettings: (u) => set(s => ({ wmSettings: { ...s.wmSettings, ...u } })),
  updateCleanupSettings: (u) => set(s => ({ cleanupSettings: { ...s.cleanupSettings, ...u } })),
  updateTextSettings: (u) => set(s => ({ textSettings: { ...s.textSettings, ...u } })),
  updateCropSettings: (u) => set(s => ({ cropSettings: { ...s.cropSettings, ...u } })),
  updateBlurSettings: (u) => set(s => ({ blurSettings: { ...s.blurSettings, ...u } })),
  updateEyedropperSettings: (u) => set(s => ({ eyedropperSettings: { ...s.eyedropperSettings, ...u } })),
  setForegroundColor: (color) => set(state => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return {};
    const normalized = color.toLowerCase();
    return {
      foregroundColor: normalized,
      cleanupSettings: { ...state.cleanupSettings, brushColor: normalized },
      textSettings: { ...state.textSettings, fill: normalized },
    };
  }),
  updateTranslationMaskSettings: (u) => set(s => ({ translationMaskSettings: { ...s.translationMaskSettings, ...u } })),
  rememberTextColor: (color) => set(state => {
    const recentColors = addRecentColor(state.recentColors, color);
    storeRecentColors(recentColors);
    return { recentColors };
  }),
  updateExportSettings: (u) => set(s => ({ exportSettings: { ...s.exportSettings, ...u } })),

  setViewport: (vp) => set(s => ({ viewport: { ...s.viewport, ...vp } })),

  pushHistory: () =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      docs[state.activeDocIndex] = withHistory(docs[state.activeDocIndex]);
      return { documents: docs };
    }),

  rollbackPendingHistory: () => set(state => {
    if (state.activeDocIndex < 0) return {};
    const documents = [...state.documents];
    const doc = documents[state.activeDocIndex];
    if (doc.past.length === 0) return {};
    const past = [...doc.past];
    const snapshot = past.pop()!;
    documents[state.activeDocIndex] = { ...doc, ...snapshot, past, future: [] };
    return { documents, selectedObject: null };
  }),

  undo: () =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = docs[state.activeDocIndex];
      if (doc.past.length === 0) return {};
      const past = [...doc.past];
      const snapshot = past.pop()!;
      const current = snap(doc);
      const future = [current, ...doc.future].slice(0, MAX_HISTORY);
      docs[state.activeDocIndex] = { ...doc, ...snapshot, past, future };
      return { documents: docs, selectedObject: null };
    }),

  redo: () =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = docs[state.activeDocIndex];
      if (doc.future.length === 0) return {};
      const future = [...doc.future];
      const snapshot = future.shift()!;
      const current = snap(doc);
      const past = [...doc.past, current].slice(-MAX_HISTORY);
      docs[state.activeDocIndex] = { ...doc, ...snapshot, past, future };
      return { documents: docs, selectedObject: null };
    }),

  toggleLayerVisibility: (layer) =>
    set(s => ({ layerVisibility: { ...s.layerVisibility, [layer]: !s.layerVisibility[layer] } })),

  setShowExportModal: (show) => set({ showExportModal: show }),

  applyCleanupCommit: (dataURL) =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[state.activeDocIndex]);
      docs[state.activeDocIndex] = { ...withH, cleanup: { ...withH.cleanup, committed: dataURL, strokes: [] } };
      return { documents: docs };
    }),

  applyAiCleanupCommit: (documentId, dataURL, clearMask) =>
    set(state => {
      const index = state.documents.findIndex(doc => doc.id === documentId);
      if (index < 0) return {};
      const docs = [...state.documents];
      const withH = withHistory(docs[index]);
      docs[index] = {
        ...withH,
        cleanup: {
          ...withH.cleanup,
          committed: dataURL,
          strokes: clearMask
            ? withH.cleanup.strokes.filter(stroke => stroke.purpose !== 'mask')
            : withH.cleanup.strokes,
        },
      };
      return { documents: docs };
    }),

  clearCurrentDocument: () =>
    set(state => {
      if (state.activeDocIndex < 0) return {};
      const docs = [...state.documents];
      const doc = docs[state.activeDocIndex];
      const withH = withHistory(doc);
      docs[state.activeDocIndex] = {
        ...withH,
        cleanup: { committed: null, strokes: [] },
        baseLayer: createBaseLayerState(doc.id),
        masks: [],
        aiLayers: [],
        activeMaskId: null,
        selectedLayer: null,
        watermarks: [],
        texts: [],
        shapes: [],
        layerOrder: [],
        hasChanges: false,
      };
      return { documents: docs, selectedObject: null };
    }),

  setInpaintRunning: (running, progress = 0) =>
    set({ isInpaintRunning: running, inpaintProgress: progress }),
}));

// Persistent object URLs are retained while referenced by any current layer
// or undo/redo snapshot, then released as soon as the last reference leaves
// the store (page deletion, source replacement, or history eviction).
useStore.subscribe((state, previous) => {
  if (state.documents === previous.documents || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  if (!documentObjectUrlReferencesChanged(previous.documents, state.documents)) return;
  revokeUnusedDocumentObjectUrls(previous.documents, state.documents);
});
